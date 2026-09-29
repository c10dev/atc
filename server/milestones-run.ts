import type { Hono } from "hono";
import { type Departure, readDepartures } from "./departures.ts";
import { loadLogbook, type LogEntry } from "./logbook.ts";
import { loadMcc, RTS_FILE, readJsonl, type RtsRecord } from "./mcc.ts";
import { hasMilestone, MILESTONES, type MilestoneSources, type Milestones, milestonesOf } from "./milestones.ts";
import type { Snapshot } from "./model.ts";
import { allProposals } from "./proposals.ts";
import { readRecords, record } from "./recorder.ts";
import { gitReadSync as git } from "./sources/git.ts";

// OOOI 실행부(ATC-123, docs/dispatch.md "Milestones as built"). 기록을 읽어 순수 함수 milestonesOf에 넘기고,
// 처음 보인 이정표를 FLIGHT RECORDER에 한 번 적는다. 새 감지기는 없다: 이미 있는 기록(DEPARTURE LOG, LOGBOOK, 열린 PR, rts.jsonl)만 읽는다.

const DAY = 86_400_000;
const RETENTION_MS = 30 * DAY; // FLIGHT RECORDER 보관 기간(recorder.ts). 그보다 오래된 이정표는 적지 않는다
const RECORDER_TTL_MS = 60_000;
const NULL_TTL_MS = 5 * 60_000;

// ── git(읽기만). 머지 커밋은 "Merge pull request #n" 커밋으로 찾고, 대상 포함은 merge-base --is-ancestor로 본다 ──

const mergeCache = new Map<string, { sha: string | null; at: number }>();
function mergeCommitIn(repo: string, entry: LogEntry, now: number): string | null {
  const hit = mergeCache.get(entry.key);
  if (hit && (hit.sha || now - hit.at < NULL_TTL_MS)) return hit.sha;
  let sha: string | null = null;
  for (const ref of ["origin/main", "main"]) {
    try {
      sha = git(repo, ["log", "-1", "--merges", "--format=%H", `--grep=^Merge pull request #${entry.pr!.number} from`, ref]) || null;
    } catch {}
    if (sha) break;
  }
  mergeCache.set(entry.key, { sha, at: now });
  return sha;
}

const ancestorCache = new Map<string, boolean>();
function isAncestorIn(repo: string, commit: string, to: string): boolean {
  const key = `${commit}:${to}`;
  const hit = ancestorCache.get(key);
  if (hit !== undefined) return hit;
  try {
    git(repo, ["merge-base", "--is-ancestor", commit, to]);
    ancestorCache.set(key, true);
    return true;
  } catch (e) {
    if ((e as { status?: number }).status === 1) ancestorCache.set(key, false); // 조상이 아님. 그 밖의 오류(모르는 커밋 등)는 캐시하지 않는다
    return false;
  }
}

// FLIGHT RECORDER의 landing.requested(FLIGHT별). 파일을 매번 읽지 않게 1분 캐시
let requested: { at: number; byFlight: Map<string, string[]> } | null = null;
function landingRequestedOf(now: number): { flight: string | null; at: string }[] {
  if (!requested || now - requested.at > RECORDER_TTL_MS) {
    const byFlight = new Map<string, string[]>();
    for (const r of readRecords(now - RETENTION_MS)) {
      if (r.kind !== "event" || r.event.kind !== "landing.requested" || !r.event.ticketKey) continue;
      byFlight.set(r.event.ticketKey, [...(byFlight.get(r.event.ticketKey) ?? []), r.event.at]);
    }
    requested = { at: now, byFlight };
  }
  return [...requested.byFlight].flatMap(([flight, ats]) => ats.map((at) => ({ flight, at })));
}

// 지금 기록으로 FLIGHT마다 OOOI를 셈한다(하나라도 닿은 FLIGHT만)
export function milestonesNow(s: Pick<Snapshot, "pulls" | "airports">, now = Date.now()): Map<string, Milestones> {
  const departures = readDepartures();
  const proposals = allProposals();
  const logbook = loadLogbook();
  const rts = readJsonl<RtsRecord>(RTS_FILE());
  const requestedAll = landingRequestedOf(now);
  const mcc = loadMcc();
  const rtsRepo = s.airports.find((a) => a.code === mcc.airport)?.repo ?? null;

  const flights = new Set<string>();
  for (const d of departures) if (d.flight) flights.add(d.flight);
  for (const p of proposals) if (p.kind === "ASSIGN") flights.add(p.flight);
  for (const e of logbook) if (e.flight) flights.add(e.flight);
  for (const p of s.pulls) if (p.ticketKey) flights.add(p.ticketKey);

  const group = <T>(xs: T[], key: (x: T) => string | null) => {
    const m = new Map<string, T[]>();
    for (const x of xs) {
      const k = key(x);
      if (k) m.set(k, [...(m.get(k) ?? []), x]);
    }
    return m;
  };
  const dBy = group<Departure>(departures, (d) => d.flight);
  const prBy = group(proposals, (p) => p.flight);
  const lBy = group(logbook, (e) => e.flight);
  const pullBy = group(s.pulls, (p) => p.ticketKey);
  const reqBy = group(requestedAll, (e) => e.flight);

  const out = new Map<string, Milestones>();
  for (const flight of flights) {
    const src: MilestoneSources = {
      departures: dBy.get(flight) ?? [],
      proposals: prBy.get(flight) ?? [],
      pulls: pullBy.get(flight) ?? [],
      logbook: lBy.get(flight) ?? [],
      landingRequested: reqBy.get(flight) ?? [],
      rts,
      rtsAirport: rtsRepo ? mcc.airport : null,
      mergeCommitOf: (e) => (rtsRepo && e.pr ? mergeCommitIn(rtsRepo, e, now) : null),
      isAncestor: (commit, to) => Boolean(rtsRepo) && isAncestorIn(rtsRepo!, commit, to),
    };
    const m = milestonesOf(flight, src);
    if (hasMilestone(m)) out.set(flight, m);
  }
  return out;
}

// ── FLIGHT RECORDER: milestone.out|off|on|in을 FLIGHT·이정표마다 한 번(이미 적었는지는 기록에서 읽는다) ──
const RUN_MS = 60_000;
let written: Set<string> | null = null;
let lastRunAt = 0;
export function runMilestones(s: Snapshot, now = Date.now()) {
  if (now - lastRunAt < RUN_MS) return;
  lastRunAt = now;
  if (!written) {
    written = new Set();
    for (const r of readRecords(now - RETENTION_MS)) if (r.kind === "milestone") written.add(`${r.flight}|${r.milestone}`);
  }
  for (const [flight, m] of milestonesNow(s, now)) {
    for (const k of MILESTONES) {
      const at = m[k];
      const id = `${flight}|${k}`;
      if (!at || written.has(id) || now - Date.parse(at) > RETENTION_MS) continue;
      // t는 이정표가 일어난 시각이라 그 날짜 파일에 들어간다. seenAt은 atc가 처음 본 시각
      record({ t: at, kind: "milestone", milestone: k, flight, at, seenAt: new Date(now).toISOString() });
      written.add(id);
    }
  }
}

export function mountMilestones(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  // 읽기만 한다. 하나라도 닿은 FLIGHT의 OOOI
  app.get("/api/milestones", async (c) => {
    const now = Date.now();
    const flights = Object.fromEntries(milestonesNow(await getSnapshot(), now));
    return c.json({ at: new Date(now).toISOString(), flights });
  });
}

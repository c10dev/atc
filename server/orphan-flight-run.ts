import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { readDepartures } from "./departures.ts";
import type { Snapshot } from "./model.ts";
import { gitReadSync } from "./sources/git.ts";
import {
  NO_STAND_FACTS,
  type OrphanEventLine,
  type OrphanFlight,
  type OrphanInput,
  type OrphanStandFacts,
  type OrphanSwitch,
  type OrphanView,
  openEpisodesOf,
  orphanCounterOf,
  orphanDue,
  orphanFlightsByReg,
  orphansOf,
  orphanStep,
  orphanViewOf,
  parseOrphanSwitch,
} from "./orphan-flight.ts";
import { record } from "./recorder.ts";

// ORPHAN FLIGHT의 읽고 쓰기(ATC-516). 규칙은 orphan-flight.ts(순수). 스위치는 orphan-flight.json(원자적 JSON, 기본 on)이고 설정 창(fromThisApp)에서만 바꾼다 — atcctl 명령은 없다(K3).
// 에피소드는 orphan-flight-events.jsonl(추가만): open·alert·hold·close와 MISFIRE 표시. 이 길은 어느 세션에도 보내지 않는다: RESUME 글은 RELAY 초안이고 SUPERVISOR가 보낸다.

const SWITCH_FILE = () => join(config.stateDir, "orphan-flight.json");
const EVENTS = () => join(config.stateDir, "orphan-flight-events.jsonl");

export function loadOrphanSwitch(file = SWITCH_FILE()): OrphanSwitch {
  try {
    return parseOrphanSwitch(JSON.parse(readFileSync(file, "utf8")).mode);
  } catch {
    return "on";
  }
}

// 바뀐 것만 FLIGHT RECORDER에 남긴다. 임시 파일을 넘기면(시험) 운영 기록에 쓰지 않는다
export function saveOrphanSwitch(v: OrphanSwitch, by = "SUPERVISOR", file = SWITCH_FILE()) {
  const from = loadOrphanSwitch(file);
  if (from === v) return;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ mode: v }, null, 2) + "\n");
  renameSync(tmp, file);
  if (file === SWITCH_FILE()) record({ t: new Date().toISOString(), kind: "policy", op: "orphan-flight-mode", by, from, to: v });
}

export function readOrphanEvents(file = EVENTS()): OrphanEventLine[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: OrphanEventLine[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as OrphanEventLine);
    } catch {}
  }
  return out;
}

export function appendOrphanEvents(lines: readonly OrphanEventLine[], file = EVENTS()) {
  if (!lines.length) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, lines.map((l) => JSON.stringify(l) + "\n").join(""));
}

// 이 FLIGHT의 STAND가 담은 것: 푸시된 마지막 커밋, 커밋 안 된 변경 수와 삭제 수. git을 못 읽으면 모른다(null). 30초 캐시
const factsCache = new Map<string, { at: number; facts: OrphanStandFacts }>();
export function standFactsOf(path: string | null, now: number): OrphanStandFacts {
  if (!path) return NO_STAND_FACTS;
  const hit = factsCache.get(path);
  if (hit && now - hit.at < 30_000) return hit.facts;
  const facts: OrphanStandFacts = { commit: null, uncommitted: null, deletions: null };
  try {
    const lines = gitReadSync(path, ["status", "--porcelain"]).split("\n").filter(Boolean);
    facts.uncommitted = lines.length;
    facts.deletions = lines.filter((l) => l.slice(0, 2).includes("D")).length;
  } catch {}
  try {
    facts.commit = gitReadSync(path, ["rev-parse", "--short", "@{upstream}"]).trim() || null;
  } catch {}
  factsCache.set(path, { at: now, facts });
  return facts;
}

// 스냅샷과 기록에서 지금의 ORPHAN FLIGHT(스위치가 off면 없다). proposals·landed는 부르는 쪽이 준다(proposals.ts와 값 순환을 만들지 않는다)
export function orphansNow(s: Snapshot, now: number, proposals: OrphanInput["proposals"], landed: OrphanInput["landed"], teamPattern?: string): OrphanFlight[] {
  if (loadOrphanSwitch() === "off") return [];
  const owned = new Set<string>([...(s.restarting ?? []).map((r) => r.registration), ...(s.absent ?? []).filter((a) => a.cut).map((a) => a.registration)]);
  return orphansOf({ now, teamPattern, sessions: s.sessions, tickets: s.tickets, proposals, departures: readDepartures(), workspaces: s.workspaces, claims: s.claims, landed, owned });
}

// DISPATCH가 읽는 셈(REGISTRATION → FLIGHT들). grace를 기다리지 않는다
export const orphanCountsNow = (s: Snapshot, now: number, proposals: OrphanInput["proposals"], landed: OrphanInput["landed"], teamPattern?: string) => orphanFlightsByReg(orphansNow(s, now, proposals, landed, teamPattern));

// 알림·HOME 줄에 쓰는 것: grace가 지난 것만, STAND 사실과 RESUME 글을 붙여
export function orphanViewsNow(s: Snapshot, now: number, proposals: OrphanInput["proposals"], landed: OrphanInput["landed"], teamPattern?: string): OrphanView[] {
  return orphansNow(s, now, proposals, landed, teamPattern)
    .filter((o) => orphanDue(o, now, config.orphanGraceMin))
    .map((o) => orphanViewOf(o, standFactsOf(o.stand, now), now));
}

export interface OrphanTrackDeps {
  proposals: OrphanInput["proposals"];
  landed: OrphanInput["landed"];
  relays: readonly { flight: string | null; to: string; at: string }[];
  teamPattern?: string;
}

// 1분 일: 에피소드를 열고(open) 알림이 나올 때(alert) 닫는다(close, MISFIRE 표시). 읽기만 하고 JSONL에 덧붙인다
export function trackOrphans(s: Snapshot, d: OrphanTrackDeps, now = Date.now(), file = EVENTS()): OrphanEventLine[] {
  const sw = loadOrphanSwitch();
  const orphans = orphansNow(s, now, d.proposals, d.landed, d.teamPattern);
  const byKey = new Map(s.tickets.map((t) => [t.key, t]));
  const lines = orphanStep(openEpisodesOf(readOrphanEvents(file)), orphans, {
    now,
    graceMin: config.orphanGraceMin,
    sw,
    endOf: (flight) => {
      const t = byKey.get(flight);
      if (d.landed.has(flight) || t?.stateType === "completed") return "merged";
      if (t?.stateType === "canceled") return "canceled";
      const p = d.proposals.filter((x) => x.flight === flight && x.kind === "ASSIGN").sort((a, b) => b.at.localeCompare(a.at))[0];
      return t?.stateType === "started" && p && (p.status === "accepted" || p.status === "departed") ? "held" : "gone";
    },
    relaySince: (flight, reg, sinceMs) => d.relays.some((r) => r.flight === flight && r.to.toUpperCase() === reg && Date.parse(r.at) >= sinceMs),
  });
  appendOrphanEvents(lines, file);
  return lines;
}

// DISPATCH가 ORPHAN FLIGHT 때문에만 막은 REGISTRATION의 FLIGHT에 hold 줄을 한 번 남긴다(MISFIRE 셈이 읽는다)
export function noteDispatchHolds(aircraft: readonly { registration?: string; orphanOnly?: string[] }[], now = Date.now(), file = EVENTS()) {
  const open = openEpisodesOf(readOrphanEvents(file));
  const lines: OrphanEventLine[] = [];
  for (const a of aircraft)
    for (const flight of a.orphanOnly ?? []) {
      const e = open.get(flight);
      if (e && !e.holdAt) lines.push({ at: new Date(now).toISOString(), op: "hold", flight, registration: e.open.registration });
    }
  appendOrphanEvents(lines, file);
}

export function mountOrphanFlight(app: Hono) {
  // 스위치와 에피소드·MISFIRE 수(읽기 전용). 스위치는 설정 창(PUT /api/settings)에서만 바꾼다
  app.get("/api/orphan-flight", (c) => {
    const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || 7));
    const lines = readOrphanEvents();
    return c.json({ switch: loadOrphanSwitch(), graceMin: config.orphanGraceMin, ...orphanCounterOf(lines, Date.now(), days), recent: lines.filter((l) => l.op === "close" && l.misfire?.length).slice(-10).reverse() });
  });
}

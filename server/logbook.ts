import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { type Classification, classOf, type Wake } from "./crew.ts";
import { DEFAULT_DISPATCH_CONFIG, loadDispatchConfig } from "./dispatch.ts";
import { isCodexBot } from "./landing.ts";
import type { Claim, Snapshot, TrafficEvent } from "./model.ts";
import { readRecords } from "./recorder.ts";
import { readHookClaims } from "./sources/claude.ts";
import { ticketKeyFromBranch, ticketKeyFromTitle } from "./sources/git.ts";
import { type GhMerged, listMerged } from "./sources/github.ts";

// LOGBOOK: AIRCRAFT별 완료(ARRIVED) FLIGHT 기록. 기본 브랜치에 머지된 PR 하나가 한 줄이다.
// ~/.local/state/atc/logbook.jsonl에 추가만 하고, 되돌림(Revert PR)은 reverted 줄로 덧붙인다.
// 설계: docs/fleet.md 7.1~7.2. TARGETS 실적(actuals)은 보여 주기만 하고 점수·배정에 쓰지 않는다.

const MIN = 60_000;
const DAY = 86_400_000;
export const LOGBOOK_MS = 10 * MIN;
export const ACTUALS_DAYS = 14;
export const RECENT = 5;
// WAKE별 기대 block time(분, 상한). fleet.md 4.2의 "1시간 이내 · 몇 시간 · 1~2일"을 숫자로 읽은 것
export const WAKE_EXPECT_MIN: Partial<Record<Wake, number>> = { L: 60, M: 240, H: 2880 };
export const MEDIAN_MIN_SAMPLES = 3;

export interface LogEntry {
  key: string; // "owner/repo#31"
  aircraft: string | null; // REGISTRATION(대문자). 모르면 null
  flight: string | null; // "VOC-201", AD HOC이면 null
  class: Pick<Classification, "type" | "wake" | "ratings" | "explicit"> | null;
  airport: string | null;
  pr: { repo: string; number: number; url: string; title: string };
  stands: string[];
  departedAt: string;
  departedFrom: "claim" | "pr";
  arrivedAt: string;
  blockMin: number | null; // 팀 소요 시간: departedAt → PR을 연 시각. 점유가 없거나 PR 뒤에 생겼으면 null(모름)
  landingWaitMin: number; // 착륙 대기: PR을 연 시각 → 머지. 정시율에 넣지 않는다
  codexFindings: number; // Codex COMMENTED 리뷰 수(모든 커밋) = Codex가 지적한 리뷰 회차
  changesRequested: boolean;
  reverted: boolean;
  revertedBy?: { number: number; url: string; at: string } | null;
  los: number;
}

export type LogLine =
  | ({ op: "arrived"; t: string } & LogEntry)
  | { op: "reverted"; t: string; key: string; by: { number: number; url: string } };

const logbookFile = () => join(config.stateDir, "logbook.jsonl");

export function readLogbook(file = logbookFile()): LogLine[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: LogLine[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {}
  }
  return out;
}

export function appendLogbook(lines: LogLine[], file = logbookFile()) {
  if (!lines.length) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

// 줄들을 접는다: key마다 첫 arrived 줄, 그 뒤 reverted 줄을 반영. 도착 시각 최신순.
export function foldLogbook(lines: LogLine[]): LogEntry[] {
  const byKey = new Map<string, LogEntry>();
  for (const l of lines) {
    if (l.op === "arrived") {
      if (byKey.has(l.key)) continue;
      const { op: _op, t: _t, ...entry } = l;
      byKey.set(l.key, { ...entry, reverted: Boolean(entry.reverted) });
    } else if (l.op === "reverted") {
      const e = byKey.get(l.key);
      if (e && !e.reverted) Object.assign(e, { reverted: true, revertedBy: { ...l.by, at: l.t } });
    }
  }
  return [...byKey.values()].sort((a, b) => b.arrivedAt.localeCompare(a.arrivedAt));
}

// Revert PR이면 되돌린 PR의 key. body의 "Reverts owner/repo#N"을 먼저, 없으면 따옴표 안 제목으로 같은 저장소에서 찾는다.
export function revertTarget(pr: Pick<GhMerged, "title" | "body">, slug: string, entries: LogEntry[]): string | null {
  const m = /^Revert "(.+)"$/.exec(pr.title.trim());
  if (!m) return null;
  const ref = /Reverts ([\w.-]+\/[\w.-]+)#(\d+)/.exec(pr.body ?? "");
  if (ref) {
    const key = `${ref[1]}#${Number(ref[2])}`;
    return entries.some((e) => e.key === key) ? key : null;
  }
  return entries.find((e) => e.pr.repo === slug && e.pr.title === m[1])?.key ?? null;
}

export interface EntryContext {
  slug: string;
  repo: string; // AIRPORT 본 체크아웃 경로
  airport: string | null;
  ticketKeyOf: (pr: GhMerged) => string | null;
  labelsOf: (flight: string) => string[] | null; // Linear가 모르면 null
  landingStands: Map<string, Set<string>>; // "본 체크아웃#번호" → landing.* 이벤트의 STAND
  workspaces: Snapshot["workspaces"];
  claims: Pick<Claim, "sessionId" | "workspacePath" | "since" | "lastAt">[];
  nameOf: (sessionId: string) => string | null;
  teamPattern: string;
  los: Pick<TrafficEvent, "at" | "workspacePath">[]; // LOS 발생(alert.raised conflict)
  teamKey: string;
}

// 워크트리 이름에 그 FLIGHT의 ticket key가 있나(readFlightHistory와 같은 규칙)
function pathHasKey(path: string, flight: string, teamKey: string) {
  const n = Number(flight.split("-")[1]);
  const m = new RegExp(`(?:^|[/_-])${teamKey.toLowerCase()}-?(\\d+)(?:$|[/_-])`, "i").exec(basename(path));
  return Boolean(m && Number(m[1]) === n);
}

// 이 FLIGHT를 몬 STAND: landing 이벤트 → 아직 그 브랜치를 체크아웃한 워크트리 → 이름에 ticket key가 있는 워크트리
export function standsOf(pr: GhMerged, flight: string | null, ctx: EntryContext): string[] {
  const fromLanding = ctx.landingStands.get(`${ctx.repo}#${pr.number}`);
  if (fromLanding?.size) return [...fromLanding].sort();
  const checkedOut = ctx.workspaces.filter((w) => w.repo === ctx.repo && !w.isMain && w.branch === pr.headRefName).map((w) => w.path);
  if (checkedOut.length) return checkedOut.sort();
  if (!flight) return [];
  const paths = new Set([...ctx.claims.map((c) => c.workspacePath), ...ctx.workspaces.filter((w) => !w.isMain).map((w) => w.path)]);
  return [...paths].filter((p) => pathHasKey(p, flight, ctx.teamKey)).sort();
}

export function buildEntry(pr: GhMerged, ctx: EntryContext): LogEntry {
  const flight = ctx.ticketKeyOf(pr);
  const labels = flight ? ctx.labelsOf(flight) : null;
  const c = labels ? classOf(labels) : null;
  const stands = standsOf(pr, flight, ctx);
  const arrivedMs = Date.parse(pr.mergedAt);
  // 머지 뒤에 새로 잡은 점유(같은 STAND의 다음 작업)는 이 FLIGHT가 아니다
  const claims = ctx.claims.filter((x) => stands.includes(x.workspacePath) && Date.parse(x.since) <= arrivedMs);
  const team = new RegExp(ctx.teamPattern, "i");
  const flown = claims
    .map((x) => ({ ...x, name: ctx.nameOf(x.sessionId) }))
    .filter((x) => x.name && team.test(x.name))
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  // 점유의 since는 3시간 쉬면 새로 시작하므로 PR을 연 시각이 더 이를 수 있다
  const firstClaim = claims.map((x) => x.since).sort()[0] ?? null;
  const departedFrom = firstClaim && firstClaim <= pr.createdAt ? "claim" : "pr";
  const departedAt = departedFrom === "claim" ? firstClaim! : pr.createdAt;
  const departedMs = Date.parse(departedAt);
  const openedMs = Date.parse(pr.createdAt);
  const reviews = pr.reviews ?? [];
  return {
    key: `${ctx.slug}#${pr.number}`,
    aircraft: flown[0]?.name?.toUpperCase() ?? null,
    flight,
    class: c && { type: c.type, wake: c.wake, ratings: c.ratings, explicit: c.explicit },
    airport: ctx.airport,
    pr: { repo: ctx.slug, number: pr.number, url: pr.url, title: pr.title },
    stands,
    departedAt,
    departedFrom,
    arrivedAt: pr.mergedAt,
    blockMin: departedFrom === "claim" ? Math.max(0, Math.round((openedMs - departedMs) / MIN)) : null,
    landingWaitMin: Math.max(0, Math.round((arrivedMs - openedMs) / MIN)),
    codexFindings: reviews.filter((r) => isCodexBot(r.author?.login) && r.state === "COMMENTED").length,
    changesRequested: reviews.some((r) => r.state === "CHANGES_REQUESTED"),
    reverted: false,
    los: ctx.los.filter((e) => e.workspacePath && stands.includes(e.workspacePath) && Date.parse(e.at) >= departedMs && Date.parse(e.at) <= arrivedMs).length,
  };
}

// 머지된 PR 목록 → 새로 쓸 줄. 이미 있는 PR은 건너뛰고, Revert PR은 원래 FLIGHT의 reverted 줄이 된다.
export function planLogbook(merged: { ctx: EntryContext; pulls: GhMerged[] }[], lines: LogLine[], now = new Date().toISOString()): LogLine[] {
  const entries = foldLogbook(lines);
  const seen = new Set(entries.map((e) => e.key));
  const revertedKeys = new Set(entries.filter((e) => e.reverted).map((e) => e.key));
  const reverts = new Set(lines.flatMap((l) => (l.op === "reverted" ? [l.by.url] : [])));
  const out: LogLine[] = [];
  const all = merged.flatMap(({ ctx, pulls }) => pulls.map((pr) => ({ ctx, pr }))).sort((a, b) => a.pr.mergedAt.localeCompare(b.pr.mergedAt));
  for (const { ctx, pr } of all) {
    if (/^Revert "/.test(pr.title.trim())) {
      if (reverts.has(pr.url)) continue;
      const target = revertTarget(pr, ctx.slug, entries);
      if (!target || revertedKeys.has(target)) continue;
      out.push({ op: "reverted", t: pr.mergedAt, key: target, by: { number: pr.number, url: pr.url } });
      reverts.add(pr.url);
      revertedKeys.add(target);
      continue;
    }
    const key = `${ctx.slug}#${pr.number}`;
    if (seen.has(key)) continue;
    const entry = buildEntry(pr, ctx);
    out.push({ op: "arrived", t: now, ...entry });
    entries.push(entry);
    seen.add(key);
  }
  return out;
}

// ---- TARGETS 실적 ----

export interface Actuals {
  weekFrom: string;
  week: number; // 이번 주 ARRIVED
  onTime: { rate: number | null; within: number; measured: number }; // 최근 14일, 기대치가 있는 것만
  reverted: number; // 최근 14일
  los: number; // 최근 14일 LOS 합
  total: number; // 최근 14일 ARRIVED
  landingWait: { medianMin: number | null; count: number }; // 최근 14일 착륙 대기(PR을 연 뒤 머지까지) 중앙값
  recent: (LogEntry & { expectMin: number | null; onTime: boolean | null })[];
}

// 이번 주 월요일 00:00(서버 로컬 시간)
export function weekStartOf(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const groupOf = (e: LogEntry) => (e.class ? `${e.class.type}·${e.class.wake}` : "AD HOC");

// 기대 block time(분). 라벨로 정한 L·M·H는 고정값, 그 밖(J, WAKE 라벨 없음, AD HOC)은
// 같은 FLIGHT TYPE·WAKE(AD HOC은 AD HOC끼리) 다른 기록의 중앙값. 3건이 안 되면 null(정시율에서 뺀다).
// 중앙값에는 AIRCRAFT와 팀 소요 시간을 아는 기록만 쓴다.
export function expectationMin(e: LogEntry, all: LogEntry[]): number | null {
  if (e.class?.explicit.wake && WAKE_EXPECT_MIN[e.class.wake] != null) return WAKE_EXPECT_MIN[e.class.wake]!;
  const others = all.filter((x) => x.key !== e.key && x.aircraft && x.blockMin !== null && groupOf(x) === groupOf(e)).map((x) => x.blockMin!);
  return others.length >= MEDIAN_MIN_SAMPLES ? median(others) : null;
}

export function computeActuals(entries: LogEntry[], registration: string, now: number, weekFrom = weekStartOf(now)): Actuals {
  const reg = registration.toUpperCase();
  const mine = entries.filter((e) => e.aircraft === reg).sort((a, b) => b.arrivedAt.localeCompare(a.arrivedAt));
  const since = now - ACTUALS_DAYS * DAY;
  const window = mine.filter((e) => Date.parse(e.arrivedAt) >= since && Date.parse(e.arrivedAt) <= now);
  const judged = (e: LogEntry) => {
    const expectMin = expectationMin(e, entries);
    // 팀 소요 시간을 모르면(null) 정시율에서 뺀다
    return { ...e, expectMin, onTime: expectMin === null || e.blockMin === null ? null : e.blockMin <= expectMin };
  };
  const measured = window.map(judged).filter((e) => e.onTime !== null);
  const within = measured.filter((e) => e.onTime).length;
  return {
    weekFrom: new Date(weekFrom).toISOString(),
    week: mine.filter((e) => Date.parse(e.arrivedAt) >= weekFrom && Date.parse(e.arrivedAt) <= now).length,
    onTime: { rate: measured.length ? within / measured.length : null, within, measured: measured.length },
    reverted: window.filter((e) => e.reverted).length,
    los: window.reduce((a, e) => a + e.los, 0),
    total: window.length,
    landingWait: { medianMin: median(window.map((e) => e.landingWaitMin)), count: window.length },
    recent: mine.slice(0, RECENT).map(judged),
  };
}

// ---- 입출력 ----

let lastRunAt = 0;
let inflight: Promise<void> | null = null;
export const logbookState = { error: null as string | null, ranAt: null as string | null };

// 스냅샷과 기록으로 문맥을 만든다. 점유는 TTL과 상관없이 hook 기록 전체를 본다(지난 FLIGHT도 찾으려고).
function contextFor(s: Snapshot, repo: string, slug: string, records: ReturnType<typeof readRecords>): EntryContext {
  const events = records.filter((r) => r.kind === "event").map((r) => (r as { event: TrafficEvent }).event);
  const landingStands = new Map<string, Set<string>>();
  for (const e of events) {
    if (!e.kind.startsWith("landing.") || !e.repo || !e.pull || !e.workspacePath) continue;
    const k = `${e.repo}#${e.pull}`;
    if (!landingStands.has(k)) landingStands.set(k, new Set());
    landingStands.get(k)!.add(e.workspacePath);
  }
  const names = new Map(s.sessions.map((x) => [x.id, x.name]));
  const byKey = new Map(s.tickets.map((t) => [t.key, t]));
  return {
    slug,
    repo,
    airport: s.airports.find((a) => a.repo === repo)?.code ?? null,
    ticketKeyOf: (pr) => ticketKeyFromBranch(pr.headRefName) ?? ticketKeyFromTitle(pr.title),
    labelsOf: (flight) => byKey.get(flight)?.labels ?? null,
    landingStands,
    workspaces: s.workspaces,
    claims: [...readHookClaims(), ...s.claims],
    nameOf: (id) => names.get(id) ?? null,
    teamPattern: loadDispatchConfig().teamPattern ?? DEFAULT_DISPATCH_CONFIG.teamPattern,
    los: events.filter((e) => e.kind === "alert.raised" && e.alertKind === "conflict"),
    teamKey: config.linearTeamKey,
  };
}

async function run(s: Snapshot) {
  const records = readRecords(Date.now() - 30 * DAY);
  const errors: string[] = [];
  const merged: { ctx: EntryContext; pulls: GhMerged[] }[] = [];
  for (const a of s.airports) {
    try {
      const got = await listMerged(a.repo);
      if (got) merged.push({ ctx: contextFor(s, a.repo, got.slug, records), pulls: got.pulls });
    } catch (e) {
      const err = e as Error & { stderr?: string };
      errors.push(`${a.code}: ${(err.stderr?.trim() || err.message).split("\n")[0]}`);
    }
  }
  const lines = planLogbook(merged, readLogbook());
  appendLogbook(lines);
  if (lines.length) console.log(`[atc] LOGBOOK +${lines.length}`);
  logbookState.error = errors.length ? errors.join(" · ") : null;
  logbookState.ranAt = new Date().toISOString();
}

// 10분마다(서버가 뜬 뒤 첫 번에 최근 머지 PR로 과거분도 채운다). 스냅샷을 막지 않는다.
export function runLogbook(s: Snapshot) {
  if (!s.github.enabled || inflight || Date.now() - lastRunAt < LOGBOOK_MS) return;
  lastRunAt = Date.now();
  inflight = run(s)
    .catch((e) => void (logbookState.error = String((e as Error).message ?? e)))
    .finally(() => (inflight = null));
}

export const loadLogbook = () => foldLogbook(readLogbook());

export function mountLogbook(app: Hono) {
  app.get("/api/logbook", (c) => {
    const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || ACTUALS_DAYS));
    const aircraft = c.req.query("aircraft")?.toUpperCase() ?? null;
    const since = Date.now() - days * DAY;
    const entries = loadLogbook().filter((e) => Date.parse(e.arrivedAt) >= since && (!aircraft || e.aircraft === aircraft));
    return c.json({ days, aircraft, entries, ...logbookState });
  });
}

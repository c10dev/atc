import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { type Classification, classOf, type Wake } from "./crew.ts";
import { DEFAULT_DISPATCH_CONFIG, loadDispatchConfig } from "./dispatch.ts";
import { type GhThread, isCodexBot, type LandingReview } from "./landing.ts";
import { keyInName, teamOfKey } from "./linear-keys.ts";
import type { Claim, Snapshot, TrafficEvent } from "./model.ts";
import { briefFactsOf, compareBriefs, crewModeOf, findingsOf, type Measured, reworkOf, type TalkEvent } from "./briefs.ts";
import { readRecords } from "./recorder.ts";
import { type Departure, matchDepartures, readDepartures } from "./departures.ts";
import { readHookClaims, sessionEventsOf } from "./sources/claude.ts";
import { priceFlightFuel } from "./fuel-cost.ts";
import type { FlightFuel } from "./fuel-flights.ts";
import { readPrices } from "./fuel-prices.ts";
import { type PricedEntry, tripCheckOf } from "./fuel-view.ts";
import { sessionDirsOf } from "./crew-observed.ts";
import { readLandingReviews } from "./landing-review.ts";
import { ticketKeyFromBranch, ticketKeyFromTitle } from "./sources/git.ts";
import { type GhMerged, listMerged, threadsOf } from "./sources/github.ts";

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
  branch?: string | null; // PR 브랜치(옛 줄에는 없다). 착수 기록과 맞출 때 쓴다
  stands: string[];
  departedAt: string;
  departedFrom: "claim" | "departure" | "pr"; // departure: 착수 기록(departures.jsonl)의 첫 시각
  link?: PrLink; // PR 본문이 이 FLIGHT를 끝내나(Fixes)·일부인가(Part of). 옛 줄에는 없다(SCHEDULE CLOSE가 gh로 읽는다)
  attributedBy?: "departures"; // 나중에 attributed 줄로 AIRCRAFT를 채웠으면
  arrivedAt: string;
  blockMin: number | null; // 팀 소요 시간: departedAt → PR을 연 시각. 점유가 없거나 PR 뒤에 생겼으면 null(모름)
  landingWaitMin: number; // 착륙 대기: PR을 연 시각 → 머지. 정시율에 넣지 않는다
  codexFindings: number; // Codex COMMENTED 리뷰 수(모든 커밋) = Codex가 지적한 리뷰 회차
  changesRequested: boolean;
  reverted: boolean;
  revertedBy?: { number: number; url: string; at: string } | null;
  los: number;
  measured?: Measured; // 지시서(VECTORS·DIRECT)와 P0–P2 지적·수정 커밋(ATC-32). measured 줄로 채운다
  fuel?: FlightFuel; // FUEL F4(ATC-53): 이 FLIGHT 구간의 FUEL BURN. arrived 줄을 쓸 때만 붙이고, 옛 줄과 모르는 FLIGHT에는 없다
}

// PR 본문과 FLIGHT의 관계. vocado 규칙상 `Fixes VOC-n`만 이슈를 끝내고, `Part of VOC-n`은 일부다.
export type PrLink = "fixes" | "part-of" | "none";
export function prLinkOf(body: string | null | undefined, flight: string): PrLink {
  const key = flight.replace(/[-]/g, "[-\\s]?");
  if (new RegExp(`\\bfix(?:es|ed)?\\s*:?\\s*\\[?${key}\\b`, "i").test(body ?? "")) return "fixes";
  if (new RegExp(`\\bpart\\s+of\\s*:?\\s*\\[?${key}\\b`, "i").test(body ?? "")) return "part-of";
  return "none";
}

export type LogLine =
  | ({ op: "arrived"; t: string } & LogEntry)
  | { op: "reverted"; t: string; key: string; by: { number: number; url: string } }
  // AIRCRAFT를 몰랐던 줄을 착수 기록으로 나중에 채운다. 출발 시각을 몰랐으면(departedFrom "pr") 그것도
  | { op: "attributed"; t: string; key: string; aircraft: string; via: "departures"; departedAt?: string; blockMin?: number }
  // 지시서·지적·수정 커밋을 나중에 잰다(ATC-32). 이미 채운 칸은 바꾸지 않는다
  | ({ op: "measured"; t: string; key: string } & Measured);

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
    } else if (l.op === "attributed") {
      const e = byKey.get(l.key);
      if (!e || e.aircraft) continue; // 이미 아는 AIRCRAFT는 바꾸지 않는다
      Object.assign(e, { aircraft: l.aircraft, attributedBy: l.via });
      if (l.departedAt && l.blockMin != null && e.departedFrom === "pr") Object.assign(e, { departedAt: l.departedAt, departedFrom: "departure", blockMin: l.blockMin });
    } else if (l.op === "measured") {
      const e = byKey.get(l.key);
      if (!e) continue;
      const m: Measured = { ...e.measured };
      if (l.brief !== undefined && m.brief === undefined) m.brief = l.brief;
      if (l.findings !== undefined && m.findings === undefined) m.findings = l.findings;
      if (l.rework !== undefined && m.rework === undefined) m.rework = l.rework;
      if (l.crew !== undefined && m.crew === undefined) m.crew = l.crew;
      e.measured = m;
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
  departures?: Departure[]; // 착수 기록(departures.jsonl)
}

// 워크트리 이름에 그 FLIGHT의 ticket key가 있나(readFlightHistory와 같은 규칙. 팀은 FLIGHT key의 접두어)
function pathHasKey(path: string, flight: string) {
  return keyInName(basename(path), [teamOfKey(flight)]) === flight;
}

// 이 FLIGHT를 몬 STAND: landing 이벤트 → 아직 그 브랜치를 체크아웃한 워크트리 → 이름에 ticket key가 있는 워크트리
export function standsOf(pr: GhMerged, flight: string | null, ctx: EntryContext): string[] {
  const fromLanding = ctx.landingStands.get(`${ctx.repo}#${pr.number}`);
  if (fromLanding?.size) return [...fromLanding].sort();
  const checkedOut = ctx.workspaces.filter((w) => w.repo === ctx.repo && !w.isMain && w.branch === pr.headRefName).map((w) => w.path);
  if (checkedOut.length) return checkedOut.sort();
  if (!flight) return [];
  const paths = new Set([...ctx.claims.map((c) => c.workspacePath), ...ctx.workspaces.filter((w) => !w.isMain).map((w) => w.path)]);
  return [...paths].filter((p) => pathHasKey(p, flight)).sort();
}

export function buildEntry(pr: GhMerged, ctx: EntryContext): LogEntry {
  const flight = ctx.ticketKeyOf(pr);
  const labels = flight ? ctx.labelsOf(flight) : null;
  const c = labels ? classOf(labels) : null;
  const found = standsOf(pr, flight, ctx);
  // 착수 기록: 같은 브랜치(없으면 FLIGHT·STAND)의 마지막 AIRCRAFT와 첫 시각. 워크트리가 지워졌으면 STAND도 여기서
  const dep = matchDepartures(ctx.departures ?? [], { repo: ctx.repo, branch: pr.headRefName, flight, stands: found, before: pr.mergedAt });
  const stands = found.length ? found : dep.stands;
  const arrivedMs = Date.parse(pr.mergedAt);
  // 머지 뒤에 새로 잡은 점유(같은 STAND의 다음 작업)는 이 FLIGHT가 아니다
  const claims = ctx.claims.filter((x) => stands.includes(x.workspacePath) && Date.parse(x.since) <= arrivedMs);
  const team = new RegExp(ctx.teamPattern, "i");
  const flown = claims
    .map((x) => ({ ...x, name: ctx.nameOf(x.sessionId) }))
    .filter((x) => x.name && team.test(x.name))
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  // 출발: 점유와 착수 기록 중 가장 이른 것. 점유의 since는 3시간 쉬면 새로 시작하므로 PR을 연 시각이 더 이를 수 있다
  const firstClaim = claims.map((x) => x.since).sort()[0] ?? null;
  const first = [
    ...(firstClaim ? [{ t: firstClaim, from: "claim" as const }] : []),
    ...(dep.firstAt ? [{ t: dep.firstAt, from: "departure" as const }] : []),
  ].sort((a, b) => a.t.localeCompare(b.t))[0];
  const departedFrom = first && first.t <= pr.createdAt ? first.from : "pr";
  const departedAt = departedFrom === "pr" ? pr.createdAt : first!.t;
  const departedMs = Date.parse(departedAt);
  const openedMs = Date.parse(pr.createdAt);
  const reviews = pr.reviews ?? [];
  return {
    key: `${ctx.slug}#${pr.number}`,
    aircraft: flown[0]?.name?.toUpperCase() ?? dep.aircraft,
    flight,
    class: c && { type: c.type, wake: c.wake, ratings: c.ratings, explicit: c.explicit },
    airport: ctx.airport,
    pr: { repo: ctx.slug, number: pr.number, url: pr.url, title: pr.title },
    branch: pr.headRefName,
    ...(flight ? { link: prLinkOf(pr.body, flight) } : {}),
    stands,
    departedAt,
    departedFrom,
    arrivedAt: pr.mergedAt,
    blockMin: departedFrom === "pr" ? null : Math.max(0, Math.round((openedMs - departedMs) / MIN)),
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
  // 이미 있던 AIRCRAFT 모름 줄을 착수 기록으로 채운다(그 저장소를 이번에 읽었을 때만)
  const bySlug = new Map(merged.map(({ ctx }) => [ctx.slug, ctx]));
  for (const e of entries) {
    const ctx = bySlug.get(e.pr.repo);
    if (e.aircraft || !ctx) continue;
    const line = attribution(e, ctx.repo, ctx.departures ?? [], now);
    if (line) out.push(line);
  }
  return out;
}

// AIRCRAFT를 몰랐던 LOGBOOK 줄 하나에 대한 보정 줄. 착수 기록이 생기기 전 FLIGHT는 대개 채우지 못한다(정상).
export function attribution(e: LogEntry, repo: string, departures: Departure[], now: string): Extract<LogLine, { op: "attributed" }> | null {
  const m = matchDepartures(departures, { repo, branch: e.branch ?? null, flight: e.flight, stands: e.stands, before: e.arrivedAt });
  if (!m.aircraft) return null;
  const line: Extract<LogLine, { op: "attributed" }> = { op: "attributed", t: now, key: e.key, aircraft: m.aircraft, via: "departures" };
  // 출발 시각을 몰랐고(PR을 연 시각) 착수 기록이 PR보다 이르면 팀 소요 시간도 채운다
  const openedMs = Date.parse(e.arrivedAt) - e.landingWaitMin * MIN;
  if (e.departedFrom === "pr" && m.firstAt && Date.parse(m.firstAt) <= openedMs) {
    line.departedAt = m.firstAt;
    line.blockMin = Math.max(0, Math.round((openedMs - Date.parse(m.firstAt)) / MIN));
  }
  return line;
}

// ---- 지시서 비교 측정(ATC-32) ----

export const MEASURE_DAYS = 30;
export const THREADS_PER_RUN = 10; // 한 바퀴에 지적을 읽을 머지 PR 수(첫 바퀴의 과거분을 나눠 읽는다)

export interface MeasureInputs {
  pulls: Map<string, GhMerged>; // LOGBOOK key → 이번에 읽은 머지 PR(commits 포함)
  eventsOf: (aircraft: string) => TalkEvent[] | null; // 그 AIRCRAFT 세션들의 대화 기록 사건(서브에이전트 쓰기 포함). 이어진 세션이 없으면 null
  threads: Map<string, GhThread[]>; // LOGBOOK key → 리뷰 스레드(읽은 것만)
  reviews: LandingReview[];
}

// 지적을 아직 안 잰, 이번에 읽은 머지 PR
export function needsFindings(entries: LogEntry[], pulls: Map<string, GhMerged>, now: number): LogEntry[] {
  const since = now - MEASURE_DAYS * DAY;
  return entries.filter((e) => Date.parse(e.arrivedAt) >= since && e.measured?.findings === undefined && pulls.has(e.key));
}

// 재야 할 칸: 지시서(FLIGHT·AIRCRAFT와 대화 기록이 있어야), SOLO·CREW(AIRCRAFT와 대화 기록이 있어야),
// 수정 커밋(PR을 이번에 읽었을 때), 지적(스레드를 읽었을 때)
export function measureLines(entries: LogEntry[], inp: MeasureInputs, now: number): LogLine[] {
  const since = now - MEASURE_DAYS * DAY;
  const t = new Date(now).toISOString();
  const out: LogLine[] = [];
  for (const e of entries) {
    if (Date.parse(e.arrivedAt) < since) continue;
    const m = e.measured ?? {};
    const pr = inp.pulls.get(e.key);
    const openedAt = pr?.createdAt ?? new Date(Date.parse(e.arrivedAt) - e.landingWaitMin * MIN).toISOString();
    const line: Measured = {};
    if (m.brief === undefined) {
      if (!e.flight) line.brief = null; // AD HOC: 지시서가 없다
      else if (e.aircraft) {
        const events = inp.eventsOf(e.aircraft);
        if (events) line.brief = briefFactsOf(events, e.flight, openedAt, e.departedAt);
      }
    }
    // SOLO·CREW: 착수(또는 PR) 하루 전부터 머지까지 STAND 안 쓰기. 기록에 없으면 null로 굳힌다
    if (m.crew === undefined && e.aircraft) {
      const events = inp.eventsOf(e.aircraft);
      const from = new Date(Math.min(Date.parse(e.departedAt) || Infinity, Date.parse(openedAt)) - DAY).toISOString();
      if (events) line.crew = crewModeOf(events, e.stands, from, e.arrivedAt);
    }
    if (m.rework === undefined && pr?.commits) line.rework = reworkOf(pr.commits, openedAt);
    const threads = inp.threads.get(e.key);
    if (m.findings === undefined && threads) line.findings = findingsOf(threads, inp.reviews, e.pr.repo, e.pr.number);
    if (Object.keys(line).length) out.push({ op: "measured", t, key: e.key, ...line });
  }
  return out;
}

// ---- TARGETS 실적 ----

export interface Actuals {
  weekFrom: string;
  week: number; // 이번 주 ARRIVED
  onTime: { rate: number | null; within: number; measured: number }; // 최근 14일, 기대치가 있는 것만
  weekOnTime: { rate: number | null; within: number; measured: number }; // 이번 주(월요일부터), 기대치가 있는 것만(FLEET 운항 상태 목록, ATC-44)
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
  const weekMine = mine.filter((e) => Date.parse(e.arrivedAt) >= weekFrom && Date.parse(e.arrivedAt) <= now);
  const weekMeasured = weekMine.map(judged).filter((e) => e.onTime !== null);
  const weekWithin = weekMeasured.filter((e) => e.onTime).length;
  return {
    weekFrom: new Date(weekFrom).toISOString(),
    week: weekMine.length,
    onTime: { rate: measured.length ? within / measured.length : null, within, measured: measured.length },
    weekOnTime: { rate: weekMeasured.length ? weekWithin / weekMeasured.length : null, within: weekWithin, measured: weekMeasured.length },
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
    departures: readDepartures(),
  };
}

// 새 arrived 줄에 fuel을 붙이는 단계(FUEL F4). fuel-run.ts가 proposals.ts를 거쳐 이 파일을 불러 순환이 되므로 index.ts가 넘긴다
export type LogbookFuel = (lines: LogLine[], entries: LogEntry[], s: Snapshot) => void;

async function run(s: Snapshot, addFuel: LogbookFuel | null) {
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
  const old = readLogbook();
  const lines = planLogbook(merged, old);
  try {
    addFuel?.(lines, foldLogbook([...old, ...lines]), s);
  } catch (e) {
    errors.push(`FUEL: ${String((e as Error).message ?? e).split("\n")[0]}`); // fuel 없이 쓴다(옛 줄과 같다)
  }
  appendLogbook(lines);
  if (lines.length) console.log(`[atc] LOGBOOK +${lines.length}`);
  try {
    await measure(s, merged);
  } catch (e) {
    errors.push(`측정: ${String((e as Error).message ?? e).split("\n")[0]}`);
  }
  logbookState.error = errors.length ? errors.join(" · ") : null;
  logbookState.ranAt = new Date().toISOString();
}

// 지시서·지적·수정 커밋을 재서 measured 줄로 덧붙인다. 대화 기록은 사건(시각·받는 곳·표시)만 뽑고 본문은 두지 않는다
async function measure(s: Snapshot, merged: { ctx: EntryContext; pulls: GhMerged[] }[]) {
  const now = Date.now();
  const entries = loadLogbook();
  const pulls = new Map(merged.flatMap(({ ctx, pulls }) => pulls.map((p) => [`${ctx.slug}#${p.number}`, p] as const)));
  const threads = new Map<string, GhThread[]>();
  for (const e of needsFindings(entries, pulls, now).slice(0, THREADS_PER_RUN)) {
    try {
      threads.set(e.key, await threadsOf(e.pr.repo, e.pr.number));
    } catch {} // 다음 바퀴에 다시
  }
  const byAircraft = new Map<string, TalkEvent[] | null>();
  const eventsOf = (aircraft: string) => {
    if (!byAircraft.has(aircraft)) {
      const dirs = sessionDirsOf(aircraft, s.sessions, now, MEASURE_DAYS + 14);
      byAircraft.set(aircraft, dirs && dirs.flatMap(sessionEventsOf).sort((a, b) => a.t.localeCompare(b.t)));
    }
    return byAircraft.get(aircraft)!;
  };
  const lines = measureLines(entries, { pulls, eventsOf, threads, reviews: readLandingReviews() }, now);
  appendLogbook(lines);
  if (lines.length) console.log(`[atc] LOGBOOK measured +${lines.length}`);
}

// 10분마다(서버가 뜬 뒤 첫 번에 최근 머지 PR로 과거분도 채운다). 스냅샷을 막지 않는다.
export function runLogbook(s: Snapshot, addFuel: LogbookFuel | null = null) {
  if (!s.github.enabled || inflight || Date.now() - lastRunAt < LOGBOOK_MS) return;
  lastRunAt = Date.now();
  inflight = run(s, addFuel)
    .catch((e) => void (logbookState.error = String((e as Error).message ?? e)))
    .finally(() => (inflight = null));
}

export const loadLogbook = () => foldLogbook(readLogbook());

// fuel의 모델별 토큰에 읽을 때 지금 가격표로 값을 매긴 LOGBOOK(ATC-59). byModel이 없는 옛 fuel은 fuelCost null, fuel 없는 줄은 fuelCost 없음
export function loadPricedLogbook(): PricedEntry[] {
  const table = readPrices().table;
  return loadLogbook().map((e) => (e.fuel ? { ...e, fuelCost: priceFlightFuel(e.fuel, table) } : e));
}

export function mountLogbook(app: Hono) {
  app.get("/api/logbook", (c) => {
    const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || ACTUALS_DAYS));
    const aircraft = c.req.query("aircraft")?.toUpperCase() ?? null;
    const now = Date.now();
    const since = now - days * DAY;
    const all = loadPricedLogbook();
    // trip(FUEL F8, ATC-56): 그 FLIGHT의 NET이 같은 TYPE × WAKE(모자라면 WAKE, AIRPORT) TRIP FUEL p90 안이었나. 값이 없으면 verdict null
    const entries = all.filter((e) => Date.parse(e.arrivedAt) >= since && (!aircraft || e.aircraft === aircraft)).map((e) => ({ ...e, trip: tripCheckOf(e, all, now) }));
    return c.json({ days, aircraft, entries, ...logbookState });
  });
  // VECTORS 대 DIRECT(ATC-32): 기간 안 ARRIVED FLIGHT를 지시서 종류별로 나눈 지표와 행
  app.get("/api/logbook/briefs", (c) => {
    const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || MEASURE_DAYS));
    return c.json({ days, ...compareBriefs(loadLogbook(), Date.now(), days), ranAt: logbookState.ranAt, error: logbookState.error });
  });
}

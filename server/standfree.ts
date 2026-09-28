import type { TalkEvent } from "./briefs.ts";
import type { Classification } from "./crew.ts";
import type { Departure } from "./departures.ts";
import type { LogEntry, LogLine, StandFreeArrival } from "./logbook.ts";

// STAND 없는 FLIGHT(type:SURVEY·CHECK)의 ARRIVED(ATC-72, docs/fleet.md 5.1.1).
// atc는 일이 끝난 흔적을 찾아 "ARRIVED 후보"로 보이기만 한다. ARRIVED는 OCC(또는 SUPERVISOR)가 확인하고 적는다 —
// 잘못 맞춘 후보가 AIRCRAFT를 일찍 풀어 주면 안 된다. 확인된 ARRIVED는 LOGBOOK에 PR 없는 arrived 줄로 남아 TARGETS·CHECKRIDE·FUEL에 센다.
// 팀을 아는 방법: GitHub·Linear는 계정 하나라 작성자로 팀을 알 수 없다. 그 팀 세션 기록의 도구 호출(gh pr review, Linear 댓글)로 안다.
// 이 파일은 순수 계산. 읽기(GitHub·세션 기록)와 기록은 standfree-run.ts

const MIN = 60_000;
const DAY = 86_400_000;
// 세션의 gh 호출과 GitHub에 생긴 리뷰·댓글을 짝짓는 시각 폭: 호출 1분 전 ~ 10분 뒤(시계 차이, 긴 명령)
export const MATCH_BEFORE_MS = 60_000;
export const MATCH_AFTER_MS = 10 * MIN;
export const TIMELY_MS = DAY; // 일이 끝난 뒤 24시간 안에 ARRIVED
export const TIMELY_DAYS = 30;

export type StandFreeType = "CHECK" | "SURVEY";

// ARRIVED를 기다리는 STAND 없는 FLIGHT 하나
export interface StandFreeFlight {
  flight: string;
  type: StandFreeType;
  aircraft: string | null; // REGISTRATION(대문자). 모르면 후보를 내지 않는다
  departedAt: string;
  proposal: string | null; // D-xxxx(DISPATCH). 직접 배정이면 null(DEPARTURE LOG의 readback 줄)
  slug: string | null; // FLIGHT의 AIRPORT 저장소(owner/name). CHECK 대상 PR 번호를 이 저장소에서 찾는다
}

// GitHub에 실제로 있는 리뷰·댓글(읽기 전용 gh)
export interface GhWrite {
  kind: "review" | "comment";
  slug: string;
  number: number;
  url: string;
  author: string | null;
  at: string;
  state?: string; // 리뷰: APPROVED | CHANGES_REQUESTED | COMMENTED
}

// LOGBOOK의 머지된 PR(SURVEY 결과가 문서 PR일 때)
export interface MergedPr {
  key: string;
  flight: string | null;
  aircraft: string | null;
  arrivedAt: string;
  slug: string;
  number: number;
  url: string;
  title: string;
  docsOnly: boolean | null; // 바뀐 파일이 모두 문서인가. 못 읽었으면 null(후보로 쓰지 않는다)
}

export type SuggestionKind = "check-review" | "check-comment" | "survey-docs-pr" | "survey-comment" | "survey-linear-comment";
export interface ArrivalSuggestion {
  flight: string;
  type: StandFreeType;
  aircraft: string;
  proposal: string | null;
  departedAt: string;
  kind: SuggestionKind;
  evidence: { url: string; author: string | null; at: string }; // at: 일이 끝난 시각
  reason: string; // 왜 이 팀의 것으로 보나(확인할 때 읽을 한 줄)
  command: string; // OCC가 확인한 뒤 칠 명령
}

const hhmm = (iso: string) => iso.slice(11, 16);
const within = (event: string, at: string) => {
  const d = Date.parse(at) - Date.parse(event);
  return d >= -MATCH_BEFORE_MS && d <= MATCH_AFTER_MS;
};
export const commandOf = (f: Pick<StandFreeFlight, "proposal" | "flight" | "aircraft">, url: string) =>
  f.proposal ? `node ../controller/atcctl.mjs dispatch arrived ${f.proposal} -- '${url}'` : `node ../controller/atcctl.mjs dispatch arrived ${f.flight} --aircraft ${f.aircraft} -- '${url}'`;

// 그 팀 세션의 밖에 쓴 글(출발 뒤) — 계정이 하나라 이것이 팀을 아는 유일한 근거다
const postsAfter = (events: readonly TalkEvent[], departedAt: string) => events.filter((e) => e.dir === "post" && e.post && e.t >= departedAt);
const POST_TEXT: Record<string, string> = { review: "gh pr review", "pr-comment": "gh pr comment", "issue-comment": "gh issue comment" };

// 세션의 gh 호출 하나와 짝인 GitHub 글. 같은 PR·이슈, 호출 시각 근처, 출발 뒤. 리뷰 호출이면 리뷰를 먼저
function matchWrite(e: TalkEvent, slug: string | null, gh: readonly GhWrite[], departedAt: string): GhWrite | null {
  const p = e.post!;
  const repo = p.repo ?? slug;
  const cands = gh.filter((g) => g.number === p.number && (!repo || g.slug.toLowerCase() === repo.toLowerCase()) && g.at >= departedAt && within(e.t, g.at));
  const want = p.kind === "review" ? "review" : "comment";
  return cands.find((g) => g.kind === want) ?? cands[0] ?? null;
}

// CHECK: 검토 대상 PR(5.2 checkTargetOf로 찾은 것)에 그 팀이 출발 뒤 남긴 리뷰(상태 무관). PR 댓글로 남긴 리뷰도 받되 이유에 적는다
export function checkSuggestionOf(f: StandFreeFlight, targets: readonly { slug: string; number: number }[], events: readonly TalkEvent[], gh: readonly GhWrite[]): ArrivalSuggestion | null {
  if (!f.aircraft || f.type !== "CHECK" || !targets.length) return null;
  for (const e of postsAfter(events, f.departedAt)) {
    const p = e.post!;
    if (p.kind !== "review" && p.kind !== "pr-comment") continue;
    const target = targets.find((t) => t.number === p.number && (!p.repo || p.repo.toLowerCase() === t.slug.toLowerCase()));
    if (!target) continue;
    const g = matchWrite(e, target.slug, gh, f.departedAt);
    if (!g) continue;
    const review = g.kind === "review";
    return {
      flight: f.flight,
      type: f.type,
      aircraft: f.aircraft,
      proposal: f.proposal,
      departedAt: f.departedAt,
      kind: review ? "check-review" : "check-comment",
      evidence: { url: g.url, author: g.author, at: g.at },
      reason: `${f.aircraft} 세션이 ${hhmm(e.t)}에 ${POST_TEXT[p.kind]} ${p.number} → 검토 대상 PR #${p.number}에 ${review ? `리뷰(${g.state ?? "?"})` : "리뷰가 아닌 PR 댓글"} ${hhmm(g.at)}`,
      command: commandOf(f, g.url),
    };
  }
  return null;
}

// SURVEY: 그 팀이 출발 뒤 남긴 것 중 하나. 문서만 바꾼 머지 PR(FLIGHT key를 담은 것) → FLIGHT key를 단 GitHub 댓글 → 결과 링크를 단 Linear 댓글
export function surveySuggestionOf(f: StandFreeFlight, events: readonly TalkEvent[], gh: readonly GhWrite[], merged: readonly MergedPr[]): ArrivalSuggestion | null {
  if (!f.aircraft || f.type !== "SURVEY") return null;
  const base = { flight: f.flight, type: f.type, aircraft: f.aircraft, proposal: f.proposal, departedAt: f.departedAt };
  const names = (text: string) => new RegExp(`(^|[^A-Za-z0-9])${f.flight}(?!\\d)`, "i").test(text);
  const pr = merged
    .filter((m) => m.aircraft === f.aircraft && m.arrivedAt >= f.departedAt && m.docsOnly === true && (m.flight === f.flight || names(m.title)))
    .sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt))[0];
  if (pr)
    return {
      ...base,
      kind: "survey-docs-pr",
      evidence: { url: pr.url, author: f.aircraft, at: pr.arrivedAt },
      reason: `${f.aircraft}가 ${f.flight}를 담은 문서만의 PR #${pr.number}를 ${hhmm(pr.arrivedAt)}에 머지(LOGBOOK의 AIRCRAFT)`,
      command: commandOf(f, pr.url),
    };
  const posts = postsAfter(events, f.departedAt);
  for (const e of posts) {
    const p = e.post!;
    if (p.kind === "linear-comment" || !e.keys.includes(f.flight)) continue;
    const g = matchWrite(e, f.slug, gh, f.departedAt);
    if (!g) continue;
    return {
      ...base,
      kind: "survey-comment",
      evidence: { url: g.url, author: g.author, at: g.at },
      reason: `${f.aircraft} 세션이 ${hhmm(e.t)}에 ${POST_TEXT[p.kind] ?? "gh api"} ${p.number} — ${f.flight}를 적은 ${g.kind === "review" ? "리뷰" : "댓글"} ${hhmm(g.at)}`,
      command: commandOf(f, g.url),
    };
  }
  const lin = posts.find((e) => e.post!.kind === "linear-comment" && e.post!.issue === f.flight && e.post!.url);
  if (lin)
    return {
      ...base,
      kind: "survey-linear-comment",
      evidence: { url: lin.post!.url!, author: null, at: lin.t },
      reason: `${f.aircraft} 세션이 ${hhmm(lin.t)}에 ${f.flight} Linear 댓글로 결과 링크를 남김(세션 기록. Linear에서 댓글을 확인)`,
      command: commandOf(f, lin.post!.url!),
    };
  return null;
}

// 문서만 바꾼 PR인가(SURVEY 결과). 파일을 못 읽었으면 null
export const docsOnlyOf = (files: readonly string[] | null) =>
  files === null || !files.length ? null : files.every((f) => /(^|\/)docs?\//i.test(f) || /\.(md|mdx|markdown|txt|rst)$/i.test(f));

// ── DEPARTURE LOG: 직접 배정의 착수 ──
// DISPATCH(D-xxxx) 없이 받은 STAND 없는 FLIGHT는 팀의 READBACK이 착수다. (FLIGHT, AIRCRAFT)마다 한 줄,
// 그 짝이 이미 ARRIVED했으면 다음 READBACK이 새 착수다. D-xxxx로 보낸 짝은 DISPATCH가 착수를 적으므로 뺀다
export function readbackDeparturesOf(x: {
  events: ReadonlyMap<string, readonly TalkEvent[]>; // AIRCRAFT → 그 세션들의 사건
  standFree: (flight: string) => boolean;
  repoOf: (flight: string) => string | null; // FLIGHT의 AIRPORT 본 체크아웃
  existing: readonly Departure[];
  entries: readonly Pick<LogEntry, "flight" | "aircraft" | "standFree" | "departedAt">[];
  dispatched: ReadonlySet<string>; // "FLIGHT|AIRCRAFT"
  since: string;
}): Departure[] {
  const out: Departure[] = [];
  const lastDep = (flight: string, aircraft: string) =>
    [...x.existing, ...out].filter((d) => d.via === "readback" && d.flight === flight && d.aircraft === aircraft).reduce<string | null>((a, d) => (!a || d.t > a ? d.t : a), null);
  const arrivedAfter = (flight: string, aircraft: string, dep: string) => x.entries.some((e) => e.standFree && e.flight === flight && e.aircraft === aircraft && e.departedAt >= dep);
  for (const [aircraft, events] of x.events) {
    for (const e of events) {
      if (e.dir !== "out" || !e.readback || e.t < x.since) continue;
      for (const flight of e.keys) {
        if (!x.standFree(flight) || x.dispatched.has(`${flight}|${aircraft}`)) continue;
        const repo = x.repoOf(flight);
        if (!repo) continue;
        const last = lastDep(flight, aircraft);
        if (last && (e.t <= last || !arrivedAfter(flight, aircraft, last))) continue;
        out.push({ t: e.t, flight, aircraft, stand: null, branch: null, repo, via: "readback" });
      }
    }
  }
  return out;
}

// ── 확인: OCC의 ARRIVED → LOGBOOK 줄 ──
export interface StandFreeConfirm {
  flight: string;
  aircraft: string;
  cls: Pick<Classification, "type" | "wake" | "ratings" | "explicit"> | null;
  airport: string | null;
  departedAt: string;
  departedFrom: "readback" | "departure"; // D-xxxx의 READBACK, 직접 배정은 DEPARTURE LOG
  arrivedAt: string;
  note: string; // OCC가 적은 결과 링크나 한 줄
  proposal: string | null;
  suggestion: ArrivalSuggestion | null; // 확인 때 떠 있던 후보(같은 FLIGHT·AIRCRAFT)
}
export const standFreeKey = (flight: string, departedAt: string) => `standfree:${flight}@${departedAt}`;
const firstUrlIn = (text: string) => /https?:\/\/[^\s'"`)<>\]]+/.exec(text)?.[0]?.replace(/[.,;:]+$/, "") ?? null;

export function standFreeLine(c: StandFreeConfirm, t: string): Extract<LogLine, { op: "arrived" }> {
  const s = c.suggestion && c.suggestion.flight === c.flight && c.suggestion.aircraft === c.aircraft ? c.suggestion : null;
  const standFree: StandFreeArrival = {
    arrivedVia: s ? "confirmed-suggestion" : "report",
    evidence: { url: firstUrlIn(c.note) ?? s?.evidence.url ?? null, note: c.note },
    workDoneAt: s?.evidence.at ?? null,
    proposal: c.proposal,
  };
  const done = Date.parse(standFree.workDoneAt ?? c.arrivedAt);
  return {
    op: "arrived",
    t,
    key: standFreeKey(c.flight, c.departedAt),
    aircraft: c.aircraft,
    flight: c.flight,
    class: c.cls,
    airport: c.airport,
    stands: [],
    departedAt: c.departedAt,
    departedFrom: c.departedFrom,
    arrivedAt: c.arrivedAt,
    // 팀 소요 시간: 착수 → 일이 끝난 시각(후보의 증거, 없으면 확인 시각)
    blockMin: Math.max(0, Math.round((done - Date.parse(c.departedAt)) / MIN)),
    landingWaitMin: null,
    codexFindings: 0,
    changesRequested: false,
    reverted: false,
    los: 0,
    standFree,
  };
}

// 직접 배정(D-xxxx 없음)의 ARRIVED를 받을 수 있나. 착수는 DEPARTURE LOG의 readback 줄
export class StandFreeError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export function directDepartureOf(x: {
  flight: string;
  aircraft: string;
  standFree: boolean | null; // 티켓이 STAND 없는 FLIGHT인가. 모르면 null
  inFlight: readonly { id: string; flight: string }[]; // 떠 있는 D-xxxx
  departures: readonly Departure[];
  entries: readonly Pick<LogEntry, "key">[];
}): Departure {
  if (x.standFree === null) throw new StandFreeError(`${x.flight}를 모름 — Linear에서 읽힌 FLIGHT만`, 404);
  if (!x.standFree) throw new StandFreeError(`${x.flight}는 STAND가 있는 FLIGHT — LOGBOOK(PR 머지)이 ARRIVED`, 409);
  const d = x.inFlight.find((p) => p.flight === x.flight);
  if (d) throw new StandFreeError(`${x.flight}는 ${d.id}로 떠 있음 — dispatch arrived ${d.id}`, 409);
  const dep = x.departures.filter((l) => l.via === "readback" && l.flight === x.flight && l.aircraft === x.aircraft).sort((a, b) => a.t.localeCompare(b.t)).at(-1);
  if (!dep) throw new StandFreeError(`DEPARTURE LOG에 ${x.aircraft}의 ${x.flight} 착수(READBACK)가 없음`, 409);
  if (x.entries.some((e) => e.key === standFreeKey(x.flight, dep.t))) throw new StandFreeError(`${x.flight}는 이 착수(${dep.t})로 이미 ARRIVED`, 409);
  return dep;
}

// ── 지표: 일이 끝난 뒤 24시간 안에 ARRIVED한 비율(gate3.standFree 옆) ──
// 일이 끝난 시각 = 후보의 증거 시각(확인된 후보), 보고만이면 ARRIVED 시각(보고가 곧 신호). 아직 ARRIVED 안 한 후보는
// 24시간이 지났으면 놓친 것으로, 안 지났으면 세지 않는다
export function timelinessOf(entries: readonly Pick<LogEntry, "standFree" | "arrivedAt">[], pending: readonly Pick<ArrivalSuggestion, "evidence">[], now: number, days = TIMELY_DAYS) {
  const since = now - days * DAY;
  let within = 0;
  let total = 0;
  for (const e of entries) {
    if (!e.standFree || Date.parse(e.arrivedAt) < since) continue;
    total++;
    if (Date.parse(e.arrivedAt) - Date.parse(e.standFree.workDoneAt ?? e.arrivedAt) <= TIMELY_MS) within++;
  }
  const late = pending.filter((s) => now - Date.parse(s.evidence.at) > TIMELY_MS && Date.parse(s.evidence.at) >= since).length;
  total += late;
  return { within, total, rate: total ? within / total : null, pendingLate: late, days };
}

import type { DutyConfig } from "./duty-config.ts";
import type { ReleaseLine } from "./release.ts";
import { NOT_RELEASED_WHY, STALE_RELEASE_WHY } from "./release.ts";
import { similarTickets } from "./schedule.ts";
import type { Ticket } from "./model.ts";
import { createHash } from "node:crypto";

// DUTY REVIEW(ATC-396, docs/duty.md): 서버가 SUPERVISOR의 글 없이 DUTY 턴을 시작해 운영을 점검하게 한다.
// 이 파일은 순수 조각이다: 언제 돌지(트리거), DUTY에게 줄 글, 하루 단위 세기. 턴을 시작하고 파일을 쓰는 것은 duty-review-run.ts.
// 제안은 Backlog까지만(autonomy.md 원칙 10): Todo로 올려 쏘는 것은 SUPERVISOR가 RELEASE 화면에서 한다.

export type ReviewTrigger = "schedule" | "idle" | "leak" | "empty";

// 점검 한 번이 보는 신호. 모두 서버 안에서 같은 핸들러로 읽은 값이다
export interface ReviewSignals {
  idleAircraft: string[]; // 배정 받을 수 있는 놀고 있는 AIRCRAFT(registration)
  waitingFlights: string[]; // 일감이 있는데 아직 배정되지 않은 Todo FLIGHT(발권 대기·우선순위 없음·받을 곳 없음·배정 후보)
  leakMin: number | null; // 가장 오래 열려 있는 leak의 분(없으면 null)
  leakTitle: string | null;
}

const KEY = /^[A-Z][A-Z0-9]*-\d+$/;

// 점검 트리거의 leak 신호에서 뺄 큐 종류(ATC-401). BACKLOG는 DUTY의 제안이 SUPERVISOR의 발권을 기다리는 것이다: 그 기다림이 점검을 부르면
// 점검이 제안을 더 올리고 제안이 기다림을 더 만드는 고리가 된다. 제안을 쏘는 것은 SUPERVISOR의 화살(원칙 10)이다
export const REVIEW_LEAK_SKIP_KINDS: ReadonlySet<string> = new Set(["BACKLOG"]);
// id(`kind|key`)는 사실 지문(ATC-566)이 쓴다: 제목·시각이 아니라 어느 leak인가
export const reviewLeaksOf = (open: readonly { kind: string; title: string; since: string; id?: string }[]): { title: string; sinceMs: number; id: string }[] =>
  open
    .filter((o) => !REVIEW_LEAK_SKIP_KINDS.has(o.kind))
    .map((o) => ({ title: o.title, sinceMs: Date.parse(o.since), id: o.id ?? `${o.kind}|${o.title}` }))
    .filter((x) => Number.isFinite(x.sinceMs));
const STUCK_WHY = [NOT_RELEASED_WHY, STALE_RELEASE_WHY, "우선순위"]; // 배정을 못 받는 이유 가운데 "일감은 있다"는 뜻인 것

interface DispatchLike {
  plan?: {
    aircraft?: { registration?: unknown; available?: unknown }[];
    assign?: { flight?: unknown }[];
    unserved?: { flight?: unknown }[];
    excluded?: { flight?: unknown; reason?: unknown }[];
  };
}

// GET /api/dispatch/brief의 plan에서 신호를 뽑는다. 모르는 모양이면 빈 신호
export function signalsOf(dispatch: unknown, openLeaks: readonly { title: string; sinceMs: number }[], now: number): ReviewSignals {
  const p = (dispatch as DispatchLike | null)?.plan ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const idleAircraft = (p.aircraft ?? []).filter((a) => a.available === true).map((a) => str(a.registration)).filter(Boolean);
  const waiting = new Set<string>();
  for (const a of p.assign ?? []) if (KEY.test(str(a.flight))) waiting.add(str(a.flight));
  for (const u of p.unserved ?? []) if (KEY.test(str(u.flight))) waiting.add(str(u.flight));
  for (const e of p.excluded ?? []) if (KEY.test(str(e.flight)) && STUCK_WHY.some((w) => str(e.reason).includes(w))) waiting.add(str(e.flight));
  const oldest = [...openLeaks].sort((a, b) => a.sinceMs - b.sinceMs)[0];
  return {
    idleAircraft,
    waitingFlights: [...waiting].sort(),
    leakMin: oldest ? Math.max(0, Math.floor((now - oldest.sinceMs) / 60_000)) : null,
    leakTitle: oldest?.title ?? null,
  };
}

export type ReviewConfig = Pick<DutyConfig, "review" | "reviewEveryMin" | "reviewIdleMin" | "reviewLeakMin" | "reviewGapMin" | "reviewEmpty" | "reviewEmptyMin" | "reviewEmptyGapMin">;

export interface ReviewDecision {
  run: boolean;
  trigger?: ReviewTrigger;
  detail?: string;
  idleSince: number | null; // 호출한 쪽이 다음 주기에 다시 넣는다(놀고-일감 상태가 이어진 시작 시각)
  emptySince: number | null; // 같은 꼴(ATC-470): 받을 수 있는 AIRCRAFT가 있고 기다리는 FLIGHT가 없는 상태가 이어진 시작 시각
  key?: string; // idle·leak 트리거가 본 것의 서명(점검 줄에 남는다). 같은 서명은 reviewEveryMin 안에 다시 점검하지 않는다
  why?: string; // run이 false인 이유(시험·화면용)
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
export const REVIEW_DAILY_MAX = 12; // 하루 점검 상한(FUEL을 쓰는 서버 시작 턴의 마지막 안전판)

// 지난 점검의 기억(duty-reviews.jsonl의 review 줄과 skip 줄). key는 그때 트리거가 본 것의 서명.
// skipped(ATC-566): 사실이 같아 건너뛴 점검. 트리거·간격 규칙에는 점검처럼 들어가고(오늘 규칙이 점검했을 때를 그대로 센다), 하루 상한에는 들지 않는다
export interface ReviewMemo {
  at: number;
  trigger: ReviewTrigger;
  key: string;
  skipped?: boolean;
}

// 트리거가 본 것의 서명: idle은 놀고 있는 AIRCRAFT와 기다리는 FLIGHT 집합, leak은 그 leak의 제목. 바뀌지 않는 상황이 간격마다 되풀이 점검을 만들지 않게 한다
export const reviewKeyOf = (trigger: "idle" | "leak", s: ReviewSignals): string => (trigger === "idle" ? `${s.idleAircraft.join(",")}|${s.waitingFlights.join(",")}` : (s.leakTitle ?? ""));

// 지금 점검을 시작할까. lastAt은 마지막 점검 시각(점검한 적이 없으면 0). 서버가 막 떴을 때는 호출한 쪽의 준비 시간이 막는다.
// 같은 트리거가 같은 서명을 보고 reviewEveryMin 안에 이미 점검했으면 다시 점검하지 않는다(바뀌지 않는 leak·놀고-일감이 30분마다 점검을 부르지 않게).
// fuelHold: DUTY ACCOUNT의 FUEL이 HOLD 임계값 이상이면 서버가 시작하는 턴을 하지 않는다(SUPERVISOR의 글에는 그대로 답한다)
export function decideReview(x: { now: number; lastAt: number; busy: boolean; cfg: ReviewConfig; signals: ReviewSignals; idleSince: number | null; emptySince?: number | null; history?: readonly ReviewMemo[]; fuelHold?: boolean }): ReviewDecision {
  const { now, cfg, signals } = x;
  const history = x.history ?? [];
  // 놀고-일감이 이어진 시간은 점검을 못 하는 때에도 센다
  const stuck = signals.idleAircraft.length > 0 && signals.waitingFlights.length > 0;
  const idleSince = stuck ? (x.idleSince ?? now) : null;
  // empty(ATC-470): idle과 배타다(idle은 기다리는 FLIGHT가 있을 때, empty는 없을 때)
  const empty = signals.idleAircraft.length > 0 && signals.waitingFlights.length === 0;
  const emptySince = empty ? (x.emptySince ?? now) : null;
  const out = (r: Omit<ReviewDecision, "idleSince" | "emptySince">): ReviewDecision => ({ ...r, idleSince, emptySince });
  if (!cfg.review) return out({ run: false, why: "off" });
  if (x.busy) return out({ run: false, why: "busy" });
  if (x.fuelHold) return out({ run: false, why: "fuel" });
  if (now - x.lastAt < cfg.reviewGapMin * MIN) return out({ run: false, why: "gap" });
  if (history.filter((h) => !h.skipped && now - h.at < DAY).length >= REVIEW_DAILY_MAX) return out({ run: false, why: "cap" });
  const repeated = (trigger: ReviewTrigger, key: string) => history.some((h) => h.trigger === trigger && h.key === key && now - h.at < cfg.reviewEveryMin * MIN);
  if (idleSince !== null && now - idleSince >= cfg.reviewIdleMin * MIN) {
    const key = reviewKeyOf("idle", signals);
    if (!repeated("idle", key)) {
      const m = Math.floor((now - idleSince) / MIN);
      return { run: true, trigger: "idle", key, detail: `${signals.idleAircraft.join(", ")} idle for ${m} min while ${signals.waitingFlights.slice(0, 6).join(", ")} wait${signals.waitingFlights.length > 6 ? ` (+${signals.waitingFlights.length - 6})` : ""}`, idleSince: null, emptySince };
    }
  }
  // empty: reviewEmptyGapMin 안에 empty 점검이 있었으면 서명과 관계없이 다시 하지 않는다
  if (cfg.reviewEmpty && emptySince !== null && now - emptySince >= cfg.reviewEmptyMin * MIN && !history.some((h) => h.trigger === "empty" && now - h.at < cfg.reviewEmptyGapMin * MIN)) {
    const m = Math.floor((now - emptySince) / MIN);
    return { run: true, trigger: "empty", detail: `${signals.idleAircraft.join(", ")} available for ${m} min with no Todo FLIGHT waiting`, idleSince, emptySince: null };
  }
  if (signals.leakMin !== null && signals.leakMin >= cfg.reviewLeakMin) {
    const key = reviewKeyOf("leak", signals);
    if (!repeated("leak", key)) return { run: true, trigger: "leak", key, detail: `${signals.leakTitle ?? "a human step"} held ${signals.leakMin} min`, idleSince, emptySince };
  }
  if (now - x.lastAt >= cfg.reviewEveryMin * MIN) return { run: true, trigger: "schedule", detail: `last review ${Math.floor((now - x.lastAt) / MIN)} min ago`, idleSince, emptySince };
  return out({ run: false, why: "quiet" });
}

// ── DUTY에게 줄 글(영어: 세션이 읽는 글, ATC-126). SUPERVISOR에게 하는 요약만 한국어로 시킨다 ──
export interface ReviewPromptInput {
  id: string;
  trigger: ReviewTrigger;
  detail: string;
  signals: ReviewSignals;
  linear: boolean; // duty.json l1: 꺼져 있으면 이슈를 쓸 수 없다
  landing: string[]; // 착륙 대기열 줄(PR, 누가 착륙시키나, 막힘)
  alerts: string[];
  effects?: string[]; // 열린 EFFECT CHECK 평결(not improved·worse): 배포한 FLIGHT가 목표를 못 맞췄다(ATC-402)
  openIssues: { key: string; title: string }[]; // 이미 열려 있는 일(중복 제안을 막으려고 준다)
  readyBacklog?: { key: string; title: string; priority: number | null }[]; // empty 트리거(ATC-470): 지금 발권할 수 있는 READY Backlog 줄(releaseReadyNow)
  ideas?: { number: number; title: string }[] | null; // empty 트리거: 열린 idea 이슈. null이면 읽지 못했다(GitHub 꺼짐·오류)
}

export const READY_LIST_MAX = 30;
export const IDEAS_LIST_MAX = 30;

// empty 트리거 전용 단계(ATC-470). 순서가 곧 우선순위다: READY → 설계 문서 → 작은 idea. 2·3단계가 합쳐 PROPOSALS_MAX를 넘지 않고 상한이 차는 단계에서 멈춘다
export function emptySectionOf(x: ReviewPromptInput): string[] {
  const ready = x.readyBacklog ?? [];
  const ideas = x.ideas ?? null;
  const cap = x.linear
    ? `Steps 2 and 3 together create at most ${PROPOSALS_MAX} issues in this review (Backlog only, the work-order format, Evidence in Context). Stop at the first step that fills the cap.`
    : "Linear writes are off (duty.json l1): do not create issues in steps 2 and 3; list what you would file, with evidence.";
  return [
    "EMPTY FLEET: an AIRCRAFT can take work and no Todo FLIGHT is waiting, so the fleet is idle. Line up the next work, in this order:",
    `STEP 1 — READY Backlog (server list below, ${ready.length} row${ready.length === 1 ? "" : "s"}). Say in your Korean summary which of these are worth firing now and why, naming each by its key (ATC-n). You cannot fire them: the SUPERVISOR does, on the RELEASE screen. If none is worth firing, say so in one line.`,
    ready.length ? ready.slice(0, READY_LIST_MAX).map((r) => `- ${r.key} P${r.priority ?? "-"} ${r.title.slice(0, 90)}`).join("\n") : "- none",
    "STEP 2 — Design documents. Read the Implementation order tables in ../docs/*.md. Find steps that are not marked done and have no ATC issue yet (check the open issues list below and search the issue titles), and file each as a Backlog issue.",
    "STEP 3 — Small ideas. From the open idea issues below, pick ones that a single FLIGHT can finish and file each as a Backlog issue (Context names the idea number). Skip ideas that need a SUPERVISOR decision or a design first.",
    ideas === null ? "open idea issues: unavailable (GitHub is off or did not answer); skip step 3." : [`open idea issues (${Math.min(ideas.length, IDEAS_LIST_MAX)} of ${ideas.length}):`, ...(ideas.length ? ideas.slice(0, IDEAS_LIST_MAX).map((i) => `- #${i.number} ${i.title.slice(0, 90)}`) : ["- none"])].join("\n"),
    cap,
    "",
  ];
}

export const OPEN_ISSUES_MAX = 120;
export const PROPOSALS_MAX = 3;

export function reviewPromptOf(x: ReviewPromptInput): string {
  const s = x.signals;
  const list = (xs: readonly string[], none = "none") => (xs.length ? xs.map((l) => `- ${l}`).join("\n") : `- ${none}`);
  return [
    `[ATC DUTY REVIEW ${x.id}] trigger: ${x.trigger} — ${x.detail}`,
    "The server started this turn. The SUPERVISOR did not write to you. Review the operation the way a person would, find the bottleneck, and propose the fixes. The SUPERVISOR only chooses which proposals to fire, on the RELEASE screen.",
    "",
    "READ (read-only commands, plus the brief above):",
    "- node ../controller/atcctl.mjs landing queue — the landing queue: escalations, STAND holders, blocks.",
    "- node ../controller/atcctl.mjs dispatch brief — the DISPATCH plan: plan.aircraft, plan.excluded, plan.unserved.",
    "",
    "FACTS from the server:",
    `idle AIRCRAFT: ${s.idleAircraft.length ? s.idleAircraft.join(", ") : "none"}`,
    `waiting Todo FLIGHTs: ${s.waitingFlights.length ? s.waitingFlights.join(", ") : "none"}`,
    `longest open leak: ${s.leakMin === null ? "none" : `${s.leakTitle ?? "?"} for ${s.leakMin} min`}`,
    "landing queue:",
    list(x.landing),
    "live alerts:",
    list(x.alerts),
    "open EFFECT CHECK verdicts (a deployed FLIGHT that did not move what its ## Measure named; the SUPERVISOR has not marked them wrong):",
    list(x.effects ?? []),
    "",
    ...(x.trigger === "empty" ? emptySectionOf(x) : []),
    "DO:",
    "1. Name the bottleneck, if there is one, and its evidence (PR numbers, FLIGHT keys, minutes). Use only what the commands and the facts show.",
    "2. Reply with a short summary in Korean, at most 8 lines. If nothing needs doing, say that in one line.",
    x.linear
      ? `3. For each fix worth doing, create one ATC issue with node ../controller/atcctl.mjs duty linear create --state Backlog --priority <1-4> --title '<English>' [--blocked-by ATC-n] --body-file <path>. Do not put the body on the command line: a multi-line body with ## headings is blocked by Claude Code's Bash check. Write it with the Write tool to .issue-bodies/<slug>.md inside your DUTY STAND (.claude/worktrees/duty-<name>/; make one once with node ../controller/atcctl.mjs duty stand <name> if you have none) and pass that path to --body-file; atcctl refuses a file outside the STAND and deletes the file after it succeeds. At most ${PROPOSALS_MAX}. The body is the work-order format in ../docs/rules.ko.md (Goal, Done when, K effects, Measure, Context, Release; Measure is \`metric: <source>:<name>\`, \`direction: down|up\`, \`window: <n>d\` for something atc already records, or \`None\`) and its Context has an Evidence section: what you saw, with numbers and keys. Use --blocked-by when the fix must wait for a FLIGHT that is already accepted.`
      : "3. Linear writes are off (duty.json l1). Do not create issues. List the proposals in your summary, each with its evidence.",
    "4. Never set Todo. The server refuses it in this turn. A proposal stays in Backlog. The RELEASE screen lists it (once no open issue blocks it) with your name, the time, its priority and its K effects, and the SUPERVISOR fires it with one click or discards it. A proposal with no priority cannot be fired, so always set --priority.",
    "5. Do not propose what an open issue already covers (the list below). The server refuses a near-duplicate title and tells you the key; comment on that issue instead if you have new evidence.",
    "6. If an EFFECT CHECK verdict above says a FLIGHT did not improve or made it worse, you may propose one follow-up for it (the same rules: Backlog, evidence, no duplicate). The server adds no trigger for this: it is one more input to this review.",
    "7. Do not change the DUTY chat topic, do not send messages to other sessions, do not approve or decide anything.",
    "",
    `open ATC issues (${Math.min(x.openIssues.length, OPEN_ISSUES_MAX)} of ${x.openIssues.length}):`,
    x.openIssues.slice(0, OPEN_ISSUES_MAX).map((i) => `${i.key} ${i.title.slice(0, 90)}`).join("\n") || "none",
  ].join("\n");
}

// 열린 이슈 가운데 이 제목과 비슷한 것의 key(없으면 null). schedule NEW의 중복 검색과 같은 규칙
export function openSimilarKey(title: string, tickets: readonly Ticket[], now: number): string | null {
  const open = tickets.filter((t) => t.stateType !== "completed" && t.stateType !== "canceled");
  return similarTickets(title, open, now)[0]?.key ?? null;
}

// ── 기록(duty-reviews.jsonl, 추가만)과 하루 세기 ──
export type ReviewLine =
  // fp·facts(ATC-566): 이 점검이 실은 사실의 지문과 목록. 옛 줄에는 없다(없으면 건너뛰지 않는다)
  | { v: 1; ev: "review"; id: string; at: string; trigger: ReviewTrigger; detail: string; key?: string; fp?: string; facts?: string[] }
  | { v: 1; ev: "proposal"; at: string; review: string; key: string; title: string }
  // REVIEW 턴이 이미 있는 이슈에 쓴 것(ATC-566): 댓글이나 고침. 제안과 같이 "그 점검이 무언가 냈다"로 센다
  | { v: 1; ev: "write"; at: string; review: string; key: string; action: "comment" | "update" }
  // 건너뛴 점검(ATC-566): 트리거가 섰는데 사실이 지난 점검(same)과 같고 그 점검이 아무것도 내지 않았다
  | { v: 1; ev: "skip"; at: string; trigger: ReviewTrigger; detail: string; key?: string; same: string; fp: string; facts: string[]; why: string }
  // empty 점검의 턴이 끝났을 때 한 줄(ATC-470): named = DUTY의 답이 이름 붙인 READY Backlog 수
  | { v: 1; ev: "outcome"; at: string; review: string; named: number };

export const nextReviewId = (lines: readonly ReviewLine[]): string => {
  const n = lines.reduce((m, l) => (l.ev === "review" ? Math.max(m, Number(l.id.slice(2)) || 0) : m), 0);
  return `R-${String(n + 1).padStart(4, "0")}`;
};

export interface ReviewDay {
  day: string; // UTC 날짜
  reviews: number;
  proposals: number; // 그날 만든 제안
  fired: number; // 그 제안 가운데 SUPERVISOR가 발권한 것(발권 기록이 제안 뒤에 있다)
  discarded: number; // 그 제안 가운데 취소된 것(Canceled·Duplicate)
}

export function reviewDaysOf(lines: readonly ReviewLine[], releases: readonly ReleaseLine[], tickets: readonly Pick<Ticket, "key" | "stateType">[], now: number, days = 14): ReviewDay[] {
  const dayOf = (iso: string) => iso.slice(0, 10);
  const first = dayOf(new Date(now - (days - 1) * 86_400_000).toISOString());
  const byDay = new Map<string, ReviewDay>();
  const row = (day: string) => {
    let r = byDay.get(day);
    if (!r) byDay.set(day, (r = { day, reviews: 0, proposals: 0, fired: 0, discarded: 0 }));
    return r;
  };
  const releasedAt = new Map<string, string>();
  for (const l of releases) if (l.op === "release" && !releasedAt.has(l.flight)) releasedAt.set(l.flight, l.at);
  const stateOf = new Map(tickets.map((t) => [t.key, t.stateType]));
  for (const l of lines) {
    const day = dayOf(l.at);
    if (day < first) continue;
    if (l.ev === "review") row(day).reviews++;
    else if (l.ev === "proposal") {
      const r = row(day);
      r.proposals++;
      const rel = releasedAt.get(l.key);
      if (rel && rel >= l.at) r.fired++;
      else if (stateOf.get(l.key) === "canceled") r.discarded++;
    }
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

// ── empty 오발 세기(ATC-470) ──
export interface EmptyMisfires {
  reviews: number; // empty 점검 수
  wasted: number; // 끝났는데 READY Backlog를 하나도 이름 붙이지 않고 이슈도 올리지 않은 점검(헛턴)
  discarded: number; // 올린 이슈를 SUPERVISOR가 버린(Canceled·Duplicate) 점검
}

export function emptyMisfiresOf(lines: readonly ReviewLine[], tickets: readonly Pick<Ticket, "key" | "stateType">[]): EmptyMisfires {
  const stateOf = new Map(tickets.map((t) => [t.key, t.stateType]));
  const empties = lines.flatMap((l) => (l.ev === "review" && l.trigger === "empty" ? [l.id] : []));
  const out: EmptyMisfires = { reviews: empties.length, wasted: 0, discarded: 0 };
  for (const id of empties) {
    const filed = lines.filter((l) => l.ev === "proposal" && l.review === id);
    const outcome = lines.find((l) => l.ev === "outcome" && l.review === id);
    if (outcome && outcome.ev === "outcome" && outcome.named === 0 && filed.length === 0) out.wasted++; // 결과 줄이 없으면(서버가 중간에 내려감) 모르니 세지 않는다
    if (filed.some((l) => l.ev === "proposal" && stateOf.get(l.key) === "canceled")) out.discarded++;
  }
  return out;
}

// DUTY의 답이 이름 붙인 READY 키의 수(대소문자 무시, 단어 경계)
export const namedReadyOf = (text: string, ready: readonly { key: string }[]): number => ready.filter((r) => new RegExp(`\\b${r.key}\\b`, "i").test(text)).length;

// ── 같은 사실이면 건너뛰기(ATC-566) ──
// 점검 턴이 실을 사실의 지문. 시간만으로 자라는 값(기다린 분, leak이 열린 분, 컨텍스트 크기, EFFECT CHECK의 전후 수)은 넣지 않는다(docs/squelch.md 원칙 4).
// 들어가는 것: 놀고 있는 AIRCRAFT·기다리는 FLIGHT(집합), 열린 leak의 id(kind|key), 착륙 대기열 줄(PR·key·상태·landBy·막힘 — 분이 없다),
// WARNING·CAUTION 알림의 key(첫 마디가 종류), 열린 EFFECT CHECK 평결(FLIGHT와 평결만)
export interface ReviewFactsInput {
  signals: Pick<ReviewSignals, "idleAircraft" | "waitingFlights">;
  leakIds: readonly string[];
  landing: readonly string[];
  alerts: readonly { level: string; key: string }[];
  effects: readonly string[]; // effectLine: `ATC-1 not improved: metric down 7d, 10 → 9`. 콜론 앞만 쓴다
}
export interface ReviewFacts {
  fp: string;
  facts: string[];
}
export const FACTS_KEEP_MAX = 200; // 줄에 남기는 사실 수의 위(지문은 전부로 만든다)

export function reviewFactsOf(x: ReviewFactsInput): ReviewFacts {
  const facts = [
    ...x.signals.idleAircraft.map((r) => `idle:${r}`),
    ...x.signals.waitingFlights.map((k) => `wait:${k}`),
    ...x.leakIds.map((id) => `leak:${id}`),
    ...x.landing.map((l) => `land:${l}`),
    ...x.alerts.filter((a) => a.level === "warning" || a.level === "caution").map((a) => `alert:${a.key}`),
    ...x.effects.map((e) => `effect:${e.split(":")[0]!.trim()}`),
  ];
  const sorted = [...new Set(facts)].sort();
  return { fp: createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 16), facts: sorted };
}

// 하루 한 번(HEARTBEAT): 이 시각(UTC) 뒤 처음 서는 점검은 사실이 같아도 건너뛰지 않는다. 00:00Z = 09:00 KST(SUPERVISOR의 하루 시작에 새 요약이 기다린다)이고
// 설정 창의 하루 세기(reviewDaysOf)가 쓰는 UTC 날짜 경계와 같다
export const HEARTBEAT_HOUR_UTC = 0;
export const heartbeatBoundary = (now: number, hour = HEARTBEAT_HOUR_UTC): number => {
  const d = new Date(now);
  const b = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour);
  return b <= now ? b : b - DAY;
};
export const heartbeatDue = (lastRunAt: number, now: number, hour = HEARTBEAT_HOUR_UTC): boolean => lastRunAt < heartbeatBoundary(now, hour);

// 마지막으로 실제로 돈 점검과 그 점검이 낸 것(제안·댓글·고침)
export interface LastRun {
  id: string;
  at: number;
  fp: string | null;
  filed: number;
}
export function lastRunOf(lines: readonly ReviewLine[]): LastRun | null {
  const last = [...lines].reverse().find((l) => l.ev === "review");
  if (!last || last.ev !== "review") return null;
  const filed = lines.filter((l) => (l.ev === "proposal" || l.ev === "write") && l.review === last.id).length;
  return { id: last.id, at: Date.parse(last.at), fp: last.fp ?? null, filed };
}

export type SkipVerdict = { skip: true; why: string } | { skip: false; why: "off" | "first" | "no-fp" | "filed" | "changed" | "heartbeat" };
// 건너뛸까: 스위치가 켜졌고, 지난 점검의 지문이 같고, 그 점검이 아무것도 내지 않았고, 하루 한 번(HEARTBEAT)이 아직 오지 않았으면
export function skipVerdictOf(x: { on: boolean; fp: string; last: LastRun | null; now: number }): SkipVerdict {
  if (!x.on) return { skip: false, why: "off" };
  if (!x.last) return { skip: false, why: "first" };
  if (!x.last.fp) return { skip: false, why: "no-fp" };
  if (x.last.filed > 0) return { skip: false, why: "filed" };
  if (x.last.fp !== x.fp) return { skip: false, why: "changed" };
  if (heartbeatDue(x.last.at, x.now)) return { skip: false, why: "heartbeat" };
  return { skip: true, why: `same facts as ${x.last.id}, which filed no issue and no comment` };
}

// 마지막으로 실제 돈 점검 뒤의 가장 최근 skip 줄(밀린 점검). 사실이 바뀌면 이 점검을 곧바로 돌린다
export function pendingSkipOf(lines: readonly ReviewLine[]): Extract<ReviewLine, { ev: "skip" }> | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!;
    if (l.ev === "review") return null;
    if (l.ev === "skip") return l;
  }
  return null;
}

// 트리거·간격 규칙에 넣을 기억: 돈 점검과 건너뛴 점검
export const reviewMemosOf = (lines: readonly ReviewLine[]): ReviewMemo[] =>
  lines.flatMap((l) => (l.ev === "review" ? [{ at: Date.parse(l.at), trigger: l.trigger, key: l.key ?? "" }] : l.ev === "skip" ? [{ at: Date.parse(l.at), trigger: l.trigger, key: l.key ?? "", skipped: true }] : [])).filter((m) => Number.isFinite(m.at));

// 오발: 건너뛴 점검 S 뒤 2시간 안의 다음 점검 R이 이슈를 제안했고, 그 제안을 S의 사실도 받쳤다.
// "S의 사실도 받쳤다" = R의 사실에 S에 없던 것이 하나도 없다(새로 나타난 것 없이 제안이 나왔다), 또는 R의 제안 제목이 S의 사실에 있던 키(ATC-1·VOC-2·PR #3·TEAM_X)를 부른다.
// 넉넉히 센다: 오발을 놓치는 것보다 더 세는 쪽이 안전하다
export const MISFIRE_WINDOW_MS = 2 * 60 * MIN;
const FACT_KEY = /[A-Z][A-Z0-9]*-\d+|#\d+|TEAM_[A-Z0-9]+/g;
export const factKeysOf = (facts: readonly string[]): Set<string> => new Set(facts.flatMap((f) => f.match(FACT_KEY) ?? []));

export interface SkipCounts {
  skipped: number;
  misfires: number;
  misfireOf: string[]; // 오발로 센 다음 점검의 id
}
export function skipCountsOf(lines: readonly ReviewLine[]): SkipCounts {
  const out: SkipCounts = { skipped: 0, misfires: 0, misfireOf: [] };
  lines.forEach((s, i) => {
    if (s.ev !== "skip") return;
    out.skipped++;
    const next = lines.slice(i + 1).find((l) => l.ev === "review");
    if (!next || next.ev !== "review" || Date.parse(next.at) - Date.parse(s.at) > MISFIRE_WINDOW_MS) return;
    const filed = lines.filter((l) => l.ev === "proposal" && l.review === next.id);
    if (!filed.length) return;
    const had = new Set(s.facts);
    const nothingNew = next.fp === s.fp || (next.facts !== undefined && next.facts.every((f) => had.has(f)));
    const keys = factKeysOf(s.facts);
    const named = filed.some((p) => p.ev === "proposal" && (p.title.match(FACT_KEY) ?? []).some((k) => keys.has(k)));
    if (nothingNew || named) {
      out.misfires++;
      if (!out.misfireOf.includes(next.id)) out.misfireOf.push(next.id);
    }
  });
  return out;
}

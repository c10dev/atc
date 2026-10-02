import type { DutyConfig } from "./duty-config.ts";
import type { ReleaseLine } from "./release.ts";
import { NOT_RELEASED_WHY, STALE_RELEASE_WHY } from "./release.ts";
import { similarTickets } from "./schedule.ts";
import type { Ticket } from "./model.ts";

// DUTY REVIEW(ATC-396, docs/duty.md): 서버가 SUPERVISOR의 글 없이 DUTY 턴을 시작해 운영을 점검하게 한다.
// 이 파일은 순수 조각이다: 언제 돌지(트리거), DUTY에게 줄 글, 하루 단위 세기. 턴을 시작하고 파일을 쓰는 것은 duty-review-run.ts.
// 제안은 Backlog까지만(autonomy.md 원칙 10): Todo로 올려 쏘는 것은 SUPERVISOR가 RELEASE 화면에서 한다.

export type ReviewTrigger = "schedule" | "idle" | "leak";

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
export const reviewLeaksOf = (open: readonly { kind: string; title: string; since: string }[]): { title: string; sinceMs: number }[] =>
  open.filter((o) => !REVIEW_LEAK_SKIP_KINDS.has(o.kind)).map((o) => ({ title: o.title, sinceMs: Date.parse(o.since) })).filter((x) => Number.isFinite(x.sinceMs));
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

export type ReviewConfig = Pick<DutyConfig, "review" | "reviewEveryMin" | "reviewIdleMin" | "reviewLeakMin" | "reviewGapMin">;

export interface ReviewDecision {
  run: boolean;
  trigger?: ReviewTrigger;
  detail?: string;
  idleSince: number | null; // 호출한 쪽이 다음 주기에 다시 넣는다(놀고-일감 상태가 이어진 시작 시각)
  key?: string; // idle·leak 트리거가 본 것의 서명(점검 줄에 남는다). 같은 서명은 reviewEveryMin 안에 다시 점검하지 않는다
  why?: string; // run이 false인 이유(시험·화면용)
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
export const REVIEW_DAILY_MAX = 12; // 하루 점검 상한(FUEL을 쓰는 서버 시작 턴의 마지막 안전판)

// 지난 점검의 기억(duty-reviews.jsonl의 review 줄). key는 그때 트리거가 본 것의 서명
export interface ReviewMemo {
  at: number;
  trigger: ReviewTrigger;
  key: string;
}

// 트리거가 본 것의 서명: idle은 놀고 있는 AIRCRAFT와 기다리는 FLIGHT 집합, leak은 그 leak의 제목. 바뀌지 않는 상황이 간격마다 되풀이 점검을 만들지 않게 한다
export const reviewKeyOf = (trigger: "idle" | "leak", s: ReviewSignals): string => (trigger === "idle" ? `${s.idleAircraft.join(",")}|${s.waitingFlights.join(",")}` : (s.leakTitle ?? ""));

// 지금 점검을 시작할까. lastAt은 마지막 점검 시각(점검한 적이 없으면 0). 서버가 막 떴을 때는 호출한 쪽의 준비 시간이 막는다.
// 같은 트리거가 같은 서명을 보고 reviewEveryMin 안에 이미 점검했으면 다시 점검하지 않는다(바뀌지 않는 leak·놀고-일감이 30분마다 점검을 부르지 않게).
// fuelHold: DUTY ACCOUNT의 FUEL이 HOLD 임계값 이상이면 서버가 시작하는 턴을 하지 않는다(SUPERVISOR의 글에는 그대로 답한다)
export function decideReview(x: { now: number; lastAt: number; busy: boolean; cfg: ReviewConfig; signals: ReviewSignals; idleSince: number | null; history?: readonly ReviewMemo[]; fuelHold?: boolean }): ReviewDecision {
  const { now, cfg, signals } = x;
  const history = x.history ?? [];
  // 놀고-일감이 이어진 시간은 점검을 못 하는 때에도 센다
  const stuck = signals.idleAircraft.length > 0 && signals.waitingFlights.length > 0;
  const idleSince = stuck ? (x.idleSince ?? now) : null;
  const out = (r: Omit<ReviewDecision, "idleSince">): ReviewDecision => ({ ...r, idleSince });
  if (!cfg.review) return out({ run: false, why: "off" });
  if (x.busy) return out({ run: false, why: "busy" });
  if (x.fuelHold) return out({ run: false, why: "fuel" });
  if (now - x.lastAt < cfg.reviewGapMin * MIN) return out({ run: false, why: "gap" });
  if (history.filter((h) => now - h.at < DAY).length >= REVIEW_DAILY_MAX) return out({ run: false, why: "cap" });
  const repeated = (trigger: ReviewTrigger, key: string) => history.some((h) => h.trigger === trigger && h.key === key && now - h.at < cfg.reviewEveryMin * MIN);
  if (idleSince !== null && now - idleSince >= cfg.reviewIdleMin * MIN) {
    const key = reviewKeyOf("idle", signals);
    if (!repeated("idle", key)) {
      const m = Math.floor((now - idleSince) / MIN);
      return { run: true, trigger: "idle", key, detail: `${signals.idleAircraft.join(", ")} idle for ${m} min while ${signals.waitingFlights.slice(0, 6).join(", ")} wait${signals.waitingFlights.length > 6 ? ` (+${signals.waitingFlights.length - 6})` : ""}`, idleSince: null };
    }
  }
  if (signals.leakMin !== null && signals.leakMin >= cfg.reviewLeakMin) {
    const key = reviewKeyOf("leak", signals);
    if (!repeated("leak", key)) return { run: true, trigger: "leak", key, detail: `${signals.leakTitle ?? "a human step"} held ${signals.leakMin} min`, idleSince };
  }
  if (now - x.lastAt >= cfg.reviewEveryMin * MIN) return { run: true, trigger: "schedule", detail: `last review ${Math.floor((now - x.lastAt) / MIN)} min ago`, idleSince };
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
  | { v: 1; ev: "review"; id: string; at: string; trigger: ReviewTrigger; detail: string; key?: string }
  | { v: 1; ev: "proposal"; at: string; review: string; key: string; title: string };

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
    else {
      const r = row(day);
      r.proposals++;
      const rel = releasedAt.get(l.key);
      if (rel && rel >= l.at) r.fired++;
      else if (stateOf.get(l.key) === "canceled") r.discarded++;
    }
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

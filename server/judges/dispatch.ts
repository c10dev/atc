import type { HumanDecision } from "../crosscheck.ts";
import type { LogEntry } from "../logbook.ts";
import { bodyWithheld, type ClassifyInput, classifyInputOf, JudgeAnswerError } from "./classify.ts";

// typed-judgment DISPATCH 판정(ATC-88, docs/fleet.md 6.1). 계산만 한다 — 네트워크는 engines.ts, 기록·스위치는 store.ts, 호출은 run.ts.
// 열린 ASSIGN마다 FLIGHT–AIRCRAFT 짝에 세 질문을 던진다. 그림자 전용: 점수·상태·HOLD를 바꾸지 않는다.
//   Ready(Noul): 본문이 시작하기에 충분한가 · Prerequisite(Noul): 다른 일을 기다린다고 적혀 있나 · Same area(Score): AIRCRAFT의 최근 FLIGHT와 얼마나 가까운가.

// 최근 FLIGHT 제목은 atc의 FLIGHT일 때만 보낸다(vocado 제목은 나가지 않는다)
export const ATC_AIRPORT = "ATCC";
export const RECENT_FLIGHTS = 3;
export const SAME_AREA_LEVELS = 5;
export const YES = 0.5; // Noul 확률이 이 이상이면 yes(같은 기준을 게이트 통계도 쓴다)
export const SAME_AREA_HIGH = 0.5; // 정규화한 Same area(0~1)가 이 이상이면 "가깝다"

export const DISPATCH_QUESTION_IDS = { ready: "ready", prerequisite: "prerequisite", sameArea: "same_area" } as const;

export interface DispatchState {
  ticket: ClassifyInput;
  recent_flights?: string[]; // 없으면 Same area를 묻지 않는다
}

// ---- 입력: 허용 목록 ----
// FLIGHT는 ATC-36과 같다(제목 + 목표·수정 허용 범위·완료 기준, SEC·Risk·라벨 모름은 제목만). key·REGISTRATION·댓글·점수는 보내지 않는다.
export const dispatchWithheld = (labels: string[] | null) => bodyWithheld(labels, {});

export function dispatchStateOf(t: { title: string; description: string | null }, withheld: boolean, recent: string[] | null): DispatchState {
  const ticket = classifyInputOf(t, withheld);
  return recent?.length ? { ticket, recent_flights: recent.map((x) => x.trim().slice(0, 300)) } : { ticket };
}

// 보낸 칸 목록(mark의 sent)
export const sentOf = (state: DispatchState): string[] => ["title", ...Object.keys(state.ticket.sections), ...(state.recent_flights ? ["recent_flights"] : [])];

// AIRCRAFT의 최근 FLIGHT: 마지막 3개 LOGBOOK 줄이 모두 atc(ATCC)의 FLIGHT여야 한다. 하나라도 아니면(다른 AIRPORT, AD HOC) 묻지 않는다.
// registration은 대소문자를 가리지 않는다. 같은 FLIGHT가 여러 줄이면 한 번만 센다.
export function recentEntriesOf(entries: readonly LogEntry[], registration: string | null): { keys: string[]; why: string | null } {
  if (!registration) return { keys: [], why: "AIRCRAFT를 모름" };
  const reg = registration.toUpperCase();
  const mine = entries.filter((e) => e.aircraft?.toUpperCase() === reg).sort((a, b) => b.arrivedAt.localeCompare(a.arrivedAt));
  const last: LogEntry[] = [];
  const seen = new Set<string>();
  for (const e of mine) {
    const k = e.flight ?? `#${e.key}`;
    if (seen.has(k)) continue;
    seen.add(k);
    last.push(e);
    if (last.length === RECENT_FLIGHTS) break;
  }
  if (!last.length) return { keys: [], why: "LOGBOOK에 지난 FLIGHT가 없음" };
  const off = last.find((e) => e.airport !== ATC_AIRPORT || !e.flight);
  if (off) return { keys: [], why: off.flight ? `${off.airport ?? "AIRPORT 모름"}의 FLIGHT가 섞임` : "AD HOC이 섞임" };
  return { keys: last.map((e) => e.flight!), why: null };
}

// ---- 질문 ----
const SAME_AREA_CRITERIA = [
  "Unrelated: a different screen, module or subsystem from every recent flight.",
  "Distant: the same product, but a different part of it.",
  "Nearby: touches a neighbouring module or the same layer as one recent flight.",
  "Close: the same module or screen as one recent flight, or several of them.",
  "Same: continues the work of a recent flight on the same files or feature.",
];

// TypeSafe System One 질문 맵. Same area는 최근 FLIGHT 제목을 보낼 때만 넣는다
export function dispatchQuestions(withRecent: boolean): Record<string, unknown> {
  const q: Record<string, unknown> = {
    [DISPATCH_QUESTION_IDS.ready]: {
      type: "noul",
      instructions:
        "Does the ticket in `ticket` say enough for a team to start work on it: what to change and how to tell it is done? A title alone, or a body that only states a wish, is not enough. Judge only what the ticket says.",
      criteria: { true: "It says what to do and how to know it is done.", false: "The team would have to guess the goal or the finish line." },
    },
    [DISPATCH_QUESTION_IDS.prerequisite]: {
      type: "noul",
      instructions: "Does the ticket in `ticket` say it must wait for other work (another ticket, a pull request, a release or a decision) before it can start?",
      criteria: { true: "It says it waits on, depends on or is blocked by other work.", false: "It names no work it has to wait for." },
    },
  };
  if (withRecent)
    q[DISPATCH_QUESTION_IDS.sameArea] = {
      type: "score",
      instructions: "How close is the work in `ticket` to the recent work listed in `recent_flights` (the titles of the last flights of the aircraft that would fly it)? Compare the area of the code, not the wording.",
      criteria: SAME_AREA_CRITERIA,
    };
  return q;
}

// ---- 답: 모양 검사 ----
export interface DispatchJudgment {
  ready: number; // yes 확률
  prerequisite: number; // yes 확률
  sameArea: { score: number; level: number; confidence: number | null } | null; // level은 0~1로 바꾼 값. 묻지 않았으면 null
}

const prob = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null);

// score 답의 레벨 번호는 legend 키에서 읽는다(0부터든 1부터든). legend가 없으면 1..SAME_AREA_LEVELS로 본다
export function levelOf(x: { score?: unknown; legend?: unknown }): number | null {
  if (typeof x.score !== "number" || !Number.isFinite(x.score)) return null;
  const keys = x.legend && typeof x.legend === "object" ? Object.keys(x.legend).map(Number).filter(Number.isFinite) : [];
  const lo = keys.length ? Math.min(...keys) : 1;
  const hi = keys.length ? Math.max(...keys) : SAME_AREA_LEVELS;
  if (hi <= lo || x.score < lo || x.score > hi) return null;
  return (x.score - lo) / (hi - lo);
}

export function dispatchJudgmentOf(answers: unknown, withRecent: boolean): DispatchJudgment {
  if (!answers || typeof answers !== "object") throw new JudgeAnswerError("answers가 없음");
  const a = answers as Record<string, { type?: unknown; noul?: unknown; score?: unknown; legend?: unknown; confidence?: unknown }>;
  const noul = (id: string) => {
    const p = prob(a[id]?.noul);
    if (a[id]?.type !== "noul" || p === null) throw new JudgeAnswerError(`${id}: 0~1 noul이 아님`);
    return p;
  };
  let sameArea: DispatchJudgment["sameArea"] = null;
  if (withRecent) {
    const x = a[DISPATCH_QUESTION_IDS.sameArea];
    const level = x?.type === "score" ? levelOf(x) : null;
    if (!x || level === null) throw new JudgeAnswerError(`${DISPATCH_QUESTION_IDS.sameArea}: score가 legend 범위 안이 아님`);
    sameArea = { score: x.score as number, level, confidence: prob(x.confidence) };
  }
  return { ready: noul(DISPATCH_QUESTION_IDS.ready), prerequisite: noul(DISPATCH_QUESTION_IDS.prerequisite), sameArea };
}

// ---- 게이트 통계: 세 질문마다 SUPERVISOR·OCC의 결과와 얼마나 맞았나(표시만, 어떤 기준도 아니다) ----
export interface DispatchMeasured {
  id: string;
  judgment: DispatchJudgment;
  human: HumanDecision | null; // SUPERVISOR 판정(ATFM 자동 판정은 null)
  codes: string[]; // 거절 사유 칩(gateCodes가 있으면 그것)
  occHold: boolean; // OCC가 HOLD를 걸었던 제안
}

export interface DispatchRate {
  marked: number;
  matched: number;
  rate: number | null;
}
const rateOf = (marked: number, matched: number): DispatchRate => ({ marked, matched, rate: marked ? matched / marked : null });

// - ready: Ready = no 인 제안 가운데 SUPERVISOR가 거절(disagree·reject)한 것
// - prerequisite: Prerequisite = yes 인 제안 가운데 `waiting-on-prior` 칩이 달렸거나 OCC가 HOLD한 것(판정이 없어도 OCC HOLD면 결과가 있다)
// - sameArea: Same area가 가까움(≥ SAME_AREA_HIGH) 인 제안 가운데 SUPERVISOR가 승인(agree·approve)한 것
export function dispatchStatsOf(items: DispatchMeasured[]) {
  const ready = items.filter((m) => m.judgment.ready < YES && m.human);
  const prereq = items.filter((m) => m.judgment.prerequisite >= YES && (m.human || m.occHold));
  const near = items.filter((m) => m.judgment.sameArea && m.judgment.sameArea.level >= SAME_AREA_HIGH && m.human);
  return {
    judged: items.length,
    ready: rateOf(ready.length, ready.filter((m) => m.human!.verdict === "disagree").length),
    prerequisite: rateOf(prereq.length, prereq.filter((m) => m.occHold || m.codes.includes("waiting-on-prior")).length),
    sameArea: rateOf(near.length, near.filter((m) => m.human!.verdict === "agree").length),
  };
}

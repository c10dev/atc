import { clip, DONE_RE, GOAL_RE, sectionsOfMd } from "../briefs.ts";
import { FLIGHT_TYPES, type FlightType, RATINGS, type Rating, WAKES, type Wake } from "../crew.ts";
import type { ClassifyPayload } from "../schedule.ts";

// typed-judgment CLASSIFY 판정(ATC-36, docs/fleet.md 6장). 계산만 한다 — 네트워크는 engines.ts, 기록·스위치는 store.ts.
// 판정 계열(family)이 FLIGHT TYPE Choice, WAKE Choice, TYPE RATING마다 Noul로 분류하고,
// 그 분류를 OCC 초안과 비교한 agree/disagree가 mark가 된다. SUPERVISOR 판정과의 일치율은 crosscheckRateOf로 잰다.

export const JUDGE_FAMILIES = ["jev"] as const;
export type JudgeFamily = (typeof JUDGE_FAMILIES)[number];

// ---- 입력: 필드 허용 목록 ----
// 보내는 것은 제목과 허용한 칸(목표, 수정 허용 범위, 완료 기준)뿐이다. FLIGHT key, 라벨, 댓글, 담당, 프로젝트, 다른 칸은 보내지 않는다.
// rating:SEC·Risk:* 라벨이 있거나, 라벨을 모르거나(스냅숏에 없는 FLIGHT), 초안이 SEC를 붙이자고 하면 본문 없이 제목만 보낸다.
export const SCOPE_RE = /^(?:수정\s*허용\s*범위|허용\s*범위|allowed\s+(?:scope|files|surfaces)|in\s+scope|scope)(?!\S)/;
const SECTION_MAX = 600;

export interface ClassifyInput {
  title: string;
  sections: { goal?: string; allowed_scope?: string; done_criteria?: string };
}

export function bodyWithheld(labels: string[] | null, payload: ClassifyPayload): string | null {
  if (!labels) return "라벨을 모름(스냅숏에 없는 FLIGHT)";
  const hit = labels.find((l) => /^\s*rating\s*:\s*sec\s*$/i.test(l) || /^\s*risk\s*:/i.test(l));
  if (hit) return `${hit.trim()} 라벨`;
  if (payload.ratings?.includes("SEC")) return "초안이 rating:SEC를 붙임";
  return null;
}

export function classifyInputOf(t: { title: string; description: string | null }, withheld: boolean): ClassifyInput {
  const sections: ClassifyInput["sections"] = {};
  if (!withheld) {
    const all = sectionsOfMd(t.description);
    const take = (re: RegExp) => {
      const got = all.filter((x) => re.test(x.title) && x.text).map((x) => x.text);
      return got.length ? clip(got.join("\n"), SECTION_MAX) : undefined;
    };
    const goal = take(GOAL_RE);
    const scope = take(SCOPE_RE);
    const done = take(DONE_RE);
    if (goal) sections.goal = goal;
    if (scope) sections.allowed_scope = scope;
    if (done) sections.done_criteria = done;
  }
  return { title: t.title.trim().slice(0, 300), sections };
}

// ---- 질문: docs/fleet.md 4.1~4.3 ----
const TYPE_CRITERIA: Record<FlightType, string> = {
  BUILD: "Implements a feature, behavior or screen that users see or experience, and opens a PR.",
  MAINT: "Refactoring, cleanup, infrastructure, CI or static gates, tests, or a fix users don't see. Product behavior stays the same.",
  TEST: "A spike or prototype that may be thrown away.",
  SURVEY: "Research, an audit, an inventory or a plan that produces a document or findings, with no code. Implementation comes later.",
  CHECK: "Reviews a PR or audits a claim. The output is a verdict.",
  FERRY: "A mechanical move with no design decision: a dependency bump, a rename, or a docs fix of 5 lines or less.",
};
const WAKE_CRITERIA: Record<Wake, string> = {
  L: "Light: one file or a few lines, no new tests needed, under an hour.",
  M: "Medium: one feature or fix with tests, in one PR, a few hours.",
  H: "Heavy: several modules or services, a migration or security surface, several review rounds, 1-2 days.",
  J: "Super: crosses teams or repositories and needs a design first; must be split.",
};
const RATING_QUESTION: Record<Rating, { q: string; yes: string; no: string }> = {
  SEC: {
    q: "Does this ticket touch the database, migrations, row-level security, authentication, permissions, security, rights (copyright), deployment or payments?",
    yes: "It changes or depends on one of those surfaces.",
    no: "None of those surfaces is involved.",
  },
  UI: { q: "Does this ticket change screens, components, visual design or accessibility?", yes: "User-facing screens or components change.", no: "No screen or component changes." },
  DATA: { q: "Does this ticket work on language data, data pipelines, content or analytics?", yes: "Data, pipelines, content or analytics are the subject.", no: "No data, pipeline, content or analytics work." },
  DOCS: { q: "Does this ticket write or change documentation, rule files or handoff notes?", yes: "Documentation or rule files are a deliverable.", no: "No documentation or rule file is a deliverable." },
};

export const QUESTION_IDS = { type: "flight_type", wake: "wake", rating: (r: Rating) => `rating_${r.toLowerCase()}` } as const;

// TypeSafe System One 질문 맵(docs.typesafe.ai/api.md). 질문 id는 모델에 가지 않는다
export function classifyQuestions(): Record<string, unknown> {
  const q: Record<string, unknown> = {
    [QUESTION_IDS.type]: {
      type: "choice",
      instructions: "What kind of work is the ticket in `ticket` (its `title` and the `sections` it has)? Pick the first option in this order that fits: CHECK, SURVEY, TEST, FERRY, MAINT, BUILD. The presence of tests or a security surface alone does not make it BUILD.",
      criteria: TYPE_CRITERIA,
    },
    [QUESTION_IDS.wake]: {
      type: "choice",
      instructions: "How big is the change the ticket in `ticket` asks for, judged by the real size of the change? Test files listed in the allowed scope don't mean new tests are needed.",
      criteria: WAKE_CRITERIA,
    },
  };
  for (const r of RATINGS) {
    const x = RATING_QUESTION[r];
    q[QUESTION_IDS.rating(r)] = { type: "noul", instructions: `${x.q} Judge the ticket in \`ticket\`.`, criteria: { true: x.yes, false: x.no } };
  }
  return q;
}

// ---- 답: 모양 검사 ----
export interface ClassifyJudgment {
  type: FlightType;
  wake: Wake;
  confidence: { type: number | null; wake: number | null };
  ratings: Record<Rating, number>; // yes 확률
}

export class JudgeAnswerError extends Error {}

const prob = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null);

export function judgmentOf(answers: unknown): ClassifyJudgment {
  if (!answers || typeof answers !== "object") throw new JudgeAnswerError("answers가 없음");
  const a = answers as Record<string, { type?: unknown; choice?: unknown; noul?: unknown; confidence?: unknown }>;
  const choice = <T extends string>(id: string, allowed: readonly T[]): T => {
    const x = a[id];
    if (x?.type !== "choice" || !allowed.includes(x.choice as T)) throw new JudgeAnswerError(`${id}: ${allowed.join("|")} 중 하나가 아님`);
    return x.choice as T;
  };
  const ratings = {} as Record<Rating, number>;
  for (const r of RATINGS) {
    const x = a[QUESTION_IDS.rating(r)];
    const p = prob(x?.noul);
    if (x?.type !== "noul" || p === null) throw new JudgeAnswerError(`${QUESTION_IDS.rating(r)}: 0~1 noul이 아님`);
    ratings[r] = p;
  }
  return {
    type: choice(QUESTION_IDS.type, FLIGHT_TYPES),
    wake: choice(QUESTION_IDS.wake, WAKES),
    confidence: { type: prob(a[QUESTION_IDS.type]?.confidence), wake: prob(a[QUESTION_IDS.wake]?.confidence) },
    ratings,
  };
}

// ---- mark: 판정 계열의 분류를 초안과 비교 ----
// 초안이 적은 축만 본다(CLASSIFY는 빠진 축만 적는다). RATING은 초안에 ratings가 있을 때만,
// 네 rating마다 "초안이 붙이거나 이미 라벨이 있음"과 판정(yes 확률 ≥ 0.5)이 같은지 본다.
export const RATING_YES = 0.5;
const pct = (p: number) => `${Math.round(p * 100)}%`;

// 비교할 축이 없으면 null(mark를 남기지 않는다)
export function verdictOf(payload: ClassifyPayload, labels: string[] | null, j: ClassifyJudgment): { verdict: "agree" | "disagree"; reason: string } | null {
  const parts: string[] = [];
  let agree = true;
  if (payload.type) {
    const same = payload.type === j.type;
    agree &&= same;
    parts.push(`TYPE ${j.type}${j.confidence.type !== null ? `(${pct(j.confidence.type)})` : ""}${same ? "" : ` ≠ 초안 ${payload.type}`}`);
  }
  if (payload.wake) {
    const same = payload.wake === j.wake;
    agree &&= same;
    parts.push(`WAKE ${j.wake}${j.confidence.wake !== null ? `(${pct(j.confidence.wake)})` : ""}${same ? "" : ` ≠ 초안 ${payload.wake}`}`);
  }
  if (payload.ratings) {
    const has = new Set<string>([...payload.ratings, ...(labels ?? []).map((l) => /^\s*rating\s*:\s*(\w+)\s*$/i.exec(l)?.[1]?.toUpperCase() ?? "")]);
    const diff = RATINGS.filter((r) => has.has(r) !== j.ratings[r] >= RATING_YES);
    agree &&= diff.length === 0;
    const yes = RATINGS.filter((r) => j.ratings[r] >= RATING_YES);
    parts.push(`RATING ${yes.length ? yes.join("·") : "없음"}${diff.length ? ` ≠ 초안(${diff.map((r) => `${r} ${pct(j.ratings[r])}`).join(", ")})` : ""}`);
  }
  if (!parts.length) return null;
  return { verdict: agree ? "agree" : "disagree", reason: parts.join(" · ") };
}

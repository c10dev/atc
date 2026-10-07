import { type ClassifyInput, classifyQuestions } from "./classify.ts";

// 판정 엔진(ATC-36). stub: 녹화한 응답을 돌려준다(네트워크 없음, 테스트·시험 서버용). jev: TypeSafe System One.
// API 키는 요청 헤더에만 쓴다. 오류 문구·로그·기록에 넣지 않는다.

export type EngineName = "stub" | "jev" | "rule"; // rule: atc가 규칙으로 가른 판정(ATC-141), 아무것도 보내지 않는다
export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";
const TIMEOUT_MS = 20_000;

export interface EngineResult {
  model: string; // 응답의 model(예: jev-1.13.0). stub은 "stub"
  answers: unknown;
  usage?: { input_tokens?: number; output_tokens?: number };
}

// 한 번의 판정 요청: state는 허용 목록으로 만든 입력, questions는 TypeSafe 질문 맵. title은 stub의 녹화 응답 키
export interface JudgeCall {
  target: "schedule" | "dispatch" | "report" | "exception";
  title: string;
  state: Record<string, unknown>;
  questions: Record<string, unknown>;
}

export interface JudgeEngine {
  name: EngineName;
  ask(call: JudgeCall): Promise<EngineResult>;
  judge(input: ClassifyInput): Promise<EngineResult>; // SCHEDULE CLASSIFY
}

export class JudgeEngineError extends Error {
  status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}

// 요청 본문(docs.typesafe.ai/api.md): state는 허용 목록으로 만든 입력 하나(`ticket`)뿐이다
export const bodyOfCall = (call: Pick<JudgeCall, "state" | "questions">) => ({ state: call.state, model: JEV_MODEL, questions: call.questions });
export const classifyCall = (input: ClassifyInput): JudgeCall => ({ target: "schedule", title: input.title, state: { ticket: input }, questions: classifyQuestions() });
export const requestBodyOf = (input: ClassifyInput) => bodyOfCall(classifyCall(input));

// 녹화 응답: 제목으로 찾고, 없으면 fallback. 받은 입력은 inputs에 남긴다(테스트가 반출 내용을 확인한다)
// inputs: CLASSIFY로 받은 입력, calls: 모든 요청(DISPATCH state 포함)
export function stubEngine(recorded: Record<string, unknown> = {}, fallback: unknown = STUB_FALLBACK, dispatchFallback: unknown = STUB_DISPATCH_FALLBACK): JudgeEngine & { inputs: ClassifyInput[]; calls: JudgeCall[] } {
  const inputs: ClassifyInput[] = [];
  const calls: JudgeCall[] = [];
  const engine = {
    name: "stub" as const,
    inputs,
    calls,
    async ask(call: JudgeCall) {
      calls.push(call);
      return { model: "stub", answers: structuredClone(recorded[call.title] ?? (call.target === "dispatch" ? dispatchFallback : call.target === "report" ? STUB_REPORT_FALLBACK : call.target === "exception" ? STUB_EXCEPTION_FALLBACK : fallback)) };
    },
    async judge(input: ClassifyInput) {
      inputs.push(input);
      return engine.ask(classifyCall(input));
    },
  };
  return engine;
}

// REPORT 기본 응답: reported done
export const STUB_REPORT_FALLBACK = {
  report_class: { type: "choice", choice: "done", probabilities: { done: 0.7, decision: 0.1, stopped: 0.05, ready: 0.1, unknown: 0.05 }, confidence: 0.6 },
};

// 예외 판정(ATC-558) 기본 응답: 조심스럽게 ESCALATE(정책이 덮지 않음). 시험 서버가 무엇도 "행동"하지 않게
export const STUB_EXCEPTION_FALLBACK = {
  action: { type: "choice", choice: "ESCALATE", probabilities: { ESCALATE: 0.9, NONE: 0.1 }, confidence: 0.9 },
  policy_covers: { type: "noul", noul: 0.1 },
  policy_point: { type: "choice", choice: "NONE", probabilities: { NONE: 0.9 }, confidence: 0.9 },
};

// DISPATCH 기본 응답: Ready yes, Prerequisite no, Same area는 5단계 중 3(같은 모양의 score 답)
export const STUB_DISPATCH_FALLBACK = {
  ready: { type: "noul", noul: 0.8 },
  prerequisite: { type: "noul", noul: 0.1 },
  same_area: { type: "score", score: 3, legend: { "1": "a", "2": "b", "3": "c", "4": "d", "5": "e" }, probabilities: { "3": 0.6, "2": 0.2, "4": 0.2 }, confidence: 0.6 },
};

// 녹화한 모양 그대로의 기본 응답(BUILD · M · rating 없음)
export const STUB_FALLBACK = {
  flight_type: { type: "choice", choice: "BUILD", probabilities: { BUILD: 0.7, MAINT: 0.2, TEST: 0, SURVEY: 0.05, CHECK: 0, FERRY: 0.05 }, confidence: 0.6 },
  wake: { type: "choice", choice: "M", probabilities: { L: 0.2, M: 0.7, H: 0.1, J: 0 }, confidence: 0.6 },
  rating_sec: { type: "noul", noul: 0.1 },
  rating_ui: { type: "noul", noul: 0.3 },
  rating_data: { type: "noul", noul: 0.1 },
  rating_docs: { type: "noul", noul: 0.2 },
};

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export function jevEngine(apiKey: string, fetchImpl: Fetch = fetch): JudgeEngine {
  return {
    name: "jev",
    async judge(input) {
      return this.ask(classifyCall(input));
    },
    async ask(call) {
      if (!apiKey) throw new JudgeEngineError("TYPESAFE_API_KEY 없음");
      let res: Response;
      try {
        res = await fetchImpl(JEV_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(bodyOfCall(call)),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        throw new JudgeEngineError(`TypeSafe에 닿지 못함: ${(e as Error).name}`);
      }
      if (!res.ok) {
        // 본문은 앞부분만(검증 오류의 필드 이름). 키는 요청에만 있고 응답에 되돌아오지 않는다
        const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
        throw new JudgeEngineError(`TypeSafe HTTP ${res.status}${detail ? `: ${detail}` : ""}`, res.status);
      }
      const body = (await res.json().catch(() => null)) as { model?: unknown; answers?: unknown; usage?: EngineResult["usage"] } | null;
      if (!body || typeof body !== "object") throw new JudgeEngineError("TypeSafe 응답이 JSON이 아님");
      return { model: typeof body.model === "string" ? body.model.slice(0, 60) : JEV_MODEL, answers: body.answers, usage: body.usage };
    },
  };
}

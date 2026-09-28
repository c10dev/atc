import { type ClassifyInput, classifyQuestions } from "./classify.ts";

// 판정 엔진(ATC-36). stub: 녹화한 응답을 돌려준다(네트워크 없음, 테스트·시험 서버용). jev: TypeSafe System One.
// API 키는 요청 헤더에만 쓴다. 오류 문구·로그·기록에 넣지 않는다.

export type EngineName = "stub" | "jev";
export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";
const TIMEOUT_MS = 20_000;

export interface EngineResult {
  model: string; // 응답의 model(예: jev-1.13.0). stub은 "stub"
  answers: unknown;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface JudgeEngine {
  name: EngineName;
  judge(input: ClassifyInput): Promise<EngineResult>;
}

export class JudgeEngineError extends Error {
  status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}

// 요청 본문(docs.typesafe.ai/api.md): state는 허용 목록으로 만든 입력 하나(`ticket`)뿐이다
export const requestBodyOf = (input: ClassifyInput) => ({ state: { ticket: input }, model: JEV_MODEL, questions: classifyQuestions() });

// 녹화 응답: 제목으로 찾고, 없으면 fallback. 받은 입력은 inputs에 남긴다(테스트가 반출 내용을 확인한다)
export function stubEngine(recorded: Record<string, unknown> = {}, fallback: unknown = STUB_FALLBACK): JudgeEngine & { inputs: ClassifyInput[] } {
  const inputs: ClassifyInput[] = [];
  return {
    name: "stub",
    inputs,
    async judge(input) {
      inputs.push(input);
      return { model: "stub", answers: structuredClone(recorded[input.title] ?? fallback) };
    },
  };
}

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
      if (!apiKey) throw new JudgeEngineError("TYPESAFE_API_KEY 없음");
      let res: Response;
      try {
        res = await fetchImpl(JEV_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(requestBodyOf(input)),
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

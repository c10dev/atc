// DUTY의 stream-json 파서(ATC-220, docs/duty.md 3.1과 "D0 as probed"). 순수 함수: 줄 하나 → DUTY 이벤트 0개 이상.
// 도구의 입력·출력은 이벤트에 싣지 않는다: 도구 이름과 한 줄 요약(명령·경로·패턴의 앞부분)만. 모르는 줄은 무시하고, 깨진 줄은 세기만 한다(던지지 않는다).
export interface DutyRate {
  window: "five_hour" | "seven_day";
  utilization: number | null; // 0–1
  resetsAt: number | string | null;
}

export type DutyEvent =
  | { type: "init"; sessionId: string | null; model: string | null }
  | { type: "user"; text: string; image?: string } // 서버가 보낼 때 만든다(스트림의 재생 줄에서는 만들지 않는다)
  | { type: "shift" } // NEW SHIFT: 여기부터 새 대화
  | { type: "text"; text: string; final: boolean } // final=false는 조각(delta), true는 그 턴의 완성된 글 한 덩어리
  | { type: "tool"; id: string | null; name: string; summary: string; error: boolean }
  | { type: "notice"; text: string } // 턴이 오류로 끝났을 때(한도·중단 등)의 한 줄
  | { type: "state"; state: "idle" | "thinking" | "down"; error?: string; queued?: number; blocked?: boolean } // queued·blocked는 서버 런타임이 채운다(파서는 state만)
  | { type: "usage"; turn: DutyTurnUsage | null; rates: DutyRate[] };

export interface DutyTurnUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  context: number; // input + cache read + cache write: 이 턴이 모델에 보낸 컨텍스트 크기
  costUsd: number | null; // 프로세스 누적(D0 8)
  turns: number | null;
  ms: number | null;
  interrupted: boolean;
}

// guard 거절문의 앞머리(`PreToolUse:Bash hook error: [<hook 명령>]: `)는 읽는 이에게 소음이라 뗀다
const HOOK_PREFIX = /^PreToolUse:\w+ hook error: \[.*?\]: /;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

export const oneLine = (s: string, max = 100): string => {
  const first = s.replace(/\r/g, "").split("\n").find((l) => l.trim()) ?? "";
  const t = first.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

// 도구 호출의 한 줄 요약. 입력 전체가 아니라 무엇을 하려는지 알 만한 앞부분만
export function toolSummaryOf(name: string, input: unknown): string {
  if (!isObj(input)) return "";
  const pick = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  switch (name) {
    case "Bash":
      return oneLine(pick("command"), 80);
    case "Read":
      return oneLine(pick("file_path"), 80);
    case "Glob":
      return oneLine(pick("pattern"), 80);
    case "Grep":
      return oneLine(pick("pattern"), 80);
    default:
      return "";
  }
}

export function usageOf(result: Record<string, unknown>): DutyTurnUsage {
  const u = isObj(result.usage) ? result.usage : {};
  const input = num(u.input_tokens);
  const cacheRead = num(u.cache_read_input_tokens);
  const cacheWrite = num(u.cache_creation_input_tokens);
  return {
    input,
    output: num(u.output_tokens),
    cacheRead,
    cacheWrite,
    context: input + cacheRead + cacheWrite,
    costUsd: typeof result.total_cost_usd === "number" ? result.total_cost_usd : null,
    turns: typeof result.num_turns === "number" ? result.num_turns : null,
    ms: typeof result.duration_ms === "number" ? result.duration_ms : null,
    interrupted: result.subtype === "error_during_execution",
  };
}

export function ratesOf(info: unknown): DutyRate[] {
  if (!isObj(info) || !isObj(info.unifiedWindows)) return [];
  const out: DutyRate[] = [];
  for (const w of ["five_hour", "seven_day"] as const) {
    const x = info.unifiedWindows[w];
    if (!isObj(x)) continue;
    out.push({
      window: w,
      utilization: typeof x.utilization === "number" ? x.utilization : null,
      resetsAt: typeof x.resetsAt === "number" || typeof x.resetsAt === "string" ? x.resetsAt : null,
    });
  }
  return out;
}

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => (isObj(b) && b.type === "text" && typeof b.text === "string" ? b.text : "")).join("");
};

export interface DutyParser {
  feed(line: string): DutyEvent[];
  malformed(): number;
}

// 도구 호출 id → 이름은 도구 결과(오류)가 어느 도구의 것인지 알려 주려고 기억한다. 그 밖의 상태는 없다
export function createDutyParser(): DutyParser {
  const toolNames = new Map<string, string>();
  let bad = 0;
  const feed = (raw: string): DutyEvent[] => {
    const line = raw.trim();
    if (!line) return [];
    let j: unknown;
    try {
      j = JSON.parse(line);
    } catch {
      bad++;
      return [];
    }
    if (!isObj(j) || typeof j.type !== "string") {
      bad++;
      return [];
    }
    switch (j.type) {
      case "system":
        if (j.subtype === "init") return [{ type: "init", sessionId: typeof j.session_id === "string" ? j.session_id : null, model: typeof j.model === "string" ? j.model : null }];
        return [];
      case "stream_event": {
        const e = j.event;
        if (!isObj(e) || e.type !== "content_block_delta" || !isObj(e.delta)) return [];
        if (e.delta.type === "text_delta" && typeof e.delta.text === "string" && e.delta.text) return [{ type: "text", text: e.delta.text, final: false }];
        return [];
      }
      case "assistant": {
        const m = j.message;
        if (!isObj(m) || !Array.isArray(m.content)) return [];
        const out: DutyEvent[] = [];
        for (const b of m.content) {
          if (!isObj(b)) continue;
          if (b.type === "text" && typeof b.text === "string" && b.text.trim()) out.push({ type: "text", text: b.text, final: true });
          else if (b.type === "tool_use" && typeof b.name === "string") {
            const id = typeof b.id === "string" ? b.id : null;
            if (id) toolNames.set(id, b.name);
            out.push({ type: "tool", id, name: b.name, summary: toolSummaryOf(b.name, b.input), error: false });
          }
        }
        return out;
      }
      case "user": {
        // 재생된 사용자 글은 서버가 이미 적었으니 이벤트로 내지 않는다. 도구 결과 중 오류만 한 줄로(guard의 거절이 여기 온다)
        const m = j.message;
        if (!isObj(m) || !Array.isArray(m.content)) return [];
        const out: DutyEvent[] = [];
        for (const b of m.content) {
          if (!isObj(b) || b.type !== "tool_result" || b.is_error !== true) continue;
          const id = typeof b.tool_use_id === "string" ? b.tool_use_id : null;
          out.push({ type: "tool", id, name: (id && toolNames.get(id)) || "tool", summary: oneLine(textOf(b.content).replace(HOOK_PREFIX, ""), 160), error: true });
        }
        return out;
      }
      case "rate_limit_event": {
        const rates = ratesOf(j.rate_limit_info);
        return rates.length ? [{ type: "usage", turn: null, rates }] : [];
      }
      case "result": {
        const turn = usageOf(j);
        const out: DutyEvent[] = [{ type: "usage", turn, rates: [] }];
        // 중단(interrupt)은 오류가 아니라 사용자가 한 일이다. 그 밖의 오류 종료만 알린다
        if (j.is_error === true && !turn.interrupted) out.push({ type: "notice", text: oneLine(typeof j.result === "string" && j.result ? j.result : String(j.subtype ?? "error"), 200) });
        out.push({ type: "state", state: "idle" });
        return out;
      }
      default:
        return [];
    }
  };
  return { feed, malformed: () => bad };
}

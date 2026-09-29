// ACTIVITY(ATC-97): AIRCRAFT가 지금 하는 일 한 줄 — 마지막 도구와 짧은 라벨, 도구가 도는지(tool)·모델을 기다리는지(model)·쉬는지(idle).
// 대화 기록 끝에서 읽는 순수 함수다. 본문(Bash command, 파일 내용, 프롬프트, 도구 결과, assistant 글)은 두지 않는다.

export type ActivityPhase = "tool" | "model" | "idle";

export interface Activity {
  tool: string | null; // 이번 턴의 마지막 도구. 새 지시 뒤 아직 도구를 안 불렀으면 null
  label: string | null; // 도구별 짧은 라벨(activityLabel). 없으면 null
  at: string; // 지금 phase가 시작된 시각: tool은 도구 호출, model은 마지막 결과·지시, idle은 마지막 기록
  phase: ActivityPhase;
}

// 스냅샷 상태와 무관한 부분(대화 기록이 같으면 같다). 캐시에 두고 상태만 따로 얹는다
export interface ActivityTrack {
  tool: string | null;
  label: string | null;
  toolAt: number;
  running: boolean; // 결과가 아직 없는 도구 호출이 있다
  userAt: number; // 마지막 결과·지시 시각(모델 대기 시작)
  lastAt: number; // 마지막 user·assistant 기록 시각
}

export const LABEL_MAX = 60;

// 제어 문자·방향 바꿈 문자를 빼고 공백을 하나로, 길면 자른다
export function cleanText(v: unknown, max = LABEL_MAX): string | null {
  if (typeof v !== "string") return null;
  const s = v
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

const baseName = (p: unknown) => (typeof p === "string" ? cleanText(p.replace(/\/+$/, "").split("/").pop()) : null);

// 도구 이름과 입력 → 라벨. 목록에 없는 도구는 라벨이 없다. Bash는 description만(command는 읽지 않는다)
export function activityLabel(name: string, input: unknown): string | null {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (name.startsWith("mcp__")) {
    const rest = name.slice(5);
    const cut = rest.lastIndexOf("__");
    return cut > 0 ? cleanText(`${rest.slice(0, cut)} ${rest.slice(cut + 2)}`) : cleanText(rest);
  }
  switch (name) {
    case "Bash":
    case "Agent":
    case "Task":
      return cleanText(i.description);
    case "Read":
    case "Edit":
    case "Write":
      return baseName(i.file_path);
    case "Skill":
      return cleanText(i.skill);
    case "SendMessage":
      return cleanText(i.to);
    default:
      return null;
  }
}

type Block = { type?: unknown; id?: unknown; name?: unknown; input?: unknown; tool_use_id?: unknown };

// 대화 기록 끝(여러 줄) → 추적 값. 서브에이전트 줄(isSidechain)과 메타 줄은 건너뛰고, 깨진 줄(잘린 첫·끝 줄)도 건너뛴다
export function activityTrackOf(text: string): ActivityTrack | null {
  const pending = new Map<string, { tool: string; label: string | null; at: number }>();
  let last: { tool: string; label: string | null; at: number } | null = null;
  let userAt = NaN;
  let lastAt = NaN;
  for (const line of text.split("\n")) {
    if (!line.includes('"type":"assistant"') && !line.includes('"type":"user"')) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if ((d?.type !== "user" && d?.type !== "assistant") || d.isSidechain || d.isCompactSummary) continue;
    if (d.isMeta && !("turnOrigin" in d)) continue;
    const t = Date.parse(d.timestamp);
    if (Number.isNaN(t)) continue;
    const content: unknown = d.message?.content;
    const blocks: Block[] = Array.isArray(content) ? content.filter((b): b is Block => Boolean(b) && typeof b === "object") : [];
    lastAt = t;
    if (d.type === "assistant") {
      if (d.isApiErrorMessage) continue;
      for (const b of blocks) {
        if (b.type !== "tool_use" || typeof b.name !== "string") continue;
        const tool = cleanText(b.name, 80) ?? "?";
        last = { tool, label: activityLabel(b.name, b.input), at: t };
        if (typeof b.id === "string") pending.set(b.id, last);
      }
      continue;
    }
    const results = blocks.filter((b) => b.type === "tool_result");
    userAt = t;
    if (results.length) {
      for (const r of results) pending.delete(String(r.tool_use_id));
    } else {
      // 새 지시(또는 중단): 앞 턴의 도구는 끝났다
      pending.clear();
      last = null;
    }
  }
  if (Number.isNaN(lastAt)) return null;
  const running = [...pending.values()].pop();
  const shown = running ?? last;
  const since = Number.isNaN(userAt) ? lastAt : userAt;
  return {
    tool: shown?.tool ?? null,
    label: shown?.label ?? null,
    toolAt: shown?.at ?? since,
    running: Boolean(running),
    userAt: since,
    lastAt,
  };
}

// 추적 값에 세션 상태를 얹는다. idle이면 idle, busy면 결과 없는 도구가 있을 때 tool, 아니면 model
export function activityFromTrack(t: ActivityTrack | null, status: "busy" | "idle" | "dead"): Activity | null {
  if (!t || status === "dead") return null;
  const phase: ActivityPhase = status === "idle" ? "idle" : t.running ? "tool" : "model";
  const at = phase === "tool" ? t.toolAt : phase === "model" ? Math.max(t.userAt, t.toolAt) : t.lastAt;
  return { tool: t.tool, label: t.label, at: new Date(at).toISOString(), phase };
}

export function activityOf(text: string, status: "busy" | "idle" | "dead" = "busy"): Activity | null {
  return activityFromTrack(activityTrackOf(text), status);
}

// 화면 한 줄의 두 조각: 무엇("Bash · Run the test suite")과 얼마 전("12s"). 좁으면 무엇만 줄이고 시간은 남긴다
export function activityParts(a: Activity, now: number): { what: string; ago: string } {
  const parts: string[] = [];
  // phase 표시를 앞에 둔다(좁으면 뒤의 라벨이 잘린다)
  if (a.phase === "idle") parts.push("idle");
  if (a.phase === "model") parts.push(a.tool ? "model" : "thinking");
  // MCP 도구 이름은 라벨(`<server> <tool>`)과 겹치므로 줄에는 MCP로만
  if (a.tool) parts.push(a.tool.startsWith("mcp__") && a.label ? "MCP" : a.tool);
  if (a.label) parts.push(a.label);
  return { what: parts.join(" · "), ago: agoText(now - Date.parse(a.at)) };
}

// 화면 한 줄: "Bash · Run the test suite · 12s". 모델 대기는 "model · …", idle은 "idle · …"
export function activityText(a: Activity, now: number): string {
  const { what, ago } = activityParts(a, now);
  return what ? `${what} · ${ago}` : ago;
}

// 경과: 12s, 4m, 2h05m
export function agoText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60 ? String(m % 60).padStart(2, "0") + "m" : ""}`;
}

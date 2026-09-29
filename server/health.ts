// AIRCRAFT health(ATC-45, docs/fleet.md 8.8): 세션이 왜 멈췄는지, 무엇을 기다리는지를 대화 기록 끝에서 읽는다.
// atc는 알리고 제안만 한다 — 다시 보내기·승인·재시작은 하지 않는다. 계산은 순수 함수이고,
// 본문은 두지 않는다(코드, 시각, 오류 한 줄만).
import { sameReg } from "./registration.ts";

export const HEALTH_CODES = ["LIMIT", "RESUME", "STALLED", "THROTTLE", "NETWORK", "MODEL", "CONTEXT", "PROVIDER", "PENDING", "UNANSWERED", "HUNG", "DENIED", "UNKNOWN"] as const;
export type HealthCode = (typeof HEALTH_CODES)[number];

export interface Health {
  code: HealthCode;
  level: "info" | "alert";
  since: string;
  resetsAt?: string; // LIMIT: 한도가 풀리는 시각. RESUME: 풀린 시각
  weekly?: boolean; // LIMIT: 주간 한도
  cut?: boolean; // LIMIT(ATC-86): 오류 없이 턴이 한도로 잘렸다(대화 기록의 usageLimitNote "wrap_up" 뒤 멈춤). reset은 ACCOUNT의 FUEL REMAINING에서
  cutAt?: string; // cut LIMIT과 RESUME: 한도에 걸린 시각(wrap_up 안내가 들어온 시각)
  detail: string; // 오류 한 줄(잘라서) 또는 상황
  next: string; // 대응 매뉴얼의 다음 한 걸음
  holds: boolean; // DISPATCH·SCHEDULE이 이 AIRCRAFT를 건너뛴다
}

export interface HealthConfig {
  unansweredMin: number; // 대답 없는 지시가 UNANSWERED가 되는 분
  hungMin: number; // busy인데 기록이 이만큼 없으면 HUNG(INFO)
  hungAlertMin: number; // 이만큼이면 HUNG ALERT
  throttleAlertCount: number; // THROTTLE이 창 안에 이만큼이면 ALERT
  throttleWindowMin: number;
  deniedCount: number; // 거부·hook 막힘이 창 안에 이만큼이면 DENIED
  deniedWindowMin: number;
  stalledMin: number; // In Progress FLIGHT를 쥔 AIRCRAFT가 idle로 이만큼 지나면 STALLED(ATC-86)
  blockedMin?: number; // 백그라운드 job이 blocked로 이만큼 지나면 BLOCKED 경보(ATC-99). 없으면 기본
}

export const DEFAULT_HEALTH: HealthConfig = {
  unansweredMin: 10,
  hungMin: 30,
  hungAlertMin: 60,
  throttleAlertCount: 3,
  throttleWindowMin: 30,
  deniedCount: 3,
  deniedWindowMin: 10,
  stalledMin: 60,
  blockedMin: 3,
};

// 대화 기록 한 줄에서 뽑은 사실. 본문은 없다(오류 한 줄만)
export type Fact =
  | { t: number; kind: "prompt" }
  | { t: number; kind: "reply"; toolUses: string[] }
  | { t: number; kind: "result"; toolUseIds: string[]; denied: number }
  | { t: number; kind: "error"; error: string; text: string; resetsAt?: number; rateLimitType?: string }
  // usageLimitNote(ATC-86): Claude Code가 한도에 닿으면 넣는 isMeta 줄. wrap_up = "곧 잘린다, 마무리하라", release = 한도가 풀린 뒤 다음 지시와 함께 "앞의 안내는 잊어라". 본문은 읽지 않는다
  | { t: number; kind: "limit-note"; note: "wrap_up" | "release" };

// 자동 모드 거부와 hook 막힘(tool_result 앞부분만 본다)
const DENIED_RE = /^(Permission for this action was denied|The server-side auto mode classifier|\S+ hook (blocking )?error|<tool_use_error>Blocked:)/i;
// 사람이 보낸 지시가 아닌 user 줄: 중단 표시, 로컬 명령
const NOT_PROMPT_RE = /^(\[Request interrupted|<local-command|<command-name>|<command-message>)/;

// 오류 메시지의 첫 줄만(≤200자). hook(hooks/health.mjs)도 같은 규칙으로 자른다
export const firstLine = (s: string) => s.split("\n").find((l) => l.trim())?.trim().slice(0, 200) ?? "";

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => (b && typeof b === "object" && (b as { type?: string }).type === "text" ? String((b as { text?: unknown }).text ?? "") : "")).join("\n");
}

// 대화 기록 텍스트(여러 줄) → 사실. 서브에이전트 줄(isSidechain)과 메타 줄은 건너뛴다.
// 턴을 여는 user 줄에는 turnOrigin이 있다: 사람(human), 다른 세션(peer, isMeta이기도 함), 작업 알림 …
export function factsOf(text: string): Fact[] {
  const out: Fact[] = [];
  for (const line of text.split("\n")) {
    if (!line.includes('"type":"assistant"') && !line.includes('"type":"user"')) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if ((d.type !== "user" && d.type !== "assistant") || d.isSidechain || d.isCompactSummary) continue;
    const t = Date.parse(d.timestamp);
    if (Number.isNaN(t)) continue;
    if (d.type === "user" && (d.usageLimitNote === "wrap_up" || d.usageLimitNote === "release")) {
      out.push({ t, kind: "limit-note", note: d.usageLimitNote });
      continue;
    }
    if (d.isMeta && !("turnOrigin" in d)) continue;
    const content = d.message?.content;
    if (d.type === "assistant") {
      if (d.isApiErrorMessage) {
        const q = d.quotaLimits;
        out.push({
          t,
          kind: "error",
          error: String(d.error ?? "unknown"),
          text: firstLine(textOf(content)),
          ...(typeof q?.resetsAt === "number" ? { resetsAt: q.resetsAt * 1000 } : {}),
          ...(typeof q?.rateLimitType === "string" ? { rateLimitType: q.rateLimitType } : {}),
        });
      } else {
        const toolUses = Array.isArray(content) ? content.filter((b) => b?.type === "tool_use" && b.id).map((b) => String(b.id)) : [];
        out.push({ t, kind: "reply", toolUses });
      }
      continue;
    }
    if (typeof content === "string") {
      if (!NOT_PROMPT_RE.test(content.trimStart())) out.push({ t, kind: "prompt" });
      continue;
    }
    if (!Array.isArray(content)) continue;
    const results = content.filter((b) => b?.type === "tool_result");
    if (results.length) {
      const denied = results.filter((b) => b.is_error && DENIED_RE.test(textOf(b.content).trimStart() || String(b.content ?? ""))).length;
      out.push({ t, kind: "result", toolUseIds: results.map((b) => String(b.tool_use_id)), denied });
    } else if (textOf(content).trim() && !NOT_PROMPT_RE.test(textOf(content).trimStart())) {
      out.push({ t, kind: "prompt" });
    }
  }
  return out;
}

// "resets 7:40am (UTC)" → 오류 시각 뒤 첫 그 시각(UTC만 읽는다)
export function resetFromText(text: string, at: number): number | undefined {
  const m = /resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(UTC\)/i.exec(text);
  if (!m) return undefined;
  const h = (Number(m[1]) % 12) + (m[3]!.toLowerCase() === "pm" ? 12 : 0);
  const d = new Date(at);
  let r = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, Number(m[2] ?? 0));
  if (r <= at) r += 86_400_000;
  return r;
}

type ErrorCode = "LIMIT" | "THROTTLE" | "NETWORK" | "MODEL" | "CONTEXT" | "PROVIDER" | "UNKNOWN";

// API 오류 하나의 원인. 모르면 UNKNOWN(틀린 코드보다 원문)
export function classifyError(e: { error: string; text: string; resetsAt?: number }): ErrorCode {
  const { error, text } = e;
  if (error === "rate_limit") {
    if (/not your usage limit|temporarily limiting|overloaded/i.test(text)) return "THROTTLE";
    return e.resetsAt || /limit/i.test(text) ? "LIMIT" : "THROTTLE";
  }
  if (error === "overloaded" || /overloaded/i.test(text)) return "THROTTLE";
  if (/unable to connect|certificate|ssl|tls|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|fetch failed|network/i.test(text)) return "NETWORK";
  if (error === "model_not_found" || /issue with the selected model/i.test(text)) return "MODEL";
  if (/prompt is too long|compaction failed|context (window|length)/i.test(text)) return "CONTEXT";
  if (error === "server_error") return "THROTTLE";
  if (/OpenAI-compatible|provider|JSON schema|API Error: 4\d\d|no body/i.test(text)) return "PROVIDER";
  return "UNKNOWN";
}

export const NEXT: Record<HealthCode, string> = {
  LIMIT: "reset까지 기다린다. reset 뒤에도 지시가 UNANSWERED면 지시를 보낸 쪽(OCC·사용자)이나 SUPERVISOR가 다시 보낸다",
  RESUME: "SUPERVISOR가 그 세션에서 \"계속\"을 보낸다. 한도는 이미 풀렸다. atc는 팀에 메시지를 보내지 않는다",
  STALLED: "SUPERVISOR가 그 세션을 들여다본다. 막힌 것이 없으면 \"계속\"을 보내고, 되살릴 수 없으면 RESTART. atc는 팀에 메시지를 보내지 않는다",
  THROTTLE: "서버가 잠시 붐빈다. 몇 분 뒤 다시 보낸다",
  NETWORK: "SUPERVISOR가 네트워크·프록시·ANTHROPIC_BASE_URL/NO_PROXY를 확인하고 다시 보낸다",
  MODEL: "SUPERVISOR가 모델이나 경로를 고쳐 다시 띄운다. 그대로 재시도하지 않는다",
  CONTEXT: "새 CREW BRIEFING으로 RESTART. STAND와 PR은 새 세션에 HANDOFF",
  PROVIDER: "기본 경로로 다시 띄우고, 그 경로의 버그를 올린다",
  PENDING: "SUPERVISOR가 그 세션에서 승인하거나 거절한다",
  UNANSWERED: "지시를 보낸 쪽(OCC·사용자)이나 SUPERVISOR가 다시 보낸다. atc는 스스로 보내지 않는다",
  HUNG: "SUPERVISOR가 들여다본다. 계속되면 RESTART",
  DENIED: "SUPERVISOR가 permission 규칙으로 허용하거나 다시 브리핑한다",
  UNKNOWN: "SUPERVISOR가 오류 원문을 보고 판단한다",
};

// 오류 없이 한도로 잘린 턴(cut LIMIT)의 다음 한 걸음
export const NEXT_CUT =
  "reset까지 기다린다. reset 뒤에도 새 지시가 없으면 RESUME으로 바뀐다 — 그때 SUPERVISOR가 그 세션에서 \"계속\"을 보낸다. atc는 팀에 메시지를 보내지 않는다";

// DISPATCH·SCHEDULE이 건너뛰는 코드(명세 표). cut LIMIT도 LIMIT이라 건너뛴다. RESUME·STALLED는 보여 주기만 한다(ATC-86). HUNG은 busy라 원래도 배정되지 않는다
const HOLDS = new Set<HealthCode>(["LIMIT", "MODEL", "CONTEXT", "PROVIDER", "HUNG"]);

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const make = (code: HealthCode, level: Health["level"], since: number, detail: string, extra: Partial<Health> = {}): Health => ({
  code,
  level,
  since: iso(since),
  detail,
  next: NEXT[code],
  holds: HOLDS.has(code),
  ...extra,
});

export interface SessionState {
  status: "busy" | "idle" | "dead";
  lastWriteAt: number | null; // 대화 기록을 마지막으로 쓴 시각
}

const lastIndex = <T>(xs: T[], f: (x: T) => boolean) => {
  for (let i = xs.length - 1; i >= 0; i--) if (f(xs[i]!)) return i;
  return -1;
};

// 세션 하나의 health. 문제가 없으면 null. 코드는 다음 정상 턴(대답)이 오면 풀린다
export function healthOf(facts: Fact[], s: SessionState, now: number, cfg: HealthConfig = DEFAULT_HEALTH): Health | null {
  if (s.status === "dead" || !facts.length) return null;
  const iPrompt = lastIndex(facts, (f) => f.kind === "prompt");
  const iReply = lastIndex(facts, (f) => f.kind === "reply");
  const iErr = lastIndex(facts, (f) => f.kind === "error");
  const promptAt = iPrompt >= 0 ? facts[iPrompt]!.t : null;
  const unanswered = (since: number, detail: string) => make("UNANSWERED", "alert", since, detail);

  // 1) 마지막 턴이 API 오류로 끝났고 그 뒤 대답도 새 지시도 없다
  if (s.status === "idle" && iErr > iReply && iErr > iPrompt) {
    const e = facts[iErr] as Extract<Fact, { kind: "error" }>;
    const code = classifyError(e);
    const detail = e.text || e.error;
    if (code === "LIMIT") {
      const resetsAt = e.resetsAt ?? resetFromText(e.text, e.t);
      const weekly = /seven_day|week/i.test(e.rateLimitType ?? "") || /weekly/i.test(e.text);
      if (resetsAt && now >= resetsAt) return unanswered(promptAt ?? e.t, `LIMIT reset ${hhmm(resetsAt)} 지남 — 지시가 아직 대답을 받지 못함`);
      return make("LIMIT", "alert", e.t, detail, { ...(resetsAt ? { resetsAt: iso(resetsAt) } : {}), ...(weekly ? { weekly } : {}) });
    }
    if (code === "THROTTLE") {
      if (now - e.t >= cfg.unansweredMin * MIN) return unanswered(promptAt ?? e.t, `THROTTLE 뒤 ${Math.round((now - e.t) / MIN)}분째 대답 없음`);
      const recent = facts.filter((f) => f.kind === "error" && f.t > now - cfg.throttleWindowMin * MIN && classifyError(f) === "THROTTLE").length;
      return make("THROTTLE", recent >= cfg.throttleAlertCount ? "alert" : "info", e.t, detail);
    }
    return make(code, "alert", e.t, detail);
  }

  // 2) 도구 호출이 결과 없이 멈춰 있다(승인 대기)
  if (s.status === "idle" && iReply >= 0 && iReply > iPrompt) {
    const r = facts[iReply] as Extract<Fact, { kind: "reply" }>;
    const done = new Set(facts.slice(iReply + 1).flatMap((f) => (f.kind === "result" ? f.toolUseIds : [])));
    if (r.toolUses.some((id) => !done.has(id))) return make("PENDING", "info", r.t, "도구 호출이 승인을 기다림");
  }

  // 2b) 오류 없이 한도로 턴이 잘렸다(ATC-86): 마지막 지시 뒤에 wrap_up 안내가 들어왔고 세션이 쉬고 있다. release가 오면 풀린 것
  const iNote = lastIndex(facts, (f) => f.kind === "limit-note" && f.note === "wrap_up");
  if (s.status === "idle" && iNote >= 0 && iNote > iPrompt && iNote > lastIndex(facts, (f) => f.kind === "limit-note" && f.note === "release")) {
    const at = facts[iNote]!.t;
    return make("LIMIT", "alert", at, "사용 한도에 걸려 턴이 도중에 끝남(오류 없이 잘림)", { cut: true, cutAt: iso(at), next: NEXT_CUT });
  }

  // 3) 지시 뒤 대답 없이 쉬고 있다
  if (s.status === "idle" && promptAt != null && iPrompt > iReply && now - promptAt >= cfg.unansweredMin * MIN) {
    return unanswered(promptAt, `지시 뒤 ${Math.round((now - promptAt) / MIN)}분째 대답 없음`);
  }

  // 4) busy인데 기록이 오래 없다
  if (s.status === "busy" && s.lastWriteAt != null && now - s.lastWriteAt >= cfg.hungMin * MIN) {
    const min = Math.round((now - s.lastWriteAt) / MIN);
    return make("HUNG", min >= cfg.hungAlertMin ? "alert" : "info", s.lastWriteAt, `busy인데 ${min}분째 기록 없음`);
  }

  // 5) 거부·hook 막힘이 되풀이된다
  const denials = facts.filter((f) => f.kind === "result" && f.denied > 0 && f.t > now - cfg.deniedWindowMin * MIN);
  const count = denials.reduce((n, f) => n + (f.kind === "result" ? f.denied : 0), 0);
  if (count >= cfg.deniedCount) return make("DENIED", "info", denials[0]!.t, `${cfg.deniedWindowMin}분 안에 거부·hook 막힘 ${count}번`);
  return null;
}

// cut LIMIT의 reset(ATC-86). 대화 기록의 wrap_up 안내에는 reset이 없어서 ACCOUNT의 FUEL REMAINING 기록에서 찾는다.
// 잘린 시각 직전(5분 뒤까지)의 기록 중 세션마다 가장 새 것에서, 그때 아직 오지 않은 reset을 가진 창 가운데 holdPct 이상 쓴 것 —
// 여럿이면 가장 늦은 reset. reset이 지난 지금은 FUEL REMAINING이 그 창을 버리므로 기록(줄마다 t가 있다)에서 되짚는다
export function cutResetOf(
  cutAt: number,
  records: readonly { t: string; sessionId: string; rate_limits?: Partial<Record<string, { used_percentage: number; resets_at: number }>> }[],
  holdPct: number,
): { resetsAt: number; weekly: boolean } | null {
  const latest = new Map<string, (typeof records)[number]>();
  for (const r of records) {
    const at = Date.parse(r.t);
    if (!r.rate_limits || !Number.isFinite(at) || at > cutAt + 5 * MIN) continue;
    const cur = latest.get(r.sessionId);
    if (!cur || at > Date.parse(cur.t)) latest.set(r.sessionId, r);
  }
  let best: { resetsAt: number; weekly: boolean } | null = null;
  for (const r of latest.values()) {
    for (const [name, w] of Object.entries(r.rate_limits!)) {
      if (!w || w.used_percentage < holdPct) continue;
      const resetsAt = w.resets_at * 1000;
      if (resetsAt <= cutAt) continue;
      if (!best || resetsAt > best.resetsAt) best = { resetsAt, weekly: name === "seven_day" };
    }
  }
  return best;
}

// cut LIMIT에 reset을 붙인다. reset이 지났으면 RESUME(한도는 풀렸는데 새 지시가 없다). reset을 모르면 그대로(LIMIT이 풀릴 때까지 HOLD)
export function settleCut(h: Health, reset: { resetsAt: number; weekly: boolean } | null, now: number): Health {
  if (h.code !== "LIMIT" || !h.cut || !reset) return h;
  const cutAt = h.cutAt ? Date.parse(h.cutAt) : Date.parse(h.since);
  if (now >= reset.resetsAt) {
    return make("RESUME", "alert", reset.resetsAt, `한도가 풀렸다(reset ${hhmm(reset.resetsAt, now)}) — cut ${hhmm(cutAt, now)} 뒤 새 지시가 없어 멈춰 있음`, {
      resetsAt: iso(reset.resetsAt),
      cutAt: iso(cutAt),
      ...(reset.weekly ? { weekly: true } : {}),
    });
  }
  return { ...h, resetsAt: iso(reset.resetsAt), ...(reset.weekly ? { weekly: true } : {}) };
}

// STALLED(ATC-86): In Progress FLIGHT를 쥐었는데(STAND 점유나 tail: 라벨) idle로 stalledMin 넘게 활동이 없고, 그 FLIGHT에 열린 PR이 없다.
// 다른 health가 없을 때만 붙는다(호출하는 쪽이 정한다). 활동이 있으면 lastActiveAt이 움직여 풀린다
export interface StallInput {
  status: SessionState["status"];
  lastActiveAt: number | null;
  flights: { key: string; hasPr: boolean }[]; // In Progress FLIGHT
}
export function stalledOf(x: StallInput, now: number, cfg: HealthConfig = DEFAULT_HEALTH): Health | null {
  if (x.status !== "idle" || x.lastActiveAt == null) return null;
  const bare = x.flights.filter((f) => !f.hasPr);
  if (!bare.length || now - x.lastActiveAt < cfg.stalledMin * MIN) return null;
  const min = Math.round((now - x.lastActiveAt) / MIN);
  return make("STALLED", "info", x.lastActiveAt, `${bare.map((f) => f.key).join(", ")} In Progress인데 ${min}분째 활동 없음 — 열린 PR 없음`);
}

// 07:40Z. 하루 넘게 남았으면 날짜도(10-03 07:40Z)
export function hhmm(ms: number, now?: number): string {
  const s = new Date(ms).toISOString();
  const t = `${s.slice(11, 16)}Z`;
  return now != null && Math.abs(ms - now) >= 86_400_000 ? `${s.slice(5, 10)} ${t}` : t;
}

// hook(hooks/health.mjs)이 남긴 한 줄. 시각은 t, 코드가 있으면 code
export interface PushRecord {
  t: string;
  event: string;
  code?: HealthCode;
  error?: string;
  line?: string;
}

const PUSH_NEXT: Partial<Record<HealthCode, string>> = { PENDING: NEXT.PENDING, THROTTLE: NEXT.THROTTLE };
const pushSince = (p: PushRecord) => Date.parse(p.t);

// pull 분류기가 대화 기록 끝에서 아는 "마지막 사실" 시각. 이보다 새로운 push만 채택한다
export function lastFactAt(facts: Fact[]): number | null {
  return facts.reduce<number | null>((a, f) => (a == null || f.t > a ? f.t : a), null);
}

// 최신 push 기록 하나를 Health로. 코드가 없으면(clear·idle_prompt) null.
// StopFailure의 error는 pull과 같은 classifyError를 거쳤고, 여기서는 reset 문구만 문장에서 다시 읽는다
function pushHealth(p: PushRecord): Health | null {
  if (!p.code) return null;
  const at = pushSince(p);
  if (!Number.isFinite(at)) return null;
  // PENDING은 대화 기록의 pull과 같은 문구로, 나머지는 hook이 남긴 오류 한 줄(또는 error 코드)
  const detail = p.code === "PENDING" ? "도구 호출이 승인을 기다림" : p.line || p.error || p.event;
  if (p.code === "LIMIT") {
    const resetsAt = resetFromText(detail, at);
    return make("LIMIT", "alert", at, detail, { ...(resetsAt ? { resetsAt: iso(resetsAt) } : {}) });
  }
  return make(p.code, p.code === "PENDING" || p.code === "THROTTLE" ? "info" : "alert", at, detail, {
    next: PUSH_NEXT[p.code] ?? NEXT[p.code],
  });
}

// ATC-47 push/pull: 대화 기록의 마지막 사실보다 새 push 기록이 이기고, 아니면(pull이 나중이거나 같으면) pull이 남는다.
// push는 permission_prompt 같은 대기(대화 기록에 없는 사실)를 바로 알려 주는 용도다
export function mergeHealth(push: PushRecord | null | undefined, pull: Health | null, facts: Fact[]): Health | null {
  if (!push) return pull;
  const at = pushSince(push);
  if (!Number.isFinite(at)) return pull;
  const pullAt = lastFactAt(facts);
  if (pullAt != null && pullAt >= at) return pull; // 그 뒤 대화 기록이 움직였다 → pull이 최신
  // ATC-86: cut LIMIT·RESUME은 새 활동(지시·도구 결과)이 오면 풀린다. 대화 기록이 아직 따라오지 못했어도 hook이 먼저 안다.
  // quota_auto_resume_fired(CLI가 스스로 이어감)는 RESUME을 푼다. Stop은 지우지 않는다(잘린 턴의 끝이다)
  const since = pull?.cutAt ? Date.parse(pull.cutAt) : NaN;
  if (pull && (pull.cut || pull.code === "RESUME") && at > since) {
    if (push.event === "UserPromptSubmit" || push.event === "PostToolUse") return null;
    if (push.event === "quota_auto_resume_fired" && pull.code === "RESUME") return null;
  }
  return pushHealth(push) ?? pull; // 코드 없는 clear·idle_prompt는 pull을 그대로 둔다
}

const ago = (since: string, now: number) => {
  const m = Math.max(0, Math.floor((now - Date.parse(since)) / MIN));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") + "m" : ""}`;
};

// FLEET 줄에 붙이는 짧은 글: HOLD · LIMIT until 07:40Z, PENDING approval 12m, CONTEXT — RESTART
export function healthLabel(h: Health, now: number): string {
  switch (h.code) {
    case "LIMIT": {
      const tags = [h.weekly ? "weekly" : null, h.cut && h.cutAt ? `cut ${hhmm(Date.parse(h.cutAt), now)}` : null].filter(Boolean);
      return `HOLD · LIMIT${tags.length ? ` (${tags.join(", ")})` : ""}${h.resetsAt ? ` until ${hhmm(Date.parse(h.resetsAt), now)}` : ""}`;
    }
    case "RESUME":
      return "RESUME 필요";
    case "STALLED":
      return `STALLED ${ago(h.since, now)}`;
    case "PENDING":
      return `PENDING approval ${ago(h.since, now)}`;
    case "UNANSWERED":
      return `UNANSWERED ${ago(h.since, now)}`;
    case "HUNG":
      return `HUNG ${ago(h.since, now)}`;
    case "CONTEXT":
      return "CONTEXT — RESTART";
    case "MODEL":
    case "PROVIDER":
      return `${h.code} — RELAUNCH`;
    default:
      return h.code;
  }
}

// ── ACCOUNT HOLD(ATC-51, docs/fuel.md 6): 사용 한도는 AIRCRAFT가 아니라 ACCOUNT의 것이다 ──
// 한 AIRCRAFT가 LIMIT에 걸리면 같은 ACCOUNT의 AIRCRAFT 모두를 그 reset까지 붙든다.
// 붙들린 형제는 health 코드를 받지 않는다(멈춘 것이 아니다). ACCOUNT를 모르면(라벨 없음) 붙들지 않는다.

export interface AccountHold {
  account: string;
  resetsAt?: string; // 가장 늦은 reset. 모르면 없다(LIMIT이 풀릴 때까지)
  weekly?: boolean;
  by: string[]; // LIMIT에 걸린 AIRCRAFT
}

// account가 없는(null) 항목은 계정을 모르는 것이라 붙들지 않는다. reset이 지난 LIMIT은 넣지 않는다
export function accountHolds(xs: { name: string; account?: string | null; health?: Health | null }[], now: number): Map<string, AccountHold> {
  const out = new Map<string, AccountHold>();
  for (const x of xs) {
    const h = x.health;
    if (!x.account || h?.code !== "LIMIT") continue;
    const reset = h.resetsAt ? Date.parse(h.resetsAt) : NaN;
    if (Number.isFinite(reset) && reset <= now) continue;
    const cur = out.get(x.account) ?? { account: x.account, by: [] };
    const later = h.resetsAt && (!cur.resetsAt || Date.parse(h.resetsAt) > Date.parse(cur.resetsAt));
    out.set(x.account, {
      ...cur,
      ...(later ? { resetsAt: h.resetsAt } : {}),
      ...(h.weekly || cur.weekly ? { weekly: true } : {}),
      by: [...cur.by, x.name],
    });
  }
  return out;
}

// 이 AIRCRAFT를 붙드는 ACCOUNT HOLD. 스스로 LIMIT에 걸린 AIRCRAFT는 자기 health로 보이므로 없다
export function accountHoldOf(holds: Map<string, AccountHold>, account: string | null | undefined, name: string): AccountHold | null {
  const h = account ? holds.get(account) : undefined;
  return h && !h.by.some((b) => sameReg(b, name)) ? h : null;
}

// FLEET 줄·DISPATCH 사유: HOLD · LIMIT (account pro-2) until 07:40Z
export function accountHoldLabel(h: AccountHold, now: number): string {
  return `HOLD · LIMIT (account ${h.account}${h.weekly ? ", weekly" : ""})${h.resetsAt ? ` until ${hhmm(Date.parse(h.resetsAt), now)}` : ""}`;
}
export const accountHoldDetail = (h: AccountHold) => `같은 ACCOUNT의 ${h.by.join(", ")}가 사용 한도에 걸림`;
export const ACCOUNT_HOLD_NEXT = "reset까지 기다린다. 이 AIRCRAFT는 멈추지 않았다 — 같은 ACCOUNT의 한도가 풀리면 다시 배정된다";

export interface HealthAlert {
  key: string;
  code: HealthCode;
  sessionIds: string[];
  message: string;
}

// ALERT 수준의 health를 경보로 묶는다. NETWORK는 기계 전체라 한 번.
// LIMIT은 ACCOUNT를 알면(ATC-51) 같은 ACCOUNT끼리 한 번(붙들린 형제도 적는다), 모르면 같은 reset 시각(같은 계정의 창)끼리 한 번
export function healthAlerts(xs: { sessionId: string; name: string; health: Health | null | undefined; account?: string | null }[], now: number): HealthAlert[] {
  const out: HealthAlert[] = [];
  const hot = xs.filter((x): x is typeof x & { health: Health } => x.health?.level === "alert");
  const group = (code: HealthCode, keyOf: (x: (typeof hot)[number]) => string) => {
    const by = new Map<string, typeof hot>();
    for (const x of hot.filter((y) => y.health.code === code)) by.set(keyOf(x), [...(by.get(keyOf(x)) ?? []), x]);
    return [...by.entries()];
  };
  for (const [, g] of group("NETWORK", () => "host")) {
    out.push({ key: "health|NETWORK", code: "NETWORK", sessionIds: g.map((x) => x.sessionId), message: `NETWORK — ${g.map((x) => x.name).join(", ")}가 API에 연결하지 못함: ${g[0]!.health.detail}` });
  }
  for (const [k, g] of group("LIMIT", (x) => (x.account ? `account:${x.account}` : (x.health.resetsAt ?? "?")))) {
    const account = g[0]!.account;
    const resets = g.map((x) => x.health.resetsAt).filter((r): r is string => Boolean(r)).sort();
    const reset = resets.at(-1);
    const weekly = g.some((x) => x.health.weekly);
    const limited = new Set(g.map((x) => x.sessionId));
    const siblings = account ? xs.filter((x) => x.account === account && !limited.has(x.sessionId)).map((x) => x.name) : [];
    out.push({
      key: `health|LIMIT|${k}`,
      code: "LIMIT",
      sessionIds: g.map((x) => x.sessionId),
      message:
        `LIMIT${account ? ` (account ${account})` : ""} — ${g.map((x) => (x.health.cut && x.health.cutAt ? `${x.name}(cut ${hhmm(Date.parse(x.health.cutAt), now)})` : x.name)).join(", ")} 사용 한도${weekly ? "(주간)" : ""}${reset ? `, reset ${hhmm(Date.parse(reset), now)}` : ""}까지 HOLD` +
        (siblings.length ? ` · 같은 ACCOUNT도 HOLD: ${siblings.join(", ")}` : ""),
    });
  }
  for (const x of hot.filter((y) => y.health.code !== "NETWORK" && y.health.code !== "LIMIT")) {
    out.push({ key: `health|${x.health.code}|${x.sessionId}`, code: x.health.code, sessionIds: [x.sessionId], message: `${x.health.code} — ${x.name}: ${x.health.detail}${x.health.code === "RESUME" ? " — SUPERVISOR가 그 세션에서 \"계속\"을 보낸다" : ""}` });
  }
  return out;
}

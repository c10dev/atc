import { hhmm } from "./health.ts";
import { registrationOf } from "./registration.ts";
import type { Transmission } from "./radio.ts";

// PENDING approval이 오래 가는 경우(ATC-327): 세션이 도구 승인 프롬프트에 선 채 사람을 기다린다.
// 순수 함수만 둔다(수준 셈, 글, 기다리는 호출 찾기, RADIO 사유). 읽기만 한다 — atc는 어디에도 보내지 않고, 승인은 SUPERVISOR가 그 세션에서 한다.

export const DEFAULT_PENDING_MIN = 10;

export interface WaitingCall {
  id: string; // C-0291, D-0336 …
  kind: string; // GO AROUND · FLIGHT PLAN · CREW CHANGE · RECALL …
}

const MIN = 60_000;
const CONTROL = /^(TOWER|OCC|MCC)\b/;

// 그 AIRCRAFT(REGISTRATION)에게 가는, 아직 닫는 답이 없는 호출(CLEARANCE, FLIGHT PLAN, CREW CHANGE, RECALL). 오래된 것부터
export function waitingCallsOf(txs: readonly Transmission[], reg: string): WaitingCall[] {
  return txs
    .filter((t) => t.open && t.aircraft === reg && CONTROL.test(t.from))
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((t) => ({ id: t.id, kind: t.kind }));
}

// REGISTRATION → 기다리는 호출. 호출이 있는 AIRCRAFT만 담는다
export function waitingCallsByAircraft(txs: readonly Transmission[]): Map<string, WaitingCall[]> {
  const regs = new Set(txs.flatMap((t) => (t.open && t.aircraft && CONTROL.test(t.from) ? [t.aircraft] : [])));
  return new Map([...regs].map((r) => [r, waitingCallsOf(txs, r)] as const));
}

// 수준: pendingMin분이 지났거나 기다리는 호출이 하나라도 있으면 CAUTION, 아니면 ADVISORY(켜진 지 얼마 안 되는 승인은 시끄럽게 하지 않는다)
export function pendingLevelOf(i: { since: string | null; now: number; pendingMin: number; calls: number }): "caution" | "advisory" {
  if (i.calls > 0) return "caution";
  const t = i.since ? Date.parse(i.since) : NaN;
  return Number.isFinite(t) && i.now - t >= i.pendingMin * MIN ? "caution" : "advisory";
}

// 5h45m · 11m. 분이 없으면 시간만
const ago = (since: string | null, now: number) => {
  const t = since ? Date.parse(since) : NaN;
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.floor((now - t) / MIN));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") + "m" : ""}`;
};

// "TEAM_O — PENDING approval 5h45m · 3 calls waiting (GO AROUND C-0291, FLIGHT PLAN D-0336, D-0340) · approve Write: …"
export function pendingTextOf(i: { name: string; since: string | null; now: number; calls: readonly WaitingCall[]; needs: string | null }): string {
  const parts = [`${i.name} — PENDING approval ${ago(i.since, i.now)}`.trim()];
  if (i.calls.length) {
    // 같은 종류는 묶는다: FLIGHT PLAN D-0336, D-0340
    const byKind = new Map<string, string[]>();
    for (const c of i.calls) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c.id]);
    const list = [...byKind].map(([k, ids]) => `${k} ${ids.join(", ")}`).join(", ");
    parts.push(`${i.calls.length} call${i.calls.length === 1 ? "" : "s"} waiting (${list})`);
  }
  if (i.needs) parts.push(i.needs);
  return parts.join(" · ");
}

// Claude Code가 state: working과 함께 적은 needs("approve Write: …")는 health가 PENDING일 때만 보인다(ATC-133·138의 blocked 규칙과 섞이지 않는다)
export function pendingNeedsOf(s: { status?: string; health?: { code: string } | null; job?: { pendingNeeds?: string | null } | null }): string | null {
  if (s.status === "dead" || s.health?.code !== "PENDING") return null;
  return s.job?.pendingNeeds ?? null;
}

// RADIO: 받는 AIRCRAFT가 승인을 기다리는 중이면 호출 줄에 사유를 붙인다(서버가 정한다, 화면은 그리기만)
export function pendingReasonOf(sinceIso: string, now?: number): string {
  return `receiver waiting for approval since ${hhmm(Date.parse(sinceIso), now)}`;
}
export function annotatePending(txs: readonly Transmission[], sinceOf: (reg: string) => string | null, now?: number): Transmission[] {
  return txs.map((t) => {
    if (!t.open || !t.aircraft || !CONTROL.test(t.from)) return t;
    const since = sinceOf(t.aircraft);
    return since ? { ...t, reason: pendingReasonOf(since, now) } : t;
  });
}

// 살아 있는 세션 가운데 PENDING인 것의 REGISTRATION → 그 PENDING이 시작된 시각
export function pendingSinceByAircraft(
  sessions: readonly { name: string; status: string; health?: { code: string; since: string } | null }[],
  teamPattern?: string,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of sessions) {
    if (s.status === "dead" || s.health?.code !== "PENDING") continue;
    const reg = registrationOf(s.name, teamPattern);
    if (reg) out.set(reg, s.health.since);
  }
  return out;
}

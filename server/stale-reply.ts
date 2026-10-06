// 닫혔거나 뒤의 부름에 밀린 CLEARANCE·FLIGHT PLAN·CREW CHANGE에 온 답을 거절한다(ATC-554, 순수 함수).
// 같은 주제로 뒤에 나간 부름이 있으면 옛 id에 온 READBACK·UNABLE·STANDBY는 받지 않고 "answer the latest call <id>"로 최신 id를 알린다.
// 다시 보낸 부름에 옛 id로 답한 팀이 답한 것으로 세어지지 않게 한다. 스위치는 SUPERVISOR만 바꾼다(기본 on).

export const STALE_REPLY_SWITCHES = ["off", "on"] as const;
export type StaleReplySwitch = (typeof STALE_REPLY_SWITCHES)[number];
export const parseStaleReplySwitch = (raw: unknown): StaleReplySwitch => (raw === "off" ? "off" : "on");

export type CallKind = "clearance" | "flight-plan" | "crew-change";

// 나간 부름 하나: id의 숫자가 클수록 나중에 나갔다. 나가지 않은 부름(FLIGHT PLAN의 proposed·approved 등)은 목록에 넣지 않는다
export interface CallRef {
  id: string;
  subject: string;
}

const seq = (id: string) => Number(id.replace(/^\D+/, "")) || 0;

// 이 id에 온 답을 거절할 사유(영어, 짧게). 최신이거나 모르는 id면 null — 없는 id는 호출부가 404로 처리한다
export function staleReplyWhy(id: string, calls: readonly CallRef[]): string | null {
  const me = calls.find((c) => c.id === id);
  if (!me) return null;
  const later = calls.filter((c) => c.subject === me.subject && seq(c.id) > seq(me.id));
  if (!later.length) return null;
  const latest = later.reduce((a, b) => (seq(b.id) > seq(a.id) ? b : a)).id;
  return `${id} is closed or superseded by a later call for the same subject — answer the latest call ${latest}`;
}

interface ClearanceLike {
  id: string;
  to: string;
  type: string;
  flight: string | null;
}
export const clearanceCalls = (list: readonly ClearanceLike[]): CallRef[] => list.map((c) => ({ id: c.id, subject: `${c.to}|${c.type}|${c.flight ?? ""}` }));

interface ProposalLike {
  id: string;
  kind: string;
  flight: string;
  timeline: Partial<Record<string, string>>;
}
// 보낸(sent 시각이 있는) FLIGHT PLAN만: 제안만 되고 팀에 가지 않은 카드는 부름이 아니다
export const flightPlanCalls = (list: readonly ProposalLike[]): CallRef[] => list.filter((p) => p.timeline.sent).map((p) => ({ id: p.id, subject: `${p.kind}|${p.flight}` }));

interface CrewChangeLike {
  id: string;
  registration: string;
  sentAt: string | null;
}
export const crewChangeCalls = (list: readonly CrewChangeLike[]): CallRef[] => list.filter((c) => c.sentAt).map((c) => ({ id: c.id, subject: c.registration.toUpperCase() }));

// 기록(stale-reply-events.jsonl, 추가만): 거절한 답 하나가 한 줄
export interface StaleReplyEvent {
  t: string;
  kind: CallKind;
  id: string;
  op: string;
  latest: string;
}

// 최근 days일에 거절한 답의 수(종류별). 0도 보인다
export function staleReplyCounterOf(events: readonly StaleReplyEvent[], now: number, days: number) {
  const since = now - days * 86_400_000;
  const inWin = events.filter((e) => Date.parse(e.t) >= since);
  const by = (k: CallKind) => inWin.filter((e) => e.kind === k).length;
  return { refused: inWin.length, clearance: by("clearance"), flightPlan: by("flight-plan"), crewChange: by("crew-change"), days };
}

export const latestOfReason = (why: string) => why.match(/answer the latest call (\S+)$/)?.[1] ?? "";

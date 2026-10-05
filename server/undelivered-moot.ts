// UNDELIVERED 줄이 이미 쓸모없는지(ATC-540). 손으로 전할 글이 더는 의미가 없으면 줄을 큐에서 뺀다(기록은 그대로). 순수
// 클리어런스·RELAY·FLIGHT PLAN 세 갈래가 같은 함수를 쓴다(supervisor-queue.ts)

// 닿지 못한 글을 큐에 두는 기간. CLEARANCE와 RELAY가 한 상수를 쓴다
export const HAND_KEEP_MS = 3 * 86_400_000;

const ENDED = new Set(["completed", "canceled", "duplicate"]);
// PR 하나에 묶이는 종류(GO AROUND·FIX·LAND): 본문에 번호가 없어도 그 FLIGHT·STAND의 PR이 사라지면 쓸모없다
const PR_BOUND = new Set(["GO AROUND", "FIX", "LAND"]);

export interface MootMsg {
  at: string | null; // 닿지 못한 시각(나이의 기준)
  flight: string | null;
  type: string | null; // 같은 종류인지(CLEARANCE type, RELAY type·kind, FLIGHT PLAN kind)
  pr: number | null; // 알고 있는 PR 번호(RELAY.pr)
  text: string | null;
  stand: string | null;
  closed: boolean; // CLEARANCE가 더는 열려 있지 않음(취소·답함)
  newerDelivered: boolean; // 같은 FLIGHT·종류의 더 새 글이 닿았음
}

export interface MootCtx {
  now: number;
  githubKnown: boolean; // GitHub를 읽었을 때만 "PR이 닫힘"을 판단한다(못 읽었으면 모른다)
  pulls: readonly { number: number; ticketKey: string | null; standPath?: string | null }[]; // 열린 PR
  tickets: readonly { key: string; stateType: string }[];
}

// 글이 말하는 PR 번호: 알려진 번호, 본문의 `#123`·`pull/123`
export function prRefsOf(m: Pick<MootMsg, "pr" | "text">): number[] {
  const out = new Set<number>();
  if (m.pr != null) out.add(m.pr);
  for (const x of (m.text ?? "").matchAll(/(?:#|pull\/)(\d{1,6})\b/g)) out.add(Number(x[1]));
  return [...out];
}

export function isMoot(m: MootMsg, ctx: MootCtx): boolean {
  if (m.closed || m.newerDelivered) return true;
  if (m.at && ctx.now - Date.parse(m.at) > HAND_KEEP_MS) return true;
  const t = m.flight ? ctx.tickets.find((x) => x.key === m.flight) : undefined;
  if (t && ENDED.has(t.stateType)) return true;
  if (ctx.githubKnown) {
    const refs = prRefsOf(m);
    if (refs.length) return !refs.some((n) => ctx.pulls.some((p) => p.number === n));
    if (m.type && PR_BOUND.has(m.type) && (m.flight || m.stand)) return !ctx.pulls.some((p) => (m.flight && p.ticketKey === m.flight) || (m.stand && p.standPath === m.stand));
  }
  return false;
}

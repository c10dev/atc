import type { Clearance } from "./model.ts";
import { prNumbersOf } from "./stale-reply.ts";

// RESEND 기록(ATC-565, docs/control-recycle.md 2.3 항목 3). 순수 함수.
// TOWER는 NO READBACK에 같은 CLEARANCE를 새 CLEARANCE로 한 번 더 보낸다(글 맨 앞 "RESEND", controller/CLAUDE.md). 서버는 그 둘을 잇지 않았다:
// "이미 RESEND했다"는 대화에만 있어 새 TOWER가 두 번째 RESEND를 하거나 "답 없음" 보고를 놓쳤다. 여기서 기록(clearances.jsonl)만으로 잇는다.
// 새 op나 atcctl 명령이 없다: 이은 것은 읽을 때마다 같은 기록에서 같은 답이 나온다(옛 기록에도 그대로 맞는다)

export const isResendText = (text: string) => /^RESEND\b/.test(text.trim());

// 같은 부름인가: 같은 세션·종류·STAND·FLIGHT와 글에 든 PR 번호(stale-reply.ts와 같은 PR 번호 규칙)
const subjectOf = (c: Pick<Clearance, "to" | "type" | "stand" | "flight" | "text">) => `${c.to}|${c.type}|${c.stand ?? ""}|${c.flight ?? ""}|${prNumbersOf(c.text)}`;
const seq = (id: string) => Number(id.replace(/^\D+/, "")) || 0;
const answered = (c: Clearance) => Boolean(c.readbackAt || c.unableAt);

export interface ResendLink {
  resendOf?: string; // 이 CLEARANCE가 RESEND인 원래 CLEARANCE
  resentBy: string[]; // 원래 CLEARANCE: 그 뒤 나간 RESEND들(나간 순서)
  answeredVia?: string; // 같은 고리(원래 + RESEND)의 다른 CLEARANCE가 READBACK·ROGER·UNABLE로 닫혔다. 이 CLEARANCE에는 더 답이 오지 않는다
}

// RESEND 하나가 가리키는 원래 CLEARANCE: 먼저 나간, RESEND가 아닌 같은 부름 가운데
// 아직 RESEND가 없는 가장 늦은 것, 없으면 가장 늦은 것(두 번째 RESEND). 원래 것이 닫혔어도 잇는다(기록이니까)
export function resendLinksOf(clearances: readonly Clearance[]): Map<string, ResendLink> {
  const out = new Map<string, ResendLink>();
  const link = (id: string) => {
    let l = out.get(id);
    if (!l) out.set(id, (l = { resentBy: [] }));
    return l;
  };
  const roots = new Map<string, Clearance[]>(); // subject → RESEND가 아닌 CLEARANCE(나간 순서)
  for (const c of [...clearances].sort((a, b) => seq(a.id) - seq(b.id))) {
    const subject = subjectOf(c);
    if (!isResendText(c.text)) {
      roots.set(subject, [...(roots.get(subject) ?? []), c]);
      continue;
    }
    const cand = roots.get(subject) ?? [];
    if (!cand.length) continue;
    const fresh = cand.filter((r) => !(out.get(r.id)?.resentBy.length));
    const root = (fresh.length ? fresh : cand).at(-1)!;
    link(root.id).resentBy.push(c.id);
    link(c.id).resendOf = root.id;
  }
  // 고리 안 하나가 답을 받았으면 나머지에 표시한다(팀은 마지막 부름에 답하고, ATC-554가 옛 id의 답을 거절한다)
  const byId = new Map(clearances.map((c) => [c.id, c]));
  for (const [id, l] of out) {
    if (!l.resentBy.length) continue;
    const chain = [id, ...l.resentBy].map((x) => byId.get(x)).filter((c): c is Clearance => Boolean(c));
    const via = chain.find(answered);
    if (!via) continue;
    for (const c of chain) if (c.id !== via.id && !answered(c)) link(c.id).answeredVia = via.id;
  }
  return out;
}

// 고리의 뿌리(원래 CLEARANCE) id
export const chainRootOf = (id: string, links: ReadonlyMap<string, ResendLink>) => links.get(id)?.resendOf ?? id;

// TOWER brief의 pending 항목에 붙는 칸. 고리에 들지 않으면 아무 칸도 없다(오늘과 같은 모양)
export function resendViewOf(l: ResendLink | undefined): { resendOf?: string; resentBy?: string[]; answeredVia?: string } {
  if (!l) return {};
  return { ...(l.resendOf ? { resendOf: l.resendOf } : {}), ...(l.resentBy.length ? { resentBy: l.resentBy } : {}), ...(l.answeredVia ? { answeredVia: l.answeredVia } : {}) };
}

import { isCandidateTicket } from "./dispatch.ts";
import type { ReviewLine } from "./duty-review.ts";
import { parentKeysOf, type Ticket } from "./model.ts";

// 제안 목록(ATC-401): atc가 SUPERVISOR 몫으로 Backlog에 올린 이슈 — DUTY REVIEW(duty-reviews.jsonl의 proposal 줄)와
// SCHEDULE NEW(반영된 초안의 appliedRef). RELEASE 화면이 이것을 보이고 한 번의 클릭으로 발권하거나 버린다. 순수 함수만.
// SUPERVISOR가 직접 만든 Backlog 이슈는 이 출처에 없으므로 제안이 아니다.

export interface ProposalSource {
  by: string; // 누가 제안했나("DUTY REVIEW R-0007", "SCHEDULE S-0012")
  at: string; // 제안한 시각
}

const KEY = /^[A-Z][A-Z0-9]*-\d+$/;

// 이슈 key → 제안 출처. 같은 이슈가 둘에 다 있으면 더 이른 쪽
export function proposalSourcesOf(
  reviews: readonly ReviewLine[],
  scheduleOps: readonly { id: string; kind: string; status: string; statusAt: string; appliedRef: string | null }[],
): Map<string, ProposalSource> {
  const out = new Map<string, ProposalSource>();
  const put = (key: string, s: ProposalSource) => {
    const have = out.get(key);
    if (!have || s.at < have.at) out.set(key, s);
  };
  for (const l of reviews) if (l.ev === "proposal" && KEY.test(l.key)) put(l.key, { by: `DUTY REVIEW ${l.review}`, at: l.at });
  for (const o of scheduleOps) if (o.kind === "NEW" && o.status === "applied" && o.appliedRef && KEY.test(o.appliedRef)) put(o.appliedRef, { by: `SCHEDULE ${o.id}`, at: o.statusAt });
  return out;
}

export interface FiledRow {
  key: string;
  title: string;
  state: string; // Linear 상태 이름(Todo로 옮길 때 from)
  hash: string | null;
  priority: number;
  kEffects: string | null;
  by: string;
  at: string;
}

const FINISHED = new Set(["completed", "canceled"]);

// 아직 쏘지 않은 제안: Backlog에 있고(Todo 이상이면 쏜 것, Canceled면 버린 것), 후보 팀의 이슈이며, 열린 이슈가 막고 있지 않다.
// 막는 이슈가 모두 끝났으면 목록에 든다(막힌 동안은 없다가 풀리면 나타난다). 상태를 모르는 막는 이슈는 열린 것으로 본다. 오래된 제안이 위
export function filedProposalsOf(tickets: readonly Ticket[], sources: ReadonlyMap<string, ProposalSource>, teams: Set<string>): FiledRow[] {
  if (!sources.size) return [];
  const parents = parentKeysOf(tickets as Ticket[]);
  const typeOf = new Map(tickets.map((t) => [t.key, t.stateType]));
  return tickets
    .filter((t) => {
      if (t.stateType !== "backlog" || !sources.has(t.key) || parents.has(t.key) || !isCandidateTicket(t, teams)) return false;
      return t.blockedBy.every((k) => FINISHED.has(typeOf.get(k) ?? ""));
    })
    .map((t): FiledRow => {
      const s = sources.get(t.key)!;
      return { key: t.key, title: t.title, state: t.state, hash: t.releaseHash ?? null, priority: t.priority, kEffects: t.kEffects ?? null, by: s.by, at: s.at };
    })
    .sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key, "en", { numeric: true }));
}

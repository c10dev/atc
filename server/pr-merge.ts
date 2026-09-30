// MERGE 버튼(DUTY G2, docs/duty.md 3.6)의 순수 판정. 쓰기는 pr-merge-run.ts. 서버는 스스로 머지하지 않는다:
// 이 판정을 지난 SUPERVISOR의 클릭 하나가 PR 하나를 정확히 그 head로 한 번 머지한다.
// user 등급(또는 MCC가 ESCALATE한) PR만: auto·flagged는 MCC의 몫이다. auto-merge는 켜지 않는다.

export type MergeMethod = "merge" | "squash" | "rebase";
export type Tier = "auto" | "flagged" | "user";

const SHA40 = /^[0-9a-f]{40}$/;

// 요청 본문 {head}: 40자 전체 sha(정확한 head). 짧은 sha·다른 모양은 400
export function parseMergeBody(raw: unknown): { ok: true; head: string } | { ok: false; error: string } {
  const b = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const head = typeof b.head === "string" ? b.head.trim().toLowerCase() : "";
  if (!SHA40.test(head)) return { ok: false, error: "본문은 {head}: 화면이 보여 준 head의 40자 sha" };
  return { ok: true, head };
}

// AIRPORT의 머지 방식. MCC AIRPORT(atc 저장소)는 merge 커밋(MCC 착륙과 같다), 그 밖은 AUTOLAND가 정한 방식
export const mergeMethodOf = (airportCode: string, mccAirport: string, autolandMethod: MergeMethod): MergeMethod => (airportCode === mccAirport ? "merge" : autolandMethod);

export interface MergeFacts {
  isMccAirport: boolean; // atc의 등급 규칙(deploy/landing-tier.mjs)이 미치는 곳은 MCC AIRPORT뿐이다
  // 지금 GitHub의 PR
  live: { state: string; draft: boolean; head: string; base: string; fork: boolean };
  defaultBranch: string;
  tier: Tier | null; // 지금 바뀐 파일 전부로 잰 등급. 못 쟀으면 null
  escalated: boolean; // MCC가 ESCALATE함(사용자 등급으로 올림)
  held: boolean; // SUPERVISOR HOLD
  // atc가 폴링해 아는 것(열린 PR). 없으면 null
  polled: { head: string; landing: "CLEARED" | "APPROACH"; blocks: readonly string[] } | null;
}
export type MergeVerdict = { ok: true } | { ok: false; status: 403 | 409; error: string; currentHead?: string; blocks?: string[] };

// 머지해도 되나. 순서: MCC AIRPORT인가(403) → 열려 있고 Draft·fork가 아니고 기본 브랜치로 가는가(409) → head가 그대로인가(409, 새 head를 돌려줌)
// → user 등급인가(403) → HOLD가 아닌가(409) → atc가 이 head를 봤고 CLEARED인가(409)
export function mergeVerdictOf(requestHead: string, f: MergeFacts): MergeVerdict {
  if (!f.isMccAirport) return { ok: false, status: 403, error: "이 화면의 MERGE는 MCC AIRPORT(atc 저장소)의 user 등급 PR만 머지한다" };
  if (f.live.state !== "open") return { ok: false, status: 409, error: `열린 PR이 아님(${f.live.state})` };
  if (f.live.draft) return { ok: false, status: 409, error: "Draft PR은 머지하지 않는다" };
  if (f.live.fork) return { ok: false, status: 409, error: "fork에서 온 PR은 머지하지 않는다" };
  if (f.live.base !== f.defaultBranch) return { ok: false, status: 409, error: `기본 브랜치(${f.defaultBranch})로 가는 PR이 아님(${f.live.base})` };
  if (f.live.head !== requestHead) return { ok: false, status: 409, error: `head가 움직임: 지금 ${f.live.head.slice(0, 7)} (화면은 ${requestHead.slice(0, 7)}) — 다시 열어 새 head를 확인한다`, currentHead: f.live.head };
  if (f.tier === null) return { ok: false, status: 409, error: "등급을 읽지 못함 — 잠시 뒤 다시" };
  if (f.tier !== "user" && !f.escalated) return { ok: false, status: 403, error: `${f.tier} 등급 PR은 MCC가 착륙시킨다(이 화면은 user 등급만)` };
  if (f.held) return { ok: false, status: 409, error: "SUPERVISOR HOLD가 걸려 있음 — 먼저 푼다" };
  if (!f.polled || f.polled.head !== f.live.head) return { ok: false, status: 409, error: "atc가 이 head를 아직 판단하지 않았음 — 다음 폴링(90초 안) 뒤 다시" };
  if (f.polled.landing !== "CLEARED") return { ok: false, status: 409, error: "CLEARED TO LAND가 아님", blocks: [...f.polled.blocks] };
  return { ok: true };
}

// PR 서랍이 MERGE 버튼을 보일지(캐시된 자료로, 눌렀을 때 서버가 다시 판정한다)
export interface MergeInfo {
  allowed: boolean;
  why: string | null; // 안 되는 까닭(버튼 자리에 보인다). 되면 null
  head: string;
  tier: Tier | null;
  escalated: boolean;
  method: MergeMethod;
}
export function mergeInfoOf(f: MergeFacts, method: MergeMethod): MergeInfo {
  const v = mergeVerdictOf(f.live.head, f);
  return { allowed: v.ok, why: v.ok ? null : v.error, head: f.live.head, tier: f.tier, escalated: f.escalated, method };
}

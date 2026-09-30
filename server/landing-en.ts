// 착륙 막힘 조건의 영어 문구(ATC-174). 화면은 한국어 `text`를 쓰고, TOWER가 팀에 보내는 INFO는 이 영어 글을 쓴다(ATC-126).
// 코드마다 순수 함수 하나. 한국어 문구와 같은 자료에서 만들어 서버가 둘을 함께 낸다.

const namesEn = (xs: string[]) => (xs.length > 3 ? `${xs.slice(0, 3).join(", ")} and ${xs.length - 3} more` : xs.join(", "));

export const noChecksEn = () => "no CI checks on the head commit";
export const checksPendingEn = (pending: string[]) => `CI in progress: ${namesEn(pending)}`;
export const checksFailedEn = (failed: string[]) => `CI failed: ${namesEn(failed)}`;
export const draftEn = () => "the PR is a draft";
export const changesRequestedEn = (requesters: string[]) =>
  requesters.length ? `changes requested (CHANGES_REQUESTED) by ${namesEn(requesters)} still stand` : "a change request (CHANGES_REQUESTED) still stands";
export const noReviewEn = (noteEn: string) => `no review: ${noteEn}`;
export const reviewStaleEn = (oldHead: string, noteEn: string) => `the only review is on an earlier commit ${oldHead}: ${noteEn}`;
export const behindEn = () => "behind base: rebase needed";
export const dirtyEn = () => "conflicts with base: resolve the conflicts";
export const blockedEn = (unresolvedThreads?: number) =>
  unresolvedThreads
    ? `GitHub branch protection blocks the merge — ${unresolvedThreads} unresolved review thread${unresolvedThreads === 1 ? "" : "s"} (threads must be resolved before merging)`
    : "GitHub branch protection blocks the merge";
export const mergeUnknownEn = () => "GitHub is still computing whether the PR can merge";
export const losEn = () => "a LOSS OF SEPARATION is open on the STAND";

// 등급을 알 수 있는 Codex 지적 요약의 영어 개수. counts는 "P0 1 · P2 2" 꼴(등급 이름은 영어 그대로)
export const countsEn = (counts: string, unmarked: number) => counts + (unmarked ? ` (${unmarked} without a severity mark counted as P2)` : "");
export const codexFindingsEn = (head: string, countsE: string | null) =>
  countsE ? `Codex findings on head ${head} (${countsE}) — fix and get a re-review` : `Codex findings on head ${head} — fix and get a re-review`;
export const codexP3OpenEn = (head: string, p3: number, open: number) =>
  `${open} of ${p3} Codex P3 finding${p3 === 1 ? "" : "s"} on head ${head} ${open === 1 ? "has" : "have"} no resolution or reply — resolving the thread or replying lifts the block`;
export const carriedFindingsEn = (who: string, from: string) =>
  `${who} findings remain on the earlier commit ${from} (only main merges since) — fix and get a re-review`;
export const mccFindingsEn = (head: string, p: [number, number, number], text: string) =>
  `MCC INSPECTION findings (head ${head}, P0 ${p[0]} · P1 ${p[1]} · P2 ${p[2]}): ${text} — fix and re-inspect on the new head`;
export const extFindingsEn = (reviewer: string, security: boolean, whyEn: string, head: string, p: [number, number, number], text: string) =>
  `${reviewer} findings (${security ? "security, " : ""}${whyEn}, head ${head}, P0 ${p[0]} · P1 ${p[1]} · P2 ${p[2]}): ${text} — fix and get a re-review on the new head`;

// 외부 리뷰 제외·보안 사유(externalGateOf가 한국어로 만든 값)의 영어. 아는 꼴이 아니고 한글이 남으면 자리표시로 바꾼다
export function gateReasonEn(reason: string | null): string {
  if (!reason) return "unspecified";
  const r = reason.trim();
  const m = /^(FLIGHT 없음|비밀·키 경로|키워드)(?:\s+(.*))?$/.exec(r);
  if (m) {
    const kind = m[1] === "FLIGHT 없음" ? "no FLIGHT" : m[1] === "키워드" ? "security keyword" : "secret or key path";
    return m[2] ? `${kind} ${m[2]}` : kind;
  }
  return /[\u3131-\uD79D]/.test(r) ? "see the screen" : r;
}

// no-review·review-stale 뒤에 붙는 사유
export const noteExcludedEn = (whyEn: string, reason: string | null) => `${whyEn} — excluded from external review (${gateReasonEn(reason)}) — needs a Codex or SUPERVISOR review`;
export const noteWaitingEn = (whyEn: string, security: string | null) => `${whyEn} — waiting for the landing review (REVIEW session${security ? `, security PR: ${gateReasonEn(security)}` : ""})`;
export const noteLimitEn = () => "Codex limit — needs a human review";
export const noteMccEn = (head: string) => `waiting for the MCC INSPECTION of head ${head}`;
export const noteReviewEn = (head: string, oldThumbs: boolean) => `head ${head} needs a review${oldThumbs ? " (the Codex thumbs-up is for an earlier commit)" : ""}`;

export const codexWhyEn = (why: string, silentHours: number) =>
  why === "limit" ? "Codex limit" : why === "autoland" ? "AUTOLAND re-review — Codex silent for 30 minutes" : `Codex silent for ${silentHours} hours`;

export const carriedWhoEn = (by: string) => (by === "human" ? "human APPROVED" : by === "codex" ? "Codex" : "REVIEW");

// 쌓인 PR. 한국어 stackedText와 같은 인자
export function stackedEn(pr: { number: number; baseRefName: string }, stack: { base: number | null; chain: number[] } | null, defaultBranch: string): string {
  if (!stack?.base) return `stacked PR — base is not ${defaultBranch} (${pr.baseRefName}); change the base to ${defaultBranch} before it can land`;
  const ahead = stack.chain.slice(0, stack.chain.indexOf(pr.number));
  return `stacked PR — after ${ahead.map((n) => `#${n}`).join(", ")} lands in ${defaultBranch}, the base moves to ${defaultBranch} (${stack.chain.map((n) => `#${n}`).join(" → ")})`;
}

// TOWER가 holders에게 보내는 APPROACH INFO 본문(영어). 막힘이 없으면 null
export function infoTextOf(pr: number, blocksEn: readonly string[]): string | null {
  return blocksEn.length ? `PR #${pr} cannot land yet: ${blocksEn.join(" · ")}` : null;
}

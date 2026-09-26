import type { Alert, LandingBlockCode, PullRequest, Workspace } from "./model.ts";

// CLEARED TO LAND 판정. GitHub에 열린 PR 하나마다 머지 전에 기계로 볼 수 있는 조건을 모두 따진다.
// 결정 사항(docs/occ.md 9절):
// - CI: rollup(head 커밋 기준)의 체크를 모두 required로 본다. NEUTRAL·SKIPPED는 통과. 체크가 하나도 없으면 막는다.
// - 리뷰: head 커밋에 PR 작성자가 아닌 사람(봇 포함)의 APPROVED·COMMENTED 리뷰가 있어야 한다.
//   또는 Codex 봇의 👍(+1) 반응이 head 커밋의 committer 시각 이후에 달렸다(Codex의 "큰 문제 없음" 신호).
//   그 밖의 댓글·반응은 세지 않는다. 누군가의 마지막 판정이 CHANGES_REQUESTED면 막는다.
// - base: CLEAN·UNSTABLE·HAS_HOOKS는 통과(UNSTABLE의 원인은 CI 조건이 따로 잡는다). BEHIND·DIRTY·BLOCKED·UNKNOWN은 막는다.

// gh pr list --json 결과 (필요한 필드만)
export interface GhCheck {
  __typename?: string; // "CheckRun" | "StatusContext"
  name?: string;
  context?: string;
  workflowName?: string;
  status?: string; // CheckRun: COMPLETED | IN_PROGRESS | QUEUED …
  conclusion?: string | null; // CheckRun: SUCCESS | FAILURE | NEUTRAL | SKIPPED …
  state?: string; // StatusContext: SUCCESS | PENDING | FAILURE | ERROR | EXPECTED
  startedAt?: string | null;
}

export interface GhReview {
  author: { login: string } | null;
  state: string; // APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED | PENDING
  submittedAt: string | null;
  commit: { oid: string } | null;
}

// Codex 자동 리뷰 봇. GraphQL(reviews)은 [bot] 없이, REST(reactions·comments)는 [bot]을 붙여 준다.
export const CODEX_BOTS = ["chatgpt-codex-connector", "chatgpt-codex-connector[bot]"];
export const isCodexBot = (login: string | null | undefined) => Boolean(login && CODEX_BOTS.includes(login));

// head 리뷰가 없는 PR에만 따로 읽는 Codex 신호(sources/github.ts)
export interface CodexSignal {
  headAt: string | null; // head 커밋의 committer 시각
  thumbsAt: string | null; // Codex 봇의 👍(+1) 반응 시각
  lastComment: { at: string; limit: boolean } | null; // Codex 봇의 마지막 PR 댓글, limit: "usage limits" 안내
}

export interface GhPull {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  isDraft: boolean;
  mergeStateStatus: string;
  reviewDecision: string | null;
  createdAt: string;
  author: { login: string } | null;
  statusCheckRollup: GhCheck[] | null;
  reviews: GhReview[] | null;
  reactionGroups?: { content: string; users: { totalCount: number } }[] | null;
  codex?: CodexSignal; // atc가 붙인다. 없으면 아직 안 읽었음
}

type Block = PullRequest["blocks"][number];
const block = (code: LandingBlockCode, text: string): Block => ({ code, text });
const short = (oid: string) => oid.slice(0, 7);
const names = (xs: string[]) => (xs.length > 3 ? `${xs.slice(0, 3).join(", ")} 외 ${xs.length - 3}개` : xs.join(", "));

const CHECK_OK = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

// 같은 체크가 다시 돌면 가장 늦게 시작한 것만 본다.
function latestChecks(rollup: GhCheck[]): GhCheck[] {
  const byKey = new Map<string, GhCheck>();
  for (const c of rollup) {
    const key = `${c.__typename ?? ""}|${c.workflowName ?? ""}|${c.name ?? c.context ?? ""}`;
    const prev = byKey.get(key);
    if (!prev || (c.startedAt ?? "") >= (prev.startedAt ?? "")) byKey.set(key, c);
  }
  return [...byKey.values()];
}

function checkState(c: GhCheck): "ok" | "pending" | "failed" {
  if (c.__typename === "StatusContext" || (c.state && !c.status)) {
    if (c.state === "SUCCESS") return "ok";
    if (c.state === "PENDING" || c.state === "EXPECTED") return "pending";
    return "failed";
  }
  if (c.status !== "COMPLETED") return "pending";
  return CHECK_OK.has(c.conclusion ?? "") ? "ok" : "failed";
}

export function checkBlocks(rollup: GhCheck[] | null): Block[] {
  const checks = latestChecks(rollup ?? []);
  if (!checks.length) return [block("no-checks", "head 커밋에 CI 체크가 없음")];
  const label = (c: GhCheck) => c.name ?? c.context ?? "?";
  const failed = checks.filter((c) => checkState(c) === "failed").map(label);
  const pending = checks.filter((c) => checkState(c) === "pending").map(label);
  const out: Block[] = [];
  if (pending.length) out.push(block("checks-pending", `CI 진행 중: ${names(pending)}`));
  if (failed.length) out.push(block("checks-failed", `CI 실패: ${names(failed)}`));
  return out;
}

const COUNTS_AS_REVIEW = new Set(["APPROVED", "COMMENTED"]);
const VERDICT = new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]);

type ReviewInput = Pick<GhPull, "headRefOid" | "author" | "reviews" | "reviewDecision" | "codex">;

// 작성자가 아닌 사람의 리뷰(APPROVED·COMMENTED)
function countedReviews(pr: ReviewInput): GhReview[] {
  const author = pr.author?.login ?? null;
  return (pr.reviews ?? []).filter((r) => (r.author?.login !== author || author === null) && COUNTS_AS_REVIEW.has(r.state) && r.commit?.oid);
}

// head 커밋에 리뷰가 있나. 없으면 atc가 Codex 👍·댓글을 따로 읽는다.
export const hasHeadReview = (pr: ReviewInput) => countedReviews(pr).some((r) => r.commit!.oid === pr.headRefOid);

const atOrAfter = (t: string | null | undefined, since: string | null | undefined) =>
  Boolean(t && since && Date.parse(t) >= Date.parse(since));

export function reviewBlocks(pr: ReviewInput): Block[] {
  const author = pr.author?.login ?? null;
  const reviews = (pr.reviews ?? []).filter((r) => r.author?.login !== author || author === null);
  const out: Block[] = [];

  // 사람마다 마지막 판정(COMMENTED 제외). GitHub의 reviewDecision은 필수 리뷰가 없으면 비어 있어서 따로 센다.
  const lastVerdict = new Map<string, GhReview>();
  for (const r of [...reviews].sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""))) {
    if (VERDICT.has(r.state)) lastVerdict.set(r.author?.login ?? "?", r);
  }
  const requesters = [...lastVerdict].filter(([, r]) => r.state === "CHANGES_REQUESTED").map(([who]) => who);
  if (requesters.length) out.push(block("changes-requested", `${names(requesters)}의 변경 요청(CHANGES_REQUESTED)이 남아 있음`));
  else if (pr.reviewDecision === "CHANGES_REQUESTED") out.push(block("changes-requested", "변경 요청(CHANGES_REQUESTED)이 남아 있음"));

  if (hasHeadReview(pr)) return out;
  // Codex는 문제가 없으면 리뷰 대신 PR에 👍만 단다. head 커밋 뒤에 달린 것만 이 head의 리뷰로 친다.
  const c = pr.codex;
  if (atOrAfter(c?.thumbsAt, c?.headAt)) return out;
  const limited = Boolean(c?.lastComment?.limit && atOrAfter(c.lastComment.at, c.headAt));
  const note = limited ? "Codex 한도 — 사람 리뷰 필요" : `head ${short(pr.headRefOid)}에 리뷰 필요${c?.thumbsAt ? " (Codex 👍는 이전 커밋 것)" : ""}`;
  const counted = countedReviews(pr);
  if (!counted.length) {
    out.push(block("no-review", `리뷰 없음: ${note}`));
  } else {
    const last = counted.reduce((a, b) => ((b.submittedAt ?? "") > (a.submittedAt ?? "") ? b : a));
    out.push(block("review-stale", `리뷰가 이전 커밋 ${short(last.commit!.oid)}에만 있음: ${note}`));
  }
  return out;
}

export function mergeBlocks(state: string): Block[] {
  switch (state) {
    case "CLEAN":
    case "UNSTABLE": // 머지 가능, 통과 안 한 체크는 CI 조건이 잡는다
    case "HAS_HOOKS":
    case "DRAFT": // Draft 조건이 따로 잡는다
      return [];
    case "BEHIND":
      return [block("behind", "base보다 뒤처짐: rebase 필요")];
    case "DIRTY":
      return [block("dirty", "base와 충돌: 충돌 해결 필요")];
    case "BLOCKED":
      return [block("blocked", "GitHub 보호 규칙이 머지를 막음")];
    default:
      return [block("merge-unknown", "GitHub이 아직 계산 중(머지 가능 여부)")];
  }
}

// 막힌 조건 목록. 비어 있으면 CLEARED TO LAND.
export function landingBlocks(pr: GhPull, los: boolean): Block[] {
  const out: Block[] = [];
  if (pr.isDraft) out.push(block("draft", "Draft PR"));
  out.push(...checkBlocks(pr.statusCheckRollup), ...reviewBlocks(pr), ...mergeBlocks(pr.mergeStateStatus));
  if (los) out.push(block("los", "STAND에 LOSS OF SEPARATION이 열려 있음"));
  const order: LandingBlockCode[] = ["draft", "checks-failed", "checks-pending", "no-checks", "changes-requested", "no-review", "review-stale", "dirty", "behind", "blocked", "merge-unknown", "los"];
  return out.sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
}

// 이 head에서 조건이 처음 모두 맞은 시각. 새 push(head 변경)면 키가 바뀌어 다시 센다.
export const readyKey = (p: Pick<PullRequest, "repo" | "number" | "head">) => `${p.repo}#${p.number}@${p.head}`;

// CLEARED는 readyAt 순, 그다음 APPROACH는 PR을 연 순서.
export function orderPulls(pulls: PullRequest[]): PullRequest[] {
  const rank = (p: PullRequest) => (p.landing === "CLEARED" ? 0 : 1);
  return [...pulls].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.landing === "CLEARED" ? (a.readyAt ?? "").localeCompare(b.readyAt ?? "") : a.createdAt.localeCompare(b.createdAt)) ||
      a.repo.localeCompare(b.repo) ||
      a.number - b.number,
  );
}

// gh 결과 → PullRequest[]. ready는 readyKey → 시각 기록(호출한 쪽이 들고 있다). 이번에 없는 키는 지운다.
export function buildPulls(
  sources: { repo: string; pulls: GhPull[] }[],
  workspaces: Workspace[],
  alerts: Alert[],
  ready: Map<string, string>,
  ticketKeyOf: (pr: GhPull) => string | null,
  now = new Date().toISOString(),
): PullRequest[] {
  const losStands = new Set(alerts.filter((a) => a.kind === "conflict" && a.workspacePath).map((a) => a.workspacePath!));
  const seen = new Set<string>();
  const out: PullRequest[] = [];
  for (const { repo, pulls } of sources) {
    for (const gh of pulls) {
      const stand = workspaces.find((w) => w.repo === repo && w.branch === gh.headRefName) ?? null;
      const blocks = landingBlocks(gh, Boolean(stand && losStands.has(stand.path)));
      const key = readyKey({ repo, number: gh.number, head: gh.headRefOid });
      seen.add(key);
      let readyAt: string | null = null;
      if (!blocks.length) {
        if (!ready.has(key)) ready.set(key, now);
        readyAt = ready.get(key)!;
      }
      out.push({
        repo,
        number: gh.number,
        title: gh.title,
        url: gh.url,
        branch: gh.headRefName,
        head: gh.headRefOid,
        base: gh.baseRefName,
        ticketKey: ticketKeyOf(gh),
        standPath: stand?.path ?? null,
        draft: gh.isDraft,
        landing: blocks.length ? "APPROACH" : "CLEARED",
        blocks,
        readyAt,
        createdAt: gh.createdAt,
      });
    }
  }
  for (const key of ready.keys()) if (!seen.has(key)) ready.delete(key);
  return orderPulls(out);
}

// LANDING SEQUENCE: 머지를 요청한(Draft가 아닌) PR
export const inSequence = (p: PullRequest) => !p.draft;
export const pullKey = (p: Pick<PullRequest, "repo" | "number">) => `${p.repo}#${p.number}`;

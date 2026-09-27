import type { Alert, LandingBlockCode, PullRequest, Workspace } from "./model.ts";

// CLEARED TO LAND 판정. GitHub에 열린 PR 하나마다 머지 전에 기계로 볼 수 있는 조건을 모두 따진다.
// 결정 사항(docs/occ.md 9절):
// - CI: rollup(head 커밋 기준)의 체크를 모두 required로 본다. NEUTRAL·SKIPPED는 통과. 체크가 하나도 없으면 막는다.
// - 리뷰: head 커밋에 PR 작성자도 Codex도 아닌 리뷰어의 APPROVED·COMMENTED 리뷰가 있어야 한다.
//   또는 Codex 봇의 👍(+1) 반응이 head 커밋의 committer 시각 이후에 달렸다(Codex의 "큰 문제 없음" 신호).
//   Codex의 COMMENTED 리뷰는 지적이 있다는 뜻이라 통과로 치지 않는다. head에 그 리뷰가 있으면 그 뒤 Codex 👍나
//   사람(Codex·작성자 아닌 리뷰어)의 head APPROVED가 있어야 풀린다. 사람 COMMENTED로는 풀리지 않는다.
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
  completedAt?: string | null; // CheckRun만. ATFM이 CI 소요 시간을 잰다
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

// head 리뷰가 없거나 head에 Codex 지적이 있는 PR에만 따로 읽는 Codex 신호(sources/github.ts)
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
  labels?: { name: string }[] | null;
  codex?: CodexSignal; // atc가 붙인다. 없으면 아직 안 읽었음
  files?: string[]; // atc가 붙인다(Codex 리뷰가 head에 없는 PR만). 외부 리뷰 제외(보안 경로) 판단용
  body?: string | null;
}

// ── Codex 한도 때 외부 모델 착륙 리뷰(ATC-7, ATC-27: DeepSeek V4.1 Flash REVIEW 세션, docs/occ.md 9.2) ──

// CODEX UNAVAILABLE: head에 Codex 리뷰(지적·👍)도 사람 통과 리뷰도 없고, head 뒤에 Codex가 한도 댓글을 남겼거나
// head(또는 PR을 연 때) 뒤로 silentMs 동안 Codex 신호가 없음. Codex 신호를 아직 안 읽은 PR(Draft 포함)은 null.
export interface CodexUnavailable {
  why: "limit" | "silent";
  since: string; // 한도 댓글 시각 | 조용해진 지 silentMs가 지난 시각
}
export function codexUnavailableOf(pr: ReviewInput & Pick<GhPull, "createdAt">, now: number, silentMs: number): CodexUnavailable | null {
  const c = pr.codex;
  if (!c || hasHeadReview(pr) || codexFindings(pr) || codexThumbsPass(pr)) return null;
  if (c.lastComment?.limit && atOrAfter(c.lastComment.at, c.headAt)) return { why: "limit", since: c.lastComment.at };
  const base = [c.headAt, pr.createdAt].filter(Boolean).sort().at(-1)!;
  if (c.lastComment && atOrAfter(c.lastComment.at, base)) return null; // Codex가 이 head 뒤에 말했다(한도 아님)
  const quietUntil = Date.parse(base) + silentMs;
  return now >= quietUntil ? { why: "silent", since: new Date(quietUntil).toISOString() } : null;
}

// 외부 리뷰(착륙 리뷰 세션)에 보내지 않는 PR. vocado 규칙: 기밀 작업은 외부 모델에 보내지 않는다(요청 자료가 학습에 쓰임).
// VOC FLIGHT에는 분류 라벨이 거의 없어(ATC-27) 라벨이 없어도 diff 경로와 제목·본문 키워드로 뺀다. 하나라도 맞으면 제외:
// FLIGHT 없음, FLIGHT의 rating:SEC·Risk: Security·Rights·Contract(PR 라벨 포함), 보안 경로, 보안 키워드.
const RISK_LABEL = /^(?:risk\s*[:/]\s*)?(security|rights|contract)$/i;
const SECRET_PATHS = [
  /(^|\/)\.env($|[.\/_-])/i,
  /(^|\/)(secrets?|credentials?|keys?|private[-_]?keys?|certs?)(\/|$)/i,
  /\.(pem|key|p12|pfx|jks|keystore|asc|gpg)$/i,
  /(^|\/)id_(rsa|ecdsa|ed25519)/i,
  /(^|\/)[^/]*(secret|credential|private[-_]?key|service[-_]?account|api[-_]?key)[^/]*$/i,
];
export const secretPathOf = (files: readonly string[]): string | null => files.find((f) => SECRET_PATHS.some((re) => re.test(f))) ?? null;
// 보안 경로 → 짧은 이름(스트립 "외부 리뷰 제외 — migrations"). 위에서부터 먼저 맞는 것
const B = "(^|[\\/_.\\-\\[(])"; // 경로 조각의 앞 경계
const E = "([\\/_.\\-\\])]|$)"; // 뒤 경계
const SECURITY_PATHS: [RegExp, string][] = [
  [/(^|\/)supabase\/migrations\//i, "migrations"],
  [/(^|\/)supabase\/functions\//i, "supabase functions"],
  [/\.sql$/i, "SQL"],
  [new RegExp(`${B}(auth|oauth|authn|authz|authenticat\\w*|authoriz\\w*)${E}`, "i"), "auth"],
  [new RegExp(`${B}sessions?${E}`, "i"), "session"],
  [/admission/i, "admission"],
  [new RegExp(`${B}(rls|polic(y|ies))${E}`, "i"), "RLS·policy"],
  [/(^|\/)middleware(\.[cm]?[jt]sx?$|\/|$)/i, "middleware"],
];
export function securityPathOf(files: readonly string[]): { tag: string; path: string } | null {
  for (const [re, tag] of SECURITY_PATHS) {
    const path = files.find((f) => re.test(f));
    if (path) return { tag, path };
  }
  const secret = secretPathOf(files);
  return secret ? { tag: "비밀·키 경로", path: secret } : null;
}
// 제목·본문의 보안 키워드. EXECUTE는 SQL 권한이라 대문자만(영어 문장의 execute는 뺀다)
const SECURITY_WORDS = /\b(security|privileges?|rls|grant(?:s|ed|ing)?|revok(?:e|es|ed|ing)|definer|admission|auth|authn|authz|authentication|authorization|acl|exposure|exposed)\b/i;
// vocado PR 템플릿의 판에 박힌 줄은 키워드를 보지 않는다: "Contracts Preserved / Changed"의 바뀌지 않은 줄
// ("- auth/session: unchanged", "- Supabase RLS/policies: unchanged", "- migrations: none", "- auth/session: preserved (…)")과 체크리스트("- [ ] No auth/session …").
// 계약 줄이 바뀌었다고 적었으면("- auth/session: changed — …") 그대로 본다(진짜 신호다)
const TEMPLATE_LINE = /^\s*[-*]\s*(\[[ xX]\]|[^:\n]{1,60}:\s*(unchanged|preserved|none|n\/a|not changed|no change)\b)/i;
export const withoutTemplate = (text: string) => text.split("\n").filter((l) => !TEMPLATE_LINE.test(l)).join("\n");
export function securityWordOf(texts: readonly (string | null | undefined)[]): string | null {
  for (const raw of texts) {
    if (!raw) continue;
    const t = withoutTemplate(raw);
    if (/\bEXECUTE\b/.test(t)) return "EXECUTE";
    if (/use server/i.test(t)) return "use server";
    const m = SECURITY_WORDS.exec(t);
    if (m) return m[1].toLowerCase();
  }
  return null;
}
export function externalExclusionOf(x: {
  flight: string | null;
  ticketLabels: readonly string[];
  prLabels: readonly string[];
  files: readonly string[] | null; // 아직 못 읽었으면 null(자료를 줄 때 실제 diff로 다시 본다)
  texts: readonly (string | null | undefined)[]; // PR 제목·본문, FLIGHT 제목(·본문)
}): string | null {
  if (!x.flight) return "FLIGHT 없음";
  if (x.ticketLabels.some((l) => l.toLowerCase() === "rating:sec")) return "rating:SEC";
  for (const l of [...x.ticketLabels, ...x.prLabels]) {
    const m = RISK_LABEL.exec(l.trim());
    if (m) return `Risk: ${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()}`;
  }
  const path = securityPathOf(x.files ?? []);
  if (path) return path.tag;
  const word = securityWordOf(x.texts);
  return word ? `키워드 ${word}` : null;
}

// 리뷰어 이름(모델 계열 앞머리): deepseek-v4.1-flash → DEEPSEEK, muse-spark-1.3 → MUSE
export const reviewerOf = (family: string) => (family.split(/[-.\s]/)[0] || family).toUpperCase();

// 착륙 리뷰 기록(landing-reviews.jsonl 한 줄). 지적 등급은 Codex처럼 P0·P1·P2. 옛 Muse 기록도 그대로 둔다
export interface LandingReview {
  at: string;
  repo: string; // owner/name
  number: number;
  head: string; // 리뷰한 head SHA(전체)
  verdict: "pass" | "findings";
  text: string;
  by: string;
  model: string; // 실제 모델 이름(guard가 세션 기록에서 읽어 붙인다)
  family: string; // 모델 계열(modelFamily)
  p0: number;
  p1: number;
  p2: number;
}
export const severityOf = (text: string) => {
  const n = (k: string) => (text.match(new RegExp(`\\bP${k}\\b`, "g")) ?? []).length;
  return { p0: n("0"), p1: n("1"), p2: n("2") };
};
// 이 PR의 이 head에 대한 마지막 착륙 리뷰
export const landingReviewOf = (reviews: readonly LandingReview[], repo: string, number: number, head: string): LandingReview | null =>
  reviews.filter((r) => r.repo === repo && r.number === number && r.head === head).at(-1) ?? null;
export const reviewPasses = (r: LandingReview | null) => Boolean(r && r.verdict === "pass" && !r.p0 && !r.p1);

// PR 한 줄에 붙는 외부 리뷰 상태. Codex를 쓸 수 있으면 null. 제외 PR은 외부 리뷰의 pass가 있어도 excluded(착륙 근거가 아니다)
export interface ExtReviewState {
  status: "excluded" | "waiting" | "pass" | "findings";
  reason: string | null; // excluded: 제외 사유
  review: Pick<LandingReview, "at" | "model" | "family" | "verdict" | "p0" | "p1" | "p2" | "text"> | null;
}
export interface ExtReviewContext {
  unavailable: CodexUnavailable | null;
  exclusion: string | null;
  review: LandingReview | null; // 이 head의 마지막 착륙 리뷰
}
export function extReviewStateOf(ctx: ExtReviewContext | undefined): ExtReviewState | null {
  if (!ctx?.unavailable) return null;
  if (ctx.exclusion) return { status: "excluded", reason: ctx.exclusion, review: null };
  const r = ctx.review;
  if (!r) return { status: "waiting", reason: null, review: null };
  const review = { at: r.at, model: r.model, family: r.family, verdict: r.verdict, p0: r.p0, p1: r.p1, p2: r.p2, text: r.text };
  return { status: reviewPasses(r) ? "pass" : "findings", reason: null, review };
}
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);
const codexWhy = (u: CodexUnavailable, silentMs: number) => (u.why === "limit" ? "Codex 한도" : `Codex ${Math.round(silentMs / 3_600_000)}시간 응답 없음`);

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

// 작성자가 아닌 사람의 리뷰(APPROVED·COMMENTED). Codex의 COMMENTED도 든다(이전 커밋 리뷰 표시용).
function countedReviews(pr: ReviewInput): GhReview[] {
  const author = pr.author?.login ?? null;
  return (pr.reviews ?? []).filter((r) => (r.author?.login !== author || author === null) && COUNTS_AS_REVIEW.has(r.state) && r.commit?.oid);
}

const atOrAfter = (t: string | null | undefined, since: string | null | undefined) =>
  Boolean(t && since && Date.parse(t) >= Date.parse(since));
const after = (t: string | null | undefined, since: string | null | undefined) =>
  Boolean(t && since && Date.parse(t) > Date.parse(since));

// 통과로 치는 리뷰: Codex 것은 빼고(Codex의 통과 신호는 👍뿐)
const passingReviews = (pr: ReviewInput) => countedReviews(pr).filter((r) => !isCodexBot(r.author?.login));

// head 커밋에 통과 리뷰가 있나
export const hasHeadReview = (pr: ReviewInput) => passingReviews(pr).some((r) => r.commit!.oid === pr.headRefOid);

// head 커밋에 달린 Codex의 마지막 COMMENTED 리뷰(= 지적 있음)
export function codexFindings(pr: ReviewInput): GhReview | null {
  const mine = (pr.reviews ?? []).filter((r) => isCodexBot(r.author?.login) && r.state === "COMMENTED" && r.commit?.oid === pr.headRefOid);
  return mine.reduce<GhReview | null>((a, b) => (!a || (b.submittedAt ?? "") > (a.submittedAt ?? "") ? b : a), null);
}

// head의 Codex 지적 뒤에 사람이 head에 APPROVED했나(지적을 보고 판단함). 지적 전 APPROVED는 세지 않는다.
export function humanApprovedFindings(pr: ReviewInput): boolean {
  const findings = codexFindings(pr);
  return Boolean(
    findings?.submittedAt &&
      passingReviews(pr).some((r) => r.state === "APPROVED" && r.commit!.oid === pr.headRefOid && after(r.submittedAt, findings.submittedAt)),
  );
}

// atc가 Codex 👍·댓글을 따로 읽어야 하나: head 통과 리뷰가 없거나, head의 Codex 지적을 사람 APPROVED가 풀지 않았을 때
export const needsCodexSignal = (pr: ReviewInput) => !hasHeadReview(pr) || (codexFindings(pr) !== null && !humanApprovedFindings(pr));

// Codex 👍가 이 head를 통과시키나: head committer 시각 이후, head에 Codex 지적이 있으면 그 리뷰보다 뒤
export function codexThumbsPass(pr: ReviewInput, c: CodexSignal | undefined = pr.codex): boolean {
  if (!atOrAfter(c?.thumbsAt, c?.headAt)) return false;
  const findings = codexFindings(pr);
  return !findings || after(c!.thumbsAt, findings.submittedAt);
}

export function reviewBlocks(pr: ReviewInput, ext?: ExtReviewContext, silentMs = 6 * 3_600_000): Block[] {
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

  // Codex는 지적이 있으면 COMMENTED 리뷰를, 없으면 PR에 👍만 단다. head의 지적은 그 뒤 👍나 사람 APPROVED가 있어야 풀린다.
  const c = pr.codex;
  const thumbsOk = codexThumbsPass(pr);
  if (codexFindings(pr) && !thumbsOk && !humanApprovedFindings(pr)) {
    out.push(block("review-findings", `Codex 지적 있음(head ${short(pr.headRefOid)}) — 반영 후 재리뷰 필요`));
    return out;
  }
  if (hasHeadReview(pr) || thumbsOk) return out;
  // Codex를 쓸 수 없으면 착륙 리뷰(현재 head, P0·P1 없음)가 리뷰를 대신한다. 새 head는 새 리뷰가 필요하다.
  // 외부 리뷰에서 뺀 PR(보안 경로·키워드 등)은 기록에 pass가 있어도 근거가 아니다(excluded)
  const ms = extReviewStateOf(ext);
  if (ms?.status === "pass") return out;
  if (ms?.status === "findings") {
    const r = ms.review!;
    out.push(block("review-findings", `${reviewerOf(r.family)} 지적(${codexWhy(ext!.unavailable!, silentMs)}, head ${short(pr.headRefOid)}, P0 ${r.p0} · P1 ${r.p1} · P2 ${r.p2}): ${clip(r.text, 400)} — 반영 후 새 head에서 재리뷰`));
    return out;
  }
  const limited = Boolean(c?.lastComment?.limit && atOrAfter(c.lastComment.at, c.headAt));
  const note =
    ms?.status === "excluded"
      ? `${codexWhy(ext!.unavailable!, silentMs)} — 외부 리뷰 제외(${ms.reason}) — Codex나 SUPERVISOR 리뷰 필요`
      : ms?.status === "waiting"
        ? `${codexWhy(ext!.unavailable!, silentMs)} — 착륙 리뷰 대기(REVIEW 세션)`
        : limited
          ? "Codex 한도 — 사람 리뷰 필요"
          : `head ${short(pr.headRefOid)}에 리뷰 필요${c?.thumbsAt ? " (Codex 👍는 이전 커밋 것)" : ""}`;
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
export function landingBlocks(pr: GhPull, los: boolean, ext?: ExtReviewContext, silentMs?: number): Block[] {
  const out: Block[] = [];
  if (pr.isDraft) out.push(block("draft", "Draft PR"));
  out.push(...checkBlocks(pr.statusCheckRollup), ...reviewBlocks(pr, ext, silentMs), ...mergeBlocks(pr.mergeStateStatus));
  if (los) out.push(block("los", "STAND에 LOSS OF SEPARATION이 열려 있음"));
  const order: LandingBlockCode[] = ["draft", "checks-failed", "checks-pending", "no-checks", "changes-requested", "review-findings", "no-review", "review-stale", "dirty", "behind", "blocked", "merge-unknown", "los"];
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
  // Codex 한도 때 착륙 리뷰(ATC-7·27). 없으면 예전처럼(Codex·사람 리뷰만)
  ext?: { silentMs: number; reviews: readonly LandingReview[]; ticketLabelsOf: (key: string | null) => string[]; ticketTitleOf?: (key: string | null) => string | null },
): PullRequest[] {
  const losStands = new Set(alerts.filter((a) => a.kind === "conflict" && a.workspacePath).map((a) => a.workspacePath!));
  const seen = new Set<string>();
  const out: PullRequest[] = [];
  for (const { repo, pulls } of sources) {
    for (const gh of pulls) {
      const stand = workspaces.find((w) => w.repo === repo && w.branch === gh.headRefName) ?? null;
      const ticketKey = ticketKeyOf(gh);
      const slug = slugOfUrl(gh.url);
      const unavailable = ext && slug ? codexUnavailableOf(gh, Date.parse(now), ext.silentMs) : null;
      const ctx: ExtReviewContext | undefined = unavailable
        ? {
            unavailable,
            exclusion: externalExclusionOf({ flight: ticketKey, ticketLabels: ext!.ticketLabelsOf(ticketKey), prLabels: (gh.labels ?? []).map((l) => l.name), files: gh.files ?? null, texts: [gh.title, gh.body, ext!.ticketTitleOf?.(ticketKey)] }),
            review: landingReviewOf(ext!.reviews, slug!, gh.number, gh.headRefOid),
          }
        : undefined;
      const blocks = landingBlocks(gh, Boolean(stand && losStands.has(stand.path)), ctx, ext?.silentMs);
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
        ticketKey,
        standPath: stand?.path ?? null,
        draft: gh.isDraft,
        landing: blocks.length ? "APPROACH" : "CLEARED",
        blocks,
        readyAt,
        createdAt: gh.createdAt,
        codexUnavailable: unavailable,
        extReview: extReviewStateOf(ctx),
      });
    }
  }
  for (const key of ready.keys()) if (!seen.has(key)) ready.delete(key);
  return orderPulls(out);
}

// PR URL → "owner/name"
export const slugOfUrl = (url: string) => /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/\d+/.exec(url)?.[1] ?? null;

// LANDING SEQUENCE: 머지를 요청한(Draft가 아닌) PR
export const inSequence = (p: PullRequest) => !p.draft;
export const pullKey = (p: Pick<PullRequest, "repo" | "number">) => `${p.repo}#${p.number}`;

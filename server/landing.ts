import type { Alert, LandingBlockCode, PullRequest, Workspace } from "./model.ts";
import { humanCheckStatusOf, uiChangeOf } from "./human-check.ts";

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
  changed?: string[]; // atc가 붙인다(열린 PR 모두, head별 캐시). 파일 겹침(ATC-71)과 DIRTY 기록용. 못 읽으면 없다
  body?: string | null;
  threads?: GhThread[]; // atc가 붙인다(head에 Codex 지적이 있거나 BLOCKED인 PR만). 없으면 아직 안 읽었음
  // atc가 붙인다(ATC-31): head에 리뷰가 없을 때, 리뷰를 이어받을 수 있는 이전 커밋 R(최근 것 먼저).
  // R..head가 main 병합뿐이고 PR 자신의 변경(merge-base 대비 바뀐 파일과 blob)이 R과 head에서 같은 것만
  carryFrom?: CarryCandidate[];
  // atc가 붙인다(ATC-37): HUMAN CHECK가 옛 SHA에 기록된 class PR의 main 병합만 한 이전 커밋. 리뷰 잇기(carryFrom)와 따로 둔다
  // (리뷰가 head에 있는 PR에 carryFrom을 붙이면 리뷰 판정이 바뀐다)
  humanCarryFrom?: string[];
}

// ── main 병합만 한 head에 이전 리뷰 이어받기(ATC-31) ──
// vocado main 규칙 strict(최신 main 필수) 때문에 머지가 있을 때마다 다른 PR이 behind가 되고, 팀이 main을 병합하면
// head가 바뀌어 리뷰가 review-stale이 됐다. PR 자신의 변경이 그대로면 R의 리뷰를 head에 이어 준다.
export interface CarryCandidate {
  sha: string;
  at: string | null; // R의 커밋 시각(Codex 👍가 R 뒤에 달렸나 볼 때)
}
export interface CarriedReview {
  from: string; // 리뷰가 달린 커밋 R(전체 SHA)
  by: "human" | "codex" | "review"; // review: REVIEW 세션의 착륙 리뷰
  findings: boolean; // R의 지적이 남아 있음: 통과가 아니라 지적으로 이어진다
}
// 이어받을 리뷰: 최근 R부터 사람 APPROVED → Codex 지적(뒤 👍로 풀리지 않은 것) → Codex 👍(R 뒤) → REVIEW 착륙 리뷰.
// allowExternal: 이 PR이 외부 리뷰에서 빠지지 않았나(빠졌으면 REVIEW 기록을 잇지 않는다)
export function carriedReviewOf(
  pr: ReviewInput & Pick<GhPull, "carryFrom">,
  landingReviews: readonly Pick<LandingReview, "head" | "verdict" | "p0" | "p1" | "family">[],
  allowExternal: boolean,
): CarriedReview | null {
  for (const r of pr.carryFrom ?? []) {
    if (passingReviews(pr).some((x) => x.state === "APPROVED" && x.commit!.oid === r.sha)) return { from: r.sha, by: "human", findings: false };
    const thumbs = pr.codex?.thumbsAt ?? null;
    const found = (pr.reviews ?? [])
      .filter((x) => isCodexBot(x.author?.login) && x.state === "COMMENTED" && x.commit?.oid === r.sha)
      .reduce<GhReview | null>((a, b) => (!a || (b.submittedAt ?? "") > (a.submittedAt ?? "") ? b : a), null);
    if (found && !after(thumbs, found.submittedAt)) return { from: r.sha, by: "codex", findings: true };
    if (thumbs && r.at && atOrAfter(thumbs, r.at)) return { from: r.sha, by: "codex", findings: false };
    const d = allowExternal ? landingReviews.filter((x) => x.head === r.sha && LANDING_REVIEW_FAMILIES.test(x.family)).at(-1) : undefined;
    if (d) return { from: r.sha, by: "review", findings: !reviewPasses(d as LandingReview) };
  }
  return null;
}
// head에서 거꾸로: main 병합(둘째 뒤 부모가 모두 기본 브랜치에 있음)인 동안 첫째 부모(브랜치 쪽 이전 커밋)를 모은다. 최근 것 먼저
export async function mergeOnlyChain(
  commits: readonly { sha: string; parents: string[]; at: string | null }[],
  head: string,
  inMain: (sha: string) => Promise<boolean>,
): Promise<CarryCandidate[]> {
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const chain: CarryCandidate[] = [];
  for (let cur = bySha.get(head); cur && cur.parents.length >= 2; ) {
    let fromMain = true;
    for (const o of cur.parents.slice(1)) if (!(await inMain(o))) fromMain = false;
    if (!fromMain) break;
    const prev = bySha.get(cur.parents[0]);
    if (!prev) break;
    chain.push({ sha: prev.sha, at: prev.at });
    cur = prev;
  }
  return chain;
}
// PR 자신의 변경(merge-base 대비 바뀐 파일 → "상태:blob")이 같은가. 못 읽었으면(null) 다르다고 본다
export const sameChange = (a: ReadonlyMap<string, string> | null, b: ReadonlyMap<string, string> | null) =>
  Boolean(a && b && a.size === b.size && [...a].every(([f, v]) => b.get(f) === v));
const carriedWho = (c: CarriedReview) => (c.by === "human" ? "사람 APPROVED" : c.by === "codex" ? "Codex" : "REVIEW");

// ── Codex 지적의 등급(ATC-28): P3만 남고 스레드가 해결·답글이면 착륙을 막지 않는다 ──

// PR 리뷰 스레드(GraphQL reviewThreads). comments[0]이 지적, 그 뒤는 답글
export interface GhThread {
  resolved: boolean;
  outdated: boolean;
  path: string | null;
  comments: { author: string | null; at: string; commit: string | null; body: string }[]; // commit: 댓글을 단 원래 커밋
}
// Codex 인라인 지적의 등급 배지(![P2 Badge](…img.shields.io/badge/P2-yellow…)). 읽지 못하면 null
export function findingSeverityOf(body: string): 0 | 1 | 2 | 3 | null {
  const m = /!\[P([0-3]) Badge\]/i.exec(body) ?? /img\.shields\.io\/badge\/P([0-3])-/i.exec(body);
  return m ? (Number(m[1]) as 0 | 1 | 2 | 3) : null;
}
export interface CodexHeadFinding {
  severity: 0 | 1 | 2 | 3; // 표시가 없으면 2로 본다
  marked: boolean; // 배지를 읽었나
  resolved: boolean;
  answered: boolean; // Codex 아닌 사람이 스레드에 답글을 달았나
  path: string | null;
}
// 현재 head의 Codex 인라인 지적(스레드 첫 댓글이 Codex이고 head 커밋에 달린 것). 스레드를 아직 안 읽었으면 null
export function codexHeadFindingsOf(pr: Pick<GhPull, "headRefOid" | "threads">): CodexHeadFinding[] | null {
  if (!pr.threads) return null;
  return pr.threads
    .filter((t) => t.comments[0] && isCodexBot(t.comments[0].author) && t.comments[0].commit === pr.headRefOid)
    .map((t) => {
      const sev = findingSeverityOf(t.comments[0].body);
      return { severity: sev ?? 2, marked: sev !== null, resolved: t.resolved, answered: t.comments.slice(1).some((c) => c.author && !isCodexBot(c.author)), path: t.path };
    });
}
// 화면·TOWER용 요약. ok: 착륙을 막지 않는다(P3만, 모두 해결·답글)
export interface CodexFindingSummary {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  unmarked: number; // 등급 표시가 없어 P2로 본 수
  open: number; // 해결도 답글도 없는 지적 수
  ok: boolean;
}
export function codexFindingSummaryOf(findings: readonly CodexHeadFinding[]): CodexFindingSummary {
  const n = (k: number) => findings.filter((f) => f.severity === k).length;
  const open = findings.filter((f) => !f.resolved && !f.answered).length;
  const ok = findings.length > 0 && findings.every((f) => f.severity === 3) && open === 0;
  return { p0: n(0), p1: n(1), p2: n(2), p3: n(3), unmarked: findings.filter((f) => !f.marked).length, open, ok };
}
const findingCounts = (s: CodexFindingSummary) =>
  [s.p0 && `P0 ${s.p0}`, s.p1 && `P1 ${s.p1}`, s.p2 && `P2 ${s.p2}`, s.p3 && `P3 ${s.p3}`].filter(Boolean).join(" · ") + (s.unmarked ? ` (등급 표시 없는 ${s.unmarked}건은 P2로 봄)` : "");

// ── Codex 한도 때 착륙 리뷰(ATC-7, ATC-27: REVIEW 세션, 2026-09-29부터 Claude Sonnet, docs/occ.md 9.2) ──

// CODEX UNAVAILABLE: head에 Codex 리뷰(지적·👍)도 사람 통과 리뷰도 없고, head 뒤에 Codex가 한도 댓글을 남겼거나
// head(또는 PR을 연 때) 뒤로 silentMs 동안 Codex 신호가 없음. Codex 신호를 아직 안 읽은 PR(Draft 포함)은 null.
export interface CodexUnavailable {
  why: "limit" | "silent" | "autoland"; // autoland: AUTOLAND가 재리뷰를 요청했는데 Codex가 30분 동안 답하지 않음(ATC-38)
  since: string; // 한도 댓글 시각 | 조용해진 지 silentMs가 지난 시각 | AUTOLAND가 REVIEW로 넘긴 시각
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
export interface ExclusionInput {
  flight: string | null;
  ticketLabels: readonly string[];
  prLabels: readonly string[];
  files: readonly string[] | null; // 아직 못 읽었으면 null(자료를 줄 때 실제 diff로 다시 본다)
  texts: readonly (string | null | undefined)[]; // PR 제목·본문, FLIGHT 제목(·본문)
}
// 외부 리뷰에서 빼는 까닭을 둘로 나눈다(ATC-30). hard: 어느 모드에서든 보내지 않음(FLIGHT 없음, .env·비밀·키·자격 증명 경로).
// security: 보안 규칙(rating:SEC·Risk 라벨, 보안 경로, 보안 키워드) — externalReview.security가 "deepseek"이면 보낸다
export function externalGateOf(x: ExclusionInput): { hard: string | null; security: string | null } {
  if (!x.flight) return { hard: "FLIGHT 없음", security: null };
  const secret = secretPathOf(x.files ?? []);
  if (secret) return { hard: `비밀·키 경로 ${secret}`, security: null };
  if (x.ticketLabels.some((l) => l.toLowerCase() === "rating:sec")) return { hard: null, security: "rating:SEC" };
  for (const l of [...x.ticketLabels, ...x.prLabels]) {
    const m = RISK_LABEL.exec(l.trim());
    if (m) return { hard: null, security: `Risk: ${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()}` };
  }
  const path = securityPathOf(x.files ?? []);
  if (path) return { hard: null, security: path.tag };
  const word = securityWordOf(x.texts);
  return { hard: null, security: word ? `키워드 ${word}` : null };
}
// 외부 리뷰에서 빼는 사유. security가 "deepseek"(보안 PR도 REVIEW에 보냄, 옛 이름을 그대로 쓴다)이면 hard만 뺀다
export function externalExclusionOf(x: ExclusionInput, security: "exclude" | "deepseek" = "exclude"): string | null {
  const g = externalGateOf(x);
  return g.hard ?? (security === "exclude" ? g.security : null);
}

// 리뷰어 이름(모델 계열 앞머리, claude- 는 뗀다): claude-sonnet-5-5 → SONNET, deepseek-v4.1-flash → DEEPSEEK(옛 기록)
export const reviewerOf = (family: string) => {
  const f = family.replace(/^claude-/i, "");
  return (f.split(/[-.\s]/)[0] || family).toUpperCase();
};
// 착륙 리뷰로 인정하는 기록의 모델 계열: 지금 REVIEW(Claude Sonnet, SUPERVISOR 결정 2026-09-29)와 옛 DeepSeek 기록(ATC-27).
// 옛 Muse 기록은 예전처럼 잇지 않는다
export const LANDING_REVIEW_FAMILIES = /^(claude-sonnet-|deepseek)/i;

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
  security?: true; // 보안 규칙에 걸린 PR을 스위치(externalReview.security "deepseek")로 리뷰한 기록(ATC-30)
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
  security?: string | null; // 보안 규칙에 걸렸지만 스위치가 "deepseek"이라 보낸 PR의 사유(ATC-30). 화면·기록에 보안 리뷰임을 남긴다
  review: Pick<LandingReview, "at" | "model" | "family" | "verdict" | "p0" | "p1" | "p2" | "text"> | null;
}
export interface ExtReviewContext {
  unavailable: CodexUnavailable | null;
  exclusion: string | null;
  security?: string | null; // 스위치로 보낸 보안 PR의 사유(ATC-30)
  review: LandingReview | null; // 이 head의 마지막 착륙 리뷰
}
export function extReviewStateOf(ctx: ExtReviewContext | undefined): ExtReviewState | null {
  if (!ctx?.unavailable) return null;
  if (ctx.exclusion) return { status: "excluded", reason: ctx.exclusion, review: null };
  const security = ctx.security ?? null;
  const r = ctx.review;
  if (!r) return { status: "waiting", reason: null, review: null, security };
  const review = { at: r.at, model: r.model, family: r.family, verdict: r.verdict, p0: r.p0, p1: r.p1, p2: r.p2, text: r.text };
  return { status: reviewPasses(r) ? "pass" : "findings", reason: null, review, security };
}
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);
const codexWhy = (u: CodexUnavailable, silentMs: number) =>
  u.why === "limit" ? "Codex 한도" : u.why === "autoland" ? "AUTOLAND 재리뷰 — Codex 30분 무응답" : `Codex ${Math.round(silentMs / 3_600_000)}시간 응답 없음`;

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

// MCC가 맡은 저장소(atc)의 PR: 이 head의 INSPECTION이 리뷰를 대신한다(docs/mcc.md 5장)
export interface MccReviewContext {
  review: { verdict: "pass" | "findings"; text: string; p0: number; p1: number; p2: number } | null;
}
export function reviewBlocks(pr: ReviewInput, ext?: ExtReviewContext, silentMs = 6 * 3_600_000, carried?: CarriedReview | null, mcc?: MccReviewContext): Block[] {
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
    // 등급을 읽을 수 있으면(스레드를 읽었으면): P3만 남고 모두 해결·답글이면 Codex의 head 리뷰로 쳐서 막지 않는다(ATC-28).
    // 인라인 지적이 없거나(본문만) 스레드를 못 읽었으면 예전처럼 막는다
    const found = codexHeadFindingsOf(pr);
    const sum = found?.length ? codexFindingSummaryOf(found) : null;
    if (sum?.ok) return out;
    const text = !sum
      ? `Codex 지적 있음(head ${short(pr.headRefOid)}) — 반영 후 재리뷰 필요`
      : sum.p0 || sum.p1 || sum.p2
        ? `Codex 지적 있음(head ${short(pr.headRefOid)}, ${findingCounts(sum)}) — 반영 후 재리뷰 필요`
        : `Codex P3 지적 ${sum.p3}건 중 ${sum.open}건이 해결·답글 없음(head ${short(pr.headRefOid)}) — 스레드를 resolve하거나 답글을 달면 P3는 착륙을 막지 않음`;
    out.push(block("review-findings", text));
    return out;
  }
  if (hasHeadReview(pr) || thumbsOk) return out;
  // 이전 커밋 R의 리뷰를 이어받음(ATC-31): R 뒤로 main 병합뿐이고 PR 자신의 변경이 같다. 통과면 막지 않고, 지적이면 지적으로 막는다
  if (carried && !carried.findings) return out;
  if (carried?.findings) {
    out.push(block("review-findings", `${carriedWho(carried)} 지적이 이전 커밋 ${short(carried.from)}에 남아 있음(그 뒤 main 병합만) — 반영 후 재리뷰 필요`));
    return out;
  }
  if (mcc?.review?.verdict === "pass") return out;
  if (mcc?.review) {
    const r = mcc.review;
    out.push(block("review-findings", `MCC INSPECTION 지적(head ${short(pr.headRefOid)}, P0 ${r.p0} · P1 ${r.p1} · P2 ${r.p2}): ${clip(r.text, 400)} — 반영 후 새 head에서 다시`));
    return out;
  }
  // Codex를 쓸 수 없으면 착륙 리뷰(현재 head, P0·P1 없음)가 리뷰를 대신한다. 새 head는 새 리뷰가 필요하다.
  // 외부 리뷰에서 뺀 PR(보안 경로·키워드 등)은 기록에 pass가 있어도 근거가 아니다(excluded)
  const ms = extReviewStateOf(ext);
  if (ms?.status === "pass") return out;
  if (ms?.status === "findings") {
    const r = ms.review!;
    out.push(block("review-findings", `${reviewerOf(r.family)} 지적(${ms.security ? "보안, " : ""}${codexWhy(ext!.unavailable!, silentMs)}, head ${short(pr.headRefOid)}, P0 ${r.p0} · P1 ${r.p1} · P2 ${r.p2}): ${clip(r.text, 400)} — 반영 후 새 head에서 재리뷰`));
    return out;
  }
  const limited = Boolean(c?.lastComment?.limit && atOrAfter(c.lastComment.at, c.headAt));
  const note =
    ms?.status === "excluded"
      ? `${codexWhy(ext!.unavailable!, silentMs)} — 외부 리뷰 제외(${ms.reason}) — Codex나 SUPERVISOR 리뷰 필요`
      : ms?.status === "waiting"
        ? `${codexWhy(ext!.unavailable!, silentMs)} — 착륙 리뷰 대기(REVIEW 세션${ms.security ? `, 보안 PR: ${ms.security}` : ""})`
        : limited
          ? "Codex 한도 — 사람 리뷰 필요"
          : mcc
            ? `head ${short(pr.headRefOid)}의 MCC INSPECTION 대기`
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

// unresolvedThreads: 해결 안 된 리뷰 스레드 수(읽었을 때만). vocado 보호 규칙 "스레드 해결 필수"가 BLOCKED의 흔한 원인이다
export function mergeBlocks(state: string, unresolvedThreads?: number): Block[] {
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
      return [
        block(
          "blocked",
          unresolvedThreads ? `GitHub 보호 규칙이 머지를 막음 — 해결 안 된 리뷰 스레드 ${unresolvedThreads}개(스레드 해결 필수: resolve해야 머지된다)` : "GitHub 보호 규칙이 머지를 막음",
        ),
      ];
    default:
      return [block("merge-unknown", "GitHub이 아직 계산 중(머지 가능 여부)")];
  }
}

// 막힌 조건 목록. 비어 있으면 CLEARED TO LAND.
export function landingBlocks(pr: GhPull, los: boolean, ext?: ExtReviewContext, silentMs?: number, carried?: CarriedReview | null, mcc?: MccReviewContext): Block[] {
  const out: Block[] = [];
  if (pr.isDraft) out.push(block("draft", "Draft PR"));
  out.push(...checkBlocks(pr.statusCheckRollup), ...reviewBlocks(pr, ext, silentMs, carried, mcc), ...mergeBlocks(pr.mergeStateStatus, pr.threads?.filter((t) => !t.resolved).length));
  if (los) out.push(block("los", "STAND에 LOSS OF SEPARATION이 열려 있음"));
  const order: LandingBlockCode[] = ["stacked", "draft", "checks-failed", "checks-pending", "no-checks", "changes-requested", "review-findings", "no-review", "review-stale", "dirty", "behind", "blocked", "merge-unknown", "los"];
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
  sources: { repo: string; pulls: GhPull[]; defaultBranch?: string | null }[],
  workspaces: Workspace[],
  alerts: Alert[],
  ready: Map<string, string>,
  ticketKeyOf: (pr: GhPull) => string | null,
  now = new Date().toISOString(),
  // sources[].defaultBranch: 저장소의 기본 브랜치(모르면 쌓인 PR을 가리지 않는다, ATC-29)
  // Codex 한도 때 착륙 리뷰(ATC-7·27). 없으면 예전처럼(Codex·사람 리뷰만)
  ext?: {
    silentMs: number;
    reviews: readonly LandingReview[];
    ticketLabelsOf: (key: string | null) => string[];
    ticketTitleOf?: (key: string | null) => string | null;
    security?: "exclude" | "deepseek"; // dispatch.json externalReview.security(ATC-30). 없으면 "exclude"
    // AUTOLAND가 이 head를 REVIEW로 넘긴 시각(ATC-38). 있으면 6시간을 기다리지 않는다. Codex가 head 뒤에 이미 답했으면 넘기지 않는다
    fastTrack?: (repo: string, number: number, head: string) => string | null;
    // MCC가 맡은 저장소(docs/mcc.md): 그 저장소 PR은 이 head의 INSPECTION이 리뷰를 대신한다
    mcc?: { repo: string; reviewOf: (number: number, head: string) => MccReviewContext["review"] };
  },
): PullRequest[] {
  const losStands = new Set(alerts.filter((a) => a.kind === "conflict" && a.workspacePath).map((a) => a.workspacePath!));
  const seen = new Set<string>();
  const out: PullRequest[] = [];
  for (const { repo, pulls, defaultBranch } of sources) {
    for (const gh of pulls) {
      const stand = workspaces.find((w) => w.repo === repo && w.branch === gh.headRefName) ?? null;
      const ticketKey = ticketKeyOf(gh);
      const slug = slugOfUrl(gh.url);
      // 외부 리뷰 제외(ATC-27·30): 착륙 리뷰 대기열과, 이전 커밋의 REVIEW 기록을 이어받을지(ATC-31)에 쓴다
      const gate = ext && slug ? externalGateOf({ flight: ticketKey, ticketLabels: ext.ticketLabelsOf(ticketKey), prLabels: (gh.labels ?? []).map((l) => l.name), files: gh.files ?? null, texts: [gh.title, gh.body, ext.ticketTitleOf?.(ticketKey)] }) : null;
      const allowSec = ext?.security === "deepseek";
      const exclusion = gate ? (gate.hard ?? (allowSec ? null : gate.security)) : null;
      // main 병합만 한 head: 이전 커밋의 리뷰를 잇는다(ATC-31). 이으면 REVIEW 대기열에 넣지 않는다
      const carried = ext && slug ? carriedReviewOf(gh, ext.reviews.filter((r) => r.repo === slug && r.number === gh.number), Boolean(gate) && !exclusion) : null;
      let unavailable = ext && slug && !carried ? codexUnavailableOf(gh, Date.parse(now), ext.silentMs) : null;
      if (ext && slug && !carried && !unavailable) {
        const since = ext.fastTrack?.(repo, gh.number, gh.headRefOid);
        if (since && codexUnavailableOf(gh, Date.parse(now), 0)) unavailable = { why: "autoland", since };
      }
      const ctx: ExtReviewContext | undefined = unavailable
        ? {
            unavailable,
            exclusion,
            security: gate && !gate.hard && allowSec ? gate.security : null,
            review: landingReviewOf(ext!.reviews, slug!, gh.number, gh.headRefOid),
          }
        : undefined;
      const mcc = ext?.mcc && ext.mcc.repo === repo ? { review: ext.mcc.reviewOf(gh.number, gh.headRefOid) } : undefined;
      const blocks = landingBlocks(gh, Boolean(stand && losStands.has(stand.path)), ctx, ext?.silentMs, carried, mcc);
      // 쌓인 PR: base가 기본 브랜치가 아니면 CLEARED가 되지 않는다(아래 PR이 먼저 기본 브랜치에 들어간 뒤 base를 바꾼다)
      const stack = defaultBranch ? stackOf(gh, pulls, defaultBranch) : null;
      if (defaultBranch && gh.baseRefName !== defaultBranch) blocks.unshift(block("stacked", stackedText(gh, stack, defaultBranch)));
      const key = readyKey({ repo, number: gh.number, head: gh.headRefOid });
      seen.add(key);
      const ui = uiChangeOf(gh.body);
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
        // 현재 head의 Codex 인라인 지적 요약(등급별 수, 해결·답글). Codex 지적이 없거나 스레드를 못 읽었으면 null
        codexFindings: codexFindings(gh) ? (() => {
          const f = codexHeadFindingsOf(gh);
          return f?.length ? codexFindingSummaryOf(f) : null;
        })() : null,
        extReview: extReviewStateOf(ctx),
        // 외부 리뷰(REVIEW)에서 빼는 사유(ATC-27·30, 스위치 반영). AUTOLAND 재리뷰가 REVIEW로 넘길지 볼 때 쓴다(ATC-38)
        externalExclusion: ext && slug ? exclusion : undefined,
        // 이어받은 리뷰(ATC-31): 스트립 "REVIEW: … (carried from R, main merge only)", landing.cleared 기록의 carriedFrom
        carried: carried ?? null,
        stack,
        // HUMAN CHECK(ATC-37): class PR의 사람 확인. 기록한 SHA가 main 병합만 한 이전 커밋이면 잇는다(ATC-31)
        uiChange: ui,
        humanCheck: humanCheckStatusOf(ui, gh.headRefOid, gh.humanCarryFrom ?? (gh.carryFrom ?? []).map((c) => c.sha)),
      });
    }
  }
  for (const key of ready.keys()) if (!seen.has(key)) ready.delete(key);
  return orderPulls(out);
}

// ── 쌓인 PR과 STRANDED 머지(ATC-29) ──
// 2026-09-27 vocado #395 ← #396 ← #397 ← #398이 아래에서부터 각자 바로 아래 브랜치로 squash 머지돼
// #397·#398이 중간 브랜치에 남았다(main으로 가는 #395에 들어가지 않음). atc는 base가 main이 아닌 #396~#398을 CLEARED로 보였다.

// 사슬: 바로 아래(base 브랜치를 head로 가진 열린 PR)를 따라 내려가 맨 아래를 찾고, 거기서 위(그 head를 base로 가진 열린 PR,
// 여럿이면 번호가 작은 것)로 올라간다. 둘 이상이 이어질 때만 준다
export function stackOf(pr: Pick<GhPull, "number" | "baseRefName" | "headRefName">, pulls: readonly Pick<GhPull, "number" | "baseRefName" | "headRefName">[], defaultBranch: string): { base: number | null; chain: number[] } | null {
  const byHead = new Map(pulls.map((p) => [p.headRefName, p]));
  const below = (p: Pick<GhPull, "baseRefName">) => (p.baseRefName === defaultBranch ? undefined : byHead.get(p.baseRefName));
  let bottom = pr;
  const seen = new Set([pr.number]);
  for (let b = below(bottom); b && !seen.has(b.number); b = below(bottom)) {
    seen.add(b.number);
    bottom = b;
  }
  const chain = [bottom.number];
  for (let cur = bottom; ; ) {
    const up = pulls.filter((p) => p.baseRefName === cur.headRefName && !chain.includes(p.number)).sort((a, b) => a.number - b.number)[0];
    if (!up) break;
    chain.push(up.number);
    cur = up;
  }
  if (!chain.includes(pr.number)) chain.push(pr.number); // 갈래가 여럿이면 이 PR이 사슬 끝에 붙는다
  return chain.length > 1 ? { base: below(pr)?.number ?? null, chain } : null;
}
// "main으로", "master로"(읽는 소리의 받침), 모르면 "(으)로"
const ig = (branch: string) => (/^(main|trunk)$/i.test(branch) ? `${branch}이` : /^(master|develop|dev)$/i.test(branch) ? `${branch}가` : `${branch}이(가)`);
const ro = (branch: string) => (/^(main|trunk)$/i.test(branch) ? `${branch}으로` : /^(master|develop|dev)$/i.test(branch) ? `${branch}로` : `${branch}(으)로`);
export function stackedText(pr: Pick<GhPull, "number" | "baseRefName">, stack: { base: number | null; chain: number[] } | null, defaultBranch: string): string {
  if (!stack?.base) return `쌓인 PR — base가 ${ig(defaultBranch)} 아님(${pr.baseRefName}) — base를 ${ro(defaultBranch)} 바꿔야 착륙할 수 있음`;
  const ahead = stack.chain.slice(0, stack.chain.indexOf(pr.number));
  return `쌓인 PR — ${ahead.map((n) => `#${n}`).join(", ")}가 먼저 ${defaultBranch}에 들어간 뒤 base를 ${ro(defaultBranch)} 바꿈 (${stack.chain.map((n) => `#${n}`).join(" → ")})`;
}

// 기본 브랜치가 아닌 곳으로 머지된 PR(STRANDED 후보). reach: 머지 커밋이나 head가 닿은 곳(sources/github.ts가 compare로 본다)
export interface MergedElsewhere {
  repo: string; // AIRPORT 본 체크아웃 경로
  number: number;
  title: string;
  url: string;
  base: string;
  mergedAt: string;
  mergeCommit: string | null;
  head: string;
  flight: string | null; // 브랜치·제목의 FLIGHT key 또는 본문의 Fixes
  reached: string | null; // "main" 또는 "#395"(그 열린 PR의 head에 들어 있음). null: 어디에도 닿지 않음. undefined면 아직 모름
}
export interface Stranded {
  repo: string;
  number: number;
  url: string;
  title: string;
  flight: string;
  base: string;
  mergedAt: string;
  mergeCommit: string | null;
}
// FLIGHT가 있는 머지 중 기본 브랜치에도, 기본 브랜치로 가는 열린 PR에도 닿지 않은 것
export const strandedOf = (merged: readonly MergedElsewhere[]): Stranded[] =>
  merged
    .filter((m) => m.flight && m.reached === null)
    .map((m) => ({ repo: m.repo, number: m.number, url: m.url, title: m.title, flight: m.flight!, base: m.base, mergedAt: m.mergedAt, mergeCommit: m.mergeCommit }));
// 커밋 중 하나가 닿은 첫 대상(기본 브랜치, 그다음 기본 브랜치로 가는 열린 PR). contains(target, commit): commit이 target의 조상인가
export async function firstReach(commits: readonly string[], targets: readonly { label: string; ref: string }[], contains: (target: string, commit: string) => Promise<boolean>): Promise<string | null> {
  for (const t of targets) for (const c of commits) if (await contains(t.ref, c)) return t.label;
  return null;
}
// 본문의 Fixes·Closes·Resolves FLIGHT key
export const fixesKeyOf = (body: string | null | undefined) => /\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+([A-Z][A-Z0-9]*-\d+)\b/i.exec(body ?? "")?.[1]?.toUpperCase() ?? null;
// 경보 문구. Linear가 Done이어도 경보는 그대로 둔다(Done이 틀렸다는 뜻이다)
export const strandedMessage = (s: Pick<Stranded, "number" | "flight" | "base">, defaultBranch: string, ticketState?: string | null) =>
  `STRANDED — #${s.number}(${s.flight})이 ${defaultBranch}에 닿지 않음 — ${s.base}에 머지됐고 그 커밋이 ${ro(defaultBranch)} 가는 PR에도 없음${ticketState ? ` (Linear는 ${ticketState})` : ""}`;

// PR URL → "owner/name"
export const slugOfUrl = (url: string) => /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/\d+/.exec(url)?.[1] ?? null;

// LANDING SEQUENCE: 머지를 요청한(Draft가 아닌) PR
export const inSequence = (p: PullRequest) => !p.draft;
export const pullKey = (p: Pick<PullRequest, "repo" | "number">) => `${p.repo}#${p.number}`;

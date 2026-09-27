import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPulls, codexUnavailableOf, externalExclusionOf, extReviewStateOf, type GhPull, type LandingReview, reviewerOf, secretPathOf, securityPathOf, securityWordOf, severityOf } from "./landing.ts";
import { assertReviewTarget, capText, findPull, parseReview, ReviewError, sectionsOf } from "./landing-review.ts";

const HEAD = "a".repeat(40);
const HEAD_AT = "2026-09-27T00:00:00Z";
const HOUR = 3_600_000;
const SIX = 6 * HOUR;
const at = (h: number) => new Date(Date.parse(HEAD_AT) + h * HOUR).toISOString();

const pr = (over: Partial<GhPull> = {}): GhPull => ({
  number: 385,
  title: "Give the landing's cards, join button and header links their pointer responses (VOC-173)",
  url: "https://github.com/chaehy5665/vocado_nextjs/pull/385",
  headRefName: "claude/voc-173-landing-response",
  headRefOid: HEAD,
  baseRefName: "main",
  isDraft: false,
  mergeStateStatus: "CLEAN",
  reviewDecision: null,
  createdAt: HEAD_AT,
  author: { login: "chaehy5665" },
  statusCheckRollup: [{ __typename: "CheckRun", name: "check", status: "COMPLETED", conclusion: "SUCCESS" }],
  reviews: [],
  labels: [],
  codex: { headAt: HEAD_AT, thumbsAt: null, lastComment: { at: at(1), limit: true } },
  files: ["src/app/[locale]/(landing)/page.tsx", "src/components/landing/card.tsx"],
  body: "Adds hover and press responses to the landing cards. Reduced motion keeps the states without transitions.",
  ...over,
});
const review = (over: Partial<LandingReview> = {}): LandingReview => ({
  at: at(2), repo: "chaehy5665/vocado_nextjs", number: 385, head: HEAD, verdict: "pass", text: "완료 기준 충족. P2 이름 정리",
  by: "REVIEW", model: "claude-ocx-opencode-go--deepseek-v4.1-flash", family: "deepseek-v4.1-flash", p0: 0, p1: 0, p2: 1, ...over,
});
const build = (g: GhPull, reviews: LandingReview[] = [], labels: string[] = [], nowH = 3) =>
  buildPulls([{ repo: "/r/vocado_nextjs", pulls: [g] }], [], [], new Map(), () => "VOC-173", at(nowH), { silentMs: SIX, reviews, ticketLabelsOf: () => labels, ticketTitleOf: () => "Give the landing's cards their pointer responses" })[0];

test("CODEX UNAVAILABLE: head 뒤 한도 댓글, 또는 head 뒤 6시간 Codex 신호 없음. head에 Codex·사람 리뷰가 있으면 아님", () => {
  const now = Date.parse(at(3));
  assert.deepEqual(codexUnavailableOf(pr(), now, SIX), { why: "limit", since: at(1) });
  // 한도 댓글이 이전 head 것: 6시간 전에는 아직, 지나면 무응답
  const old = pr({ codex: { headAt: HEAD_AT, thumbsAt: null, lastComment: { at: at(-5), limit: true } } });
  assert.equal(codexUnavailableOf(old, now, SIX), null);
  assert.deepEqual(codexUnavailableOf(old, Date.parse(at(7)), SIX), { why: "silent", since: at(6) });
  // 기준은 head와 PR을 연 때 중 늦은 쪽
  assert.equal(codexUnavailableOf({ ...old, createdAt: at(2) }, Date.parse(at(7)), SIX), null);
  // head 뒤 Codex가 한도 아닌 말을 했다: 무응답이 아니다
  assert.equal(codexUnavailableOf(pr({ codex: { headAt: HEAD_AT, thumbsAt: null, lastComment: { at: at(1), limit: false } } }), Date.parse(at(9)), SIX), null);
  // head의 Codex 👍, Codex 지적, 사람 리뷰, 신호를 안 읽은 PR(Draft)
  assert.equal(codexUnavailableOf(pr({ codex: { headAt: HEAD_AT, thumbsAt: at(2), lastComment: { at: at(1), limit: true } } }), now, SIX), null);
  assert.equal(codexUnavailableOf(pr({ reviews: [{ author: { login: "chatgpt-codex-connector" }, state: "COMMENTED", submittedAt: at(2), commit: { oid: HEAD } }] }), now, SIX), null);
  assert.equal(codexUnavailableOf(pr({ reviews: [{ author: { login: "reviewer" }, state: "APPROVED", submittedAt: at(2), commit: { oid: HEAD } }] }), now, SIX), null);
  assert.equal(codexUnavailableOf(pr({ codex: undefined }), now, SIX), null);
});

test("외부 리뷰 제외(라벨): rating:SEC·Risk: Security·Risk/Security(FLIGHT), Risk: Rights·Contract(PR·FLIGHT), .env·비밀·키 경로", () => {
  const ex = (ticketLabels: string[], prLabels: string[] = [], files: string[] | null = []) => externalExclusionOf({ flight: "VOC-173", ticketLabels, prLabels, files, texts: [] });
  assert.equal(ex(["rating:SEC"]), "rating:SEC");
  assert.equal(ex(["Risk: Security"]), "Risk: Security");
  assert.equal(ex(["Risk/Security"]), "Risk: Security");
  assert.equal(ex([], ["Risk: Rights"]), "Risk: Rights");
  assert.equal(ex(["Contract"]), "Risk: Contract");
  assert.equal(ex(["type:BUILD", "wake:M"], ["enhancement"], ["app/page.tsx", "lib/keyboard.ts", "docs/tokens.md"]), null);
  for (const f of [".env", ".env.local", "apps/web/.env.production", "config/secrets/app.json", "deploy/keys/id.json", "certs/server.pem", "tls.key", "home/.ssh/id_ed25519", "lib/service-account.json", "src/apiKey.ts".replace("apiKey", "api_key")]) {
    assert.equal(secretPathOf([f]), f, f);
    assert.match(ex([], [], ["README.md", f]) ?? "", /비밀·키 경로/, f);
  }
  assert.equal(ex([], [], null), null); // 파일을 아직 못 읽음: 자료를 줄 때 diff로 다시 본다
});

test("외부 리뷰 대상은 FLIGHT가 붙은 PR만: FLIGHT 없는 PR(DesignLAB 문서 PR 등)은 제외, 스트립에 \"FLIGHT 없음\"", () => {
  assert.equal(externalExclusionOf({ flight: null, ticketLabels: [], prLabels: [], files: ["docs/guide.md"], texts: [] }), "FLIGHT 없음");
  const g = pr({ url: "https://github.com/chaehy5665/DesignLAB/pull/21", title: "docs(guide): formScript 판정 상수 갱신", headRefName: "docs/formscript", body: "" });
  const p = buildPulls([{ repo: "/r/DesignLAB", pulls: [g] }], [], [], new Map(), () => null, at(3), { silentMs: SIX, reviews: [], ticketLabelsOf: () => [] })[0];
  assert.deepEqual([p.extReview?.status, p.extReview?.reason], ["excluded", "FLIGHT 없음"]);
  assert.match(p.blocks.find((b) => b.code === "no-review")!.text, /외부 리뷰 제외\(FLIGHT 없음\)/);
  assert.throws(() => assertReviewTarget(p), (e) => e instanceof ReviewError && e.status === 403 && /FLIGHT 없음/.test(e.message));
});

test("착륙: Codex 한도 + 보안 아닌 PR의 현재 head DeepSeek pass(P0·P1 없음)면 CLEARED, 계열이 남는다. 옛 Muse 기록도 그대로 센다", () => {
  const p = build(pr(), [review()]);
  assert.equal(p.landing, "CLEARED");
  assert.deepEqual(p.codexUnavailable, { why: "limit", since: at(1) });
  assert.equal(p.extReview?.status, "pass");
  assert.equal(p.extReview?.review?.family, "deepseek-v4.1-flash");
  assert.equal(reviewerOf(p.extReview!.review!.family), "DEEPSEEK");
  const old = build(pr(), [review({ by: "CROSSCHECK", model: "muse-spark-1.3-contributor", family: "muse-spark-1.3" })]);
  assert.equal(old.landing, "CLEARED");
  assert.equal(reviewerOf(old.extReview!.review!.family), "MUSE");
});

test("리뷰 대기·옛 head·지적·제외는 APPROACH. 지적 글은 CAPTAIN에게 가도록 block에 든다", () => {
  const waiting = build(pr());
  assert.equal(waiting.landing, "APPROACH");
  assert.equal(waiting.extReview?.status, "waiting");
  assert.match(waiting.blocks.find((b) => b.code === "no-review")!.text, /Codex 한도 — 착륙 리뷰 대기\(REVIEW 세션\)/);
  // 새 head: 이전 head의 pass는 세지 않는다
  const stale = build(pr({ headRefOid: "b".repeat(40) }), [review()]);
  assert.equal(stale.extReview?.status, "waiting");
  assert.equal(stale.landing, "APPROACH");
  // 지적(P1)
  const found = build(pr(), [review(), review({ at: at(2.5), verdict: "findings", text: "P1 캐시 무효화 누락", p1: 1, p2: 0 })]);
  assert.equal(found.extReview?.status, "findings");
  const b = found.blocks.find((x) => x.code === "review-findings")!;
  assert.match(b.text, /^DEEPSEEK 지적\(Codex 한도, head aaaaaaa, P0 0 · P1 1 · P2 0\): P1 캐시 무효화 누락 — 반영 후 새 head에서 재리뷰$/);
  // pass라도 P1이 붙어 있으면 통과가 아니다(서버가 받지 않지만 기록이 그렇다면)
  assert.equal(extReviewStateOf({ unavailable: { why: "limit", since: at(1) }, exclusion: null, review: review({ p1: 1 }) })?.status, "findings");
  // 제외: 리뷰가 있어도 통과시키지 않는다
  const sec = build(pr(), [review()], ["rating:SEC"]);
  assert.equal(sec.landing, "APPROACH");
  assert.deepEqual([sec.extReview?.status, sec.extReview?.reason], ["excluded", "rating:SEC"]);
  assert.match(sec.blocks.find((x) => x.code === "no-review")!.text, /외부 리뷰 제외\(rating:SEC\) — Codex나 SUPERVISOR 리뷰 필요/);
  assert.equal(build(pr({ files: ["app/page.tsx", ".env.example"] }), [review()]).extReview?.status, "excluded");
  // 무응답은 그렇게 적는다
  const silent = build(pr({ codex: { headAt: HEAD_AT, thumbsAt: null, lastComment: null } }), [], [], 7);
  assert.match(silent.blocks.find((x) => x.code === "no-review")!.text, /Codex 6시간 응답 없음 — 착륙 리뷰 대기/);
});

test("Codex가 돌아오면 Codex가 이긴다: head 👍면 외부 리뷰 없이 CLEARED, head Codex 지적이면 외부 pass가 있어도 막힌다", () => {
  const thumbs = build(pr({ codex: { headAt: HEAD_AT, thumbsAt: at(2.8), lastComment: { at: at(1), limit: true } } }), [review()]);
  assert.equal(thumbs.landing, "CLEARED");
  assert.equal(thumbs.extReview, null);
  const codexFound = build(pr({ reviews: [{ author: { login: "chatgpt-codex-connector" }, state: "COMMENTED", submittedAt: at(2.8), commit: { oid: HEAD } }] }), [review()]);
  assert.equal(codexFound.landing, "APPROACH");
  assert.equal(codexFound.extReview, null);
  assert.match(codexFound.blocks[0].text, /Codex 지적/);
  // 착륙 리뷰 옵션 없이(옛 호출) 부르면 예전 그대로
  const legacy = buildPulls([{ repo: "/r", pulls: [pr()] }], [], [], new Map(), () => null, at(3))[0];
  assert.equal(legacy.extReview, null);
  assert.match(legacy.blocks.find((x) => x.code === "no-review")!.text, /Codex 한도 — 사람 리뷰 필요/);
});

test("리뷰 기록 검사: 지금 head만(짧은 SHA 가능), pass에 P0·P1 없음, findings에 등급, 모델은 DeepSeek V4.1 Flash만이고 계열을 남긴다", () => {
  const p = { url: pr().url, number: 385, head: HEAD };
  const r = parseReview({ head: "aaaaaaa", verdict: "pass", text: "OK. P2 로그 문구", model: "claude-ocx-opencode-go--deepseek-v4.1-flash" }, p, at(2));
  assert.deepEqual([r.repo, r.head, r.family, r.p2, r.by], ["chaehy5665/vocado_nextjs", HEAD, "deepseek-v4.1-flash", 1, "REVIEW"]);
  const bad = (body: Record<string, unknown>, status: number, re: RegExp) =>
    assert.throws(() => parseReview({ head: HEAD, verdict: "pass", text: "ok", model: "deepseek-v4.1-flash", ...body }, p, at(2)), (e) => e instanceof ReviewError && e.status === status && re.test(e.message));
  bad({ head: "bbbbbbb" }, 409, /새 head는 새 리뷰/);
  bad({ head: "aaa" }, 409, /지금 head/);
  bad({ verdict: "lgtm" }, 400, /pass\|findings/);
  bad({ text: "" }, 400, /text/);
  bad({ text: "x".repeat(4001) }, 400, /4000자/);
  bad({ text: "P1 누락" }, 400, /pass에는 P0·P1/);
  bad({ verdict: "findings", text: "조금 이상함" }, 400, /등급/);
  bad({ model: "" }, 400, /model이 없음/);
  // CROSSCHECK(Muse)·다른 모델은 이제 착륙 리뷰를 남기지 않는다
  for (const m of ["claude-ocx-opencode-go--muse-spark-1.3-contributor", "claude-opus-5-5", "deepseek-v4-pro"]) bad({ model: m }, 400, /DeepSeek V4\.1 Flash만/);
  assert.deepEqual(severityOf("P0 a. P1 b, P1 c; P2 d. SP1X는 아님"), { p0: 1, p1: 2, p2: 1 });
});

test("대상 찾기와 외부 리뷰 대상 검사: Draft·Codex 가능·제외는 자료를 주지 않는다", () => {
  const cleared = build(pr(), [review()]);
  const pulls = [cleared];
  assert.equal(findPull(pulls, "vocado_nextjs", 385), cleared);
  assert.equal(findPull(pulls, "chaehy5665/vocado_nextjs", 385), cleared);
  assert.throws(() => findPull(pulls, "vocado_nextjs", 1), (e) => e instanceof ReviewError && e.status === 404);
  assertReviewTarget(build(pr())); // 대기
  assert.throws(() => assertReviewTarget(build(pr(), [], ["Risk: Security"])), (e) => e instanceof ReviewError && e.status === 403 && /Risk: Security/.test(e.message));
  assert.throws(() => assertReviewTarget(build(pr({ codex: { headAt: HEAD_AT, thumbsAt: at(2), lastComment: null } }))), (e) => e instanceof ReviewError && e.status === 409);
  assert.throws(() => assertReviewTarget(build(pr({ isDraft: true, codex: undefined }))), (e) => e instanceof ReviewError && e.status === 409);
});

test("자료: 이슈의 완료 기준·금지 사항 절, 긴 글은 줄 경계에서 자르고 알린다", () => {
  const md = "## 목표\nx\n## 금지 사항\n- DB 스키마 변경 금지\n## 완료 기준\n- 서버 전용 모듈이 action에서 빠짐\n### 확인\n- 테스트\n## 참고\ny";
  assert.deepEqual(sectionsOf(md), { acceptance: "- 서버 전용 모듈이 action에서 빠짐\n### 확인\n- 테스트", forbidden: "- DB 스키마 변경 금지" });
  assert.deepEqual(sectionsOf("**Acceptance criteria**\n- a\n**Out of scope**\n- b"), { acceptance: "- a", forbidden: "- b" });
  assert.deepEqual(sectionsOf("그냥 본문"), { acceptance: null, forbidden: null });
  const cut = capText("line1\nline2\nline3", 12);
  assert.deepEqual(cut, { text: "line1\nline2", truncated: true, chars: 17 });
  assert.deepEqual(capText("short", 12), { text: "short", truncated: false, chars: 5 });
});

// ATC-27: 라벨 없는 VOC 보안 PR 7개가 Muse로 나갔다(그중 #391·#396·#397·#398은 Muse pass만으로 CLEARED). 실제 제목·경로
const SECURITY_PRS: { n: number; flight: string; title: string; files: string[]; body: string; want: RegExp }[] = [
  { n: 382, flight: "VOC-182", title: "Check beta admission in the settings save and timing-calibration actions (VOC-182)",
    files: ["src/app/[locale]/(timing-calibration)/timing-calibration/check-eligibility.ts", "src/app/[locale]/(timing-calibration)/timing-calibration/page.tsx", "src/app/[locale]/(web)/settings/actions.ts", "src/app/[locale]/(web)/settings/save-settings.ts", "tests/beta-action-admission.test.ts", "tests/settings-contract.test.ts"],
    body: "", want: /^admission$/ },
  { n: 388, flight: "VOC-41", title: "Close the Data API surface of three legacy definer views (VOC-41)",
    files: ["supabase/migrations/20260925173440_voc41_close_legacy_definer_view_data_api.sql", "tests/fixtures/voc-41-legacy-definer-view-boundary-runtime.sql", "tests/voc-41-legacy-definer-view-boundary.test.ts"],
    body: "", want: /^migrations$/ },
  { n: 391, flight: "VOC-186", title: "Keep server-only learning modules out of the server-action surface (VOC-186)",
    files: ["src/server/learning-profile-actions.ts", "src/server/lyrics-learning-actions.ts", "tests/server-action-boundary.test.ts", "tests/web-word-study-contract.test.ts"],
    body: "Closes the latent `\"use server\"` exposure: these modules must not be callable as server actions.", want: /^키워드 (use server|exposure)$/ },
  { n: 395, flight: "VOC-189", title: "Replay migrations under the hosted public-function default (VOC-189)",
    files: ["docs/supabase_contracts.md", "scripts/test-core-pr-database.ts", "scripts/test-voc-43-migration-catalog.ts", "tests/fixtures/voc-189-public-only-revoke-under-hosted-default.sql", "tests/voc-43-public-function-execute-boundary-catalog.test.ts"],
    body: "", want: /^SQL$/ },
  { n: 396, flight: "VOC-189", title: "Revoke the hosted public-function default from the API roles (VOC-189)",
    files: ["docs/supabase_contracts.md", "scripts/test-core-pr-database.ts", "scripts/test-voc-43-migration-catalog.ts", "supabase/migrations/20260926022400_voc189_revoke_hosted_public_function_default.sql", "tests/fixtures/voc-189-new-function-after-default-revoke.sql", "tests/voc-189-hosted-function-default-revoke.test.ts", "tests/voc-43-public-function-execute-boundary-catalog.test.ts", "tests/voc-43-public-function-execute-boundary.test.ts"],
    body: "", want: /^migrations$/ },
  { n: 397, flight: "VOC-189", title: "Close direct EXECUTE on 30 legacy public functions (VOC-189)",
    files: ["docs/supabase_contracts.md", "scripts/test-core-pr-database.ts", "scripts/test-voc-43-migration-catalog.ts", "supabase/migrations/20260926023832_voc189_close_legacy_public_function_execute.sql", "tests/voc-189-public-function-execute-closure.test.ts", "tests/voc-43-public-function-execute-boundary.test.ts"],
    body: "", want: /^migrations$/ },
  { n: 398, flight: "VOC-190", title: "Enforce the lyric_learning function EXECUTE invariant in the gates (VOC-190)",
    files: ["docs/supabase_contracts.md", "scripts/test-core-pr-database.ts", "scripts/test-voc-43-migration-catalog.ts", "tests/fixtures/voc-190-lyric-learning-probe-with-revoke.sql", "tests/fixtures/voc-190-lyric-learning-probe-without-revoke.sql", "tests/voc-190-lyric-learning-function-execute.test.ts", "tests/voc-43-public-function-execute-boundary.test.ts"],
    body: "", want: /^SQL$/ },
];
const securityPull = (x: (typeof SECURITY_PRS)[number], files: string[] | undefined = x.files) =>
  pr({ number: x.n, url: `https://github.com/chaehy5665/vocado_nextjs/pull/${x.n}`, title: x.title, body: x.body, files, labels: [] });
const buildSec = (x: (typeof SECURITY_PRS)[number], g: GhPull) =>
  buildPulls([{ repo: "/r/vocado_nextjs", pulls: [g] }], [], [], new Map(), () => x.flight, at(3), {
    silentMs: SIX,
    // 이미 남은 외부 pass(옛 Muse, 새 DeepSeek)가 있어도
    reviews: [review({ number: x.n, by: "CROSSCHECK", model: "muse-spark-1.3-contributor", family: "muse-spark-1.3" }), review({ number: x.n, at: at(2.5) })],
    ticketLabelsOf: () => [], // VOC FLIGHT에는 분류 라벨이 없다
    ticketTitleOf: () => null,
  })[0];

test("ATC-27 보안 PR 7개: 라벨이 없어도 경로·제목·본문으로 외부 리뷰에서 빠지고, 외부 pass가 있어도 CLEARED가 아니다", () => {
  for (const x of SECURITY_PRS) {
    const p = buildSec(x, securityPull(x));
    assert.equal(p.extReview?.status, "excluded", `#${x.n}`);
    assert.match(p.extReview!.reason!, x.want, `#${x.n}: ${p.extReview!.reason}`);
    assert.equal(p.landing, "APPROACH", `#${x.n}`);
    assert.match(p.blocks.find((b) => b.code === "no-review")!.text, /외부 리뷰 제외\(.+\) — Codex나 SUPERVISOR 리뷰 필요/, `#${x.n}`);
    assert.throws(() => assertReviewTarget(p), (e) => e instanceof ReviewError && e.status === 403, `#${x.n}`);
    // 바뀐 파일을 아직 못 읽었어도 제목·본문으로 빠진다(#382·#388·#396·#397·#398은 제목에, #391·#395는 본문에 키워드)
    const noFiles = buildSec(x, pr({ number: x.n, url: `https://github.com/chaehy5665/vocado_nextjs/pull/${x.n}`, title: x.title, body: x.n === 395 ? "Replays the revoke under hosted default privileges." : x.body, files: undefined }));
    assert.equal(noFiles.extReview?.status, "excluded", `#${x.n} 파일 없이`);
  }
});

test("보안 경로·키워드: supabase migrations·functions, *.sql, auth·session·admission, RLS·policy, middleware, 비밀. 보안 아닌 PR은 그대로", () => {
  const tag = (f: string) => securityPathOf([f])?.tag ?? null;
  assert.equal(tag("supabase/migrations/20260926_x.sql"), "migrations");
  assert.equal(tag("supabase/functions/send-mail/index.ts"), "supabase functions");
  assert.equal(tag("db/seed.sql"), "SQL");
  for (const f of ["src/lib/auth.ts", "src/app/(auth)/login/page.tsx", "src/server/authentication/verify.ts", "src/lib/oauth/callback.ts"]) assert.equal(tag(f), "auth", f);
  for (const f of ["src/lib/session.ts", "src/app/api/sessions/route.ts"]) assert.equal(tag(f), "session", f);
  assert.equal(tag("src/server/beta-admission.ts"), "admission");
  for (const f of ["supabase/rls/words.ts", "src/db/policies/learning.ts", "docs/policy.md"]) assert.equal(tag(f), "RLS·policy", f);
  for (const f of ["middleware.ts", "src/middleware.ts", "src/middleware/locale.ts"]) assert.equal(tag(f), "middleware", f);
  assert.equal(tag(".env.local"), "비밀·키 경로");
  for (const f of ["src/components/AuthorCard.tsx", "src/app/[locale]/(landing)/page.tsx", "src/lib/keyboard.ts", "tests/session-timing.test.ts".replace("session", "sessio")]) assert.equal(tag(f), null, f);
  const word = (t: string) => securityWordOf([t]);
  for (const [t, w] of [["Revoke default privileges", "revoke"], ["Tighten RLS on lyrics", "rls"], ["Close legacy definer views", "definer"], ["grant EXECUTE to anon", "EXECUTE"], ["\"use server\" boundary", "use server"], ["ACL drift", "acl"], ["Auth callback", "auth"], ["Security hardening", "security"], ["Data exposure", "exposure"]] as const) assert.equal(word(t), w, t);
  for (const t of ["Give the landing's cards their pointer responses", "Execute the migration plan later", "Author card spacing"]) assert.equal(word(t), null, t);
  // 보안 아닌 #385는 대상 그대로(DeepSeek 리뷰를 받을 수 있다)
  assert.equal(build(pr()).extReview?.status, "waiting");
});

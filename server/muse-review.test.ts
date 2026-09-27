import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPulls, codexUnavailableOf, type GhPull, museExclusionOf, type MuseReview, museStateOf, secretPathOf, severityOf } from "./landing.ts";
import { assertMuseTarget, capText, findPull, parseReview, ReviewError, sectionsOf } from "./landing-review.ts";

const HEAD = "a".repeat(40);
const HEAD_AT = "2026-09-27T00:00:00Z";
const HOUR = 3_600_000;
const SIX = 6 * HOUR;
const at = (h: number) => new Date(Date.parse(HEAD_AT) + h * HOUR).toISOString();

const pr = (over: Partial<GhPull> = {}): GhPull => ({
  number: 391,
  title: "Keep server-only modules out (VOC-201)",
  url: "https://github.com/chaehy5665/vocado_nextjs/pull/391",
  headRefName: "voc-201-server-only",
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
  files: ["app/learn/page.tsx"],
  ...over,
});
const review = (over: Partial<MuseReview> = {}): MuseReview => ({
  at: at(2), repo: "chaehy5665/vocado_nextjs", number: 391, head: HEAD, verdict: "pass", text: "완료 기준 충족. P2 이름 정리",
  by: "CROSSCHECK", model: "muse-spark-1.3-contributor", family: "muse-spark-1.3", p0: 0, p1: 0, p2: 1, ...over,
});
const build = (g: GhPull, reviews: MuseReview[] = [], labels: string[] = [], nowH = 3) =>
  buildPulls([{ repo: "/r/vocado_nextjs", pulls: [g] }], [], [], new Map(), () => "VOC-201", at(nowH), { silentMs: SIX, reviews, ticketLabelsOf: () => labels })[0];

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

test("Muse 제외: rating:SEC·Risk: Security·Risk/Security(FLIGHT), Risk: Rights·Contract(PR·FLIGHT), .env·비밀·키 경로", () => {
  const ex = (ticketLabels: string[], prLabels: string[] = [], files: string[] | null = []) => museExclusionOf({ ticketLabels, prLabels, files });
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

test("착륙: Codex 한도 + 현재 head Muse pass(P0·P1 없음)면 CLEARED, 표시는 MUSE 통과", () => {
  const p = build(pr(), [review()]);
  assert.equal(p.landing, "CLEARED");
  assert.deepEqual(p.codexUnavailable, { why: "limit", since: at(1) });
  assert.equal(p.muse?.status, "pass");
  assert.equal(p.muse?.review?.family, "muse-spark-1.3");
});

test("Muse 대기·옛 head·지적·제외는 APPROACH. 지적 글은 CAPTAIN에게 가도록 block에 든다", () => {
  const waiting = build(pr());
  assert.equal(waiting.landing, "APPROACH");
  assert.equal(waiting.muse?.status, "waiting");
  assert.match(waiting.blocks.find((b) => b.code === "no-review")!.text, /Codex 한도 — Muse 리뷰 대기/);
  // 새 head: 이전 head의 pass는 세지 않는다
  const stale = build(pr({ headRefOid: "b".repeat(40) }), [review()]);
  assert.equal(stale.muse?.status, "waiting");
  assert.equal(stale.landing, "APPROACH");
  // 지적(P1)
  const found = build(pr(), [review(), review({ at: at(2.5), verdict: "findings", text: "P1 캐시 무효화 누락", p1: 1, p2: 0 })]);
  assert.equal(found.muse?.status, "findings");
  const b = found.blocks.find((x) => x.code === "review-findings")!;
  assert.match(b.text, /^Muse 지적\(Codex 한도, head aaaaaaa, P0 0 · P1 1 · P2 0\): P1 캐시 무효화 누락 — 반영 후 새 head에서 재리뷰$/);
  // pass라도 P1이 붙어 있으면 통과가 아니다(서버가 받지 않지만 기록이 그렇다면)
  assert.equal(museStateOf({ unavailable: { why: "limit", since: at(1) }, exclusion: null, review: review({ p1: 1 }) })?.status, "findings");
  // 제외: 리뷰가 있어도 통과시키지 않는다
  const sec = build(pr(), [review()], ["rating:SEC"]);
  assert.equal(sec.landing, "APPROACH");
  assert.deepEqual([sec.muse?.status, sec.muse?.reason], ["excluded", "rating:SEC"]);
  assert.match(sec.blocks.find((x) => x.code === "no-review")!.text, /Muse 리뷰 제외\(rating:SEC\) — Codex나 SUPERVISOR 리뷰 필요/);
  assert.equal(build(pr({ files: ["app/page.tsx", ".env.example"] }), [review()]).muse?.status, "excluded");
  // 무응답은 그렇게 적는다
  const silent = build(pr({ codex: { headAt: HEAD_AT, thumbsAt: null, lastComment: null } }), [], [], 7);
  assert.match(silent.blocks.find((x) => x.code === "no-review")!.text, /Codex 6시간 응답 없음 — Muse 리뷰 대기/);
});

test("Codex가 돌아오면 Codex가 이긴다: head 👍면 Muse 없이 CLEARED, head Codex 지적이면 Muse pass가 있어도 막힌다", () => {
  const thumbs = build(pr({ codex: { headAt: HEAD_AT, thumbsAt: at(2.8), lastComment: { at: at(1), limit: true } } }), [review()]);
  assert.equal(thumbs.landing, "CLEARED");
  assert.equal(thumbs.muse, null);
  const codexFound = build(pr({ reviews: [{ author: { login: "chatgpt-codex-connector" }, state: "COMMENTED", submittedAt: at(2.8), commit: { oid: HEAD } }] }), [review()]);
  assert.equal(codexFound.landing, "APPROACH");
  assert.equal(codexFound.muse, null);
  assert.match(codexFound.blocks[0].text, /Codex 지적/);
  // Muse 옵션 없이(옛 호출) 부르면 예전 그대로
  const legacy = buildPulls([{ repo: "/r", pulls: [pr()] }], [], [], new Map(), () => null, at(3))[0];
  assert.equal(legacy.muse, null);
  assert.match(legacy.blocks.find((x) => x.code === "no-review")!.text, /Codex 한도 — 사람 리뷰 필요/);
});

test("리뷰 기록 검사: 지금 head만(짧은 SHA 가능), pass에 P0·P1 없음, findings에 등급, 모델은 필수이고 계열을 남긴다", () => {
  const p = { url: pr().url, number: 391, head: HEAD };
  const r = parseReview({ head: "aaaaaaa", verdict: "pass", text: "OK. P2 로그 문구", model: "claude-ocx-opencode-go--muse-spark-1.3-contributor" }, p, at(2));
  assert.deepEqual([r.repo, r.head, r.family, r.p2, r.by], ["chaehy5665/vocado_nextjs", HEAD, "muse-spark-1.3", 1, "CROSSCHECK"]);
  const bad = (body: Record<string, unknown>, status: number, re: RegExp) =>
    assert.throws(() => parseReview({ head: HEAD, verdict: "pass", text: "ok", model: "muse", ...body }, p, at(2)), (e) => e instanceof ReviewError && e.status === status && re.test(e.message));
  bad({ head: "bbbbbbb" }, 409, /새 head는 새 리뷰/);
  bad({ head: "aaa" }, 409, /지금 head/);
  bad({ verdict: "lgtm" }, 400, /pass\|findings/);
  bad({ text: "" }, 400, /text/);
  bad({ text: "x".repeat(4001) }, 400, /4000자/);
  bad({ text: "P1 누락" }, 400, /pass에는 P0·P1/);
  bad({ verdict: "findings", text: "조금 이상함" }, 400, /등급/);
  bad({ model: "" }, 400, /model이 없음/);
  assert.deepEqual(severityOf("P0 a. P1 b, P1 c; P2 d. SP1X는 아님"), { p0: 1, p1: 2, p2: 1 });
});

test("대상 찾기와 Muse 대상 검사: Draft·Codex 가능·제외는 자료를 주지 않는다", () => {
  const cleared = build(pr(), [review()]);
  const pulls = [cleared];
  assert.equal(findPull(pulls, "vocado_nextjs", 391), cleared);
  assert.equal(findPull(pulls, "chaehy5665/vocado_nextjs", 391), cleared);
  assert.throws(() => findPull(pulls, "vocado_nextjs", 1), (e) => e instanceof ReviewError && e.status === 404);
  assertMuseTarget(build(pr())); // 대기
  assert.throws(() => assertMuseTarget(build(pr(), [], ["Risk: Security"])), (e) => e instanceof ReviewError && e.status === 403 && /Risk: Security/.test(e.message));
  assert.throws(() => assertMuseTarget(build(pr({ codex: { headAt: HEAD_AT, thumbsAt: at(2), lastComment: null } }))), (e) => e instanceof ReviewError && e.status === 409);
  assert.throws(() => assertMuseTarget(build(pr({ isDraft: true, codex: undefined }))), (e) => e instanceof ReviewError && e.status === 409);
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

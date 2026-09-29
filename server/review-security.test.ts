import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadDispatchConfig, saveExternalReviewSecurity } from "./dispatch.ts";
import { buildPulls, externalExclusionOf, externalGateOf, type GhPull, type LandingReview } from "./landing.ts";
import { assertReviewTarget, parseReview, ReviewError } from "./landing-review.ts";

// ATC-30: Codex 5시간 한도로 리뷰어 없이 멈춘 vocado #392·#395(보안 규칙에만 걸림). 실제 제목·경로
const HEAD = "d".repeat(40);
const AT = "2026-09-27T15:00:00Z";
const pr = (n: number, title: string, files: string[], body: string, headRefName: string): GhPull => ({
  number: n, title, url: `https://github.com/chaehy5665/vocado_nextjs/pull/${n}`, headRefName, headRefOid: HEAD, baseRefName: "main",
  isDraft: false, mergeStateStatus: "CLEAN", reviewDecision: null, createdAt: "2026-09-27T09:00:00Z", author: { login: "chaehy5665" },
  statusCheckRollup: [{ __typename: "CheckRun", name: "check", status: "COMPLETED", conclusion: "SUCCESS" }], reviews: [], labels: [],
  codex: { headAt: "2026-09-27T09:00:00Z", thumbsAt: null, lastComment: { at: "2026-09-27T10:00:00Z", limit: true } }, files, body,
});
const PR392 = pr(392, "Tell the owner about new song requests through a webhook, id only (VOC-188)",
  ["docs/beta-song-requests.md", "src/server/song-requests.ts", "tests/song-requests.test.ts"],
  "- admission, the `songRequestsOffered` gate (VOC-185), and the staging write target;", "claude/voc-188-notify-new-song-requests");
const PR395 = pr(395, "Replay migrations under the hosted public-function default (VOC-189)",
  ["docs/supabase_contracts.md", "scripts/test-core-pr-database.ts", "scripts/test-voc-43-migration-catalog.ts", "tests/fixtures/voc-189-public-only-revoke-under-hosted-default.sql", "tests/voc-43-public-function-execute-boundary-catalog.test.ts"],
  "", "claude/voc-189-replay-seeds-hosted-function-default");
const SECRETS = pr(401, "Rotate the webhook signing secret (VOC-199)", ["src/server/song-requests.ts", ".env.example"], "", "claude/voc-199-rotate-webhook-secret");
const deepseek = (n: number, over: Partial<LandingReview> = {}): LandingReview => ({
  at: AT, repo: "chaehy5665/vocado_nextjs", number: n, head: HEAD, verdict: "pass", text: "권한·RLS 변경 없음. P2 로그 문구",
  by: "REVIEW", model: "claude-ocx-opencode-go--deepseek-v4.1-flash", family: "deepseek-v4.1-flash", p0: 0, p1: 0, p2: 1, ...over,
});
const build = (g: GhPull, security: "exclude" | "deepseek" | undefined, reviews: LandingReview[] = []) =>
  buildPulls([{ repo: "/r/vocado_nextjs", pulls: [g], defaultBranch: "main" }], [], [], new Map(), (x) => /VOC-\d+/.exec(x.title)?.[0] ?? null, "2026-09-27T16:00:00Z", {
    silentMs: 6 * 3_600_000, reviews, ticketLabelsOf: () => [], ticketTitleOf: () => null, security,
  })[0];

test("사유 나누기: FLIGHT 없음·비밀 경로는 hard(어느 모드에서든), 라벨·보안 경로·키워드는 security(스위치로 보낼 수 있음)", () => {
  const x = (over: Partial<Parameters<typeof externalGateOf>[0]>) => externalGateOf({ flight: "VOC-1", ticketLabels: [], prLabels: [], files: [], texts: [], ...over });
  assert.deepEqual(x({ flight: null }), { hard: "FLIGHT 없음", security: null });
  assert.deepEqual(x({ files: ["supabase/migrations/1.sql", ".env.local"] }), { hard: "비밀·키 경로 .env.local", security: null }); // 비밀이 먼저
  assert.deepEqual(x({ ticketLabels: ["rating:SEC"] }), { hard: null, security: "rating:SEC" });
  assert.deepEqual(x({ prLabels: ["Risk: Rights"] }), { hard: null, security: "Risk: Rights" });
  assert.deepEqual(x({ files: ["supabase/migrations/1.sql"] }), { hard: null, security: "migrations" });
  assert.deepEqual(x({ texts: ["Revoke the default"] }), { hard: null, security: "키워드 revoke" });
  assert.deepEqual(x({ files: ["src/app/page.tsx"], texts: ["Pointer responses"] }), { hard: null, security: null });
  // 옛 함수는 모드를 받는다(기본 exclude)
  assert.equal(externalExclusionOf({ flight: "VOC-1", ticketLabels: [], prLabels: [], files: ["x.sql"], texts: [] }), "SQL");
  assert.equal(externalExclusionOf({ flight: "VOC-1", ticketLabels: [], prLabels: [], files: ["x.sql"], texts: [] }, "deepseek"), null);
  assert.equal(externalExclusionOf({ flight: "VOC-1", ticketLabels: [], prLabels: [], files: [".env"], texts: [] }, "deepseek"), "비밀·키 경로 .env");
});

test("스위치 꺼짐(기본·exclude): #392·#395는 지금처럼 외부 리뷰에서 빠지고 DeepSeek pass가 있어도 APPROACH", () => {
  for (const mode of [undefined, "exclude"] as const) {
    const a = build(PR392, mode, [deepseek(392)]);
    const b = build(PR395, mode, [deepseek(395)]);
    assert.deepEqual([a.extReview?.status, a.extReview?.reason, a.landing], ["excluded", "키워드 admission", "APPROACH"]);
    assert.deepEqual([b.extReview?.status, b.extReview?.reason, b.landing], ["excluded", "SQL", "APPROACH"]);
  }
});

test("스위치 켜짐(deepseek): #392·#395는 REVIEW 대기열로 가고(보안 사유가 남는다), DeepSeek pass면 CLEARED. 비밀 경로·FLIGHT 없음은 그대로 빠진다", () => {
  const wait392 = build(PR392, "deepseek");
  assert.deepEqual([wait392.extReview?.status, wait392.extReview?.security], ["waiting", "키워드 admission"]);
  assert.match(wait392.blocks[0].text, /착륙 리뷰 대기\(REVIEW 세션, 보안 PR: 키워드 admission\)/);
  assertReviewTarget(wait392); // 자료를 줄 수 있다
  const wait395 = build(PR395, "deepseek");
  assert.deepEqual([wait395.extReview?.status, wait395.extReview?.security], ["waiting", "SQL"]);
  for (const [g, n] of [[PR392, 392], [PR395, 395]] as const) {
    const p = build(g, "deepseek", [deepseek(n)]);
    assert.equal(p.landing, "CLEARED", `#${n}`);
    assert.equal(p.extReview?.status, "pass");
    assert.ok(p.extReview?.security, `#${n} 보안 사유`);
  }
  // 지적도 보안임을 적는다
  const found = build(PR395, "deepseek", [deepseek(395, { verdict: "findings", text: "P1 REVOKE 순서", p1: 1, p2: 0 })]);
  assert.match(found.blocks[0].text, /^DEEPSEEK 지적\(보안, Codex 한도,/);
  // 비밀 경로와 FLIGHT 없음: 어느 모드에서든 빠지고, pass가 있어도 CLEARED가 아니다
  for (const mode of ["exclude", "deepseek"] as const) {
    const s = build(SECRETS, mode, [deepseek(401)]);
    assert.deepEqual([s.extReview?.status, s.extReview?.reason, s.landing], ["excluded", "비밀·키 경로 .env.example", "APPROACH"], mode);
    assert.throws(() => assertReviewTarget(s), (e) => e instanceof ReviewError && e.status === 403);
    const noFlight = build(pr(21, "docs(guide): formScript 판정 상수 갱신", ["docs/x.md"], "", "docs/formscript"), mode);
    assert.equal(noFlight.extReview?.reason, "FLIGHT 없음", mode);
  }
});

test("기록: 스위치로 보낸 보안 PR의 리뷰는 security: true, 아니면 없음. 모델은 Claude Sonnet만(옛 DeepSeek·Muse 안 됨)", () => {
  const body = { head: HEAD.slice(0, 7), verdict: "pass", text: "OK. P2 x", model: "claude-sonnet-5-5" };
  const sec = parseReview(body, build(PR395, "deepseek"), AT);
  assert.equal(sec.security, true);
  const plain = parseReview(body, { ...build(PR395, "deepseek"), extReview: { status: "waiting", reason: null, review: null, security: null } }, AT);
  assert.equal("security" in plain, false);
  for (const model of ["muse-spark-1.3-contributor", "claude-ocx-opencode-go--deepseek-v4.1-flash"]) assert.throws(() => parseReview({ ...body, model }, build(PR395, "deepseek"), AT), /Claude Sonnet만/);
});

test("설정: dispatch.json externalReview.security — 기본 exclude, 모르는 값도 exclude, 저장은 다른 설정을 지우지 않는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-review-sec-"));
  try {
    const file = join(dir, "dispatch.json");
    assert.equal(loadDispatchConfig(file).externalReview.security, "exclude"); // 파일 없음
    writeFileSync(file, JSON.stringify({ mode: "approval", externalReview: { security: "everything" } }));
    assert.equal(loadDispatchConfig(file).externalReview.security, "exclude");
    saveExternalReviewSecurity("deepseek", file);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual([saved.mode, saved.externalReview.security], ["approval", "deepseek"]);
    assert.equal(loadDispatchConfig(file).externalReview.security, "deepseek");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

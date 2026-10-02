import assert from "node:assert/strict";
import { test } from "node:test";
import { CHECK_PATHS, checkPathOf, type KInput, kApprovalOf, kLandDaysOf } from "./k-approval.ts";
import type { K3Declaration } from "./k3-allow.ts";
import { landDecisionOf, type MccLandInfo } from "./land-by.ts";
import { type LandInput, landBlocksOf, parseMcc } from "./mcc.ts";
import { foldReleases, kConfirmOf, kPendingOf, type ReleaseLine, releaseHashOf } from "./release.ts";

// ATC-391: K 효과를 발권 때 한 번 승인하면, 승인한 것을 그대로 만든 user 등급 PR은 MCC가 착륙시킨다.

const BODY = "## Goal\nChange the guard\n\n## Done when\nguard blocks x\n\n## K effects\nK3[Security Weaken]: hook for x | files: hooks/new-hook.mjs, hooks/new-hook.test.mjs\n";
const HASH = releaseHashOf(BODY)!;
const DECL: K3Declaration[] = [{ label: "Security Weaken", control: "hook for x", files: ["hooks/new-hook.mjs", "hooks/new-hook.test.mjs"] }];
const T = "2026-10-02T10:00:00.000Z";

const rel = (channel: "screen" | "duty-chat" | "attested", hash = HASH, over: Partial<ReleaseLine & { op: "release" }> = {}): ReleaseLine => ({ op: "release", flight: "ATC-9", channel, at: T, hash, ...over }) as ReleaseLine;
const input = (lines: ReleaseLine[], over: Partial<KInput> = {}): KInput => ({
  mode: "on",
  flight: "ATC-9",
  files: ["hooks/new-hook.mjs", "hooks/new-hook.test.mjs", "docs/x.md"],
  userFiles: ["hooks/new-hook.mjs", "hooks/new-hook.test.mjs"],
  declared: DECL,
  unparsed: 0,
  hash: HASH,
  releases: foldReleases(lines),
  ...over,
});

test("within the declaration, released through a channel the server can verify: ok, with the release id", () => {
  for (const channel of ["screen", "duty-chat"] as const) {
    const v = kApprovalOf(input([rel(channel)]));
    assert.ok(v.ok, channel);
    if (v.ok) {
      assert.equal(v.release, `ATC-9@${HASH}`);
      assert.equal(v.channel, channel);
      assert.deepEqual(v.files, ["hooks/new-hook.mjs", "hooks/new-hook.test.mjs"]);
    }
  }
  // 선언한 파일 일부만 바꿔도 된다(선언은 상한이다)
  assert.ok(kApprovalOf(input([rel("screen")], { files: ["hooks/new-hook.mjs"], userFiles: ["hooks/new-hook.mjs"] })).ok);
});

test("the off switch refuses everything", () => {
  const v = kApprovalOf(input([rel("screen")], { mode: "off" }));
  assert.ok(!v.ok && v.code === "off");
});

test("a change beyond the declaration (a user-tier file that was not declared) is a new arrow", () => {
  const v = kApprovalOf(input([rel("screen")], { files: ["hooks/new-hook.mjs", ".claude/settings.json"], userFiles: ["hooks/new-hook.mjs", ".claude/settings.json"] }));
  assert.ok(!v.ok && v.code === "beyond-declaration");
  if (!v.ok) assert.deepEqual(v.files, [".claude/settings.json"]);
});

test("attested alone carries no K authority; the SUPERVISOR's one click (k-confirm on the same hash) does", () => {
  const attested = rel("attested", HASH, { session: "OCC", words: "release it" });
  const v = kApprovalOf(input([attested]));
  assert.ok(!v.ok && v.code === "attested-only");
  const confirmed = kApprovalOf(input([attested, { op: "k-confirm", flight: "ATC-9", hash: HASH, at: "2026-10-02T11:00:00.000Z" }]));
  assert.ok(confirmed.ok && confirmed.channel === "attested");
  // 다른 해시에 한 확인, 발권보다 앞선 확인은 세지 않는다
  assert.ok(!kApprovalOf(input([attested, { op: "k-confirm", flight: "ATC-9", hash: "other", at: "2026-10-02T11:00:00.000Z" }])).ok);
  assert.ok(!kApprovalOf(input([attested, { op: "k-confirm", flight: "ATC-9", hash: HASH, at: "2026-10-02T09:00:00.000Z" }])).ok);
  // 새 발권이 오면 이전 확인은 없어진다
  const again = kApprovalOf(input([attested, { op: "k-confirm", flight: "ATC-9", hash: HASH, at: "2026-10-02T11:00:00.000Z" }, rel("attested", HASH, { at: "2026-10-02T12:00:00.000Z" })]));
  assert.ok(!again.ok && again.code === "attested-only");
});

test("no release, a stale release (the issue changed after release), no FLIGHT, no or broken declaration", () => {
  assert.equal((kApprovalOf(input([])) as { code: string }).code, "no-release");
  assert.equal((kApprovalOf(input([rel("screen")], { hash: "changed-after-release" })) as { code: string }).code, "stale");
  assert.equal((kApprovalOf(input([rel("screen")], { flight: null })) as { code: string }).code, "no-flight");
  // 끝났거나 취소된 FLIGHT의 발권은 더 K 권한을 주지 않는다(이름을 빌린 PR)
  assert.equal((kApprovalOf(input([rel("screen")], { stateType: "completed" })) as { code: string }).code, "flight-closed");
  assert.equal((kApprovalOf(input([rel("screen")], { stateType: "canceled" })) as { code: string }).code, "flight-closed");
  assert.ok(kApprovalOf(input([rel("screen")], { stateType: "started" })).ok);
  assert.equal((kApprovalOf(input([rel("screen")], { declared: [] })) as { code: string }).code, "no-declaration");
  assert.equal((kApprovalOf(input([rel("screen")], { declared: undefined })) as { code: string }).code, "no-declaration");
  assert.equal((kApprovalOf(input([rel("screen")], { unparsed: 1 })) as { code: string }).code, "unreadable-declaration"); // 깨진 선언은 닫는 쪽으로
});

test("K1 and K2 paths (migrations, secrets) are not carried by this check", () => {
  const mig = kApprovalOf(input([rel("screen")], { files: ["supabase/migrations/20261002_x.sql"], userFiles: [] }));
  assert.ok(!mig.ok && mig.code === "k1-k2");
  const secret = kApprovalOf(input([rel("screen")], { files: ["config/.env.production"], userFiles: [] }));
  assert.ok(!secret.ok && secret.code === "k1-k2");
});

test("a PR that changes this check itself always stays with the SUPERVISOR, even with a perfect declaration", () => {
  for (const f of ["server/k-approval.ts", "server/mcc.ts", "server/mcc-run.ts", "server/land-by.ts", "server/release.ts", "server/release-run.ts", "server/settings.ts", "deploy/landing-tier.mjs", "mcc/CLAUDE.md", "mcc/.claude/agents/inspector.md", "mcc/agent-guard.mjs", "server/supervisor-auth.ts"]) {
    assert.equal(checkPathOf([f]), f, f);
    const decl: K3Declaration[] = [{ label: "Self-Modification", control: "the check", files: [f] }];
    const v = kApprovalOf(input([rel("screen")], { files: [f], userFiles: [f], declared: decl }));
    assert.ok(!v.ok && v.code === "check-itself", f);
  }
  assert.equal(checkPathOf(["docs/mcc.md", "server/other.ts"]), null);
  // 목록 파일 자신이 목록에 든다
  assert.ok(CHECK_PATHS.includes("server/k-approval.ts"));
});

test("kConfirmOf: only an attested release with a declaration, on the current hash", () => {
  const view = foldReleases([rel("attested"), rel("screen", HASH, { flight: "ATC-1" })]);
  const at = new Date(T);
  assert.ok(kConfirmOf(view, "ATC-9", HASH, HASH, true, at).ok);
  assert.equal((kConfirmOf(view, "ATC-9", HASH, HASH, false, at) as { status: number }).status, 409); // 선언 없음
  assert.equal((kConfirmOf(view, "ATC-9", "changed", HASH, true, at) as { status: number }).status, 409); // 발권 뒤 바뀜
  assert.equal((kConfirmOf(view, "ATC-9", HASH, "old-shown", true, at) as { status: number }).status, 409); // 화면에 보인 뒤 바뀜
  assert.equal((kConfirmOf(view, "ATC-1", HASH, HASH, true, at) as { status: number }).status, 409); // attested가 아님
  assert.equal((kConfirmOf(view, "ATC-7", HASH, HASH, true, at) as { status: number }).status, 404);
  const done = foldReleases([rel("attested"), { op: "k-confirm", flight: "ATC-9", hash: HASH, at: "2026-10-02T11:00:00.000Z" }]);
  assert.equal((kConfirmOf(done, "ATC-9", HASH, HASH, true, at) as { status: number }).status, 409); // 이미 확인
});

test("kPendingOf: attested K releases that still wait for the SUPERVISOR's click", () => {
  const view = foldReleases([rel("attested"), rel("attested", HASH, { flight: "ATC-2" }), { op: "k-confirm", flight: "ATC-2", hash: HASH, at: "2026-10-02T11:00:00.000Z" }, rel("screen", HASH, { flight: "ATC-3" })]);
  assert.deepEqual(kPendingOf(view, () => true).map((r) => r.flight), ["ATC-9"]);
  assert.deepEqual(kPendingOf(view, (f) => f !== "ATC-9"), []); // K 선언이 없는 발권은 확인할 것이 없다
});

// ── 착륙 조건과 누가 착륙시키나 ──
const land = (over: Partial<LandInput> = {}): LandInput => ({
  pr: { state: "open", draft: false, base: "main", head: "abcdef1234", mergeableState: "clean", fork: false },
  defaultBranch: "main",
  head: "abcdef1",
  tier: "user",
  tierReasons: ["guard"],
  escalated: null,
  ci: "ok",
  ciCheck: "check",
  inspection: { verdict: "pass" },
  held: false,
  groundStop: null,
  rtsBlocked: null,
  ...over,
});
const OK = kApprovalOf(input([rel("screen")]));

test("landBlocksOf: K approval lifts only the user-tier block; INSPECTION, CI, HOLD, ESCALATE and the rest still apply", () => {
  assert.deepEqual(landBlocksOf(land({ kApproval: OK })).map((b) => b.code), []);
  assert.ok(landBlocksOf(land()).some((b) => b.code === "L3")); // 판정이 없으면 전과 같다
  const no = kApprovalOf(input([]));
  const blocked = landBlocksOf(land({ kApproval: no })).find((b) => b.code === "L3");
  assert.match(blocked?.text ?? "", /K 승인 아님: .*발권 기록이 없음/);
  // 의심(ESCALATE)은 K 승인이 있어도 사용자 몫
  assert.ok(landBlocksOf(land({ kApproval: OK, escalated: { reason: "doubt" } })).some((b) => b.code === "L3"));
  // P0·P1 지적(INSPECTION findings), CI 실패, HOLD, GROUND STOP은 그대로 막는다
  assert.ok(landBlocksOf(land({ kApproval: OK, inspection: { verdict: "findings" } })).some((b) => b.code === "L6"));
  assert.ok(landBlocksOf(land({ kApproval: OK, inspection: null })).some((b) => b.code === "L6"));
  assert.ok(landBlocksOf(land({ kApproval: OK, ci: "failed" })).some((b) => b.code === "L4"));
  assert.ok(landBlocksOf(land({ kApproval: OK, held: true })).some((b) => b.code === "L7"));
  assert.ok(landBlocksOf(land({ kApproval: OK, groundStop: "main red" })).some((b) => b.code === "L7"));
});

test("landDecisionOf: a user-tier PR with K approval is MCC's; without it, the SUPERVISOR's", () => {
  const info = (k?: true): MccLandInfo => ({ repo: "/r/atc", mode: "land", holds: [], escalated: [], tiers: new Map([[7, { head: "h", tier: "user", ...(k ? { k } : {}) }]]) });
  const p = { repo: "/r/atc", number: 7, head: "h" };
  assert.deepEqual(landDecisionOf(p, info(), true), { by: "supervisor", why: "user" });
  assert.deepEqual(landDecisionOf(p, info(true), true), { by: "mcc", why: null });
  assert.equal(landDecisionOf(p, { ...info(true), escalated: [7] }, true).why, "escalate");
  assert.equal(landDecisionOf(p, { ...info(true), holds: [7] }, true).why, "hold");
  assert.equal(landDecisionOf(p, { ...info(true), mode: "shadow" }, true).why, "mode");
});

test("the switch is on by default; only an exact off turns it off", () => {
  assert.equal(parseMcc(null).kApproval, "on");
  assert.equal(parseMcc({ mode: "land" }).kApproval, "on");
  assert.equal(parseMcc({ kApproval: "off" }).kApproval, "off");
  assert.equal(parseMcc({ kApproval: "OFF" }).kApproval, "on");
  assert.equal(parseMcc({ kApproval: false }).kApproval, "on");
});

test("kLandDaysOf: K-approved landings per day, with reverts and ROLLBACKs counted against the landing", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  const lands = [
    { at: "2026-10-02T01:00:00Z", pr: 1, release: "ATC-9@h" },
    { at: "2026-10-02T02:00:00Z", pr: 2, release: "ATC-8@h" },
    { at: "2026-10-01T09:00:00Z", pr: 3, release: "ATC-7@h" },
    { at: "2026-10-01T09:00:00Z", pr: 3, release: "ATC-7@h" }, // 같은 PR의 두 번째 줄은 세지 않는다
  ];
  const reverts = [{ op: "revert-opened", pr: 2 }, { op: "hold", pr: 1 }];
  const rts = [
    { at: "2026-10-01T10:00:00Z", result: "ok" },
    { at: "2026-10-02T01:30:00Z", result: "rollback" }, // PR 1 착륙 뒤 첫 결과가 ROLLBACK
    { at: "2026-10-02T03:00:00Z", result: "ok" }, // PR 2 착륙 뒤 첫 결과는 ok
  ];
  const days = kLandDaysOf(lands, reverts, rts, 2, now);
  assert.deepEqual(days, [
    { day: "2026-10-01", landed: 1, reverted: 0, rolledBack: 0 },
    { day: "2026-10-02", landed: 2, reverted: 1, rolledBack: 1 },
  ]);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { ciOf, healthyVersion, planRts } from "./rts.mjs";

const A = "a".repeat(40);
const B = "b".repeat(40);
const base = { branch: "main", dirty: false, head: A, service: A, target: B, ancestor: true, ci: "ok", files: ["server/mcc.ts", "docs/mcc.md"] };

test("RTS 계획: main·깨끗함·fast-forward·CI 통과면 go, 서비스가 최신이면 noop", () => {
  assert.deepEqual(planRts(base), { action: "go", reason: "aaaaaaa → bbbbbbb" });
  assert.equal(planRts({ ...base, head: B, service: B }).action, "noop");
  // 체크아웃은 대상인데 서비스가 아님(지난 재시작 실패): 재시작만
  assert.deepEqual(planRts({ ...base, head: B, service: A }), { action: "go", reason: "재시작만 — 서비스가 aaaaaaa" });
  assert.match(planRts({ ...base, head: B, service: null }).reason, /모르는 커밋/);
});

test("RTS 거절: main 아님, 변경 있음, origin/main 모름, 갈라짐, CI, 의존성·유닛 변경", () => {
  const why = (over) => {
    const p = planRts({ ...base, ...over });
    assert.equal(p.action, "refuse", JSON.stringify(over));
    return p.reason;
  };
  assert.match(why({ branch: "claude/x" }), /main이 아님/);
  assert.match(why({ dirty: true }), /변경/);
  assert.match(why({ target: null }), /origin\/main/);
  assert.match(why({ ancestor: false }), /fast-forward/);
  assert.match(why({ ci: "pending" }), /진행 중/);
  assert.match(why({ ci: "failed" }), /실패/);
  assert.match(why({ ci: "none" }), /없음/);
  assert.match(why({ files: ["package-lock.json"] }), /의존성/);
  assert.match(why({ files: ["deploy/atc.service", "server/x.ts"] }), /systemd 유닛/);
  assert.match(why({ files: ["deploy/atc-rts.service"] }), /systemd 유닛/);
  assert.equal(planRts({ ...base, files: ["deploy/rts.mjs", "deploy/README.md"] }).action, "go");
});

test("상태 확인: /api/version의 head가 대상이고 재시작 뒤에 시작함", () => {
  const since = Date.parse("2026-09-28T09:00:00Z");
  assert.equal(healthyVersion({ head: B, startedAt: "2026-09-28T09:00:05Z" }, B, since), true);
  assert.equal(healthyVersion({ head: A, startedAt: "2026-09-28T09:00:05Z" }, B, since), false);
  assert.equal(healthyVersion({ head: B, startedAt: "2026-09-28T08:59:00Z" }, B, since), false);
  assert.equal(healthyVersion({ build: "x" }, B, since), false);
  assert.equal(healthyVersion(null, B, since), false);
});

test("CI: 마지막에 시작한 check run. 끝나지 않았으면 pending, 성공·neutral·skipped만 ok", () => {
  assert.equal(ciOf([]), "none");
  assert.equal(ciOf([{ status: "completed", conclusion: "failure", started_at: "1" }, { status: "completed", conclusion: "success", started_at: "2" }]), "ok");
  assert.equal(ciOf([{ status: "in_progress", conclusion: null, started_at: "3" }, { status: "completed", conclusion: "success", started_at: "2" }]), "pending");
  assert.equal(ciOf([{ status: "completed", conclusion: "cancelled", started_at: "1" }]), "failed");
});

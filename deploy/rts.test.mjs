import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSessions, ciOf, diedOf, healthyVersion, planRts, snapshotOf } from "./rts.mjs";

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

const row = (id, name, over = {}) => ({ id, sessionId: `s-${id}`, name, kind: "background", status: "idle", pid: Number(`1${id.length}`), cwd: "/x", ...over });
const okControl = { daemonInService: false, sessions: [] };

test("세션 스냅샷: 유령 줄(pid·status 없음)과 interactive는 뺀다(ATC-93)", () => {
  const rows = [row("aa11", "TOWER"), row("bb22", "OCC", { pid: undefined, status: "working" }), row("cc33", "ghost", { pid: undefined, status: undefined }), row("dd44", "tty", { kind: "interactive" })];
  assert.deepEqual(snapshotOf(rows).map((s) => s.id), ["aa11", "bb22"]);
  assert.deepEqual(snapshotOf(rows)[0], { id: "aa11", name: "TOWER", kind: "background", pid: 14 });
  assert.deepEqual(snapshotOf(null), []);
});

test("세션 점검: 모두 살아 있으면 ok, 세션이 없어도 ok", () => {
  const before = snapshotOf([row("aa11", "TOWER"), row("bb22", "TEAM_G")]);
  assert.equal(checkSessions({ before, after: [...before].reverse(), control: okControl }).ok, true);
  assert.equal(checkSessions({ before: [], after: [], control: okControl }).ok, true);
});

test("세션 점검: 하나가 죽으면 rollback 사유에 이름이 든다", () => {
  const before = snapshotOf([row("aa11", "TOWER"), row("bb22", "TEAM_G")]);
  const r = checkSessions({ before, after: before.slice(0, 1), control: okControl });
  assert.equal(r.ok, false);
  assert.deepEqual(r.failures, [{ check: "sessions", sessions: [{ id: "bb22", name: "TEAM_G" }] }]);
  assert.match(r.detail, /TEAM_G/);
  assert.deepEqual(diedOf(before, []), [{ id: "aa11", name: "TOWER" }, { id: "bb22", name: "TEAM_G" }]);
  // claude agents를 뒤에 못 읽으면 모두 죽은 것으로 본다
  assert.equal(checkSessions({ before, after: null, control: okControl }).ok, false);
});

test("세션 점검: daemon이 서비스 안이거나 control 엔드포인트가 답하지 않으면 실패", () => {
  const before = snapshotOf([row("aa11", "TOWER")]);
  const d = checkSessions({ before, after: before, control: { daemonInService: true } });
  assert.deepEqual(d.failures.map((f) => f.check), ["daemon-in-service"]);
  const c = checkSessions({ before, after: before, control: null });
  assert.deepEqual(c.failures.map((f) => f.check), ["control-sessions"]);
});

test("세션 점검: 유령 줄은 무시하고, 재시작 전 목록을 못 읽으면 세션 비교만 건너뛴다", () => {
  const before = snapshotOf([row("aa11", "TOWER"), row("cc33", "ghost", { pid: undefined, status: undefined })]);
  const after = snapshotOf([row("aa11", "TOWER")]);
  assert.equal(checkSessions({ before, after, control: okControl }).ok, true);
  assert.equal(checkSessions({ before: null, after: null, control: okControl }).ok, true);
  assert.equal(checkSessions({ before: null, after: null, control: { daemonInService: true } }).ok, false);
});

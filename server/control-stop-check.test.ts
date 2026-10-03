import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmStopped } from "./control-stop-check-run.ts";
import {
  DUP_RECENT_MIN,
  duplicateKeyOf,
  duplicateLiveOf,
  duplicateTextOf,
  type LiveJob,
  parseStopCheckSwitch,
  type StopCheckLine,
  stopCheckCounterOf,
  stopVerdictOf,
  unverifiedOf,
  unverifiedTextOf,
  waitStopped,
} from "./control-stop-check.ts";
import { supervisorAlertsOf } from "./supervisor-alerts.ts";

// ATC-521: 주입한 job 상태와 줄만 쓴다(실제 상태 폴더·~/.claude/jobs를 읽지 않는다)
const NOW = Date.parse("2026-10-03T09:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

test("사건 재현: claude stop은 종료 코드 0인데 state.json이 done 그대로면 not-ok(사유는 stop 실패와 다른 글)", () => {
  const v = stopVerdictOf(true, "done");
  assert.equal(v.ok, false);
  if (!v.ok) {
    assert.equal(v.code, "unverified");
    assert.match(v.reason, /종료 코드 0/);
    assert.match(v.reason, /done/);
    assert.notEqual(v.reason, stopVerdictOf(false, null).ok === false ? (stopVerdictOf(false, null) as { reason: string }).reason : "");
  }
});

test("종료 코드 0이고 state.json이 stopped면 ok", () => {
  assert.deepEqual(stopVerdictOf(true, "stopped"), { ok: true });
});

test("claude stop 자체가 실패면 state와 상관없이 not-ok(exit-failed)", () => {
  const v = stopVerdictOf(false, "stopped");
  assert.ok(!v.ok && v.code === "exit-failed");
});

test("state.json을 읽지 못해도 ok로 치지 않는다", () => {
  const v = stopVerdictOf(true, null);
  assert.ok(!v.ok && /읽히지 않음/.test(v.reason));
});

test("waitStopped: 한도 안에 stopped가 되면 거기서 멈춘다", async () => {
  let t = 0;
  const reads = ["done", "done", "stopped", "stopped"];
  let i = 0;
  const slept: number[] = [];
  const state = await waitStopped(() => reads[Math.min(i++, reads.length - 1)] ?? null, { now: () => t, sleep: async (ms) => void (slept.push(ms), (t += ms)) }, 20_000, 1_000);
  assert.equal(state, "stopped");
  assert.deepEqual(slept, [1000, 1000]);
});

test("waitStopped: 끝내 done이면 한도에서 멈추고 마지막 값을 돌려준다", async () => {
  let t = 0;
  const state = await waitStopped(() => "done", { now: () => t, sleep: async (ms) => void (t += ms) }, 5_000, 1_000);
  assert.equal(state, "done");
  assert.equal(t, 5_000);
});

test("confirmStopped: 스위치가 off면 확인하지 않고 ok(옛 판정)", async () => {
  const v = await confirmStopped({ session: "MCC", jobId: "4d8c68ae", readState: () => "done", sw: "off" });
  assert.deepEqual(v, { ok: true });
});

const job = (o: Partial<LiveJob> & Pick<LiveJob, "id">): LiveJob => ({ control: "MCC", account: "acct-1", state: "working", activeAt: ago(5), stale: false, ...o });

test("같은 관제 이름의 살아 있는 job 둘이면 경고(job id와 ACCOUNT를 이름 붙인다)", () => {
  const d = duplicateLiveOf([job({ id: "4d8c68ae", account: "acct-1", state: "done", activeAt: ago(2) }), job({ id: "a1b2c3d4", account: "acct-2" }), job({ id: "ffff0000", control: "TOWER" })], NOW);
  assert.equal(d.length, 1);
  assert.equal(d[0]!.control, "MCC");
  assert.deepEqual(d[0]!.jobs.map((j) => j.id), ["4d8c68ae", "a1b2c3d4"]);
  const text = duplicateTextOf(d[0]!);
  assert.match(text, /MCC/);
  assert.match(text, /4d8c68ae\(acct-1/);
  assert.match(text, /a1b2c3d4\(acct-2/);
  assert.equal(duplicateKeyOf(d[0]!), "MCC|4d8c68ae,a1b2c3d4");
});

test("10-01의 STALE 유령 줄이 살아 있는 job 하나 곁에 있어도 경고하지 않는다", () => {
  const ghosts = [job({ id: "0a0a0a0a", state: "done", stale: true, activeAt: ago(60 * 40) }), job({ id: "0b0b0b0b", state: "stopped", stale: false, activeAt: ago(60 * 40) })];
  assert.deepEqual(duplicateLiveOf([...ghosts, job({ id: "live0001" })], NOW), []);
});

test("멈췄거나(stopped) 활동이 오래전인 job은 살아 있다고 세지 않는다", () => {
  assert.deepEqual(duplicateLiveOf([job({ id: "a1a1a1a1" }), job({ id: "b2b2b2b2", state: "stopped" })], NOW), []);
  assert.deepEqual(duplicateLiveOf([job({ id: "a1a1a1a1" }), job({ id: "b2b2b2b2", activeAt: ago(DUP_RECENT_MIN + 1) })], NOW), []);
  assert.deepEqual(duplicateLiveOf([job({ id: "a1a1a1a1" }), job({ id: "b2b2b2b2", activeAt: null })], NOW), []);
});

const blocked = (t: string, jobId: string, o: Partial<StopCheckLine> = {}): StopCheckLine => ({ t, kind: "control", op: "stop-check", event: "blocked", session: "MCC", by: "atc", jobIds: [jobId], account: "acct-1", state: "done", ...o });

test("unverifiedOf: 막은 STOP의 job이 지금도 stopped가 아닐 때만 남고, stopped가 되거나 오탐 표시가 있으면 사라진다", () => {
  const lines = [blocked(ago(30), "4d8c68ae"), blocked(ago(20), "11112222"), blocked(ago(10), "33334444"), { ...blocked(ago(5), "x"), event: "dismissed" as const, jobIds: ["33334444"], of: ago(10) }];
  const states: Record<string, string> = { "4d8c68ae": "done", "11112222": "stopped", "33334444": "done" };
  const u = unverifiedOf(lines, (id) => states[id] ?? null, NOW);
  assert.deepEqual(u.map((x) => x.jobId), ["4d8c68ae"]);
  assert.match(unverifiedTextOf(u[0]!), /4d8c68ae\(acct-1\).*done/);
  assert.deepEqual(unverifiedOf([blocked(ago(60 * 7), "4d8c68ae")], () => "done", NOW), []); // 6시간이 지난 막음은 알림이 아니다
});

test("오작동 수: 막음·중복·오탐 표시·뒤늦게 틀렸다고 드러난 것, 같은 줄이 둘로 세어지지 않는다", () => {
  const t1 = ago(100);
  const t2 = ago(90);
  const lines = [
    blocked(t1, "aaaaaaaa"),
    { ...blocked(t2, "bbbbbbbb"), event: "duplicate" as const },
    { ...blocked(ago(80), "aaaaaaaa"), event: "contradicted" as const, of: t1 },
    { ...blocked(ago(70), "aaaaaaaa"), event: "dismissed" as const, of: t1 },
    blocked(ago(60 * 24 * 10), "oldoldol"),
  ];
  const c = stopCheckCounterOf(lines, NOW, 7);
  assert.deepEqual([c.blocked, c.duplicates, c.contradicted, c.dismissed, c.falseAlarms], [1, 1, 1, 1, 1]);
  assert.equal(c.share, 0.5);
  assert.equal(stopCheckCounterOf([], NOW).share, null);
  assert.equal(stopCheckCounterOf(lines, NOW, 30).blocked, 2);
});

test("스위치 값: 파일에 없거나 모르면 on, off만 off", () => {
  assert.equal(parseStopCheckSwitch(undefined), "on");
  assert.equal(parseStopCheckSwitch("maybe"), "on");
  assert.equal(parseStopCheckSwitch("off"), "off");
});

test("알림: unverified와 duplicate는 WARNING, 관제 key(control|…)로 alerts에 간다", () => {
  const items = supervisorAlertsOf({
    sessions: [],
    alerts: [],
    workspaces: [],
    tickets: [],
    following: [],
    proposals: [],
    pulls: [],
    rts: null,
    controlChecks: {
      unverified: [{ session: "MCC", jobId: "4d8c68ae", account: "acct-1", since: ago(10), state: "done" }],
      duplicates: duplicateLiveOf([job({ id: "4d8c68ae" }), job({ id: "a1b2c3d4", account: "acct-2" })], NOW),
    },
  }).filter((a) => a.key.startsWith("control|"));
  assert.deepEqual(items.map((a) => a.key).sort(), ["control|duplicate|MCC", "control|unverified|MCC|4d8c68ae"]);
  assert.ok(items.every((a) => a.level === "warning" && a.dest === "alerts"));
  assert.match(items.find((a) => a.key === "control|duplicate|MCC")!.text, /acct-2/);
});

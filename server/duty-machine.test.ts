import assert from "node:assert/strict";
import { test } from "node:test";
import { CRASH_LIMIT, CRASH_WINDOW_MS, type DutyEventIn, type DutyState, initialState, step } from "./duty-machine.ts";

const M = (text: string) => ({ text });
const run = (s: DutyState, es: [DutyEventIn, number][]) => {
  const acts: string[] = [];
  const verdicts: (string | undefined)[] = [];
  for (const [e, t] of es) {
    const r = step(s, e, t);
    s = r.state;
    acts.push(...r.actions.map((a) => (a.do === "spawn" ? `spawn:${a.resume ? "resume" : "new"}` : a.do === "write" ? `write:${a.msg.text}` : a.do)));
    verdicts.push(r.verdict);
  }
  return { s, acts, verdicts };
};

test("첫 글: spawn(새 대화)하고 쓴다 → thinking. result → idle", () => {
  const r = run(initialState(), [[{ kind: "message", msg: M("a") }, 1000], [{ kind: "result" }, 2000]]);
  assert.deepEqual(r.acts, ["spawn:new", "write:a"]);
  assert.equal(r.s.phase, "idle");
  assert.ok(r.s.alive);
  assert.deepEqual(r.verdicts, ["sent", undefined]);
});

test("턴이 도는 중 둘째 글은 줄 세운다(순서대로). result가 오면 다음 글을 쓰고 계속 thinking", () => {
  const r = run(initialState(), [
    [{ kind: "message", msg: M("a") }, 1],
    [{ kind: "message", msg: M("b") }, 2],
    [{ kind: "message", msg: M("c") }, 3],
    [{ kind: "result" }, 4],
  ]);
  assert.deepEqual(r.verdicts.slice(0, 3), ["sent", "queued", "queued"]);
  assert.deepEqual(r.acts, ["spawn:new", "write:a", "write:b"]);
  assert.equal(r.s.phase, "thinking");
  assert.deepEqual(r.s.queue.map((m) => m.text), ["c"]);
  const done = run(r.s, [[{ kind: "result" }, 5], [{ kind: "result" }, 6]]);
  assert.deepEqual(done.acts, ["write:c"]);
  assert.equal(done.s.phase, "idle");
});

test("stop은 턴이 도는 중일 때만 interrupt(프로세스는 그대로, 큐도 그대로)", () => {
  const busy = run(initialState(), [[{ kind: "message", msg: M("a") }, 1], [{ kind: "message", msg: M("b") }, 2], [{ kind: "stop" }, 3]]);
  assert.deepEqual(busy.acts, ["spawn:new", "write:a", "interrupt"]);
  assert.ok(busy.s.alive);
  assert.equal(busy.s.queue.length, 1);
  const idle = run(initialState(), [[{ kind: "message", msg: M("a") }, 1], [{ kind: "result" }, 2], [{ kind: "stop" }, 3]]);
  assert.deepEqual(idle.acts, ["spawn:new", "write:a"]);
});

test("유휴: idleMin이 지나면 stdin을 닫고, 그 종료는 오류가 아니다. 다음 글은 --resume으로 다시 띄운다", () => {
  const IDLE = 30 * 60_000;
  let r = run(initialState("11111111-1111-4111-8111-111111111111"), [[{ kind: "message", msg: M("a") }, 0], [{ kind: "result" }, 1000]]);
  // 아직 아님
  assert.deepEqual(step(r.s, { kind: "idle-tick", idleMs: IDLE }, IDLE).actions, []);
  const tick = step(r.s, { kind: "idle-tick", idleMs: IDLE }, 1000 + IDLE);
  assert.deepEqual(tick.actions, [{ do: "close-stdin" }]);
  assert.ok(tick.state.closing);
  // 이미 닫는 중이면 또 닫지 않는다
  assert.deepEqual(step(tick.state, { kind: "idle-tick", idleMs: IDLE }, 2000 + IDLE).actions, []);
  const gone = step(tick.state, { kind: "exit" }, 2000 + IDLE);
  assert.equal(gone.state.phase, "idle");
  assert.ok(!gone.state.alive && gone.state.crashes.length === 0);
  const again = step(gone.state, { kind: "message", msg: M("b") }, 3000 + IDLE);
  assert.deepEqual(again.actions.map((a) => (a.do === "spawn" ? `spawn:${a.resume}` : a.do)), ["spawn:true", "write"]);
  // 턴이 도는 중에는 유휴 종료를 하지 않는다
  r = run(initialState(), [[{ kind: "message", msg: M("a") }, 0]]);
  assert.deepEqual(step(r.s, { kind: "idle-tick", idleMs: IDLE }, 10 * IDLE).actions, []);
});

test("예상 밖 종료: down + 마지막 stderr 줄, 큐는 버린다. 다음 글은 --resume으로 다시 띄운다(반복하지 않는다)", () => {
  const r = run(initialState("11111111-1111-4111-8111-111111111111"), [
    [{ kind: "message", msg: M("a") }, 0],
    [{ kind: "message", msg: M("b") }, 1],
    [{ kind: "exit", error: "boom" }, 2],
  ]);
  assert.equal(r.s.phase, "down");
  assert.equal(r.s.error, "boom");
  assert.deepEqual(r.s.queue, []);
  assert.ok(!r.s.blocked);
  const next = step(r.s, { kind: "message", msg: M("c") }, 3);
  assert.equal(next.verdict, "sent");
  assert.deepEqual(next.actions.map((a) => (a.do === "spawn" ? `spawn:${a.resume}` : a.do)), ["spawn:true", "write"]);
  assert.equal(next.state.error, null);
});

test(`5분 안에 ${CRASH_LIMIT}번 죽으면 막힌다: 글은 거절, NEW SHIFT나 설정 변경이 풀어 준다. 오래된 실패는 세지 않는다`, () => {
  let s = initialState("11111111-1111-4111-8111-111111111111");
  for (let i = 0; i < CRASH_LIMIT; i++) {
    s = step(s, { kind: "message", msg: M("x") }, i * 1000).state;
    s = step(s, { kind: "exit", error: "e" }, i * 1000 + 1).state;
  }
  assert.ok(s.blocked);
  assert.equal(step(s, { kind: "message", msg: M("y") }, 9000).verdict, "refused");
  assert.ok(!step(s, { kind: "new-shift" }, 9000).state.blocked);
  assert.ok(!step(s, { kind: "reconfigure" }, 9000).state.blocked);
  // 창 밖의 실패는 세지 않는다
  let t = initialState("11111111-1111-4111-8111-111111111111");
  for (let i = 0; i < CRASH_LIMIT; i++) {
    const at = i * (CRASH_WINDOW_MS + 1000);
    t = step(t, { kind: "message", msg: M("x") }, at).state;
    t = step(t, { kind: "exit" }, at + 1).state;
  }
  assert.ok(!t.blocked);
});

test("NEW SHIFT: 프로세스가 있으면 끝내고(턴이 돌면 kill, 아니면 stdin 닫기), 다음 글은 새 대화. 큐와 대화 id를 버린다", () => {
  const idle = run(initialState("11111111-1111-4111-8111-111111111111"), [[{ kind: "message", msg: M("a") }, 0], [{ kind: "result" }, 1], [{ kind: "new-shift" }, 2]]);
  assert.deepEqual(idle.acts.slice(-1), ["close-stdin"]);
  assert.equal(idle.s.sessionId, null);
  const gone = step(idle.s, { kind: "exit" }, 3).state;
  assert.deepEqual(step(gone, { kind: "message", msg: M("b") }, 4).actions.map((a) => (a.do === "spawn" ? `spawn:${a.resume}` : a.do)), ["spawn:false", "write"]);
  const busy = run(initialState(), [[{ kind: "message", msg: M("a") }, 0], [{ kind: "message", msg: M("q") }, 1], [{ kind: "new-shift" }, 2]]);
  assert.deepEqual(busy.acts.slice(-1), ["kill"]);
  assert.deepEqual(busy.s.queue, []);
  // 프로세스가 없으면 할 일 없음
  assert.deepEqual(step(initialState(), { kind: "new-shift" }, 0).actions, []);
});

test("disable(설정 끔): 프로세스를 끝내고 idle로. 없으면 할 일 없음", () => {
  const r = run(initialState(), [[{ kind: "message", msg: M("a") }, 0], [{ kind: "result" }, 1], [{ kind: "disable" }, 2]]);
  assert.deepEqual(r.acts.slice(-1), ["close-stdin"]);
  assert.deepEqual(step(initialState(), { kind: "disable" }, 0).actions, []);
});

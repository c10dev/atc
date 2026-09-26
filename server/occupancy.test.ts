import assert from "node:assert/strict";
import { test } from "node:test";
import type { Claim, Session } from "./model.ts";
import { resolveOccupancy } from "./occupancy.ts";

const GRACE = 5 * 60_000;
const WS = "/home/c10/projects/worktrees/vocado-voc-194";
const at = (hhmm: string) => `2026-09-26T${hhmm}:00.000Z`;

function claim(sessionId: string, since: string, lastAt: string, extra: Partial<Claim> = {}): Claim {
  return {
    sessionId,
    workspacePath: WS,
    since: at(since),
    lastAt: at(lastAt),
    source: "hook",
    tool: null,
    state: "active",
    handedOffTo: null,
    ...extra,
  };
}

const alive = (): Session["status"] => "idle";

test("앞 세션이 멈춘 뒤 뒤 세션이 시작하면 이양", () => {
  const a = claim("A", "10:00", "10:30");
  const b = claim("B", "11:00", "11:40");
  const r = resolveOccupancy([a, b], alive, GRACE);
  assert.equal(a.state, "handed-off");
  assert.equal(a.handedOffTo, "B");
  assert.equal(b.state, "active");
  assert.deepEqual(r.handoffs, [{ workspacePath: WS, from: "A", to: "B", at: at("11:00") }]);
  assert.deepEqual(r.conflicts, []);
});

test("뒤 세션 시작 직후 잠깐 마무리한 것은 이양으로 본다", () => {
  const a = claim("A", "10:00", "11:03");
  const b = claim("B", "11:00", "11:40");
  resolveOccupancy([a, b], alive, GRACE);
  assert.equal(a.handedOffTo, "B");
});

test("둘 다 grace를 넘게 겹쳐 작업하면 충돌", () => {
  const a = claim("A", "10:00", "11:30");
  const b = claim("B", "11:00", "11:40");
  const r = resolveOccupancy([a, b], alive, GRACE);
  assert.equal(a.state, "active");
  assert.equal(b.state, "active");
  assert.deepEqual(r.conflicts, [{ workspacePath: WS, sessionIds: ["A", "B"] }]);
  assert.deepEqual(r.handoffs, []);
});

test("잠깐 들른 세션은 이양도 충돌도 아니다", () => {
  const a = claim("A", "10:00", "11:00");
  const b = claim("B", "10:30", "10:32");
  const r = resolveOccupancy([a, b], alive, GRACE);
  assert.equal(a.state, "active");
  assert.equal(b.state, "active");
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.handoffs, []);
});

test("A → B → C 연쇄 이양", () => {
  const a = claim("A", "09:00", "09:30");
  const b = claim("B", "10:00", "10:30");
  const c = claim("C", "11:00", "11:10");
  const r = resolveOccupancy([c, a, b], alive, GRACE);
  assert.equal(a.handedOffTo, "B");
  assert.equal(b.handedOffTo, "C");
  assert.equal(c.state, "active");
  assert.deepEqual(
    r.handoffs.map((h) => `${h.from}>${h.to}`),
    ["B>C", "A>B"],
  );
});

test("종료된 세션이 넘겨준 점유는 고아가 아니다", () => {
  const a = claim("A", "10:00", "10:30");
  const b = claim("B", "11:00", "11:40");
  const r = resolveOccupancy([a, b], (id) => (id === "A" ? "dead" : "idle"), GRACE);
  assert.deepEqual(r.orphans, []);
  assert.equal(r.handoffs.length, 1);
});

test("종료된 세션이 쥐고 있는 점유는 고아, 충돌에는 넣지 않는다", () => {
  const a = claim("A", "10:00", "11:30");
  const b = claim("B", "11:00", "11:40");
  const r = resolveOccupancy([a, b], (id) => (id === "A" ? "dead" : "idle"), GRACE);
  assert.deepEqual(r.orphans.map((c) => c.sessionId), ["A"]);
  assert.deepEqual(r.conflicts, []);
});

test("추정(transcript) 점유는 판정에 쓰지 않는다", () => {
  const a = claim("A", "10:00", "11:30", { source: "transcript" });
  const b = claim("B", "11:00", "11:40");
  const r = resolveOccupancy([a, b], alive, GRACE);
  assert.equal(a.state, "active");
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.handoffs, []);
});

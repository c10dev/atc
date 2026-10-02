import assert from "node:assert/strict";
import { test } from "node:test";
import { nextLook, sinceLookOf, type SinceLookInput } from "./since-look.ts";

const LOOK = "2026-10-02T10:00:00.000Z";
const input = (over: Partial<SinceLookInput> = {}): SinceLookInput => ({ lastLook: LOOK, releases: [], milestones: [], stuckFlights: [], waiting: [], ...over });

test("아무 일도 없으면 줄이 비어 있다(조용함)", () => {
  const v = sinceLookOf(input({ releases: [{ flight: "ATC-1", at: "2026-10-02T09:00:00Z" }], milestones: [["ATC-1", { on: "2026-10-02T09:30:00Z", in: "2026-10-02T09:40:00Z" }]] }));
  assert.equal(v.line, "");
  assert.deepEqual([v.released, v.landed, v.deployed, v.stuck, v.waiting], [[], [], [], [], []]);
});

test("본 뒤의 발권·ON·IN만 센다. 같은 FLIGHT 여러 발권은 하나", () => {
  const v = sinceLookOf(
    input({
      releases: [{ flight: "ATC-2", at: "2026-10-02T10:05:00Z" }, { flight: "ATC-2", at: "2026-10-02T10:06:00Z" }, { flight: "ATC-1", at: "2026-10-02T09:00:00Z" }],
      milestones: [["ATC-3", { on: "2026-10-02T10:10:00Z", in: null }], ["ATC-4", { on: "2026-10-02T09:00:00Z", in: "2026-10-02T10:20:00Z" }]],
    }),
  );
  assert.deepEqual(v.released, ["ATC-2"]);
  assert.deepEqual(v.landed, ["ATC-3"]);
  assert.deepEqual(v.deployed, ["ATC-4"]);
  assert.equal(v.line, "발권 1 · 착륙(ON) 1 · 배포(IN) 1");
});

test("막힘과 기다림은 지금 상태: 시점과 무관하게 센다", () => {
  const v = sinceLookOf(input({ stuckFlights: ["ATC-9", "ATC-9", "ATC-8"], waiting: [{ key: "pending|proposal|D-1", text: "t", link: "#dispatch" }] }));
  assert.deepEqual(v.stuck, ["ATC-8", "ATC-9"]);
  assert.equal(v.line, "막힘 2 · 기다림 1");
});

test("nextLook은 뒤로 가지 않고 지금을 넘지 않는다", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  assert.equal(nextLook(LOOK, "2026-10-02T11:00:00Z", now), "2026-10-02T11:00:00.000Z");
  assert.equal(nextLook(LOOK, "2026-10-02T09:00:00Z", now), LOOK);
  assert.equal(nextLook(LOOK, "2026-10-02T13:00:00Z", now), "2026-10-02T12:00:00.000Z");
  assert.equal(nextLook(LOOK, undefined, now), "2026-10-02T12:00:00.000Z");
  assert.equal(nextLook(LOOK, "garbage", now), "2026-10-02T12:00:00.000Z");
});

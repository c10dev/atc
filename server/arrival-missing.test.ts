import assert from "node:assert/strict";
import { test } from "node:test";
import type { ArrivalReport } from "./arrival-report.ts";
import { arrivalMissingOf, type FollowItem, NO_REPORT_KEEP_MS, REPORT_GRACE_MS, REPORT_START, unreportedAgeMs } from "./following.ts";

// ATC-169: 머지됐는데 도착 보고가 없는 FLIGHT 목록(순수). REPORT_START 뒤에 머지된 DISPATCH FLIGHT만
const START = Date.parse(REPORT_START);
const iso = (ms: number) => new Date(ms).toISOString();
const item = (over: Partial<FollowItem> & { arrivedAt?: string | null; merged?: boolean } = {}): FollowItem => {
  const { arrivedAt = iso(START + 3_600_000), merged = true, ...rest } = over;
  return {
    flight: "ATC-1", title: null, url: null, state: "In Review", aircraft: "TEAM_E", source: "dispatch", standFree: false, arrival: null,
    proposal: { id: "D-0001", status: "arrived" }, dispatched: true, wake: "M", expectMin: 60,
    stages: { readback: null, departed: null, prOpened: null, cleared: null, arrived: arrivedAt },
    stage: "arrived", stageAt: arrivedAt, stand: null, pr: { repo: "o/r", number: 12, url: "u", merged }, milestones: null, issues: [],
    ...rest,
  } as FollowItem;
};
const report = (flight = "ATC-1"): ArrivalReport => ({ op: "report", flight, at: iso(START + 4_000_000), proposal: "D-0001", pr: 12, result: null, tier: "auto", tests: { pass: 1, total: 1 }, discretion: 0, blocked: "none" });
const at = (afterMerge: number) => START + 3_600_000 + afterMerge;

test("arrivalMissingOf: 머지됐고 보고가 없으면 목록에, 보고가 있으면 없다", () => {
  const list = arrivalMissingOf([item()], new Map(), at(45 * 60_000));
  assert.equal(list.length, 1);
  assert.deepEqual({ ...list[0], arrivedAt: undefined }, { flight: "ATC-1", aircraft: "TEAM_E", proposal: "D-0001", pr: 12, arrivedAt: undefined, ageMin: 45, due: true });
  assert.deepEqual(arrivalMissingOf([item()], new Map([["ATC-1", report()]]), at(45 * 60_000)), []);
});

test("arrivalMissingOf: 머지 30분 안이면 due: false(보고가 오는 중일 수 있다)", () => {
  const [x] = arrivalMissingOf([item()], new Map(), at(10 * 60_000));
  assert.equal(x!.due, false);
  assert.equal(x!.ageMin, 10);
  assert.equal(arrivalMissingOf([item()], new Map(), at(REPORT_GRACE_MS + 1))[0]!.due, true);
});

test("arrivalMissingOf: DISPATCH가 보내지 않은 FLIGHT, 머지 안 된 PR, STAND 없는 FLIGHT는 없다", () => {
  const now = at(45 * 60_000);
  assert.deepEqual(arrivalMissingOf([item({ dispatched: false, source: "tail", proposal: null })], new Map(), now), []);
  assert.deepEqual(arrivalMissingOf([item({ merged: false })], new Map(), now), []);
  assert.deepEqual(arrivalMissingOf([item({ pr: null })], new Map(), now), []);
  assert.deepEqual(arrivalMissingOf([item({ standFree: true })], new Map(), now), []);
  assert.deepEqual(arrivalMissingOf([item({ arrivedAt: null })], new Map(), now), []);
});

test("arrivalMissingOf: 도착 보고 기록이 시작된 시각(ATC-124) 전에 머지된 FLIGHT는 없다", () => {
  const before = item({ arrivedAt: iso(START - 60_000) });
  assert.deepEqual(arrivalMissingOf([before], new Map(), START + 3_600_000), []);
  assert.equal(unreportedAgeMs(before, undefined, START + 3_600_000), null);
});

test("arrivalMissingOf: 머지 뒤 하루가 지나면 빠지고, 여럿이면 오래된 것부터", () => {
  assert.equal(arrivalMissingOf([item()], new Map(), at(NO_REPORT_KEEP_MS + 60_000)).length, 0);
  const a = item({ flight: "ATC-2", arrivedAt: iso(START + 7_200_000) });
  const b = item({ flight: "ATC-1", arrivedAt: iso(START + 3_600_000) });
  assert.deepEqual(arrivalMissingOf([a, b], new Map(), START + 9_000_000).map((x) => x.flight), ["ATC-1", "ATC-2"]);
});

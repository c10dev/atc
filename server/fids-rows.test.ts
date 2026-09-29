import assert from "node:assert/strict";
import { test } from "node:test";
import { FIDS_ARRIVED_CAP, fidsRows } from "../web/src/fids-rows.ts";
import type { Ticket } from "./model.ts";

const iso = (i: number) => new Date(Date.parse("2026-09-29T00:00:00Z") - i * 3_600_000).toISOString();
const t = (key: string, stateType: Ticket["stateType"], age = 0): Ticket => ({ key, stateType, state: stateType === "completed" ? "Done" : "In Progress", updatedAt: iso(age) }) as Ticket;
const arrived = (n: number) => Array.from({ length: n }, (_, i) => t(`A-${i}`, "completed", i)); // A-0이 가장 최근
const noStand = { workspacesByTicket: new Map<string, unknown[]>() };

test("상수는 10", () => assert.equal(FIDS_ARRIVED_CAP, 10));

test("ARRIVED 30건 → 최근 10건만 보이고 20건 more", () => {
  const r = fidsRows(arrived(30), noStand, false);
  assert.equal(r.rows.length, 10);
  assert.equal(r.moreArrived, 20);
  assert.deepEqual(r.rows.map((x) => x.key), Array.from({ length: 10 }, (_, i) => `A-${i}`));
});

test("STAND가 남은 ARRIVED는 오래됐어도 항상 보인다", () => {
  const r = fidsRows(arrived(30), { workspacesByTicket: new Map([["A-25", [{}]]]) }, false);
  assert.equal(r.rows.length, 11);
  assert.ok(r.rows.some((x) => x.key === "A-25"));
  assert.equal(r.moreArrived, 19);
});

test("최근 10건 안에 STAND 있는 것은 두 번 세지 않는다", () => {
  const r = fidsRows(arrived(30), { workspacesByTicket: new Map([["A-3", [{}]]]) }, false);
  assert.equal(r.rows.length, 10);
  assert.equal(r.moreArrived, 20);
});

test("showClosed면 전부, more 줄 없음", () => {
  const r = fidsRows(arrived(30), noStand, true);
  assert.equal(r.rows.length, 30);
  assert.equal(r.moreArrived, 0);
});

test("ARRIVED 10건 이하면 more 줄이 없다", () => {
  assert.equal(fidsRows(arrived(10), noStand, false).moreArrived, 0);
  const r = fidsRows(arrived(3), noStand, false);
  assert.equal(r.rows.length, 3);
  assert.equal(r.moreArrived, 0);
});

test("ARRIVED가 아닌 행은 모두 남고 순서를 지킨다", () => {
  const list = [t("F-1", "started"), ...arrived(12), t("F-2", "unstarted"), t("F-3", "started")];
  const r = fidsRows(list, noStand, false);
  assert.deepEqual(r.rows.filter((x) => x.stateType !== "completed").map((x) => x.key), ["F-1", "F-2", "F-3"]);
  assert.equal(r.moreArrived, 2);
  assert.equal(r.rows[0].key, "F-1");
});

test("갱신 시각이 없는 ARRIVED는 가장 오래된 것으로 본다", () => {
  const list = [...arrived(10), { ...t("NOAT", "completed"), updatedAt: null } as Ticket];
  const r = fidsRows(list, noStand, false);
  assert.equal(r.moreArrived, 1);
  assert.ok(!r.rows.some((x) => x.key === "NOAT"));
});

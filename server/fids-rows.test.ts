import assert from "node:assert/strict";
import { test } from "node:test";
import { FIDS_GROUP_CAP, foldGroup, shortAge } from "../web/src/fids-rows.ts";

const rows = (n: number) => Array.from({ length: n }, (_, i) => `F-${i}`);
const none = () => false;

test("상한은 5", () => assert.equal(FIDS_GROUP_CAP, 5));

test("12행 → 앞 5행만 보이고 7행 hidden", () => {
  const r = foldGroup(rows(12), none, false);
  assert.deepEqual(r.rows, rows(5));
  assert.equal(r.hidden, 7);
});

test("상한 이하면 접지 않는다", () => {
  assert.equal(foldGroup(rows(5), none, false).hidden, 0);
  assert.deepEqual(foldGroup(rows(3), none, false).rows, rows(3));
  assert.deepEqual(foldGroup([], none, false), { rows: [], hidden: 0 });
});

test("pinned 행(AIRCRAFT·경고)은 상한 밖에 있어도 보이고 순서를 지킨다", () => {
  const r = foldGroup(rows(12), (x) => x === "F-9" || x === "F-7", false);
  assert.deepEqual(r.rows, [...rows(5), "F-7", "F-9"]);
  assert.equal(r.hidden, 5);
});

test("상한 안의 pinned는 두 번 세지 않는다", () => {
  const r = foldGroup(rows(12), (x) => x === "F-2", false);
  assert.equal(r.rows.length, 5);
  assert.equal(r.hidden, 7);
});

test("open이면 전부, hidden 0", () => {
  const r = foldGroup(rows(12), none, true);
  assert.deepEqual(r.rows, rows(12));
  assert.equal(r.hidden, 0);
});

test("cap을 바꿀 수 있다", () => {
  const r = foldGroup(rows(12), none, false, 2);
  assert.deepEqual(r.rows, rows(2));
  assert.equal(r.hidden, 10);
});

test("shortAge: now · m · h · d", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  const ago = (s: number) => new Date(now - s * 1000).toISOString();
  assert.equal(shortAge(ago(10), now), "now");
  assert.equal(shortAge(ago(5 * 60), now), "5m");
  assert.equal(shortAge(ago(3 * 3600), now), "3h");
  assert.equal(shortAge(ago(2 * 86_400), now), "2d");
  assert.equal(shortAge(null, now), "—");
  assert.equal(shortAge(ago(-60), now), "now"); // 미래 시각은 0으로 막는다
});

test("입력을 바꾸지 않는다", () => {
  const input = rows(12);
  foldGroup(input, none, false);
  assert.deepEqual(input, rows(12));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { closeWip, openWip, touchWip, WIP_KEEP_MS, WIP_MAX_OPEN, WIP_TEXT_MAX, WipError, wipView } from "./charter-wip.ts";

// ATC-169: 진행 중인 CHARTER REQUEST(순수). SCHEDULE 초안이 아니다 — 5건 한도와 무관하다
const T0 = Date.parse("2026-09-30T10:00:00Z");

test("openWip: 요약을 W-번호로 열고, 비었거나 길면 거절한다", () => {
  const r = openWip([], "  add a\n dark mode toggle  ", T0);
  assert.equal(r.wip.id, "W-0001");
  assert.equal(r.wip.text, "add a dark mode toggle");
  assert.equal(r.wip.at, r.wip.touchedAt);
  assert.equal(openWip(r.items, "second", T0).wip.id, "W-0002");
  assert.throws(() => openWip([], "   ", T0), WipError);
  assert.throws(() => openWip([], "x".repeat(WIP_TEXT_MAX + 1), T0), /600자/);
});

test("openWip: 동시에 3건까지(초안 한도 5건과 따로 센다). 오래 손대지 않은 것은 자리를 비운다", () => {
  let items = openWip([], "a", T0).items;
  items = openWip(items, "b", T0).items;
  items = openWip(items, "c", T0).items;
  assert.equal(items.length, WIP_MAX_OPEN);
  assert.throws(() => openWip(items, "d", T0 + 1000), (e: unknown) => e instanceof WipError && e.status === 409);
  const later = openWip(items, "d", T0 + WIP_KEEP_MS + 1000);
  assert.deepEqual(later.items.map((w) => w.id), ["W-0004"]);
});

test("touchWip: 시각을 갱신하고 글은 주면 바꾼다. 없거나 만료됐으면 404", () => {
  const { items } = openWip([], "original", T0);
  const t = touchWip(items, "W-0001", undefined, T0 + 600_000);
  assert.equal(t.wip.text, "original");
  assert.equal(t.wip.touchedAt, "2026-09-30T10:10:00.000Z");
  assert.equal(t.wip.at, "2026-09-30T10:00:00.000Z");
  assert.equal(touchWip(t.items, "W-0001", "changed", T0 + 700_000).wip.text, "changed");
  assert.throws(() => touchWip(items, "W-0009", undefined, T0), (e: unknown) => e instanceof WipError && e.status === 404);
  assert.throws(() => touchWip(items, "W-0001", undefined, T0 + WIP_KEEP_MS + 1), /없음/);
});

test("closeWip: 닫으면 목록에서 빠지고, 없으면 404", () => {
  const { items } = openWip([], "a", T0);
  assert.deepEqual(closeWip(items, "W-0001", T0), []);
  assert.throws(() => closeWip(items, "W-0002", T0), WipError);
});

test("wipView: 손댄 뒤 몇 분인지를 붙이고, 만료된 것은 뺀다", () => {
  const { items } = openWip([], "a", T0);
  assert.equal(wipView(items, T0 + 12 * 60_000)[0]!.idleMin, 12);
  assert.deepEqual(wipView(items, T0 + WIP_KEEP_MS + 1), []);
});

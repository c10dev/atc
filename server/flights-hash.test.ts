import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalHash, viewOfHash } from "../web/src/legacy-hash.ts";

// FLIGHTS(ATC-379): 옛 탭 주소가 그 보기를 연다. 큐·메뉴 막대·즐겨찾기의 옛 링크가 깨지지 않는다
test("옛 주소: #follow·#strips는 목록, #board는 보드, #radar는 레이더, #radio는 RADIO 기록", () => {
  assert.equal(canonicalHash("#follow"), "#flights");
  assert.equal(canonicalHash("#strips"), "#flights");
  assert.equal(canonicalHash("#board"), "#flights/board");
  assert.equal(canonicalHash("#radar"), "#flights/radar");
  assert.equal(canonicalHash("#radio"), "#flights/radio");
  // 더 옛 이름과 DISPATCH(ATC-377)
  assert.equal(canonicalHash("#map"), "#flights/radar");
  assert.equal(canonicalHash("#teams"), "#flights");
  assert.equal(canonicalHash("#tickets"), "#flights/board");
  assert.equal(canonicalHash("#dispatch"), "#home");
  assert.equal(canonicalHash("#schedule"), "#home"); // ATC-378
  assert.equal(canonicalHash("#network"), "#metrics/network"); // ATC-380
});

test("하위 경로는 이어 붙고, 보기가 정해진 옛 주소에는 붙지 않는다. 지금 주소는 그대로", () => {
  assert.equal(canonicalHash("#follow/ATC-1"), "#flights/ATC-1");
  assert.equal(canonicalHash("#radio/ATCC"), "#flights/radio");
  assert.equal(canonicalHash("#flights"), null);
  assert.equal(canonicalHash("#flights/board"), null);
  assert.equal(canonicalHash("#fleet/TEAM_G"), null);
  assert.equal(canonicalHash(""), null);
});

test("viewOfHash: 하위 경로가 보기를 정하고, 모르면 목록", () => {
  assert.equal(viewOfHash("#flights"), "list");
  assert.equal(viewOfHash("#flights/board"), "board");
  assert.equal(viewOfHash("#flights/radar"), "radar");
  assert.equal(viewOfHash("#flights/radio"), "radio");
  assert.equal(viewOfHash("#flights/nope"), "list");
});

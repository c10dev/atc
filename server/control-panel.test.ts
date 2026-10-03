import assert from "node:assert/strict";
import test from "node:test";
import { brakesTabWord, CHIP_WORD, clampPanelHeight, controlRadioOf, DEFAULT_PANEL_H, isPanelToggleKey, MIN_PANEL_H, narrowChipsOf, needingCount, nextPanelTab, opensControlPanel, panelChipsOf, storedPanelHeight, storedPanelTab } from "./control-panel.ts";
import type { StripChip, StripState } from "./control-strip.ts";
import type { Transmission } from "./radio.ts";

const chip = (name: string, state: StripState): StripChip => ({ name, code: name.slice(0, 3), state, intervalMin: 5, lastTickAt: null, lastTickSource: null, kind: "BG x", title: "" });
const six = [chip("TOWER", "ok"), chip("OCC", "working"), chip("MCC", "needs"), chip("CROSSCHECK", "ok"), chip("REVIEW", "down"), chip("ENGINEERING", "late")];

test("칩 순서: DOWN, NEEDS가 먼저, 그다음 LATE·WORKING·OK, 같은 상태는 이름순", () => {
  assert.deepEqual(panelChipsOf(six).map((c) => c.name), ["REVIEW", "MCC", "ENGINEERING", "OCC", "CROSSCHECK", "TOWER"]);
  const input = [...six];
  panelChipsOf(input);
  assert.deepEqual(input, six); // 입력을 바꾸지 않는다
});

test("모든 상태에 글자가 있다(색만으로 알리지 않는다)", () => {
  assert.deepEqual(Object.keys(CHIP_WORD).sort(), ["down", "late", "needs", "ok", "working"]);
  for (const w of Object.values(CHIP_WORD)) assert.match(w, /^[A-Z]+$/);
});

test("needingCount: NEEDS와 DOWN만 센다", () => {
  assert.equal(needingCount(six), 2);
  assert.equal(needingCount([chip("A", "ok"), chip("B", "late"), chip("C", "working")]), 0);
  assert.equal(needingCount([]), 0);
});

test("narrowChipsOf: 좁은 화면은 손이 필요한 칩만, 나머지는 OK n", () => {
  const n = narrowChipsOf(six);
  assert.deepEqual(n.shown.map((c) => c.name), ["REVIEW", "MCC", "ENGINEERING"]);
  assert.equal(n.ok, 3);
  assert.deepEqual(narrowChipsOf([chip("A", "ok"), chip("B", "working")]), { shown: [], ok: 2 });
  assert.deepEqual(narrowChipsOf([]), { shown: [], ok: 0 });
});

test("높이: 최소·70% 상한으로 자르고, 저장값이 이상하면 기본값", () => {
  assert.equal(clampPanelHeight(50, 900), MIN_PANEL_H);
  assert.equal(clampPanelHeight(2000, 900), 630);
  assert.equal(clampPanelHeight(300, 900), 300);
  assert.equal(clampPanelHeight(300, 100), MIN_PANEL_H); // 아주 낮은 창도 최소는 지킨다
  assert.equal(storedPanelHeight(null, 900), DEFAULT_PANEL_H);
  assert.equal(storedPanelHeight("abc", 900), DEFAULT_PANEL_H);
  assert.equal(storedPanelHeight("400", 900), 400);
  assert.equal(storedPanelHeight("9999", 900), 630);
});

test("Ctrl+`만 패널을 접고 연다", () => {
  const k = (key: string, over: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over });
  assert.equal(isPanelToggleKey(k("`", { ctrlKey: true })), true);
  assert.equal(isPanelToggleKey(k("Dead", { ctrlKey: true })), true); // 죽은 키 배열
  assert.equal(isPanelToggleKey(k("`")), false);
  assert.equal(isPanelToggleKey(k("`", { ctrlKey: true, shiftKey: true })), false);
  assert.equal(isPanelToggleKey(k("a", { ctrlKey: true })), false);
});

test("controlRadioOf: 그 세션이 보내거나 받은 교신의 끝 limit개", () => {
  const tx = (id: string, from: string, to: string): Transmission => ({ id, at: "2026-10-02T10:00:00.000Z", freq: "TOWER", from, to, kind: "FLIGHT PLAN", head: id });
  const all = [tx("1", "OCC", "KILO (TEAM_K)"), tx("2", "TOWER", "ALL"), tx("3", "KILO (TEAM_K)", "OCC"), tx("4", "occ", "GOLF (TEAM_G)")];
  assert.deepEqual(controlRadioOf(all, "OCC").map((t) => t.id), ["1", "3", "4"]);
  assert.deepEqual(controlRadioOf(all, "OCC", 2).map((t) => t.id), ["3", "4"]);
  assert.deepEqual(controlRadioOf(all, "MCC"), []);
});

test("탭: 저장된 값, 화살표 이동, BRAKES 글자(ATC-455)", () => {
  assert.equal(storedPanelTab("brakes"), "brakes");
  assert.equal(storedPanelTab("control"), "control");
  for (const r of [null, undefined, "", "Brakes", "output"]) assert.equal(storedPanelTab(r), "control", String(r));
  assert.equal(nextPanelTab("control", "ArrowRight"), "brakes");
  assert.equal(nextPanelTab("brakes", "ArrowRight"), "control"); // 둘레를 돈다
  assert.equal(nextPanelTab("control", "ArrowLeft"), "brakes");
  assert.equal(nextPanelTab("brakes", "Home"), "control");
  assert.equal(nextPanelTab("control", "End"), "brakes");
  assert.equal(nextPanelTab("control", "Enter"), null);
  assert.equal(brakesTabWord(0, 0), "");
  assert.equal(brakesTabWord(1, 0), "1 STOP");
  assert.equal(brakesTabWord(0, 1), "1 STOP");
  assert.equal(brakesTabWord(1, 2), "3 STOPS");
  assert.equal(brakesTabWord(-1, 0), "");
});

test("opensControlPanel: 옛 #fleet/control과 새 #control", () => {
  for (const h of ["#fleet/control", "fleet/control", "#control"]) assert.equal(opensControlPanel(h), true, h);
  for (const h of ["#fleet", "#fleet/controls", "#flights/control", ""]) assert.equal(opensControlPanel(h), false, h);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { recycleAutoGuardOf, isRisky, modeLine, modeSegments, needsConfirm, reviewLabel, settingsTabOf } from "./settings-policy.ts";
import type { ServerSettings } from "./settings.ts";

const settings = (over: Partial<Pick<ServerSettings, "autoland" | "mcc" | "review" | "fuel">> & { jev?: string } = {}) =>
  ({
    autoland: { mode: "off", airports: [], applicationCheck: "", groundStops: [] },
    mcc: { mode: "shadow", airport: "ATCC" },
    review: { security: "exclude" },
    fuel: { hold: false, infoPct: 80, holdPct: 95 },
    judges: { jev: { mode: over.jev ?? "off" } },
    ...over,
  }) as unknown as Parameters<typeof modeSegments>[0];

test("modeLine: 다섯 스위치를 한 줄로, 기본은 모두 꺼짐", () => {
  assert.equal(modeLine(modeSegments(settings())), "AUTOLAND off · MCC shadow · JEV off · FUEL HOLD off · REVIEW exclude");
});

test("modeSegments: ⚠ 모드만 warn, REVIEW deepseek는 보이는 이름으로", () => {
  const segs = modeSegments(settings({ autoland: { mode: "merge", airports: [], applicationCheck: "", groundStops: [] }, mcc: { mode: "land", airport: "ATCC" }, review: { security: "deepseek" }, fuel: { hold: true, infoPct: 80, holdPct: 95 }, jev: "shadow" }));
  assert.deepEqual(segs.map((x) => x.warn), [true, true, true, true, true]);
  assert.equal(modeLine(segs), "AUTOLAND merge · MCC land · JEV shadow · FUEL HOLD on · REVIEW sonnet (deepseek)");
  assert.deepEqual(modeSegments(settings()).map((x) => x.warn), [false, false, false, false, false]);
});

test("modeSegments: judges·fuel이 없으면 JEV off, FUEL HOLD off", () => {
  const s = { autoland: { mode: "off" }, mcc: { mode: "shadow" }, review: { security: "exclude" } } as unknown as Parameters<typeof modeSegments>[0];
  assert.equal(modeLine(modeSegments(s)), "AUTOLAND off · MCC shadow · JEV off · FUEL HOLD off · REVIEW exclude");
});

test("needsConfirm: ⚠ 모드로 올릴 때만, 내리거나 같은 값은 아니다", () => {
  assert.equal(needsConfirm("autoland", "off", "update"), true);
  assert.equal(needsConfirm("autoland", "off", "merge"), true);
  assert.equal(needsConfirm("autoland", "merge", "update"), true); // ⚠에서 ⚠로도
  assert.equal(needsConfirm("autoland", "merge", "off"), false);
  assert.equal(needsConfirm("autoland", "update", "update"), false);
  for (const m of ["land", "land+rts", "rts"]) assert.equal(needsConfirm("mcc", "shadow", m), true);
  assert.equal(needsConfirm("mcc", "land", "shadow"), false);
  for (const m of ["replay", "shadow"]) assert.equal(needsConfirm("jev", "off", m), true);
  assert.equal(needsConfirm("jev", "replay", "off"), false);
  assert.equal(needsConfirm("fuelHold", "off", "on"), true);
  assert.equal(needsConfirm("fuelHold", "on", "off"), false);
  assert.equal(needsConfirm("review", "exclude", "deepseek"), true);
  assert.equal(needsConfirm("review", "deepseek", "exclude"), false);
});

test("isRisky: MCC shadow는 기본이라 ⚠가 아니지만 JEV shadow는 ⚠", () => {
  assert.equal(isRisky("mcc", "shadow"), false);
  assert.equal(isRisky("jev", "shadow"), true);
});

test("reviewLabel: 저장 값 deepseek은 sonnet (deepseek)로만 보이고 exclude는 그대로", () => {
  assert.equal(reviewLabel("deepseek"), "sonnet (deepseek)");
  assert.equal(reviewLabel("exclude"), "exclude");
});

test("settingsTabOf: 저장된 탭이 있으면 그것, 없거나 모르는 값이면 화면", () => {
  const ids = ["display", "linear", "agents", "automation"] as const;
  assert.equal(settingsTabOf("automation", ids, "display"), "automation");
  assert.equal(settingsTabOf(null, ids, "display"), "display");
  assert.equal(settingsTabOf("gone", ids, "display"), "display");
  assert.equal(settingsTabOf(undefined, ids, "display"), "display");
});

test("recycleAutoGuardOf(ATC-175): alert → auto는 ⚠ 확인, auto → alert와 같은 값은 확인 없이. OCC는 문구가 따로", () => {
  for (const name of ["TOWER", "OCC", "MCC"]) {
    const g = recycleAutoGuardOf(name, false, "auto");
    assert.equal(g?.warn, true, name);
    assert.match(g!.line, /^auto ⚠ /);
    assert.equal(recycleAutoGuardOf(name, true, "auto"), null);
    assert.equal(recycleAutoGuardOf(name, true, "alert"), null);
    assert.equal(recycleAutoGuardOf(name, false, "alert"), null);
  }
  assert.match(recycleAutoGuardOf("OCC", false, "auto")!.line, /OCC는 도착 보고/);
  assert.doesNotMatch(recycleAutoGuardOf("TOWER", false, "auto")!.line, /OCC는/);
});

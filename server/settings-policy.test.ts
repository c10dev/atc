import assert from "node:assert/strict";
import { test } from "node:test";
import { recycleAutoGuardOf, isRisky, modeLine, modeSegments, needsConfirm, reviewLabel, SETTINGS_INDEX, settingsSearch, settingsTabOf } from "./settings-policy.ts";
import type { ServerSettings } from "./settings.ts";

const settings = (over: Partial<Pick<ServerSettings, "autoland" | "mcc" | "review" | "fuel">> & { jev?: string } = {}) =>
  ({
    autoland: { mode: "off", reviewedSecurity: "off", airports: [], applicationCheck: "", groundStops: [] },
    mcc: { mode: "shadow", airport: "ATCC" },
    review: { security: "exclude" },
    fuel: { hold: false, infoPct: 80, holdPct: 95 },
    judges: { jev: { mode: over.jev ?? "off" } },
    ...over,
  }) as unknown as Parameters<typeof modeSegments>[0];

test("modeLine: 여섯 스위치를 한 줄로, 기본은 모두 꺼짐", () => {
  assert.equal(modeLine(modeSegments(settings())), "AUTOLAND off · AUTOLAND REVIEW off · MCC shadow · JEV off · FUEL HOLD off · REVIEW exclude");
});

test("modeSegments: ⚠ 모드만 warn, REVIEW deepseek는 보이는 이름으로", () => {
  const segs = modeSegments(settings({ autoland: { mode: "merge", reviewedSecurity: "delegate", airports: [], applicationCheck: "", groundStops: [] }, mcc: { mode: "land", airport: "ATCC" }, review: { security: "deepseek" }, fuel: { hold: true, infoPct: 80, holdPct: 95 }, jev: "shadow" }));
  assert.deepEqual(segs.map((x) => x.warn), [true, true, true, true, true, true]);
  assert.equal(modeLine(segs), "AUTOLAND merge · AUTOLAND REVIEW delegate · MCC land · JEV shadow · FUEL HOLD on · REVIEW sonnet (deepseek)");
  assert.deepEqual(modeSegments(settings()).map((x) => x.warn), [false, false, false, false, false, false]);
});

test("modeSegments: judges·fuel이 없으면 JEV off, FUEL HOLD off", () => {
  const s = { autoland: { mode: "off" }, mcc: { mode: "shadow" }, review: { security: "exclude" } } as unknown as Parameters<typeof modeSegments>[0];
  assert.equal(modeLine(modeSegments(s)), "AUTOLAND off · MCC shadow · JEV off · FUEL HOLD off · REVIEW exclude");
});

test("needsConfirm: ⚠ 모드로 올릴 때만, 내리거나 같은 값은 아니다", () => {
  assert.equal(needsConfirm("autolandReview", "off", "delegate"), true); // 보안 위임은 ⚠
  assert.equal(needsConfirm("autolandReview", "delegate", "off"), false);
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
  const ids = ["display", "linear", "agents", "landing"] as const;
  assert.equal(settingsTabOf("agents", ids, "display"), "agents");
  assert.equal(settingsTabOf(null, ids, "display"), "display");
  assert.equal(settingsTabOf("gone", ids, "display"), "display");
  assert.equal(settingsTabOf(undefined, ids, "display"), "display");
});

test("settingsTabOf: 옛 AUTOMATION 탭은 LANDING으로 연다", () => {
  const ids = ["display", "landing", "operations"] as const;
  assert.equal(settingsTabOf("automation", ids, "display"), "landing");
  assert.equal(settingsTabOf("operations", ids, "display"), "operations");
});

test("settingsSearch: 코드·한국어 이름·찾을 말, 대소문자 무시, 모든 말이 맞아야", () => {
  assert.deepEqual(settingsSearch("fuel").map((e) => e.code), ["FUEL"]);
  assert.deepEqual(settingsSearch("목소리").map((e) => e.code), ["VOICE"]);
  assert.deepEqual(settingsSearch("음성").map((e) => e.code), ["CALLSIGNS", "VOICE"]);
  assert.deepEqual(settingsSearch("LINEAR_API_KEY").map((e) => e.code), ["WORKSPACE"]);
  assert.deepEqual(settingsSearch("로그인").map((e) => e.tab), ["accounts"]);
  assert.deepEqual(settingsSearch("control recycle").map((e) => e.code), ["CONTROL RECYCLE"]);
  assert.deepEqual(settingsSearch("   "), []);
  assert.deepEqual(settingsSearch("없는말"), []);
});

test("settingsSearch: 코드가 첫 말로 시작하는 블록이 앞", () => {
  const codes = settingsSearch("control").map((e) => e.code);
  assert.deepEqual(codes.slice(0, 2), ["CONTROL", "CONTROL RECYCLE"]);
  // shadow는 MCC·JUDGES의 찾을 말. 둘 다 코드로 시작하지 않으니 색인 순서
  assert.deepEqual(settingsSearch("shadow").map((e) => e.code), ["MCC", "JUDGES"]);
});

test("SETTINGS_INDEX: 분류마다 블록이 하나 이상, 같은 코드는 한 번", () => {
  for (const tab of ["display", "linear", "agents", "accounts", "alerts", "landing", "operations"]) {
    assert.ok(SETTINGS_INDEX.some((e) => e.tab === tab), tab);
  }
  assert.equal(new Set(SETTINGS_INDEX.map((e) => e.code)).size, SETTINGS_INDEX.length);
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

test("DUTY(ATC-220): OPERATIONS 색인에서 찾히고, 켜는 것은 ⚠ 확인이 필요하다", () => {
  assert.deepEqual(settingsSearch("duty").map((e) => [e.tab, e.code]), [["operations", "DUTY"]]);
  assert.deepEqual(settingsSearch("서랍").map((e) => e.code), ["DUTY"]);
  assert.ok(isRisky("duty", "on"));
  assert.ok(needsConfirm("duty", "off", "on"));
  assert.ok(!needsConfirm("duty", "on", "off"));
  const seg = modeSegments({ autoland: { mode: "off" }, mcc: { mode: "shadow" }, review: { security: "exclude" }, duty: { enabled: true, account: "acct-2", idleMin: 30 } } as never).find((x) => x.key === "duty");
  assert.deepEqual(seg && [seg.label, seg.value, seg.warn], ["DUTY", "on", true]);
});

test("DUTY CHARTER(ATC-233): on은 ⚠ 확인, shadow·off는 그대로, 정책 한 줄과 색인에 보인다", () => {
  assert.ok(isRisky("dutyCharter", "on"));
  assert.ok(!isRisky("dutyCharter", "shadow"));
  assert.ok(needsConfirm("dutyCharter", "shadow", "on"));
  assert.ok(!needsConfirm("dutyCharter", "on", "shadow"));
  const seg = modeSegments({ autoland: { mode: "off" }, mcc: { mode: "shadow" }, review: { security: "exclude" }, duty: { enabled: true, account: "acct-2", idleMin: 30, charter: "on" } } as never).find((x) => x.key === "dutyCharter");
  assert.deepEqual(seg && [seg.label, seg.value, seg.warn], ["DUTY CHARTER", "on", true]);
  assert.deepEqual(settingsSearch("duty.charter").map((e) => e.code), ["DUTY"]);
});

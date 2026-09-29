import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FUEL, fuelAccountsOf, fuelByAircraft, fuelConfigOf, fuelHoldReason, fuelHolds, fuelInfos, fuelLabel, fuelRemainingOf, fuelTitle, windowsOf } from "./fuel-remaining.ts";

// FUEL REMAINING(ATC-55). 기록 모양은 hooks/fuel-statusline.mjs가 남기는 것
const NOW = Date.parse("2026-09-28T15:00:00Z");
const sec = (iso: string) => Date.parse(iso) / 1000;
const R5 = sec("2026-09-28T21:00:00Z");
const R7 = sec("2026-10-03T07:00:00Z");
const rec = (sessionId: string, t: string, five: number, seven = 10, reset5 = R5) => ({
  t,
  sessionId,
  rate_limits: { five_hour: { used_percentage: five, resets_at: reset5 }, seven_day: { used_percentage: seven, resets_at: R7 } },
});

test("설정: 기본 80/95/꺼짐. 틀린 값은 기본으로, hold는 true일 때만, holdPct는 infoPct 아래로 가지 않는다", () => {
  assert.deepEqual(fuelConfigOf(undefined), DEFAULT_FUEL);
  assert.deepEqual(fuelConfigOf({ infoPct: 70, holdPct: 90, hold: true }), { infoPct: 70, holdPct: 90, hold: true });
  assert.deepEqual(fuelConfigOf({ infoPct: "70", holdPct: 0, hold: "yes" }), DEFAULT_FUEL);
  assert.deepEqual(fuelConfigOf({ infoPct: 90, holdPct: 50 }), { infoPct: 90, holdPct: 90, hold: false });
});

test("windowsOf: reset이 지난 창은 뺀다", () => {
  const r = rec("s", "2026-09-28T14:00:00Z", 82, 40, sec("2026-09-28T14:30:00Z"));
  assert.deepEqual(windowsOf(r, NOW), [{ name: "seven_day", pct: 40, resetsAt: "2026-10-03T07:00:00.000Z" }]);
});

test("ACCOUNT마다 가장 새 값: 같은 ACCOUNT의 형제는 statusline이 없어도 그 값을 받는다. ACCOUNT를 모르면 제 세션 값만", () => {
  const aircraft = [
    { registration: "TEAM_K", account: "pro-2", sessionIds: ["k1", "k0"] },
    { registration: "TEAM_L", account: "pro-2", sessionIds: ["l1"] },
    { registration: "team_m", account: null, sessionIds: ["m1"] },
    { registration: "TEAM_N", account: null, sessionIds: ["n1"] },
  ];
  const out = fuelRemainingOf(
    aircraft,
    [rec("k0", "2026-09-28T13:00:00Z", 50), rec("k1", "2026-09-28T14:00:00Z", 70), rec("l1", "2026-09-28T14:30:00Z", 82.4), rec("m1", "2026-09-28T14:50:00Z", 20)],
    DEFAULT_FUEL,
    NOW,
  );
  assert.deepEqual(Object.keys(out).sort(), ["TEAM_K", "TEAM_L", "TEAM_M"]); // TEAM_N은 값 없음
  assert.equal(out.TEAM_K, out.TEAM_L);
  assert.deepEqual({ ...out.TEAM_K!, windows: undefined }, {
    group: "pro-2",
    account: "pro-2",
    at: "2026-09-28T14:30:00Z",
    from: "TEAM_L",
    fromKind: "aircraft",
    windows: undefined,
    top: { name: "five_hour", pct: 82.4, resetsAt: "2026-09-28T21:00:00.000Z" },
    level: "info",
    aircraft: ["TEAM_K", "TEAM_L"],
    control: [],
  });
  assert.deepEqual([out.TEAM_M!.group, out.TEAM_M!.aircraft, out.TEAM_M!.level], ["aircraft:TEAM_M", ["TEAM_M"], "ok"]);
  assert.equal(fuelLabel(out.TEAM_K!, NOW), "사용 82% · resets 21:00Z");
  assert.equal(fuelTitle(out.TEAM_K!, NOW), "ACCOUNT pro-2 · 사용 5h 82% (reset 21:00Z), 7d 10% (reset 10-03 07:00Z) · TEAM_L statusline 14:30Z");
});

test("임계값: 80 미만 ok, 80 이상 info, 95 이상 hold. 가장 많이 쓴 창으로 잰다", () => {
  const one = (five: number, seven: number) => fuelRemainingOf([{ registration: "TEAM_A", account: "main", sessionIds: ["a"] }], [rec("a", "2026-09-28T14:00:00Z", five, seven)], DEFAULT_FUEL, NOW).TEAM_A!;
  assert.equal(one(79.9, 10).level, "ok");
  assert.equal(one(80, 10).level, "info");
  assert.equal(one(10, 95).level, "hold");
  assert.equal(one(10, 95).top.name, "seven_day");
  assert.equal(fuelLabel(one(10, 95), NOW), "사용 95% · resets 10-03 07:00Z");
});

test("DISPATCH HOLD 스위치(D3): 꺼져 있으면 95 %여도 붙들지 않고, 켜면 holdPct 이상만", () => {
  const f = fuelRemainingOf([{ registration: "TEAM_A", account: "main", sessionIds: ["a"] }], [rec("a", "2026-09-28T14:00:00Z", 96)], DEFAULT_FUEL, NOW).TEAM_A!;
  assert.equal(fuelHolds(f, DEFAULT_FUEL), false);
  assert.equal(fuelHolds(f, { ...DEFAULT_FUEL, hold: true }), true);
  assert.equal(fuelHolds(f, { ...DEFAULT_FUEL, hold: true, holdPct: 97 }), false);
  assert.equal(fuelHolds(null, { ...DEFAULT_FUEL, hold: true }), false);
  assert.equal(fuelHoldReason(f, NOW), "HOLD · FUEL (account main) until 21:00Z — 5h 한도 사용 96%");
});

test("fuelInfos: INFO 이상인 ACCOUNT마다 하나, 창·reset이 같으면 같은 key", () => {
  const out = fuelRemainingOf(
    [
      { registration: "TEAM_K", account: "pro-2", sessionIds: ["k"] },
      { registration: "TEAM_L", account: "pro-2", sessionIds: [] },
      { registration: "TEAM_A", account: "main", sessionIds: ["a"] },
      { registration: "TEAM_B", account: "team", sessionIds: ["b"] },
    ],
    [rec("k", "2026-09-28T14:00:00Z", 85), rec("a", "2026-09-28T14:00:00Z", 97), rec("b", "2026-09-28T14:00:00Z", 30)],
    DEFAULT_FUEL,
    NOW,
  );
  const infos = fuelInfos(out, NOW);
  assert.deepEqual(
    infos.map((i) => [i.key, i.level, i.aircraft.join(",")]),
    [
      ["fuel|main|five_hour|2026-09-28T21:00:00.000Z", "hold", "TEAM_A"],
      ["fuel|pro-2|five_hour|2026-09-28T21:00:00.000Z", "info", "TEAM_K,TEAM_L"],
    ],
  );
  assert.equal(infos[1]!.text, "FUEL 사용 85% · resets 21:00Z (account pro-2) — TEAM_K, TEAM_L");
});

// ── 관제 세션(ATC-60): 같은 ACCOUNT의 구성원으로 센다 ──
const member = (name: string, kind: "aircraft" | "control", account: string | null, sessionIds: string[]) => ({ name, kind, account, sessionIds });

test("관제 세션의 기록이 그 ACCOUNT에 닿는다: 자기 기록이 없는 AIRCRAFT도 그 값을 받고, 관제 세션은 따로 적힌다", () => {
  const accounts = fuelAccountsOf(
    [member("TEAM_A", "aircraft", "main", ["a"]), member("TEAM_B", "aircraft", "main", []), member("MCC", "control", "main", ["m"])],
    [rec("m", "2026-09-28T14:00:00Z", 20, 99)],
    DEFAULT_FUEL,
    NOW,
  );
  assert.equal(accounts.length, 1);
  const [f] = accounts;
  assert.deepEqual([f!.group, f!.from, f!.fromKind, f!.aircraft, f!.control, f!.level, f!.top.name], ["main", "MCC", "control", ["TEAM_A", "TEAM_B"], ["MCC"], "hold", "seven_day"]);
  const by = fuelByAircraft(accounts);
  assert.equal(by.TEAM_A, f);
  assert.equal(by.TEAM_B, f);
  assert.equal(by.MCC, undefined); // 관제 세션은 AIRCRAFT 자리에 들어가지 않는다
  assert.equal(fuelTitle(f!, NOW), "ACCOUNT main · 사용 5h 20% (reset 21:00Z), 7d 99% (reset 10-03 07:00Z) · control MCC statusline 14:00Z · 같은 ACCOUNT의 관제 세션 MCC");
});

test("가장 새 기록은 AIRCRAFT·관제 세션 어느 쪽이든: 더 새 쪽이 이긴다", () => {
  const members = [member("TEAM_A", "aircraft", "main", ["a"]), member("OCC", "control", "main", ["o"])];
  const older = (t1: string, t2: string) => fuelAccountsOf(members, [rec("a", t1, 50), rec("o", t2, 90)], DEFAULT_FUEL, NOW)[0]!;
  assert.deepEqual([older("2026-09-28T14:00:00Z", "2026-09-28T14:10:00Z").from, older("2026-09-28T14:00:00Z", "2026-09-28T14:10:00Z").top.pct], ["OCC", 90]);
  assert.deepEqual([older("2026-09-28T14:20:00Z", "2026-09-28T14:10:00Z").from, older("2026-09-28T14:20:00Z", "2026-09-28T14:10:00Z").top.pct], ["TEAM_A", 50]);
});

test("라벨이 하나도 없으면 관제 세션은 자기 이름으로 따로, AIRCRAFT에 섞이지 않는다", () => {
  const accounts = fuelAccountsOf(
    [member("TEAM_A", "aircraft", null, ["a"]), member("MCC", "control", null, ["m"])],
    [rec("a", "2026-09-28T14:00:00Z", 30), rec("m", "2026-09-28T14:05:00Z", 10, 99)],
    DEFAULT_FUEL,
    NOW,
  );
  assert.deepEqual(accounts.map((f) => [f.group, f.aircraft, f.control, f.top.pct]), [
    ["control:MCC", [], ["MCC"], 99],
    ["aircraft:TEAM_A", ["TEAM_A"], [], 30],
  ]);
  assert.equal(fuelByAircraft(accounts).TEAM_A!.top.pct, 30);
  // TOWER INFO: 관제 세션만 있는 묶음도 알린다
  const infos = fuelInfos(accounts, NOW);
  assert.deepEqual(infos.map((i) => [i.key, i.aircraft, i.control, i.text]), [
    ["fuel|control:MCC|seven_day|2026-10-03T07:00:00.000Z", [], ["MCC"], "FUEL 사용 99% · resets 10-03 07:00Z — control MCC"],
  ]);
});

test("DISPATCH HOLD: 관제 세션이 holdPct를 넘긴 ACCOUNT의 AIRCRAFT가 붙들린다(스위치가 켜졌을 때만)", () => {
  const by = fuelByAircraft(
    fuelAccountsOf([member("TEAM_A", "aircraft", "main", []), member("TEAM_C", "aircraft", "team", ["c"]), member("MCC", "control", "main", ["m"])], [rec("m", "2026-09-28T14:00:00Z", 97), rec("c", "2026-09-28T14:00:00Z", 97)], DEFAULT_FUEL, NOW),
  );
  const on = { ...DEFAULT_FUEL, hold: true };
  assert.equal(fuelHolds(by.TEAM_A, on), true);
  assert.equal(fuelHolds(by.TEAM_A, DEFAULT_FUEL), false);
  assert.equal(fuelHoldReason(by.TEAM_A!, NOW), "HOLD · FUEL (account main) until 21:00Z — 5h 한도 사용 97%");
  assert.equal(fuelInfos([by.TEAM_A!], NOW)[0]!.text, "FUEL 사용 97% · resets 21:00Z (account main) — TEAM_A · control MCC");
});

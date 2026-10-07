import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  type AutoFreshFacts,
  autoFreshStartOf,
  autoFreshWaitText,
  flownInSessionOf,
  FRESH_START_OVER_MARGIN,
  freshStartMisfiresOf,
  freshStartModeAt,
  freshStartSwitchOf,
  type MisfireInputs,
  overThresholdOf,
  upgradeFreshStartOnce,
} from "./fresh-start-auto.ts";
import { loadFreshStartSwitch, migrateFreshStartOnce, saveFreshStartAirports } from "./fresh-start-switch.ts";

const facts = (over: Partial<AutoFreshFacts> = {}): AutoFreshFacts => ({
  registration: "TEAM_F", mode: "always", launch: false, groundStop: false, origin: "background", flown: ["ATC-311"],
  retired: false, aog: false, status: "idle", restarting: false, nordo: false, openPr: false, flying: [], arrived: new Set(),
  limit: false, fuelHold: false, context: { contextTokens: 160_000, base: 51_000 }, ...over,
});

test("스위치: 없거나 깨진 파일, 모르는 값은 off. 파일에 없는 AIRPORT는 default", () => {
  assert.equal(freshStartModeAt(freshStartSwitchOf(null, "missing"), "ATCC"), "off");
  assert.equal(freshStartModeAt(freshStartSwitchOf(null, "broken"), "ATCC"), "off");
  assert.equal(freshStartModeAt(freshStartSwitchOf([1, 2], "ok"), "ATCC"), "off"); // 객체가 아니면 깨진 것
  const sw = freshStartSwitchOf({ default: "always", airports: { atcc: "over", VCDO: "off", ATCA: "sometimes" } }, "ok");
  assert.equal(freshStartModeAt(sw, "ATCC"), "over"); // 코드는 대문자로
  assert.equal(freshStartModeAt(sw, "VCDO"), "off");
  assert.equal(freshStartModeAt(sw, "ATCA"), "off"); // 모르는 값
  assert.equal(freshStartModeAt(sw, "RNPU"), "always"); // 파일에 없는 AIRPORT
  assert.equal(freshStartModeAt(sw, null), "off"); // AIRPORT를 모르는 카드
  assert.equal(freshStartModeAt(freshStartSwitchOf({ airports: {} }, "ok"), "RNPU"), "off"); // default가 없으면 off
});

test("한 번 올리기: 없는 파일은 열린 AIRPORT마다 always, 기록이 있거나 깨졌으면 아무것도 안 한다", () => {
  const up = upgradeFreshStartOnce(freshStartSwitchOf(null, "missing"), null, ["ATCC", "vcdo"], "2026-10-07T00:00:00.000Z")!;
  assert.deepEqual(up.airports, { ATCC: "always", VCDO: "always" });
  assert.equal(up.default, "always");
  assert.deepEqual((up.migrated as { id: string }).id, "ATC-560");
  // SUPERVISOR가 이미 적은 값은 지킨다
  const raw = { airports: { VCDO: "off" } };
  const kept = upgradeFreshStartOnce(freshStartSwitchOf(raw, "ok"), raw, ["ATCC", "VCDO"], "2026-10-07T00:00:00.000Z")!;
  assert.deepEqual(kept.airports, { ATCC: "always", VCDO: "off" });
  const done = { default: "always", airports: {}, migrated: { id: "ATC-560", at: "2026-10-07T00:00:00.000Z" } };
  assert.equal(upgradeFreshStartOnce(freshStartSwitchOf(done, "ok"), done, ["ATCC"], "x"), null);
  assert.equal(upgradeFreshStartOnce(freshStartSwitchOf(null, "broken"), null, ["ATCC"], "x"), null);
});

test("스위치 파일: 첫 시작에 always로 올리고, 바꾸기는 그 AIRPORT만, 깨진 파일은 off로 두고 건드리지 않는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-fresh-"));
  const file = join(dir, "fresh-start.json");
  assert.equal(loadFreshStartSwitch(file).source, "missing");
  assert.equal(migrateFreshStartOnce(["ATCC", "VCDO"], Date.parse("2026-10-07T00:00:00Z"), file), "migrated");
  assert.equal(freshStartModeAt(loadFreshStartSwitch(file), "VCDO"), "always");
  assert.equal(migrateFreshStartOnce(["ATCC", "VCDO"], Date.now(), file), "already");
  saveFreshStartAirports({ VCDO: "over" }, file);
  const sw = loadFreshStartSwitch(file);
  assert.equal(freshStartModeAt(sw, "VCDO"), "over");
  assert.equal(freshStartModeAt(sw, "ATCC"), "always");
  assert.ok(sw.migrated); // 바꿔도 기록은 남는다(다시 올리지 않는다)
  writeFileSync(file, "{ not json");
  assert.equal(freshStartModeAt(loadFreshStartSwitch(file), "ATCC"), "off");
  assert.equal(migrateFreshStartOnce(["ATCC"], Date.now(), file), "unreadable");
  assert.throws(() => saveFreshStartAirports({ ATCC: "always" }, file));
  assert.equal(readFileSync(file, "utf8"), "{ not json");
});

test("이미 날았나: 세션 시작 뒤 보낸 FLIGHT PLAN, FLIGHT로 띄운 LAUNCH, DEPARTED한 LOGBOOK", () => {
  const startedAt = "2026-10-07T10:00:00.000Z";
  const base = { startedAt, currentId: "D-9", proposals: [], launches: [], departures: [] };
  assert.deepEqual(flownInSessionOf(base), []);
  // 세션 전에 보낸 것, 지금 카드, 다시 approved로 돌아간 것(undelivered)은 세지 않는다
  assert.deepEqual(
    flownInSessionOf({
      ...base,
      proposals: [
        { id: "D-1", flight: "ATC-1", status: "arrived", sentAt: "2026-10-07T09:00:00.000Z" },
        { id: "D-9", flight: "ATC-9", status: "approved", sentAt: null },
        { id: "D-3", flight: "ATC-3", status: "approved", sentAt: "2026-10-07T10:30:00.000Z" },
      ],
    }),
    [],
  );
  assert.deepEqual(flownInSessionOf({ ...base, proposals: [{ id: "D-2", flight: "ATC-2", status: "departed", sentAt: "2026-10-07T10:05:00.000Z" }] }), ["ATC-2"]);
  // launch 카드·K3 RELAUNCH·FLEET LAUNCH with a FLIGHT: 세션 시작 무렵의 LAUNCH 줄
  assert.deepEqual(flownInSessionOf({ ...base, launches: [{ t: "2026-10-07T10:00:20.000Z", flight: "ATC-5" }, { t: "2026-10-06T10:00:00.000Z", flight: "ATC-4" }, { t: "2026-10-07T10:00:00.000Z" }] }), ["ATC-5"]);
  // FRESH START·launch 카드로 띄운 세션: LAUNCH 줄에 flight가 없고 proposal만 있다 — 그 카드의 FLIGHT로 읽는다
  assert.deepEqual(
    flownInSessionOf({ ...base, proposals: [{ id: "D-8", flight: "ATC-8", status: "sent", sentAt: "2026-10-07T09:59:58.000Z" }], launches: [{ t: "2026-10-07T10:00:05.000Z", proposal: "D-8" }] }),
    ["ATC-8"],
  );
  // 직접 맡긴 FLIGHT: 세션 시작 뒤에 DEPARTED한 LOGBOOK 줄
  assert.deepEqual(flownInSessionOf({ ...base, departures: [{ flight: "ATC-6", departedAt: "2026-10-07T11:00:00.000Z" }, { flight: "ATC-7", departedAt: "2026-10-06T11:00:00.000Z" }] }), ["ATC-6"]);
  assert.deepEqual(flownInSessionOf({ ...base, startedAt: "?" , departures: [{ flight: "ATC-6", departedAt: "2026-10-07T11:00:00.000Z" }] }), []);
});

test("판정: always면 이미 날은 쉬는 백그라운드 세션을 다시 띄운다", () => {
  const d = autoFreshStartOf(facts());
  assert.equal(d.act, "restart");
  assert.match(d.why, /ATC-311/);
  assert.equal(d.act === "restart" ? d.threshold : 0, null);
});

test("판정: 스위치 off, launch 카드, GROUND STOP, 세션 없음, 이 세션의 첫 FLIGHT는 해당 없음(기록하지 않는다)", () => {
  assert.equal(autoFreshStartOf(facts({ mode: "off" })).act, "none");
  assert.equal(autoFreshStartOf(facts({ launch: true })).act, "none");
  assert.equal(autoFreshStartOf(facts({ groundStop: true })).act, "none");
  assert.equal(autoFreshStartOf(facts({ origin: null })).act, "none");
  assert.equal(autoFreshStartOf(facts({ flown: [] })).act, "none");
});

test("판정: 열린 PR이 있으면 다시 띄우지 않고 사유를 남긴다(K3 RELAUNCH와 같은 조건)", () => {
  const d = autoFreshStartOf(facts({ openPr: true }));
  assert.equal(d.act, "skip");
  assert.equal(d.act === "skip" ? d.code : null, "open-pr");
  const codeOf = (f: Partial<AutoFreshFacts>) => {
    const x = autoFreshStartOf(facts(f));
    return x.act === "skip" ? x.code : x.act;
  };
  assert.equal(codeOf({ origin: "desktop" }), "not-background");
  assert.equal(codeOf({ status: "busy" }), "not-idle");
  assert.equal(codeOf({ restarting: true }), "not-idle");
  assert.equal(codeOf({ nordo: true }), "not-idle");
  assert.equal(codeOf({ flying: ["ATC-400"] }), "stand");
  assert.equal(codeOf({ flying: ["ATC-400"], arrived: new Set(["ATC-400"]) }), "restart"); // ARRIVED한 FLIGHT의 STAND는 괜찮다(ATC-73과 같다)
  assert.equal(codeOf({ limit: true }), "limit");
  assert.equal(codeOf({ fuelHold: true }), "fuel-hold");
  assert.equal(codeOf({ aog: true }), "retired");
});

test("판정: over는 대화가 base + 50k를 넘을 때만", () => {
  assert.equal(overThresholdOf(51_000), 51_000 + FRESH_START_OVER_MARGIN);
  assert.equal(overThresholdOf(0), 100_000); // base를 모르면 50k로 짐작
  const over = autoFreshStartOf(facts({ mode: "over", context: { contextTokens: 160_000, base: 51_000 } }));
  assert.equal(over.act, "restart");
  assert.equal(over.act === "restart" ? over.threshold : null, 101_000);
  const under = autoFreshStartOf(facts({ mode: "over", context: { contextTokens: 90_000, base: 51_000 } }));
  assert.equal(under.act === "skip" ? under.code : under.act, "under-threshold");
  const unknown = autoFreshStartOf(facts({ mode: "over", context: { contextTokens: null, base: 51_000 } }));
  assert.equal(unknown.act === "skip" ? unknown.code : unknown.act, "context-unknown");
  assert.equal(autoFreshStartOf(facts({ mode: "over", context: null })).act, "skip");
  // always는 크기를 보지 않는다
  assert.equal(autoFreshStartOf(facts({ mode: "always", context: null })).act, "restart");
});

test("release 문구: OCC 절차의 RESTARTING 줄이 받는다", () => {
  assert.match(autoFreshWaitText("TEAM_F"), /^TEAM_F: RESTARTING — /);
});

test("오작동 수: AIRPORT마다 재시작·건너뜀·실패, 같은 AIRCRAFT의 다시 띄운 FLIGHT와 아닌 FLIGHT", () => {
  const p = (id: string, aircraft: string, restarted: boolean, airport = "ATCC") => ({ id, flight: `ATC-${id.slice(2)}`, airport, aircraft, sentAt: "2026-10-07T10:00:00.000Z", restarted });
  const i: MisfireInputs = {
    proposals: [p("D-1", "TEAM_F", true), p("D-2", "TEAM_F", true), p("D-3", "TEAM_F", false), p("D-4", "TEAM_F", false), p("D-5", "TEAM_G", false), p("D-6", "TEAM_H", true, "VCDO")],
    autoLines: [
      { t: "x", id: "D-1", airport: "ATCC", decision: "restart" },
      { t: "x", id: "D-2", airport: "ATCC", decision: "restart" },
      { t: "x", id: "D-7", airport: "ATCC", decision: "skip", code: "open-pr" },
      { t: "x", id: "D-8", airport: "ATCC", decision: "restart" },
    ],
    failures: [{ t: "x", id: "D-8", stage: "launch" }],
    blocked: new Set(["D-1", "D-2", "D-3"]),
    tokens: new Map([["D-1", 5_000_000], ["D-2", 7_000_000], ["D-3", 15_000_000]]),
    rework: new Set(["D-4"]),
    airports: ["ATCC", "VCDO", "RNPU"],
    modes: { ATCC: "always", VCDO: "over" },
    days: 7,
  };
  const rows = freshStartMisfiresOf(i);
  assert.deepEqual(rows.map((r) => r.airport), ["ATCC", "RNPU", "VCDO"]);
  const a = rows[0]!;
  assert.equal(a.mode, "always");
  assert.equal(a.restarts, 3);
  assert.equal(a.skipped, 1);
  assert.deepEqual(a.skipCodes, { "open-pr": 1 });
  assert.deepEqual(a.failed, { stop: 0, launch: 1, send: 0 }); // D-8은 제안 목록에 없어도 판정 줄의 AIRPORT로 센다
  // TEAM_G는 다시 띄운 적이 없어 비교에 들지 않는다
  assert.deepEqual(a.restarted, { flights: 2, blocked: 2, tokensMedian: 6_000_000, tokensN: 2, rework: 0 });
  assert.deepEqual(a.kept, { flights: 2, blocked: 1, tokensMedian: 15_000_000, tokensN: 1, rework: 1 });
  assert.deepEqual(a.worseAircraft, ["TEAM_F"]); // 2/2 > 1/2
  assert.equal(rows[1]!.mode, "off");
  assert.equal(rows[1]!.restarts, 0);
  assert.deepEqual(rows[2]!.worseAircraft, []); // 비교할 FLIGHT가 없다
});

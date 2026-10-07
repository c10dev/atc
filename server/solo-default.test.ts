import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { formatAssignment } from "./briefs.ts";
import { formatFlightPlan, type Proposal } from "./proposals.ts";
import {
  areasOf,
  crewCallOfMessage,
  crewLineOf,
  crewPlanOf,
  detailLabelsOf,
  type SoloLanded,
  soloMisfiresOf,
  soloModeAt,
  type SoloSent,
  soloSwitchOf,
  upgradeSoloOnce,
} from "./solo-default.ts";
import { loadSoloSwitch, migrateSoloOnce, saveSoloAirports, soloOnAt } from "./solo-default-switch.ts";

// SOLO 기본(ATC-559): WAKE L·M은 CAPTAIN 혼자, H·J와 여러 영역은 CREW. 스위치 off면 줄이 없다

const SOLO_M =
  "SOLO (WAKE M): fly this FLIGHT as a solo CAPTAIN. Implement it yourself, with no CREW; subagents may search or review but do not write code. If it turns out to need CREW, add it and say why under Pilot's discretion in the PR.";

test("crewPlanOf: WAKE L·M은 SOLO, H·J는 CREW, 라벨이 없으면 기본 M이라 SOLO", () => {
  assert.deepEqual(crewPlanOf(["wake:L"], true), { call: "SOLO", wake: "L", why: null, areas: [] });
  assert.deepEqual(crewPlanOf(["wake:M", "type:BUILD"], true), { call: "SOLO", wake: "M", why: null, areas: [] });
  assert.deepEqual(crewPlanOf([], true), { call: "SOLO", wake: "M", why: null, areas: [] });
  assert.deepEqual(crewPlanOf(null, true), { call: "SOLO", wake: "M", why: null, areas: [] });
  assert.deepEqual(crewPlanOf(["wake:H"], true), { call: "CREW", wake: "H", why: "wake", areas: [] });
  assert.deepEqual(crewPlanOf(["wake:J"], true), { call: "CREW", wake: "J", why: "wake", areas: [] });
});

test("crewPlanOf: 스위치 off면 WAKE와 상관없이 null(오늘처럼 줄 없음)", () => {
  for (const w of ["L", "M", "H"]) assert.equal(crewPlanOf([`wake:${w}`], false), null);
});

test("multi-area: Area 그룹 라벨 둘 이상, 또는 DOCS가 아닌 TYPE RATING 둘 이상. 섞어 세지 않는다", () => {
  assert.deepEqual(areasOf(["Area:Web", "Area:Database"]), ["Database", "Web"]);
  assert.deepEqual(areasOf(["area: Web", "AREA:Web"]), []); // 같은 영역 하나
  assert.deepEqual(areasOf(["rating:UI", "rating:DATA"]), ["UI", "DATA"]);
  assert.deepEqual(areasOf(["rating:UI", "Risk:Security"]), ["SEC", "UI"]);
  assert.deepEqual(areasOf(["rating:UI", "rating:DOCS"]), []); // DOCS는 영역이 아니다
  assert.deepEqual(areasOf(["Area:Web", "rating:UI"]), []); // 섞지 않는다
  assert.deepEqual(crewPlanOf(["wake:L", "Area:Web", "Area:Backend"], true), { call: "CREW", wake: "L", why: "multi-area", areas: ["Backend", "Web"] });
  assert.deepEqual(crewPlanOf(["wake:M", "rating:UI", "rating:DATA"], true), { call: "CREW", wake: "M", why: "multi-area", areas: ["UI", "DATA"] });
});

test("지시서 줄: WAKE마다 문구", () => {
  assert.equal(crewLineOf(crewPlanOf(["wake:M"], true)), SOLO_M);
  assert.equal(crewLineOf(crewPlanOf(["wake:L"], true)), SOLO_M.replace("WAKE M", "WAKE L"));
  assert.equal(crewLineOf(crewPlanOf(["wake:H"], true)), "CREW (WAKE H): you may split the implementation across your CREW COMPLEMENT.");
  assert.equal(crewLineOf(crewPlanOf(["Area:Web", "Area:Database"], true)), "CREW (multi-area: Database, Web): you may split the implementation across your CREW COMPLEMENT.");
  assert.equal(crewLineOf(null), null);
});

const proposal = { id: "D-0007", flight: "ATC-7", airport: "ATCC", hold: [], caution: false, note: null, status: "approved" } as unknown as Proposal;
const ticket = { title: "Do the thing", url: "https://linear.app/x/issue/ATC-7", priority: 3 };

test("FLIGHT PLAN: L·M은 SOLO 줄, H는 CREW 줄, 스위치 off는 오늘과 같은 문구", () => {
  const today = formatFlightPlan(proposal, ticket, "TEAM_A");
  const off = formatFlightPlan(proposal, ticket, "TEAM_A", null, Date.now(), [], crewPlanOf(["wake:M"], false));
  assert.equal(off, today);
  assert.doesNotMatch(today, /^SOLO|^CREW \(/m);
  for (const w of ["L", "M"]) {
    const text = formatFlightPlan(proposal, ticket, "TEAM_A", null, Date.now(), [], crewPlanOf([`wake:${w}`], true));
    assert.ok(text.split("\n").includes(SOLO_M.replace("WAKE M", `WAKE ${w}`)));
    // 줄은 PILOT'S DISCRETION 줄 바로 앞, 그 밖은 오늘과 같다
    assert.equal(text.split("\n").filter((l) => !l.startsWith("SOLO (")).join("\n"), today);
    assert.equal(crewCallOfMessage(text), "SOLO");
  }
  const heavy = formatFlightPlan(proposal, ticket, "TEAM_A", null, Date.now(), [], crewPlanOf(["wake:H"], true));
  assert.match(heavy, /^CREW \(WAKE H\): you may split the implementation across your CREW COMPLEMENT\.$/m);
  assert.doesNotMatch(heavy, /solo CAPTAIN/);
  assert.equal(crewCallOfMessage(heavy), "CREW");
  assert.equal(crewCallOfMessage(today), null);
  const lines = heavy.split("\n");
  assert.ok(lines[lines.findIndex((l) => l.startsWith("CREW (")) + 1]!.startsWith("If something is not clear, use PILOT'S DISCRETION"));
});

test("DIRECT 배정 문구(LAUNCH with a FLIGHT·K3 RELAUNCH)도 같은 줄을 싣는다", () => {
  const t = { key: "ATC-7", title: "Do the thing", url: null };
  const plain = formatAssignment(t, null, "TEAM_A");
  assert.equal(formatAssignment(t, null, "TEAM_A", [], null), plain);
  const solo = formatAssignment(t, null, "TEAM_A", [], crewPlanOf(["wake:L"], true));
  assert.ok(solo.split("\n").includes(SOLO_M.replace("WAKE M", "WAKE L")));
  assert.match(formatAssignment(t, null, "TEAM_A", [], crewPlanOf(["wake:H"], true)), /^CREW \(WAKE H\): /m);
});

test("detailLabelsOf: 이슈 상세의 라벨을 스냅샷과 같은 '그룹:이름'으로", () => {
  assert.deepEqual(detailLabelsOf({ labels: { nodes: [{ name: "M", parent: { name: "wake" } }, { name: "idea", parent: null }, { bad: 1 }] } }), ["wake:M", "idea"]);
  assert.deepEqual(detailLabelsOf({}), []);
  assert.deepEqual(detailLabelsOf(null), []);
});

test("스위치 파일: 없으면 on, 깨졌으면 off, 모르는 값은 off, 파일에 없는 AIRPORT는 default", () => {
  assert.equal(soloModeAt(soloSwitchOf(null, "missing"), "ATCC"), "on");
  assert.equal(soloModeAt(soloSwitchOf(null, "broken"), "ATCC"), "off");
  assert.equal(soloSwitchOf([1], "ok").source, "broken");
  const sw = soloSwitchOf({ default: "on", airports: { atcc: "off", vocd: "maybe" } }, "ok");
  assert.equal(soloModeAt(sw, "ATCC"), "off");
  assert.equal(soloModeAt(sw, "VOCD"), "off");
  assert.equal(soloModeAt(sw, "NEWX"), "on");
  assert.equal(soloModeAt(sw, null), "on");
  assert.equal(soloModeAt(soloSwitchOf({ airports: {} }, "ok"), "X"), "on"); // default를 안 적었으면 on
  assert.equal(soloModeAt(soloSwitchOf({ default: "nope" }, "ok"), "X"), "off");
});

test("upgradeSoloOnce: 열린 AIRPORT마다 on과 배포 시각을 한 번, 이미 적은 값은 지킨다", () => {
  const at = "2026-10-07T00:00:00.000Z";
  assert.deepEqual(upgradeSoloOnce(soloSwitchOf(null, "missing"), null, ["atcc", "VOCD"], at), { default: "on", airports: { ATCC: "on", VOCD: "on" }, migrated: { id: "ATC-559", at } });
  const raw = { airports: { VOCD: "off" } };
  assert.deepEqual(upgradeSoloOnce(soloSwitchOf(raw, "ok"), raw, ["ATCC", "VOCD"], at)?.airports, { ATCC: "on", VOCD: "off" });
  const done = { default: "on", airports: {}, migrated: { id: "ATC-559", at } };
  assert.equal(upgradeSoloOnce(soloSwitchOf(done, "ok"), done, ["ATCC"], at), null);
  assert.equal(upgradeSoloOnce(soloSwitchOf(null, "broken"), null, ["ATCC"], at), null);
});

test("스위치 입출력: 첫 시작에 한 번 적고, 설정 창은 한 AIRPORT만 바꾼다, 깨진 파일은 덮어쓰지 않는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-solo-"));
  const file = join(dir, "solo-default.json");
  assert.equal(soloOnAt("ATCC", file), true); // 파일 없음 = on
  assert.equal(migrateSoloOnce(["ATCC", "VOCD"], Date.parse("2026-10-07T00:00:00Z"), file), "migrated");
  assert.equal(migrateSoloOnce(["ATCC", "VOCD"], Date.now(), file), "already");
  assert.equal(loadSoloSwitch(file).migrated?.at, "2026-10-07T00:00:00.000Z");
  saveSoloAirports({ vocd: "off" }, file);
  assert.equal(soloOnAt("VOCD", file), false);
  assert.equal(soloOnAt("ATCC", file), true);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).migrated.id, "ATC-559");
  writeFileSync(file, "{nope");
  assert.equal(soloOnAt("ATCC", file), false);
  assert.equal(migrateSoloOnce(["ATCC"], Date.now(), file), "unreadable");
  assert.throws(() => saveSoloAirports({ ATCC: "on" }, file), /읽을 수 없음/);
});

test("오작동 수: (a) SOLO인데 CREW를 썼거나 CREW 때문에 막힘, (b) 배포 앞 7일 같은 WAKE 중앙값보다 긴 block time, (c) WAKE별 FLIGHT당 토큰", () => {
  const anchor = "2026-10-07T00:00:00.000Z";
  const now = Date.parse("2026-10-09T00:00:00.000Z");
  const day = (d: number) => new Date(Date.parse(anchor) + d * 86_400_000).toISOString();
  const land = (flight: string, wake: SoloLanded["wake"], arrived: string, blockMin: number, tokens: number, crew: SoloLanded["crew"] = "SOLO", airport = "ATCC"): SoloLanded => ({ flight, airport, wake, departedAt: arrived, arrivedAt: arrived, blockMin, tokens, crew });
  // 배포 앞: M 세 FLIGHT(block 30·60·90 → 중앙값 60, 토큰 1M·2M·3M → 2M). L은 둘뿐이라 기준 없음
  const before = [land("ATC-1", "M", day(-1), 30, 1e6, "CREW"), land("ATC-2", "M", day(-2), 60, 2e6, "CREW"), land("ATC-3", "M", day(-3), 90, 3e6, "CREW"), land("ATC-4", "L", day(-1), 10, 5e5), land("ATC-5", "L", day(-2), 20, 5e5), land("ATC-6", "M", day(-9), 999, 9e9)];
  const sent = (id: string, flight: string, call: SoloSent["call"], asked: string[] = [], airport = "ATCC"): SoloSent => ({ id, flight, airport, sentAt: day(0.5), call, asked });
  const sents = [
    sent("D-1", "ATC-10", "SOLO"), // 70분 > 60 → (b)
    sent("D-2", "ATC-11", "SOLO"), // CREW를 씀 → (a)
    sent("D-3", "ATC-12", "SOLO", ["needs a UI crew member"]), // BLOCKED에 crew → (a)
    sent("D-4", "ATC-13", "SOLO"), // L: 기준 없음 → 재지 않음
    sent("D-5", "ATC-14", "CREW"),
    sent("D-6", "ATC-15", null),
    sent("D-7", "VOC-1", "SOLO", ["screwdriver"], "VOCD"), // crew라는 낱말이 아니다
  ];
  const after = [land("ATC-10", "M", day(1), 70, 1e6), land("ATC-11", "M", day(1), 40, 1e6, "CREW"), land("ATC-12", "M", day(1), 50, 1e6), land("ATC-13", "L", day(1), 500, 4e5), land("ATC-14", "H", day(1), 600, 8e6, "CREW"), land("VOC-1", "M", day(1), 10, 1e6, "SOLO", "VOCD")];
  const rows = soloMisfiresOf({ sent: sents, landed: [...before, ...after], airports: ["ATCC", "VOCD"], modes: { ATCC: "on", VOCD: "off" }, anchor, now });
  const atcc = rows.find((r) => r.airport === "ATCC")!;
  assert.equal(atcc.mode, "on");
  assert.equal(atcc.solo, 4);
  assert.equal(atcc.crew, 1);
  assert.deepEqual(atcc.tookCrew, ["ATC-11", "ATC-12"]);
  assert.deepEqual(atcc.slow, { over: ["ATC-10"], judged: 3 });
  const m = atcc.tokens.find((t) => t.wake === "M")!;
  assert.deepEqual(m.before, { median: 2e6, n: 3 });
  assert.deepEqual(m.after, { median: 1e6, n: 3 });
  assert.deepEqual(atcc.tokens.find((t) => t.wake === "L")!.before, { median: null, n: 2 });
  assert.deepEqual(atcc.blockBaseline.find((t) => t.wake === "M")!.before, { median: 60, n: 3 });
  const vocd = rows.find((r) => r.airport === "VOCD")!;
  assert.equal(vocd.mode, "off");
  assert.deepEqual(vocd.tookCrew, []);
  assert.deepEqual(vocd.slow, { over: [], judged: 0 }); // VOCD는 배포 앞 기록이 없다
});

test("오작동 수: 배포 시각이 없으면 기준이 없고, 최근 7일 밖의 카드는 세지 않는다", () => {
  const now = Date.parse("2026-10-20T00:00:00.000Z");
  const rows = soloMisfiresOf({
    sent: [{ id: "D-1", flight: "ATC-1", airport: "ATCC", sentAt: "2026-10-01T00:00:00.000Z", call: "SOLO", asked: [] }, { id: "D-2", flight: "ATC-2", airport: "ATCC", sentAt: "2026-10-19T00:00:00.000Z", call: "SOLO", asked: [] }],
    landed: [{ flight: "ATC-2", airport: "ATCC", wake: "M", departedAt: "2026-10-19T01:00:00.000Z", arrivedAt: "2026-10-19T02:00:00.000Z", blockMin: 5, tokens: 1, crew: "SOLO" }],
    airports: ["ATCC"],
    modes: {},
    anchor: null,
    now,
  });
  assert.equal(rows[0]!.solo, 1);
  assert.equal(rows[0]!.mode, "on");
  assert.deepEqual(rows[0]!.slow, { over: [], judged: 0 });
  assert.deepEqual(rows[0]!.tokens.find((t) => t.wake === "M")!.before, { median: null, n: 0 });
});

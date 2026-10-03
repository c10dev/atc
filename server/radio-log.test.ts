import assert from "node:assert/strict";
import { test } from "node:test";
import type { Transmission } from "./radio.ts";
import { ageText, filterByStation, stationOf, stationOfHash, stationPasses, stationsOf, ALL_FILTER, asOf, filterTx, flightTx, linksOf, loadFilter, mergeTx, openState, optionsOf, saveFilter, splitHead, threadsOf, WINDOW_MS } from "../web/src/radio-log.ts";

const T0 = Date.parse("2026-09-30T10:00:00.000Z");
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();
const tx = (id: string, min: number, extra: Partial<Transmission> = {}): Transmission => ({
  id, at: iso(min), freq: "TOWER", from: "TOWER", to: "GOLF (TEAM_G)", kind: "LAND", head: "TOWER → GOLF · LAND · ATC-1", aircraft: "TEAM_G", ...extra,
});
const reply = (id: string, callId: string, min: number, extra: Partial<Transmission> = {}) => tx(id, min, { replyTo: callId, kind: "READBACK", from: "GOLF (TEAM_G)", to: "TOWER", ...extra });

test("mergeTx: id로 합치고(새것이 이김), 시각순·호출 먼저, 6시간 밖은 버린다", () => {
  const now = T0 + 10 * 60_000;
  const a = tx("C-0001", 0, { open: true });
  const merged = mergeTx([a], [tx("C-0001", 0), reply("C-0001#readback", "C-0001", 0), tx("C-0002", -1), tx("C-0000", -WINDOW_MS / 60_000 - 5)], now);
  assert.deepEqual(merged.map((t) => t.id), ["C-0002", "C-0001", "C-0001#readback"]);
  assert.equal(merged[1].open, undefined); // 새것이 이겼다
});

test("filterTx: 주파수·AIRPORT·AIRCRAFT", () => {
  const list = [tx("C-1", 0, { airport: "ATCC" }), tx("D-1", 1, { freq: "DELIVERY", airport: "VCDO", aircraft: "TEAM_H" }), tx("m", 2, { freq: "GROUND", aircraft: undefined })];
  assert.equal(filterTx(list, ALL_FILTER).length, 3);
  assert.deepEqual(filterTx(list, { ...ALL_FILTER, freqs: new Set(["DELIVERY", "GROUND"]) }).map((t) => t.id), ["D-1", "m"]);
  assert.deepEqual(filterTx(list, { ...ALL_FILTER, airport: "ATCC" }).map((t) => t.id), ["C-1"]);
  assert.deepEqual(filterTx(list, { ...ALL_FILTER, aircraft: "TEAM_H" }).map((t) => t.id), ["D-1"]);
  assert.deepEqual(optionsOf(list, "airport"), ["ATCC", "VCDO"]);
  assert.deepEqual(optionsOf(list, "aircraft"), ["TEAM_G", "TEAM_H"]);
});

test("threadsOf: 답은 호출 밑, 호출 없는 답은 스스로 한 줄", () => {
  const list = [tx("C-1", 0), tx("C-2", 1), reply("C-1#standby", "C-1", 2, { kind: "STANDBY" }), reply("C-1#readback", "C-1", 3), reply("C-9#readback", "C-9", 4, { orphan: true })];
  const th = threadsOf(list);
  assert.deepEqual(th.map((t) => [t.tx.id, t.replies.map((r) => r.id)]), [["C-1", ["C-1#standby", "C-1#readback"]], ["C-2", []], ["C-9#readback", []]]);
});

test("openState: 열림 · overdue · 답이면 없음", () => {
  const call = tx("C-1", 0, { open: true, overdueAt: iso(10) });
  assert.deepEqual(openState(call, T0 + 4 * 60_000), { kind: "open", ageMs: 4 * 60_000 });
  assert.equal(openState(call, T0 + 11 * 60_000)?.kind, "overdue");
  assert.equal(openState({ ...call, open: undefined }, T0 + 11 * 60_000), null);
  assert.equal(openState(reply("r", "C-1", 1, { open: true }), T0), null);
  assert.equal(ageText(30_000), "1분 미만");
  assert.equal(ageText(4 * 60_000), "4분");
  assert.equal(ageText(62 * 60_000), "1시간 2분");
});

test("asOf: 그 시각 뒤의 교신은 빼고, 그때 답이 없던 호출은 다시 열린다", () => {
  const list = [tx("C-1", 0), reply("C-1#readback", "C-1", 5), tx("C-2", 1), tx("C-3", 2), reply("C-3#standby", "C-3", 3, { kind: "STANDBY" })];
  const at3 = asOf(list, T0 + 3 * 60_000);
  assert.deepEqual(at3.map((t) => t.id), ["C-1", "C-2", "C-3", "C-3#standby"]);
  const c1 = at3.find((t) => t.id === "C-1")!;
  assert.equal(c1.open, true);
  assert.equal(c1.overdueAt, iso(10));
  assert.equal(at3.find((t) => t.id === "C-2")!.open, undefined); // 서버가 답 없이 닫은 호출은 그대로
  const at6 = asOf(list, T0 + 6 * 60_000);
  assert.equal(at6.find((t) => t.id === "C-1")!.open, undefined);
});

test("linksOf: PR · DISPATCH · STRIPS · FLEET", () => {
  assert.deepEqual(linksOf(tx("C-0181#readback", 0, { replyTo: "C-0181" })).map((l) => l.href), ["#flights", "#fleet/TEAM_G"]);
  assert.deepEqual(linksOf(tx("D-0012", 0, { freq: "DELIVERY" })).map((l) => l.label), ["D-0012", "TEAM_G"]);
  assert.deepEqual(linksOf(tx("CC-0003", 0, { freq: "COMPANY" })).map((l) => l.href), ["#fleet/TEAM_G"]);
  assert.deepEqual(linksOf(tx("mcc:x", 0, { freq: "GROUND", aircraft: undefined, pr: 254 })).map((l) => l.href), ["https://github.com/chaehy5665/atc/pull/254"]);
  assert.deepEqual(linksOf(tx("C-1", 0, { aircraft: "OCC" })).map((l) => l.label), ["C-1"]);
});

test("splitHead", () => {
  assert.deepEqual(splitHead("TOWER → GOLF · GO AROUND · ATC-147"), { stations: "TOWER → GOLF", rest: "GO AROUND · ATC-147" });
  assert.deepEqual(splitHead("x"), { stations: "x", rest: "" });
});

test("localStorage: 저장·복원, 못 읽으면 전부 보기", () => {
  const mem = new Map<string, string>();
  const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  saveFilter(st, { freqs: new Set(["TOWER"]), airport: "ATCC", aircraft: null });
  const back = loadFilter(st);
  assert.deepEqual([...back.freqs], ["TOWER"]);
  assert.equal(back.airport, "ATCC");
  assert.equal(back.aircraft, null);
  assert.equal(loadFilter(null), ALL_FILTER);
  assert.equal(loadFilter({ getItem: () => { throw new Error("blocked"); } }), ALL_FILTER);
  mem.set("atc.radio.freqs", "not json");
  assert.deepEqual([...loadFilter(st).freqs].length, 5);
  mem.set("atc.radio.freqs", JSON.stringify(["NOPE"]));
  assert.deepEqual([...loadFilter(st).freqs].length, 5);
  mem.set("atc.radio.freqs", JSON.stringify(["DELIVERY", "TOWER", "GROUND", "COMPANY"])); // 다섯째 주파수 전에 저장된 전부 보기
  assert.equal(loadFilter(st).freqs.size, 5);
  assert.doesNotThrow(() => saveFilter({ setItem: () => { throw new Error("full"); }, removeItem: () => {} }, ALL_FILTER));
});

test("flightTx: 그 FLIGHT의 호출과 그 호출의 답(답에 flight가 없어도)", () => {
  const list = [tx("C-1", 0, { flight: "ATC-1" }), reply("C-1#readback", "C-1", 1), tx("C-2", 2, { flight: "ATC-2" }), reply("C-2#readback", "C-2", 3), tx("G-1", 4, { freq: "GROUND", flight: undefined })];
  assert.deepEqual(flightTx(list, "ATC-1").map((t) => t.id), ["C-1", "C-1#readback"]);
  assert.deepEqual(flightTx(list, "ATC-9"), []);
});

// RADIO 사이드바의 스테이션 필터(ATC-446)
test("stationOf: 관제는 이름 그대로, AIRCRAFT는 REGISTRATION, ALL·빈 값은 스테이션이 아님", () => {
  assert.deepEqual(stationOf("TOWER"), { id: "TOWER", label: "TOWER", kind: "control" });
  assert.deepEqual(stationOf("GOLF (TEAM_G)"), { id: "TEAM_G", label: "GOLF", kind: "aircraft" });
  assert.equal(stationOf("ALL"), null);
  assert.equal(stationOf(" "), null);
});

test("stationPasses·filterByStation: 보낸 쪽이거나 받는 쪽이면 통과, null은 전부", () => {
  const call = tx("C-1", 0);
  const ack = reply("C-1#r", "C-1", 1);
  const other = tx("D-1", 2, { freq: "DELIVERY", from: "OCC", to: "HOTEL (TEAM_H)", aircraft: "TEAM_H" });
  const all = [call, ack, other];
  assert.deepEqual(filterByStation(all, "TEAM_G").map((t) => t.id), ["C-1", "C-1#r"]);
  assert.deepEqual(filterByStation(all, "OCC").map((t) => t.id), ["D-1"]);
  assert.deepEqual(filterByStation(all, "TOWER").map((t) => t.id), ["C-1", "C-1#r"]);
  assert.equal(filterByStation(all, null).length, 3);
  assert.equal(stationPasses(call, "TEAM_H"), false);
});

test("stationsOf: 관제와 AIRCRAFT로 나누어 세고, 같은 교신의 양쪽은 한 번, 관제는 정해진 순서", () => {
  const txs = [
    tx("C-1", 0),
    reply("C-1#r", "C-1", 1),
    tx("D-1", 2, { freq: "DELIVERY", from: "OCC", to: "HOTEL (TEAM_H)", aircraft: "TEAM_H" }),
    tx("g", 3, { freq: "GROUND", from: "MCC", to: "ALL", aircraft: undefined }),
    tx("r", 4, { from: "REVIEW", to: "AARDVARK", aircraft: undefined }),
    tx("self", 5, { from: "OCC", to: "OCC", aircraft: undefined }),
  ];
  const s = stationsOf(txs);
  assert.deepEqual(s.control.map((c) => [c.id, c.count]), [["TOWER", 2], ["OCC", 2], ["MCC", 1], ["REVIEW", 1], ["AARDVARK", 1]]);
  assert.deepEqual(s.aircraft.map((c) => [c.id, c.count]), [["TEAM_G", 2], ["TEAM_H", 1]]);
  assert.deepEqual(stationsOf([]), { control: [], aircraft: [] });
});

test("stationOfHash: #radio/<스테이션>만 필터, 나머지는 전부", () => {
  assert.equal(stationOfHash("#radio/TEAM_E"), "TEAM_E");
  assert.equal(stationOfHash("#radio/GOLF%20X"), "GOLF X");
  assert.equal(stationOfHash("#radio"), null);
  assert.equal(stationOfHash("#flights/TEAM_E"), null);
  assert.equal(stationOfHash("#radio/%E0%A4%A"), "%E0%A4%A");
});

// PREFLIGHT 줄은 AIRCRAFT가 보낸·받는 쪽에 없고 aircraft에만 있다(CROSSCHECK → OCC, HOLD → ALL): AIRCRAFT 스테이션이 그 줄도 보여야 한다
test("스테이션: aircraft만 가진 PREFLIGHT 줄도 그 AIRCRAFT의 것이고, 자리 이름은 스테이션이 아님", () => {
  const cc = tx("p1", 0, { freq: "PREFLIGHT", from: "CROSSCHECK", to: "OCC", kind: "CROSSCHECK", aircraft: "TEAM_G" });
  const hold = tx("p2", 1, { freq: "PREFLIGHT", from: "OCC", to: "ALL", kind: "HOLD", aircraft: "TEAM_G" });
  const unknown = tx("p3", 2, { from: "?", to: "OCC", aircraft: undefined });
  const arrived = tx("p4", 3, { from: "AIRCRAFT", to: "OCC", aircraft: undefined });
  const all = [cc, hold, unknown, arrived];
  assert.deepEqual(filterByStation(all, "TEAM_G").map((t) => t.id), ["p1", "p2"]);
  assert.deepEqual(filterByStation(all, "OCC").map((t) => t.id), ["p1", "p2", "p3", "p4"]);
  const s = stationsOf(all);
  assert.deepEqual(s.control.map((c) => [c.id, c.count]), [["OCC", 4]]);
  assert.deepEqual(s.aircraft.map((c) => [c.id, c.count]), [["TEAM_G", 2]]);
  assert.equal(stationOf("CROSSCHECK"), null);
});

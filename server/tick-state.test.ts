import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import { actionable, persistentKeysOf } from "./tick.ts";
import { mountTick, nextSeen, readSeen } from "./tick-run.ts";

// 상태에서 오는 "새로 보이면 한 번 알린다" 줄(MCC INSPECTION 지적, ATC-297): 처음 보이는 항목만 할 일이다
const emptyOpen = { conflicts: [], orphans: [], unattended: [], noContact: [], health: [], healthAlerts: [], fuel: [], fuelLeaks: [], coldCache: [], stranded: [] };
const tower = (over: Record<string, unknown> = {}, open: Record<string, unknown> = {}) => ({
  cursor: "1",
  reset: false,
  events: [],
  open: { ...emptyOpen, ...open },
  landingQueue: [],
  groundStops: [],
  clearances: { pending: [], overdue: [] },
  ...over,
});
const q = (over: Record<string, unknown>) => ({ airport: "ATCC", pr: { number: 7, head: "abc1234" }, landing: "APPROACH", blocks: [], ...over });

// [이름, brief 덮어쓰기, open 덮어쓰기, 이유, key]
const rows: [string, Record<string, unknown>, Record<string, unknown>, string, string][] = [
  ["FUEL: 새 key", {}, { fuel: [{ key: "acct-1|2026-10-01", text: "80 %" }] }, "new:fuel", "fuel:acct-1|2026-10-01"],
  ["FUEL LEAK: 새 key", {}, { fuelLeaks: [{ key: "TEAM_G|2026-10-01" }] }, "new:fuel-leak", "fuel-leak:TEAM_G|2026-10-01"],
  ["GitHub 오류", { github: { error: "rate limited" } }, {}, "new:github-error", "github-error:rate limited"],
  ["외부 리뷰 제외(extReview excluded)", { landingQueue: [q({ extReview: { status: "excluded", family: "sec" } })] }, {}, "new:ext-excluded", "ext-excluded:ATCC#7"],
  ["STRANDED", {}, { stranded: [{ key: "ATC-5", pr: 9 }] }, "new:stranded", "stranded:ATC-5#9"],
  ["NORDO STAND(orphans)", {}, { orphans: [{ stand: "s1", sessions: [] }] }, "new:orphan", "orphan:s1"],
  ["UNIDENTIFIED(unattended)", {}, { unattended: [{ stand: "s2", message: "m" }] }, "new:unattended", "unattended:s2"],
  ["NO CONTACT", {}, { noContact: ["ATC182"] }, "new:no-contact", "no-contact:ATC182"],
  ["AIRCRAFT HEALTH alert", {}, { health: [{ name: "TEAM_O", code: "HUNG", level: "alert" }] }, "new:health", "health:TEAM_O|HUNG"],
  ["healthAlerts 문구(기간은 지운다)", {}, { healthAlerts: [{ message: "BLOCKED — TEAM_N이 24분째 기다림" }] }, "new:health-alert", "health-alert:BLOCKED — TEAM_N이 N분째 기다림"],
];

test("TOWER: 표의 상태 줄마다 처음 보이면 act(새 key), 이미 보였으면 조용하다", () => {
  for (const [name, over, open, why, key] of rows) {
    const b = tower(over, open);
    assert.deepEqual(persistentKeysOf(b), [key], name);
    const first = actionable("tower", { brief: b }, new Set());
    assert.equal(first.act, true, name);
    assert.deepEqual(first.reasons, [why], name);
    assert.deepEqual(actionable("tower", { brief: b }, new Set([key])), { act: false, reasons: [], info: 0 }, `${name}: 이미 보였다`);
  }
  // 기본(seen을 모르면 비어 있다)은 있는 항목을 모두 새 것으로 센다: 조용하다고 잘못 말하지 않는다
  assert.equal(actionable("tower", { brief: tower({}, { fuel: [{ key: "k" }] }) }).act, true);
});

test("TOWER: 문구의 분만 달라진 경보는 같은 항목이고, 같은 종류의 새 항목이 더해지면 act", () => {
  const a = tower({}, { healthAlerts: [{ message: "BLOCKED — TEAM_N이 25분째 기다림" }] });
  assert.equal(actionable("tower", { brief: a }, new Set(["health-alert:BLOCKED — TEAM_N이 N분째 기다림"])).act, false);
  const two = tower({}, { fuel: [{ key: "k1" }, { key: "k2" }] });
  assert.equal(actionable("tower", { brief: two }, new Set(["fuel:k1"])).act, true);
});

test("TOWER: info 단계 건강 상태, coldCache, fuelError, 그림자 GROUND STOP은 일부러 할 일로 세지 않는다(ATC LOG에만 쓰거나 다른 줄이 데려온다)", () => {
  const b = tower({ groundStops: [{ airport: "ATCC", trigger: "t", enforced: false }] }, { health: [{ name: "T", code: "PENDING", level: "info" }], coldCache: [{ name: "TEAM_G" }], fuelError: "읽지 못함" });
  assert.deepEqual(persistentKeysOf(b), []);
  assert.equal(actionable("tower", { brief: b }).act, false);
});

test("persistentKeysOf: 이상한 입력에도 던지지 않는다", () => {
  for (const b of [null, undefined, "x", {}, { open: null, landingQueue: "no" }]) assert.deepEqual(persistentKeysOf(b), []);
});

test("nextSeen: act면 지금 있는 항목을 모두 본 것으로, 조용하면 사라진 항목을 빼서(다시 생기면 새 것)", () => {
  assert.deepEqual(nextSeen(["a", "b"], ["b", "c"], true), ["b", "c"]);
  assert.deepEqual(nextSeen(["a", "b"], ["b", "c"], false), ["b"]);
  assert.deepEqual(nextSeen([], [], false), []);
});

test("GET /api/tick/tower: 새 항목은 한 번만 act하고(seen이 저장된다), 읽지 못한 seen은 비어 있는 것으로 본다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tick-seen-"));
  try {
    const file = join(dir, "tick-seen.json");
    const box = { brief: tower({}, { fuel: [{ key: "k1" }] }) as unknown };
    const app = new Hono();
    mountTick(app, { get: async () => box.brief, seenFile: () => file });
    const call = async () => (await (await app.request("/api/tick/tower")).json()) as { act: boolean; reasons: string[] };
    const first = await call();
    assert.deepEqual([first.act, first.reasons], [true, ["new:fuel"]]); // 처음
    assert.deepEqual(readSeen(file), { tower: ["fuel:k1"] });
    assert.equal((await call()).act, false); // 같은 항목은 이미 보였다
    box.brief = tower({}, {}); // 사라졌다
    assert.equal((await call()).act, false);
    assert.deepEqual(readSeen(file), { tower: [] });
    box.brief = tower({}, { fuel: [{ key: "k1" }] }); // 다시 생기면 새 것이다
    assert.equal((await call()).act, true);
    writeFileSync(file, "{ 깨짐");
    assert.equal((await call()).act, true); // 읽지 못하면 비어 있는 것으로 본다
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("seen은 TOWER만 쓴다: 다른 역할의 호출은 파일을 만들지 않는다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tick-seen-"));
  try {
    const file = join(dir, "tick-seen.json");
    const app = new Hono();
    mountTick(app, { get: async () => ({ pending: [{ pr: "atc#1", head: "a" }], excluded: [], recent: [] }), seenFile: () => file });
    assert.equal(((await (await app.request("/api/tick/review")).json()) as { act: boolean }).act, true);
    assert.deepEqual(readSeen(file), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { type AlertsInput, supervisorAlertsOf } from "./supervisor-alerts.ts";
import { waitingOnPersonOf } from "./waiting-person.ts";
import { DEFAULT_TOPICS, parseTopics, summaryKey, summaryOf, type SummaryInput, topFuelOf, workingOf } from "./supervisor-summary.ts";

const AT = "2026-09-30T00:00:00.000Z";
const input = (over: Partial<SummaryInput> = {}): SummaryInput => ({ items: [], waiting: [], fuelAccounts: [], rts: null, working: { aircraft: 0, control: 0 }, at: AT, ...over });
const item = (key: string, level: SummaryInput["items"][number]["level"], cue: SummaryInput["items"][number]["cue"] = null, aircraft: string | null = null) => ({ key, level, cue, aircraft });
const win = (name: string, pct: number) => ({ name: name as "five_hour", pct, resetsAt: "2026-09-30T05:00:00Z" });

test("빈 목록: master null, 전부 0, fuel·rts 없음", () => {
  assert.deepEqual(summaryOf(input()), {
    v: 1, at: AT, master: null, counts: { warning: 0, caution: 0, advisory: 0 }, pending: { dispatch: 0, humanCheck: 0, tool: 0, schedule: 0 },
    fuel: null, rts: null, working: { aircraft: 0, control: 0 }, needsYou: [],
  });
});

test("master는 가장 높은 등급: warning > caution > null(advisory만이면 null)", () => {
  assert.equal(summaryOf(input({ items: [item("a", "advisory"), item("b", "caution"), item("c", "warning")] })).master, "warning");
  assert.equal(summaryOf(input({ items: [item("a", "advisory"), item("b", "caution")] })).master, "caution");
  assert.equal(summaryOf(input({ items: [item("a", "advisory"), item("b", null)] })).master, null);
});

test("counts는 알림 목록의 등급과 같다(supervisorAlertsOf의 실제 출력으로)", () => {
  const list = supervisorAlertsOf({
    sessions: [{ id: "s1", name: "TEAM_G", status: "busy", health: { code: "PENDING", level: "info", since: "2026-09-29T01:00:00Z", detail: "d", next: "n", holds: false } as never }],
    alerts: [{ kind: "conflict", message: "같은 STAND", sessionIds: ["s1"], workspacePath: "/ws/a" }],
    workspaces: [{ path: "/ws/a", ticketKey: "ATC-1" }],
    tickets: [],
    following: [{ flight: "ATC-2", aircraft: "TEAM_E", issues: [{ code: "no-pr", kind: "delay", severity: "warn", text: "t", since: "2026-09-29T01:00:00Z", key: "ATC-2|no-pr" }] }],
    proposals: [{ id: "D-1", kind: "ASSIGN", status: "proposed", flight: "ATC-3", aircraftName: "TEAM_B", holdAt: null, statusAt: "2026-09-29T01:00:00Z" }],
    pulls: [{ repo: "/r", number: 7, title: "T", head: "abc", landing: "CLEARED", draft: false, ticketKey: "ATC-7", humanCheck: { required: true, state: "waiting" } as never }],
    rts: { at: "2026-09-29T02:00:00Z", from: "aaaaaaa1", to: "bbbbbbb2", result: "rollback", detail: "x" },
  } satisfies AlertsInput);
  // 사람을 기다리는 AIRCRAFT는 TEAM_G(도구 승인 프롬프트)뿐이다. TEAM_B의 DISPATCH 카드는 판정을 기다리는 것이라 needsYou가 아니라 pending.dispatch로만 센다(ATC-374)
  const waiting = waitingOnPersonOf({ sessions: [{ id: "s1", name: "TEAM_G", status: "busy", health: { code: "PENDING", since: "2026-09-29T01:00:00Z" } }], proposals: [], now: Date.parse("2026-09-29T03:00:00Z"), blockedMin: 3 });
  const s = summaryOf(input({ items: list, waiting }));
  const n = (l: string) => list.filter((a) => a.level === l).length;
  assert.deepEqual(s.counts, { warning: n("warning"), caution: n("caution"), advisory: n("advisory") });
  assert.ok(s.counts.warning >= 2 && s.counts.caution >= 1 && s.counts.advisory >= 3); // 목록이 세 등급을 다 가진다
  assert.equal(s.master, "warning");
  assert.deepEqual(s.pending, { dispatch: 1, humanCheck: 1, tool: 1, schedule: 0 });
  assert.deepEqual(s.needsYou, ["TEAM_G"]);
});

test("pending은 key 종류별로 센다", () => {
  const s = summaryOf(input({ items: [item("pending|proposal|D-1", "advisory", "call"), item("pending|proposal|D-2", "advisory", "call"), item("pending|humancheck|r#1|x", "advisory", "call"), item("pending|tool|s|t", "advisory", "call"), item("pending|schedule|S-0001", "advisory", "call"), item("land|x", "advisory")] }));
  assert.deepEqual(s.pending, { dispatch: 2, humanCheck: 1, tool: 1, schedule: 1 });
});

test("fuel: 가장 많이 쓴 ACCOUNT의 라벨과 창. 라벨이 없으면 group", () => {
  assert.equal(topFuelOf([]), null);
  const f = topFuelOf([
    { group: "aircraft:TEAM_A", account: null, windows: [win("five_hour", 33), win("seven_day", 20)] },
    { group: "main", account: "max-1", windows: [win("five_hour", 10), win("seven_day", 71)] },
  ]);
  assert.deepEqual(f, { label: "max-1", windows: [{ name: "five_hour", pct: 10, resetsAt: "2026-09-30T05:00:00Z" }, { name: "seven_day", pct: 71, resetsAt: "2026-09-30T05:00:00Z" }] });
  assert.equal(topFuelOf([{ group: "aircraft:TEAM_A", account: null, windows: [win("five_hour", 1)] }])!.label, "aircraft:TEAM_A");
});

test("rts는 마지막 기록의 결과·시각·from·to", () => {
  const s = summaryOf(input({ rts: { at: "2026-09-29T02:00:00Z", from: null, to: "bbb", result: "ok" } }));
  assert.deepEqual(s.rts, { result: "ok", at: "2026-09-29T02:00:00Z", from: null, to: "bbb" });
});

test("working: busy인 AIRCRAFT REGISTRATION 수와 관제 세션 수", () => {
  const reg = (n: string) => (/^TEAM_[A-Z]$/i.test(n) ? n.toUpperCase() : null);
  const sessions = [
    { name: "TEAM_E", status: "busy" }, { name: "team_e", status: "busy" }, { name: "TEAM_B", status: "idle" },
    { name: "TOWER", status: "busy" }, { name: "OCC", status: "idle" }, { name: "scratch", status: "busy" },
  ];
  assert.deepEqual(workingOf(sessions, reg, ["TOWER", "OCC", "MCC"]), { aircraft: 1, control: 1 });
});

test("summaryKey는 at을 뺀 내용이 같으면 같다(SSE 중복 제거)", () => {
  const a = summaryOf(input({ items: [item("a", "caution")] }));
  const b = summaryOf(input({ items: [item("a", "caution")], at: "2026-09-30T00:00:05.000Z" }));
  assert.equal(summaryKey(a), summaryKey(b));
  assert.notEqual(summaryKey(a), summaryKey(summaryOf(input({ items: [item("a", "warning")] }))));
});

test("topics: 목록을 읽고, 없거나 비면 summary만 뺀 기본, 모르는 이름은 거절", () => {
  assert.deepEqual([...DEFAULT_TOPICS], ["snapshot", "alert", "version"]);
  for (const raw of [undefined, "", " , "]) assert.deepEqual(parseTopics(raw), { ok: true, topics: new Set(DEFAULT_TOPICS) });
  assert.deepEqual(parseTopics("alert,summary"), { ok: true, topics: new Set(["alert", "summary"]) });
  assert.deepEqual(parseTopics(" version , summary,version"), { ok: true, topics: new Set(["version", "summary"]) });
  assert.deepEqual(parseTopics("radio"), { ok: true, topics: new Set(["radio"]) }); // ATC-170: 옵트인, 기본 집합에는 없다
  assert.ok(!DEFAULT_TOPICS.includes("radio" as never));
  assert.deepEqual(parseTopics("alert,ping"), { ok: false, unknown: ["ping"] });
  assert.deepEqual(parseTopics("nope,foo,alert"), { ok: false, unknown: ["nope", "foo"] });
});

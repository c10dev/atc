import assert from "node:assert/strict";
import test from "node:test";
import type { Ticket } from "./model.ts";
import type { ReleaseLine } from "./release.ts";
import { parkedFireVerdict, parkedMisfiresOf, parkedOf } from "./release-parked.ts";

// PARKED(ATC-487). 사례는 2026-10-03: ATC-451(막는 이슈 없음, K3), ATC-475(Sequence 줄, 막는 이슈 없음), 1초 간격으로 올라온 중복 한 쌍
const tk = (key: string, o: Partial<Ticket> = {}): Ticket => ({
  key,
  title: `t ${key}`,
  state: "Backlog",
  stateType: "backlog",
  stateColor: null,
  assignee: null,
  takenBy: null,
  priority: 2,
  url: null,
  updatedAt: null,
  project: null,
  labels: [],
  createdAt: "2026-10-03T01:00:00Z",
  startedAt: null,
  blocks: [],
  blockedBy: [],
  related: [],
  parent: null,
  children: [],
  releaseHash: "h",
  ...o,
});
const TEAMS = new Set(["ATC"]);
const sel = (tickets: Ticket[], o: { filed?: string[]; inTree?: string[] } = {}) => parkedOf({ tickets, teams: TEAMS, filed: new Set(o.filed ?? []), inTree: new Set(o.inTree ?? []) }).map((r) => r.key);

test("PARKED 선택: 막는 이슈 없는 후보 팀 Backlog 이슈를 오래된 순으로 — ATC-451(K3)", () => {
  const k3 = [{ label: "deploy" as never, control: "x", files: ["a.ts"] }];
  const rows = parkedOf({ tickets: [tk("ATC-451", { k3, kEffects: "K3[deploy]: x | files: a.ts", creator: "c10", createdAt: "2026-10-03T02:00:00Z" }), tk("ATC-440")], teams: TEAMS, filed: new Set() });
  assert.deepEqual(rows.map((r) => r.key), ["ATC-440", "ATC-451"]);
  assert.equal(rows[1]?.by, "c10");
  assert.equal(rows[1]?.k3?.length, 1);
  assert.equal(rows[0]?.by, null);
});

test("PARKED 선택: 상위 이슈·다른 팀·끝난 것·제안·이미 나무의 줄·막힌 것은 뺀다", () => {
  const tickets = [
    tk("ATC-1", { children: ["ATC-2"] }),
    tk("ATC-2", { parent: "ATC-1", blockedBy: ["ATC-9"] }), // 막혀 있다(기다림 줄)
    tk("ATC-9", { stateType: "unstarted", state: "Todo" }),
    tk("VOC-5"),
    tk("ATC-3", { stateType: "completed", state: "Done" }),
    tk("ATC-4", { stateType: "canceled", state: "Canceled" }),
    tk("ATC-5"), // 제안
    tk("ATC-6"), // 이미 나무의 줄
    tk("ATC-7", { blockedBy: ["ATC-3"] }), // 막는 이슈가 다 끝남: READY 줄
    tk("ATC-8"),
  ];
  assert.deepEqual(sel(tickets, { filed: ["ATC-5"], inTree: ["ATC-6"] }), ["ATC-8"]);
});

test("PARKED 선택: Sequence 줄이 있어도 막지 않고 숨기지 않는다 — ATC-475", () => {
  const rows = parkedOf({
    tickets: [tk("ATC-475", { sequence: { after: "ATC-474", reason: "same files", problem: null } }), tk("ATC-476", { sequence: { after: null, reason: null, problem: "꼴이 아님" } })],
    teams: TEAMS,
    filed: new Set(),
  });
  assert.deepEqual(rows.map((r) => r.key), ["ATC-475", "ATC-476"]);
  assert.deepEqual(rows[0]?.sequence, { after: "ATC-474", reason: "same files" });
  assert.equal(rows[1]?.sequence, null);
});

test("PARKED 선택: 1초 간격 중복 한 쌍은 둘 다 보인다", () => {
  const tickets = [tk("ATC-482", { title: "same", createdAt: "2026-10-03T03:00:01Z" }), tk("ATC-481", { title: "same", createdAt: "2026-10-03T03:00:00Z" })];
  assert.deepEqual(sel(tickets), ["ATC-481", "ATC-482"]);
});

test("발권 판정: PARKED만 받고 스위치가 꺼지면 거절한다", () => {
  const tickets = [tk("ATC-10"), tk("ATC-11", { children: [] }), tk("ATC-12", { parent: "ATC-11" }), tk("ATC-13", { blockedBy: ["ATC-14"] }), tk("ATC-14", { stateType: "unstarted", state: "Todo" }), tk("ATC-15", { stateType: "unstarted", state: "Todo" }), tk("VOC-1")];
  const v = (key: string, on = true) => parkedFireVerdict({ tickets, teams: TEAMS, filed: new Set(), on }, key);
  const ok = v("ATC-10");
  assert.equal(ok.ok, true);
  assert.equal(v("ATC-10", false).ok, false);
  assert.match((v("ATC-11") as { error: string }).error, /상위 이슈/); // ATC-12의 상위
  assert.match((v("ATC-13") as { error: string }).error, /ATC-14를 기다림/);
  assert.match((v("ATC-15") as { error: string }).error, /Backlog가 아님/);
  assert.match((v("VOC-1") as { error: string }).error, /후보 팀/);
  assert.equal(v("ATC-99").ok, false);
});

test("발권 판정: 제안은 PARKED가 아니다(제안 길로 간다)", () => {
  const tickets = [tk("ATC-20")];
  assert.equal(parkedFireVerdict({ tickets, teams: TEAMS, filed: new Set(["ATC-20"]), on: true }, "ATC-20").ok, false);
});

test("오작동 수: 7일 안에 PARKED에서 발권했고 24시간 안에 Canceled·Duplicate가 된 이슈", () => {
  const now = Date.parse("2026-10-10T00:00:00Z");
  const rel = (flight: string, at: string, parked = true): ReleaseLine => ({ op: "release", flight, channel: "screen", at, hash: "h", via: "click", ...(parked ? { parked: true as const } : {}) });
  const lines: ReleaseLine[] = [
    rel("ATC-1", "2026-10-09T00:00:00Z"), // 12시간 뒤 취소: 오작동
    rel("ATC-2", "2026-10-09T00:00:00Z"), // 사흘 뒤 취소: 아님
    rel("ATC-3", "2026-10-09T00:00:00Z", false), // PARKED가 아닌 발권
    rel("ATC-4", "2026-10-01T00:00:00Z"), // 7일 밖
    rel("ATC-5", "2026-10-09T00:00:00Z"), // 중복
    rel("ATC-6", "2026-10-09T00:00:00Z"), // 멀쩡
  ];
  const tickets = [
    tk("ATC-1", { stateType: "canceled", updatedAt: "2026-10-09T12:00:00Z" }),
    tk("ATC-2", { stateType: "canceled", updatedAt: "2026-10-12T00:00:00Z" }),
    tk("ATC-3", { stateType: "canceled", updatedAt: "2026-10-09T01:00:00Z" }),
    tk("ATC-4", { stateType: "canceled", updatedAt: "2026-10-01T01:00:00Z" }),
    tk("ATC-5", { stateType: "duplicate" as never, updatedAt: "2026-10-09T00:00:01Z" }),
    tk("ATC-6", { stateType: "started", updatedAt: "2026-10-09T01:00:00Z" }),
  ];
  assert.deepEqual(parkedMisfiresOf(lines, tickets, now), { fired: 4, misfires: ["ATC-1", "ATC-5"] });
  assert.deepEqual(parkedMisfiresOf([], tickets, now), { fired: 0, misfires: [] });
});

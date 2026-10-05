import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assignWhyNot } from "./auto-approve.ts";
import { BETTER_WHY, DEFAULT_DISPATCH_CONFIG, loadDispatchConfig, saveContestGuard, type DispatchConfig, type Plan } from "./dispatch.ts";
import { displacementMisfire, misfireView } from "./misfire.ts";
import type { Ticket } from "./model.ts";
import { DISPLACE_MAX_24H, displacedCountOf, droppedGuardedOf, fold, guardedOf, type Op, syncOps } from "./proposals.ts";

// 경합 보호(ATC-547): 자리 잡은 카드는 "더 나은 배정"에 밀려나지 않고, 밀려난 FLIGHT는 나이를 이어받고, 24시간에 두 번 밀려난 FLIGHT는 다시 밀지 않는다. 순수 함수만(planner 입력은 손으로 만든 계획).
const T0 = Date.parse("2026-10-05T07:24:00.000Z");
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const cfgOn: DispatchConfig = { ...DEFAULT_DISPATCH_CONFIG, autoDispatch: "on", settleMin: 10, contestGuard: "on", candidateTeams: ["ATC"] };
const cfgOff: DispatchConfig = { ...cfgOn, contestGuard: "off" };
const ticket = (key: string) => ({ key, state: "Todo", stateType: "unstarted", priority: 2, project: "Beta Readiness", labels: [] }) as unknown as Ticket;
const tickets = ["ATC-539", "ATC-541", "ATC-545"].map(ticket);
const snap = { tickets, workspaces: [] };

const NAME: Record<string, string> = { a: "TEAM_A", b: "TEAM_B" };
const ac = (id: string) => ({ id, name: NAME[id]!, callsign: id.toUpperCase(), airport: "ATCC", available: true, reason: "PARKED", reserved: null });
const planned = (flight: string, aircraft: string, score: number) => ({ kind: "ASSIGN" as const, flight, aircraft, aircraftName: NAME[aircraft]!, airport: "ATCC", score, factors: [] });
const planOf = (over: Partial<Plan> = {}): Plan => ({ at: iso(T0), assign: [], release: [], hold: [], excluded: [], slots: [], aircraft: [ac("a"), ac("b")], ...over });
const card = (id: string, flight: string, aircraft: string, at: number, score: number): Op => ({ op: "create", id, at: iso(at), kind: "ASSIGN", flight, aircraft, aircraftName: NAME[aircraft]!, airport: "ATCC", score, factors: [] });
const kinds = (ops: Op[]) => ops.map((o) => `${o.op}:${o.id}`);

test("세 카드 순서(10-05 ATC-539): 보호한 카드는 밀려나지 않고 더 높은 FLIGHT는 빈 AIRCRAFT로 가서, ATC-539가 자동 승인된다", () => {
  let ops: Op[] = [];
  // T0: 계획이 ATC-539를 TEAM_A에 준다 → D-0001
  const first = syncOps([], planOf({ assign: [planned("ATC-539", "a", 6)] }), snap, cfgOn, T0, 0);
  ops = [...first];
  assert.deepEqual(kinds(first), ["create:D-0001"]);

  // T0+5분: planner는 ATC-541(9)에 TEAM_A를 주고 ATC-539는 계획에서 빠진다. 카드는 5분 뒤 자리를 잡는다 → 보호
  const t5 = T0 + 5 * MIN;
  const existing5 = fold(ops);
  const guarded = guardedOf(existing5, cfgOn, t5);
  assert.deepEqual([...guarded], ["D-0001"]);
  const naive = planOf({ assign: [planned("ATC-541", "a", 9)] });
  assert.deepEqual(droppedGuardedOf(existing5, naive, guarded).map((p) => p.id), ["D-0001"]);
  // 호출부가 D-0001의 짝을 예약으로 넣고 다시 계획한 결과: ATC-541은 빈 TEAM_B로, ATC-539는 "진행 중인 제안 D-0001"로 제외
  const replanned = planOf({ assign: [planned("ATC-541", "b", 9)], excluded: [{ flight: "ATC-539", reason: "진행 중인 제안 D-0001" }] });
  const ops5 = syncOps(existing5, replanned, snap, cfgOn, t5, 1);
  assert.deepEqual(kinds(ops5), ["create:D-0002"]); // D-0001은 닫히지 않는다
  ops = [...ops, ...ops5];

  // T0+10분: D-0001이 자리를 잡았다. 자동 승인이 받는다(옛 동작은 이 순간에 밀려났다)
  const t10 = T0 + 10 * MIN;
  const existing10 = fold(ops);
  const d1 = existing10.find((p) => p.id === "D-0001")!;
  assert.equal(assignWhyNot(d1, { now: t10, settleMin: 10, dispatchMode: "approval", fuelHold: false, counts: { approved: 0, launched: 0 }, approveMax: 40, live: true }), null);
  const ops10 = syncOps(existing10, replanned, snap, cfgOn, t10, 2);
  assert.deepEqual(kinds(ops10), []); // 이 바퀴도 닫지 않는다
  ops = [...ops, { op: "approve", id: "D-0001", at: iso(t10), via: "auto" }];
  const after = fold(ops);
  assert.equal(after.find((p) => p.id === "D-0001")!.status, "approved");
  assert.equal(after.find((p) => p.id === "D-0001")!.aircraftName, "TEAM_A"); // 쥔 AIRCRAFT와 나이를 그대로
  assert.equal(after.find((p) => p.id === "D-0001")!.at, iso(T0));
  assert.equal(after.filter((p) => p.flight === "ATC-539").length, 1);
});

test("자리 잡은 카드는 더 높은 점수의 경쟁자에도 살아남는다: 빈 AIRCRAFT가 있으면 그쪽으로, 호출부가 다시 계획하지 않았어도 같은 AIRCRAFT에 둘째 카드를 만들지 않는다", () => {
  const existing = fold([card("D-0001", "ATC-539", "a", T0, 6)]);
  const now = T0 + 12 * MIN; // settleMin(10) 지남
  // (b) 다시 계획한 계획: 빈 TEAM_B가 ATC-541을 받는다
  const replanned = planOf({ assign: [planned("ATC-541", "b", 9)], excluded: [{ flight: "ATC-539", reason: "진행 중인 제안 D-0001" }] });
  assert.deepEqual(kinds(syncOps(existing, replanned, snap, cfgOn, now, 1)), ["create:D-0002"]);
  // (a) 다시 계획하지 않은 계획(ATC-541이 TEAM_A, ATC-539는 더 나은 배정으로 빠짐): 닫지도, 같은 AIRCRAFT에 새 카드를 만들지도 않는다
  const naive = planOf({ assign: [planned("ATC-541", "a", 9)] });
  assert.deepEqual(syncOps(existing, naive, snap, cfgOn, now, 1), []);
  // 빈 AIRCRAFT가 없어(계획이 ATC-541을 못 줌) 한 주기 기다린다
  assert.deepEqual(syncOps(existing, planOf({ aircraft: [ac("a")], excluded: [{ flight: "ATC-539", reason: "진행 중인 제안 D-0001" }] }), snap, cfgOn, now, 1), []);
  // 곧 자리를 잡을 카드(5분 뒤에 settle)도 같다
  const young = T0 + 5 * MIN;
  assert.deepEqual(syncOps(existing, naive, snap, cfgOn, young, 1), []);
  // 아직 멀었으면(2분, 다음 주기 5분 뒤에도 7분) 옛 규칙: 더 높은 점수가 대신한다
  const fresh = syncOps(existing, naive, snap, cfgOn, T0 + 2 * MIN, 1);
  assert.deepEqual(kinds(fresh), ["supersede:D-0001", "create:D-0002"]);
});

test("보호가 아닌 카드를 밀어낼 때: 기록(by·gap)을 남기고, 밀려난 FLIGHT의 새 카드는 원래 나이를 이어받는다", () => {
  const existing = fold([card("D-0001", "ATC-539", "a", T0, 6)]);
  const now = T0 + 2 * MIN;
  const plan = planOf({ assign: [planned("ATC-541", "a", 9), planned("ATC-539", "b", 6)] });
  const ops = syncOps(existing, plan, snap, cfgOn, now, 1);
  assert.deepEqual(kinds(ops), ["supersede:D-0001", "create:D-0002", "create:D-0003"]);
  const sup = ops[0] as Extract<Op, { op: "supersede" }>;
  assert.equal(sup.by, "D-0002");
  assert.equal(sup.gap, 3);
  assert.match(sup.reason, new RegExp(`^${BETTER_WHY} — D-0002 \\(6 → 9\\)`));
  const re = ops[2] as Extract<Op, { op: "create" }>;
  assert.equal(re.flight, "ATC-539");
  assert.equal(re.aircraftName, "TEAM_B");
  assert.equal(re.ageFrom, iso(T0)); // 나이를 이어받는다
  const folded = fold([...[card("D-0001", "ATC-539", "a", T0, 6)], ...ops]);
  const d1 = folded.find((p) => p.id === "D-0001")!;
  assert.deepEqual([d1.status, d1.displacedBy, d1.displacedGap], ["superseded", "D-0002", 3]);
  const d3 = folded.find((p) => p.id === "D-0003")!;
  assert.equal(d3.at, iso(T0)); // SETTLED·자동 승인·TTL이 세는 시각
  assert.equal(d3.timeline.proposed, iso(now)); // 기록 시각은 그대로
  assert.ok(!("ageFrom" in d3));
  // 다음 바퀴(밀려난 지 얼마 안 됨)에 같은 FLIGHT의 카드가 새로 생겨도 이어받는다
  const later = fold([...[card("D-0001", "ATC-539", "a", T0, 6)], { op: "supersede", id: "D-0001", at: iso(now), reason: `${BETTER_WHY} — D-0002 (6 → 9)`, by: "D-0002", gap: 3 }]);
  const next = syncOps(later, planOf({ assign: [planned("ATC-539", "b", 6)] }), snap, cfgOn, now + 5 * MIN, 5);
  assert.equal((next.find((o) => o.op === "create") as Extract<Op, { op: "create" }>).ageFrom, iso(T0));
  // 밀려난 지 30분이 지난 FLIGHT는 이어받지 않는다
  const stale = syncOps(later, planOf({ assign: [planned("ATC-539", "b", 6)] }), snap, cfgOn, now + 40 * MIN, 5);
  assert.equal((stale.find((o) => o.op === "create") as Extract<Op, { op: "create" }>).ageFrom, undefined);
});

test("24시간에 두 번 밀려난 FLIGHT는 세 번째로 밀지 않는다", () => {
  const displaced = (id: string, byId: string, at: number): Op[] => [
    card(id, "ATC-539", "a", at - 8 * MIN, 6),
    { op: "supersede", id, at: iso(at), reason: `${BETTER_WHY} — ${byId} (6 → 9)`, by: byId, gap: 3 },
  ];
  const now = T0 + 60 * MIN;
  const naive = planOf({ assign: [planned("ATC-541", "a", 9)] });
  const two = fold([...displaced("D-0001", "D-0090", T0), ...displaced("D-0002", "D-0091", T0 + 20 * MIN), card("D-0003", "ATC-539", "a", now - 1 * MIN, 6)]);
  assert.equal(displacedCountOf(two, "ATC-539", now), DISPLACE_MAX_24H);
  // 방금 만든 카드(1분)인데도 보호된다
  assert.deepEqual([...guardedOf(two, cfgOn, now)], ["D-0003"]);
  assert.deepEqual(syncOps(two, naive, snap, cfgOn, now, 10), []);
  // 한 번만 밀려났으면 이번엔 밀린다(둘째 밀림)
  const one = fold([...displaced("D-0001", "D-0090", T0), card("D-0003", "ATC-539", "a", now - 1 * MIN, 6)]);
  assert.deepEqual(kinds(syncOps(one, naive, snap, cfgOn, now, 10)), ["supersede:D-0003", "create:D-0011"]);
  // 24시간이 지난 밀림은 세지 않는다
  assert.equal(displacedCountOf(two, "ATC-539", T0 + 25 * 60 * MIN), 0);
});

test("스위치 off: 옛 supersede를 그대로 낸다(자리 잡은 카드도 밀고, by·gap·나이 이어받기 없음)", () => {
  const existing = fold([card("D-0001", "ATC-539", "a", T0, 6)]);
  const now = T0 + 12 * MIN;
  assert.deepEqual([...guardedOf(existing, cfgOff, now)], []);
  const plan = planOf({ assign: [planned("ATC-541", "a", 9), planned("ATC-539", "b", 6)] });
  const ops = syncOps(existing, plan, snap, cfgOff, now, 1);
  assert.deepEqual(ops[0], { op: "supersede", id: "D-0001", at: iso(now), reason: `${BETTER_WHY} — D-0002 (6 → 9)` });
  assert.deepEqual(kinds(ops), ["supersede:D-0001", "create:D-0002", "create:D-0003"]);
  assert.ok(ops.every((o) => !("ageFrom" in o) && !("by" in o)));
  // 밀린 횟수 한도도 켜지 않는다
  const two = fold([card("D-0001", "ATC-539", "a", T0, 6), { op: "supersede", id: "D-0001", at: iso(T0 + MIN), reason: BETTER_WHY, by: "D-9", gap: 1 }, card("D-0002", "ATC-539", "a", T0, 6), { op: "supersede", id: "D-0002", at: iso(T0 + MIN), reason: BETTER_WHY, by: "D-8", gap: 1 }]);
  assert.deepEqual([...guardedOf(two, cfgOff, T0 + 2 * MIN)], []);
});

test("수동 운항(autoDispatch off)에서는 자리 잡았다는 이유로 보호하지 않는다(사람이 판정하는 카드), 밀린 횟수 한도만 켜져 있다", () => {
  const existing = fold([card("D-0001", "ATC-539", "a", T0, 6)]);
  assert.deepEqual([...guardedOf(existing, { ...cfgOn, autoDispatch: "off" }, T0 + 30 * MIN)], []);
});

test("MISFIRE 셈: 밀려난 카드는 밀려난 날에 세고, 밀어낸 카드가 SUPERSEDED·EXPIRED로 닫혔으면 misfire", () => {
  const now = Date.parse("2026-10-05T12:00:00.000Z");
  const day = (h: number) => iso(Date.parse("2026-10-05T00:00:00.000Z") + h * 3_600_000);
  const base = (id: string, status: string, at: string, extra: Record<string, unknown> = {}) => ({ id, kind: "ASSIGN" as const, status, via: undefined, reason: null, timeline: {}, statusAt: at, flight: "ATC-539", ...extra }) as never;
  const view = misfireView(
    [
      base("D-1", "superseded", day(7), { displacedBy: "D-2", displacedGap: 3 }),
      base("D-2", "superseded", day(8)), // 밀어낸 카드가 또 밀림 → misfire
      base("D-3", "superseded", day(9), { displacedBy: "D-4", displacedGap: 2 }),
      base("D-4", "proposed", day(9)), // 아직 열려 있다 → misfire 아님
      base("D-5", "superseded", day(10), { displacedBy: "D-6", displacedGap: 2 }),
      base("D-6", "expired", day(11)), // 밀어낸 카드가 만료됨 → misfire
    ],
    now,
    2,
  );
  assert.equal(view.today.displaced, 3);
  assert.equal(view.today.displacedMisfires, 2);
  assert.equal(view.total.displaced, 3);
  assert.equal(view.total.displacedMisfires, 2);
  assert.equal(view.daily[0]!.displaced, 0);
  assert.equal(displacementMisfire(undefined), false);
});

test("설정 contestGuard: 기본 on, 파일에 off라고 적었을 때만 끈다, 저장은 다른 설정을 지키고 원자적으로 쓴다", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-cg-"));
  const file = join(dir, "dispatch.json");
  assert.equal(loadDispatchConfig(file).contestGuard, "on"); // 파일 없음
  writeFileSync(file, JSON.stringify({ settleMin: 7 }));
  assert.equal(loadDispatchConfig(file).contestGuard, "on");
  saveContestGuard("off", file);
  const saved = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual([saved.contestGuard, saved.settleMin], ["off", 7]);
  assert.equal(loadDispatchConfig(file).contestGuard, "off");
  writeFileSync(file, JSON.stringify({ contestGuard: "weird" }));
  assert.equal(loadDispatchConfig(file).contestGuard, "on");
});

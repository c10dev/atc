import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { emptyEnds, endsTrackable, endsView, firstSeenOf, REAPPEAR_WINDOW_MS, trackEnds } from "./alert-ends.ts";
import { appendReappeared, loadEnds, readReappeared, saveEnds } from "./alert-ends-run.ts";
import { followingOf, type FollowInput } from "./following.ts";
import type { Ticket } from "./model.ts";
import type { Proposal } from "./proposals.ts";
import { type AlertsInput, alertKeyOf, CLEANUP_KEY, supervisorAlertsOf, UNOWNED_AFTER_MS } from "./supervisor-alerts.ts";

// 알림은 원인이 끝나면 끝난다(ATC-385): 주인 없는 조건의 정리 줄, 돌아옴 카운터, CAUTION 전후
const NOW = Date.parse("2026-10-02T12:00:00.000Z");
const H = 3_600_000;
const base = (over: Partial<AlertsInput> = {}): AlertsInput => ({ sessions: [], alerts: [], workspaces: [], tickets: [], following: [], proposals: [], pulls: [], rts: null, ...over });

const unattended = (path: string) => ({ kind: "unattended" as const, message: "주인 없는 변경 3개", workspacePath: path });
const orphan = (path: string, sid: string) => ({ kind: "orphan" as const, message: "종료된 세션 TEAM_X 의 점유가 남아 있음", workspacePath: path, sessionIds: [sid] });
const sessions = [{ id: "s1", name: "TEAM_X", status: "dead", health: null }] as unknown as AlertsInput["sessions"];

test("주인 없는 조건: 오래 그대로면 CAUTION 수에서 빠지고 정리 줄 하나(개수)로 접힌다. 아직이면 그대로", () => {
  const alerts = [unattended("/ws/a"), unattended("/ws/b"), orphan("/ws/c", "s1")];
  const [ka, kb, kc] = alerts.map(alertKeyOf);
  const caution = (xs: { level: string | null }[]) => xs.filter((x) => x.level === "caution").length;
  // 규칙 없이: 셋 다 CAUTION(orphan은 STAND의 FLIGHT를 모르니 CAUTION)
  assert.equal(caution(supervisorAlertsOf(base({ alerts, sessions }))), 3);
  // 처음 본 지 6시간 안: 그대로
  const fresh = new Map([[ka, NOW - 1 * H], [kb, NOW - 5 * H], [kc, NOW - 1 * H]]);
  assert.equal(caution(supervisorAlertsOf(base({ alerts, sessions, unowned: { now: NOW, since: fresh } }))), 3);
  // 둘이 6시간을 넘음: 둘은 접히고 하나만 CAUTION으로 남는다
  const ended: { key: string; rule: string }[] = [];
  const since = new Map([[ka, NOW - UNOWNED_AFTER_MS], [kb, NOW - 7 * H], [kc, NOW - 1 * H]]);
  const out = supervisorAlertsOf(base({ alerts, sessions, unowned: { now: NOW, since, ended: ended as never } }));
  assert.equal(caution(out), 1);
  assert.deepEqual(out.map((a) => a.key), [kc, CLEANUP_KEY]);
  const line = out.find((a) => a.key === CLEANUP_KEY)!;
  assert.equal(line.level, "advisory");
  assert.equal(line.dest, "alerts");
  assert.match(line.text, /정리 대기 2건 — 주인 없는 변경 2곳, 종료된 세션의 점유 0곳/);
  assert.match(line.next, /지우지 않는다/); // 변경은 자동으로 지우지 않는다
  assert.deepEqual(ended.map((e) => [e.key, e.rule]), [[ka, "unowned-stale"], [kb, "unowned-stale"]]);
  // 개수가 바뀌어도 줄의 key는 하나라 같은 알림이다
  assert.equal(supervisorAlertsOf(base({ alerts: alerts.slice(0, 1), unowned: { now: NOW, since } })).at(-1)!.key, CLEANUP_KEY);
});

test("주인 없는 조건: 처음 본 시각은 이어지고, 사라졌다 돌아오면 새로 센다", () => {
  const a = firstSeenOf({}, ["k1"], NOW);
  assert.deepEqual(a, { k1: NOW });
  const b = firstSeenOf(a, ["k1", "k2"], NOW + H);
  assert.deepEqual(b, { k1: NOW, k2: NOW + H });
  const c = firstSeenOf(b, ["k2"], NOW + 2 * H); // k1이 사라짐
  assert.deepEqual(c, { k2: NOW + H });
  assert.deepEqual(firstSeenOf(c, ["k1", "k2"], NOW + 3 * H), { k1: NOW + 3 * H, k2: NOW + H });
});

test("돌아옴 카운터: 끝 규칙이 뺀 알림이 24시간 안에 다시 나오면 세고, 한 번만 센다", () => {
  const rule = "flight-closed" as const;
  let r = trackEnds(emptyEnds(), [{ key: "following|ATC-1|unable|C-1", rule: "unable-readback" }, { key: "following|ATC-2|no-pr", rule }], new Set(), NOW);
  assert.deepEqual(Object.keys(r.state.cleared).sort(), ["following|ATC-1|unable|C-1", "following|ATC-2|no-pr"]);
  assert.deepEqual(r.reappeared, []);
  // 계속 빠져 있으면(매 주기 ended에 오른다) 처음 뺀 시각을 유지한다
  const later = trackEnds(r.state, [{ key: "following|ATC-2|no-pr", rule }], new Set(), NOW + H);
  assert.equal(later.state.cleared["following|ATC-2|no-pr"].at, NOW);
  // 3시간 뒤 ATC-1의 UNABLE이 다시 나옴: 돌아옴 하나
  r = trackEnds(later.state, [], new Set(["following|ATC-1|unable|C-1"]), NOW + 3 * H);
  assert.deepEqual(r.reappeared.map((x) => [x.key, x.rule, x.clearedAt]), [["following|ATC-1|unable|C-1", "unable-readback", new Date(NOW).toISOString()]]);
  assert.ok(!("following|ATC-1|unable|C-1" in r.state.cleared), "한 번만 센다");
  // 계속 있으면 다시 세지 않는다
  assert.deepEqual(trackEnds(r.state, [], new Set(["following|ATC-1|unable|C-1"]), NOW + 4 * H).reappeared, []);
  // 24시간이 지나 돌아오면 세지 않는다(기록을 버린 뒤)
  const old = trackEnds(later.state, [], new Set(["following|ATC-2|no-pr"]), NOW + REAPPEAR_WINDOW_MS + 1);
  assert.deepEqual(old.reappeared, []);
  assert.deepEqual(old.state.cleared, {});
  // 규칙이 빼는 같은 주기에 알림에도 있으면(다른 경로가 같은 key를 냄) 뺀 것으로 치지 않는다
  assert.deepEqual(trackEnds(emptyEnds(), [{ key: "k", rule }], new Set(["k"]), NOW).state.cleared, {});
});

test("돌아옴 카운터: 규칙별 24시간 요약", () => {
  const first = trackEnds(emptyEnds(), [{ key: "a", rule: "unable-pr-gone" }, { key: "b", rule: "unable-pr-gone" }, { key: "c", rule: "flight-closed" }], new Set(), NOW);
  const back = trackEnds(first.state, [], new Set(["a"]), NOW + H);
  const v = endsView(back.state, back.reappeared, NOW + 2 * H);
  assert.deepEqual(v.rules, [
    { rule: "flight-closed", ended: 1, reappeared: 0 },
    { rule: "unable-pr-gone", ended: 2, reappeared: 1 }, // a(돌아옴)와 b(아직 빠져 있음)
  ]);
  assert.equal(v.windowHours, 24);
});

test("끝 규칙 기록: 임시 폴더에 상태를 바꿔 쓰고 돌아옴 줄만 더한다", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-ends-"));
  try {
    assert.deepEqual(loadEnds(join(dir, "none.json")), emptyEnds());
    const f = join(dir, "s", "alert-ends.json");
    saveEnds({ firstSeen: { k: 1 }, cleared: { x: { at: 2, rule: "flight-closed" } } }, f);
    assert.deepEqual(loadEnds(f), { firstSeen: { k: 1 }, cleared: { x: { at: 2, rule: "flight-closed" } } });
    const l = join(dir, "s", "r.jsonl");
    assert.deepEqual(readReappeared(l), []);
    appendReappeared([{ t: "2026-10-02T00:00:00Z", key: "x", rule: "flight-closed", clearedAt: "2026-10-01T00:00:00Z" }], l);
    appendReappeared([], l);
    assert.equal(readReappeared(l).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 같은 상태에서 CAUTION 수 전후(PR 본문에 쓰는 숫자) ──
const MIN = 60_000;
const ago = (min: number) => new Date(NOW - min * MIN).toISOString();
const ticket = (key: string, over: Partial<Ticket> = {}): Ticket =>
  ({ key, title: key, state: "In Progress", stateType: "started", stateColor: null, priority: 2, url: "", updatedAt: ago(30), project: "p", labels: ["type:BUILD", "wake:M"], createdAt: ago(1000), startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [], assignee: null, takenBy: null, ...over }) as Ticket;
const proposal = (id: string, flight: string, status: Proposal["status"], timeline: Proposal["timeline"]): Proposal =>
  ({ id, at: ago(2000), kind: "ASSIGN", flight, aircraft: "b", aircraftName: "TEAM_B", airport: "A", score: 1, factors: [], status, decidedAt: null, statusAt: ago(10), timeline, reason: null, note: null, caution: false, hold: [], holdAt: null, message: null, departedStand: null, crosscheck: null }) as Proposal;

test("CAUTION 전후: 같은 상태를 규칙 없이/있이 세어 비교한다", () => {
  const tickets = [
    ticket("ATC-1", { state: "Done", stateType: "completed" }), // 닫힌 FLIGHT: READBACK 뒤 오래 착수 없음(no-departure)과 머지 없는 Done(done-not-merged)
    ticket("ATC-2", { state: "Canceled", stateType: "canceled" }), // 닫힌 FLIGHT: UNABLE
    ticket("ATC-3"), // 열린 FLIGHT: UNABLE이 아직 유효
    ticket("ATC-5"), // 열린 FLIGHT: 오래 착수 없음(그대로 CAUTION)
  ];
  const proposals = [proposal("D-1", "ATC-1", "accepted", { accepted: ago(400) }), proposal("D-5", "ATC-5", "accepted", { accepted: ago(400) })];
  const unables = [
    { flight: "ATC-2", id: "C-2", aircraft: "TEAM_B", reason: "x", at: ago(5) },
    { flight: "ATC-3", id: "C-3", aircraft: "TEAM_B", reason: "x", at: ago(5), pr: 30 },
  ];
  const input = (endRules: boolean): FollowInput => ({ proposals, tickets, workspaces: [], pulls: [], logbook: [], departures: [], now: NOW, unables, endRules });
  const alerts = [unattended("/ws/a"), unattended("/ws/b"), orphan("/ws/c", "s1")];
  const since = new Map(alerts.map((a, i) => [alertKeyOf(a), NOW - (i === 2 ? 1 : 8) * H] as const)); // 둘은 8시간째, 하나는 1시간째
  const count = (endRules: boolean) => {
    const out = supervisorAlertsOf(base({ alerts, sessions, following: followingOf(input(endRules)), ...(endRules ? { unowned: { now: NOW, since } } : {}) }));
    return out.filter((a) => a.level === "caution").length;
  };
  const before = count(false);
  const after = count(true);
  // 전: ATC-1 둘(no-departure·done-not-merged) + ATC-5 no-departure + UNABLE 둘(ATC-2·3) + 주인 없는 셋 = 8
  // 후: ATC-5 no-departure + ATC-3의 UNABLE + 주인 없는 하나(1시간째) = 3
  assert.deepEqual([before, after], [8, 3]);
});

test("끝 규칙 기록: Linear를 아직 못 읽은 주기(RTS 재시작 직후)는 기록하지 않아 거짓 돌아옴을 세지 않는다", () => {
  const s = (enabled: boolean, fetchedAt: string | null) => ({ linear: { enabled, fetchedAt } });
  assert.equal(endsTrackable(s(true, null)), false);
  assert.equal(endsTrackable(s(true, "2026-10-02T12:00:00Z")), true);
  assert.equal(endsTrackable(s(false, null)), true, "꺼져 있으면 기다릴 것이 없다");
  // 기록하지 않는 주기에는 trackEnds를 부르지 않으므로, 뺀 기록은 그대로이고 돌아옴은 0이다. 읽힌 뒤 닫힌 FLIGHT가 다시 빠지면 이어서 센다
  const first = trackEnds(emptyEnds(), [{ key: "following|ATC-1|unable|C-1", rule: "flight-closed" }], new Set(), NOW);
  const after = trackEnds(first.state, [{ key: "following|ATC-1|unable|C-1", rule: "flight-closed" }], new Set(), NOW + H);
  assert.deepEqual(after.reappeared, []);
  assert.equal(after.state.cleared["following|ATC-1|unable|C-1"].at, NOW);
});

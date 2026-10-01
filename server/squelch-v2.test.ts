import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Hono } from "hono";
import { config } from "./config.ts";
import { changedFields, fingerprint, project, projectV2, stripDurations } from "./squelch.ts";
import { mountSquelch } from "./squelch-run.ts";

// ATC-297: 지문 v2와 바뀐 필드. 시험은 임시 상태 폴더에서 돈다(진짜 ~/.local/state/atc는 읽지도 쓰지도 않는다)
const dir = mkdtempSync(join(tmpdir(), "squelch-v2-"));
config.stateDir = dir;
after(() => rmSync(dir, { recursive: true, force: true }));
const file = (n: string) => join(dir, n);
const lines = () => (existsSync(file("squelch.jsonl")) ? readFileSync(file("squelch.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const reset = () => {
  rmSync(file("squelch.json"), { force: true });
  rmSync(file("squelch.jsonl"), { force: true });
};

// 실제 TOWER 브리핑 모양(필요한 필드만)
const emptyOpen = { conflicts: [], orphans: [], unattended: [], noContact: [], health: [], healthAlerts: [], fuel: [], fuelLeaks: [], coldCache: [], stranded: [] };
const tower = (over: Record<string, unknown> = {}, open: Record<string, unknown> = {}) => ({
  reset: false,
  events: [],
  landingQueue: [],
  open: { ...emptyOpen, ...open },
  groundStops: [],
  clearances: { pending: [], overdue: [] },
  ...over,
});
const alertOf = (min: number) => ({ message: `BLOCKED — TOWER이 ${min}분째 사람을 기다림: TEAM_O: approve (2h07m)`, sessions: [{ name: "TOWER" }] });

function towerApp(box: { brief: unknown }) {
  const app = new Hono();
  mountSquelch(app, { get: async () => box.brief, manual: async () => false });
  return () => app.request("/api/squelch/tower", { method: "POST" });
}
const setConfig = (fp: "v1" | "v2", mode: "on" | "shadow" = "on") =>
  writeFileSync(file("squelch.json"), JSON.stringify({ ...JSON.parse(readFileSync(file("squelch.json"), "utf8")), config: { mode, heartbeatMin: { tower: 50 }, fingerprint: { tower: fp } } }));

test("stripDurations: 기간 표현만 지운다(5분째, 2h07m, 24분), 번호와 이름은 그대로", () => {
  assert.equal(stripDurations("BLOCKED — TEAM_N이 24분째 기다림: approve PR #429 (2h07m)"), "BLOCKED — TEAM_N이 N분째 기다림: approve PR #429 (Nh)");
  assert.equal(stripDurations("PENDING approval 2h07m"), "PENDING approval Nh");
  assert.equal(stripDurations("THROTTLE 45m"), "THROTTLE Nm");
  assert.equal(stripDurations("no durations"), "no durations");
});

test("changedFields: 바뀐 필드 경로만(값 없음). 객체의 배열은 a[].b로 합치고, 순서만 다르면 같다", () => {
  const a = { x: 1, list: [{ k: "a", v: 1 }, { k: "b", v: 2 }], names: ["p", "q"], gone: 1 };
  const b = { x: 1, list: [{ k: "b", v: 2 }, { k: "a", v: 1 }], names: ["q", "p"], added: 2 };
  assert.deepEqual(changedFields(a, b), ["added", "gone"]);
  assert.deepEqual(changedFields({ q: [{ head: "a1" }] }, { q: [{ head: "b2" }] }), ["q[].head"]);
  assert.deepEqual(changedFields({ ids: [] }, { ids: ["x"] }), ["ids[]"]);
  assert.deepEqual(changedFields({ a: 1 }, { a: 1 }), []);
  assert.deepEqual(changedFields(null, { a: 1 }), ["a"]);
  assert.ok(!JSON.stringify(changedFields({ secret: "VALUE" }, { secret: "OTHER" })).includes("VALUE"));
  assert.equal(changedFields(Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i])), {}).length, 30); // 상한
});

test("projectV2(tower): handoff·away 사건, info 건강 상태, 경보의 기간은 지문을 바꾸지 않고, 할 일인 변화는 바꾼다", () => {
  const fp2 = (b: unknown) => fingerprint(projectV2("tower", { brief: b }));
  const fp1 = (b: unknown) => fingerprint(project("tower", { brief: b }));
  const base = tower();
  for (const quiet of [
    tower({ events: [{ id: 1, kind: "handoff" }] }),
    tower({ events: [{ id: 2, kind: "away.started" }, { id: 3, kind: "away.ended" }] }),
    tower({}, { health: [{ name: "TEAM_O", code: "PENDING", level: "info", since: "2026-10-01T04:07:58Z" }] }),
  ]) {
    assert.notEqual(fp1(quiet), fp1(base)); // v1은 바뀐다
    assert.equal(fp2(quiet), fp2(base)); // v2는 같다
  }
  const alert = (min: number) => tower({}, { healthAlerts: [{ message: `BLOCKED — TOWER이 ${min}분째 기다림` }] });
  assert.notEqual(fp1(alert(5)), fp1(alert(6)));
  assert.equal(fp2(alert(5)), fp2(alert(6)));
  for (const act of [
    tower({ events: [{ id: 4, kind: "landing.cleared" }] }),
    tower({ events: [{ id: 5, kind: "groundstop.started" }] }),
    tower({}, { health: [{ name: "TEAM_O", code: "HUNG", level: "alert", since: "x" }] }),
    tower({ clearances: { pending: [], overdue: ["C-0001"] } }),
    tower({ landingQueue: [{ airport: "ATCC", pr: { number: 1, head: "abc" }, landing: "APPROACH", blocks: [], fix: { action: "send" } }] }), // ATC-270: 같은 head에서 지시가 생기는 경우도 v1이 못 본다
    tower({ landingQueue: [{ airport: "ATCC", pr: { number: 1, head: "abc" }, landing: "APPROACH", blocks: [], info: { action: "supervisor" } }] }),
    tower({ landingQueue: [{ airport: "ATCC", pr: { number: 1, head: "abc" }, landing: "CLEARED", blocks: [] }] }),
  ]) assert.notEqual(fp2(act), fp2(base)); // 할 일은 v2도 바뀐다
  // 다른 역할은 v1 그대로
  const rv = { reviews: { pending: [{ pr: "atc#1", head: "a" }] } };
  for (const role of ["mcc", "occ", "crosscheck", "review"] as const) assert.equal(fingerprint(projectV2(role, rv)), fingerprint(project(role, rv)));
});

test("v2 그림자: 분마다 바뀌는 경보는 v1이 열고 v2는 QUIET(would: quiet), 바뀐 필드는 경로만 적힌다", async () => {
  reset();
  const box = { brief: tower({}, { healthAlerts: [alertOf(5)] }) as unknown };
  const post = towerApp(box);
  await post();
  box.brief = tower({}, { healthAlerts: [alertOf(6)] });
  await post();
  const l = lines();
  assert.equal(l[1].reason, "shadow:signal"); // v1은 분이 바뀐 것을 신호로 본다
  assert.equal(l[1].would, "quiet"); // v2는 기간을 지워 같은 경보로 본다
  assert.equal(l[1].fingerprint, "v1");
  assert.deepEqual(l[1].fields, ["open.healthAlerts[]"]); // 경로만, 값 없음
  assert.equal(l[1].fields2, undefined);
  assert.equal(JSON.stringify(l).includes("TEAM_O"), false); // 본문은 로그에 없다
});

test("v2는 진짜 신호에는 열린다: would: open과 fields2", async () => {
  reset();
  const box = { brief: tower() as unknown };
  const post = towerApp(box);
  await post();
  box.brief = tower({ events: [{ id: 7, kind: "landing.cleared" }] }, { healthAlerts: [{ message: "NETWORK — 새 경보", sessions: [] }] });
  await post();
  const l = lines()[1];
  assert.equal(l.would, "open");
  assert.deepEqual(l.fields, ["events[]", "open.healthAlerts[]"]);
  assert.deepEqual(l.fields2, ["events[]", "open.healthAlerts[]"]);
});

test("config.fingerprint가 v2인 역할만 v2가 판정한다: on에서 v1이 열 변화를 v2는 버리고, 진짜 변화는 연다. 기본(v1)은 그대로 연다", async () => {
  reset();
  const box = { brief: tower({}, { healthAlerts: [alertOf(5)] }) as unknown };
  const post = towerApp(box);
  await post(); // shadow:first
  setConfig("v1");
  box.brief = tower({}, { healthAlerts: [alertOf(6)] });
  assert.equal((await (await post()).json()).open, true); // v1: 신호로 연다
  setConfig("v2");
  box.brief = tower({}, { healthAlerts: [alertOf(7)] });
  const q = await (await post()).json();
  assert.equal(q.open, false); // v2: 기간만 바뀌었으니 QUIET
  assert.equal(q.reason, "quiet");
  const last = lines().at(-1);
  assert.equal(last.fingerprint, "v2");
  assert.equal(last.open, false);
  box.brief = tower({ events: [{ id: 9, kind: "landing.blocked" }] }, { healthAlerts: [alertOf(8)] });
  assert.equal((await (await post()).json()).open, true); // 진짜 변화는 v2도 연다
});

test("v2가 실패하면 v1로 판정하고(config가 v2여도 막지 않는다), v1이 실패하면 열린다", async () => {
  reset();
  const poisoned = tower({ events: [{ id: 1, get kind(): string { throw new Error("v2만 읽는 필드"); } }] });
  const post = towerApp({ brief: poisoned });
  await post();
  setConfig("v2");
  const r = await (await post()).json();
  assert.equal(r.open, false); // v1 지문이 같아 QUIET: v2는 계산에 실패했으니 v1이 정했다
  const last = lines().at(-1);
  assert.equal(last.fingerprint, "v1");
  assert.equal(last.fp2, undefined);
  assert.equal(last.would, undefined);
  // v1 쪽 실패: 브리핑을 못 가져오면 fail-open
  const app = new Hono();
  mountSquelch(app, {
    get: async () => {
      throw new Error("서버 내부 오류");
    },
    manual: async () => false,
  });
  const f = await (await app.request("/api/squelch/tower", { method: "POST" })).json();
  assert.equal(f.open, true);
  assert.equal(f.reason, "fail-open");
});

test("GET /api/squelch는 지난 통과의 투영(proj)을 내보내지 않는다", async () => {
  reset();
  const app = new Hono();
  mountSquelch(app, { get: async () => ({ pending: [{ pr: "atc#150", head: "abc" }], excluded: [], recent: [] }), manual: async () => false });
  await app.request("/api/squelch/review", { method: "POST" });
  const body = await (await app.request("/api/squelch")).json();
  assert.equal(body.roles.review.proj, undefined);
  assert.equal(body.roles.review.v2.proj, undefined);
  assert.ok(body.roles.review.v2.fp);
  assert.deepEqual(Object.keys(body.config).sort(), ["fingerprint", "heartbeatMin", "mode"]);
});

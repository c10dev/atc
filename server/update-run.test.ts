import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Hono } from "hono";
import { config } from "./config.ts";
import { mountMcc, rtsGuard } from "./mcc-run.ts";
import { rtsUnitGuard, saveMcc } from "./mcc.ts";
import type { Snapshot } from "./model.ts";
import { loadPlanRts, mountUpdate, type UpdateDeps } from "./update-run.ts";

// 시험은 임시 상태 폴더와 7702에서 돈다. 실제 atc-rts 유닛은 절대 시작하지 않는다(startUnit은 항상 스텁)
const dir = mkdtempSync(join(tmpdir(), "update-"));
config.stateDir = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const A = "c0ca22e" + "0".repeat(33);
const B = "4678e03" + "0".repeat(33);
const snap = (sha: string, state = "success") =>
  ({
    airports: [{ code: "ATCC", repo: "atc" }],
    atfm: { mains: [{ repo: "atc", slug: "o/atc", sha, state, branch: "main" }], groundStops: [] },
    pulls: [],
  }) as unknown as Snapshot;

const planRts: UpdateDeps["planRts"] = loadPlanRts;
function setup(over: Partial<UpdateDeps> = {}, s = snap(B)) {
  const calls = { start: 0, compare: 0 };
  const deps: UpdateDeps = {
    startUnit: async () => void calls.start++,
    guard: () => null,
    compare: async () => (calls.compare++, { prs: [{ number: 2, title: "Two" }], files: ["server/a.ts"] }),
    planRts,
    now: Date.now,
    ...over,
  };
  const app = new Hono();
  mountUpdate(app, async () => s, () => A, deps);
  return { app, calls };
}
const post = (app: Hono) => app.request("/api/update/start", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:7702" }, body: "{}" });
const mccLines = () => (existsSync(join(config.stateDir, "mcc.jsonl")) ? readFileSync(join(config.stateDir, "mcc.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);

test("시험 서버 규칙: 임시 상태 폴더나 7700이 아닌 포트는 유닛을 시작하지 못한다", () => {
  const real = "/home/x/.local/state/atc";
  assert.equal(rtsUnitGuard({ stateDir: real, port: 7700, realStateDir: real }), null);
  assert.match(rtsUnitGuard({ stateDir: real, port: 7702, realStateDir: real })!, /포트 7702/);
  assert.match(rtsUnitGuard({ stateDir: "/tmp/atc-test", port: 7700, realStateDir: real })!, /임시 상태 폴더/);
  // 이 시험 프로세스 자체(임시 상태 폴더)가 막힌다
  assert.match(rtsGuard()!, /atc-rts를 시작하지 않음/);
});

test("상태: 뒤처진 범위의 PR과 available", async () => {
  const { app } = setup();
  const s = await (await app.request("/api/update")).json();
  assert.equal(s.kind, "available");
  assert.equal(s.deployed, A);
  assert.equal(s.main, B);
  assert.deepEqual(s.prs, [{ number: 2, title: "Two" }]);
});

test("상태: 범위가 package.json을 바꾸면 manual, 사유 포함. 범위는 한 번만 읽는다", async () => {
  const { app, calls } = setup({ compare: async () => ({ prs: [], files: ["package.json"] }) });
  const s = await (await app.request("/api/update")).json();
  assert.equal(s.kind, "manual");
  assert.match(s.refusal, /package\.json/);
  await app.request("/api/update");
  const { app: app2, calls: c2 } = setup();
  await app2.request("/api/update");
  await app2.request("/api/update");
  assert.equal(c2.compare, 1);
  void calls;
});

test("시작: 임시 상태 폴더의 서버는 거절하고 유닛을 시작하지 않는다(실제 guard)", async () => {
  const { app, calls } = setup({ guard: rtsGuard });
  const r = await post(app);
  assert.equal(r.status, 409);
  assert.match((await r.json()).why, /시작하지 않음/);
  assert.equal(calls.start, 0);
  assert.deepEqual(mccLines(), []);
});

test("시작: 이 화면 Origin이 아니면 403", async () => {
  const { app, calls } = setup();
  const r = await app.request("/api/update/start", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(r.status, 403);
  assert.equal(calls.start, 0);
});

test("시작: 조건이 맞으면 유닛(스텁)을 시작하고 by supervisor로 기록, 5분 안 두 번째는 거절", async () => {
  const { app, calls } = setup();
  const r = await post(app);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).started, true);
  assert.equal(calls.start, 1);
  const [rec] = mccLines();
  assert.equal(rec.op, "rts");
  assert.equal(rec.by, "supervisor");
  assert.equal(rec.result, "started");
  assert.equal(rec.model, undefined);
  const again = await post(app);
  assert.equal(again.status, 409);
  assert.match((await again.json()).why, /5분/);
  assert.equal(calls.start, 1);
  assert.equal((await (await app.request("/api/update")).json()).kind, "starting");
});

test("/api/mcc/rts도 같은 규칙: land+rts여도 임시 상태 폴더의 서버는 유닛을 시작하지 않는다", async () => {
  config.stateDir = mkdtempSync(join(tmpdir(), "update-mcc-")); // 앞 시험의 시작 기록(5분 간격)이 섞이지 않게
  after(() => rmSync(config.stateDir, { recursive: true, force: true }));
  saveMcc({ mode: "land+rts", airport: "ATCC", ciCheck: "check", holds: [] });
  const app = new Hono();
  mountMcc(app, async () => snap(B), () => A);
  const r = await app.request("/api/mcc/rts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "claude-opus-5-5" }) });
  assert.equal(r.status, 409);
  const body = await r.json();
  assert.equal(body.started, false);
  assert.match(body.why, /시작하지 않음/);
  assert.deepEqual(mccLines(), []);
});

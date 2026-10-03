import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Hono } from "hono";
import { config } from "./config.ts";
import { mountMcc, rtsGuard } from "./mcc-run.ts";
import { RTS_FILE, rtsUnitGuard, saveMcc } from "./mcc.ts";
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
    checkout: async () => null,
    now: Date.now,
    ...over,
  };
  const app = new Hono();
  const { pass } = mountUpdate(app, async () => s, () => A, deps);
  return { app, calls, pass };
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

test("시작: 조건이 맞으면 유닛(스텁)을 시작하고 by supervisor로 기록, 결과 전 두 번째는 거절, 끝난 뒤엔 5분 안이어도 다시 됨", async () => {
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
  assert.match((await again.json()).why, /시작함/);
  assert.equal(calls.start, 1);
  assert.equal((await (await app.request("/api/update")).json()).kind, "starting");
  // 유닛이 결과를 남기면(여기서는 다른 main을 향한 ok) 5분이 안 지났어도 SUPERVISOR는 다시 시작할 수 있다
  appendFileSync(RTS_FILE(), JSON.stringify({ at: new Date(Date.now() + 1000).toISOString(), from: A, to: "c".repeat(40), result: "ok", detail: "1초" }) + "\n");
  const third = await post(app);
  assert.equal(third.status, 200);
  assert.equal(calls.start, 2);
});

test("/api/mcc/rts도 같은 규칙: land+rts여도 임시 상태 폴더의 서버는 유닛을 시작하지 않는다", async () => {
  config.stateDir = mkdtempSync(join(tmpdir(), "update-mcc-")); // 앞 시험의 시작·RTS 기록이 섞이지 않게
  after(() => rmSync(config.stateDir, { recursive: true, force: true }));
  saveMcc({ mode: "land+rts", airport: "ATCC", ciCheck: "check", holds: [], kApproval: "on", removalGuard: "on" });
  const app = new Hono();
  mountMcc(app, async () => snap(B), () => A);
  const r = await app.request("/api/mcc/rts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "claude-opus-5-5" }) });
  assert.equal(r.status, 409);
  const body = await r.json();
  assert.equal(body.started, false);
  assert.match(body.why, /시작하지 않음/);
  assert.deepEqual(mccLines(), []);
});

// ── 서버의 자동 RTS(ATC-84). 유닛 시작은 스텁이고 guard도 스텁 — 실제 유닛은 시작되지 않는다 ──
const fresh = (mode: "shadow" | "land" | "land+rts" | "rts") => {
  config.stateDir = mkdtempSync(join(tmpdir(), "update-auto-"));
  after(() => rmSync(config.stateDir, { recursive: true, force: true }));
  saveMcc({ mode, airport: "ATCC", ciCheck: "check", holds: [], kApproval: "on", removalGuard: "on" });
};

test("자동 RTS: shadow·land에서는 아무것도 하지 않는다", async () => {
  for (const mode of ["shadow", "land"] as const) {
    fresh(mode);
    const { pass, calls } = setup();
    assert.equal((await pass()).started, false);
    assert.equal(calls.start, 0);
    assert.equal(calls.compare, 0);
    assert.deepEqual(mccLines(), []);
  }
});

test("자동 RTS: rts에서 할 때면 유닛(스텁)을 by server로 시작하고, 5분 안 두 번째는 시작하지 않는다", async () => {
  fresh("rts");
  const { pass, calls } = setup();
  const r = await pass();
  assert.equal(r.started, true);
  assert.equal(calls.start, 1);
  const [rec] = mccLines();
  assert.deepEqual([rec.op, rec.by, rec.result, rec.to], ["rts", "server", "started", B]);
  const again = await pass();
  assert.equal(again.started, false);
  assert.match(again.why, /5분/);
  assert.equal(calls.start, 1);
});

test("자동 RTS: 상태에 자동 배포 켜짐과 다음 시각이 실린다(모드가 rts·land+rts일 때만)", async () => {
  fresh("land+rts");
  const { app, pass } = setup();
  assert.deepEqual((await (await app.request("/api/update")).json()).auto, { on: true, nextAt: null });
  await pass();
  const auto = (await (await app.request("/api/update")).json()).auto;
  assert.equal(auto.on, true);
  assert.ok(Date.parse(auto.nextAt) > Date.now());
  fresh("land");
  assert.deepEqual((await (await setup().app.request("/api/update")).json()).auto, { on: false, nextAt: null });
});

test("자동 RTS: 범위가 package.json을 바꾸면 사람에게 넘기고, 시험 서버 guard면 시작하지 않는다", async () => {
  fresh("rts");
  const manual = setup({ compare: async () => ({ prs: [], files: ["package.json"] }) });
  const r = await manual.pass();
  assert.equal(r.started, false);
  assert.match(r.why, /사람이 배포/);
  assert.equal(manual.calls.start, 0);
  const guarded = setup({ guard: rtsGuard });
  assert.equal((await guarded.pass()).started, false);
  assert.equal(guarded.calls.start, 0);
  assert.deepEqual(mccLines(), []);
});

test("자동 RTS: 같은 main에 거절되면 멈추고, 유닛 시작 오류는 failed로 남기고 바로 다시 하지 않는다", async () => {
  fresh("rts");
  const bad = setup({ startUnit: async () => { throw new Error("systemctl 실패"); } });
  assert.equal((await bad.pass()).started, false);
  assert.equal(mccLines()[0].result, "failed");
  const retry = setup();
  assert.match((await retry.pass()).why, /5분/);
  assert.equal(retry.calls.start, 0);
  fresh("rts");
  appendFileSync(RTS_FILE(), JSON.stringify({ at: new Date().toISOString(), from: A, to: B, result: "refused", detail: "세션 점검" }) + "\n");
  const stopped = setup();
  assert.match((await stopped.pass()).why, /자동 배포 멈춤/);
  assert.equal(stopped.calls.start, 0);
});

test("/api/mcc/rts: rts 모드에서 서버가 이미 시작했으면 그렇다고 알린다", async () => {
  fresh("rts");
  const { pass } = setup();
  await pass();
  const app = new Hono();
  mountMcc(app, async () => snap(B), () => A);
  const r = await app.request("/api/mcc/rts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "claude-opus-5-5" }) });
  assert.equal(r.status, 409);
  const body = await r.json();
  assert.equal(body.serverStarted, true);
  assert.match(body.why, /서버가 이미 RTS를 시작함/);
});

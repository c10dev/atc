import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Hono } from "hono";
import { config } from "./config.ts";
import { saveMcc } from "./mcc.ts";
import type { Snapshot } from "./model.ts";
import { checkoutAtMain, rangeRefusalOf } from "./update.ts";
import { loadPlanRts, mountUpdate, type RangeInfo, type UpdateDeps } from "./update-run.ts";

// ATC-217: 의존성이 안 바뀐 package*.json과, 손으로 fast-forward한 본 체크아웃. 유닛 시작은 스텁이다(실제 atc-rts는 시작하지 않는다)
// 시험마다 새 임시 상태 폴더(앞 시험의 시작 기록이 섞이지 않게)
const fresh = () => {
  config.stateDir = mkdtempSync(join(tmpdir(), "update-checkout-"));
  after(() => rmSync(config.stateDir, { recursive: true, force: true }));
  saveMcc({ mode: "land+rts", airport: "ATCC", ciCheck: "check", holds: [], kApproval: "on", removalGuard: "on", serverAuto: "off" });
};

const A = "c0ca22e" + "0".repeat(33);
const B = "4678e03" + "0".repeat(33);
const snap = { airports: [{ code: "ATCC", repo: "atc" }], atfm: { mains: [{ repo: "atc", slug: "o/atc", sha: B, state: "success", branch: "main" }], groundStops: [] }, pulls: [] } as unknown as Snapshot;
const planRts = await loadPlanRts();

test("checkoutAtMain: main이고 깨끗하고 HEAD가 main일 때만. 모르면 false", () => {
  const ok = { branch: "main", head: B, dirty: false };
  assert.equal(checkoutAtMain(ok, B), true);
  assert.equal(checkoutAtMain(ok, B.slice(0, 7)), true);
  assert.equal(checkoutAtMain({ ...ok, head: A }, B), false);
  assert.equal(checkoutAtMain({ ...ok, dirty: true }, B), false);
  assert.equal(checkoutAtMain({ ...ok, branch: "claude/x" }, B), false);
  assert.equal(checkoutAtMain(null, B), false);
  assert.equal(checkoutAtMain(ok, null), false);
});

test("rangeRefusalOf: package*.json은 depsChanged가 false일 때만 통과", () => {
  assert.equal(rangeRefusalOf(planRts, A, B, ["package.json", "package-lock.json"], false), null);
  assert.match(rangeRefusalOf(planRts, A, B, ["package.json"], true)!, /package\.json/);
  assert.match(rangeRefusalOf(planRts, A, B, ["package.json"])!, /package\.json/);
  assert.match(rangeRefusalOf(planRts, A, B, ["package.json", "deploy/atc.service"], false)!, /atc\.service/);
});

function setup(range: RangeInfo, checkout: UpdateDeps["checkout"]) {
  fresh();
  const calls = { start: 0 };
  const deps: UpdateDeps = { startUnit: async () => void calls.start++, guard: () => null, compare: async () => range, planRts: async () => planRts, checkout, now: Date.now };
  const app = new Hono();
  const { pass } = mountUpdate(app, async () => snap, () => A, deps);
  return { app, calls, pass };
}
const post = (app: Hono) => app.request("/api/update/start", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:7702" }, body: "{}" });
const status = async (app: Hono) => (await app.request("/api/update")).json();
const atB = async () => ({ branch: "main", head: B, dirty: false });
const atA = async () => ({ branch: "main", head: A, dirty: false });

test("license만 바뀐 package*.json(depsChanged false)은 거절하지 않는다", async () => {
  const { app, calls } = setup({ prs: [], files: ["package.json", "package-lock.json"], depsChanged: false }, atA);
  assert.equal((await status(app)).kind, "available");
  assert.equal((await post(app)).status, 200);
  assert.equal(calls.start, 1);
});

test("의존성이 바뀌었거나 알 수 없으면(depsChanged true·없음) 거절한다", async () => {
  for (const depsChanged of [true, undefined]) {
    const { app, calls } = setup({ prs: [], files: ["package.json"], depsChanged }, atA);
    const s = await status(app);
    assert.equal(s.kind, "manual");
    assert.match(s.refusal, /package\.json/);
    assert.equal((await post(app)).status, 409);
    assert.equal(calls.start, 0);
  }
});

test("본 체크아웃이 이미 main이면 package*.json이 범위에 있어도 다시 시도가 시작된다", async () => {
  const { app, calls } = setup({ prs: [], files: ["package.json", "package-lock.json"], depsChanged: true }, atB);
  const s = await status(app);
  assert.equal(s.kind, "available");
  assert.equal(s.refusal, null);
  assert.equal((await post(app)).status, 200);
  assert.equal(calls.start, 1);
});

test("본 체크아웃이 main이 아니거나 변경이 있거나 읽지 못하면 범위 거절을 유지한다", async () => {
  for (const checkout of [async () => ({ branch: "main", head: B, dirty: true }), async () => ({ branch: "x", head: B, dirty: false }), async () => null]) {
    const { app, calls } = setup({ prs: [], files: ["package.json"], depsChanged: true }, checkout);
    assert.equal((await status(app)).kind, "manual");
    assert.equal((await post(app)).status, 409);
    assert.equal(calls.start, 0);
  }
});

test("자동 RTS도 같은 사전 점검: 체크아웃이 main이면 범위를 읽지 않고 시작한다", async () => {
  fresh();
  let compares = 0;
  const calls = { start: 0 };
  const deps: UpdateDeps = { startUnit: async () => void calls.start++, guard: () => null, compare: async () => (compares++, { prs: [], files: ["package.json"], depsChanged: true }), planRts: async () => planRts, checkout: atB, now: Date.now };
  const app = new Hono();
  const { pass } = mountUpdate(app, async () => snap, () => A, deps);
  assert.equal((await pass()).started, true);
  assert.equal(compares, 0);
  assert.equal(calls.start, 1);
});

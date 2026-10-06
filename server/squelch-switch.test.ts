import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Hono } from "hono";
import { config } from "./config.ts";
import { modeOf, ROLES } from "./squelch.ts";
import { defaultConfig, mountSquelch, readState } from "./squelch-run.ts";
import { mountSquelchSwitch, readChanges } from "./squelch-switch-run.ts";
import { applyPatch, changesThisWeek, lastChanges, parsePatch, resetAll, WEEK_MS } from "./squelch-switch.ts";

// 시험은 임시 상태 폴더에서 돈다. 진짜 ~/.local/state/atc는 읽지도 쓰지도 않는다
const dir = mkdtempSync(join(tmpdir(), "squelch-switch-"));
config.stateDir = dir;
after(() => rmSync(dir, { recursive: true, force: true }));
const file = (n: string) => join(dir, n);
// shadow·v1에서 시작하는 설정(ATC-553: defaultConfig는 on·v2다)
const shadowConfig = () => {
  const c = defaultConfig();
  c.mode = "shadow";
  for (const r of ROLES) c.fingerprint[r] = "v1";
  return c;
};
const SHADOW_FILE = JSON.stringify({ config: { mode: "shadow", fingerprint: { tower: "v1", mcc: "v1", occ: "v1", crosscheck: "v1", review: "v1" } }, roles: {} });
const reset = () => {
  for (const n of ["squelch.json", "squelch.jsonl", "squelch-changes.jsonl"]) rmSync(file(n), { force: true });
  writeFileSync(file("squelch.json"), SHADOW_FILE); // ATC-553: 기본값이 on·v2라 shadow·v1 시작은 파일로
};

test("modeOf: 역할 모드가 먼저, 없으면 전체 모드, 둘 다 없으면 on, 값이 틀리면 shadow", () => {
  assert.equal(modeOf({ mode: "shadow", roles: { tower: { mode: "on" } } }, "tower"), "on");
  assert.equal(modeOf({ mode: "shadow", roles: { tower: { mode: "on" } } }, "mcc"), "shadow");
  assert.equal(modeOf({ mode: "on", roles: {} }, "mcc"), "on");
  assert.equal(modeOf({ mode: "bogus", roles: { mcc: { mode: 7 } } }, "mcc"), "shadow");
  assert.equal(modeOf({}, "occ"), "on"); // ATC-553: 없는 값은 기본값 on
  assert.equal(modeOf({ roles: { occ: { mode: "loud" } } }, "occ"), "shadow"); // 있는데 모르는 값은 shadow
});

test("parsePatch: 값을 검사한다(틀린 값·모르는 필드·빈 본문은 거절)", () => {
  assert.deepEqual(parsePatch({ mode: "on", heartbeatMin: 30, fingerprint: "v2" }), { ok: true, patch: { mode: "on", heartbeatMin: 30, fingerprint: "v2" } });
  for (const bad of [{ mode: "ON" }, { mode: 1 }, { heartbeatMin: 0 }, { heartbeatMin: 1.5 }, { heartbeatMin: "50" }, { heartbeatMin: 100000 }, { fingerprint: "v3" }, { role: "x", mode: "on" }, {}, null, [], "on"]) {
    assert.equal(parsePatch(bad).ok, false, JSON.stringify(bad));
  }
});

test("applyPatch: 한 역할만 바뀌고, 같은 값은 바뀐 것으로 세지 않는다", () => {
  const cfg = shadowConfig();
  const r = applyPatch(cfg, "tower", { mode: "on", fingerprint: "v2", heartbeatMin: 50 });
  assert.deepEqual(r.changes, [
    { role: "tower", field: "mode", from: "shadow", to: "on" },
    { role: "tower", field: "fingerprint", from: "v1", to: "v2" },
  ]);
  assert.equal(modeOf(r.config, "tower"), "on");
  assert.equal(modeOf(r.config, "mcc"), "shadow");
  assert.equal(r.config.fingerprint.mcc, "v1");
  assert.equal(cfg.roles.tower, undefined); // 원본은 그대로
  // 전체 모드와 같은 값을 정해도 역할 칸에 적히고 기록은 없다
  const same = applyPatch(cfg, "occ", { mode: "shadow" });
  assert.deepEqual(same.changes, []);
  assert.deepEqual(same.config.roles.occ, { mode: "shadow" });
});

test("resetAll: 모든 역할 shadow·v1, 바뀐 것만 기록, heartbeatMin은 그대로", () => {
  let cfg = shadowConfig();
  cfg = applyPatch(cfg, "tower", { mode: "on", fingerprint: "v2", heartbeatMin: 20 }).config;
  cfg = applyPatch(cfg, "review", { mode: "off" }).config;
  cfg.mode = "on";
  const r = resetAll(cfg);
  assert.equal(r.config.mode, "shadow");
  assert.deepEqual(r.config.roles, {});
  assert.equal(r.config.heartbeatMin.tower, 20);
  const by = r.changes.map((c) => `${c.role}.${c.field}:${c.from}>${c.to}`).sort();
  assert.deepEqual(by, ["crosscheck.mode:on>shadow", "mcc.mode:on>shadow", "occ.mode:on>shadow", "review.mode:off>shadow", "tower.fingerprint:v2>v1", "tower.mode:on>shadow"]);
  assert.deepEqual(resetAll(r.config).changes, []); // 이미 꺼져 있으면 기록 없음
});

test("lastChanges·changesThisWeek: 필드마다 마지막 줄, 7일 안의 줄 수", () => {
  const now = Date.parse("2026-10-06T12:00:00Z");
  const L = (ms: number, field: "mode" | "fingerprint", to: string) => ({ t: new Date(now - ms).toISOString(), by: "SUPERVISOR", role: "tower" as const, field, from: "x", to });
  const lines = [L(8 * 86_400_000, "mode", "on"), L(3_000, "mode", "shadow"), L(WEEK_MS - 1000, "fingerprint", "v2")];
  assert.equal(changesThisWeek(lines, now), 2);
  const last = lastChanges(lines);
  assert.equal(last.tower?.mode?.to, "shadow");
  assert.equal(last.tower?.fingerprint?.to, "v2");
});

const JSON_APP = { "content-type": "application/json", origin: "http://localhost:7700" };
function setup() {
  const app = new Hono();
  mountSquelchSwitch(app);
  const put = (role: string, body: unknown, headers: Record<string, string> = JSON_APP) => app.request(`/api/squelch-switch/${role}`, { method: "PUT", headers, body: JSON.stringify(body) });
  const off = (headers: Record<string, string> = JSON_APP) => app.request("/api/squelch-switch/off", { method: "POST", headers, body: "{}" });
  return { app, put, off };
}

test("route: Origin이 없거나 다른 사이트면 403이고 아무것도 쓰지 않는다", async () => {
  reset();
  const { put, off } = setup();
  const bad: Record<string, string>[] = [{ "content-type": "application/json" }, { "content-type": "application/json", origin: "https://evil.example" }, { origin: "http://localhost:7700" }];
  for (const h of bad) {
    assert.equal((await put("tower", { mode: "on" }, h)).status, 403);
    assert.equal((await off(h)).status, 403);
  }
  assert.equal(readFileSync(file("squelch.json"), "utf8"), SHADOW_FILE); // 파일을 바꾸지 않았다
  assert.equal(existsSync(file("squelch-changes.jsonl")), false);
});

test("route: 한 역할만 on으로 올리고, 기록에 누가·언제·역할·필드·이전·이후가 남는다", async () => {
  reset();
  const { put, app } = setup();
  const r = await put("tower", { mode: "on", fingerprint: "v2", heartbeatMin: 30 });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.changes, 3);
  assert.equal(body.roles.tower.mode, "on");
  assert.equal(body.roles.tower.modeOwn, true);
  assert.equal(body.roles.mcc.mode, "shadow");
  assert.equal(body.changes7d, 3);
  const f = readState();
  assert.equal(modeOf(f.config, "tower"), "on");
  assert.equal(f.config.heartbeatMin.tower, 30);
  assert.equal(f.config.fingerprint.tower, "v2");
  const log = readChanges();
  assert.equal(log.length, 3);
  assert.deepEqual(log.map((l) => [l.by, l.role, l.field, l.from, l.to]).sort(), [
    ["SUPERVISOR", "tower", "fingerprint", "v1", "v2"],
    ["SUPERVISOR", "tower", "heartbeatMin", 50, 30],
    ["SUPERVISOR", "tower", "mode", "shadow", "on"],
  ]);
  assert.ok(Number.isFinite(Date.parse(log[0]!.t)));
  const got = await (await app.request("/api/squelch-switch")).json();
  assert.equal(got.roles.tower.last.mode.to, "on");
});

test("route: 틀린 값은 400이고 파일을 바꾸지 않는다. 모르는 역할은 404", async () => {
  reset();
  const { put } = setup();
  assert.equal((await put("tower", { mode: "loud" })).status, 400);
  assert.equal((await put("tower", { heartbeatMin: -1 })).status, 400);
  assert.equal((await put("nobody", { mode: "on" })).status, 404);
  assert.equal(readFileSync(file("squelch.json"), "utf8"), SHADOW_FILE); // 파일을 바꾸지 않았다
  assert.equal(readChanges().length, 0);
});

test("fail open: 파일에 틀린 값이 있어도 shadow·50·v1로 읽고 tick은 열린다", async () => {
  reset();
  writeFileSync(file("squelch.json"), JSON.stringify({ config: { mode: "mute", roles: { tower: { mode: "loud" }, mcc: "x" }, heartbeatMin: { tower: -5, mcc: "a" }, fingerprint: { tower: "v9" } }, roles: {} }));
  const f = readState();
  assert.equal(modeOf(f.config, "tower"), "shadow");
  assert.equal(modeOf(f.config, "mcc"), "shadow");
  assert.equal(f.config.heartbeatMin.tower, 50);
  assert.equal(f.config.heartbeatMin.mcc, 50);
  assert.equal(f.config.fingerprint.tower, "v1");
  const app = new Hono();
  mountSquelch(app, { get: async () => ({ pending: [], excluded: [], recent: [] }), manual: async () => false });
  const r = await (await app.request("/api/squelch/review", { method: "POST" })).json();
  assert.equal(r.open, true);
  assert.match(r.reason, /^shadow:/);
});

test("역할 모드가 tick을 정한다: 한 역할만 on이면 그 역할만 QUIET을 버린다", async () => {
  reset();
  const { put } = setup();
  await put("review", { mode: "on" });
  const app = new Hono();
  mountSquelch(app, { get: async () => ({ pending: [{ pr: "atc#1", head: "a" }], excluded: [], recent: [] }), manual: async () => false });
  const tick = async (role: string) => (await app.request(`/api/squelch/${role}`, { method: "POST" })).json();
  assert.equal((await tick("review")).reason, "first");
  assert.deepEqual([(await tick("review")).open, (await tick("review")).reason], [false, "quiet"]);
  await tick("crosscheck");
  const other = await tick("crosscheck");
  assert.deepEqual([other.open, other.reason], [true, "shadow:quiet"]); // 전체 모드는 shadow 그대로
});

test("끄기: 모든 역할이 shadow·v1로 돌아오고 바뀐 것만 기록된다. 이미 꺼져 있으면 기록 없음", async () => {
  reset();
  const { put, off } = setup();
  await put("tower", { mode: "on", fingerprint: "v2" });
  await put("mcc", { mode: "off" });
  const before = readChanges().length;
  const r = await off();
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.changes, 3);
  assert.equal(readChanges().length, before + 3);
  const f = readState();
  assert.deepEqual([f.config.mode, f.config.roles, f.config.fingerprint.tower], ["shadow", {}, "v1"]);
  assert.equal((await (await off()).json()).changes, 0);
  assert.equal(readFileSync(file("squelch-changes.jsonl"), "utf8").split("\n").filter(Boolean).length, before + 3);
});

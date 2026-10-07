import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Hono } from "hono";
import { config } from "./config.ts";
import type { Snapshot } from "./model.ts";
import { mountSessionControl } from "./session-control.ts";

// LAUNCH ACCOUNT의 경로(ATC-239). 임시 HOME·임시 상태 폴더·가짜 claude만 쓴다: 실제 세션도 ~/.claude*도 운영 상태 폴더도 건드리지 않는다.
const root = realpathSync(mkdtempSync(join(tmpdir(), "atc-launchacct-")));
const real = { home: config.home, claudeDir: config.claudeDir, claudeBin: config.claudeBin, stateDir: config.stateDir };
after(() => {
  Object.assign(config, real);
  rmSync(root, { recursive: true, force: true });
});
config.home = root;
config.claudeDir = join(root, ".claude");
config.stateDir = join(root, "state");
mkdirSync(config.stateDir, { recursive: true });
const BIN = join(root, "fake-claude");
// auth status는 로그인됨, agents는 빈 목록. 세션을 띄우지도 멈추지도 않는다
writeFileSync(BIN, `#!/bin/sh\ncase "$1" in auth) echo '{"loggedIn":true,"authMethod":"claude.ai"}';; *) echo '[]';; esac\n`);
chmodSync(BIN, 0o755);
config.claudeBin = BIN;

const fleetFile = join(config.stateDir, "fleet.json");
const writeFleet = (accounts: Record<string, { configDir: string }>, extra: object = {}) => writeFileSync(fleetFile, JSON.stringify({ defaults: {}, aircraft: {}, accounts, ...extra }));
const DIRS = { "acct-1": { configDir: join(root, ".claude-acct-1") }, "acct-3": { configDir: join(root, ".claude-acct-3") }, "acct-2": { configDir: join(root, ".claude") } };
const app = new Hono();
mountSessionControl(app, async () => ({ fuelAccounts: [], sessions: [], airports: [], tickets: [] }) as unknown as Snapshot);
const APP = { "content-type": "application/json", origin: "http://localhost:7700" };
const put = (body: unknown, headers: Record<string, string> = APP) => app.request("/api/fleet/launch-account", { method: "PUT", headers, body: JSON.stringify(body) });
const get = async () => (await (await app.request("/api/fleet/launch-accounts")).json()) as { launchAccount: { aircraft: string | null; control: string | null }; launchAccountWarnings: string[]; accounts: { label: string; refused: string | null }[] };
const raw = () => JSON.parse(readFileSync(fleetFile, "utf8")) as Record<string, unknown>;

test("PUT: SUPERVISOR만 — Origin 없음(atcctl)·다른 사이트·JSON이 아닌 Content-Type(ATC-238)은 403이고 아무것도 쓰지 않는다", async () => {
  writeFleet(DIRS);
  for (const headers of [{ "content-type": "application/json" }, { "content-type": "application/json", origin: "https://evil.example" }, { origin: "http://localhost:7700" }, { "content-type": "text/plain", origin: "http://localhost:7700" }] as Record<string, string>[]) {
    const r = await put({ aircraft: "acct-3" }, headers);
    assert.equal(r.status, 403, JSON.stringify(headers));
    assert.match(((await r.json()) as { error: string }).error, /이 화면에서 보낸 요청만 받습니다/);
  }
  assert.equal("launchAccount" in raw(), false);
});

test("PUT·GET: 종류마다 저장하고(다른 칸은 그대로) 읽으면 보인다. null은 각 home으로 되돌린다. 레지스트리와 다른 항목은 그대로", async () => {
  writeFleet(DIRS, { control: { TOWER: { account: "acct-1" } } });
  assert.deepEqual((await get()).launchAccount, { aircraft: null, control: null });
  const a = await put({ aircraft: "acct-3" });
  assert.equal(a.status, 200);
  assert.deepEqual(((await a.json()) as { launchAccount: unknown }).launchAccount, { aircraft: "acct-3", control: null });
  assert.equal((await put({ control: "acct-1" })).status, 200);
  assert.deepEqual((await get()).launchAccount, { aircraft: "acct-3", control: "acct-1" });
  assert.deepEqual(raw().launchAccount, { aircraft: "acct-3", control: "acct-1" });
  assert.deepEqual(raw().control, { TOWER: { account: "acct-1" } });
  assert.deepEqual(Object.keys(raw().accounts as object), ["acct-1", "acct-3", "acct-2"]);
  assert.equal((await put({ aircraft: null })).status, 200);
  assert.deepEqual((await get()).launchAccount, { aircraft: null, control: "acct-1" });
  assert.equal((await put({ control: "" })).status, 200);
  assert.equal("launchAccount" in raw(), false, "둘 다 비면 칸을 지운다");
});

test("PUT: 등록부에 없는 라벨은 409, 모르는 칸·빈 본문·깨진 본문은 400이고 쓰지 않는다", async () => {
  writeFleet(DIRS);
  assert.equal((await put({ aircraft: "acct-9" })).status, 409);
  assert.equal((await put({ desktop: "acct-1" })).status, 400);
  assert.equal((await put({})).status, 400);
  assert.equal((await app.request("/api/fleet/launch-account", { method: "PUT", headers: APP, body: "{bad" })).status, 400);
  assert.equal("launchAccount" in raw(), false);
  // 등록부가 비면 고를 수 없다
  writeFileSync(fleetFile, JSON.stringify({ defaults: {}, aircraft: {} }));
  const r = await put({ aircraft: "acct-1" });
  assert.equal(r.status, 409);
  assert.match(((await r.json()) as { error: string }).error, /등록부가 비어 있음/);
});

test("PUT: 갈라진 설정은 저장되고 경고가 돌아온다, 같게 맞추면 경고가 없다(ATC-251)", async () => {
  writeFleet(DIRS);
  const a = await put({ aircraft: "acct-1" });
  assert.deepEqual(((await a.json()) as { launchAccountWarnings: string[] }).launchAccountWarnings, []); // 관제가 각 home이면 알 수 없다
  const split = await put({ control: "acct-3" });
  assert.equal(split.status, 200);
  const body = (await split.json()) as { launchAccountWarnings: string[] };
  assert.equal(body.launchAccountWarnings.length, 1);
  assert.match(body.launchAccountWarnings[0]!, /AIRCRAFT acct-1, 관제 세션 acct-3/);
  assert.deepEqual(((await (await put({ control: "acct-1" })).json()) as { launchAccountWarnings: string[] }).launchAccountWarnings, []);
});

test("GET: 등록부에서 지워진 라벨은 효과가 없고(null) 경고가 붙는다. 다시 등록하면 돌아온다", async () => {
  writeFleet(DIRS, { launchAccount: { aircraft: "acct-3", control: "acct-1" } });
  const ok = await get();
  assert.deepEqual(ok.launchAccount, { aircraft: "acct-3", control: "acct-1" });
  assert.equal(ok.launchAccountWarnings.length, 1); // ATC-251: AIRCRAFT acct-3 / 관제 acct-1은 갈라졌다
  assert.match(ok.launchAccountWarnings[0]!, /LAUNCH ACCOUNT가 갈라졌다\(AIRCRAFT acct-3, 관제 세션 acct-1\)/);
  assert.deepEqual(ok.accounts.map((x) => x.label).sort(), ["acct-1", "acct-2", "acct-3"]);
  assert.ok(ok.accounts.every((x) => x.refused === null));
  const { "acct-3": _gone, ...rest } = DIRS;
  writeFleet(rest, { launchAccount: { aircraft: "acct-3", control: "acct-1" } });
  const gone = await get();
  assert.deepEqual(gone.launchAccount, { aircraft: null, control: "acct-1" });
  assert.equal(gone.launchAccountWarnings.length, 1);
  assert.match(gone.launchAccountWarnings[0]!, /acct-3가 등록부에 없음/);
  writeFleet(DIRS, { launchAccount: { aircraft: "acct-3" } });
  assert.deepEqual((await get()).launchAccount.aircraft, "acct-3");
});

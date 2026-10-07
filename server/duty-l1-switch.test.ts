import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Hono } from "hono";
import { config } from "./config.ts";
import { mountSettings } from "./settings.ts";

// DUTY L1 스위치의 설정 길(ATC-349). 임시 HOME·임시 상태 폴더만 쓴다: DUTY 프로세스는 띄우지 않고 운영 상태 폴더도 건드리지 않는다.
const root = realpathSync(mkdtempSync(join(tmpdir(), "atc-dutyl1-")));
const real = { home: config.home, claudeDir: config.claudeDir, stateDir: config.stateDir };
after(() => {
  Object.assign(config, real);
  rmSync(root, { recursive: true, force: true });
});
config.home = root;
config.claudeDir = join(root, ".claude");
config.stateDir = join(root, "state");
mkdirSync(config.stateDir, { recursive: true });
const FILE = join(config.stateDir, "duty.json");
const OTHERS = { enabled: false, account: "acct-2", idleMin: 7, charter: "shadow", review: false, reviewEveryMin: 111, reviewIdleMin: 22, reviewLeakMin: 33, reviewGapMin: 44, note: "keep" };
writeFileSync(FILE, JSON.stringify(OTHERS));

const app = new Hono();
mountSettings(app);
const APP = { "content-type": "application/json", origin: "http://localhost:7700" };
const put = (body: unknown, headers: Record<string, string> = APP) => app.request("/api/settings", { method: "PUT", headers, body: JSON.stringify(body) });
const onDisk = () => JSON.parse(readFileSync(FILE, "utf8")) as Record<string, unknown>;
const l1Switch = async () => ((await (await app.request("/api/settings")).json()) as { switches: { key: string; value: string }[] }).switches.find((x) => x.key === "dutyL1");

test("dutyL1: 기본은 off로 읽히고 설정 목록에 나온다", async () => {
  assert.equal((await l1Switch())?.value, "off");
});

test("dutyL1: off·on만 받고 다른 값은 400이며 duty.json은 그대로다", async () => {
  for (const bad of ["shadow", "ON", true, 1, null, ""]) {
    const res = await put({ dutyL1: bad });
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.match(((await res.json()) as { errors: { dutyL1: string } }).errors.dutyL1, /off 또는 on/);
  }
  assert.deepEqual(onDisk(), OTHERS);
});

test("dutyL1: Origin이 없거나 다른 사이트에서 온 요청은 403이고 l1은 디스크에서 그대로다", async () => {
  assert.equal((await put({ dutyL1: "on" }, { "content-type": "application/json" })).status, 403, "Origin 없음(atcctl이 보내는 꼴)");
  assert.equal((await put({ dutyL1: "on" }, { "content-type": "application/json", origin: "https://evil.example" })).status, 403);
  assert.equal((await put({ dutyL1: "on" }, { "content-type": "application/json", origin: "null" })).status, 403);
  assert.equal(onDisk().l1, undefined);
  assert.equal((await l1Switch())?.value, "off");
});

test("dutyL1: 켜고 끄면 l1만 바뀌고 duty.json의 다른 키(review* 포함)는 그대로다", async () => {
  assert.equal((await put({ dutyL1: "on" })).status, 200);
  assert.deepEqual(onDisk(), { ...OTHERS, l1: true });
  assert.equal((await l1Switch())?.value, "on");
  assert.equal((await put({ dutyL1: "off" })).status, 200);
  assert.deepEqual(onDisk(), { ...OTHERS, l1: false });
  assert.equal((await l1Switch())?.value, "off");
});

test("dutyL1: duty.enabled를 끄고 켜도 l1은 건드리지 않는다", async () => {
  await put({ dutyL1: "on" });
  await put({ dutyEnabled: "off" });
  assert.equal(onDisk().l1, true);
  assert.equal(onDisk().enabled, false);
});

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Hono } from "hono";
import { config } from "./config.ts";
import { mountSettings } from "./settings.ts";
import { isRisky, modeSegments, needsConfirm, settingsSearch } from "./settings-policy.ts";

// DUTY L1 스위치(ATC-349). 임시 상태 폴더만 쓴다: DUTY 프로세스는 띄우지 않고 운영 상태 폴더도 건드리지 않는다.
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
const file = join(config.stateDir, "duty.json");
const onDisk = () => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
writeFileSync(file, JSON.stringify({ enabled: false, account: "acct-2", briefMaxChars: 3000, custom: "keep" }));

const app = new Hono();
mountSettings(app);
const APP = { "content-type": "application/json", origin: "http://localhost:7700" };
const put = (body: unknown, headers: Record<string, string> = APP) => app.request("/api/settings", { method: "PUT", headers, body: JSON.stringify(body) });
const l1 = async () => ((await (await app.request("/api/settings")).json()) as { duty: { l1: boolean } }).duty.l1;

test("dutyL1: off 또는 on만 받는다(400), 아무것도 바뀌지 않는다", async () => {
  for (const bad of [true, "yes", 1, null, "ON"]) assert.equal((await put({ dutyL1: bad })).status, 400, String(bad));
  assert.equal(await l1(), false);
});

test("dutyL1: Origin이 없거나 다른 사이트면 403이고 l1은 그대로다", async () => {
  assert.equal((await put({ dutyL1: "on" }, { "content-type": "application/json" })).status, 403, "Origin 없음(atcctl이 보내는 모양)");
  assert.equal((await put({ dutyL1: "on" }, { "content-type": "application/json", origin: "https://evil.example" })).status, 403, "다른 사이트");
  assert.equal(await l1(), false);
  assert.equal(onDisk().l1, undefined);
});

test("dutyL1: 이 화면에서 켜고 끄면 duty.json의 l1만 바뀌고 다른 키는 그대로다", async () => {
  assert.equal((await put({ dutyL1: "on" })).status, 200);
  assert.equal(await l1(), true);
  assert.deepEqual(onDisk(), { enabled: false, account: "acct-2", briefMaxChars: 3000, custom: "keep", l1: true });
  assert.equal((await put({ dutyL1: "off" })).status, 200);
  assert.equal(await l1(), false);
  assert.deepEqual(onDisk(), { enabled: false, account: "acct-2", briefMaxChars: 3000, custom: "keep", l1: false });
});

test("dutyL1: duty.enabled를 바꿔도 l1은 그대로다", async () => {
  await put({ dutyL1: "on" });
  await put({ dutyEnabled: "off" });
  assert.equal(await l1(), true);
});

test("DUTY L1 정책: on은 ⚠ 확인, off는 그대로, 정책 한 줄과 색인에 보인다", () => {
  assert.ok(isRisky("dutyL1", "on"));
  assert.ok(!isRisky("dutyL1", "off"));
  assert.ok(needsConfirm("dutyL1", "off", "on"));
  assert.ok(!needsConfirm("dutyL1", "on", "off"));
  assert.ok(!needsConfirm("dutyL1", "off", "off"));
  const base = { autoland: { mode: "off" }, mcc: { mode: "shadow" }, review: { security: "exclude" } };
  const seg = (l1: boolean) => modeSegments({ ...base, duty: { enabled: true, account: "acct-2", idleMin: 30, charter: "off", l1 } } as never).find((x) => x.key === "dutyL1");
  assert.deepEqual([seg(true)?.label, seg(true)?.value, seg(true)?.warn], ["DUTY L1", "on", true]);
  assert.deepEqual([seg(false)?.value, seg(false)?.warn], ["off", false]);
  assert.deepEqual(settingsSearch("duty.l1").map((e) => e.code), ["DUTY"]);
});

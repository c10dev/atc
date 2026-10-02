import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Hono } from "hono";
import { config } from "./config.ts";
import { loadMcc, readMccRecords } from "./mcc.ts";
import { mountSettings } from "./settings.ts";

// K 승인 착륙 스위치(ATC-391)의 설정 길. 임시 HOME·임시 상태 폴더만 쓴다(운영 상태 폴더는 건드리지 않는다).
const root = realpathSync(mkdtempSync(join(tmpdir(), "atc-kapproval-")));
const real = { home: config.home, claudeDir: config.claudeDir, stateDir: config.stateDir };
after(() => {
  Object.assign(config, real);
  rmSync(root, { recursive: true, force: true });
});
config.home = root;
config.claudeDir = join(root, ".claude");
config.stateDir = join(root, "state");
mkdirSync(config.stateDir, { recursive: true });

const app = new Hono();
mountSettings(app);
const APP = { "content-type": "application/json", origin: "http://localhost:7700" };
const put = (body: unknown, headers: Record<string, string> = APP) => app.request("/api/settings", { method: "PUT", headers, body: JSON.stringify(body) });
const modeLines = () => readMccRecords().filter((r) => r.op === "mode");

test("mccKApproval: on·off만 받고, 다른 값은 400이며 아무것도 바뀌지 않는다", async () => {
  for (const bad of ["shadow", "ON", true, 1, null, ""]) {
    const res = await put({ mccKApproval: bad });
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.match(((await res.json()) as { errors: { mccKApproval: string } }).errors.mccKApproval, /on 또는 off/);
  }
  assert.equal(loadMcc().kApproval, "on");
  assert.equal(modeLines().length, 0);
});

test("mccKApproval: 이 화면(Origin) 밖의 요청은 403이고 스위치는 그대로다", async () => {
  assert.equal((await put({ mccKApproval: "off" }, { "content-type": "application/json" })).status, 403);
  assert.equal((await put({ mccKApproval: "off" }, { "content-type": "application/json", origin: "https://evil.example" })).status, 403);
  assert.equal(loadMcc().kApproval, "on");
});

test("mccKApproval: off로 바꾸면 mcc.json에 쓰고 mcc.jsonl에 kApproval이 든 mode 줄이 한 줄 남는다. 같은 값은 줄을 더하지 않는다", async () => {
  const res = await put({ mccKApproval: "off" });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { mcc: { kApproval: string } }).mcc.kApproval, "off");
  assert.equal(JSON.parse(readFileSync(join(config.stateDir, "mcc.json"), "utf8")).kApproval, "off");
  const lines = modeLines();
  assert.equal(lines.length, 1);
  const l = lines[0] as { mode: string; kApproval?: string; detail: string };
  assert.equal(l.kApproval, "off"); // detail을 읽지 않아도 구별된다
  assert.equal(l.mode, "shadow"); // MCC 모드는 그대로
  assert.match(l.detail, /kApproval on → off/);
  await put({ mccKApproval: "off" });
  assert.equal(modeLines().length, 1);
  // 다시 켠다: 설정에 on, 기록 한 줄 더
  assert.equal((await put({ mccKApproval: "on" })).status, 200);
  assert.equal(loadMcc().kApproval, "on");
  assert.equal(modeLines().length, 2);
});

test("설정 읽기: mcc.kApproval과 7일 수(kDays)가 함께 온다", async () => {
  const j = (await (await app.request("/api/settings")).json()) as { mcc: { kApproval: string; kDays: { day: string; landed: number }[] } };
  assert.equal(j.mcc.kApproval, "on");
  assert.equal(j.mcc.kDays.length, 7);
  assert.ok(j.mcc.kDays.every((d) => d.landed === 0));
});

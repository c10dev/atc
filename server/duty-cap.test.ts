import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import { config } from "./config.ts";
import { DUTY_CAP_1M, DUTY_CAP_PLAIN, dutyCapOf } from "./duty-cap.ts";
import { parseDutyConfig } from "./duty-config.ts";
import { DutyRuntime, setDutyCap } from "./duty-run.ts";
import { mountSettings } from "./settings.ts";
import type { RecordLine } from "./recorder.ts";

// DUTY 컨텍스트 CAP(ATC-496). 상태 폴더는 test-hermetic의 임시 폴더다.
const M1 = "claude-sonnet-5-5[1m]";

test("dutyCapOf: cap이 없으면 [1m] 모델은 100만, 보통 모델은 25만, 모델을 아직 모르면 25만", () => {
  assert.deepEqual(dutyCapOf({}, M1), { cap: DUTY_CAP_1M, source: "model", ignored: null });
  assert.deepEqual(dutyCapOf({}, "claude-sonnet-5-5"), { cap: DUTY_CAP_PLAIN, source: "default", ignored: null });
  assert.deepEqual(dutyCapOf({}, null), { cap: 250_000, source: "default", ignored: null });
  assert.deepEqual(dutyCapOf({ cap: null }, M1), { cap: DUTY_CAP_1M, source: "model", ignored: null }, "null은 cap 없음");
  assert.equal(dutyCapOf({}, "claude-sonnet-5-5[1m]x").cap, DUTY_CAP_PLAIN, "끝이 [1m]일 때만");
});

test("dutyCapOf: 범위 안의 정수 cap이 이기고, 경계 값도 된다", () => {
  assert.deepEqual(dutyCapOf({ cap: 400_000 }, M1), { cap: 400_000, source: "duty.json", ignored: null });
  assert.equal(dutyCapOf({ cap: 400_000 }, null).source, "duty.json");
  assert.equal(dutyCapOf({ cap: 50_000 }, M1).cap, 50_000);
  assert.equal(dutyCapOf({ cap: 1_000_000 }, null).cap, 1_000_000);
});

test("dutyCapOf: 범위 밖·정수 아님·숫자 아님은 무시하고 까닭을 알린다", () => {
  for (const bad of [49_999, 1_000_001, 0, -1, 250_000.5, "400000", true, [], {}, NaN]) {
    const r = dutyCapOf({ cap: bad }, M1);
    assert.equal(r.cap, DUTY_CAP_1M, String(bad));
    assert.equal(r.source, "model");
    assert.match(r.ignored ?? "", /무시함/);
  }
  assert.equal(dutyCapOf({ cap: 10 }, null).source, "default");
});

test("parseDutyConfig는 cap을 있는 그대로 두고, 없거나 null이면 칸이 없다", () => {
  assert.equal(parseDutyConfig({ cap: 400_000 }).cap, 400_000);
  assert.equal(parseDutyConfig({ cap: "x" }).cap, "x");
  assert.equal("cap" in parseDutyConfig({}), false);
  assert.equal("cap" in parseDutyConfig({ cap: null }), false);
});

test("status: cap과 capSource를 내고, 잘못된 cap은 capNote로 알린다", () => {
  const status = (cfg: object) => new DutyRuntime({ stateDir: config.stateDir, claudeBin: "/bin/false", loadConfig: () => parseDutyConfig(cfg), accountDir: () => null }).status();
  const none = status({});
  assert.deepEqual([none.cap, none.capSource, none.capNote], [250_000, "default", null]);
  const set = status({ cap: 400_000 });
  assert.deepEqual([set.cap, set.capSource, set.capNote], [400_000, "duty.json", null]);
  const bad = status({ cap: 5 });
  assert.deepEqual([bad.cap, bad.capSource], [250_000, "default"]);
  assert.match(bad.capNote ?? "", /duty\.json의 cap\(5\)을 무시함/);
});

const file = () => join(config.stateDir, "duty.json");
const onDisk = () => JSON.parse(readFileSync(file(), "utf8")) as Record<string, unknown>;

test("setDutyCap: duty.json에 원자적으로 쓰고 다른 칸은 그대로, 바뀔 때만 FLIGHT RECORDER 한 줄(from → to)", async () => {
  mkdirSync(config.stateDir, { recursive: true });
  writeFileSync(file(), JSON.stringify({ enabled: false, account: "acct-2", extra: 1 }));
  const lines: RecordLine[] = [];
  const rec = (l: RecordLine) => void lines.push(l);
  await setDutyCap(400_000, "SUPERVISOR", rec);
  assert.deepEqual([onDisk().cap, onDisk().account, onDisk().extra], [400_000, "acct-2", 1]);
  await setDutyCap(400_000, "SUPERVISOR", rec); // 그대로
  await setDutyCap(null, "SUPERVISOR", rec);
  assert.equal("cap" in onDisk(), false, "null이면 칸을 지운다");
  await setDutyCap(null, "SUPERVISOR", rec); // 그대로
  assert.deepEqual(lines.map((l) => (l.kind === "duty-cap" ? [l.by, l.from, l.to] : null)), [["SUPERVISOR", null, 400_000], ["SUPERVISOR", 400_000, null]]);
});

test("PUT /api/settings dutyCap: 범위 밖·문자열은 400, 이 화면 밖 요청은 403, 값은 바뀌지 않는다", async () => {
  mkdirSync(config.stateDir, { recursive: true });
  writeFileSync(file(), JSON.stringify({ enabled: false }));
  const app = new Hono();
  mountSettings(app);
  const APP = { "content-type": "application/json", origin: "http://localhost:7700" };
  const put = (body: unknown, headers: Record<string, string> = APP) => app.request("/api/settings", { method: "PUT", headers, body: JSON.stringify(body) });
  for (const bad of [10, 1_000_001, "400000", 250_000.5, true]) assert.equal((await put({ dutyCap: bad })).status, 400, String(bad));
  assert.equal((await put({ dutyCap: 400_000 }, { "content-type": "application/json" })).status, 403);
  assert.equal("cap" in onDisk(), false);
  assert.equal((await put({ dutyCap: 400_000 })).status, 200);
  assert.equal(onDisk().cap, 400_000);
  assert.equal((await put({ dutyCap: null })).status, 200);
  assert.equal("cap" in onDisk(), false);
});

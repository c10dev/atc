import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import { modeLine, modeSegments, needsConfirm, settingsIndexOf, settingsSearch } from "./settings-policy.ts";
import { mountSettings, readServerSettings } from "./settings.ts";
import { BUILTIN_SWITCHES_DIR, createSwitchRegistry, makeSwitchRegistry, switchRegistry } from "./switch-registry.ts";
import { defineSwitch } from "./switch-def.ts";

// SWITCH REGISTRY(ATC-393): 스위치 하나는 server/switches/ 파일 하나. 파일만 더해도 PUT·정책 한 줄·⚠ 확인·설정 찾기에 나온다.
const here = new URL(".", import.meta.url).pathname;
const app = (registry = switchRegistry) => {
  const a = new Hono();
  mountSettings(a, registry);
  return a;
};
const put = (a: Hono, body: unknown, origin = "http://localhost:7700") =>
  a.request("/api/settings", { method: "PUT", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });

test("내장 스위치: key가 겹치지 않고, 기본값은 지금 읽는 값과 같고, 줄이 있는 스위치는 값마다 경고가 있다", () => {
  const keys = switchRegistry.decls.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const d of switchRegistry.decls) {
    if (d.validate) continue; // 구조가 있는 스위치(세션별 CAP·auto, DUTY ACCOUNT)는 값 목록이 없다
    assert.ok(d.values?.includes(d.default as never), `${d.key} 기본값이 값 목록에 없음`);
    assert.equal(d.read(), d.default, `${d.key}: 아무것도 쓰지 않았을 때의 값이 선언한 기본값과 다름`);
    assert.ok(d.risky.every((r) => d.values!.includes(r as never)), `${d.key}: ⚠ 모드가 값 목록에 없음`);
    const w = typeof d.warn === "function" ? d.warn() : d.warn;
    if (d.row) for (const v of d.values!) assert.ok(w?.[v], `${d.key}=${v} 경고 줄 없음`);
  }
});

test("선언의 순서: 정책 한 줄은 lineOrder, 저장은 applyOrder, 설정 창은 order", () => {
  assert.deepEqual(
    modeSegments(switchRegistry.views()).map((x) => x.key).slice(0, 7),
    ["autolandMode", "autolandReviewedSecurity", "mccMode", "judgesJev", "fuelHold", "reviewSecurity", "codexLane"],
  );
  assert.deepEqual(switchRegistry.decls.slice(0, 4).map((d) => d.key), ["reviewSecurity", "fuelHold", "autoApprove", "autoApproveLaunch"]);
  assert.deepEqual(switchRegistry.views().filter((v) => v.group === "landing").map((v) => v.key), ["autolandMode", "autolandReviewedSecurity", "mccMode", "migrateRehearsal", "autoRevert", "reviewSecurity", "codexLane"]);
});

test("GET /api/settings는 선언된 스위치를 싣는다(지금 값, 값 목록, ⚠ 모드, 값마다 경고, 줄)", async () => {
  const body = (await (await app().request("/api/settings")).json()) as { switches: ReturnType<typeof readServerSettings>["switches"] };
  const mcc = body.switches.find((s) => s.key === "mccMode")!;
  assert.deepEqual([mcc.value, mcc.values, mcc.risky], ["shadow", ["shadow", "land", "land+rts", "rts"], ["land", "land+rts", "rts"]]);
  assert.match(mcc.warn.rts!, /^⚠ MCC는 착륙하지 않는다/);
  assert.equal(mcc.row?.env, "mcc.mode");
});

test("PUT: 선언한 스위치를 검사하고 저장하고, 틀린 값은 400과 선언의 문구, 이 화면 Origin이 없으면 403", async () => {
  const a = app();
  assert.equal((await put(a, { codexLane: "off" })).status, 200);
  assert.equal(switchRegistry.decls.find((d) => d.key === "codexLane")!.read(), "off");
  const bad = await put(a, { codexLane: "maybe" });
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { errors: { codexLane: "off 또는 on" } });
  assert.equal((await put(a, { codexLane: "on" }, "https://evil.example")).status, 403);
  assert.equal(switchRegistry.decls.find((d) => d.key === "codexLane")!.read(), "off"); // 막힌 요청은 저장하지 않는다
  assert.equal((await put(a, { codexLane: "on" })).status, 200);
});

// ── 파일 하나만 더하면 ──
const SW_SOURCE = `
export default {
  key: "dummySwitch",
  label: "DUMMY",
  group: "operations",
  block: { code: "DUMMY", label: "더미 스위치", windowLabel: "더미 스위치(시험)", words: "dummy 시험 dummy.mode" },
  values: ["off", "on"],
  default: "off",
  risky: ["on"],
  error: "off 또는 on",
  warn: { off: "꺼짐", on: "⚠ 켜짐" },
  row: () => ({ label: "DUMMY", env: "dummy.mode", note: "시험" }),
  order: 900,
  read: () => globalThis.__dummy.value,
  save: (v) => { globalThis.__dummy.value = v; globalThis.__dummy.saved.push(v); },
  record: (v) => "dummy.mode=" + v,
};
`;

test("스위치 파일 하나만 더하면: 다른 파일을 고치지 않아도 PUT·GET·정책 한 줄·⚠ 확인·설정 찾기에 나온다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-switch-"));
  writeFileSync(join(dir, "dummy-switch.ts"), SW_SOURCE);
  (globalThis as unknown as { __dummy: { value: string; saved: string[] } }).__dummy = { value: "off", saved: [] };
  const registry = await createSwitchRegistry([dir]);
  assert.equal(registry.decls.length, switchRegistry.decls.length + 1); // 파일 하나가 스위치 하나

  const a = app(registry);
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...x: unknown[]) => void logs.push(x.join(" "));
  const res = await put(a, { dummySwitch: "on" });
  console.log = orig;
  assert.equal(res.status, 200);
  const g = (await res.json()) as { switches: { key: string; value: string }[] };
  assert.equal(g.switches.find((s) => s.key === "dummySwitch")!.value, "on"); // 저장 → 다시 읽은 값
  assert.deepEqual((globalThis as unknown as { __dummy: { saved: string[] } }).__dummy.saved, ["on"]);
  assert.ok(logs.some((l) => l === "[atc] settings updated: dummy.mode=on"), logs.join("|")); // 기록 줄

  const bad = await put(a, { dummySwitch: "x" });
  assert.deepEqual([bad.status, await bad.json()], [400, { errors: { dummySwitch: "off 또는 on" } }]);

  const views = registry.views();
  const seg = modeSegments(views).find((x) => x.key === "dummySwitch");
  assert.deepEqual(seg && [seg.label, seg.value, seg.warn], ["DUMMY", "on", true]); // 정책 한 줄과 ⚠
  assert.ok(modeLine(modeSegments(views)).endsWith("DUMMY on"));
  const sw = views.find((v) => v.key === "dummySwitch")!;
  assert.ok(needsConfirm(sw, "off", "on") && !needsConfirm(sw, "on", "off")); // ⚠ 확인
  assert.deepEqual(settingsSearch("dummy", settingsIndexOf(views)).map((e) => [e.tab, e.code]), [["operations", "DUMMY"]]); // 설정 찾기
  // 같은 레지스트리를 쓰지 않는 서버(내장만)에는 나오지 않는다
  assert.ok(!switchRegistry.views().some((v) => v.key === "dummySwitch"));
});

test("선언이 잘못되면 어느 파일인지 적어 던진다: default export가 스위치가 아님, key가 겹침", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-switch-bad-"));
  writeFileSync(join(dir, "not-a-switch.ts"), "export default { hello: 1 };\n");
  await assert.rejects(createSwitchRegistry([dir]), /not-a-switch\.ts.*스위치 선언이 아님/);
  const dup = mkdtempSync(join(tmpdir(), "atc-switch-dup-"));
  writeFileSync(join(dup, "copy.ts"), SW_SOURCE.replace('"dummySwitch"', '"mccMode"'));
  await assert.rejects(createSwitchRegistry([dup]), /스위치 key가 겹침: mccMode/);
  const one = defineSwitch({ key: "x", label: "X", group: "landing", block: { code: "X", label: "x", words: "" }, values: ["a"], default: "a", risky: [], order: 1, read: () => "a", save: () => {} });
  assert.throws(() => makeSwitchRegistry([one, one]), /스위치 key가 겹침/);
});

test("시험 파일과 .d.ts는 읽지 않는다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-switch-skip-"));
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "x.test.ts"), "throw new Error('시험 파일을 읽으면 안 된다');\n");
  writeFileSync(join(dir, "y.d.ts"), "throw new Error('d.ts를 읽으면 안 된다');\n");
  assert.equal((await createSwitchRegistry([dir])).decls.length, switchRegistry.decls.length);
});

// ── 공용 줄이 남지 않았다 ──
test("공용 파일(settings.ts·settings-policy.ts)에 스위치마다 적는 줄이 없다", () => {
  for (const f of ["settings.ts", "settings-policy.ts"]) {
    const text = readFileSync(join(here, f), "utf8");
    for (const d of switchRegistry.decls) assert.ok(!text.includes(`"${d.key}"`) && !new RegExp(`\\b${d.key}\\?:`).test(text), `${f}에 스위치 ${d.key}가 남아 있다`);
  }
  assert.ok(BUILTIN_SWITCHES_DIR.endsWith("/switches"));
});

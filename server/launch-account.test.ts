import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { config } from "./config.ts";
import { loadFleet, saveAccounts, saveAircraft, saveControlAccount, saveLaunchAccount } from "./fleet.ts";
import { effectiveLaunchAccount, launchSettingOf, launchSettingPatchOf } from "./launch-account.ts";

// LAUNCH ACCOUNT(ATC-239). 순수 함수와 fleet.json 읽기·쓰기. 임시 상태 폴더만 쓴다(test-hermetic).
const REG = ["acct-1", "acct-2", "acct-3"];

test("launchSettingOf: 모양이 맞는 칸만(알 수 없는 칸·잘못된 값은 버린다). 없으면 빈 객체", () => {
  assert.deepEqual(launchSettingOf(undefined), {});
  assert.deepEqual(launchSettingOf(null), {});
  assert.deepEqual(launchSettingOf([]), {});
  assert.deepEqual(launchSettingOf({ aircraft: "acct-3", control: "acct-1", extra: "x" }), { aircraft: "acct-3", control: "acct-1" });
  assert.deepEqual(launchSettingOf({ aircraft: "Acct 3", control: 7 }), {});
});

test("effectiveLaunchAccount: 등록된 라벨은 그대로, 등록부에 없으면 null(home으로)과 경고, 설정이 없으면 경고도 없다", () => {
  assert.deepEqual(effectiveLaunchAccount({ aircraft: "acct-3" }, "aircraft", REG), { label: "acct-3", warning: null });
  assert.deepEqual(effectiveLaunchAccount({}, "aircraft", REG), { label: null, warning: null });
  const gone = effectiveLaunchAccount({ aircraft: "acct-9" }, "aircraft", REG);
  assert.equal(gone.label, null);
  assert.match(gone.warning!, /acct-9가 등록부에 없음.*각 home/);
  assert.match(effectiveLaunchAccount({ control: "acct-9" }, "control", REG).warning!, /관제 세션/);
  // 등록부가 비면 어떤 라벨도 효과가 없다
  assert.equal(effectiveLaunchAccount({ aircraft: "acct-1" }, "aircraft", []).label, null);
});

test("launchSettingPatchOf: 적힌 칸만 바꾸고, null·\"\"은 지우고, 등록부에 없는 라벨·모르는 칸·빈 본문은 거절", () => {
  const ok = (cur: object, body: unknown) => {
    const r = launchSettingPatchOf(cur, body, REG);
    assert.ok(r.ok, JSON.stringify(r));
    return r.next;
  };
  assert.deepEqual(ok({}, { aircraft: "acct-3" }), { aircraft: "acct-3" });
  assert.deepEqual(ok({ aircraft: "acct-3" }, { control: "ACCT-1 " }), { aircraft: "acct-3", control: "acct-1" }, "다른 칸은 그대로, 라벨은 정규화");
  assert.deepEqual(ok({ aircraft: "acct-3", control: "acct-1" }, { aircraft: null }), { control: "acct-1" });
  assert.deepEqual(ok({ aircraft: "acct-3" }, { aircraft: "" }), {});
  const bad = (body: unknown, re: RegExp, status: number, reg: readonly string[] = REG) => {
    const r = launchSettingPatchOf({}, body, reg);
    assert.ok(!r.ok);
    assert.match(r.error, re);
    assert.equal(r.status, status);
  };
  bad({ aircraft: "acct-9" }, /등록되지 않은 ACCOUNT: acct-9/, 409);
  bad({ aircraft: "acct-1" }, /등록부가 비어 있음/, 409, []);
  bad({ aircraft: 5 }, /ACCOUNT 라벨/, 400);
  bad({ aircraft: "Acct 1" }, /ACCOUNT 라벨/, 400);
  bad({ desktop: "acct-1" }, /모르는 칸: desktop/, 400);
  bad({}, /aircraft나 control/, 400);
  bad(null, /객체/, 400);
  bad([], /객체/, 400);
  // 비우는 것은 등록부가 비어 있어도 된다("각 home"으로 돌아가는 길을 막지 않는다)
  assert.deepEqual(launchSettingPatchOf({ aircraft: "acct-1" }, { aircraft: null }, []), { ok: true, next: {} });
});

// ── fleet.json: 새 칸은 현재 빌드도, 옛 빌드(이 칸을 모르는 loadFleet·save*)도 지우거나 깨뜨리지 않는다 ──
const file = () => join(config.stateDir, "fleet.json");
const raw = () => JSON.parse(readFileSync(file(), "utf8")) as Record<string, unknown>;

test("fleet.json: launchAccount를 쓰고 읽는다. 다른 항목은 그대로, 비면 칸을 지운다", () => {
  mkdirSync(config.stateDir, { recursive: true });
  writeFileSync(file(), JSON.stringify({ defaults: {}, aircraft: { TEAM_A: { account: "acct-2" } }, control: { TOWER: { account: "acct-1" } }, accounts: { "acct-1": { configDir: "/h/.claude-acct-1" } } }));
  assert.equal("launchAccount" in loadFleet(), false, "옛 파일엔 없다");
  saveLaunchAccount({ aircraft: "acct-1", control: "acct-1" });
  assert.deepEqual(loadFleet().launchAccount, { aircraft: "acct-1", control: "acct-1" });
  const r = raw();
  assert.deepEqual(r.aircraft, { TEAM_A: { account: "acct-2" } });
  assert.deepEqual(r.control, { TOWER: { account: "acct-1" } });
  assert.ok(r.accounts);
  saveLaunchAccount({});
  assert.equal("launchAccount" in raw(), false);
  assert.equal("launchAccount" in loadFleet(), false);
});

test("fleet.json: 잘못된 launchAccount 값은 읽을 때 버린다(파일이 깨져도 loadFleet는 던지지 않는다)", () => {
  writeFileSync(file(), JSON.stringify({ aircraft: {}, launchAccount: { aircraft: "NOT A LABEL", control: 3, stray: "x" } }));
  assert.equal("launchAccount" in loadFleet(), false);
  writeFileSync(file(), JSON.stringify({ aircraft: {}, launchAccount: "acct-1" }));
  assert.equal("launchAccount" in loadFleet(), false);
});

test("되돌림 안전: 이 칸을 모르는 쓰기(saveAccounts·saveControlAccount·saveAircraft)도 launchAccount를 그대로 두고, 모르는 최상위 칸도 지우지 않는다", () => {
  writeFileSync(file(), JSON.stringify({ aircraft: {}, launchAccount: { aircraft: "acct-1" }, futureKey: { a: 1 } }));
  saveAccounts({ "acct-1": { configDir: "/h/.claude-acct-1" } });
  saveControlAccount("TOWER", "acct-1");
  saveAircraft("TEAM_Z", { account: "acct-1" });
  const r = raw();
  assert.deepEqual(r.launchAccount, { aircraft: "acct-1" });
  assert.deepEqual(r.futureKey, { a: 1 });
  // 읽는 쪽: loadFleet는 아는 칸만 고르므로 모르는 칸이 있어도 같은 값을 돌려준다
  const f = loadFleet();
  assert.deepEqual(Object.keys(f).sort(), ["accounts", "aircraft", "control", "defaults", "launchAccount"]);
  assert.deepEqual(f.launchAccount, { aircraft: "acct-1" });
});

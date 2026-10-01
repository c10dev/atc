import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { launchModelOf, launchModelPatchOf, launchModelSettingOf, nextModelNote } from "./launch-model.ts";

// ATC-279: LAUNCH MODEL
const ctx = { airports: ["ATCC", "VCDO"], aircraft: ["TEAM_B", "TEAM_C"] };

test("읽기: 모양이 맞는 칸만, 키는 대문자", () => {
  assert.deepEqual(launchModelSettingOf(undefined), {});
  assert.deepEqual(launchModelSettingOf({ default: "claude-opus-5-5", airports: { atcc: "sonnet", VCDO: "bad model!" }, aircraft: { team_b: "opus[1m]" }, junk: 1 }), {
    default: "claude-opus-5-5",
    airports: { ATCC: "sonnet" },
    aircraft: { TEAM_B: "opus[1m]" },
  });
  assert.deepEqual(launchModelSettingOf({ default: "" }), {});
});

test("우선순위: 양식 > AIRCRAFT > AIRPORT > 기본 > 마지막 LAUNCH > 없음", () => {
  const setting = { default: "claude-opus-5-5", airports: { ATCC: "sonnet" }, aircraft: { TEAM_B: "haiku" } };
  const pick = (over: Partial<Parameters<typeof launchModelOf>[0]>) => launchModelOf({ registration: "TEAM_C", airport: "VCDO", setting, ...over });
  assert.deepEqual(pick({}), { model: "claude-opus-5-5", from: "default" });
  assert.deepEqual(pick({ airport: "ATCC" }), { model: "sonnet", from: "airport" });
  assert.deepEqual(pick({ registration: "TEAM_B", airport: "ATCC" }), { model: "haiku", from: "aircraft" });
  assert.deepEqual(pick({ registration: "TEAM_B", airport: "ATCC", explicit: "opus" }), { model: "opus", from: "form" });
  assert.deepEqual(pick({ explicit: "  " }), { model: "claude-opus-5-5", from: "default" }); // 빈 양식은 이름을 안 댄 것
  assert.deepEqual(pick({ setting: {} }), { model: null, from: "none" });
  assert.deepEqual(pick({ setting: null }), { model: null, from: "none" });
});

test("마지막 LAUNCH의 모델은 설정이 하나도 안 맞을 때만 쓴다", () => {
  const withSetting = launchModelOf({ registration: "TEAM_C", airport: "VCDO", last: "sonnet", setting: { default: "claude-opus-5-5" } });
  assert.deepEqual(withSetting, { model: "claude-opus-5-5", from: "default" });
  const none = launchModelOf({ registration: "TEAM_C", airport: "VCDO", last: "sonnet", setting: {} });
  assert.deepEqual(none, { model: "sonnet", from: "last" });
  // 설정이 있어도 다른 AIRPORT 칸만이면 맞지 않는다
  assert.deepEqual(launchModelOf({ registration: "TEAM_C", airport: "VCDO", last: "sonnet", setting: { airports: { ATCC: "opus" } } }), { model: "sonnet", from: "last" });
});

test("PUT 검사: 적힌 칸만 바꾸고, 지우고, 잘못된 값·모르는 칸·등록 안 된 키는 거절한다", () => {
  const cur = { default: "sonnet", airports: { ATCC: "opus" } };
  const set = launchModelPatchOf(cur, { default: "claude-opus-5-5", aircraft: { team_b: "haiku" } }, ctx);
  assert.ok(set.ok);
  if (set.ok) {
    assert.deepEqual(set.next, { default: "claude-opus-5-5", airports: { ATCC: "opus" }, aircraft: { TEAM_B: "haiku" } });
    assert.deepEqual(set.changes, [
      { scope: "default", key: null, from: "sonnet", to: "claude-opus-5-5" },
      { scope: "aircraft", key: "TEAM_B", from: null, to: "haiku" },
    ]);
  }
  const clear = launchModelPatchOf(cur, { default: null, airports: { atcc: "" } }, ctx);
  assert.ok(clear.ok);
  if (clear.ok) assert.deepEqual(clear.next, {}); // 비면 칸이 사라진다
  const same = launchModelPatchOf(cur, { default: "sonnet" }, ctx);
  assert.ok(same.ok && same.changes.length === 0); // 같은 값은 기록하지 않는다
  assert.equal(launchModelPatchOf(cur, { default: "bad model!" }, ctx).ok, false);
  assert.equal(launchModelPatchOf(cur, { default: 5 }, ctx).ok, false);
  assert.equal(launchModelPatchOf(cur, { nope: 1 }, ctx).ok, false);
  assert.equal(launchModelPatchOf(cur, {}, ctx).ok, false);
  assert.equal(launchModelPatchOf(cur, [], ctx).ok, false);
  const unknownAirport = launchModelPatchOf(cur, { airports: { ZZZZ: "opus" } }, ctx);
  assert.ok(!unknownAirport.ok && unknownAirport.status === 409);
  // 등록에서 사라진 키도 지울 수는 있다
  const cur2 = { aircraft: { TEAM_GONE: "opus" } };
  const gone = launchModelPatchOf(cur2, { aircraft: { TEAM_GONE: null } }, ctx);
  assert.ok(gone.ok);
  if (gone.ok) assert.deepEqual(gone.next, {});
});

test("표시: 설정이 맞을 때만 next LAUNCH model, 출처를 적는다", () => {
  const setting = { default: "claude-opus-5-5", airports: { ATCC: "sonnet" } };
  assert.equal(nextModelNote({ registration: "TEAM_C", airport: "VCDO", setting }), "next LAUNCH model claude-opus-5-5 (기본)");
  assert.equal(nextModelNote({ registration: "TEAM_C", airport: "ATCC", setting }), "next LAUNCH model sonnet (AIRPORT)");
  assert.equal(nextModelNote({ registration: "TEAM_C", airport: "VCDO", setting: {} }), null);
  assert.equal(nextModelNote({ registration: "TEAM_C", airport: null }), null);
});

// 모든 AIRCRAFT LAUNCH 길이 launchAircraft를 지나고, 모델은 거기서만 정한다: 새 길이 이 규칙을 건너뛰지 못하게 목록을 고정한다
test("LAUNCH 길 목록: launchAircraft를 부르는 곳과 --model을 붙이는 곳", () => {
  const files = readdirSync(new URL(".", import.meta.url)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  const callers = files.filter((f) => /\blaunchAircraft\(/.test(readFileSync(new URL(f, import.meta.url), "utf8")) && f !== "session-control.ts").sort();
  // DISPATCH launch 카드·RESUME(index.ts), FLEET PLAN 단계와 LAUNCH ACCOUNT APPLY NOW(fleet-plan-run.ts). FRESH START(fresh-start-run.ts, ATC-73). FLEET LAUNCH 버튼은 session-control.ts의 라우트
  assert.deepEqual(callers, ["fleet-plan-run.ts", "fresh-start-run.ts", "index.ts"]);
  const modelArgs = files.filter((f) => /"--model"/.test(readFileSync(new URL(f, import.meta.url), "utf8"))).sort();
  assert.deepEqual(modelArgs, ["session-control.ts"]);
  const sc = readFileSync(new URL("session-control.ts", import.meta.url), "utf8");
  assert.match(sc, /launchModelOf\(/);
});

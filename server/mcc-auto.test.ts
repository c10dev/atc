import assert from "node:assert/strict";
import { test } from "node:test";
import { autoCountsOf, autoLandOf, autoRecentOf, RECHECK_AFTER_MS, recheckDueOf, recheckOf, rtsViaAutoOf, serverLandedOf } from "./mcc-auto.ts";
import { autoRtsOf, DEFAULT_MCC, loadMcc, parseMcc } from "./mcc.ts";
import type { MccRecord } from "./mcc.ts";
import type { RecordLine } from "./recorder.ts";

const base = { mode: "shadow" as const, serverAuto: "on" as const, tier: "auto" as const, blocks: 0, escalated: false };

test("autoLandOf: auto 등급이고 막힌 조건이 없으면 shadow에서도 착륙", () => {
  assert.equal(autoLandOf(base).land, true);
  assert.equal(autoLandOf({ ...base, mode: "land" }).land, true);
  assert.equal(autoLandOf({ ...base, mode: "land+rts" }).land, true);
});

test("autoLandOf: flagged·user 등급, ESCALATE, 막힌 조건, 스위치 off, 모드 rts는 착륙하지 않는다", () => {
  assert.equal(autoLandOf({ ...base, tier: "flagged" }).land, false);
  assert.equal(autoLandOf({ ...base, tier: "user" }).land, false);
  assert.equal(autoLandOf({ ...base, escalated: true }).land, false);
  assert.equal(autoLandOf({ ...base, blocks: 2 }).land, false);
  assert.equal(autoLandOf({ ...base, serverAuto: "off" }).land, false);
  assert.match(autoLandOf({ ...base, mode: "rts" }).why, /rts/);
});

const land = (pr: number, by?: "server" | "supervisor", result: "ok" | "failed" = "ok", at = "2026-10-06T00:00:00.000Z"): MccRecord => ({ op: "land", at, pr, head: `h${pr}`.padEnd(40, "0"), tier: "auto", result, ...(by ? { by } : {}) });

test("serverLandedOf·rtsViaAutoOf: 범위의 PR이 모두 서버가 착륙시킨 것일 때만", () => {
  const landed = serverLandedOf([land(1, "server"), land(2), land(3, "server", "failed"), land(4, "supervisor")]);
  assert.deepEqual([...landed], [1]);
  assert.equal(rtsViaAutoOf("on", [1], landed), true);
  assert.equal(rtsViaAutoOf("on", [1, 2], landed), false);
  assert.equal(rtsViaAutoOf("on", [], landed), false);
  assert.equal(rtsViaAutoOf("on", null, landed), false);
  assert.equal(rtsViaAutoOf("off", [1], landed), false);
});

test("autoRtsOf: viaAuto면 shadow에서도 시작하고, 아니면 모드가 막는다. 나머지 조건(범위 거절·guard·간격)은 그대로", () => {
  const x = { mode: "shadow" as const, due: { due: true, why: "a → b" }, main: "b".repeat(40), rangeRefusal: null, guard: null, last: null, lastFailedAt: null, now: Date.now() };
  assert.equal(autoRtsOf(x).start, false);
  assert.equal(autoRtsOf({ ...x, viaAuto: true }).start, true);
  assert.equal(autoRtsOf({ ...x, viaAuto: true, rangeRefusal: "package.json" }).start, false);
  assert.equal(autoRtsOf({ ...x, viaAuto: true, guard: "시험 서버" }).start, false);
  assert.equal(autoRtsOf({ ...x, viaAuto: true, due: { due: false, why: "5분" } }).start, false);
});

test("recheckOf: 지금이라면 막았을 조건이 없으면 빈 목록, 있으면 이유", () => {
  const ok = { ci: "ok" as const, ciCheck: "check", inspection: "pass" as const, escalatedAfter: false, held: false };
  assert.deepEqual(recheckOf(ok), []);
  assert.deepEqual(recheckOf({ ...ok, ci: "failed" }), ["CI check 실패"]);
  assert.deepEqual(recheckOf({ ...ok, inspection: "findings", escalatedAfter: true, held: true }), ["INSPECTION findings", "착륙 뒤 ESCALATE", "SUPERVISOR HOLD"]);
});

test("recheckDueOf: 3분 뒤부터 24시간 안의 서버 착륙만, 이미 다시 읽은 것은 뺀다", () => {
  const now = Date.parse("2026-10-06T12:00:00.000Z");
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();
  const records = [land(1, "server", "ok", at(RECHECK_AFTER_MS + 1000)), land(2, "server", "ok", at(60_000)), land(3, "server", "ok", at(25 * 3_600_000)), land(4, undefined, "ok", at(RECHECK_AFTER_MS + 1000)), land(5, "server", "ok", at(RECHECK_AFTER_MS + 1000))];
  const lines: RecordLine[] = [{ t: at(0), kind: "mcc-auto", op: "recheck", pr: 5, head: `h5`.padEnd(40, "0"), misfire: [] }];
  assert.deepEqual(recheckDueOf(records, lines, now).map((d) => d.pr), [1]);
});

test("autoCountsOf·autoRecentOf: 최근 7일 줄만 세고 0도 0으로 센다", () => {
  const now = Date.parse("2026-10-06T12:00:00.000Z");
  const t = (d: number) => new Date(now - d * 86_400_000).toISOString();
  const lines: RecordLine[] = [
    { t: t(1), kind: "mcc-auto", op: "land", pr: 1, head: "a", tier: "auto" },
    { t: t(1), kind: "mcc-auto", op: "recheck", pr: 1, head: "a", misfire: ["CI check 실패"] },
    { t: t(2), kind: "mcc-auto", op: "land", pr: 2, head: "b", tier: "auto" },
    { t: t(2), kind: "mcc-auto", op: "recheck", pr: 2, head: "b", misfire: [] },
    { t: t(3), kind: "mcc-auto", op: "refused", pr: 3, head: "c", why: "rejected" },
    { t: t(1), kind: "mcc-auto", op: "rts", from: "x", to: "y", result: "started", mode: "shadow+server-auto" },
    { t: t(1), kind: "mcc-auto", op: "rts", from: "y", to: "z", result: "failed", mode: "shadow+server-auto", detail: "systemctl" },
    { t: t(9), kind: "mcc-auto", op: "land", pr: 9, head: "old", tier: "auto" },
  ];
  assert.deepEqual(autoCountsOf(lines, now), { lands: 2, rechecks: 2, misfires: 1, refused: 1, rts: 1, rtsFailed: 1 });
  assert.deepEqual(autoCountsOf([], now), { lands: 0, rechecks: 0, misfires: 0, refused: 0, rts: 0, rtsFailed: 0 });
  assert.equal(autoRecentOf(lines, 2).length, 2);
});

test("설정: serverAuto 기본 on, 꺼지는 것은 정확히 off, 알 수 없는 값은 기본", () => {
  assert.equal(DEFAULT_MCC.serverAuto, "on");
  assert.equal(parseMcc({}).serverAuto, "on");
  assert.equal(parseMcc({ serverAuto: "off" }).serverAuto, "off");
  assert.equal(parseMcc({ serverAuto: "shadow" }).serverAuto, "on");
  assert.equal(parseMcc(null).serverAuto, "on");
});

test("설정: 깨진 mcc.json은 서버 자동 착륙을 끈다(읽을 수 없는 설정이 머지를 켠 채로 두지 않는다)", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "mcc-auto-cfg-"));
  const file = join(dir, "mcc.json");
  writeFileSync(file, "{ 깨진");
  assert.equal(loadMcc(file).serverAuto, "off");
  assert.equal(loadMcc(join(dir, "none.json")).serverAuto, "on");
});

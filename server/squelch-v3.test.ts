import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { config } from "./config.ts";
import { DEFAULT_FINGERPRINT, DEFAULT_MODE, modeOf, ROLES, SAFE_FINGERPRINT, SAFE_MODE } from "./squelch.ts";
import { type Decision, decisionOf, isDropped, opensTable } from "./squelch-opens.ts";
import { defaultConfig, migrateOnce, readState } from "./squelch-run.ts";
import { MIGRATION_ID, resetAll, upgradeOnce } from "./squelch-switch.ts";

// ATC-553: 기본값이 on·v2, 한 번만 올리기, 켜진 뒤의 틀린 skip 수. 임시 상태 폴더만 쓴다
const dir = mkdtempSync(join(tmpdir(), "squelch-v3-"));
config.stateDir = dir;
after(() => rmSync(dir, { recursive: true, force: true }));
const file = () => join(dir, "squelch.json");
const put = (x: unknown) => writeFileSync(file(), typeof x === "string" ? x : JSON.stringify(x));
const raw = () => JSON.parse(readFileSync(file(), "utf8"));

test("기본값: 코드는 on·v2, 파일이 없으면 모든 역할이 on·v2", () => {
  assert.equal(DEFAULT_MODE, "on");
  assert.equal(DEFAULT_FINGERPRINT, "v2");
  rmSync(file(), { force: true });
  const f = readState();
  for (const r of ROLES) {
    assert.equal(modeOf(f.config, r), "on", r);
    assert.equal(f.config.fingerprint[r], "v2", r);
  }
  assert.deepEqual(f.config.roles, {});
  assert.equal(defaultConfig().heartbeatMin.tower, 50);
});

test("기본값: 역할 칸이 없는 역할은 on·v2, 있는 칸은 그대로", () => {
  put({ config: { mode: "on", roles: { review: { mode: "off" } }, fingerprint: { tower: "v1" } }, roles: {} });
  const c = readState().config;
  assert.equal(modeOf(c, "review"), "off");
  assert.equal(modeOf(c, "mcc"), "on");
  assert.equal(c.fingerprint.tower, "v1");
  assert.equal(c.fingerprint.mcc, "v2"); // 칸이 없으면 v2
  put({ config: {}, roles: {} }); // 파싱은 되지만 값이 없다: 전부 기본값
  assert.equal(modeOf(readState().config, "occ"), "on");
});

test("파싱할 수 없는 파일, 객체가 아닌 파일, 있는데 모르는 값은 shadow·v1(tick이 돈다)", () => {
  for (const bad of ["{ 깨짐", "null", "[]", '"on"']) {
    put(bad);
    const c = readState().config;
    for (const r of ROLES) {
      assert.equal(modeOf(c, r), SAFE_MODE, `${bad} ${r}`);
      assert.equal(c.fingerprint[r], SAFE_FINGERPRINT, `${bad} ${r}`);
    }
  }
  put({ config: { mode: "mute", roles: { tower: { mode: "loud" } }, fingerprint: { mcc: "v9" } }, roles: {} });
  const c = readState().config;
  assert.equal(modeOf(c, "tower"), "shadow");
  assert.equal(modeOf(c, "mcc"), "shadow"); // 전체 모드가 틀렸다
  assert.equal(c.fingerprint.mcc, "v1");
  assert.equal(c.fingerprint.occ, "v2"); // 칸이 없는 역할은 기본값
});

test("upgradeOnce(순수): 모든 역할 on·v2, heartbeatMin 그대로, 옛 값과 시각을 기록한다", () => {
  const cfg = defaultConfig();
  cfg.heartbeatMin.occ = 20;
  const from = { mode: "shadow", roles: { mcc: { mode: "off" as const } }, fingerprint: { tower: "v1" as const } };
  const { config: next, migrated } = upgradeOnce(cfg, Date.parse("2026-10-06T12:00:00Z"), from);
  for (const r of ROLES) {
    assert.deepEqual(next.roles[r], { mode: "on" });
    assert.equal(next.fingerprint[r], "v2");
  }
  assert.equal(next.mode, "on");
  assert.equal(next.heartbeatMin.occ, 20);
  assert.deepEqual(migrated, { id: MIGRATION_ID, at: "2026-10-06T12:00:00.000Z", from });
  assert.equal(MIGRATION_ID, "ATC-553");
});

test("migrateOnce: 명시된 옛 값을 on·v2로 한 번 덮고, 옛 값을 기록하고, 다시는 쓰지 않는다", () => {
  put({
    config: { mode: "on", roles: { review: { mode: "off" } }, heartbeatMin: { tower: 30 }, fingerprint: { tower: "v1", mcc: "v1", occ: "v1", crosscheck: "v1", review: "v1" } },
    roles: { tower: { fp: "abc", openedAt: "2026-10-06T00:00:00.000Z", quietSince: null, quietCount: 0 } },
  });
  const now = Date.parse("2026-10-06T12:00:00Z");
  assert.equal(migrateOnce(now), "migrated");
  const j = raw();
  assert.equal(j.config.mode, "on");
  for (const r of ROLES) {
    assert.deepEqual(j.config.roles[r], { mode: "on" }, r);
    assert.equal(j.config.fingerprint[r], "v2", r);
  }
  assert.equal(j.config.heartbeatMin.tower, 30);
  assert.equal(j.roles.tower.fp, "abc"); // 역할 상태는 그대로
  assert.deepEqual(j.migrated, {
    id: "ATC-553",
    at: "2026-10-06T12:00:00.000Z",
    from: { mode: "on", roles: { review: { mode: "off" } }, fingerprint: { tower: "v1", mcc: "v1", occ: "v1", crosscheck: "v1", review: "v1" } },
  });
  const before = readFileSync(file(), "utf8");
  assert.equal(migrateOnce(now + 1000), "already");
  assert.equal(readFileSync(file(), "utf8"), before); // 다시 쓰지 않는다
});

test("migrateOnce 뒤 SUPERVISOR가 끄면(스위치) 다시 시작해도 on으로 되돌리지 않는다", () => {
  put({ config: { mode: "shadow", fingerprint: { tower: "v1" } }, roles: {} });
  assert.equal(migrateOnce(1), "migrated");
  const f = readState();
  const off = resetAll(f.config); // 스위치의 끄기
  writeFileSync(file(), JSON.stringify({ ...raw(), config: { ...raw().config, ...off.config } }));
  assert.equal(migrateOnce(2), "already");
  const c = readState().config;
  for (const r of ROLES) {
    assert.equal(modeOf(c, r), "shadow", r);
    assert.equal(c.fingerprint[r], "v1", r);
  }
  assert.equal(readState().migrated?.id, "ATC-553"); // 기록은 남는다
});

test("migrateOnce: 파일이 없으면 on·v2를 쓰고 from은 null, 읽을 수 없는 파일은 건드리지 않는다", () => {
  rmSync(file(), { force: true });
  assert.equal(migrateOnce(5), "migrated");
  assert.equal(raw().migrated.from, null);
  assert.equal(modeOf(readState().config, "tower"), "on");
  put("{ 깨짐");
  assert.equal(migrateOnce(6), "unreadable");
  assert.equal(readFileSync(file(), "utf8"), "{ 깨짐"); // 덮어쓰지 않는다
  assert.equal(modeOf(readState().config, "tower"), "shadow");
});

test("resetAll: 끄기는 shadow를 명시해 기록한다(없는 값은 on으로 읽히니까)", () => {
  const r = resetAll(defaultConfig());
  assert.equal(r.config.mode, "shadow");
  for (const role of ROLES) {
    assert.equal(modeOf(r.config, role), "shadow");
    assert.equal(r.config.fingerprint[role], "v1");
  }
  assert.equal(r.changes.length, ROLES.length * 2); // 기본 on·v2에서 끄면 역할마다 둘
});

// ── misfire 패널의 수 ──
const T0 = Date.parse("2026-10-06T06:00:00Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const ms = (min: number) => T0 + min * 60_000;
const dec = (min: number, o: Partial<Decision> = {}): Decision => ({ t: at(min), role: "tower", open: true, reason: "signal", fingerprint: "v2", ...o });
const useAt = (...mins: number[]) => mins.map(ms);

test("decisionOf: mode·would1·fingerprint를 읽고, 모르는 값은 버린다", () => {
  const d = decisionOf(JSON.stringify({ t: at(0), role: "tower", open: false, reason: "quiet", fingerprint: "v2", would1: "open", would: "quiet" }));
  assert.equal(d?.would1, "open");
  assert.equal(d?.fingerprint, "v2");
  const x = decisionOf(JSON.stringify({ t: at(0), role: "tower", open: false, reason: "quiet", fingerprint: "v9", would1: "maybe" }));
  assert.equal(x?.would1, undefined);
  assert.equal(x?.fingerprint, undefined);
});

test("isDropped: 열리지 않은 quiet만(off·fail-open·열린 판정은 아니다)", () => {
  assert.equal(isDropped(dec(0, { open: false, reason: "quiet" })), true);
  assert.equal(isDropped(dec(0, { open: true, reason: "shadow:quiet" })), false);
  assert.equal(isDropped(dec(0, { open: true, reason: "off" })), false);
  assert.equal(isDropped(dec(0, { open: true, reason: "fail-open" })), false);
});

test("opensTable live: 버림·갈림·wrongSkips·idle·unknown·since", () => {
  const decisions = [
    dec(0, { reason: "first" }),
    dec(10, { open: false, reason: "quiet", would1: "quiet" }), // 버림, v1도 quiet: 갈리지 않음
    dec(20, { open: false, reason: "quiet", would1: "open" }), // 갈림 → 다음 열린 30분의 tick이 일을 함 → wrongSkip
    dec(30, { reason: "heartbeat" }),
    dec(40, { open: false, reason: "quiet", would1: "open" }), // 갈림 → 다음 열린 50분의 tick은 도구 1번 → idle
    dec(50, { reason: "heartbeat" }),
    dec(100, { open: false, reason: "quiet", would1: "open" }), // 갈림 → 뒤에 열린 tick이 없다 → unknown
  ];
  const uses = useAt(31, 32, 33, 34, 51);
  const t = opensTable(decisions, () => uses, ms(1000)).tower!;
  assert.deepEqual(t.live, { since: at(10), dropped: 4, disagreed: 3, wrongSkips: 1, idle: 1, unknown: 1 });
  // 버린 tick은 자연 열림이 아니라 opens에 세지 않는다
  assert.equal(t.opens, 3);
});

test("opensTable live: v1이 판정하는 역할은 v2의 그림자(would)와 비교하고, 기록을 못 찾으면 unknown", () => {
  const decisions = [dec(0, { fingerprint: "v1", reason: "first" }), dec(10, { fingerprint: "v1", open: false, reason: "quiet", would: "open" }), dec(20, { fingerprint: "v1", reason: "heartbeat" })];
  assert.deepEqual(opensTable(decisions, () => null, ms(1000)).tower!.live, { since: at(10), dropped: 1, disagreed: 1, wrongSkips: 0, idle: 0, unknown: 1 });
  // 아직 끝나지 않은 tick도 unknown
  assert.equal(opensTable(decisions, () => useAt(21, 22, 23), ms(25)).tower!.live.unknown, 1);
});

test("opensTable live: 버린 적이 없으면 since는 null이고 수는 0", () => {
  const t = opensTable([dec(0, { reason: "first" }), dec(10, { reason: "signal" })], () => [], ms(1000)).tower!;
  assert.deepEqual(t.live, { since: null, dropped: 0, disagreed: 0, wrongSkips: 0, idle: 0, unknown: 0 });
});

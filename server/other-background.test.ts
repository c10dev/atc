import assert from "node:assert/strict";
import { test } from "node:test";
import { capIdleNow, launchCapOf, launchFullWhy } from "./dispatch-launch.ts";
import { capHoldersOf, capHoldersText, capIdleHintsOf, capLine, idleText, isAircraftName, otherBackgroundOf } from "./other-background.ts";
import { launchPlanOf } from "./session-control.ts";
import { supervisorAlertsOf } from "./supervisor-alerts.ts";

const NOW = Date.parse("2026-09-30T12:00:00.000Z");
const row = (id: string, name: string | undefined, extra: Record<string, unknown> = {}) => ({ id, sessionId: `s-${id}`, name, kind: "background", status: "idle", cwd: "/home/u/projects/atc", ...extra });
const CONTROL = ["TOWER", "OCC", "MCC", "CROSSCHECK", "REVIEW", "ENGINEERING"];
const registry = ["TEAM_G", "TEAM_AA"];

test("isAircraftName: 팀 이름, 등록부의 REGISTRATION·콜사인", () => {
  assert.equal(isAircraftName("TEAM_K", registry), true); // 팀 패턴(FLEET가 세션을 읽는 것과 같다)
  assert.equal(isAircraftName("Team G", registry), true);
  assert.equal(isAircraftName("GOLF", registry), true); // 등록부 TEAM_G의 콜사인
  assert.equal(isAircraftName("ALPHA ALPHA", registry), true);
  assert.equal(isAircraftName("ENGINEERING-NIGHT", registry), false);
  assert.equal(isAircraftName(undefined, registry), false);
});

test("otherBackgroundOf: AIRCRAFT·관제 세션·STALE·interactive는 뺀다", () => {
  const rows = [
    row("a1a1a1", "TEAM_G"),
    row("b2b2b2", "TOWER"),
    row("c3c3c3", "tower"), // 대소문자 무시
    row("d4d4d4", "ENGINEERING-NIGHT", { cwd: "/home/u/projects/atc/occ" }),
    row("e5e5e5", "scratch", { cwd: "/home/u/projects/other" }),
    row("f6f6f6", "old", { stale: true }),
    { ...row("070707", "desk"), kind: "interactive" },
    row("080808", undefined, { cwd: "/home/u/projects/atc/mcc" }), // 관제 폴더에서 연 세션
    row("090909", "GOLF"),
  ];
  const got = otherBackgroundOf(rows, registry, CONTROL, { controlDirs: ["/home/u/projects/atc/mcc"], projectsRoot: "/home/u/projects", now: NOW });
  assert.deepEqual(got.map((o) => o.id), ["d4d4d4", "e5e5e5"]);
  assert.equal(got[0].cwdShort, "atc/occ");
  assert.equal(got[1].cwdShort, "other");
  assert.equal(got[1].cwd, "/home/u/projects/other");
});

test("otherBackgroundOf: job·마지막 활동·놀고 있는 시간·ACCOUNT", () => {
  const job = { state: "working", detail: "reading", tempo: "idle", writtenAt: "2026-09-30T09:00:00.000Z" };
  const [o] = otherBackgroundOf([row("e5e5e5", "scratch", { account: "acct-2" })], [], CONTROL, { jobOf: () => job, now: NOW });
  assert.deepEqual(o.job, { state: "working", detail: "reading", tempo: "idle" });
  assert.equal(o.lastActiveAt, "2026-09-30T09:00:00.000Z"); // 대화 기록이 없으면 job의 updatedAt
  assert.equal(o.idleMin, 180);
  assert.equal(o.account, "acct-2");
  // 대화 기록 mtime이 있으면 그것
  const [p] = otherBackgroundOf([row("e5e5e5", "scratch")], [], CONTROL, { jobOf: () => job, lastActiveOf: () => "2026-09-30T11:30:00.000Z", now: NOW });
  assert.equal(p.idleMin, 30);
  // 아무것도 모르면 null
  const [q] = otherBackgroundOf([row("e5e5e5", "scratch")], [], CONTROL, { now: NOW });
  assert.equal(q.job, null);
  assert.equal(q.idleMin, null);
  assert.equal(q.name, "scratch");
  assert.equal(otherBackgroundOf([row("e5e5e5", undefined)], [], CONTROL, { now: NOW })[0].name, "e5e5e5");
});

test("capHoldersText: AIRCRAFT n · 그 밖 n (이름, 놀고 있는 시간)", () => {
  const rows = [...["TEAM_A", "TEAM_B", "TEAM_C", "TEAM_D", "TEAM_E", "TEAM_F"].map((n) => row(n, n)), row("d4d4d4", "ENGINEERING-NIGHT")];
  const h = capHoldersOf(rows, [], (r) => (r.name === "ENGINEERING-NIGHT" ? 360 : null));
  assert.equal(capHoldersText(h), "AIRCRAFT 6 · 그 밖 1 (ENGINEERING-NIGHT, 6h idle)");
  assert.equal(capLine(7, 7, h), "백그라운드 7/7 — AIRCRAFT 6 · 그 밖 1 (ENGINEERING-NIGHT, 6h idle)");
  assert.equal(capHoldersText(capHoldersOf(rows.slice(0, 2), [])), "AIRCRAFT 2 · 그 밖 0");
  assert.equal(capHoldersText(capHoldersOf([row("x", "a"), row("y", "b")], [], (r) => (r.name === "a" ? 20 : null))), "AIRCRAFT 0 · 그 밖 2 (a, 20m idle; b)");
  assert.equal(capHoldersOf([row("s", "old", { stale: true }), { ...row("i", "desk"), kind: "interactive" }], []).other.length, 0); // 상한이 세지 않는 것은 세지 않는다
  assert.equal(idleText(59), "59m idle");
  assert.equal(idleText(60), "1h idle");
  assert.equal(idleText(null), null);
});

test("launchPlanOf: 상한 409는 자리를 쥔 쪽을 적고, 상한이 세는 것은 그대로", () => {
  const input = { registration: "TEAM_Z", retired: false, repo: "/r", briefing: "b" };
  const rows = [row("a1a1a1", "TEAM_A"), row("d4d4d4", "ENGINEERING-NIGHT")];
  assert.throws(
    () => launchPlanOf(input, rows as never, 2, null, (r) => (r.name === "ENGINEERING-NIGHT" ? 360 : null)),
    (e: Error & { status?: number }) => e.status === 409 && /백그라운드 세션 2개 — 상한 2\(ATC_MAX_LAUNCHED\) · AIRCRAFT 1 · 그 밖 1 \(ENGINEERING-NIGHT, 6h idle\)/.test(e.message),
  );
  // STALE은 세지 않는다(전과 같다)
  assert.doesNotThrow(() => launchPlanOf(input, [row("a1a1a1", "TEAM_A"), row("f6f6f6", "old", { stale: true })] as never, 2));
});

const session = (name: string, lastActiveAt: string | null, extra: Record<string, unknown> = {}) => ({ id: `id-${name}`, name, status: "idle", origin: "background", lastActiveAt, ...extra }) as never;
const launchCard = (reg: string) => ({ kind: "ASSIGN", status: "proposed", launch: true, launched: undefined, registration: reg, aircraftName: reg, flight: "ATC-1" }) as never;

test("DISPATCH: launchFullWhy가 자리를 쥔 쪽을 적는다", () => {
  const sessions = [session("TEAM_A", null), session("ENGINEERING-NIGHT", "2026-09-30T06:00:00.000Z"), session("TOWER", null)];
  const cap = launchCapOf(sessions, [], 2, undefined, NOW);
  assert.equal(cap.launched, 2); // 관제 세션은 세지 않는다
  assert.equal(cap.full, true);
  assert.equal(cap.holders, "AIRCRAFT 1 · 그 밖 1 (ENGINEERING-NIGHT, 6h idle)");
  assert.match(launchFullWhy(cap), /^LAUNCH 대기 — 백그라운드 2 \/ 상한 2\(ATC_MAX_LAUNCHED\) · AIRCRAFT 1 · 그 밖 1 \(ENGINEERING-NIGHT, 6h idle\) — 자리가 나면 승인한다$/);
});

test("놀고 있는 자리 힌트: 상한이 찬 채 LAUNCH가 기다리고 120분을 넘게 논 그 밖의 세션만", () => {
  const sessions = [session("TEAM_A", "2026-09-30T05:00:00.000Z"), session("ENGINEERING-NIGHT", "2026-09-30T06:00:00.000Z", { jobId: "d4d4d4" }), session("busy", "2026-09-30T11:00:00.000Z")];
  const hints = capIdleNow(sessions, [launchCard("TEAM_Z")], 3, undefined, NOW);
  assert.deepEqual(hints, [{ id: "d4d4d4", name: "ENGINEERING-NIGHT", idleMin: 360, refused: "TEAM_Z" }]); // AIRCRAFT는 힌트 대상이 아니다
  assert.deepEqual(capIdleNow(sessions, [], 3, undefined, NOW), []); // 막힌 LAUNCH가 없으면 없다
  assert.deepEqual(capIdleNow(sessions, [launchCard("TEAM_Z")], 4, undefined, NOW), []); // 상한이 안 찼으면 없다
  assert.deepEqual(capIdleHintsOf([{ id: "x", name: "n", idleMin: 120 }], ["TEAM_Z"]), []); // 120분 "넘게"
  assert.equal(capIdleHintsOf([{ id: "x", name: "n", idleMin: 121 }], ["TEAM_Z"]).length, 1);
});

test("ADVISORY 알림 cap|other|<id>", () => {
  const items = supervisorAlertsOf({
    sessions: [], alerts: [], workspaces: [], tickets: [], following: [], proposals: [], pulls: [], rts: null,
    capIdle: [{ id: "d4d4d4", name: "ENGINEERING-NIGHT", idleMin: 360, refused: "TEAM_Z" }],
  });
  const a = items.find((x) => x.key === "cap|other|d4d4d4")!;
  assert.ok(a);
  assert.equal(a.level, "advisory");
  assert.equal(a.cue, null);
  assert.match(a.text, /ENGINEERING-NIGHT.*6h idle.*TEAM_Z/);
  assert.match(a.next, /자동으로 멈추지 않는다/);
});

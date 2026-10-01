import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import { actionable, occKeysOf } from "./tick.ts";
import { mountTick, readSeen } from "./tick-run.ts";

// OCC의 상태에서 오는 줄(ATC-298): 도착 보고 누락, 앞 세션의 CHARTER REQUEST(wip), DUTY의 CHARTER REQUEST, S2 발부, 하루에 한 번의 TARGET·ROUTE 점검
const NOW = Date.parse("2026-10-01T06:00:00Z");
const base = () => ({
  dispatch: { mode: "on", open: [], held: [], inFlight: [], overdue: [], arrivalCandidates: [], arrivalMissing: [] },
  crewChange: { mode: "on", approved: [], overdue: [] },
  schedule: { mode: "shadow", open: [] as unknown[], inProgress: [] as unknown[], recent: [] as unknown[], candidates: { classify: [], prioritize: [], close: [], tail: [], waypoint: [] }, waypointGaps: [], slips: [], routesWithoutWaypoints: [], wip: [] as unknown[], duty: undefined as unknown },
  following: { items: [] },
});
const seenOf = (b: ReturnType<typeof base>) => new Set(occKeysOf(b, NOW));

test("OCC: 도착 보고 누락(due)은 처음 보일 때 한 번 act, due: false는 기다린다", () => {
  const b = base();
  b.dispatch.arrivalMissing = [{ flight: "ATC-205", due: true }, { flight: "ATC-300", due: false }] as never[];
  assert.deepEqual(occKeysOf(b, NOW).filter((k) => k.startsWith("arrival-missing")), ["arrival-missing:ATC-205"]);
  const first = actionable("occ", b, new Set(), NOW);
  assert.ok(first.reasons.includes("new:arrival-missing"));
  assert.equal(actionable("occ", b, seenOf(b), NOW).act, false); // 이미 보고했다
});

test("OCC: 앞 세션이 다듬던 CHARTER REQUEST(wip)는 처음 보일 때 act", () => {
  const b = base();
  b.schedule.wip = [{ id: "W-0001", text: "t", idleMin: 12 }];
  assert.ok(occKeysOf(b, NOW).includes("wip:W-0001"));
  assert.ok(actionable("occ", b, new Set(), NOW).reasons.includes("new:wip"));
  assert.equal(actionable("occ", b, seenOf(b), NOW).act, false);
});

test("OCC: DUTY의 CHARTER REQUEST는 기록할 때까지 매번 act, S2의 승인·발부 중인 작업도 act", () => {
  const b = base();
  b.schedule.duty = { mode: "on", shadow: false, charters: [{ id: "CR-0001", text: "t" }] };
  const seen = seenOf(b);
  assert.deepEqual(actionable("occ", b, seen, NOW).reasons, ["charter-request"]);
  assert.deepEqual(actionable("occ", b, seen, NOW).reasons, ["charter-request"]); // seen이 있어도 계속(기록 전)
  const c = base();
  c.schedule.mode = "approval";
  c.schedule.inProgress = [{ id: "S-0001", status: "approved" }, { id: "S-0002", status: "released" }, { id: "S-0003", status: "applied" }];
  assert.deepEqual(actionable("occ", c, seenOf(c), NOW).reasons, ["schedule-release"]);
  const d = base();
  d.schedule.inProgress = [{ id: "S-0003", status: "applied" }];
  assert.equal(actionable("occ", d, seenOf(d), NOW).act, false); // 끝난 것은 아니다
});

test("OCC: 24시간 안에 TARGET·ROUTE 초안이 없으면 날짜마다 한 번만 NETWORK 점검을 act로 알린다", () => {
  const b = base();
  const day = occKeysOf(b, NOW).filter((k) => k.startsWith("target-route"));
  assert.deepEqual(day, ["target-route:2026-10-01"]);
  assert.ok(actionable("occ", b, new Set(), NOW).reasons.includes("new:target-route"));
  assert.equal(actionable("occ", b, seenOf(b), NOW).act, false); // 오늘 한 번 알렸다
  assert.deepEqual(occKeysOf(b, NOW + 86_400_000).filter((k) => k.startsWith("target-route")), ["target-route:2026-10-02"]); // 다음 날 다시
  // 24시간 안에 쓴 TARGET·ROUTE 초안(열린 것이든 최근 것이든)이 있으면 점검하지 않는다
  b.schedule.open = [{ kind: "ROUTE", at: new Date(NOW - 3 * 3_600_000).toISOString() }];
  assert.deepEqual(occKeysOf(b, NOW), []);
  b.schedule.open = [];
  b.schedule.recent = [{ kind: "TARGET", at: new Date(NOW - 23 * 3_600_000).toISOString() }];
  assert.deepEqual(occKeysOf(b, NOW), []);
  b.schedule.recent = [{ kind: "TARGET", at: new Date(NOW - 25 * 3_600_000).toISOString() }, { kind: "CLASSIFY", at: new Date(NOW).toISOString() }];
  assert.equal(occKeysOf(b, NOW).length, 1); // 25시간 전과 다른 종류는 세지 않는다
});

test("GET /api/tick/occ: 새 항목은 한 번만 act하고 seen이 저장된다(TOWER와 같은 파일, 역할별 키)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tick-occ-"));
  try {
    const file = join(dir, "tick-seen.json");
    const b = base();
    b.dispatch.arrivalMissing = [{ flight: "ATC-205", due: true }] as never[];
    b.schedule.recent = [{ kind: "ROUTE", at: new Date().toISOString() }]; // 오늘의 NETWORK 점검은 이미 했다
    const app = new Hono();
    mountTick(app, {
      get: async (path) => (path.includes("dispatch") ? b.dispatch : path.includes("crew-changes") ? b.crewChange : path.includes("schedule") ? b.schedule : b.following),
      seenFile: () => file,
    });
    const call = async () => (await (await app.request("/api/tick/occ")).json()) as { act: boolean; reasons: string[] };
    assert.deepEqual((await call()).reasons, ["new:arrival-missing"]);
    assert.deepEqual(readSeen(file), { occ: ["arrival-missing:ATC-205"] });
    assert.equal((await call()).act, false);
    b.dispatch.arrivalMissing = [];
    assert.equal((await call()).act, false);
    assert.deepEqual(readSeen(file), { occ: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

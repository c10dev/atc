import assert from "node:assert/strict";
import test from "node:test";
import { hostMemoryOf, type MemInfo, nextOomState, NO_OOM, OOM_WINDOW_MS, oomInWindow, parseMeminfo, parseOomKill } from "./host-memory.ts";
import { hostMemoryNow, resetHostMemory } from "./host-memory-run.ts";
import { CONTROL_READ_OVERLAP_MS, controlOpsNow, resetControlOps } from "./supervisor-alerts-run.ts";
import { type AlertsInput, CONTROL_DOWN_GRACE_MS, type ControlDown, type ControlOp, controlGoneOf, destOf, mergeControlDown, supervisorAlertsOf } from "./supervisor-alerts.ts";

// ATC-203(ALERTING A1b): 관제 세션이 이유 불문 없을 때, 호스트 메모리 부족·OOM kill
const NOW = Date.parse("2026-10-03T06:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const SESSIONS = ["TOWER", "OCC", "MCC", "REVIEW"];
const op = (min: number, o: Partial<ControlOp> = {}): ControlOp => ({ t: ago(min), op: "stop", by: "atc", ok: true, ...o });
const gone = (running: string[], last: Record<string, ControlOp> = {}, now = NOW) => controlGoneOf({ sessions: SESSIONS, running: new Set(running), last: new Map(Object.entries(last)), now });

test("control|down: 살아 있는 행이 없는 관제 세션은 이유를 묻지 않고 조건이다(크래시·OOM·데몬 재시작)", () => {
  // 모두 떠 있다 → 없다
  assert.deepEqual(gone(SESSIONS), []);
  // 행이 없고 기록도 없다 → 이유를 모르는 채 있다
  const d = gone(["OCC", "MCC", "REVIEW"]);
  assert.deepEqual(d, [{ session: "TOWER", since: null, reason: "살아 있는 세션이 없음", gone: true }]);
  // 마지막 기록이 RECYCLE 중의 launch·recycled여도(2분이 지났다) 행이 없으면 없는 것이다
  const stale = gone(["OCC", "MCC", "REVIEW"], { TOWER: op(30, { op: "recycle", ok: true }) });
  assert.equal(stale.length, 1);
  assert.equal(stale[0]!.since, ago(30));
  assert.match(stale[0]!.reason, /recycle\(atc\) 10-03 05:30Z/); // 기록의 날짜와 시각(내려간 시각이 아니다)
});

test("control|down: SUPERVISOR가 직접 STOP한 것이 마지막 일이면 뺀다. 그 뒤에 launch가 있거나 STOP이 실패했거나 atc가 멈춘 것은 뺀 것이 아니다", () => {
  assert.deepEqual(gone(["OCC", "MCC", "REVIEW"], { TOWER: op(60, { op: "stop", by: "SUPERVISOR" }) }), []);
  // 그 STOP 뒤에 launch가 있었는데 행이 없다 → 다시 뜨지 않았다
  assert.equal(gone(["OCC", "MCC", "REVIEW"], { TOWER: op(30, { op: "launch", by: "SUPERVISOR" }) }).length, 1);
  // STOP이 실패했다
  assert.equal(gone(["OCC", "MCC", "REVIEW"], { TOWER: op(60, { op: "stop", by: "SUPERVISOR", ok: false }) }).length, 1);
  // atc(RECYCLE)가 멈춘 것은 SUPERVISOR의 뜻이 아니다
  assert.equal(gone(["OCC", "MCC", "REVIEW"], { TOWER: op(60, { op: "stop", by: "atc" }) }).length, 1);
});

test("control|down: 방금 뜨거나 멈춘 세션은 행이 나타날 때까지 잠깐(2분) 센 것으로 치지 않는다", () => {
  const recent = (min: number) => gone(["OCC", "MCC", "REVIEW"], { TOWER: op(min, { op: "launch", by: "SUPERVISOR" }) });
  assert.deepEqual(recent(1), []);
  assert.equal(recent(CONTROL_DOWN_GRACE_MS / 60_000 + 1).length, 1);
});

test("control|down: RECYCLE이 멈춘 채인 것과 합치면 세션마다 하나, RECYCLE 쪽 글이 이긴다", () => {
  const recycle: ControlDown[] = [{ session: "TOWER", since: ago(90), reason: "not trusted" }];
  const merged = mergeControlDown(recycle, [{ session: "TOWER", since: null, reason: "x", gone: true }, { session: "OCC", since: null, reason: "y", gone: true }]);
  assert.deepEqual(merged.map((c) => [c.session, c.gone ?? false]), [["OCC", true], ["TOWER", false]]);
  assert.equal(merged.find((c) => c.session === "TOWER")!.reason, "not trusted");
});

const base: AlertsInput = { sessions: [], alerts: [], workspaces: [], tickets: [], following: [], proposals: [], pulls: [] } as unknown as AlertsInput;
const down = (...names: string[]): ControlDown[] => names.map((session) => ({ session, since: ago(10), reason: "마지막 기록: launch(SUPERVISOR) 10-03 05:50Z", gone: true }));
const levelOf = (list: ControlDown[]) => Object.fromEntries(supervisorAlertsOf({ ...base, controlDown: list }).filter((a) => a.key.startsWith("control|down|")).map((a) => [a.key.split("|")[2], a.level]));

test("control|down: CAUTION, TOWER나 MCC가 없거나 둘 이상이 한꺼번에 없으면 WARNING. 키는 세션마다 그대로고 dest는 alerts", () => {
  assert.deepEqual(levelOf(down("OCC")), { OCC: "caution" });
  assert.deepEqual(levelOf(down("REVIEW")), { REVIEW: "caution" });
  assert.deepEqual(levelOf(down("TOWER")), { TOWER: "warning" });
  assert.deepEqual(levelOf(down("MCC")), { MCC: "warning" });
  assert.deepEqual(levelOf(down("OCC", "REVIEW")), { OCC: "warning", REVIEW: "warning" });
  const [a] = supervisorAlertsOf({ ...base, controlDown: down("OCC") }).filter((x) => x.key === "control|down|OCC");
  assert.equal(a!.dest, "alerts");
  assert.match(a!.text, /OCC/);
  assert.match(a!.text, /마지막 기록/);
  assert.doesNotMatch(a!.text, /부터/); // 내려간 시각을 모르니 "부터"라고 하지 않는다
  assert.match(a!.next, /LAUNCH/);
  // 기록이 없으면 이유만
  const [b] = supervisorAlertsOf({ ...base, controlDown: [{ session: "OCC", since: null, reason: "살아 있는 세션이 없음", gone: true }] });
  assert.equal(b!.since, null);
});

const GB = 1024 * 1024; // kB
const mem = (o: Partial<MemInfo> = {}): MemInfo => ({ totalKb: 16 * GB, availableKb: 8 * GB, swapTotalKb: 4 * GB, swapFreeKb: 4 * GB, ...o });

test("parseMeminfo·parseOomKill: /proc의 글에서 값을 읽고, 줄이 없으면 null", () => {
  const text = "MemTotal:       51374700 kB\nMemFree:  100 kB\nMemAvailable:   15713636 kB\nSwapTotal:       4194300 kB\nSwapFree:            128 kB\n";
  assert.deepEqual(parseMeminfo(text), { totalKb: 51374700, availableKb: 15713636, swapTotalKb: 4194300, swapFreeKb: 128 });
  assert.equal(parseMeminfo("MemTotal: 1 kB\n"), null);
  assert.equal(parseMeminfo(""), null);
  assert.equal(parseOomKill("nr_free_pages 5\noom_kill 3\npgfault 9\n"), 3);
  assert.equal(parseOomKill("nr_free_pages 5\n"), null);
});

test("host|memory CAUTION: 가용 < 10%이고 swap 사용 > 80%일 때만(둘 다). 하나만이면 없다", () => {
  const low = 1.2 * GB; // 16 GB의 7.5%
  assert.equal(hostMemoryOf(mem({ availableKb: low, swapFreeKb: 0.2 * GB }), NO_OOM, NOW)?.level, "caution"); // swap 95%
  assert.equal(hostMemoryOf(mem({ availableKb: low, swapFreeKb: 2 * GB }), NO_OOM, NOW), null); // swap 50%
  assert.equal(hostMemoryOf(mem({ availableKb: 8 * GB, swapFreeKb: 0 }), NO_OOM, NOW), null); // 가용 충분
  // 경계: 정확히 10%는 아니다, 80%는 아니다
  assert.equal(hostMemoryOf(mem({ availableKb: 1.6 * GB, swapFreeKb: 0 }), NO_OOM, NOW), null);
  assert.equal(hostMemoryOf(mem({ availableKb: low, swapFreeKb: 0.8 * GB }), NO_OOM, NOW), null); // swap 80%
  // swap이 아예 없으면 가용 메모리만 본다
  assert.equal(hostMemoryOf(mem({ availableKb: low, swapTotalKb: 0, swapFreeKb: 0 }), NO_OOM, NOW)?.level, "caution");
  assert.equal(hostMemoryOf(null, NO_OOM, NOW), null);
});

test("OOM 기억: 처음 본 값은 기준일 뿐, 오른 만큼만 30분 동안 센다, 값이 줄면(재부팅) 다시 기준", () => {
  let s = nextOomState(NO_OOM, 5, NOW);
  assert.deepEqual(s, { last: 5, rises: [] });
  assert.equal(oomInWindow(s, NOW), 0);
  s = nextOomState(s, 8, NOW + 60_000);
  assert.equal(oomInWindow(s, NOW + 60_000), 3);
  s = nextOomState(s, 9, NOW + 120_000);
  assert.equal(oomInWindow(s, NOW + 120_000), 4);
  // 30분이 지나면 빠진다
  assert.equal(oomInWindow(s, NOW + 60_000 + OOM_WINDOW_MS), 1); // 첫 상승(+60s)만 지났고 둘째(+120s)는 남음
  assert.equal(oomInWindow(s, NOW + 120_000 + OOM_WINDOW_MS), 0);
  // 값이 줄었다 → 기준만 바꾼다
  s = nextOomState(s, 2, NOW + 200_000);
  assert.equal(s.last, 2);
  // 읽지 못했다(null) → 마지막 값을 지킨다
  assert.equal(nextOomState(s, null, NOW + 300_000).last, 2);
});

test("host|memory WARNING: 30분 안에 oom_kill이 올랐다. 글에 가용·swap·OOM 수를 싣는다. 둘 다면 WARNING", () => {
  const oom = nextOomState(nextOomState(NO_OOM, 0, NOW), 3, NOW + 60_000);
  const w = hostMemoryOf(mem({ availableKb: 1.2 * GB, swapFreeKb: 0.08 * GB }), oom, NOW + 90_000)!;
  assert.equal(w.level, "warning");
  assert.equal(w.text, "메모리 부족: 가용 1.2 GB · swap 98% · OOM kill 3회(30분)");
  // 메모리는 충분해도 OOM이 있었으면 WARNING
  assert.equal(hostMemoryOf(mem(), oom, NOW + 90_000)?.level, "warning");
  // 30분이 지나면 사라진다
  assert.equal(hostMemoryOf(mem(), oom, NOW + 60_000 + OOM_WINDOW_MS), null);
});

test("host|memory: 항목은 키 하나(host|memory), dest는 alerts, 서버 재시작은 기준만 다시 잡는다", () => {
  const item = supervisorAlertsOf({ ...base, hostMemory: hostMemoryOf(mem({ availableKb: 1.2 * GB, swapFreeKb: 0.08 * GB }), NO_OOM, NOW) }).filter((a) => a.key === "host|memory");
  assert.equal(item.length, 1);
  assert.equal(item[0]!.dest, "alerts");
  assert.equal(item[0]!.level, "caution");
  assert.equal(destOf({ key: "host|memory" }), "alerts");
  assert.equal(supervisorAlertsOf({ ...base, hostMemory: null }).some((a) => a.key.startsWith("host|")), false);
  // 읽는 모듈: 첫 읽기는 기준(켜기 전의 kill은 세지 않는다), 이후 오르면 WARNING, 파일이 없으면 항목이 없다
  resetHostMemory();
  const meminfo = "MemTotal: 16777216 kB\nMemAvailable: 8388608 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n";
  assert.equal(hostMemoryNow(NOW, { meminfo, vmstat: "oom_kill 7\n" }), null);
  assert.equal(hostMemoryNow(NOW + 5_000, { meminfo, vmstat: "oom_kill 7\n" }), null);
  assert.equal(hostMemoryNow(NOW + 10_000, { meminfo, vmstat: "oom_kill 9\n" })?.oom, 2);
  assert.equal(hostMemoryNow(NOW + 15_000, { meminfo: null, vmstat: null }), null);
  resetHostMemory();
});

// 늦게 붙은 기록(ATC-203 MCC 지적): launchControl은 t를 먼저 정하고 claude 호출을 한 뒤에 기록을 붙인다
test("controlOpsNow: 오래 걸린 launch가 나중에 붙어도(t가 옛날) 읽는다 — 안 그러면 옛 SUPERVISOR STOP이 남아 죽은 세션을 뜻한 것으로 오해한다", () => {
  resetControlOps();
  const line = (t: number, op: "launch" | "stop", by = "SUPERVISOR") => ({ t: new Date(t).toISOString(), kind: "control", op, session: "TOWER", by, ok: true }) as never;
  const stop = line(NOW - 60 * 60_000, "stop");
  // 첫 읽기: SUPERVISOR의 STOP
  assert.equal(controlOpsNow(NOW, () => [stop]).get("TOWER")?.op, "stop");
  // launch는 NOW+1초에 시작해 40초 걸려 NOW+41초에 기록이 붙었다(t는 시작 시각). 다음 읽기는 NOW+60초: 10초 겹침이면 NOW+50초부터라 놓친다
  const launch = line(NOW + 1_000, "launch");
  const second = NOW + 60_000;
  const seen: number[] = [];
  const read = (since: number) => {
    seen.push(since);
    return [stop, launch].filter((r) => Date.parse((r as { t: string }).t) >= since);
  };
  const m = controlOpsNow(second, read);
  assert.equal(m.get("TOWER")?.op, "launch", "늦게 붙은 launch를 놓쳤다");
  // 겹침은 5분이다: 첫 읽기에서 NOW-5분을 다음 읽기의 시작으로 정했다
  assert.equal(seen[0], NOW - CONTROL_READ_OVERLAP_MS);
  // 같은 줄을 두 번 읽어도 같은 결과다
  assert.equal(controlOpsNow(second + 30_000, read).get("TOWER")?.op, "launch");
  // 그 launch 뒤에 세션이 사라지면 SUPERVISOR의 STOP이 아니라 없는 세션이다
  assert.equal(controlGoneOf({ sessions: ["TOWER"], running: new Set(), last: m, now: second + 10 * 60_000 }).length, 1);
  resetControlOps();
});

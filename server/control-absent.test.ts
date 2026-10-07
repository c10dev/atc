import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { type AbsentLine, absentCountsOf, absentMinutesByDay, absentProofOf, escalationKeyOf, parseAbsentSettings, type ProofFacts, type StepInput, stepOf } from "./control-absent.ts";
import { supervisorAlertsOf } from "./supervisor-alerts.ts";
import { DEFAULT_PREFS, soundFor } from "../web/src/supervisor-alerts.ts";

// CONTROL ABSENT(ATC-532): 순수 판단. 주입한 증거·시계만 쓴다(/proc·FLIGHT RECORDER를 읽지 않는다)
const MIN = 60_000;
const T0 = Date.parse("2026-10-07T03:30:00Z");
const ON = parseAbsentSettings(null);
const GONE = { proof: "gone" as const, why: "호스트가 03:23Z에 다시 켜짐" };
const LIVE = { proof: "live" as const, why: "관제 폴더에서 도는 프로세스 pid 42" };
const base = (o: Partial<StepInput> = {}): StepInput => ({ absentSince: T0, startup: false, firstPassAt: T0 - 60 * MIN, now: T0 + 25 * MIN, settings: ON, auto: true, production: true, proof: () => GONE, attempted: null, lastRelaunchAt: null, escalation: null, acked: false, ...o });

test("설정: 파일이 없거나 모르는 값이면 모두 on·20분, off는 SUPERVISOR가 쓴 것만", () => {
  assert.deepEqual(parseAbsentSettings(null), { relaunch: "on", escalate: "on", quietPass: "on", limitMin: 20 });
  assert.deepEqual(parseAbsentSettings({ relaunch: "off", escalate: "maybe", quietPass: "off", limitMin: 7 }), { relaunch: "off", escalate: "on", quietPass: "off", limitMin: 20 });
  assert.equal(parseAbsentSettings({ limitMin: 45 }).limitMin, 45);
});

test("증거: 살아 있는 줄·관제 폴더의 프로세스·살아 있는 worker는 live, 재부팅·state.json 끝·roster에 worker 없음은 gone, 그 밖은 unknown", () => {
  const job = { id: "abc123", launchedAt: T0 - 120 * MIN };
  const f = (o: Partial<ProofFacts>): ProofFacts => ({ liveRows: [], cwdPids: [], lastJob: job, jobState: "done", workerLive: null, bootAt: null, ...o });
  assert.equal(absentProofOf(f({ liveRows: ["9f00aa"] })).proof, "live");
  assert.equal(absentProofOf(f({ cwdPids: [42], bootAt: T0 })).proof, "live"); // 재부팅 증거보다 살아 있는 프로세스가 이긴다
  assert.equal(absentProofOf(f({ workerLive: true })).proof, "live");
  assert.deepEqual(absentProofOf(f({ bootAt: T0 - 7 * MIN })), { proof: "gone", why: "호스트가 03:23Z에 다시 켜짐(job abc123는 그 전에 뜸)" });
  assert.equal(absentProofOf(f({ bootAt: T0 - 600 * MIN })).proof, "unknown"); // job이 부팅 뒤에 떴다
  assert.equal(absentProofOf(f({ jobState: "stopped" })).proof, "gone");
  assert.equal(absentProofOf(f({ workerLive: false })).proof, "gone");
  assert.equal(absentProofOf(f({})).proof, "unknown"); // daemon이 없어 roster를 못 믿는다
  assert.equal(absentProofOf(f({ lastJob: null, workerLive: false, bootAt: T0 })).proof, "unknown"); // 띄운 기록이 없으면 일부러 내려 둔 것일 수 있다
});

test("판단: 25분 없음 + gone 증거 → 다시 띄움 / 살아 있는 증거 → 알림 / 한도 전 → 아무것도 / 스위치 off → 아무것도", () => {
  assert.equal(stepOf(base(), "TOWER").do, "relaunch");
  const alive = stepOf(base({ proof: () => LIVE }), "TOWER");
  assert.equal(alive.do, "escalate");
  assert.match((alive as { why: string }).why, /살아 있는 증거: 관제 폴더/);
  assert.equal(stepOf(base({ now: T0 + 15 * MIN }), "TOWER").do, "wait");
  const off = { ...ON, relaunch: "off" as const, escalate: "off" as const };
  assert.equal(stepOf(base({ settings: off }), "TOWER").do, "hold");
  // 다시 띄우기만 끄면 알림
  assert.equal(stepOf(base({ settings: { ...ON, relaunch: "off" } }), "TOWER").do, "escalate");
});

test("판단: 서버가 뜬 직후 이미 없던 역할은 20분이 아니라 첫 판단 + 2분에 판단한다(재부팅)", () => {
  const i = base({ startup: true, firstPassAt: T0, absentSince: T0 });
  assert.equal(stepOf({ ...i, now: T0 + 1 * MIN }, "MCC").do, "wait");
  assert.equal(stepOf({ ...i, now: T0 + 2 * MIN }, "MCC").do, "relaunch");
  // 서버가 뜬 직후는 한 시간에 한 번 규칙을 지나간다
  assert.equal(stepOf({ ...i, now: T0 + 2 * MIN, lastRelaunchAt: T0 - 10 * MIN }, "MCC").do, "relaunch");
  assert.equal(stepOf(base({ lastRelaunchAt: T0 - 10 * MIN }), "MCC").do, "escalate");
});

test("판단: auto.OCC false면 알림만, 운영 서버가 아니면 알림만, 거절된 뒤에는 알림, 확인했으면 조용, 30분마다 n+1", () => {
  const occ = stepOf(base({ auto: false }), "OCC");
  assert.deepEqual(occ, { do: "escalate", n: 1, why: "control-recycle.json auto.OCC가 false — 알림만" });
  assert.match((stepOf(base({ production: false }), "TOWER") as { why: string }).why, /운영 서버가 아님/);
  assert.deepEqual(stepOf(base({ attempted: "다시 띄우기 거절·실패: ACCOUNT acct-1는 FUEL hold 수준" }), "TOWER"), { do: "escalate", n: 1, why: "다시 띄우기 거절·실패: ACCOUNT acct-1는 FUEL hold 수준" });
  assert.equal(stepOf(base({ auto: false, acked: true, escalation: { n: 1, at: T0 } }), "OCC").do, "hold");
  assert.equal(stepOf(base({ auto: false, escalation: { n: 1, at: T0 + 20 * MIN } }), "OCC").do, "hold");
  assert.deepEqual(stepOf(base({ auto: false, escalation: { n: 2, at: T0 - 6 * MIN } }), "OCC"), { do: "escalate", n: 3, why: "control-recycle.json auto.OCC가 false — 알림만" });
  // 증거는 다른 막음이 없을 때만 읽는다
  let read = 0;
  stepOf(base({ auto: false, proof: () => (read++, GONE) }), "OCC");
  assert.equal(read, 0);
});

const line = (t: number, o: Partial<AbsentLine> & Pick<AbsentLine, "event" | "session">): AbsentLine => ({ t: new Date(t).toISOString(), kind: "control", op: "absent", by: "atc", ...o });

test("세기: 다시 띄운 뒤 한 시간 안의 같은 이름 job 중복(ATC-521)과 오탐 표시가 오작동, 역할별 수와 없던 분", () => {
  const lines = [
    line(T0, { event: "start", session: "TOWER" }),
    line(T0 + 2 * MIN, { event: "relaunch", session: "TOWER", ok: true, jobId: "aa11bb" }),
    line(T0 + 3 * MIN, { event: "end", session: "TOWER", minutes: 3 }),
    line(T0, { event: "start", session: "OCC" }),
    line(T0 + 20 * MIN, { event: "escalate", session: "OCC", n: 1, why: "auto" }),
    line(T0 + 50 * MIN, { event: "escalate", session: "OCC", n: 2, why: "auto" }),
    line(T0 + 55 * MIN, { event: "false", session: "OCC", of: new Date(T0 + 20 * MIN).toISOString() }),
    line(T0 + 60 * MIN, { event: "end", session: "OCC", minutes: 60 }),
    line(T0 + 70 * MIN, { event: "relaunch", session: "MCC", ok: false, why: "FUEL hold" }),
  ];
  const dup = [{ t: new Date(T0 + 40 * MIN).toISOString(), kind: "control", op: "stop-check", event: "duplicate", session: "TOWER" }];
  const c = absentCountsOf(lines, dup, T0 - MIN, T0 + 120 * MIN);
  assert.deepEqual([c.relaunches, c.relaunchFailed, c.escalations, c.repeats, c.duplicates, c.falseEscalations, c.absentMin], [1, 1, 1, 1, 1, 1, 63]);
  assert.deepEqual(c.bySession.TOWER, { relaunches: 1, escalations: 0, absentMin: 3 });
  assert.deepEqual(c.bySession.OCC, { relaunches: 0, escalations: 1, absentMin: 60 });
  // 중복이 한 시간 뒤면 세지 않는다
  assert.equal(absentCountsOf(lines, [{ ...dup[0]!, t: new Date(T0 + 70 * MIN).toISOString() }], T0 - MIN, T0 + 120 * MIN).duplicates, 0);
  // 날마다 없던 분: 열린 없음은 지금까지, 자정을 넘으면 나눈다
  const night = [line(Date.parse("2026-10-06T23:30:00Z"), { event: "start", session: "MCC" })];
  const days = absentMinutesByDay(night, Date.parse("2026-10-07T00:45:00Z"), 2);
  assert.deepEqual(days, [{ day: "2026-10-06", minutes: { MCC: 30 } }, { day: "2026-10-07", minutes: { MCC: 45 } }]);
});

test("알림: control|absent|<세션>|<n> WARNING, passQuiet는 스위치를 따르고, 브라우저는 조용한 시간에도 그것만 울린다", () => {
  const e = { session: "TOWER", n: 2, since: new Date(T0).toISOString(), at: new Date(T0 + 50 * MIN).toISOString(), minutes: 50, lastJobId: "abc123", why: "증거 없음: daemon이 없어 job abc123가 사라졌는지 확인하지 못함", passQuiet: true };
  const items = supervisorAlertsOf({ sessions: [], alerts: [], workspaces: [], tickets: [], following: [], proposals: [], pulls: [], rts: null, controlAbsent: [e] });
  const a = items.find((x) => x.key.startsWith("control|absent"))!;
  assert.equal(a.key, escalationKeyOf(e));
  assert.equal(a.key, "control|absent|TOWER|2");
  assert.equal(a.level, "warning");
  assert.equal(a.dest, "alerts");
  assert.equal(a.passQuiet, true);
  assert.match(a.text, /관제 세션 TOWER 50분째 없음 — 마지막 job abc123 · atc가 다시 띄우지 않은 이유: 증거 없음/);
  const plain = supervisorAlertsOf({ sessions: [], alerts: [], workspaces: [], tickets: [], following: [], proposals: [], pulls: [], rts: null, controlAbsent: [{ ...e, passQuiet: false }] }).find((x) => x.key.startsWith("control|absent"))!;
  assert.equal(plain.passQuiet, undefined);
  // 조용한 시간(모든 시각): passQuiet만 울린다
  const prefs = { ...DEFAULT_PREFS, sound: true, quiet: { on: true, from: "00:00", to: "23:59" }, sounds: { ...DEFAULT_PREFS.sounds, warning: true } };
  const at = new Date(2026, 9, 7, 12, 0).getTime();
  assert.equal(soundFor([a], prefs, at, { lastSounded: {}, playing: null }).sound, "warning");
  assert.equal(soundFor([plain], prefs, at, { lastSounded: {}, playing: null }).sound, null);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { type AlertsInput, diffAlerts, type SupervisorAlert, supervisorAlertsOf } from "./supervisor-alerts.ts";

const base = (over: Partial<AlertsInput> = {}): AlertsInput => ({ sessions: [], alerts: [], workspaces: [], tickets: [], following: [], proposals: [], pulls: [], rts: null, ...over });
const session = (id: string, name: string, health: unknown = null, status = "idle") => ({ id, name, status, health }) as AlertsInput["sessions"][number];
const health = (code: string, over: Record<string, unknown> = {}) => ({ code, level: "alert", since: "2026-09-29T01:00:00Z", detail: "d", next: `next ${code}`, holds: true, ...over });
const pull = (over: Partial<AlertsInput["pulls"][number]> = {}) => ({ repo: "/r", number: 7, title: "T", head: "abc", landing: "APPROACH", draft: false, ticketKey: "ATC-7", humanCheck: null, ...over }) as AlertsInput["pulls"][number];
const proposal = (over: Record<string, unknown> = {}) => ({ id: "D-0001", kind: "ASSIGN", status: "proposed", flight: "ATC-7", aircraftName: "TEAM_E", holdAt: null, statusAt: "2026-09-29T01:00:00Z", ...over }) as AlertsInput["proposals"][number];
const keys = (xs: SupervisorAlert[]) => xs.map((x) => x.key);

test("ALERT는 ATC-110 등급 그대로, health는 health 종류, 이름과 다음 걸음이 붙는다", () => {
  const out = supervisorAlertsOf(
    base({
      sessions: [session("s1", "TEAM_G", health("STALLED"))],
      alerts: [
        { kind: "health", key: "health|STALLED|s1", message: "STALLED — TEAM_G", sessionIds: ["s1"] },
        { kind: "conflict", message: "같은 STAND", sessionIds: ["s1"], workspacePath: "/ws/a" },
      ],
      workspaces: [{ path: "/ws/a", ticketKey: "ATC-1" }],
    }),
  );
  assert.deepEqual(out.map((a) => [a.group, a.level, a.aircraft, a.flight]), [["health", "caution", "TEAM_G", null], ["alert", "warning", "TEAM_G", "ATC-1"]]);
  assert.equal(out[0].next, "next STALLED");
  assert.equal(out[0].key, "alert|health|STALLED|s1");
});

test("PENDING(도구 승인 대기)은 CALL이고, 죽은 세션은 알리지 않는다", () => {
  const out = supervisorAlertsOf(base({ sessions: [session("s1", "TEAM_A", health("PENDING", { level: "info" })), session("s2", "TEAM_B", health("PENDING"), "dead")] }));
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].group, out[0].cue, out[0].aircraft], ["pending", "call", "TEAM_A"]);
});

test("FLIGHT FOLLOWING: warn은 CAUTION, info는 ADVISORY, health·stranded·landing-wait는 다른 경로가 알리므로 뺀다", () => {
  const issue = (code: string, severity: "warn" | "info") => ({ code, kind: "delay", severity, text: code, since: "2026-09-29T00:00:00Z", key: `ATC-1|${code}` }) as never;
  const out = supervisorAlertsOf(base({ following: [{ flight: "ATC-1", aircraft: "TEAM_E", issues: [issue("await-supervisor", "warn"), issue("merged-not-done", "info"), issue("health", "warn"), issue("stranded", "warn"), issue("landing-wait", "info")] }] }));
  assert.deepEqual(out.map((a) => [a.key, a.level, a.group]), [["following|ATC-1|await-supervisor", "caution", "following"], ["following|ATC-1|merged-not-done", "advisory", "following"]]);
  assert.equal(out[0].next, "그 세션에서 직접 go를 친다");
});

test("제안 판정 대기는 CALL, HOLD 걸린 제안과 끝난 제안은 알리지 않는다", () => {
  const out = supervisorAlertsOf(base({ proposals: [proposal(), proposal({ id: "D-0002", status: "sent" }), proposal({ id: "D-0003", holdAt: "2026-09-29T00:00:00Z" }), proposal({ id: "D-0004", status: "agreed", kind: "RELEASE" })] }));
  assert.deepEqual(keys(out), ["pending|proposal|D-0001", "pending|proposal|D-0004"]);
  assert.ok(out.every((a) => a.cue === "call" && a.link === "#dispatch"));
  assert.match(out[1].text, /RELEASE/);
});

test("PR: CLEARED는 착륙 가능, HUMAN CHECK 대기는 CALL, 초안은 뺀다. head가 바뀌면 새 key", () => {
  const hc = { required: true, classes: [], state: "pending", sha: null, carriedFrom: null };
  const out = supervisorAlertsOf(base({ pulls: [pull({ landing: "CLEARED" }), pull({ number: 8, humanCheck: hc as never }), pull({ number: 9, landing: "CLEARED", draft: true })] }));
  assert.deepEqual(keys(out), ["land|/r#7|abc", "pending|humancheck|/r#8|abc"]);
  assert.deepEqual(out.map((a) => [a.group, a.level, a.cue]), [["land", "advisory", null], ["pending", "advisory", "call"]]);
  assert.notEqual(keys(supervisorAlertsOf(base({ pulls: [pull({ landing: "CLEARED", head: "def" })] })))[0], keys(out)[0]);
  const done = { ...hc, state: "done" } as never;
  assert.deepEqual(supervisorAlertsOf(base({ pulls: [pull({ humanCheck: done })] })), []);
});

test("RTS 결과: ok는 DONE, rollback·failed는 WARNING, refused는 CAUTION, running은 아직 아니다", () => {
  const rts = (result: string) => ({ at: "2026-09-29T02:00:00Z", from: "aaaaaaa1", to: "bbbbbbb2", result, detail: "x" }) as never;
  const one = (r: string) => supervisorAlertsOf(base({ rts: rts(r) }))[0];
  assert.deepEqual([one("ok").level, one("ok").cue], [null, "done"]);
  assert.equal(one("rollback").level, "warning");
  assert.equal(one("failed").level, "warning");
  assert.equal(one("refused").level, "caution");
  assert.equal(one("running"), undefined);
  assert.match(one("ok").text, /RTS aaaaaaa → bbbbbbb OK/);
});

test("같은 key는 한 번만", () => {
  const a = { kind: "no-workspace", message: "m", ticketKey: "ATC-1" } as never;
  assert.equal(supervisorAlertsOf(base({ alerts: [a, a] })).length, 1);
});

test("diffAlerts: 처음 생긴 key와 사라진 key", () => {
  const mk = (key: string) => ({ key }) as SupervisorAlert;
  const prev = new Map([["a", mk("a")], ["b", mk("b")]]);
  const d = diffAlerts(prev, [mk("b"), mk("c")]);
  assert.deepEqual([keys(d.raised), d.cleared], [["c"], ["a"]]);
  assert.deepEqual(diffAlerts(new Map(), []), { raised: [], cleared: [] });
});

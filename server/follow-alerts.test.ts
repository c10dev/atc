import assert from "node:assert/strict";
import { test } from "node:test";
import { summaryOf } from "./supervisor-summary.ts";
import { type AlertsInput, diffAlerts, type FollowAlertRow, supervisorAlertsOf } from "./supervisor-alerts.ts";
import { DEFAULT_PREFS, GROUP_LABEL, parsePrefs } from "../web/src/supervisor-alerts.ts";
import { proposalAlertKey } from "../web/src/dispatch-alerts.ts";

// ATC-278 (docs/follow.md 3.5): follow 그룹. 줄은 followBoardOf가 이미 센 것이다 — 여기서는 키만 세운다
const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const base: AlertsInput = { sessions: [], alerts: [], workspaces: [], tickets: [], following: [], proposals: [], pulls: [], rts: null };
const cell = (done: boolean, at: string | null = null, na = false) => ({ done, at, na });
const row = (key: string, over: Partial<FollowAlertRow> = {}): FollowAlertRow => ({
  key,
  title: `제목 ${key}`,
  finished: false,
  current: "todo",
  stages: { todo: cell(true), proposed: cell(false), approved: cell(false), sent: cell(false), readback: cell(false), pr: cell(false), ci: cell(false), landed: cell(false), deployed: cell(false) },
  issues: [],
  proposal: null,
  ready: false,
  goAround: null,
  reverted: null,
  ...over,
});
const withStages = (over: Partial<FollowAlertRow["stages"]>): FollowAlertRow["stages"] => ({ ...row("x").stages, ...over });
const run = (rows: FollowAlertRow[], over: Partial<AlertsInput> = {}) => supervisorAlertsOf({ ...base, ...over, follow: { rows, now: NOW } });
const keys = (items: { key: string }[]) => items.map((a) => a.key).filter((k) => k.startsWith("follow|"));

test("follow|ready|<KEY>: queue, cue call. 풀 수 있게 되면 한 번, 풀리면(Todo가 되면) 사라진다", () => {
  const on = run([row("ATC-5", { ready: true })]);
  const a = on.find((x) => x.key === "follow|ready|ATC-5")!;
  assert.equal(a.dest, "queue");
  assert.equal(a.cue, "call");
  assert.equal(a.group, "follow");
  assert.equal(a.link, "#follow");
  assert.match(a.text, /ATC-5 제목 ATC-5 — 풀 수 있음/);
  // 풀었다: ready가 꺼진다 → 사라진다
  const d = diffAlerts(new Map(on.map((x) => [x.key, x])), run([row("ATC-5", { ready: false })]));
  assert.deepEqual(d.cleared, ["follow|ready|ATC-5"]);
  // 끝난 줄은 내지 않는다
  assert.deepEqual(keys(run([row("ATC-5", { ready: true, finished: true })])), []);
});

test("follow|approve|<D-id>: 따라가는 줄의 제안은 pending|proposal을 대신한다(이중 알림 없음). 따라가지 않는 제안은 그대로", () => {
  const proposals = [
    { id: "D-1", kind: "ASSIGN" as const, status: "proposed" as const, flight: "ATC-5", aircraftName: "TEAM_K", holdAt: null, statusAt: iso(5) },
    { id: "D-2", kind: "ASSIGN" as const, status: "proposed" as const, flight: "ATC-6", aircraftName: "TEAM_L", holdAt: null, statusAt: iso(5) },
  ];
  const out = run([row("ATC-5", { proposal: "D-1" })], { proposals });
  const all = out.map((a) => a.key);
  assert.ok(all.includes("follow|approve|D-1"));
  assert.ok(!all.includes("pending|proposal|D-1"), "같은 제안에 두 줄이 나왔다");
  assert.ok(all.includes("pending|proposal|D-2"));
  const a = out.find((x) => x.key === "follow|approve|D-1")!;
  assert.equal(a.dest, "queue");
  assert.equal(a.cue, "call");
  assert.equal(a.link, "#dispatch");
  assert.equal(a.ask, "assign");
  assert.equal(a.aircraft, "TEAM_K");
  // follow가 없으면 전과 같다
  assert.deepEqual(supervisorAlertsOf({ ...base, proposals }).map((x) => x.key).sort(), ["pending|proposal|D-1", "pending|proposal|D-2"]);
  // 제안이 판정을 받으면(승인) 사라진다
  const approved = run([row("ATC-5", { proposal: "D-1" })], { proposals: [{ ...proposals[0]!, status: "approved" as never }] });
  assert.ok(!approved.some((x) => x.key.includes("D-1")));
});

test("follow가 만든 approve도 SUMMARY의 DISPATCH 승인 대기에 세고, DISPATCH 탭이 다시 읽을 키에도 든다", () => {
  const items = run([row("ATC-5", { proposal: "D-1" })], {
    proposals: [
      { id: "D-1", kind: "ASSIGN", status: "proposed", flight: "ATC-5", aircraftName: "TEAM_K", holdAt: null, statusAt: iso(5) },
      { id: "D-2", kind: "ASSIGN", status: "proposed", flight: "ATC-6", aircraftName: "TEAM_L", holdAt: null, statusAt: iso(5) },
    ],
  });
  const s = summaryOf({ items, fuelAccounts: [], rts: null, working: { aircraft: 0, control: 0 }, at: iso(0) });
  assert.equal(s.pending.dispatch, 2);
  assert.equal(proposalAlertKey(items), "follow|approve|D-1,pending|proposal|D-2");
});

test("follow|stuck|<KEY>|<stage>: FLIGHT FOLLOWING의 warn 문제 하나를 줄 단위로 알린다. 같은 문제의 following 항목은 내지 않는다", () => {
  const issue = (code: string, severity: "warn" | "info", n = "") => ({ code: code as never, severity, text: `문제 ${code}${n}` });
  const following: AlertsInput["following"] = [{ flight: "ATC-5", aircraft: "TEAM_K", issues: [{ code: "no-pr" as const, kind: "delay" as const, severity: "warn" as const, text: "PR 없음", since: iso(30), key: "ATC-5|no-pr" }, { code: "await-supervisor" as const, kind: "delay" as const, severity: "warn" as const, text: "go 대기", since: iso(30), key: "ATC-5|await-supervisor|D-1" }] }, { flight: "ATC-9", aircraft: "TEAM_L", issues: [{ code: "no-pr" as const, kind: "delay" as const, severity: "warn" as const, text: "PR 없음", since: iso(30), key: "ATC-9|no-pr" }] }];
  const out = run([row("ATC-5", { current: "readback", issues: [issue("no-pr", "warn"), issue("no-departure", "warn"), issue("landing-wait", "info")] })], { following });
  const stuck = out.find((x) => x.key === "follow|stuck|ATC-5|readback")!;
  assert.equal(stuck.dest, "alerts");
  assert.equal(stuck.level, "caution");
  assert.match(stuck.text, /막힘: 문제 no-pr \(외 1건\)/);
  const all = out.map((a) => a.key);
  assert.ok(!all.includes("following|ATC-5|no-pr"), "following이 같은 문제를 또 냈다");
  assert.ok(all.includes("following|ATC-5|await-supervisor|D-1"), "결정 대기는 following 그룹이 queue로 보낸다");
  assert.ok(all.includes("following|ATC-9|no-pr"), "따라가지 않는 FLIGHT는 그대로");
  // 단계가 바뀌면 key가 바뀐다(다음 단계의 막힘은 새 항목)
  const next = run([row("ATC-5", { current: "pr", issues: [issue("no-pr", "warn")] })], { following });
  assert.ok(next.some((x) => x.key === "follow|stuck|ATC-5|pr"));
  // info만이면 stuck이 아니다. 끝난 줄도 아니다
  assert.deepEqual(keys(run([row("ATC-5", { issues: [issue("landing-wait", "info")] })])), []);
  assert.deepEqual(keys(run([row("ATC-5", { finished: true, issues: [issue("no-pr", "warn")] })])), []);
  // 단계가 없으면 todo
  assert.ok(run([row("ATC-5", { current: null, issues: [issue("review-no-pr", "warn")] })]).some((x) => x.key === "follow|stuck|ATC-5|todo"));
});

test("follow|failed|<KEY>: GO AROUND, ROLLBACK 뒤 배포 안 된 착륙, 되돌려진 ON. alerts, WARNING. 사유가 한 줄에 모인다", () => {
  const go = run([row("ATC-5", { goAround: { id: "C-1", readbackAt: null } })]).find((x) => x.key === "follow|failed|ATC-5")!;
  assert.equal(go.dest, "alerts");
  assert.equal(go.level, "warning");
  assert.match(go.text, /GO AROUND C-1 \(READBACK 대기\)/);
  assert.match(run([row("ATC-5", { goAround: { id: "C-1", readbackAt: iso(1) } })]).find((x) => x.key === "follow|failed|ATC-5")!.text, /GO AROUND C-1$/);
  // RTS ROLLBACK: 그 RTS보다 먼저 착륙했고 아직 배포되지 않은 줄
  const landed = row("ATC-6", { current: "landed", stages: withStages({ landed: cell(true, iso(30)) }) });
  const rts = (result: string, at = iso(10)) => ({ at, from: "aaaaaaa1", to: "bbbbbbb2", result: result as never, detail: "" });
  assert.ok(run([landed], { rts: rts("rollback") }).some((x) => x.key === "follow|failed|ATC-6" && /RTS ROLLBACK/.test(x.text)));
  assert.ok(run([landed], { rts: rts("failed") }).some((x) => x.key === "follow|failed|ATC-6"));
  assert.ok(!run([landed], { rts: rts("ok") }).some((x) => x.key === "follow|failed|ATC-6"));
  assert.ok(!run([landed], { rts: rts("rollback", iso(60)) }).some((x) => x.key === "follow|failed|ATC-6"), "그 뒤에 착륙한 줄은 이 ROLLBACK의 것이 아니다");
  const deployed = row("ATC-7", { stages: withStages({ landed: cell(true, iso(30)), deployed: cell(true, iso(5)) }) });
  assert.ok(!run([deployed], { rts: rts("rollback") }).some((x) => x.key === "follow|failed|ATC-7"));
  // 되돌려진 ON, 여럿이면 한 줄
  const rev = run([row("ATC-8", { reverted: { number: 77, at: iso(3) }, goAround: { id: "C-2", readbackAt: iso(2) } })]).find((x) => x.key === "follow|failed|ATC-8")!;
  assert.match(rev.text, /GO AROUND C-2 · PR #77로 되돌려짐/);
  // GO AROUND가 풀리면(줄에서 사라지면) 사라진다
  const d = diffAlerts(new Map([[go.key, go as never]]), run([row("ATC-5")]));
  assert.deepEqual(d.cleared, ["follow|failed|ATC-5"]);
});

test("follow|landed·deployed|<KEY>: log. 그 단계의 시각부터 24시간, 시각을 모르면 번들이 접힐 때까지(줄을 안 넘긴다)", () => {
  const r = row("ATC-5", { stages: withStages({ landed: cell(true, iso(30)), deployed: cell(true, iso(5)) }), finished: true });
  const out = run([r]);
  const landed = out.find((x) => x.key === "follow|landed|ATC-5")!;
  const deployed = out.find((x) => x.key === "follow|deployed|ATC-5")!;
  assert.equal(landed.dest, "log");
  assert.equal(deployed.dest, "log");
  assert.equal(landed.level, null);
  assert.equal(landed.cue, null);
  // 24시간이 지나면 사라진다
  const old = row("ATC-5", { stages: withStages({ landed: cell(true, iso(25 * 60)), deployed: cell(true, iso(25 * 60)) }) });
  assert.deepEqual(keys(run([old])), []);
  // 시각을 모르면 남는다. na인 단계(STAND 없는 FLIGHT, MCC가 아닌 AIRPORT)는 내지 않는다
  assert.ok(keys(run([row("ATC-5", { stages: withStages({ landed: cell(true, null) }) })])).includes("follow|landed|ATC-5"));
  assert.deepEqual(keys(run([row("ATC-5", { stages: withStages({ landed: cell(false, null, true), deployed: cell(false, null, true) }) })])), []);
});

test("각 key는 한 번만, 번들에 두 번 든 줄도 한 번(같은 key는 먼저 나온 것)", () => {
  const out = run([row("ATC-5", { ready: true }), row("ATC-5", { ready: true })]);
  assert.equal(out.filter((x) => x.key === "follow|ready|ATC-5").length, 1);
});

test("follow 입력이 없거나 줄이 없으면 follow 항목이 없다. 다른 그룹의 key는 그대로", () => {
  assert.deepEqual(keys(supervisorAlertsOf(base)), []);
  assert.deepEqual(keys(supervisorAlertsOf({ ...base, follow: { rows: [], now: NOW } })), []);
});

test("종류 설정: follow가 목록에 있고 기본은 켜짐, 저장된 설정에 없으면 기본값. 조용한 시간 등 다른 규칙은 그대로 따른다", () => {
  assert.equal(DEFAULT_PREFS.groups.follow, true);
  assert.ok(GROUP_LABEL.follow);
  assert.equal(parsePrefs({ groups: { rts: false } }).groups.follow, true);
  assert.equal(parsePrefs({ groups: { follow: false } }).groups.follow, false);
});

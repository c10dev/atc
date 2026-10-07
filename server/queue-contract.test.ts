import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { homeControlOf, opensInDetail } from "../web/src/home-rows.ts";
import { ALERT_CONTRACT, ALERT_NOT_ON_HOME, alertRowOf, QUEUE_CONTRACT } from "./queue-contract.ts";
import { type AlertsInput, DEST_PREFIXES, supervisorAlertsOf } from "./supervisor-alerts.ts";
import { type QueueInput, type QueueItem, QUEUE_KINDS, supervisorQueueOf } from "./supervisor-queue.ts";

// ATC-546: 새 QUEUE 종류나 HOME 알림은 표(server/queue-contract.ts)에 줄이 있어야 하고, 그 줄의 동작이 HOME에 그려져야 한다

const NOW = Date.parse("2026-10-05T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const T = ago(30);

const empty = (): QueueInput => ({ proposals: [], schedule: { mode: "approval", ops: [] }, fleetPlan: [], pulls: [], update: null, sessions: [], blockedMin: 3 });
const pull = (o: object = {}) => ({ repo: "/x/atc", number: 7, head: "abc1234def", draft: false, landing: "APPROACH", humanCheck: null, ticketKey: "ATC-7", landBy: "mcc", ...o }) as QueueInput["pulls"][number];
const proposal = (o: object = {}) => ({ id: "D-1", kind: "ASSIGN", status: "proposed", flight: "ATC-1", aircraftName: "TEAM_A", holdAt: null, statusAt: T, ...o }) as QueueInput["proposals"][number];

// 알림은 만드는 함수(supervisorAlertsOf)로 만든다: link가 실제 값이어야 #home 고리를 잡는다
const alertsIn = (): AlertsInput => ({
  sessions: [], alerts: [], workspaces: [], tickets: [], following: [{ flight: "ATC-2", aircraft: "TEAM_G", issues: [{ code: "no-pr", kind: "delay", severity: "warn", text: "PR 없음", since: T, key: "ATC-2|no-pr" }] }],
  proposals: [], pulls: [], rts: null,
  waiting: [{ session: "OCC", context: 300_000, cap: 250_000, blocks: ["x"], since: T, minutes: 70 }],
  capBlocked: [{ session: "MCC", context: 300_000, cap: 150_000, needs: "x", since: T, minutes: 70, others: [] }],
  overCap: [{ session: "MCC", context: 200_000, cap: 150_000, since: T }],
  capIdle: [{ id: "j1", name: "TEAM_X", idleMin: 130, refused: "TEAM_G" } as never],
  rtsHalted: { since: T, reason: "ROLLBACK 뒤 멈춤" },
  revertStops: [{ airport: "ATCC", at: T, detail: "breaker" }],
  k3Holds: [{ flight: "ATC-3", text: "hold", fix: "fix" }],
  canceledPrs: [{ repo: "/x/atc", number: 9, flight: "ATC-4", aircraft: "TEAM_B", draft: false, airport: "ATCC" } as never],
  controlDown: [{ session: "TOWER", since: T, reason: "gone" }],
  controlChecks: { unverified: [{ session: "OCC", jobId: "j9", since: T } as never], duplicates: [{ control: "MCC", jobs: ["a", "b"] } as never] },
  hostMemory: { level: "caution", text: "memory low" } as never,
  orphans: [{ flight: "ATC-5", registration: "TEAM_C", line: "orphan", since: T }],
  eventLoopLag: { line: "lag", since: T },
  repositionStuck: [{ aircraft: "TEAM_H", since: T, to: "B" } as never],
  follow: { now: NOW, rows: [{ key: "ATC-6", title: null, finished: false, current: "landed", issues: [], stuck: null, ready: false, goAround: null, reverted: { number: 3, at: T }, arrow: false, arrivedAt: null, stages: { landed: { done: true, na: false, at: T }, deployed: { done: false, na: true, at: null } } } as never] },
});
const orphans = [{ flight: "ATC-5", registration: "TEAM_C", text: "RESUME ATC-5" }];

// 종류마다 그 종류의 줄을 만드는 입력(하나 이상의 줄). 줄이 없으면 시험이 실패한다
const FIXTURES: Record<(typeof QUEUE_KINDS)[number], () => QueueInput> = {
  PROPOSAL: () => ({ ...empty(), proposals: [proposal()] }),
  SCHEDULE: () => ({ ...empty(), schedule: { mode: "approval", ops: [{ id: "S-1", kind: "TAIL", flight: "ATC-2", status: "draft", statusAt: T }] as never } }),
  "FLEET PLAN": () => ({ ...empty(), fleetPlan: [{ id: "F-1", kind: "LAUNCH", aircraft: "TEAM_B", status: "open", at: T, stale: false }] as never }),
  "HUMAN CHECK": () => ({ ...empty(), pulls: [pull({ humanCheck: { required: true, state: "pending", classes: ["ui"] } })] }),
  LANDING: () => ({ ...empty(), pulls: [pull({ landing: "CLEARED", landBy: "supervisor" })] }),
  UPDATE: () => ({ ...empty(), update: { kind: "available", deployed: "aaaaaaa1", main: "bbbbbbb2", mainCi: "ok", at: T } }),
  "NEEDS YOU": () => ({ ...empty(), sessions: [{ id: "a", name: "TEAM_A", job: { state: "blocked", since: ago(30), needs: "answer" }, lastActiveAt: T } as never] }),
  RELAY: () => ({ ...empty(), relayOffers: [{ key: "atc#7@abc1234|FIX", type: "FIX", repo: "/x/atc", pr: 7, head: "abc1234", flight: "ATC-7", airport: "ATCC", stand: null, standName: null, text: "fix", to: "TEAM_A", reason: "x", noHolder: null }] }),
  UNDELIVERED: () => ({ ...empty(), clearances: [{ id: "C-1", toName: "TEAM_A", type: "GO AROUND", text: "t", undeliverableAt: T, undeliverableReason: "none", undeliverableCause: null, handAt: null, flight: null }] as never }),
  GO: () => ({ ...empty(), proposals: [proposal({ status: "sent", awaitSupervisor: { at: T, reason: "x" } })] }),
  BACKLOG: () => ({ ...empty(), backlog: [{ key: "ATC-9", by: "DUTY REVIEW R-1", at: T }] }),
  ALERT: () => ({ ...empty(), alerts: supervisorAlertsOf(alertsIn()) as never }),
  STUCK: () => ({ ...empty(), follow: { dispatchMode: "approval", bundles: [{ rows: [{ key: "ATC-8", finished: false, stuck: { stage: "approved", code: "approved-not-sent", text: "no send", since: T }, next: null, proposalInfo: { id: "D-8", status: "approved", aircraftName: "TEAM_A", departedStand: null, departedVia: null } }] as never }] } }),
  EFFECT: () => ({ ...empty(), effects: [{ flight: "ATC-10", release: null, at: T, deployedAt: T, metric: "m", direction: "down", windowDays: 7, before: 1, after: 2, verdict: "worse", reason: "r", wrong: false }] }),
  CLOSE: () => ({ ...empty(), closes: [{ id: "P-1", flight: "ATC-11", statusAt: T, url: "https://linear.app/x/issue/ATC-11", pr: { repo: "/x/atc", number: 5, url: "https://github.com/x/atc/pull/5" } }] }),
  ARRIVED: () => ({ ...empty(), arrived: [{ flight: "ATC-12", title: "t", state: "In Progress", aircraft: "TEAM_A", arrivedAt: T, note: null, result: null, issueUrl: null }] }),
  DECISION: () => ({ ...empty(), decisions: [{ id: "DC-1", key: "k", role: "tower", at: T, ask: "which?", options: ["a", "b"], pr: null, status: "open" }] }),
};

const itemsOf = (kind: (typeof QUEUE_KINDS)[number]): QueueItem[] => supervisorQueueOf({ ...FIXTURES[kind](), orphans }, NOW).filter((i) => i.kind === kind);

test("every QUEUE_KINDS value has a contract row (a new kind without one fails here)", () => {
  for (const k of QUEUE_KINDS) assert.ok(QUEUE_CONTRACT[k], `QUEUE_KINDS has ${k} but server/queue-contract.ts has no row`);
  for (const k of Object.keys(QUEUE_CONTRACT)) assert.ok((QUEUE_KINDS as readonly string[]).includes(k), `${k} is in the contract but not in QUEUE_KINDS`);
});

test("every row names its end rule, and the function that implements it exists", () => {
  const src = readdirSync(new URL(".", import.meta.url)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");
  for (const [k, r] of [...Object.entries(QUEUE_CONTRACT), ...ALERT_CONTRACT.map((r) => [r.family, r] as const)]) {
    assert.ok(r.ends.length > 10, `${k}: ends is empty`);
    assert.match(src, new RegExp(`export (const|function) ${r.endsBy}\\b`), `${k}: endsBy ${r.endsBy} is not exported from server/`);
  }
});

for (const kind of QUEUE_KINDS) {
  test(`${kind}: a fixture row yields the declared HOME action, and HOME can render it`, () => {
    const row = QUEUE_CONTRACT[kind];
    const items = itemsOf(kind);
    assert.ok(items.length > 0, `no fixture row for ${kind}: add one to FIXTURES`);
    for (const i of items) {
      const control = homeControlOf(i);
      if (kind === "ALERT") continue; // 알림은 아래 줄마다 본다
      assert.equal(control, row.action, `${kind} ${i.key}: HOME draws ${control}, the contract says ${row.action}`);
      // 서버 primary와 HOME 동작이 맞아야 한다
      if (row.action === "approve") assert.ok(i.primary.op, `${kind}: approve without op`);
      if (row.action === "brake") assert.ok(i.brake && i.flight, `${kind}: brake without proposal`);
      if (row.action === "hand") assert.ok(i.hand || i.offer, `${kind}: hand without card`);
      if (row.action === "answer") assert.ok(i.decision || kind === "HUMAN CHECK", `${kind}: answer without options`);
      if (row.action === "done") assert.equal(i.primary.action, "done");
      // open이면 그 단추가 어딘가로 간다: #home 자신만 가리키는 고리(ATC-541)가 아니다
      if (row.action === "open") assert.ok(i.primary.url || (i.primary.hash && i.primary.hash !== "#home"), `${kind} ${i.key}: open points at #home`);
      // 줄 안에서 하는 동작(승인·CANCEL·손으로 전하기·답하기)은 줄을 여는 단추로 나온다
      assert.equal(opensInDetail(i), row.screenOnly && row.action !== "open", `${kind}: screenOnly and opensInDetail disagree`);
    }
  });
}

test("no queue row's `open` primary points at #home without an address of its own (the ATC-541 loop)", () => {
  for (const kind of QUEUE_KINDS) {
    for (const i of itemsOf(kind)) {
      if (i.primary.action !== "open" || opensInDetail(i) || i.primary.url) continue;
      if (kind === "ALERT" && alertRowOf(i.key)?.gap) continue; // 알려진 어긋남은 아래에서 따로 센다
      assert.notEqual(i.primary.hash, "#home", `${kind} ${i.key}: open → #home`);
    }
  }
});

test("HOME alerts: every actionable alert family has a row, and each opens somewhere other than #home", () => {
  const items = supervisorQueueOf({ ...empty(), alerts: supervisorAlertsOf(alertsIn()) as never, orphans }, NOW).filter((i) => i.kind === "ALERT");
  assert.ok(items.length >= 10, `only ${items.length} ALERT rows from the fixture`);
  const seen = new Set<string>();
  for (const i of items) {
    const row = alertRowOf(i.key);
    assert.ok(row, `${i.key} reaches HOME but has no row in ALERT_CONTRACT`);
    seen.add(row!.family);
    if (row!.gap) continue;
    assert.equal(homeControlOf(i), row!.action, i.key);
    assert.ok(i.primary.hash && i.primary.hash !== "#home", `${i.key}: open → ${i.primary.hash}`);
  }
  for (const r of ALERT_CONTRACT) assert.ok(seen.has(r.family), `ALERT_CONTRACT row ${r.family} has no fixture alert: add one to alertsIn()`);
});

test("known gaps are real: a declared action that HOME does draw must drop its `gap` note", () => {
  const items = supervisorQueueOf({ ...empty(), alerts: supervisorAlertsOf(alertsIn()) as never, orphans }, NOW).filter((i) => i.kind === "ALERT");
  for (const r of ALERT_CONTRACT.filter((x) => x.gap)) {
    const i = items.find((x) => alertRowOf(x.key) === r)!;
    const drawn = homeControlOf(i) === r.action && (r.action !== "hand" || opensInDetail(i)) && (r.action !== "open" || i.primary.hash !== "#home");
    assert.equal(drawn, false, `${r.family}: HOME now draws ${r.action}; remove the gap note`);
  }
});

test("every alert key prefix is either in ALERT_CONTRACT or says why it does not reach HOME", () => {
  for (const p of DEST_PREFIXES) {
    const inTable = ALERT_CONTRACT.some((r) => r.family === p || r.family.startsWith(`${p}|`));
    assert.ok(inTable || ALERT_NOT_ON_HOME[p], `key prefix ${p}: add a row to ALERT_CONTRACT or a reason to ALERT_NOT_ON_HOME`);
  }
});

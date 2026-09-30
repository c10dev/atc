import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

// REPOSITION 실행(ATC-179)의 통합 시험: 가짜 claude와 임시 상태 폴더. 진짜 세션·운영 상태에는 닿지 않는다.
// config는 import할 때 환경을 읽으므로 먼저 환경을 정하고 동적으로 가져온다.
const dir = mkdtempSync(join(tmpdir(), "atc-reposition-"));
const state = join(dir, "state");
const home = join(dir, "home");
mkdirSync(state, { recursive: true });
mkdirSync(join(home, ".claude"), { recursive: true });
const stub = join(dir, "claude");
process.env.HOME = home;
process.env.ATC_STATE_DIR = state;
process.env.ATC_CLAUDE_BIN = stub;
process.env.ATC_BG_SCOPE = "off";
process.env.ATC_GITHUB = "off";

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
let sleeper: ReturnType<typeof spawn>;

// 가짜 claude: agents --json은 agents.json, stop은 pid를 죽이고 유령 줄을 남기고, --bg는 cwd를 적고 새 job을 더한다. dir/fail-launch가 있으면 --bg는 실패
const STUB = `#!/usr/bin/env node
const fs = require("fs"), cp = require("child_process");
const D = ${JSON.stringify(dir)}, F = D + "/agents.json";
const rows = () => JSON.parse(fs.readFileSync(F, "utf8"));
const a = process.argv.slice(2);
fs.appendFileSync(D + "/calls.log", JSON.stringify({ a: a.slice(0, 5), cwd: process.cwd() }) + "\\n");
if (a[0] === "agents") { console.log(JSON.stringify(rows())); process.exit(0); }
if (a[0] === "stop") {
  const r = rows(); const row = r.find((x) => x.id === a[1]);
  if (!row) { console.error("no such job"); process.exit(1); }
  if (row.pid) { try { process.kill(row.pid); } catch {} }
  delete row.pid; delete row.status;
  fs.writeFileSync(F, JSON.stringify(r)); process.exit(0);
}
if (a[0] === "--bg") {
  if (fs.existsSync(D + "/fail-launch")) { console.error("not trusted"); process.exit(1); }
  const name = a[a.indexOf("-n") + 1];
  const id = Math.random().toString(16).slice(2, 10);
  const c = cp.spawn("sleep", ["600"], { detached: true, stdio: "ignore" }); c.unref();
  const r = rows();
  r.push({ id, sessionId: "0000" + id, name, kind: "background", status: "idle", cwd: process.cwd(), startedAt: Date.now(), pid: c.pid });
  fs.writeFileSync(F, JSON.stringify(r));
  console.log("backgrounded · " + id + " · " + name);
  process.exit(0);
}
process.exit(1);
`;

const airports = [
  { code: "ATCC", repo: join(dir, "atcc"), name: "atcc" },
  { code: "DSGN", repo: join(dir, "dsgn"), name: "dsgn" },
];
// TEAM_F는 ATCC 저장소의 쉬는 백그라운드 세션
const liveF = { id: "s-f", agent: "claude", name: "TEAM_F", status: "idle", pid: null, cwd: airports[0].repo, startedAt: new Date(Date.now() - 3_600_000).toISOString(), lastActiveAt: new Date(Date.now() - 1_800_000).toISOString(), repo: airports[0].repo, workspacePath: airports[0].repo, kind: "background", origin: "background" };
const snapshot = (over: Record<string, unknown> = {}) =>
  ({ sessions: [liveF], claims: [], workspaces: [], tickets: [], pulls: [], airports, restarting: [], fuelAccounts: [], at: new Date().toISOString(), ...over }) as never;

const seed = () => {
  writeFileSync(join(dir, "agents.json"), JSON.stringify([{ id: "aaaa1111", sessionId: "s-f", name: "TEAM_F", kind: "background", status: "idle", cwd: airports[0].repo, startedAt: 1, pid: sleeper.pid }]));
  // 멈춘 job의 state.json(done): 유령 줄이 STALE로 읽히려면 필요하다(ATC-93·165)
  mkdirSync(join(home, ".claude", "jobs", "aaaa1111"), { recursive: true });
  writeFileSync(join(home, ".claude", "jobs", "aaaa1111", "state.json"), JSON.stringify({ state: "done", tempo: "idle" }));
  writeFileSync(join(state, "fleet.json"), JSON.stringify({ defaults: { complement: [], ratings: [] }, aircraft: { TEAM_F: { base: "ATCC" } } }));
  writeFileSync(join(state, "fleet-plan.json"), JSON.stringify({ mode: "shadow", reposition: "approval" }));
  writeFileSync(join(dir, "calls.log"), "");
};
const cand = { key: "REPOSITION|DSGN", kind: "REPOSITION" as const, aircraft: "TEAM_F", airport: "DSGN", from: "ATCC", reasons: [] };
const createOp = (id: string) => JSON.stringify({ op: "create", id, key: cand.key, kind: "REPOSITION", aircraft: "TEAM_F", airport: "DSGN", from: "ATCC", reasons: [], at: ago(60_000) }) + "\n";
const calls = () => readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { a: string[]; cwd: string });
const recorder = () => {
  const day = new Date().toISOString().slice(0, 10);
  const f = join(state, "flight-recorder", `${day}.jsonl`);
  return existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) : [];
};
const baseOf = () => JSON.parse(readFileSync(join(state, "fleet.json"), "utf8")).aircraft.TEAM_F.base;

before(() => {
  writeFileSync(stub, STUB);
  chmodSync(stub, 0o755);
  for (const a of airports) mkdirSync(a.repo, { recursive: true });
  sleeper = spawn("sleep", ["600"], { stdio: "ignore" });
});
after(() => {
  try {
    sleeper.kill();
  } catch {}
  // 가짜 claude가 띄운 stand-in(sleep)도 저장해 둔 pid로만 끈다
  try {
    for (const r of JSON.parse(readFileSync(join(dir, "agents.json"), "utf8")) as { pid?: number }[]) if (r.pid) process.kill(r.pid);
  } catch {}
});

test("REPOSITION 승인: STOP → base 쓰기 → 새 AIRPORT 저장소에서 LAUNCH, reposition 사건 하나(by supervisor)", async () => {
  seed();
  writeFileSync(join(state, "fleet-plan.jsonl"), createOp("F-0001"));
  const { testHooks, allFleetPlan } = await import("./fleet-plan-run.ts");
  testHooks.setLast([cand], new Date().toISOString());
  const r = await testHooks.runApproval("F-0001", {}, "supervisor", async () => snapshot());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const c = calls().filter((x) => x.a[0] !== "agents");
  assert.equal(c[0].a[0], "stop");
  assert.equal(c[1].a[0], "--bg");
  assert.equal(c[1].cwd, airports[1].repo); // 새 AIRPORT의 저장소에서 띄운다
  assert.equal(baseOf(), "DSGN");
  const events = recorder().filter((e) => e.kind === "fleet" && e.op === "reposition");
  assert.equal(events.length, 1);
  assert.deepEqual([events[0].aircraft, events[0].from, events[0].to, events[0].by, events[0].ok, events[0].proposal], ["TEAM_F", "ATCC", "DSGN", "supervisor", true, "F-0001"]);
  assert.ok(events[0].jobId);
  const ops = recorder().filter((e) => e.kind === "fleet").map((e) => e.op);
  assert.deepEqual(ops.filter((o) => o === "stop" || o === "launch"), ["stop", "launch"]); // 사건 옆에 stop·launch도 있다
  assert.equal(allFleetPlan().find((p) => p.id === "F-0001")!.status, "executed");
});

test("REPOSITION 승인: 목표 저장소를 모르면 STOP 전에 거절하고 아무것도 바꾸지 않는다", async () => {
  seed();
  writeFileSync(join(state, "fleet-plan.jsonl"), createOp("F-0002"));
  const { testHooks } = await import("./fleet-plan-run.ts");
  testHooks.setLast([cand], new Date().toISOString());
  const r = await testHooks.runApproval("F-0002", {}, "supervisor", async () => snapshot({ airports: [airports[0], { code: "DSGN", repo: null, name: "dsgn" }] }));
  assert.equal(r.status, 409);
  assert.match(String(r.body.error), /DSGN의 저장소를 모름 — TEAM_F는 멈추지 않았다/);
  assert.deepEqual(calls().filter((x) => x.a[0] !== "agents"), []);
  assert.equal(baseOf(), "ATCC");
});

test("REPOSITION 승인: LAUNCH가 실패하면 base는 새 AIRPORT로 남고 사건은 stage launch, by auto", async () => {
  seed();
  writeFileSync(join(dir, "fail-launch"), "1");
  writeFileSync(join(state, "fleet-plan.jsonl"), createOp("F-0003"));
  const { testHooks, allFleetPlan } = await import("./fleet-plan-run.ts");
  testHooks.setLast([cand], new Date().toISOString());
  const r = await testHooks.runApproval("F-0003", {}, "auto", async () => snapshot());
  assert.equal(r.status, 502);
  assert.equal(baseOf(), "DSGN"); // 옛 세션은 멈췄고 base는 바뀐 채 — 다음 DISPATCH가 ABSENT로 LAUNCH 카드를 낸다
  const events = recorder().filter((e) => e.kind === "fleet" && e.op === "reposition");
  const e = events.at(-1)!;
  assert.deepEqual([e.by, e.ok, e.stage], ["auto", false, "launch"]);
  assert.match(String(e.error), /신뢰하지 않음/); // 가짜 claude의 "not trusted"
  assert.equal(allFleetPlan().find((p) => p.id === "F-0003")!.status, "failed");
  writeFileSync(join(dir, "fail-launch"), "");
  const fs = await import("node:fs");
  fs.rmSync(join(dir, "fail-launch"));
});

test("REPOSITION 승인: 그림자 모드(off·shadow)에서는 실행하지 않는다", async () => {
  seed();
  writeFileSync(join(state, "fleet-plan.json"), JSON.stringify({ mode: "approval", reposition: "shadow" })); // FLEET PLAN이 approval이어도 REPOSITION 스위치가 따로다
  writeFileSync(join(state, "fleet-plan.jsonl"), createOp("F-0004"));
  const { testHooks } = await import("./fleet-plan-run.ts");
  testHooks.setLast([cand], new Date().toISOString());
  const r = await testHooks.runApproval("F-0004", {}, "supervisor", async () => snapshot());
  assert.equal(r.status, 409);
  assert.match(String(r.body.error), /그림자 운용/);
  assert.deepEqual(calls().filter((x) => x.a[0] !== "agents"), []);
});

test("setRepositionMode: 바꿈은 FLIGHT RECORDER에 남고, 같은 값이면 남기지 않는다. flapping으로 auto가 approval이 되면 by auto와 사유", async () => {
  seed();
  const { setRepositionMode, loadReposition } = await import("./fleet-plan-run.ts");
  const before = recorder().filter((e) => e.kind === "reposition").length;
  setRepositionMode("auto");
  setRepositionMode("auto");
  assert.equal(loadReposition().mode, "auto");
  setRepositionMode("approval", "auto", "TEAM_F가 DSGN → ATCC로 되돌아가려 함");
  const lines = recorder().filter((e) => e.kind === "reposition" && e.op === "mode").slice(before);
  assert.deepEqual(lines.map((l) => [l.by, l.from, l.to]), [["SUPERVISOR", "approval", "auto"], ["auto", "auto", "approval"]]);
  assert.match(String(lines[1].reason), /되돌아가려 함/);
  assert.equal(JSON.parse(readFileSync(join(state, "fleet-plan.json"), "utf8")).mode, "shadow"); // 다른 키(FLEET PLAN 모드)는 그대로
});

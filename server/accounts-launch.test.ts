import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { AccountFolder } from "./accounts.ts";
import { cleanEnv } from "./clean-env.ts";
import { config } from "./config.ts";
import { type AgentRow, agentRowsOf, configDirOfRow, controlLaunchPlanOf, CONTROL_SESSIONS, ControlError, launchAccountOf, launchPlanOf } from "./session-control.ts";

// ACCOUNTS LAUNCH(ATC-147). 실제 세션은 띄우지 않는다: launch 계획은 순수 함수로, agent 목록은 임시 폴더와 가짜 claude 스크립트로 본다.
const root = realpathSync(mkdtempSync(join(tmpdir(), "atc-acctlaunch-")));
const real = { home: config.home, claudeDir: config.claudeDir, claudeBin: config.claudeBin, stateDir: config.stateDir };
const kids: ReturnType<typeof spawn>[] = [];
after(() => {
  for (const k of kids) k.kill(); // 이 테스트가 띄운 가짜 daemon만 PID로 끈다
  Object.assign(config, real);
  rmSync(root, { recursive: true, force: true });
});
config.home = root;
config.claudeDir = join(root, ".claude");
config.stateDir = join(root, "state");
const D = config.claudeDir;
const A1 = join(root, ".claude-acct-1");
const A3 = join(root, ".claude-acct-3");
const folder = (label: string, dir: string, extra: Partial<AccountFolder> = {}): AccountFolder => ({ label, dir, registered: true, ...extra });
const FOLDERS: AccountFolder[] = [folder("acct-1", A1, { maxLaunched: 2 }), folder("acct-3", A3), folder("acct-2", D)];

const input = { registration: "team_g", retired: false, repo: "/r/atc", briefing: "BRIEF" };
const row = (id: string, name: string, account?: string, over: Partial<AgentRow> = {}): AgentRow => ({ id, sessionId: `${id}-x`, name, kind: "background", cwd: "/r/atc", status: "idle", pid: 1, ...(account ? { account } : {}), ...over });

test("환경: ACCOUNT 폴더를 주면 CLAUDE_CONFIG_DIR 하나만 더한다. ~/.claude나 안 주면 전과 같다. 비밀은 안 넘어간다", () => {
  process.env.LINEAR_API_KEY = "secret-key";
  process.env.CLAUDE_CONFIG_DIR = "/should/not/pass";
  try {
    const base = cleanEnv();
    assert.equal("CLAUDE_CONFIG_DIR" in base, false);
    assert.equal("LINEAR_API_KEY" in base, false);
    assert.deepEqual(cleanEnv(null), base);
    assert.deepEqual(cleanEnv(D), base); // 기본 폴더는 환경을 바꾸지 않는다
    const acct = cleanEnv(A1);
    assert.equal(acct.CLAUDE_CONFIG_DIR, A1);
    assert.deepEqual({ ...acct, CLAUDE_CONFIG_DIR: undefined }, { ...base, CLAUDE_CONFIG_DIR: undefined });
    assert.equal(Object.keys(acct).length, Object.keys(base).length + 1);
    assert.equal(JSON.stringify(acct).includes("secret-key"), false);
  } finally {
    delete process.env.LINEAR_API_KEY;
    delete process.env.CLAUDE_CONFIG_DIR;
  }
});

test("launchPlanOf: 등록부가 없으면 전과 같은 인자·환경(configDir null). ACCOUNT를 주면 인자는 그대로, 폴더만 더해진다", () => {
  const today = launchPlanOf(input, []);
  assert.deepEqual(today.args, ["--bg", "-n", "TEAM_G", "--permission-mode", "auto", "BRIEF"]);
  assert.deepEqual([today.account, today.configDir], [null, null]);
  const modelled = launchPlanOf({ ...input, model: "claude-sonnet-5-5", permissionMode: "acceptEdits" }, []);
  assert.deepEqual(modelled.args, ["--bg", "-n", "TEAM_G", "--permission-mode", "acceptEdits", "--model", "claude-sonnet-5-5", "BRIEF"]);
  const one = launchPlanOf(input, [], 6, FOLDERS[0]);
  assert.deepEqual(one.args, today.args);
  assert.deepEqual([one.account, one.configDir], ["acct-1", A1]);
  const home = launchPlanOf(input, [], 6, FOLDERS[2]); // ~/.claude에 붙은 라벨: 환경은 바꾸지 않는다
  assert.deepEqual([home.account, home.configDir], ["acct-2", null]);
});

test("launchPlanOf: ACCOUNT별 상한은 그 ACCOUNT 폴더에서 읽은 백그라운드 세션만 센다. 기계 전체 상한은 그대로", () => {
  const rows = [row("a1111111", "TEAM_A", "acct-1"), row("b2222222", "TEAM_B", "acct-1"), row("c3333333", "TEAM_C", "acct-3"), row("d4444444", "TEAM_D", "acct-1", { stale: true })];
  assert.throws(() => launchPlanOf(input, rows, 6, FOLDERS[0]), (e) => e instanceof ControlError && e.status === 409 && /ACCOUNT acct-1의 백그라운드 세션 2개 — 상한 2/.test(e.message)); // STALE은 안 센다
  assert.equal(launchPlanOf(input, rows, 6, FOLDERS[1]).account, "acct-3"); // acct-3는 상한 없음
  assert.throws(() => launchPlanOf(input, rows, 3, FOLDERS[1]), /상한 3\(ATC_MAX_LAUNCHED\)/); // 기계 전체 상한
  assert.throws(() => launchPlanOf(input, [row("e5555555", "TEAM_G", "acct-3")], 6, FOLDERS[0]), /이미 떠 있음/); // 다른 ACCOUNT에 떠 있어도 같은 AIRCRAFT는 하나
});

test("controlLaunchPlanOf: 인자는 전과 같고 ACCOUNT 폴더만 더한다", () => {
  const tower = CONTROL_SESSIONS.find((s) => s.name === "TOWER")!;
  const today = controlLaunchPlanOf(tower, [], "/r/atc/controller");
  assert.deepEqual(today.args, ["--bg", "-n", "TOWER", "--permission-mode", "auto", "/loop 3m /tick"]);
  assert.deepEqual(Object.keys(today).sort(), ["args", "cwd"]); // 전과 같은 모양
  const acct = controlLaunchPlanOf(tower, [], "/r/atc/controller", FOLDERS[0]);
  assert.deepEqual(acct.args, today.args);
  assert.deepEqual([acct.account, acct.configDir], ["acct-1", A1]);
  assert.throws(() => controlLaunchPlanOf(tower, [row("f6666666", "TOWER", "acct-3")], "/r/atc/controller", FOLDERS[0]), /이미 떠 있음/);
});

test("launchAccountOf: 카드 승인의 마지막 ACCOUNT(fallback)는 LAUNCH ACCOUNT 뒤, home 앞", () => {
  const ok = () => null;
  // 2026-09-30: LAUNCH ACCOUNT acct-3인데 ASSIGN 카드 승인이 마지막 ACCOUNT acct-2(hold)로 가서 거절됐다
  assert.equal(launchAccountOf({ preferred: "acct-3", fallback: "acct-2", home: "acct-1", folders: FOLDERS, status: ok })?.label, "acct-3");
  assert.throws(() => launchAccountOf({ requested: "acct-2", preferred: "acct-3", folders: FOLDERS, status: (l) => (l === "acct-2" ? { loggedIn: true, hold: "FUEL 사용 95% until 10:00Z" } : null) }), /acct-2는 FUEL hold/); // RESUME은 이름을 댄다
  assert.equal(launchAccountOf({ fallback: "acct-2", home: "acct-1", folders: FOLDERS, status: ok })?.label, "acct-2"); // 설정이 없으면 전과 같다
  assert.equal(launchAccountOf({ preferred: "pro-9", fallback: "acct-2", home: "acct-1", folders: FOLDERS, status: ok })?.label, "acct-2"); // 미등록 LAUNCH ACCOUNT는 무시
  assert.equal(launchAccountOf({ fallback: "pro-9", home: "acct-1", folders: FOLDERS, status: ok })?.label, "acct-1"); // 미등록 fallback은 home으로(이름 지정처럼 404가 아니다)
});

test("launchAccountOf: 등록부 없음·home·이름 지정·미등록 home, 그리고 거절 사유", () => {
  const ok = () => null;
  const NOREG = [folder("default", D, { registered: false })];
  assert.equal(launchAccountOf({ home: "acct-2", folders: NOREG, status: ok }), null); // 전과 같다
  assert.throws(() => launchAccountOf({ requested: "acct-1", folders: NOREG, status: ok }), (e) => e instanceof ControlError && e.status === 409 && /등록부가 비어 있음/.test(e.message));
  assert.equal(launchAccountOf({ home: "acct-3", folders: FOLDERS, status: ok })?.label, "acct-3"); // home
  assert.equal(launchAccountOf({ requested: "acct-1", home: "acct-3", folders: FOLDERS, status: ok })?.label, "acct-1"); // 이름을 대면 그것
  assert.equal(launchAccountOf({ requested: " ACCT-1 ", folders: FOLDERS, status: ok })?.label, "acct-1");
  assert.equal(launchAccountOf({ home: "pro-9", folders: FOLDERS, status: ok })?.label, "acct-2"); // 등록부에 없는 home은 ~/.claude로
  assert.equal(launchAccountOf({ home: null, folders: FOLDERS, status: ok })?.dir, D);
  assert.throws(() => launchAccountOf({ requested: "acct-9", folders: FOLDERS, status: ok }), (e) => e instanceof ControlError && e.status === 404 && /등록되지 않은 ACCOUNT: acct-9 \(등록: acct-1, acct-3, acct-2\)/.test(e.message));
  assert.throws(() => launchAccountOf({ requested: "Not A Label", folders: FOLDERS, status: ok }), (e) => e instanceof ControlError && e.status === 400);
  assert.throws(() => launchAccountOf({ requested: 5, folders: FOLDERS, status: ok }), (e) => e instanceof ControlError && e.status === 400);
  // 거절 사유: 로그인 안 됨, FUEL hold. loggedIn null(모름)은 막지 않는다
  const st = (loggedIn: boolean | null, hold: string | null) => () => ({ loggedIn, hold });
  assert.throws(() => launchAccountOf({ requested: "acct-1", folders: FOLDERS, status: st(false, null) }), (e) => e instanceof ControlError && e.status === 409 && /^ACCOUNT acct-1는 로그인되어 있지 않음/.test(e.message));
  assert.throws(() => launchAccountOf({ requested: "acct-3", folders: FOLDERS, status: st(true, "FUEL 사용 97% until 21:00Z") }), (e) => e instanceof ControlError && e.status === 409 && e.message === "ACCOUNT acct-3는 FUEL hold 수준: FUEL 사용 97% until 21:00Z");
  assert.equal(launchAccountOf({ requested: "acct-1", folders: FOLDERS, status: st(null, null) })?.label, "acct-1");
  // home ACCOUNT가 hold여도 거절한다(다른 ACCOUNT를 고르는 것은 SUPERVISOR)
  assert.throws(() => launchAccountOf({ home: "acct-1", folders: FOLDERS, status: (l) => (l === "acct-1" ? { loggedIn: true, hold: "FUEL 사용 99% until 21:00Z" } : null) }), /acct-1는 FUEL hold 수준/);
});

// LAUNCH ACCOUNT(ATC-239): 이름을 댄 요청 → LAUNCH ACCOUNT(설정) → home → ~/.claude. 거절은 고른 ACCOUNT에 그대로 걸린다
test("launchAccountOf: 이름을 댄 요청이 설정을 이기고, 설정이 home을 이기고, 설정이 없거나 등록부에 없으면 home으로", () => {
  const ok = () => null;
  assert.equal(launchAccountOf({ preferred: "acct-3", home: "acct-1", folders: FOLDERS, status: ok })?.label, "acct-3"); // 설정이 home을 이긴다
  assert.equal(launchAccountOf({ requested: "acct-1", preferred: "acct-3", home: "acct-2", folders: FOLDERS, status: ok })?.label, "acct-1"); // 이름을 대면(LAUNCH 칸, ACCOUNT CHANGE 승인, RESUME) 설정보다 먼저
  assert.equal(launchAccountOf({ preferred: null, home: "acct-1", folders: FOLDERS, status: ok })?.label, "acct-1"); // 설정 없음 = 전과 같다(각 home)
  assert.equal(launchAccountOf({ preferred: "", home: "acct-1", folders: FOLDERS, status: ok })?.label, "acct-1");
  assert.equal(launchAccountOf({ preferred: "acct-9", home: "acct-1", folders: FOLDERS, status: ok })?.label, "acct-1"); // 등록부에서 지워진 라벨은 무시하고 home으로
  assert.equal(launchAccountOf({ preferred: "acct-9", home: null, folders: FOLDERS, status: ok })?.dir, D); // home도 없으면 ~/.claude
  assert.equal(launchAccountOf({ preferred: "acct-3", folders: [folder("default", D, { registered: false })], status: ok }), null); // 등록부가 없으면 설정도 효과가 없다
});

test("launchAccountOf: 설정으로 고른 ACCOUNT에도 같은 거절(로그인 안 됨, FUEL hold)이 걸리고, 다른 ACCOUNT로 돌리지 않는다. 이름을 댄 다른 ACCOUNT는 된다", () => {
  const st = (l: string) => (l === "acct-3" ? { loggedIn: false, hold: null } : { loggedIn: true, hold: null });
  assert.throws(() => launchAccountOf({ preferred: "acct-3", home: "acct-1", folders: FOLDERS, status: st }), (e) => e instanceof ControlError && e.status === 409 && /^ACCOUNT acct-3는 로그인되어 있지 않음/.test(e.message));
  const hold = (l: string) => (l === "acct-3" ? { loggedIn: true, hold: "FUEL 사용 98% until 21:00Z" } : null);
  assert.throws(() => launchAccountOf({ preferred: "acct-3", home: "acct-1", folders: FOLDERS, status: hold }), /acct-3는 FUEL hold 수준/);
  assert.equal(launchAccountOf({ requested: "acct-1", preferred: "acct-3", home: "acct-2", folders: FOLDERS, status: hold })?.label, "acct-1"); // SUPERVISOR가 직접 고르면 된다
});

// 가짜 claude: CLAUDE_CONFIG_DIR로 폴더를 알아보고 줄을 돌려준다. 부른 폴더를 로그에 남긴다. 세션을 띄우지도 멈추지도 않는다
const BIN = join(root, "fake-claude");
const LOG = join(root, "calls.log");
writeFileSync(
  BIN,
  `#!/bin/sh
echo "$CLAUDE_CONFIG_DIR|$*" >> ${LOG}
case "$CLAUDE_CONFIG_DIR" in
  *acct-1) echo '[{"id":"11111111","sessionId":"s-1","name":"TEAM_ONE","kind":"background","cwd":"/r/atc","status":"idle","pid":11},{"id":"11111112","sessionId":"s-1b","name":"TEAM_TWO","kind":"background","cwd":"/r/atc"}]';;
  *acct-3) echo boom >&2; exit 1;;
  *) echo '[{"id":"22222222","sessionId":"s-2","name":"TEAM_D","kind":"background","cwd":"/r/atc","status":"busy","pid":22}]';;
esac
`,
);
chmodSync(BIN, 0o755);
config.claudeBin = BIN;

// 그 폴더의 daemon이 떠 있는 것처럼: 명령줄에 daemon이 든 프로세스를 하나 띄우고 daemon.status.json에 그 pid를 적는다.
// spawn이 돌려준 직후에는 아직 exec 전이라 명령줄이 부모의 것일 수 있다(daemonUpIn이 그것을 읽어 간헐로 실패했다, ATC-375): 명령줄에 daemon이 보일 때까지 기다린 뒤 status를 쓴다
const fakeDaemon = async (dir: string) => {
  const k = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)", "daemon"], { stdio: "ignore" });
  kids.push(k);
  assert.ok(k.pid, "fake daemon을 띄우지 못함");
  for (let i = 0; ; i++) {
    let cmd = "";
    try {
      cmd = readFileSync(`/proc/${k.pid}/cmdline`, "utf8");
    } catch {}
    if (cmd.split("\0").includes("daemon")) break;
    assert.ok(i < 500, "fake daemon의 exec를 기다리다 5초가 지남");
    await new Promise((r) => setTimeout(r, 10));
  }
  mkdirSync(join(dir, "jobs"), { recursive: true });
  writeFileSync(join(dir, "daemon.status.json"), JSON.stringify({ supervisorPid: k.pid }));
};

test("agentRowsOf: 세 폴더의 줄을 ACCOUNT를 붙여 합친다. daemon이 없는 폴더는 부르지 않고, 못 읽은 폴더는 failed에 라벨만", async () => {
  mkdirSync(D, { recursive: true });
  await fakeDaemon(A1);
  const r1 = await agentRowsOf(FOLDERS.filter((f) => f.label !== "acct-3"));
  assert.deepEqual(r1.rows.map((x) => `${x.name}:${x.account}`), ["TEAM_ONE:acct-1", "TEAM_TWO:acct-1", "TEAM_D:acct-2"]);
  assert.deepEqual(r1.failed, []);
  // acct-3: daemon이 없다 → 부르지 않는다
  const none = await agentRowsOf(FOLDERS);
  assert.deepEqual(none.rows.length, 3);
  assert.equal(readFileSync(LOG, "utf8").includes(`${A3}|`), false);
  // acct-3의 daemon이 떠 있는데 목록을 못 읽으면 failed
  await fakeDaemon(A3);
  const three = await agentRowsOf(FOLDERS);
  assert.deepEqual(three.rows.map((x) => x.account).sort(), ["acct-1", "acct-1", "acct-2"]);
  assert.deepEqual(three.failed, ["acct-3"]);
  // 폴더마다 자기 CLAUDE_CONFIG_DIR로 불렀고 ~/.claude(acct-2)는 환경 변수 없이
  const calls = readFileSync(LOG, "utf8").trim().split("\n");
  assert.ok(calls.includes(`${A1}|agents --json`) && calls.includes(`${A3}|agents --json`) && calls.includes("|agents --json"));
  // STALE 표시는 줄이 있는 폴더의 jobs/로 본다(pid·status 없는 줄 TEAM_TWO는 시작 시각이 없어 STALE이 아니다)
  assert.equal(r1.rows.find((x) => x.name === "TEAM_TWO")!.stale, false);
});

test("agentRowsOf: 등록부가 없으면(폴더 ~/.claude 하나) 한 번 부르고 줄에 account가 없다. ~/.claude가 실패하면 던진다", async () => {
  writeFileSync(LOG, "");
  const only = await agentRowsOf([{ label: "default", dir: D, registered: false }]);
  assert.deepEqual(only.rows.map((x) => [x.name, "account" in x]), [["TEAM_D", false]]);
  assert.deepEqual(readFileSync(LOG, "utf8").trim().split("\n"), ["|agents --json"]);
  // ~/.claude(기본 폴더)의 목록을 못 읽으면 전처럼 던진다
  const failing = join(root, "failing-claude");
  writeFileSync(failing, "#!/bin/sh\necho nope >&2\nexit 1\n");
  chmodSync(failing, 0o755);
  config.claudeBin = failing;
  try {
    await assert.rejects(agentRowsOf([{ label: "default", dir: D, registered: false }]), (e) => e instanceof ControlError && e.status === 502 && /claude agents 실패: nope/.test(e.message));
  } finally {
    config.claudeBin = BIN;
  }
});

test("configDirOfRow: 줄의 ACCOUNT 폴더(stop·respawn이 그 세션의 폴더로 부른다). ~/.claude와 라벨 없음은 null", () => {
  assert.equal(configDirOfRow({ account: "acct-1" }, FOLDERS), A1);
  assert.equal(configDirOfRow({ account: "acct-2" }, FOLDERS), null);
  assert.equal(configDirOfRow({}, FOLDERS), null);
  assert.equal(configDirOfRow({ account: "gone" }, FOLDERS), null);
});

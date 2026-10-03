import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { countRuns, type GateRun, parseGateConfig } from "./verify-gate.ts";
import {
  classifyRun,
  cleanupScript,
  extractScript,
  filterFiles,
  isExcluded,
  isRemoteCommand,
  lockHash,
  newRunId,
  parseRemoteTarget,
  parseStatus,
  prepareScript,
  REMOTE_COMMANDS,
  REMOTE_LOST_EXIT,
  type RemoteTransport,
  routeOf,
  runOnDesktop,
  runScript,
  shq,
  splitZ,
  sshArgs,
  statusScript,
  validRunId,
} from "./verify-remote.ts";
import { ABSENT_MARK_FILE, parseAbsentMark, skipProbe } from "./verify-remote.ts";
import { absentMemory } from "./verify-remote-run.ts";

// ATC-518: 순수 부분과 가짜 전송 수단. 실제 데스크톱에는 닿지 않는다(ssh도 부르지 않는다)

test("명령 목록: 고정된 세 개와 정확히 같을 때만 데스크톱에 간다", () => {
  assert.equal(REMOTE_COMMANDS.length, 3);
  for (const c of [["npm", "test"], ["npx", "tsc", "--noEmit", "-p", "."], ["npx", "vite", "build"]]) assert.equal(isRemoteCommand(c), true, c.join(" "));
  for (const c of [
    [], ["npm"], ["npm", "test", "--", "--watch"], ["npm", "run", "test"], ["npx", "tsc"], ["npx", "tsc", "--noEmit", "-p", ".", "--listFiles"], ["npx", "vite", "build", "--mode", "x"],
    ["bash", "-c", "npm test"], ["sh", "-c", "rm -rf ~"], ["node", "-e", "1"], ["npm", "test;id"], ["NPM", "test"], ["ssh", "other", "npm test"],
  ])
    assert.equal(isRemoteCommand(c), false, c.join(" "));
});

test("접속 정보: 모양이 맞는 것만, 옵션 주입·셸 글자는 거절한다", () => {
  assert.deepEqual(parseRemoteTarget({ host: "desk.example", user: "c10", port: 2222 }), { host: "desk.example", user: "c10", port: 2222, identityFile: null });
  assert.deepEqual(parseRemoteTarget({ host: "10.0.0.7", user: "c10", identityFile: "~/.ssh/k" })?.identityFile, "~/.ssh/k");
  assert.equal(parseRemoteTarget({ host: "10.0.0.7", user: "c10" })?.port, 22);
  for (const bad of [
    null, "x", {}, { host: "h" }, { user: "u" },
    { host: "-oProxyCommand=id", user: "c10" }, { host: "h h", user: "c10" }, { host: "h;id", user: "c10" }, { host: "h", user: "-x" }, { host: "h", user: "a b" }, { host: "h", user: "c10; id" },
    { host: "h", user: "c10", port: 0 }, { host: "h", user: "c10", port: 70000 }, { host: "h", user: "c10", port: "22" },
    { host: "h", user: "c10", identityFile: "../x" }, { host: "h", user: "c10", identityFile: "~/../x" }, { host: "h", user: "c10", identityFile: "rel/path" }, { host: "h", user: "c10", identityFile: "/a b" },
  ])
    assert.equal(parseRemoteTarget(bad), null, JSON.stringify(bad));
});

test("ssh 인자: 비대화형, 아는 호스트만, 호스트 앞에 --", () => {
  const a = sshArgs({ host: "desk", user: "c10", port: 2222, identityFile: "/k" }, 3);
  assert.ok(a.includes("BatchMode=yes") && a.includes("StrictHostKeyChecking=yes") && a.includes("ConnectTimeout=3"));
  assert.equal(a[a.length - 2], "--");
  assert.equal(a[a.length - 1], "desk");
  assert.deepEqual(a.slice(a.indexOf("-l"), a.indexOf("-l") + 2), ["-l", "c10"]);
  assert.deepEqual(a.slice(a.indexOf("-p"), a.indexOf("-p") + 2), ["-p", "2222"]);
  assert.ok(a.includes("-i"));
});

test("제외 목록: 비밀이 될 수 있는 것은 보내지 않는다", () => {
  const secret = [
    ".env", ".env.local", ".env.production", "web/.env", "a/b/.env.local", ".git/config", ".git/hooks/pre-commit", "sub/.git/config", ".git", "node_modules/x/index.js", "web/node_modules/y.js",
    ".claude/worktrees/atc-1-x/server/a.ts", ".claude/settings.local.json", ".ssh/id_rsa", "id_rsa", "keys/id_ed25519", "id_ed25519.pub", "certs/server.pem", "tls/a.key", "x.p12",
    ".npmrc", "web/.npmrc", ".netrc", ".aws/credentials", "credentials.json", ".local/state/atc/jobs.json", ".config/gh/hosts.yml", "data/app.sqlite", "../outside", "/etc/passwd", "a/../../b",
  ];
  for (const p of secret) assert.equal(isExcluded(p), true, p);
  const fine = ["server/verify-gate.ts", "web/src/styles.css", ".env.example", ".github/workflows/ci.yml", ".claude/skills/atc-task/SKILL.md", ".claude/settings.json", "package-lock.json", "docs/env.md", "server/keyboard.ts"];
  for (const p of fine) assert.equal(isExcluded(p), false, p);
  const r = filterFiles([...secret, ...fine]);
  assert.deepEqual(r.kept, fine);
  assert.equal(r.excluded.length, secret.length);
});

test("제외 목록은 이 저장소의 추적 파일을 하나도 빼지 않는다(시험이 필요로 하는 소스가 사라지지 않게)", () => {
  const tracked = splitZ(execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64_000_000 }));
  assert.ok(tracked.length > 500);
  assert.deepEqual(tracked.filter(isExcluded), []);
});

test("어디서 돌릴지: 스위치 꺼짐 > 목록 밖 > 접속 정보 없음 > 데스크톱", () => {
  const target = { host: "h", user: "u", port: 22, identityFile: null };
  const test_ = ["npm", "test"];
  assert.deepEqual(routeOf({ remote: "on", argv: test_, atRepoRoot: true, target }), { where: "desktop" });
  assert.deepEqual(routeOf({ remote: "off", argv: test_, atRepoRoot: true, target }), { where: "local", reason: "switch-off" });
  assert.deepEqual(routeOf({ remote: "off", argv: ["ls"], atRepoRoot: true, target }), { where: "local", reason: "switch-off" });
  assert.deepEqual(routeOf({ remote: "on", argv: ["ls"], atRepoRoot: true, target }), { where: "local", reason: "not-listed" });
  assert.deepEqual(routeOf({ remote: "on", argv: ["npm", "test", "--", "x"], atRepoRoot: true, target }), { where: "local", reason: "not-listed" });
  assert.deepEqual(routeOf({ remote: "on", argv: test_, atRepoRoot: false, target }), { where: "local", reason: "not-listed" });
  assert.deepEqual(routeOf({ remote: "on", argv: test_, atRepoRoot: true, target: null }), { where: "local", reason: "desktop-absent" });
});

test("실패의 분류: ssh의 255와 명령 자신의 255를 가른다", () => {
  // ssh가 명령의 종료 코드를 그대로 돌려준 것
  assert.deepEqual(classifyRun({ sshExit: 0, status: null }), { kind: "ran", exit: 0 });
  assert.deepEqual(classifyRun({ sshExit: 1, status: null }), { kind: "ran", exit: 1 });
  assert.deepEqual(classifyRun({ sshExit: 137, status: null }), { kind: "ran", exit: 137 });
  // 255: 종료 표가 있으면 명령이 끝난 것(코드 그대로)
  assert.deepEqual(classifyRun({ sshExit: 255, status: { started: true, exit: 255 } }), { kind: "ran", exit: 255 });
  assert.deepEqual(classifyRun({ sshExit: 255, status: { started: true, exit: 0 } }), { kind: "ran", exit: 0 }); // 끝난 뒤 연결이 끊겼다
  // 255: 시작 표도 없으면 시작 전에 끊겼다
  assert.deepEqual(classifyRun({ sshExit: 255, status: { started: false, exit: null } }), { kind: "transport-before-start" });
  // 255: 시작했는데 종료 표가 없다, 또는 표를 읽지 못했다 → 잃었다(다시 돌리지 않는다)
  assert.deepEqual(classifyRun({ sshExit: 255, status: { started: true, exit: null } }), { kind: "transport-lost" });
  assert.deepEqual(classifyRun({ sshExit: 255, status: null }), { kind: "transport-lost" });
  assert.deepEqual(classifyRun({ sshExit: null, status: null }), { kind: "transport-lost" });
});

test("원격 표 읽기", () => {
  assert.deepEqual(parseStatus("0 \n"), { started: false, exit: null });
  assert.deepEqual(parseStatus("1 \n"), { started: true, exit: null });
  assert.deepEqual(parseStatus("1 3\n"), { started: true, exit: 3 });
  assert.deepEqual(parseStatus("1 255"), { started: true, exit: 255 });
  assert.equal(parseStatus(""), null);
  assert.equal(parseStatus("garbage"), null);
  assert.equal(parseStatus("2 0"), null);
});

test("원격 셸 글: 실행 id·해시·명령을 검사하고 비밀 경로를 건드리지 않는다", () => {
  const id = newRunId(1_700_000_000_000, 4321, "ab12");
  assert.ok(validRunId(id), id);
  assert.equal(validRunId("../x"), false);
  assert.equal(validRunId("a;rm -rf /"), false);
  assert.equal(validRunId("ABC"), false);
  const hash = lockHash("lock-text");
  assert.match(hash, /^[0-9a-f]{16}$/);
  assert.notEqual(lockHash("a"), lockHash("b"));
  for (const bad of ["x;id", "../../etc", "a b"]) {
    assert.throws(() => extractScript(bad));
    assert.throws(() => runScript(bad, ["npm", "test"]));
    assert.throws(() => statusScript(bad));
    assert.throws(() => cleanupScript(bad));
    assert.throws(() => prepareScript(bad, hash));
  }
  assert.throws(() => prepareScript(id, "../../etc/passwd"));
  assert.throws(() => runScript(id, ["sh", "-c", "id"]), /not on the remote list/);
  assert.throws(() => runScript(id, ["npm", "test", "--", "x"]), /not on the remote list/);
  const run = runScript(id, ["npx", "tsc", "--noEmit", "-p", "."]);
  assert.match(run, /ATC_GITHUB=off 'npx' 'tsc' '--noEmit' '-p' '\.'/);
  assert.match(run, /: > \.atc-started/);
  assert.match(run, /echo "\$c" > \.atc-exit/);
  for (const script of [extractScript(id), prepareScript(id, hash), run, statusScript(id), cleanupScript(id)]) {
    assert.doesNotMatch(script, /\.env|\.claude|\.local\/state|\.ssh|id_rsa|credentials|\.npmrc/, "원격 글은 비밀 경로를 건드리지 않는다");
    assert.doesNotMatch(script, /7700/);
  }
  // 지우기는 이 실행의 폴더 하나뿐
  assert.match(cleanupScript(id), new RegExp(`rm -rf "\\$base/runs/${id}"$`));
  // 준비: 빈 저장소를 새로 만든다(원격·자격 증명 없음), 의존은 lock 해시 캐시에서
  const prep = prepareScript(id, hash);
  assert.match(prep, /git init -q \. && git add -A/);
  assert.doesNotMatch(prep, /git (remote|push|fetch|clone|config)/);
  assert.match(prep, /cp -al "\$deps\/node_modules"/);
});

test("따옴표: 작은따옴표를 닫고 다시 연다", () => {
  assert.equal(shq("a b"), "'a b'");
  assert.equal(shq("it's"), `'it'\\''s'`);
  assert.equal(shq("$(id)"), "'$(id)'");
});

test("설정: remote와 닿는지 보는 한도의 기본과 범위", () => {
  assert.equal(parseGateConfig({}).remote, "on");
  assert.equal(parseGateConfig({ remote: "off" }).remote, "off");
  assert.equal(parseGateConfig({ remote: "no" }).remote, "on"); // 끄는 것은 정확히 "off"
  assert.equal(parseGateConfig({}).probeMs, 3000);
  assert.equal(parseGateConfig({ remoteProbeSec: 10 }).probeMs, 10_000);
  assert.equal(parseGateConfig({ remoteProbeSec: 0 }).probeMs, 3000);
  assert.equal(parseGateConfig({ remoteProbeSec: 999 }).probeMs, 3000);
  assert.equal(parseGateConfig({}, { ATC_GATE_REMOTE_PROBE_SEC: "5" }).probeMs, 5000);
});

// ── 가짜 전송 수단 ──
interface Script {
  probe?: boolean;
  sync?: { ok: boolean };
  run?: { sshExit: number | null };
  status?: { started: boolean; exit: number | null } | null;
}
function fake(s: Script) {
  const calls: string[] = [];
  const t: RemoteTransport = {
    async probe() {
      calls.push("probe");
      return s.probe ?? true;
    },
    async sync() {
      calls.push("sync");
      return s.sync ?? { ok: true };
    },
    async run() {
      calls.push("run");
      return s.run ?? { sshExit: 0 };
    },
    async status() {
      calls.push("status");
      return s.status ?? null;
    },
    async cleanup() {
      calls.push("cleanup");
    },
  };
  return { t, calls };
}
const go = (s: Script) => {
  const f = fake(s);
  let n = 0;
  return runOnDesktop({ argv: ["npm", "test"], id: "abc123-1-ab", hash: "0123456789abcdef", transport: f.t, probeMs: 1000, now: () => (n += 10) }).then((r) => ({ r, calls: f.calls }));
};

test("데스크톱이 없으면(probe 실패) 보내지도 돌리지도 않고 로컬로", async () => {
  const { r, calls } = await go({ probe: false });
  assert.deepEqual(r, { where: "local", reason: "desktop-absent", syncMs: 0 });
  assert.deepEqual(calls, ["probe"]);
});

test("보내기·준비가 실패하면 치우고 로컬로(전송 오류)", async () => {
  const { r, calls } = await go({ sync: { ok: false } });
  assert.equal(r.where, "local");
  assert.equal("reason" in r && r.reason, "transport-error");
  assert.deepEqual(calls, ["probe", "sync", "cleanup"]);
});

test("명령의 종료 코드는 그대로이고 실패해도 전송 문제로 보지 않는다", async () => {
  for (const code of [0, 1, 2, 137]) {
    const { r, calls } = await go({ run: { sshExit: code } });
    assert.equal(r.where, "desktop");
    assert.equal("exit" in r && r.exit, code);
    assert.ok(!("lost" in r));
    assert.deepEqual(calls, ["probe", "sync", "run", "cleanup"]);
  }
});

test("시작 전에 연결이 끊기면(255, 시작 표 없음) 로컬로 돌아서고 원격은 한 번도 돌지 않았다고 본다", async () => {
  const { r, calls } = await go({ run: { sshExit: 255 }, status: { started: false, exit: null } });
  assert.equal(r.where, "local");
  assert.equal("reason" in r && r.reason, "transport-error");
  assert.deepEqual(calls, ["probe", "sync", "run", "status", "cleanup"]);
});

test("시작한 뒤 연결이 끊기면 시험 실패가 아니라 '잃음'(76)이고 다시 돌리지 않는다", async () => {
  for (const status of [{ started: true, exit: null }, null]) {
    const { r, calls } = await go({ run: { sshExit: 255 }, status });
    assert.equal(r.where, "desktop");
    assert.equal("lost" in r && r.lost, true);
    assert.equal("exit" in r && r.exit, REMOTE_LOST_EXIT);
    assert.equal(calls.filter((c) => c === "run").length, 1, "run은 한 번뿐");
    assert.ok(!calls.includes("cleanup"), "아직 돌고 있을 수 있어 폴더를 지우지 않는다");
  }
});

test("명령 자신이 255로 끝난 것은 255 그대로(전송 문제가 아니다)", async () => {
  const { r } = await go({ run: { sshExit: 255 }, status: { started: true, exit: 255 } });
  assert.equal(r.where, "desktop");
  assert.equal("exit" in r && r.exit, 255);
  assert.ok(!("lost" in r));
});

test("보내기·준비·실행 시간이 기록에 쓸 수 있게 나온다", async () => {
  const { r } = await go({});
  assert.ok(r.where === "desktop" && r.syncMs > 0 && r.ranMs > 0);
});

// ── 세기 ──
const line = (p: Partial<GateRun>): GateRun => ({ t: new Date().toISOString(), where: "local", cmd: "npm test", cwd: "/x", waited: false, waitedMs: 0, ranMs: 5, exit: 0, ...p });

test("세기: 데스크톱 실행, 전송 실패, 데스크톱에서 명령 실패, 사유별 로컬, 도중에 잃음", () => {
  const c = countRuns([
    line({ where: "desktop", syncMs: 900, ranMs: 5000, exit: 0 }),
    line({ where: "desktop", syncMs: 900, ranMs: 5000, exit: 1 }), // 명령 실패: 전송 실패가 아니다
    line({ where: "desktop", syncMs: 900, ranMs: 5000, exit: 76, lost: true }),
    line({ localReason: "desktop-absent" }),
    line({ localReason: "transport-error", syncMs: 300 }),
    line({ localReason: "not-listed" }),
    line({ localReason: "not-listed" }),
    line({ localReason: "switch-off" }),
    line({}), // 사유 없음(옛 줄)
  ]);
  assert.equal(c.runs, 9);
  assert.equal(c.desktopRuns, 3);
  assert.equal(c.remoteCommandFails, 1);
  assert.equal(c.lostMidway, 1);
  assert.equal(c.transportFailed, 2, "시작 전 전송 오류 1 + 잃음 1");
  assert.deepEqual(c.localFallbacks, { "desktop-absent": 1, "transport-error": 1, "not-listed": 2, "switch-off": 1 });
});

test("세기: 모르는 사유는 세지 않는다", () => {
  const c = countRuns([line({ localReason: "weird" as never })]);
  assert.deepEqual(c.localFallbacks, { "desktop-absent": 0, "transport-error": 0, "not-listed": 0, "switch-off": 0 });
});

// ATC-524: 없다고 본 것을 잠깐 기억한다. 게이트 폴더는 임시 폴더로 시험한다
const absentRun = async (dir: string, absentMs: number, now: number, s: Script) => {
  const f = fake(s);
  const m = absentMemory(dir, absentMs, () => now);
  const r = await runOnDesktop({ argv: ["npm", "test"], id: "abc123-1-ab", hash: "0123456789abcdef", transport: f.t, probeMs: 1000, ...m });
  return { r, calls: f.calls };
};
const tmpGate = () => mkdtempSync(join(tmpdir(), "atc-absent-"));

test("없다고 본 뒤 window 안의 실행은 probe를 건너뛰고, 지난 뒤 첫 실행은 다시 probe한다", async () => {
  const dir = tmpGate();
  try {
    const first = await absentRun(dir, 60_000, 1_000_000, { probe: false });
    assert.deepEqual(first.calls, ["probe"]);
    const within = await absentRun(dir, 60_000, 1_030_000, { probe: false });
    assert.deepEqual(within.calls, []);
    assert.deepEqual(within.r, { where: "local", reason: "desktop-absent", syncMs: 0 });
    const after = await absentRun(dir, 60_000, 1_060_000, { probe: true });
    assert.equal(after.calls[0], "probe"); // window 끝: 다시 probe하고 돌아왔으면 데스크톱을 쓴다
    assert.equal(after.r.where, "desktop");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("닿는다고 본 probe는 기억을 지운다", async () => {
  const dir = tmpGate();
  try {
    await absentRun(dir, 60_000, 1_000_000, { probe: false });
    assert.equal(existsSync(join(dir, ABSENT_MARK_FILE)), true);
    await absentRun(dir, 60_000, 1_060_000, { probe: true });
    assert.equal(existsSync(join(dir, ABSENT_MARK_FILE)), false);
    const next = await absentRun(dir, 60_000, 1_061_000, { probe: true });
    assert.equal(next.calls[0], "probe");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("전송 오류는 기억을 시작하지 않는다(없다고 본 것만 기억한다)", async () => {
  const dir = tmpGate();
  try {
    const r = await absentRun(dir, 60_000, 1_000_000, { sync: { ok: false } });
    assert.equal("reason" in r.r && r.r.reason, "transport-error");
    assert.equal(existsSync(join(dir, ABSENT_MARK_FILE)), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("0이면 기억을 끈다: 파일을 쓰지도 읽지도 않는다", async () => {
  const dir = tmpGate();
  try {
    await absentRun(dir, 0, 1_000_000, { probe: false });
    assert.equal(existsSync(join(dir, ABSENT_MARK_FILE)), false);
    writeFileSync(join(dir, ABSENT_MARK_FILE), JSON.stringify({ at: 1_000_000 })); // 있어도 0이면 무시
    const r = await absentRun(dir, 0, 1_001_000, { probe: false });
    assert.deepEqual(r.calls, ["probe"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("기억 파일이 깨졌거나 미래 시각이면 평소대로 probe한다", async () => {
  const dir = tmpGate();
  try {
    for (const text of ["", "{", "null", '{"at":"x"}', '{"at":-1}', '{"at":9999999999999}']) {
      writeFileSync(join(dir, ABSENT_MARK_FILE), text);
      const r = await absentRun(dir, 60_000, 1_000_000, { probe: false });
      assert.deepEqual(r.calls, ["probe"], text);
    }
    assert.equal(parseAbsentMark("{"), null);
    assert.equal(skipProbe(null, 5, 60_000), false);
    assert.equal(skipProbe(10, 5, 60_000), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("건너뛴 실행도 desktop-absent 횟수에 센다", async () => {
  const dir = tmpGate();
  try {
    const runs: GateRun[] = [];
    for (const at of [1_000_000, 1_010_000, 1_020_000]) {
      const r = await absentRun(dir, 60_000, at, { probe: false });
      assert.equal(r.r.where, "local");
      runs.push({ t: "x", where: "local", cmd: "npm test", cwd: "/", waited: false, waitedMs: 0, ranMs: 1, exit: 0, localReason: "desktop-absent" });
    }
    assert.equal(countRuns(runs).localFallbacks["desktop-absent"], 3); // 첫 실행만 probe했고 둘은 건너뛰었다
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("설정: remoteAbsentSec·ATC_GATE_REMOTE_ABSENT_SEC, 기본 60초, 0은 끔, 틀린 값은 기본", () => {
  assert.equal(parseGateConfig({}).absentMs, 60_000);
  assert.equal(parseGateConfig({ remoteAbsentSec: 0 }).absentMs, 0);
  assert.equal(parseGateConfig({ remoteAbsentSec: 120 }).absentMs, 120_000);
  assert.equal(parseGateConfig({ remoteAbsentSec: -1 }).absentMs, 60_000);
  assert.equal(parseGateConfig({ remoteAbsentSec: 99999 }).absentMs, 60_000);
  assert.equal(parseGateConfig({ remoteAbsentSec: 120 }, { ATC_GATE_REMOTE_ABSENT_SEC: "0" }).absentMs, 0);
});

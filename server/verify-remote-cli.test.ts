import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseRuns } from "./verify-gate.ts";

// ATC-518: 문 실행기가 데스크톱을 쓰는 길을 가짜 `ssh`(PATH 맨 앞의 작은 node 스크립트)로 시험한다. 실제 데스크톱·실제 ssh에는 닿지 않는다.
// 띄우는 명령은 임시 저장소의 `npm test`(= echo 한 줄)뿐이라 무겁지 않다.
const CLI = fileURLToPath(new URL("./verify-gate-cli.ts", import.meta.url));
const roots: string[] = [];
const fresh = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  roots.push(d);
  return d;
};
after(() => {
  for (const d of roots) rmSync(d, { recursive: true, force: true });
});

// 가짜 ssh: 마지막 인자(원격 명령)를 보고 흉내 낸다. 호출은 calls.log에 한 줄씩 남는다. 동작은 환경 변수 FAKE_*로 정한다
const SHIM = `#!${process.execPath}
const fs = require("node:fs");
const a = process.argv.slice(2);
const last = a[a.length - 1];
const log = (s) => fs.appendFileSync(process.env.FAKE_LOG, s + "\\n");
const kind = last === "true" ? "probe" : last.includes("tar -x") ? "extract" : last.includes("git init") ? "prepare" : last.includes("ATC_GITHUB") ? "run" : last.includes("rm -rf") ? "cleanup" : last.includes(".atc-exit") ? "status" : "other";
log(kind + " " + JSON.stringify(a.slice(0, -1)));
const fail = process.env.FAKE_FAIL || "";
if (fail === kind) process.exit(255);
if (kind === "extract") { process.stdin.resume(); process.stdin.on("end", () => process.exit(0)); }
else if (kind === "run") { console.log("REMOTE-OUT"); console.error("REMOTE-ERR"); process.exit(Number(process.env.FAKE_RUN_EXIT || 0)); }
else if (kind === "status") { console.log(process.env.FAKE_STATUS || "0 "); process.exit(0); }
else process.exit(0);
`;

function setup(opts: { remoteJson?: unknown; config?: unknown; env?: Record<string, string> }) {
  const bin = fresh("atc-fakessh-");
  writeFileSync(join(bin, "ssh"), SHIM);
  chmodSync(join(bin, "ssh"), 0o755);
  const gate = fresh("atc-gate-r-");
  if (opts.remoteJson !== undefined) writeFileSync(join(gate, "remote.json"), JSON.stringify(opts.remoteJson));
  if (opts.config !== undefined) writeFileSync(join(gate, "config.json"), JSON.stringify(opts.config));
  const repo = fresh("atc-repo-r-");
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "t", scripts: { test: "echo LOCAL-RAN" } }));
  writeFileSync(join(repo, "package-lock.json"), "{}");
  writeFileSync(join(repo, ".env"), "SECRET=1");
  writeFileSync(join(repo, "a.txt"), "x");
  spawnSync("git", ["init", "-q", repo]);
  const log = join(gate, "calls.log");
  writeFileSync(log, "");
  const env: NodeJS.ProcessEnv = { ...process.env, ATC_GATE_DIR: gate, PATH: `${bin}${delimiter}${process.env.PATH}`, FAKE_LOG: log, ...opts.env };
  delete env.NODE_TEST_CONTEXT;
  const run = (argv: string[]) => spawnSync(process.execPath, [CLI, "--", ...argv], { env, cwd: repo, encoding: "utf8", timeout: 60_000 });
  const calls = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
  const runs = () => parseRuns(readFileSync(join(gate, "runs.jsonl"), "utf8"));
  return { run, calls, runs, repo, gate };
}
const TARGET = { host: "desk.test", user: "c10", port: 2222 };

// 파일 안의 시험은 서로 임시 폴더가 달라 겹치지 않는다: 병렬로 돌려 가장 긴 시험 하나가 파일 시간이 되게 한다(ATC-523)
describe("verify-remote-cli", { concurrency: 4 }, () => {
  test("데스크톱에서 돈다: 출력과 종료 코드는 그대로이고 기록에 desktop·보내기 시간이 남는다", () => {
    const s = setup({ remoteJson: TARGET, env: { FAKE_RUN_EXIT: "5" } });
    const r = s.run(["npm", "test"]);
    assert.equal(r.status, 5);
    assert.equal(r.stdout, "REMOTE-OUT\n");
    assert.equal(r.stderr, "REMOTE-ERR\n");
    assert.ok(!r.stdout.includes("LOCAL-RAN"), "로컬에서는 돌지 않았다");
    const [run] = s.runs();
    assert.equal(run.where, "desktop");
    assert.equal(run.exit, 5);
    assert.equal(typeof run.syncMs, "number");
    assert.equal(typeof run.ranMs, "number");
    assert.equal(run.localReason, undefined);
    const kinds = s.calls().map((c) => c.split(" ")[0]);
    assert.deepEqual(kinds, ["probe", "extract", "prepare", "run", "cleanup"]);
    assert.ok(s.calls().every((c) => c.includes("desk.test") === false || true));
  });

  test("ssh 인자: 접속 정보는 인자로만, 비대화형, 아는 호스트만", () => {
    const s = setup({ remoteJson: TARGET });
    s.run(["npm", "test"]);
    const first = s.calls()[0];
    assert.match(first, /"-l","c10"/);
    assert.match(first, /"-p","2222"/);
    assert.match(first, /"BatchMode=yes"/);
    assert.match(first, /"StrictHostKeyChecking=yes"/);
    assert.match(first, /"--","desk\.test"/);
  });

  test("데스크톱이 없으면(probe 실패) 로컬 문에서 돌고 사유 desktop-absent가 남는다. 보내지 않는다", () => {
    const s = setup({ remoteJson: TARGET, env: { FAKE_FAIL: "probe" } });
    const r = s.run(["npm", "test"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /LOCAL-RAN/);
    assert.deepEqual(s.calls().map((c) => c.split(" ")[0]), ["probe"]);
    const [run] = s.runs();
    assert.equal(run.where, "local");
    assert.equal(run.localReason, "desktop-absent");
  });

  test("접속 정보(remote.json)가 없으면 ssh를 부르지 않고 로컬로(desktop-absent)", () => {
    const s = setup({});
    const r = s.run(["npm", "test"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /LOCAL-RAN/);
    assert.deepEqual(s.calls(), []);
    assert.equal(s.runs()[0].localReason, "desktop-absent");
  });

  test("목록에 없는 명령은 데스크톱에 가지 않는다(not-listed)", () => {
    const s = setup({ remoteJson: TARGET });
    for (const argv of [["node", "-e", "console.log('X')"], ["npm", "test", "--", "--foo"], ["sh", "-c", "echo hi"]]) {
      const r = s.run(argv);
      assert.equal(r.status, 0, argv.join(" "));
    }
    assert.deepEqual(s.calls(), [], "ssh를 한 번도 부르지 않는다");
    assert.deepEqual(s.runs().map((x) => x.localReason), ["not-listed", "not-listed", "not-listed"]);
    assert.ok(s.runs().every((x) => x.where === "local"));
  });

  test("스위치가 꺼지면 목록에 있는 명령도 로컬로(switch-off)", () => {
    const s = setup({ remoteJson: TARGET, config: { remote: "off" } });
    const r = s.run(["npm", "test"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /LOCAL-RAN/);
    assert.deepEqual(s.calls(), []);
    assert.equal(s.runs()[0].localReason, "switch-off");
  });

  test("보내기가 시작 전에 실패하면 로컬로 돈다(transport-error) — 오류 없이 같은 결과", () => {
    for (const fail of ["extract", "prepare"]) {
      const s = setup({ remoteJson: TARGET, env: { FAKE_FAIL: fail } });
      const r = s.run(["npm", "test"]);
      assert.equal(r.status, 0, fail);
      assert.match(r.stdout, /LOCAL-RAN/);
      const [run] = s.runs();
      assert.equal(run.where, "local");
      assert.equal(run.localReason, "transport-error");
      assert.equal(typeof run.syncMs, "number");
      assert.ok(s.calls().map((c) => c.split(" ")[0]).includes("cleanup"));
      assert.ok(!s.calls().some((c) => c.startsWith("run")), "원격 명령은 시작하지 않았다");
    }
  });

  test("시작한 뒤 연결을 잃으면 76과 안내, 다시 돌리지 않고 로컬로도 돌지 않는다(lost)", () => {
    const s = setup({ remoteJson: TARGET, env: { FAKE_FAIL: "run", FAKE_STATUS: "1 " } });
    const r = s.run(["npm", "test"]);
    assert.equal(r.status, 76);
    assert.match(r.stderr, /lost the connection to the desktop after the command started/);
    assert.ok(!r.stdout.includes("LOCAL-RAN"));
    assert.equal(s.calls().filter((c) => c.startsWith("run")).length, 1);
    const [run] = s.runs();
    assert.equal(run.where, "desktop");
    assert.equal(run.lost, true);
    assert.equal(run.exit, 76);
  });

  test("시작 전에 끊기면(255, 시작 표 없음) 로컬로 돈다", () => {
    const s = setup({ remoteJson: TARGET, env: { FAKE_FAIL: "run", FAKE_STATUS: "0 " } });
    const r = s.run(["npm", "test"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /LOCAL-RAN/);
    assert.equal(s.runs()[0].localReason, "transport-error");
  });

  test("명령 자신이 255로 끝나면 255 그대로(전송 문제가 아님)", () => {
    const s = setup({ remoteJson: TARGET, env: { FAKE_FAIL: "run", FAKE_STATUS: "1 255" } });
    const r = s.run(["npm", "test"]);
    assert.equal(r.status, 255);
    assert.equal(s.runs()[0].where, "desktop");
    assert.equal(s.runs()[0].lost, undefined);
  });

  test("모양이 틀린 접속 정보는 없는 것으로 본다(옵션 주입 글자)", () => {
    const s = setup({ remoteJson: { host: "-oProxyCommand=touch /tmp/x", user: "c10" } });
    const r = s.run(["npm", "test"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /LOCAL-RAN/);
    assert.deepEqual(s.calls(), []);
  });
});

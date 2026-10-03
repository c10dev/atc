import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseRuns } from "./verify-gate.ts";

// 문 실행기를 임시 폴더로 시험한다. 띄우는 명령은 node -e 한 줄뿐이라 가볍다(무거운 검증 명령은 돌리지 않는다)
const CLI = fileURLToPath(new URL("./verify-gate-cli.ts", import.meta.url));
const roots: string[] = [];
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), "atc-gate-test-"));
  roots.push(d);
  return d;
};
after(() => {
  for (const d of roots) rmSync(d, { recursive: true, force: true });
});
const envOf = (dir: string, extra: Record<string, string> = {}) => {
  const env: NodeJS.ProcessEnv = { ...process.env, ATC_GATE_DIR: dir, ATC_GATE_POLL_MS: "50", ...extra }; // 줄 서기 점검을 50ms로(운영 기본은 1000ms, ATC-523)
  delete env.NODE_TEST_CONTEXT; // 시험 러너 안에서 띄운 node --test가 자식 모드로 빠져 파일을 돌리지 않게
  return env;
};
const gateSync = (dir: string, args: string[], extra: Record<string, string> = {}) => spawnSync(process.execPath, [CLI, "--", ...args], { env: envOf(dir, extra), encoding: "utf8" });
const gateAsync = (dir: string, args: string[], extra: Record<string, string> = {}) => {
  const c = spawn(process.execPath, [CLI, "--", ...args], { env: envOf(dir, extra), stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  c.stdout?.on("data", (b) => (out += b));
  c.stderr?.on("data", (b) => (err += b));
  const done = new Promise<{ code: number | null; out: string; err: string }>((r) => c.on("close", (code) => r({ code, out, err })));
  return { c, done, err: () => err };
};
const runsOf = (dir: string) => {
  try {
    return parseRuns(readFileSync(join(dir, "runs.jsonl"), "utf8"));
  } catch {
    return [];
  }
};
const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));
// 슬롯을 쥐고 ms 동안 사는 명령. 시작하면 started 파일을 만든다: 병렬로 돌 때 고정 sleep으로는 두 번째가 먼저 슬롯을 잡을 수 있어 이것을 기다린다(ATC-523)
const holder = (ms: number, started?: string, release?: string) => [
  "node",
  "-e",
  `const fs = require("fs");${started ? `fs.writeFileSync(${JSON.stringify(started)}, "x");` : ""}setTimeout(() => process.exit(0), ${ms});${release ? `setInterval(() => { if (fs.existsSync(${JSON.stringify(release)})) process.exit(0); }, 20);` : ""}`,
];
const waitFor = async (cond: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    assert.ok(Date.now() < end, "기다리던 일이 일어나지 않았다");
    await sleepMs(20);
  }
};


// 파일 안의 시험은 서로 임시 폴더·포트가 달라 겹치지 않는다: 병렬로 돌려 가장 긴 시험 하나가 파일 시간이 되게 한다(ATC-523)
describe("verify-gate-cli", { concurrency: 4 }, () => {
  test("종료 코드와 출력을 그대로 돌려주고 기록 한 줄을 남긴다", () => {
    const dir = fresh();
    const r = gateSync(dir, ["node", "-e", "console.log('hi'); console.error('err'); process.exit(7)"]);
    assert.equal(r.status, 7);
    assert.equal(r.stdout, "hi\n");
    assert.equal(r.stderr, "err\n");
    const runs = runsOf(dir);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].where, "local");
    assert.equal(runs[0].exit, 7);
    assert.equal(runs[0].waited, false);
    assert.equal(typeof runs[0].ranMs, "number");
  });

  test("작업 폴더와 stdin을 그대로 잇는다", () => {
    const dir = fresh();
    const cwd = fresh();
    const r = spawnSync(process.execPath, [CLI, "--", "node", "-e", "process.stdin.pipe(process.stdout); console.log(process.cwd())"], { env: envOf(dir), cwd, input: "x", encoding: "utf8" });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /x/);
    assert.ok(r.stdout.includes(cwd.replace(/^\/private/, "")));
  });

  test("없는 명령은 직접 실행했을 때처럼 127", () => {
    const r = gateSync(fresh(), ["definitely-not-a-command-atc517"]);
    assert.equal(r.status, 127);
  });

  test("명령이 없으면 사용법과 64", () => {
    const r = spawnSync(process.execPath, [CLI], { env: envOf(fresh()), encoding: "utf8" });
    assert.equal(r.status, 64);
    assert.match(r.stderr, /usage/);
  });

  test("자리가 없으면 줄을 서고 stderr에 알린 뒤 차례가 오면 돈다", async () => {
    const dir = fresh();
    const env = { ATC_GATE_SLOTS: "1" };
    const release = join(dir, "release");
    const first = gateAsync(dir, holder(30_000, join(dir, "started"), release), env);
    await waitFor(() => existsSync(join(dir, "started")));
    const second = gateAsync(dir, ["node", "-e", "console.log('second ran')"], env);
    await waitFor(() => /waiting for a slot/.test(second.err())); // 줄에 서서 알렸다
    await sleepMs(300); // 한동안 기다린 뒤에 놓는다(waitedMs 단언)
    writeFileSync(release, "x");
    const [a, b] = await Promise.all([first.done, second.done]);
    assert.equal(a.code, 0);
    assert.equal(b.code, 0);
    assert.equal(b.out, "second ran\n");
    assert.match(b.err, /waiting for a slot: position 1/);
    const runs = runsOf(dir);
    assert.equal(runs.length, 2);
    const waiter = runs.find((r) => r.waited);
    assert.ok(waiter && waiter.waitedMs > 250);
  });

  test("동시에 N건까지만 돈다", async () => {
    const dir = fresh();
    const log = join(dir, "overlap.log");
    const release = join(dir, "release");
    // 시작하면 S를 쓰고 해제 파일이 생길 때까지 슬롯을 쥔 뒤 E를 쓴다
    const prog = `const fs=require('fs');fs.appendFileSync(${JSON.stringify(log)},'S\\n');const done=()=>{fs.appendFileSync(${JSON.stringify(log)},'E\\n');process.exit(0)};setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))done()},20)`;
    const jobs = [1, 2, 3, 4].map(() => gateAsync(dir, ["node", "-e", prog], { ATC_GATE_SLOTS: "2" }));
    const started = () => readFileSync(log, "utf8").split("\n").filter((l) => l === "S").length;
    await waitFor(() => existsSync(log) && started() === 2); // 두 건이 슬롯을 쥐었다
    await sleepMs(300); // 나머지 두 건은 그동안 줄에서 기다린다(셋째가 뜨지 않는다)
    assert.equal(started(), 2);
    writeFileSync(release, "x");
    await Promise.all(jobs.map((j) => j.done));
    let cur = 0;
    let max = 0;
    for (const l of readFileSync(log, "utf8").trim().split("\n")) {
      cur += l === "S" ? 1 : -1;
      max = Math.max(max, cur);
    }
    assert.equal(max, 2);
    assert.equal(runsOf(dir).length, 4);
  });

  test("기다림 한도를 넘기면 75와 메시지, 명령은 돌지 않는다", async () => {
    const dir = fresh();
    const env = { ATC_GATE_SLOTS: "1", ATC_GATE_WAIT_LIMIT_MS: "400" };
    const first = gateAsync(dir, holder(30_000, join(dir, "started")), env);
    await waitFor(() => existsSync(join(dir, "started")));
    const marker = join(dir, "should-not-exist");
    const second = gateAsync(dir, ["node", "-e", `require('fs').writeFileSync(${JSON.stringify(marker)},'x')`], env);
    const b = await second.done;
    assert.equal(b.code, 75);
    assert.match(b.err, /gave up after/);
    assert.throws(() => readFileSync(marker));
    first.c.kill("SIGTERM");
    await first.done;
    assert.equal(runsOf(dir).filter((r) => r.timedOut).length, 1);
  });

  test("신호로 죽은 명령은 슬롯을 놓고 killed로 센다", async () => {
    const dir = fresh();
    const env = { ATC_GATE_SLOTS: "1" };
    const first = gateAsync(dir, holder(30_000, join(dir, "started")), env);
    await waitFor(() => existsSync(join(dir, "started")));
    first.c.kill("SIGTERM");
    const a = await first.done;
    assert.equal(a.code, 143);
    const t0 = Date.now();
    const r = gateSync(dir, ["node", "-e", "0"], env);
    assert.equal(r.status, 0);
    assert.ok(Date.now() - t0 < 1500, "죽은 명령의 슬롯이 바로 비어야 한다");
    const killed = runsOf(dir).filter((x) => x.killed);
    assert.equal(killed.length, 1);
  });

  test("문이 못 돌면(슬롯 폴더 대신 파일) 바로 실행하고 fallback을 센다", () => {
    const dir = fresh();
    writeFileSync(join(dir, "slots"), "not a directory");
    const r = gateSync(dir, ["node", "-e", "console.log('direct'); process.exit(3)"]);
    assert.equal(r.status, 3);
    assert.equal(r.stdout, "direct\n");
    assert.match(r.stderr, /gate unavailable/);
    const runs = runsOf(dir);
    assert.equal(runs.length, 1);
    assert.ok(runs[0].fallback);
  });

  test("락 폴더를 아예 못 쓰면 그래도 바로 실행한다", () => {
    const dir = fresh();
    writeFileSync(join(dir, "blocker"), "file");
    const r = gateSync(join(dir, "blocker", "sub"), ["node", "-e", "process.exit(5)"]);
    assert.equal(r.status, 5);
    assert.match(r.stderr, /gate unavailable/);
  });

  test("스위치가 off면 줄도 기록도 없이 바로 실행", () => {
    const dir = fresh();
    writeFileSync(join(dir, "config.json"), JSON.stringify({ mode: "off" }));
    const r = gateSync(dir, ["node", "-e", "process.exit(4)"]);
    assert.equal(r.status, 4);
    assert.equal(runsOf(dir).length, 0);
    assert.throws(() => readFileSync(join(dir, "queue")), /EISDIR|ENOENT/);
  });

  test("node --test 한 번의 프로세스 수를 건다(껍데기)", () => {
    const dir = fresh();
    const proj = join(dir, "proj");
    mkdirSync(proj);
    const log = join(proj, "log.txt");
    for (let i = 1; i <= 4; i++) {
      writeFileSync(join(proj, `f${i}.test.mjs`), `import t from "node:test";\nimport fs from "node:fs";\nfs.appendFileSync(${JSON.stringify(log)}, "S\\n");\nt("a", async () => { await new Promise((r) => setTimeout(r, 150)); fs.appendFileSync(${JSON.stringify(log)}, "E\\n"); });\n`);
    }
    const r = spawnSync(process.execPath, [CLI, "--", "node", "--test", "f1.test.mjs", "f2.test.mjs", "f3.test.mjs", "f4.test.mjs"], { env: envOf(dir, { ATC_GATE_TEST_CONCURRENCY: "1" }), cwd: proj, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    let cur = 0;
    let max = 0;
    for (const l of readFileSync(log, "utf8").trim().split("\n")) {
      cur += l === "S" ? 1 : -1;
      max = Math.max(max, cur);
    }
    assert.equal(max, 1);
  });

  test("스위치 저장: mode만 바꾸고 다른 칸은 두며, 설정 창 자료가 기록을 센다", async () => {
    const { loadGateMode, setGateMode, verifyGateData } = await import("./verify-gate-run.ts");
    const dir = fresh();
    const env = { ...process.env, ATC_GATE_DIR: dir };
    assert.equal(loadGateMode(env), "on");
    writeFileSync(join(dir, "config.json"), JSON.stringify({ slots: 3 }));
    setGateMode("off", env);
    assert.equal(loadGateMode(env), "off");
    assert.equal(JSON.parse(readFileSync(join(dir, "config.json"), "utf8")).slots, 3);
    setGateMode("on", env);
    gateSync(dir, ["node", "-e", "0"]);
    const d = verifyGateData(env);
    assert.equal(d.total.runs, 1);
    assert.equal(d.slots, 3);
  });

  // 빠른 명령이 "락을 못 잡음"으로 오해되어 두 번 돌지 않는지
  test("매우 빨리 끝나는 명령도 한 번만 돈다", () => {
    const dir = fresh();
    const log = join(dir, "count.txt");
    for (let i = 0; i < 5; i++) gateSync(dir, ["node", "-e", `require('fs').appendFileSync(${JSON.stringify(log)}, 'x')`]);
    assert.equal(readFileSync(log, "utf8"), "xxxxx");
    assert.equal(runsOf(dir).length, 5);
  });
});

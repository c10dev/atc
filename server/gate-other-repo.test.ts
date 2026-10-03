import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseBrowserRuns } from "./browser-gate.ts";
import { parseRuns } from "./verify-gate.ts";

// 다른 AIRPORT 저장소(만든 이름의 임시 git 저장소)가 두 문을 쓰는 모습을 시험한다(ATC-526). 진짜 Chrome·ssh는 쓰지 않는다
const VERIFY = fileURLToPath(new URL("./verify-gate-cli.ts", import.meta.url));
const BROWSER = fileURLToPath(new URL("./browser-gate-cli.ts", import.meta.url));
const roots: string[] = [];
const fresh = (prefix = "atc-orepo-test-") => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  roots.push(d);
  return d;
};
after(() => {
  for (const d of roots) rmSync(d, { recursive: true, force: true });
});

// 만든 저장소: <임시>/made-up-web 폴더에 git init. 폴더 이름이 저장소 키가 된다
function madeUpRepo(name = "made-up-web"): string {
  const dir = join(fresh(), name);
  mkdirSync(dir);
  assert.equal(spawnSync("git", ["init", "-q", dir]).status, 0);
  writeFileSync(join(dir, "package-lock.json"), "{}\n");
  return dir;
}
const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    assert.ok(Date.now() < end, "기다리던 일이 일어나지 않았다");
    await sleepMs(20);
  }
};
const baseEnv = (gate: string, extra: Record<string, string> = {}) => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.ATC_BROWSER_REAL; // 밖의 환경이 시험을 바꾸지 않게
  return { ...env, ATC_GATE_DIR: gate, ATC_GATE_POLL_MS: "50", ...extra };
};

// ── BROWSER GATE ──
function fakeChrome(dir: string, ms: number, release?: string): string {
  const file = join(dir, `chrome-${ms}${release ? "-r" : ""}`);
  writeFileSync(file, `#!${process.execPath}\nconst fs=require("fs");console.log("CHROME "+process.argv.slice(2).join(" "));fs.appendFileSync(${JSON.stringify(join(dir, "pids"))},process.pid+"\\n");setTimeout(()=>process.exit(0),${ms});${release ? `setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))process.exit(0)},20);` : ""}\n`);
  chmodSync(file, 0o755);
  return file;
}
const browser = (gate: string, cwd: string, args: string[], extra: Record<string, string> = {}) => {
  const c = spawn(process.execPath, [BROWSER, ...args], { cwd, env: baseEnv(gate, extra), stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  c.stdout?.on("data", (b) => (out += b));
  c.stderr?.on("data", (b) => (err += b));
  return { done: new Promise<{ code: number | null; out: string; err: string }>((r) => c.on("close", (code) => r({ code, out, err }))), err: () => err };
};
const browserRuns = (gate: string) => {
  try {
    return parseBrowserRuns(readFileSync(join(gate, "browser", "runs.jsonl"), "utf8"));
  } catch {
    return [];
  }
};

describe("BROWSER GATE: 다른 저장소의 스크립트", { concurrency: 4 }, () => {
  test("다른 저장소 세 개와 atc(MCP) 한 개가 같은 슬롯 3개를 나눠 쓴다: 네 번째는 BUSY, 기록에 폴더 이름", async () => {
    const gate = fresh();
    const repo = madeUpRepo();
    const release = join(gate, "release");
    const real = fakeChrome(gate, 30_000, release);
    const env = { ATC_BROWSER_REAL: real, ATC_BROWSER_SLOTS: "3", ATC_BROWSER_WAIT_LIMIT_MS: "500" };
    const held = [0, 1, 2].map(() => browser(gate, repo, ["--headless"], env));
    await waitFor(() => existsSync(join(gate, "pids")) && readFileSync(join(gate, "pids"), "utf8").trim().split("\n").length === 3);
    const mcp = browser(gate, process.cwd(), ["--headless"], env); // atc 쪽(MCP가 띄운 Chrome과 같은 경로)
    const r = await mcp.done;
    assert.equal(r.code, 75);
    assert.match(r.err, /BUSY: all 3 shared browser slots are in use/);
    assert.ok(!r.out.includes("CHROME"));
    writeFileSync(release, "x");
    await Promise.all(held.map((h) => h.done));
    const runs = browserRuns(gate);
    assert.equal(runs.filter((x) => x.repo === "made-up-web").length, 3);
    const busy = runs.filter((x) => x.busy);
    assert.equal(busy.length, 1);
    assert.ok(busy[0].repo && busy[0].repo !== "made-up-web");
    for (const x of runs) assert.ok(!(x.repo ?? "").includes("/"), "기록에는 폴더 이름만");
  });

  test("repos.json의 browserExecutable이 그 저장소의 Chrome이 된다(환경이 없을 때)", async () => {
    const gate = fresh();
    const repo = madeUpRepo();
    const other = madeUpRepo("made-up-other");
    const chromeA = fakeChrome(gate, 10);
    writeFileSync(join(gate, "repos.json"), JSON.stringify({ "made-up-web": { browserExecutable: chromeA } }));
    const a = await browser(gate, repo, ["a"]).done;
    assert.equal(a.code, 0);
    assert.equal(a.out, "CHROME a\n");
    const b = await browser(gate, other, ["b"], { ATC_BROWSER_REAL: "/nonexistent/chrome" }).done; // 설정 없는 저장소는 환경대로
    assert.notEqual(b.code, 0); // 설정 없는 저장소는 chromeA를 쓰지 않는다: 환경이 가리킨 없는 Chrome은 시작하지 못한다
    assert.ok(!b.out.includes("CHROME"));
  });

  test("--print-launcher: 껍데기 경로를 낸다(다른 저장소 스크립트의 executablePath)", () => {
    const r = spawnSync(process.execPath, [BROWSER, "--print-launcher"], { env: baseEnv(fresh()), encoding: "utf8" });
    assert.equal(r.status, 0);
    const path = r.stdout.trim();
    assert.match(path, /deploy\/browser-gate\/chromium-gated$/);
    assert.ok(existsSync(path));
  });
});

// ── VERIFY GATE ──
// 가짜 ssh: 부를 때마다 한 줄을 남기고 실패한다(닿지 않는 데스크톱). 불리지 않았다면 데스크톱에 가려던 시도가 없었다는 뜻이다
function fakeSsh(): { bin: string; calls: () => number } {
  const bin = fresh();
  const log = join(bin, "ssh-calls");
  const file = join(bin, "ssh");
  writeFileSync(file, `#!/bin/sh\necho call >> ${JSON.stringify(log)}\nexit 255\n`);
  chmodSync(file, 0o755);
  return { bin, calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").length : 0) };
}
const verify = (gate: string, cwd: string, args: string[], extra: Record<string, string> = {}) => spawnSync(process.execPath, [VERIFY, "--", ...args], { cwd, env: baseEnv(gate, extra), encoding: "utf8" });
const verifyRuns = (gate: string) => {
  try {
    return parseRuns(readFileSync(join(gate, "runs.jsonl"), "utf8"));
  } catch {
    return [];
  }
};
const REMOTE = { host: "desktop.invalid", user: "nobody", port: 22 };

describe("VERIFY GATE: 다른 저장소", { concurrency: 4 }, () => {
  test("항목이 없는 저장소는 로컬 줄에서 돈다: 데스크톱을 시도하지 않고 npm test 낱말이어도 마찬가지", () => {
    const gate = fresh();
    writeFileSync(join(gate, "remote.json"), JSON.stringify(REMOTE));
    const ssh = fakeSsh();
    const repo = madeUpRepo();
    const r = verify(gate, repo, ["node", "-e", "console.log('ran')"], { PATH: `${ssh.bin}:${process.env.PATH}` });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "ran\n");
    assert.equal(ssh.calls(), 0);
    const runs = verifyRuns(gate);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].where, "local");
    assert.equal(runs[0].repo, "made-up-web");
    assert.equal(runs[0].localReason, "not-listed");
    assert.ok(!existsSync(join(gate, "repos.json")));
  });

  test("허용 목록에 적은 명령만 데스크톱을 시도한다(닿지 않으면 로컬로 돈다)", () => {
    const gate = fresh();
    writeFileSync(join(gate, "remote.json"), JSON.stringify(REMOTE));
    const ssh = fakeSsh();
    const repo = madeUpRepo();
    writeFileSync(join(gate, "repos.json"), JSON.stringify({ "made-up-web": { remoteCommands: [["node", "-e", "console.log('listed')"]] } }));
    const env = { PATH: `${ssh.bin}:${process.env.PATH}` };
    const listed = verify(gate, repo, ["node", "-e", "console.log('listed')"], env);
    assert.equal(listed.status, 0);
    assert.equal(listed.stdout, "listed\n"); // 데스크톱이 안 닿아 로컬에서 돌았다
    assert.ok(ssh.calls() >= 1);
    const before = ssh.calls();
    const notListed = verify(gate, repo, ["node", "-e", "console.log('other')"], env);
    assert.equal(notListed.stdout, "other\n");
    assert.equal(ssh.calls(), before); // 목록에 없는 명령은 ssh를 부르지도 않는다
    const runs = verifyRuns(gate);
    assert.deepEqual(runs.map((r) => r.localReason), ["desktop-absent", "not-listed"]);
    assert.ok(runs.every((r) => r.repo === "made-up-web"));
  });

  test("다른 저장소의 목록은 이 저장소에 적용되지 않는다", () => {
    const gate = fresh();
    writeFileSync(join(gate, "remote.json"), JSON.stringify(REMOTE));
    const ssh = fakeSsh();
    const repo = madeUpRepo("made-up-two");
    writeFileSync(join(gate, "repos.json"), JSON.stringify({ "made-up-web": { remoteCommands: [["node", "-e", "0"]] } }));
    const r = verify(gate, repo, ["node", "-e", "0"], { PATH: `${ssh.bin}:${process.env.PATH}` });
    assert.equal(r.status, 0);
    assert.equal(ssh.calls(), 0);
    assert.equal(verifyRuns(gate)[0].repo, "made-up-two");
  });

  test("스위치가 꺼져 있으면 목록에 있어도 로컬(switch-off)", () => {
    const gate = fresh();
    writeFileSync(join(gate, "remote.json"), JSON.stringify(REMOTE));
    writeFileSync(join(gate, "config.json"), JSON.stringify({ remote: "off" }));
    writeFileSync(join(gate, "repos.json"), JSON.stringify({ "made-up-web": { remoteCommands: [["node", "-e", "0"]] } }));
    const ssh = fakeSsh();
    const r = verify(gate, madeUpRepo(), ["node", "-e", "0"], { PATH: `${ssh.bin}:${process.env.PATH}` });
    assert.equal(r.status, 0);
    assert.equal(ssh.calls(), 0);
    assert.equal(verifyRuns(gate)[0].localReason, "switch-off");
  });

  test("atc가 아닌 저장소도 같은 슬롯 줄을 쓴다(한 칸이면 둘째는 기다린다)", async () => {
    const gate = fresh();
    const repoA = madeUpRepo("made-up-a");
    const repoB = madeUpRepo("made-up-b");
    const started = join(gate, "started");
    const release = join(gate, "release");
    const hold = ["node", "-e", `const fs=require("fs");fs.writeFileSync(${JSON.stringify(started)},"x");setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))process.exit(0)},20)`];
    const env = { ATC_GATE_SLOTS: "1" };
    const first = spawn(process.execPath, [VERIFY, "--", ...hold], { cwd: repoA, env: baseEnv(gate, env), stdio: "ignore" });
    const firstDone = new Promise((r) => first.on("close", r));
    await waitFor(() => existsSync(started));
    const second = spawn(process.execPath, [VERIFY, "--", "node", "-e", "console.log('second')"], { cwd: repoB, env: baseEnv(gate, env), stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    second.stderr?.on("data", (b) => (err += b));
    await waitFor(() => /waiting for a slot/.test(err));
    writeFileSync(release, "x");
    await firstDone;
    await new Promise((r) => second.on("close", r));
    const runs = verifyRuns(gate);
    assert.deepEqual(runs.map((r) => r.repo).sort(), ["made-up-a", "made-up-b"]);
    assert.equal(runs.filter((r) => r.waited).length, 1);
  });
});

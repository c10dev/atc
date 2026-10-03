import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseBrowserRuns } from "./browser-gate.ts";

// 브라우저 문 실행기를 임시 폴더와 가짜 Chrome(node 스크립트)으로 시험한다. 진짜 Chrome은 띄우지 않는다
const CLI = fileURLToPath(new URL("./browser-gate-cli.ts", import.meta.url));
const roots: string[] = [];
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), "atc-bgate-test-"));
  roots.push(d);
  return d;
};
after(() => {
  for (const d of roots) rmSync(d, { recursive: true, force: true });
});

// 가짜 Chrome: 인자를 한 줄로 찍고, pid를 파일에 적고, ms만큼 산 뒤 exit 코드로 끝난다
function fakeChrome(dir: string, ms: number, exit = 0, release?: string): string {
  const file = join(dir, `chrome-${ms}-${exit}${release ? "-r" : ""}`);
  writeFileSync(file, `#!${process.execPath}\nconst fs=require("fs");console.log("ARGS "+process.argv.slice(2).join(" "));fs.appendFileSync(${JSON.stringify(join(dir, "pids"))},process.pid+"\\n");setTimeout(()=>process.exit(${exit}),${ms});${release ? `setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))process.exit(${exit})},20);` : ""}\n`);
  chmodSync(file, 0o755);
  return file;
}
const envOf = (dir: string, real: string, extra: Record<string, string> = {}) => {
  const env: NodeJS.ProcessEnv = { ...process.env, ATC_GATE_DIR: dir, ATC_BROWSER_REAL: real, ATC_GATE_POLL_MS: "50", ...extra }; // 줄 서기 점검을 50ms로(운영 기본은 1000ms, ATC-523)
  delete env.NODE_TEST_CONTEXT;
  return env;
};
const gateSync = (dir: string, real: string, args: string[], extra: Record<string, string> = {}) => spawnSync(process.execPath, [CLI, ...args], { env: envOf(dir, real, extra), encoding: "utf8" });
const gateAsync = (dir: string, real: string, args: string[], extra: Record<string, string> = {}) => {
  const c = spawn(process.execPath, [CLI, ...args], { env: envOf(dir, real, extra), stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  c.stdout?.on("data", (b) => (out += b));
  c.stderr?.on("data", (b) => (err += b));
  const done = new Promise<{ code: number | null; out: string; err: string }>((r) => c.on("close", (code) => r({ code, out, err })));
  return { c, done, err: () => err };
};
const runsOf = (dir: string) => {
  try {
    return parseBrowserRuns(readFileSync(join(dir, "browser", "runs.jsonl"), "utf8"));
  } catch {
    return [];
  }
};
const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));
// 가짜 Chrome은 시작하면 pids 파일에 한 줄을 쓴다. 병렬로 돌 때 고정 sleep으로는 두 번째가 먼저 슬롯을 잡을 수 있어 그것을 기다린다(ATC-523)
const waitFor = async (cond: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    assert.ok(Date.now() < end, "기다리던 일이 일어나지 않았다");
    await sleepMs(20);
  }
};
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// 파일 안의 시험은 서로 임시 폴더·포트가 달라 겹치지 않는다: 병렬로 돌려 가장 긴 시험 하나가 파일 시간이 되게 한다(ATC-523)
describe("browser-gate-cli", { concurrency: 4 }, () => {
  test("Chrome 인자와 종료 코드를 그대로 잇고 기록 한 줄을 남긴다", () => {
    const dir = fresh();
    const r = gateSync(dir, fakeChrome(dir, 50, 3), ["--headless", "--remote-debugging-pipe"]);
    assert.equal(r.status, 3);
    assert.equal(r.stdout, "ARGS --headless --remote-debugging-pipe\n");
    const runs = runsOf(dir);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].exit, 3);
    assert.equal(runs[0].waited, false);
    assert.equal(runs[0].where, "local");
  });

  test("Chrome이 없으면 127과 안내", () => {
    const dir = fresh();
    const env = { ...process.env, ATC_GATE_DIR: dir, HOME: dir, PLAYWRIGHT_BROWSERS_PATH: join(dir, "none") } as NodeJS.ProcessEnv;
    delete env.ATC_BROWSER_REAL;
    const r = spawnSync(process.execPath, [CLI], { env, encoding: "utf8" });
    assert.equal(r.status, 127);
    assert.match(r.stderr, /no Chrome found/);
  });

  test("동시에 N개까지만 돈다: 두 번째는 줄을 서고 알린 뒤 차례가 오면 뜬다", async () => {
    const dir = fresh();
    const release = join(dir, "release");
    const slow = fakeChrome(dir, 30_000, 0, release);
    const quick = fakeChrome(dir, 10);
    const env = { ATC_BROWSER_SLOTS: "1" };
    const first = gateAsync(dir, slow, ["a"], env);
    await waitFor(() => existsSync(join(dir, "pids")));
    const second = gateAsync(dir, quick, ["b"], env);
    await waitFor(() => /waiting for a browser slot/.test(second.err())); // 줄에 서서 알렸다
    await sleepMs(300); // 한동안 기다린 뒤에 놓는다(waitedMs 단언)
    writeFileSync(release, "x");
    const [a, b] = await Promise.all([first.done, second.done]);
    assert.equal(a.code, 0);
    assert.equal(b.code, 0);
    assert.equal(b.out, "ARGS b\n");
    assert.match(b.err, /waiting for a browser slot: position 1/);
    const runs = runsOf(dir);
    assert.equal(runs.length, 2);
    const waiter = runs.find((r) => r.waited);
    assert.ok(waiter && waiter.waitedMs > 250);
  });

  test("한도를 넘기면 Chrome 없이 BUSY와 75, 기록에 busy", async () => {
    const dir = fresh();
    const release = join(dir, "release");
    const holder = fakeChrome(dir, 30_000, 0, release);
    const never = fakeChrome(dir, 10);
    const env = { ATC_BROWSER_SLOTS: "1", ATC_BROWSER_WAIT_LIMIT_MS: "400" };
    const first = gateAsync(dir, holder, [], env);
    await waitFor(() => existsSync(join(dir, "pids")));
    const second = gateAsync(dir, never, ["should-not-start"], env);
    const b = await second.done;
    assert.equal(b.code, 75);
    assert.match(b.err, /BUSY: all 1 shared browser slot is in use/);
    assert.ok(!b.out.includes("should-not-start"));
    writeFileSync(release, "x"); // 쥐고 있던 Chrome을 놓는다
    await first.done;
    const busy = runsOf(dir).filter((r) => r.busy);
    assert.equal(busy.length, 1);
    assert.equal(busy[0].exit, 75);
    assert.equal(busy[0].ranMs, 0);
  });

  test("Chrome이 죽으면 슬롯이 놓인다: 다음 요청이 기다리지 않는다", async () => {
    const dir = fresh();
    const env = { ATC_BROWSER_SLOTS: "1" };
    const crash = fakeChrome(dir, 10, 9);
    const a = gateSync(dir, crash, [], env);
    assert.equal(a.status, 9);
    const b = gateSync(dir, fakeChrome(dir, 10), ["next"], env);
    assert.equal(b.status, 0);
    assert.equal(runsOf(dir).filter((r) => r.waited).length, 0);
  });

  test("신호로 죽은 Chrome의 슬롯은 커널이 놓는다(껍데기를 죽여도 다음 요청이 뜬다)", async () => {
    const dir = fresh();
    const env = { ATC_BROWSER_SLOTS: "1" };
    const first = gateAsync(dir, fakeChrome(dir, 20_000), [], env);
    await waitFor(() => existsSync(join(dir, "pids")));
    first.c.kill("SIGTERM");
    const a = await first.done;
    assert.equal(a.code, 143);
    const b = gateSync(dir, fakeChrome(dir, 10), ["after"], env);
    assert.equal(b.status, 0);
    assert.ok(runsOf(dir).some((r) => r.killed));
  });

  test("세션이 끝났는데 Chrome이 남아 있으면 문이 내리고 슬롯을 놓고 기록한다", async () => {
    const dir = fresh();
    const env = envOf(dir, fakeChrome(dir, 60_000), { ATC_BROWSER_SLOTS: "1", ATC_BROWSER_WATCH_MS: "200" });
    // 부모(MCP 서버 구실)가 껍데기를 띄우고, Chrome이 뜬 것(pids 파일)을 본 뒤에 죽는다. 부모가 먼저 죽으면 껍데기가 처음부터 고아라 세션이 끝난 것을 알아볼 기준이 없다(고정 시간이면 부하가 높을 때 그렇게 된다, ATC-523)
    const parent = spawnSync(process.execPath, ["-e", `require("child_process").spawn(process.execPath,[${JSON.stringify(CLI)}],{stdio:"ignore",detached:true}).unref();const i=setInterval(()=>{if(require("fs").existsSync(${JSON.stringify(join(dir, "pids"))})){clearInterval(i);setTimeout(()=>process.exit(0),100)}},20);setTimeout(()=>process.exit(1),30000)`], { env, encoding: "utf8" });
    assert.equal(parent.status, 0);
    let ended = false;
    for (let i = 0; i < 100 && !ended; i++) {
      await sleepMs(100);
      ended = runsOf(dir).some((r) => r.endedWithSession);
    }
    assert.ok(ended, "세션 종료 기록이 있어야 한다");
    const pids = readFileSync(join(dir, "pids"), "utf8").trim().split("\n").map(Number);
    await sleepMs(150);
    for (const pid of pids) assert.equal(alive(pid), false, `Chrome ${pid}이 남아 있다`);
    // 슬롯이 놓였다: 다음 요청이 기다리지 않는다
    const next = gateSync(dir, fakeChrome(dir, 10), ["after-end"], { ATC_BROWSER_SLOTS: "1" });
    assert.equal(next.status, 0);
    assert.equal(runsOf(dir).filter((r) => r.waited).length, 0);
  });

  test("SUPERVISOR가 끄면(off) 줄도 기록도 없이 바로 뜬다", async () => {
    const dir = fresh();
    mkdirSync(join(dir, "browser"), { recursive: true });
    writeFileSync(join(dir, "browser", "config.json"), JSON.stringify({ mode: "off", slots: 1 }));
    const slow = fakeChrome(dir, 400);
    const a = gateAsync(dir, slow, ["one"]);
    const b = gateAsync(dir, fakeChrome(dir, 10), ["two"]);
    const [x, y] = await Promise.all([a.done, b.done]);
    assert.equal(x.code, 0);
    assert.equal(y.code, 0);
    assert.equal(y.out, "ARGS two\n");
    assert.equal(runsOf(dir).length, 0);
  });

  test("문 폴더를 못 쓰면 그냥 띄우고 안내한다(문 때문에 브라우저가 못 뜨는 일은 없다)", () => {
    const dir = fresh();
    writeFileSync(join(dir, "browser"), "a file, not a folder"); // browser/ 를 만들 수 없다
    const r = gateSync(dir, fakeChrome(dir, 10), ["direct"]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "ARGS direct\n");
    assert.match(r.stderr, /gate unavailable/);
  });

  test("--print-config: 기존 설정을 읽어 실행 파일만 바꾼 설정을 stdout으로 내고 파일은 고치지 않는다", () => {
    const dir = fresh();
    const base = join(dir, "base.json");
    const body = JSON.stringify({ browser: { launchOptions: { headless: true } }, outputDir: "/tmp/playwright-mcp" });
    writeFileSync(base, body);
    const r = spawnSync(process.execPath, [CLI, "--print-config", base], { encoding: "utf8" });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.match(out.browser.launchOptions.executablePath, /deploy\/browser-gate\/chromium-gated$/);
    assert.equal(out.browser.launchOptions.headless, true);
    assert.equal(out.outputDir, "/tmp/playwright-mcp");
    assert.equal(readFileSync(base, "utf8"), body);
    assert.ok(existsSync(out.browser.launchOptions.executablePath));
  });
});

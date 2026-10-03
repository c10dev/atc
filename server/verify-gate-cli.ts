// VERIFY GATE 실행기(ATC-517): `node server/verify-gate-cli.ts [--] <명령> [인자…]`
// 무거운 검증 명령(npm test, npx tsc --noEmit -p ., npx vite build)을 문 뒤에 세운다. 호스트 전체에서 동시에 N건만 돈다.
// - 명령은 부른 쪽의 작업 폴더에서 stdin·stdout·stderr를 그대로 잇고 돌며, 종료 코드도 그대로다(신호로 끝나면 128+번호).
// - 자리가 없으면 줄을 서서 stderr에 순번과 기다린 시간을 알린다. 한도를 넘기면 종료 코드 75와 메시지.
// - 문이 못 돌면(락 폴더를 못 읽음, flock 없음, 내부 오류) 그냥 실행하고 기록에 fallback을 남긴다. 문 때문에 검증이 못 도는 일은 없다.
// - 슬롯은 flock이다: 명령이 어떻게 죽든 커널이 놓는다. 비밀·.env·운영 상태 폴더는 읽지 않는다.

import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, chmodSync, closeSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { constants as osConstants } from "node:os";
import { join } from "node:path";
import {
  cmdLabel,
  exitCodeOf,
  GATE_WHERE,
  type GateConfig,
  type GateRun,
  gateDirOf,
  mayTry,
  NODE_SHIM,
  parseGateConfig,
  pollMsOf,
  queuePosition,
  shouldAnnounce,
  type Ticket,
  timeoutMessage,
  USAGE_EXIT,
  WAIT_LIMIT_EXIT,
  waitDecision,
  waitMessage,
} from "./verify-gate.ts";
import { atRepoRoot, readRemoteTarget, sshTransport } from "./verify-remote-run.ts";
import { type LocalReason, lockHash, lostMessage, newRunId, routeOf, runOnDesktop } from "./verify-remote.ts";

const POLL_MS = pollMsOf(process.env.ATC_GATE_POLL_MS);
const BUSY = 200; // 락 시도 껍데기가 "자리 없음"을 알리는 코드(알림 바이트가 오지 않았을 때만 뜻이 있다)

const argv = process.argv.slice(2);
if (argv[0] === "--") argv.shift();
if (argv.length === 0) {
  process.stderr.write("usage: node server/verify-gate-cli.ts [--] <command> [args…]\n");
  process.exit(USAGE_EXIT);
}

const startedAt = Date.now();
const dir = gateDirOf();
let child: ChildProcess | null = null;
let signalled: NodeJS.Signals | null = null;
let ticketPath: string | null = null;
let remoteChild: ChildProcess | null = null; // 데스크톱에서 도는 ssh(ATC-518). 신호는 이것에도 간다
let syncMsLocal = 0; // 데스크톱을 시도했다가 로컬로 돌아선 실행의 보내기 시간(기록에 남는다)
let localReason: LocalReason | undefined; // 이 실행이 로컬에서 돈 사유(데스크톱을 쓰지 않았거나 못 썼다)

// 신호는 자식에게 넘기고 자식이 끝나면 따라 끝난다. 줄 서는 중이면 표를 지우고 바로 끝난다
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => {
    signalled = sig;
    if (remoteChild) remoteChild.kill(sig);
    else if (child) child.kill(sig);
    else {
      dropTicket();
      writeRun({ waited: true, waitedMs: Date.now() - startedAt, ranMs: 0, exit: exitCodeOf(null, osConstants.signals[sig]), killed: true });
      process.exit(exitCodeOf(null, osConstants.signals[sig]));
    }
  });
}

function writeRun(p: Pick<GateRun, "waited" | "waitedMs" | "ranMs" | "exit"> & Partial<GateRun>) {
  const run: GateRun = { t: new Date(startedAt).toISOString(), where: GATE_WHERE, cmd: cmdLabel(argv), cwd: process.cwd(), ...(localReason ? { localReason } : {}), ...(syncMsLocal ? { syncMs: syncMsLocal } : {}), ...p };
  try {
    appendFileSync(join(dir, "runs.jsonl"), JSON.stringify(run) + "\n"); // 한 줄은 PIPE_BUF 안이라 겹쳐 써도 안 섞인다
  } catch {
    // 기록이 안 되어도 검증은 돈다
  }
}

function dropTicket() {
  if (!ticketPath) return;
  try {
    unlinkSync(ticketPath);
  } catch {
    // 이미 없다
  }
  ticketPath = null;
}

const startTimeOf = (pid: number): string | null => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null; // 22번째 칸(starttime): pid 재사용을 가려낸다
  } catch {
    return null;
  }
};
const aliveTicket = (body: string): boolean => {
  try {
    const t = JSON.parse(body) as { pid: number; st: string | null };
    const now = startTimeOf(t.pid);
    return now !== null && (t.st === null || now === t.st);
  } catch {
    return false;
  }
};

function runDirect(reason: string | null): Promise<number> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let c: ChildProcess;
    try {
      c = spawn(argv[0], argv.slice(1), { stdio: "inherit" });
    } catch (e) {
      process.stderr.write(`${argv[0]}: ${(e as Error).message}\n`);
      resolve(127);
      return;
    }
    child = c;
    c.on("error", (e) => {
      process.stderr.write(`${argv[0]}: ${e.message}\n`);
      resolve(127);
    });
    c.on("exit", (code, sig) => {
      const exit = exitCodeOf(code, sig ? (osConstants.signals[sig] ?? 0) : null);
      if (reason) writeRun({ waited: false, waitedMs: 0, ranMs: Date.now() - t0, exit, fallback: reason, ...(sig ? { killed: true } : {}) });
      resolve(exit);
    });
  });
}

// node 껍데기 폴더를 PATH 맨 앞에 둔다(없으면 만든다). 못 만들면 test 동시성만 못 건다
function shimEnv(cfg: GateConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ATC_GATE_TEST_CONCURRENCY: String(cfg.testConcurrency), ATC_GATE_REAL_NODE: process.execPath };
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin, { recursive: true });
    const file = join(bin, "node");
    let current = "";
    try {
      current = readFileSync(file, "utf8");
    } catch {
      // 처음이다
    }
    if (current !== NODE_SHIM) {
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, NODE_SHIM);
      chmodSync(tmp, 0o755);
      renameSync(tmp, file);
    }
    env.PATH = `${bin}:${process.env.PATH ?? ""}`;
  } catch {
    // 껍데기 없이 간다
  }
  return env;
}

interface Attempt {
  state: "busy" | "ran" | "broken";
  exit?: number;
  waitedMs?: number;
  ranMs?: number;
  killed?: boolean;
}

// 슬롯 하나를 시도한다. sh가 flock -n으로 락을 잡고 3번 fd에 K를 쓴 뒤 명령으로 exec한다(락 fd 9는 명령이 쥔다)
function tryOnce(slotFile: string, env: NodeJS.ProcessEnv): Promise<Attempt> {
  return new Promise((resolve) => {
    let got = false;
    let ranFrom = 0;
    let c: ChildProcess;
    try {
      c = spawn("sh", ["-c", 'exec 9>>"$1" || exit 201; flock -n 9 || exit 200; printf K >&3; exec 3>&-; shift; exec "$@"', "sh", slotFile, ...argv], {
        stdio: ["inherit", "inherit", "inherit", "pipe"],
        env,
      });
    } catch {
      resolve({ state: "broken" });
      return;
    }
    c.stdio[3]?.on("data", () => {
      got = true;
      ranFrom = Date.now();
      child = c;
      dropTicket();
    });
    c.on("error", () => resolve({ state: "broken" }));
    c.on("close", (code, sig) => {
      // exit가 아니라 close: 3번 fd의 K를 다 읽은 뒤에 판단한다(빨리 끝나는 명령을 "락 못 잡음"으로 오해해 두 번 돌리지 않게)
      child = null;
      if (got) resolve({ state: "ran", exit: exitCodeOf(code, sig ? (osConstants.signals[sig] ?? 0) : null), waitedMs: ranFrom - startedAt, ranMs: Date.now() - ranFrom, killed: Boolean(sig) || signalled !== null });
      else if (code === BUSY) resolve({ state: "busy" });
      else resolve({ state: "broken" }); // flock이 없거나 슬롯 파일을 못 열었다
    });
  });
}

// 데스크톱에서 돌려 본다(ATC-518). 돌았으면 명령의 종료 코드를, 로컬로 돌아서야 하면 null(사유는 localReason에)
async function tryDesktop(cfg: GateConfig, target: NonNullable<ReturnType<typeof readRemoteTarget>>): Promise<number | null> {
  let hash: string;
  try {
    hash = lockHash(readFileSync(join(process.cwd(), "package-lock.json"), "utf8"));
  } catch {
    localReason = "transport-error"; // lock이 없으면 데스크톱이 의존을 준비할 수 없다
    return null;
  }
  const id = newRunId(startedAt, process.pid, randomBytes(2).toString("hex"));
  const transport = sshTransport({ target, cwd: process.cwd(), connectTimeoutSec: Math.ceil(cfg.probeMs / 1000), onChild: (c) => (remoteChild = c) });
  const r = await runOnDesktop({ argv, id, hash, transport, probeMs: cfg.probeMs });
  if (r.where === "local") {
    localReason = r.reason;
    if (r.reason === "transport-error") process.stderr.write(`[atc verify-gate] the desktop run could not start${r.error ? ` (${r.error.replace(/\s+/g, " ").slice(0, 200)})` : ""}; running locally\n`);
    if (r.syncMs > 0) syncMsLocal = r.syncMs;
    return null;
  }
  const exit = signalled ? exitCodeOf(null, osConstants.signals[signalled]) : r.exit;
  if ("lost" in r && !signalled) process.stderr.write(lostMessage() + "\n");
  writeRun({ where: "desktop", waited: false, waitedMs: 0, ranMs: r.ranMs, syncMs: r.syncMs, exit, ...("lost" in r ? { lost: true } : {}), ...(signalled ? { killed: true } : {}) });
  return exit;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gated(cfg: GateConfig): Promise<number> {
  mkdirSync(join(dir, "slots"), { recursive: true });
  mkdirSync(join(dir, "queue"), { recursive: true });
  const env = shimEnv(cfg);
  const name = `${String(startedAt).padStart(15, "0")}-${process.pid}-${Math.random().toString(36).slice(2, 6)}`;
  ticketPath = join(dir, "queue", name);
  writeFileSync(ticketPath, JSON.stringify({ pid: process.pid, st: startTimeOf(process.pid) }));
  let announcedAt: number | null = null;
  let waited = false;
  for (;;) {
    const tickets: Ticket[] = [];
    for (const n of readdirSync(join(dir, "queue"))) {
      let alive = false;
      try {
        alive = aliveTicket(readFileSync(join(dir, "queue", n), "utf8"));
      } catch {
        // 지워졌다
      }
      if (!alive && n !== name) {
        try {
          unlinkSync(join(dir, "queue", n)); // 죽은 표
        } catch {
          // 다른 대기자가 이미 지웠다
        }
        continue;
      }
      tickets.push({ name: n, alive });
    }
    const position = queuePosition(tickets, name);
    if (mayTry(position, cfg.slots)) {
      for (let i = 0; i < cfg.slots; i++) {
        const r = await tryOnce(join(dir, "slots", `slot-${i}.lock`), env);
        if (r.state === "ran") {
          writeRun({ waited, waitedMs: r.waitedMs ?? 0, ranMs: r.ranMs ?? 0, exit: r.exit ?? 1, ...(r.killed ? { killed: true } : {}) });
          return r.exit ?? 1;
        }
        if (r.state === "broken") throw new Error("slot lock could not be taken (flock missing or slot file unreadable)");
      }
    }
    const waitedMs = Date.now() - startedAt;
    waited = true;
    if (waitDecision(waitedMs, cfg.waitLimitMs) === "timeout") {
      dropTicket();
      process.stderr.write(timeoutMessage(waitedMs) + "\n");
      writeRun({ waited: true, waitedMs, ranMs: 0, exit: WAIT_LIMIT_EXIT, timedOut: true });
      return WAIT_LIMIT_EXIT;
    }
    if (shouldAnnounce(announcedAt, waitedMs)) {
      announcedAt = waitedMs;
      process.stderr.write(waitMessage({ position, slots: cfg.slots, waitedMs, limitMs: cfg.waitLimitMs }) + "\n");
    }
    await sleep(POLL_MS);
  }
}

async function main(): Promise<number> {
  let rawCfg: unknown = {};
  try {
    rawCfg = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
  } catch {
    // 설정 파일이 없으면 기본값(켜짐). 읽다 틀려도 기본값
  }
  const cfg = parseGateConfig(rawCfg, process.env);
  if (cfg.mode === "off") return runDirect(null); // SUPERVISOR가 껐다: 줄도 기록도 없다
  try {
    mkdirSync(dir, { recursive: true });
    const probe = openSync(join(dir, "runs.jsonl"), "a"); // 문 폴더를 쓸 수 있는지
    closeSync(probe);
    // 데스크톱(ATC-518): 고정된 검증 명령이고 스위치가 켜져 있고 닿을 때만. 아니면 사유를 달고 로컬 문으로 간다
    const target = readRemoteTarget(dir);
    const route = routeOf({ remote: cfg.remote, argv, atRepoRoot: cfg.remote === "on" ? atRepoRoot(process.cwd()) : false, target });
    if (route.where === "desktop" && target) {
      const exit = await tryDesktop(cfg, target);
      if (exit !== null) return exit;
    } else if (route.where === "local") localReason = route.reason;
    return await gated(cfg);
  } catch (e) {
    dropTicket();
    const why = (e as Error).message;
    process.stderr.write(`[atc verify-gate] gate unavailable (${why}); running the command directly\n`);
    return runDirect(why.slice(0, 120));
  }
}

process.exit(await main());

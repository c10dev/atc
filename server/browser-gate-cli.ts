// BROWSER GATE 실행기(ATC-520). Playwright MCP의 browser.launchOptions.executablePath로 쓰는 Chrome 껍데기:
//   node server/browser-gate-cli.ts <Chrome 인자…>        진짜 Chrome을 호스트 전체에서 동시에 N개까지만 띄운다(세션이 여럿이어도)
//   node server/browser-gate-cli.ts --print-config [기존 설정.json]   문을 끼운 Playwright MCP 설정을 stdout으로 낸다(파일은 고치지 않는다)
// - 슬롯은 flock이다: 껍데기가 Chrome을 exec하기 전에 잡고 Chrome이 쥔다. Chrome이 어떻게 죽든 커널이 놓는다.
// - 자리가 없으면 줄을 서서 stderr에 알린다. 한도를 넘기면 Chrome 없이 종료 코드 75와 "BUSY" 메시지(Playwright가 시작 오류 글에 실어 준다).
// - Playwright가 주는 3·4번 fd(--remote-debugging-pipe)와 stdio는 Chrome까지 그대로 간다.
// - 부모(Playwright를 돌리는 MCP 서버)가 사라졌는데 Chrome이 남아 있으면 껍데기가 내리고 슬롯을 놓는다.
// - 문이 못 돌면 그냥 실행하고 기록에 fallback을 남긴다. 스크린샷은 쓰지 않는다(outputDir는 MCP 설정 그대로).

import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, closeSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { constants as osConstants, homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BROWSER_WHERE,
  type BrowserGateConfig,
  type BrowserRun,
  browserDirOf,
  busyMessage,
  exitCodeOf,
  mayTry,
  mergeMcpConfig,
  newestChromiumDir,
  parentGone,
  parseBrowserGateConfig,
  queuePosition,
  pollMsOf,
  shouldAnnounce,
  WAIT_LIMIT_EXIT,
  WATCH_MS,
  waitDecision,
  waitMessage,
} from "./browser-gate.ts";
import { repoEntryOf, UNKNOWN_REPO } from "./gate-repo.ts";
import { gateDirOf, type Ticket } from "./verify-gate.ts";
import { readRepos, repoContext } from "./verify-remote-run.ts";

const POLL_MS = pollMsOf(process.env.ATC_GATE_POLL_MS);
const BUSY = 200; // 락 시도 껍데기가 "자리 없음"을 알리는 코드(알림 바이트가 오지 않았을 때만 뜻이 있다)
const NOTICE_FD = 5; // 3·4번은 Playwright의 디버깅 파이프라 Chrome까지 넘긴다

const argv = process.argv.slice(2);
const LAUNCHER = fileURLToPath(new URL("../deploy/browser-gate/chromium-gated", import.meta.url));

// 다른 저장소의 스크립트가 launchOptions.executablePath에 넣을 껍데기 경로(ATC-526)
if (argv[0] === "--print-launcher") {
  process.stdout.write(LAUNCHER + "\n");
  process.exit(0);
}

if (argv[0] === "--print-config") {
  let base: unknown = {};
  if (argv[1]) {
    try {
      base = JSON.parse(readFileSync(argv[1], "utf8"));
    } catch (e) {
      process.stderr.write(`cannot read ${argv[1]}: ${(e as Error).message}\n`);
      process.exit(1);
    }
  }
  process.stdout.write(JSON.stringify(mergeMcpConfig(base, LAUNCHER), null, 2) + "\n");
  process.exit(0);
}

const startedAt = Date.now();
const startPpid = process.ppid;
const dir = browserDirOf();
// 어느 저장소의 Playwright가 불렀나(ATC-526): 기록에는 맨 위 폴더 이름만 남긴다. 못 알면 unknown
let ctx = { key: UNKNOWN_REPO, isOwn: false };
try {
  ctx = repoContext(process.cwd());
} catch {
  // 저장소를 못 알아도 문은 돈다
}
const watchMs =Number(process.env.ATC_BROWSER_WATCH_MS) > 0 ? Number(process.env.ATC_BROWSER_WATCH_MS) : WATCH_MS;
let child: ChildProcess | null = null;
let ticketPath: string | null = null;
let endedWithSession = false;
let signalled = false;

// 진짜 Chrome: 설정·환경이 정한 것, 없으면 Playwright 캐시에서 revision이 가장 큰 chromium
function realExecutable(cfg: BrowserGateConfig): string | null {
  if (process.env.ATC_BROWSER_REAL) return cfg.realExecutable; // 환경이 가장 먼저
  const own = repoEntryOf(readRepos(gateDirOf()), ctx.key).browserExecutable; // 저장소별 설정(ATC-526)
  if (own) return own;
  if (cfg.realExecutable) return cfg.realExecutable;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== "0" ? process.env.PLAYWRIGHT_BROWSERS_PATH : join(process.env.HOME || homedir(), ".cache", "ms-playwright");
  try {
    const name = newestChromiumDir(readdirSync(root));
    if (!name) return null;
    const sub = readdirSync(join(root, name)).find((n) => /^chrome-linux/.test(n));
    return sub ? join(root, name, sub, "chrome") : null;
  } catch {
    return null;
  }
}

// 3·4번 fd가 열려 있으면 자식에게 그대로 넘긴다(Playwright의 --remote-debugging-pipe)
const passFds = (): ("inherit" | "ignore")[] =>
  [3, 4].map((fd) => {
    try {
      fstatSync(fd);
      return "inherit" as const;
    } catch {
      return "ignore" as const;
    }
  });

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => {
    signalled = true;
    if (child) child.kill(sig);
    else {
      dropTicket();
      process.exit(exitCodeOf(null, osConstants.signals[sig]));
    }
  });
}

function writeRun(p: Pick<BrowserRun, "waited" | "waitedMs" | "ranMs" | "exit"> & Partial<BrowserRun>) {
  const run: BrowserRun = { t: new Date(startedAt).toISOString(), where: BROWSER_WHERE, cwd: process.cwd(), repo: ctx.key, ...p };
  try {
    appendFileSync(join(dir, "runs.jsonl"), JSON.stringify(run) + "\n"); // 한 줄은 PIPE_BUF 안이라 겹쳐 써도 안 섞인다
  } catch {
    // 기록이 안 되어도 브라우저는 뜬다
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

// 세션이 끝났는지 지켜보다가 Chrome이 남아 있으면 내린다
function watchParent(c: ChildProcess): () => void {
  const timer = setInterval(() => {
    if (!parentGone(startPpid, process.ppid)) return;
    endedWithSession = true;
    c.kill("SIGTERM");
    setTimeout(() => c.kill("SIGKILL"), 3000).unref();
  }, watchMs);
  timer.unref();
  return () => clearInterval(timer);
}

function runDirect(real: string, reason: string | null): Promise<number> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let c: ChildProcess;
    try {
      c = spawn(real, argv, { stdio: [0, 1, 2, ...passFds()] });
    } catch (e) {
      process.stderr.write(`${real}: ${(e as Error).message}\n`);
      resolve(127);
      return;
    }
    child = c;
    const stop = watchParent(c);
    c.on("error", (e) => {
      stop();
      process.stderr.write(`${real}: ${e.message}\n`);
      resolve(127);
    });
    c.on("exit", (code, sig) => {
      stop();
      const exit = exitCodeOf(code, sig ? (osConstants.signals[sig] ?? 0) : null);
      if (reason) writeRun({ waited: false, waitedMs: 0, ranMs: Date.now() - t0, exit, fallback: reason, ...(endedWithSession ? { endedWithSession: true } : {}), ...(sig ? { killed: true } : {}) });
      resolve(exit);
    });
  });
}

interface Attempt {
  state: "busy" | "ran" | "broken";
  exit?: number;
  waitedMs?: number;
  ranMs?: number;
  killed?: boolean;
}

// 슬롯 하나를 시도한다. sh가 flock -n으로 락을 잡고 5번 fd에 K를 쓴 뒤 Chrome으로 exec한다(락 fd 9는 Chrome이 쥔다)
function tryOnce(real: string, slotFile: string): Promise<Attempt> {
  return new Promise((resolve) => {
    let got = false;
    let ranFrom = 0;
    let stop: () => void = () => {};
    let c: ChildProcess;
    try {
      c = spawn("sh", ["-c", `exec 9>>"$1" || exit 201; flock -n 9 || exit 200; printf K >&${NOTICE_FD}; exec ${NOTICE_FD}>&-; shift; exec "$@"`, "sh", slotFile, real, ...argv], {
        stdio: [0, 1, 2, ...passFds(), "pipe"],
      });
    } catch {
      resolve({ state: "broken" });
      return;
    }
    const notice = (c.stdio as unknown as (NodeJS.ReadableStream | null)[])[NOTICE_FD]; // 타입은 4번까지만 안다
    notice?.on("data", () => {
      got = true;
      ranFrom = Date.now();
      child = c;
      dropTicket();
      stop = watchParent(c);
    });
    c.on("error", () => resolve({ state: "broken" }));
    c.on("close", (code, sig) => {
      stop();
      child = null;
      if (got) resolve({ state: "ran", exit: exitCodeOf(code, sig ? (osConstants.signals[sig] ?? 0) : null), waitedMs: ranFrom - startedAt, ranMs: Date.now() - ranFrom, killed: Boolean(sig) || signalled || endedWithSession });
      else if (code === BUSY) resolve({ state: "busy" });
      else resolve({ state: "broken" });
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gated(cfg: BrowserGateConfig, real: string): Promise<number> {
  mkdirSync(join(dir, "slots"), { recursive: true });
  mkdirSync(join(dir, "queue"), { recursive: true });
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
        const r = await tryOnce(real, join(dir, "slots", `slot-${i}.lock`));
        if (r.state === "ran") {
          writeRun({ waited, waitedMs: r.waitedMs ?? 0, ranMs: r.ranMs ?? 0, exit: r.exit ?? 1, ...(r.killed ? { killed: true } : {}), ...(endedWithSession ? { endedWithSession: true } : {}) });
          return r.exit ?? 1;
        }
        if (r.state === "broken") throw new Error("slot lock could not be taken (flock missing or slot file unreadable)");
      }
    }
    const waitedMs = Date.now() - startedAt;
    waited = true;
    if (waitDecision(waitedMs, cfg.waitLimitMs) === "timeout") {
      dropTicket();
      process.stderr.write(busyMessage({ slots: cfg.slots, waitedMs }) + "\n");
      writeRun({ waited: true, waitedMs, ranMs: 0, exit: WAIT_LIMIT_EXIT, busy: true });
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
    // 설정 파일이 없으면 기본값(켜짐)
  }
  const cfg = parseBrowserGateConfig(rawCfg, process.env);
  const real = realExecutable(cfg);
  if (!real) {
    process.stderr.write("[atc browser-gate] no Chrome found: set ATC_BROWSER_REAL or realExecutable in browser/config.json, or install Playwright's chromium\n");
    return 127;
  }
  if (cfg.mode === "off") return runDirect(real, null); // SUPERVISOR가 껐다: 줄도 기록도 없다
  try {
    mkdirSync(dir, { recursive: true });
    const probe = openSync(join(dir, "runs.jsonl"), "a"); // 문 폴더를 쓸 수 있는지
    closeSync(probe);
    return await gated(cfg, real);
  } catch (e) {
    dropTicket();
    const why = (e as Error).message;
    process.stderr.write(`[atc browser-gate] gate unavailable (${why}); starting the browser directly\n`);
    return runDirect(real, why.slice(0, 120));
  }
}

process.exit(await main());

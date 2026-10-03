// BROWSER GATE(ATC-520): 여러 세션의 Playwright MCP가 동시에 띄우는 headless Chrome 수에 상한을 둔다. 이 파일은 순수 계산과 파일 모양만 둔다.
// 입출력(슬롯 잡기, Chrome 실행)은 browser-gate-cli.ts. 서버(설정 창의 스위치·카운터)도 이 파일을 읽는다. config.ts는 가져오지 않는다.
// VERIFY GATE(verify-gate.ts)와 같은 문 폴더(~/.local/state/atc-gate)의 browser/ 아래에 따로 둔다: 슬롯·줄·기록·설정이 서로 섞이지 않는다.

import { homedir } from "node:os";
import { join } from "node:path";
import { type RepoCount, repoCounts } from "./gate-repo.ts";
import { exitCodeOf, mayTry, pollMsOf, queuePosition, shouldAnnounce, WAIT_LIMIT_EXIT, waitDecision } from "./verify-gate.ts";

export { exitCodeOf, mayTry, pollMsOf, queuePosition, shouldAnnounce, WAIT_LIMIT_EXIT, waitDecision };

export const BROWSER_WHERE = "local";
export const BROWSER_SLOTS_DEFAULT = 3; // 8 vCPU: VERIFY GATE 두 건이 test 프로세스 3개씩 쓰고, 브라우저는 보통 놀고 가끔 한 코어를 쓴다
export const BROWSER_SLOTS_MAX = 8;
// Playwright의 브라우저 시작 제한(기본 180초)보다 짧게: 못 얻으면 이 문이 먼저 "busy"로 답한다
export const BROWSER_WAIT_LIMIT_SEC_DEFAULT = 90;
export const WATCH_MS = 5000; // 부모(Playwright를 돌리는 MCP 서버) 감시 주기

export type BrowserMode = "on" | "off";

export interface BrowserGateConfig {
  mode: BrowserMode;
  slots: number;
  waitLimitMs: number;
  realExecutable: string | null; // 감싸는 진짜 Chrome. 없으면 Playwright 캐시에서 가장 새 것
}

export const browserDirOf = (env: NodeJS.ProcessEnv = process.env): string => join(env.ATC_GATE_DIR || join(env.HOME || homedir(), ".local", "state", "atc-gate"), "browser");

const intIn = (v: unknown, min: number, max: number, dflt: number): number => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : dflt;
};

// config.json(스위치가 mode만 쓴다)과 환경 변수를 합친다. 틀린 값은 기본값. 끄는 것은 정확히 "off"
export function parseBrowserGateConfig(raw: unknown, env: NodeJS.ProcessEnv = {}): BrowserGateConfig {
  const f = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const real = env.ATC_BROWSER_REAL ?? f.realExecutable;
  return {
    mode: f.mode === "off" ? "off" : "on",
    slots: intIn(env.ATC_BROWSER_SLOTS ?? f.slots, 1, BROWSER_SLOTS_MAX, BROWSER_SLOTS_DEFAULT),
    // ATC_BROWSER_WAIT_LIMIT_MS는 시험용 정밀 손잡이(100ms 이상). 있으면 초 단위 값보다 먼저 본다
    waitLimitMs: intIn(env.ATC_BROWSER_WAIT_LIMIT_MS, 100, 3_600_000, 0) || intIn(env.ATC_BROWSER_WAIT_LIMIT_SEC ?? f.waitLimitSec, 1, 3600, BROWSER_WAIT_LIMIT_SEC_DEFAULT) * 1000,
    realExecutable: typeof real === "string" && real.startsWith("/") ? real : null,
  };
}

// Playwright 캐시의 `chromium-<revision>` 폴더 이름들 중 revision이 가장 큰 것. 없으면 null
export function newestChromiumDir(names: readonly string[]): string | null {
  let best: { rev: number; name: string } | null = null;
  for (const name of names) {
    const m = /^chromium-(\d+)$/.exec(name);
    if (!m) continue;
    const rev = Number(m[1]);
    if (!best || rev > best.rev) best = { rev, name };
  }
  return best?.name ?? null;
}

// 부모가 바뀌었으면(1번이나 다른 pid로 입양) 세션이 끝난 것이다
export const parentGone = (startPpid: number, currentPpid: number): boolean => currentPpid !== startPpid;

const sec = (ms: number) => `${Math.round(ms / 1000)}s`;
export const waitMessage = (p: { position: number; slots: number; waitedMs: number; limitMs: number }): string =>
  `[atc browser-gate] waiting for a browser slot: position ${p.position} in line, ${p.slots} slot${p.slots === 1 ? "" : "s"} busy, waited ${sec(p.waitedMs)} (answers busy after ${sec(p.limitMs)})`;
// Playwright가 이 stderr를 시작 오류 글에 실어 준다: 페이지나 테스트 실패로 읽히지 않게 첫 낱말을 BUSY로
export const busyMessage = (p: { slots: number; waitedMs: number }): string =>
  `[atc browser-gate] BUSY: all ${p.slots} shared browser slot${p.slots === 1 ? " is" : "s are"} in use on this host (waited ${sec(p.waitedMs)}). The page and your test are fine; no browser was started. ` +
  `Close a browser you no longer need (browser_close) or retry in a minute. SUPERVISOR can raise the limit or turn the gate off (Settings → OPERATIONS → BROWSER GATE).`;

// 기록 한 줄(JSONL)
export interface BrowserRun {
  t: string; // 요청 시각
  where: string;
  cwd: string; // 요청한 쪽의 작업 폴더(어느 STAND인지)
  repo?: string; // 요청한 저장소의 맨 위 폴더 이름(전체 경로 아님, ATC-526). 이 기능 이전 줄에는 없다
  waited: boolean; // 줄을 선 적이 있다
  waitedMs: number;
  ranMs: number; // 브라우저가 돈 시간
  exit: number;
  busy?: boolean; // 한도 안에 자리를 못 얻어 "busy"로 답했다
  endedWithSession?: boolean; // 세션이 끝났는데 브라우저가 남아 있어 문이 내려 슬롯을 놓았다
  killed?: boolean; // 신호로 끝났다(슬롯은 커널이 놓는다)
  fallback?: string; // 문이 못 돌아 그냥 실행했다(사유)
}

export interface BrowserCounters {
  requests: number; // 브라우저 요청 수
  waited: number; // 기다린 요청 수
  longestWaitMs: number;
  busyAnswers: number;
  releasedAfterEnd: number; // 세션이 끝난 뒤 놓은 슬롯
  fallbacks: number; // 문이 못 돌아 바로 실행
}
const emptyCounters = (): BrowserCounters => ({ requests: 0, waited: 0, longestWaitMs: 0, busyAnswers: 0, releasedAfterEnd: 0, fallbacks: 0 });

export function parseBrowserRuns(text: string): BrowserRun[] {
  const out: BrowserRun[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as BrowserRun;
      if (r && typeof r.t === "string" && typeof r.waitedMs === "number") out.push(r);
    } catch {
      // 반쯤 쓰인 줄은 건너뛴다
    }
  }
  return out;
}

export function countBrowserRuns(runs: readonly BrowserRun[], sinceMs = 0): BrowserCounters {
  const c = emptyCounters();
  for (const r of runs) {
    if (Date.parse(r.t) < sinceMs) continue;
    c.requests += 1;
    if (r.waited) c.waited += 1;
    c.longestWaitMs = Math.max(c.longestWaitMs, r.waitedMs);
    if (r.busy) c.busyAnswers += 1;
    if (r.endedWithSession) c.releasedAfterEnd += 1;
    if (r.fallback) c.fallbacks += 1;
  }
  return c;
}

export interface BrowserGateView {
  total: BrowserCounters;
  last7d: BrowserCounters;
  slots: number;
  waitLimitSec: number;
  where: string;
  repos: RepoCount[]; // 저장소별 요청 수(폴더 이름만, ATC-526)
  recent: BrowserRun[];
}

export function browserGateView(runs: readonly BrowserRun[], cfg: BrowserGateConfig, nowMs: number): BrowserGateView {
  return {
    total: countBrowserRuns(runs),
    last7d: countBrowserRuns(runs, nowMs - 7 * 86_400_000),
    slots: cfg.slots,
    waitLimitSec: cfg.waitLimitMs / 1000,
    where: BROWSER_WHERE,
    repos: repoCounts(runs, nowMs),
    recent: runs.slice(-5).reverse(),
  };
}

// Playwright MCP 설정(예: ~/.claude/playwright-mcp.json)에 문을 끼운 새 설정. 다른 칸은 그대로(스크린샷 폴더 outputDir 포함).
// 읽기만 한다: 설정 파일을 고치는 일은 SUPERVISOR가 이 출력으로 한다
export function mergeMcpConfig(base: unknown, wrapperPath: string): Record<string, unknown> {
  const cfg = (base && typeof base === "object" && !Array.isArray(base) ? { ...(base as Record<string, unknown>) } : {}) as Record<string, unknown>;
  const browser = (cfg.browser && typeof cfg.browser === "object" ? { ...(cfg.browser as Record<string, unknown>) } : {}) as Record<string, unknown>;
  const launch = (browser.launchOptions && typeof browser.launchOptions === "object" ? { ...(browser.launchOptions as Record<string, unknown>) } : {}) as Record<string, unknown>;
  launch.executablePath = wrapperPath;
  browser.launchOptions = launch;
  cfg.browser = browser;
  return cfg;
}

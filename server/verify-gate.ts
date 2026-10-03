// VERIFY GATE(ATC-517): 무거운 검증 명령(npm test, tsc, vite build)이 여러 STAND에서 한꺼번에 호스트를 누르지 않게 줄 세우는 문. 이 파일은 순수 계산과 파일 모양만 둔다.
// 입출력(락 잡기, 자식 실행)은 verify-gate-cli.ts. 서버(설정 창의 스위치·카운터)도 이 파일을 읽는다. config.ts는 가져오지 않는다(환경을 import 때 읽어 운영 상태 폴더를 건드릴 수 있다).

import { homedir } from "node:os";
import { join } from "node:path";
import { LOCAL_REASONS, type LocalReason, PROBE_SEC_DEFAULT } from "./verify-remote.ts";

export const GATE_WHERE = "local"; // 기록의 where 기본: 이 호스트. 데스크톱에서 돈 줄은 "desktop"(ATC-518)
export const WAIT_LIMIT_EXIT = 75; // EX_TEMPFAIL: 기다림 한도 초과
export const USAGE_EXIT = 64; // EX_USAGE: 명령이 없다
export const SLOTS_DEFAULT = 2; // 8 vCPU에서 두 건: 건당 test 프로세스 3개 + tsc·vite 몫이 코어를 넘지 않게
export const WAIT_LIMIT_SEC_DEFAULT = 1800;
export const TEST_CONCURRENCY_DEFAULT = 3;
export const SLOTS_MAX = 8;
export const ANNOUNCE_EVERY_MS = 30_000;

export type GateMode = "on" | "off";

export interface GateConfig {
  mode: GateMode;
  slots: number;
  waitLimitMs: number;
  testConcurrency: number;
  remote: "on" | "off"; // 원격 실행 스위치(ATC-518, verifyRemote). 기본 on
  probeMs: number; // 데스크톱이 닿는지 보는 제한 시간
}

// 문의 폴더: 락·줄·기록·설정. 운영 상태 폴더(~/.local/state/atc)와 따로 둔다
export function gateDirOf(env: NodeJS.ProcessEnv = process.env): string {
  return env.ATC_GATE_DIR || join(env.HOME || homedir(), ".local", "state", "atc-gate");
}

const intIn = (v: unknown, min: number, max: number, dflt: number): number => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : dflt;
};

// config.json(스위치가 mode만 쓴다)과 환경 변수(slots·대기 한도·test 동시성)를 합친다. 틀린 값은 기본값. 끄는 것은 정확히 "off"
export function parseGateConfig(raw: unknown, env: NodeJS.ProcessEnv = {}): GateConfig {
  const f = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    mode: f.mode === "off" ? "off" : "on",
    slots: intIn(env.ATC_GATE_SLOTS ?? f.slots, 1, SLOTS_MAX, SLOTS_DEFAULT),
    waitLimitMs: intIn(env.ATC_GATE_WAIT_LIMIT_SEC ?? f.waitLimitSec, 1, 86_400, WAIT_LIMIT_SEC_DEFAULT) * 1000,
    testConcurrency: intIn(env.ATC_GATE_TEST_CONCURRENCY ?? f.testConcurrency, 1, 64, TEST_CONCURRENCY_DEFAULT),
    remote: f.remote === "off" ? "off" : "on",
    probeMs: intIn(env.ATC_GATE_REMOTE_PROBE_SEC ?? f.remoteProbeSec, 1, 30, PROBE_SEC_DEFAULT) * 1000,
  };
}

// 줄: 표 이름은 `<붙은 ms 15자리>-<pid>-<무작위>`라 이름순이 도착순이다
export interface Ticket {
  name: string;
  alive: boolean;
}

// 살아 있는 표만 세어 내 앞에 몇이 있는지(1부터). 내 표가 없으면 맨 뒤
export function queuePosition(tickets: readonly Ticket[], mine: string): number {
  const live = tickets.filter((t) => t.alive || t.name === mine).map((t) => t.name).sort();
  const i = live.indexOf(mine);
  return i < 0 ? live.length + 1 : i + 1;
}

// 슬롯을 잡아 볼 자격: 줄의 앞 `slots`명만 시도한다(나머지는 순서를 기다린다)
export const mayTry = (position: number, slots: number): boolean => position <= slots;

export const waitDecision = (waitedMs: number, limitMs: number): "wait" | "timeout" => (waitedMs >= limitMs ? "timeout" : "wait");

// stderr 알림은 처음 한 번, 그다음 30초마다
export const shouldAnnounce = (lastAnnouncedAtMs: number | null, waitedMs: number): boolean => lastAnnouncedAtMs === null || waitedMs - lastAnnouncedAtMs >= ANNOUNCE_EVERY_MS;

const sec = (ms: number) => `${Math.round(ms / 1000)}s`;
export const waitMessage = (p: { position: number; slots: number; waitedMs: number; limitMs: number }): string =>
  `[atc verify-gate] waiting for a slot: position ${p.position} in line, ${p.slots} slot${p.slots === 1 ? "" : "s"} busy, waited ${sec(p.waitedMs)} (gives up after ${sec(p.limitMs)})`;
export const timeoutMessage = (waitedMs: number): string =>
  `[atc verify-gate] gave up after ${sec(waitedMs)} waiting for a slot; the command did not run (exit ${WAIT_LIMIT_EXIT}). Try again later; SUPERVISOR can raise the limit or turn the gate off.`;

// 셸처럼: 신호로 끝났으면 128+번호
export const exitCodeOf = (code: number | null, signalNumber: number | null): number => (code !== null ? code : 128 + (signalNumber ?? 0));

// 기록 한 줄(JSONL). 명령은 앞 세 낱말까지만 남긴다(인자에 비밀이 섞일 수 있다)
export interface GateRun {
  t: string; // 시작 시각
  where: string;
  cmd: string;
  cwd: string;
  waited: boolean; // 줄을 선 적이 있다
  waitedMs: number;
  ranMs: number;
  exit: number;
  killed?: boolean; // 신호로 끝났다(슬롯은 커널이 놓는다)
  timedOut?: boolean; // 기다림 한도로 실행하지 않았다
  fallback?: string; // 문이 못 돌아 그냥 실행했다(사유)
  syncMs?: number; // 데스크톱으로 보내고 준비하는 데 걸린 시간(ATC-518). 데스크톱을 시도한 줄만
  localReason?: LocalReason; // 로컬에서 돈 사유(데스크톱이 없다·전송 오류·목록에 없다·스위치 꺼짐). 데스크톱에서 돈 줄에는 없다
  lost?: boolean; // 데스크톱에서 명령이 시작된 뒤 연결을 잃었다(결과를 모른다, 다시 돌리지 않았다)
}

export const cmdLabel = (argv: readonly string[]): string => argv.slice(0, 3).join(" ").slice(0, 120);

export interface GateCounters {
  runs: number;
  waited: number; // 기다린 실행 수
  longestWaitMs: number;
  waitLimitFails: number;
  fallbacks: number;
  killedReleases: number; // 죽은 명령이 놓은 슬롯
  desktopRuns: number; // 데스크톱에서 돈 실행(ATC-518)
  transportFailed: number; // 전송 문제로 실패한 원격 시도: 시작 전에 로컬로 돌아선 것 + 시작 뒤 잃은 것
  remoteCommandFails: number; // 데스크톱에서 돌았고 명령이 0이 아닌 코드로 끝난 것(전송 문제 아님)
  localFallbacks: Record<LocalReason, number>; // 로컬에서 돈 실행을 사유별로
  lostMidway: number; // 데스크톱에서 시작했다가 도중에 잃은 것
}
const emptyCounters = (): GateCounters => ({
  runs: 0, waited: 0, longestWaitMs: 0, waitLimitFails: 0, fallbacks: 0, killedReleases: 0,
  desktopRuns: 0, transportFailed: 0, remoteCommandFails: 0, localFallbacks: { "desktop-absent": 0, "transport-error": 0, "not-listed": 0, "switch-off": 0 }, lostMidway: 0,
});

export function parseRuns(text: string): GateRun[] {
  const out: GateRun[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as GateRun;
      if (r && typeof r.t === "string" && typeof r.waitedMs === "number") out.push(r);
    } catch {
      // 반쯤 쓰인 줄은 건너뛴다
    }
  }
  return out;
}

export function countRuns(runs: readonly GateRun[], sinceMs = 0): GateCounters {
  const c = emptyCounters();
  for (const r of runs) {
    if (Date.parse(r.t) < sinceMs) continue;
    c.runs += 1;
    if (r.waited) c.waited += 1;
    c.longestWaitMs = Math.max(c.longestWaitMs, r.waitedMs);
    if (r.timedOut) c.waitLimitFails += 1;
    if (r.fallback) c.fallbacks += 1;
    if (r.killed) c.killedReleases += 1;
    if (r.where === "desktop") {
      c.desktopRuns += 1;
      if (r.lost) {
        c.lostMidway += 1;
        c.transportFailed += 1;
      } else if (r.exit !== 0) c.remoteCommandFails += 1;
    }
    if (r.localReason && LOCAL_REASONS.includes(r.localReason)) {
      c.localFallbacks[r.localReason] += 1;
      if (r.localReason === "transport-error") c.transportFailed += 1;
    }
  }
  return c;
}

export interface GateView {
  total: GateCounters;
  last7d: GateCounters;
  slots: number;
  waitLimitSec: number;
  testConcurrency: number;
  where: string;
  remote: { mode: "on" | "off"; configured: boolean; probeSec: number }; // configured: remote.json이 있고 모양이 맞다(주소는 화면에 보내지 않는다)
  recent: GateRun[]; // 최근 몇 건(기록의 실제 모양을 보인다)
}

export function gateView(runs: readonly GateRun[], cfg: GateConfig, nowMs: number, remoteConfigured = false): GateView {
  return {
    total: countRuns(runs),
    last7d: countRuns(runs, nowMs - 7 * 86_400_000),
    slots: cfg.slots,
    waitLimitSec: cfg.waitLimitMs / 1000,
    testConcurrency: cfg.testConcurrency,
    where: GATE_WHERE,
    remote: { mode: cfg.remote, configured: remoteConfigured, probeSec: cfg.probeMs / 1000 },
    recent: runs.slice(-5).reverse(),
  };
}

// PATH 맨 앞에 두는 node 껍데기: `node --test …`에 --test-concurrency=K를 건다(npm test도 이 껍데기를 거친다).
// NODE_OPTIONS로는 못 건다(node가 거절한다). 이미 --test-concurrency가 있으면 그대로
export const NODE_SHIM = `#!/bin/sh
# atc verify-gate(ATC-517): node --test 한 번이 만드는 test 프로세스 수를 건다
real="\${ATC_GATE_REAL_NODE:-node}"
k="\${ATC_GATE_TEST_CONCURRENCY:-}"
has=0
test=0
for a in "$@"; do
  case "$a" in
    --test-concurrency|--test-concurrency=*) has=1 ;;
    --test) test=1 ;;
    -*) ;;
    *) break ;;
  esac
done
if [ "$test" = 1 ] && [ "$has" = 0 ] && [ -n "$k" ]; then
  exec "$real" "--test-concurrency=$k" "$@"
fi
exec "$real" "$@"
`;

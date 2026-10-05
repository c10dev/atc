// JOB TIMING(ATC-525, docs/job-timing.md): 서버가 주기로 하는 일마다 걸린 시간을 센다. 일은 server/jobs/의 잡, 2초 틱의 각 단계, 대화 기록 감시(fuel), 각 *-run의 tick, `claude agents --json` 실행이다.
// 입출력이 없는 순수 부분이다(파일 쓰기·스위치 파일은 job-timing-run.ts). 값을 바꾸지 않고 시간만 잰다: 켜도 꺼도 화면의 신선도는 같다.
// 잰 것은 두 가지다. ms는 일이 이벤트 루프를 붙든 동기 시간(서버 CPU의 대용), wallMs는 비동기 일이 끝날 때까지 걸린 시계 시간(자식 프로세스를 기다리는 시간도 들어 있어 CPU가 아니다).

import { monitorEventLoopDelay } from "node:perf_hooks";
import type { LoopLag } from "./event-loop-lag.ts";

export type JobTimingSwitch = "off" | "on";
export const JOB_TIMING_SWITCHES: readonly JobTimingSwitch[] = ["off", "on"];
export const parseJobTimingSwitch = (v: unknown): JobTimingSwitch => (v === "off" ? "off" : "on");

export interface SourceTiming {
  runs: number;
  ms: number; // 동기 구간 합(ms)
  maxMs: number; // 한 번의 동기 구간 최대
  wallRuns: number; // 비동기로 끝난 횟수
  wallMs: number; // 시작부터 끝까지 합(ms)
  wallMaxMs: number;
}

export interface TimingWindow {
  windowMs: number;
  sources: Record<string, SourceTiming>;
  cpu: { userMs: number; systemMs: number }; // 이 서버 프로세스의 같은 구간 CPU(process.cpuUsage 차)
  dropped: number; // 지금까지 버린 시간 수(출처가 한도를 넘었거나 기록을 못 써서)
  loop: LoopLag | null; // 같은 구간의 이벤트 루프 지연(ATC-538). 못 쟀으면 null
}

// 이벤트 루프 지연 표본(ATC-538). take()는 지금까지의 p99·max(ms)를 돌려주고 비운다. start()가 불리기 전에는 null
export interface LoopSampler {
  start(): void;
  take(): LoopLag | null;
}

const LOOP_RESOLUTION_MS = 10;
// perf_hooks.monitorEventLoopDelay: 타이머가 해상도(10ms)마다 깨는 것이 얼마나 늦었나를 잰다. 값에는 해상도 자체가 들어 있어서 빼고 지연만 센다
export function perfLoopSampler(): LoopSampler {
  const h = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
  let on = false;
  const lag = (ns: number) => Math.max(0, Math.round((ns / 1e6 - LOOP_RESOLUTION_MS) * 100) / 100);
  return {
    start() {
      if (on) return;
      on = true;
      h.enable();
    },
    take() {
      if (!on || h.count === 0) return null;
      const out = { p99Ms: lag(h.percentile(99)), maxMs: lag(h.max) };
      h.reset();
      return out;
    },
  };
}

export const MAX_SOURCES = 96; // 출처 이름이 한도를 넘으면 새 이름은 버리고 센다(이름이 새는 버그가 메모리를 먹지 않게)

const blank = (): SourceTiming => ({ runs: 0, ms: 0, maxMs: 0, wallRuns: 0, wallMs: 0, wallMaxMs: 0 });
const round = (n: number) => Math.round(n * 1000) / 1000;

export function createTimer(now: () => number = () => performance.now(), cpuNow: () => NodeJS.CpuUsage = () => process.cpuUsage(), loop: LoopSampler | null = null) {
  let enabled = true;
  let sources = new Map<string, SourceTiming>();
  let dropped = 0;
  let since = now();
  let cpuSince = cpuNow();

  const slot = (name: string): SourceTiming | null => {
    let s = sources.get(name);
    if (!s) {
      if (sources.size >= MAX_SOURCES) {
        dropped++;
        return null;
      }
      s = blank();
      sources.set(name, s);
    }
    return s;
  };

  const timer = {
    // 켜고 끌 때 구간을 비운다: 꺼져 있던 시간이 다시 켠 뒤 한 구간에 섞이지 않게
    setEnabled(on: boolean) {
      if (on === enabled) return;
      enabled = on;
      sources = new Map();
      since = now();
      cpuSince = cpuNow();
      loop?.take(); // 꺼져 있던 동안의 표본을 버린다
    },
    get enabled() {
      return enabled;
    },
    // fn의 값을 그대로 돌려주고 시간만 잰다. 던져도 시간은 센다. Promise면 끝난 때 wallMs도 세고, 거절은 그대로 호출한 쪽에 전한다(처리 없이 버려지던 거절은 여전히 처리 안 된 거절이다)
    timed<T>(name: string, fn: () => T): T {
      if (!enabled) return fn();
      const t0 = now();
      let result: T;
      try {
        result = fn();
      } catch (e) {
        timer.note(name, now() - t0);
        throw e;
      }
      const sync = now() - t0;
      timer.note(name, sync);
      if (result && typeof (result as { then?: unknown }).then === "function") {
        const done = () => timer.noteWall(name, now() - t0);
        return (result as unknown as Promise<unknown>).then(
          (v) => {
            done();
            return v;
          },
          (e) => {
            done();
            throw e;
          },
        ) as T;
      }
      return result;
    },
    note(name: string, ms: number) {
      const s = slot(name);
      if (!s) return;
      s.runs++;
      s.ms += ms;
      if (ms > s.maxMs) s.maxMs = ms;
    },
    // 이미 끝난 길의 시계 시간 하나(HTTP 요청): 실행 한 번과 wallMs를 센다
    span(name: string, ms: number) {
      if (!enabled) return;
      timer.note(name, 0);
      timer.noteWall(name, ms);
    },
    noteWall(name: string, ms: number) {
      const s = slot(name);
      if (!s) return;
      s.wallRuns++;
      s.wallMs += ms;
      if (ms > s.wallMaxMs) s.wallMaxMs = ms;
    },
    // 지금까지의 구간을 돌려주고 새 구간을 시작한다. dropped는 누적이다
    take(): TimingWindow {
      const t = now();
      const c = cpuNow();
      const out: TimingWindow = {
        windowMs: Math.round(t - since),
        sources: Object.fromEntries([...sources].map(([k, v]) => [k, { runs: v.runs, ms: round(v.ms), maxMs: round(v.maxMs), wallRuns: v.wallRuns, wallMs: round(v.wallMs), wallMaxMs: round(v.wallMaxMs) }])),
        cpu: { userMs: Math.round((c.user - cpuSince.user) / 1000), systemMs: Math.round((c.system - cpuSince.system) / 1000) },
        dropped,
        loop: loop?.take() ?? null,
      };
      sources = new Map();
      since = t;
      cpuSince = c;
      return out;
    },
    startLoop: () => loop?.start(),
    drop(n: number) {
      dropped += n;
    },
    runsInWindow: () => [...sources.values()].reduce((a, s) => a + s.runs + s.wallRuns, 0),
  };
  return timer;
}

// 서버가 쓰는 하나의 타이머. 잡 러너·틱·fuel이 이 timed를 쓴다
export const jobTimer = createTimer(undefined, undefined, perfLoopSampler());
export const timed = jobTimer.timed;

// 기록 줄들을 출처별로 합친다(보고용): 같은 이름의 runs·ms를 더하고 최댓값은 최댓값으로
export interface TimingLine {
  t: string;
  kind: "job-timing";
  windowMs: number;
  sources: Record<string, SourceTiming>;
  cpu: { userMs: number; systemMs: number };
  dropped: number;
  loop?: LoopLag | null; // ATC-538 앞의 줄에는 없다
}

export function sumTimings(lines: readonly TimingLine[]): { windowMs: number; cpu: { userMs: number; systemMs: number }; dropped: number; loop: LoopLag | null; sources: Record<string, SourceTiming> } {
  const sources: Record<string, SourceTiming> = {};
  let windowMs = 0;
  let userMs = 0;
  let systemMs = 0;
  let dropped = 0;
  let worst = { p99Ms: 0, maxMs: 0 };
  let seen = false;
  for (const l of lines) {
    if (l.loop) {
      seen = true;
      worst = { p99Ms: Math.max(worst.p99Ms, l.loop.p99Ms), maxMs: Math.max(worst.maxMs, l.loop.maxMs) }; // 구간들 중 가장 나빴던 값
    }
    windowMs += l.windowMs;
    userMs += l.cpu.userMs;
    systemMs += l.cpu.systemMs;
    dropped = Math.max(dropped, l.dropped);
    for (const [k, v] of Object.entries(l.sources)) {
      const s = (sources[k] ??= blank());
      s.runs += v.runs;
      s.ms = round(s.ms + v.ms);
      s.maxMs = Math.max(s.maxMs, v.maxMs);
      s.wallRuns += v.wallRuns;
      s.wallMs = round(s.wallMs + v.wallMs);
      s.wallMaxMs = Math.max(s.wallMaxMs, v.wallMaxMs);
    }
  }
  return { windowMs, cpu: { userMs, systemMs }, dropped, loop: seen ? worst : null, sources };
}

// EVENT LOOP LAG(ATC-538, docs/job-timing.md): 서버가 느린 것을 화면이 아니라 atc가 먼저 안다. 이벤트 루프 지연의 p99가 기준을 넘는 JOB TIMING 구간이 연달아 N번이면 CAUTION 알림 하나를 올리고, 기준 밑인 구간이 오면 내린다.
// 순수 함수만 둔다(파일·스위치·알림 입력은 event-loop-lag-run.ts). 값을 바꾸지 않고 읽기만 한다: 켜도 꺼도 화면이 그리는 것과 신선도는 같다.

const MIN = 60_000;
const DAY = 86_400_000;
export const DEFAULT_LAG_MS = 250; // p99가 이 값(ms)을 넘으면 느린 구간
export const DEFAULT_LAG_WINDOWS = 3; // 느린 구간이 이만큼 연달아야 알림(5분 구간이라 15분)
export const LAG_MISFIRE_MIN = 10; // 알림이 올라간 지 이 안에 내려가면 소음(MISFIRE)

export type LagSwitch = "off" | "on";
export const LAG_SWITCHES: readonly LagSwitch[] = ["off", "on"];
// 파일에 없거나 모르는 값이면 on(live first). 끄는 것은 SUPERVISOR가 쓴 off뿐이다
export const parseLagSwitch = (v: unknown): LagSwitch => (v === "off" ? "off" : "on");

// 한 JOB TIMING 구간의 이벤트 루프 지연(ms). 잰 것이 없으면 null
export interface LoopLag {
  p99Ms: number;
  maxMs: number;
}

export interface LagConfig {
  thresholdMs: number;
  windows: number;
}

// ── 에피소드 기록(event-loop-lag-episodes.jsonl, 추가만): 알림이 올라간 구간 ──
export type LagEnd = "cleared" | "switch" | "no-data";
export interface LagEpisodeLine {
  at: string;
  op: "open" | "close";
  p99Ms: number; // open: 알림을 올린 구간의 p99. close: 끝낸 구간의 p99(없으면 null)
  thresholdMs: number;
  windows?: number; // open: 연달아 넘은 구간 수
  endedBy?: LagEnd; // close
  misfire?: boolean; // close: 올라간 지 LAG_MISFIRE_MIN 안에 스스로 내려갔다
}

export interface LagState {
  over: number; // 지금까지 연달아 기준을 넘은 구간 수
  open: LagEpisodeLine | null; // 열린 에피소드(알림이 올라가 있다)
}
export const LAG_START: LagState = { over: 0, open: null };

export const openLagOf = (lines: readonly LagEpisodeLine[]): LagEpisodeLine | null => {
  let open: LagEpisodeLine | null = null;
  for (const l of lines) open = l.op === "open" ? l : null;
  return open;
};

// 구간 하나가 닫힐 때마다 부른다. win이 null이면 그 구간을 못 쟀다(JOB TIMING이 꺼졌다). 다음 상태와 덧붙일 줄을 돌려준다
// MISFIRE는 스스로 내려간 것(cleared)만 센다. 스위치를 끄거나 못 재서 닫은 것은 알림이 틀렸다는 뜻이 아니다
export function lagStep(state: LagState, win: LoopLag | null, cfg: LagConfig, sw: LagSwitch, now: number): { state: LagState; lines: LagEpisodeLine[] } {
  const at = new Date(now).toISOString();
  const close = (endedBy: LagEnd): LagEpisodeLine => {
    const o = state.open!;
    return { at, op: "close", p99Ms: win?.p99Ms ?? 0, thresholdMs: o.thresholdMs, endedBy, misfire: endedBy === "cleared" && now - Date.parse(o.at) < LAG_MISFIRE_MIN * MIN };
  };
  if (sw === "off") return { state: LAG_START, lines: state.open ? [close("switch")] : [] };
  if (!win) return { state: LAG_START, lines: state.open ? [close("no-data")] : [] };
  if (win.p99Ms > cfg.thresholdMs) {
    const over = state.over + 1;
    if (!state.open && over >= Math.max(1, cfg.windows)) {
      const open: LagEpisodeLine = { at, op: "open", p99Ms: win.p99Ms, thresholdMs: cfg.thresholdMs, windows: over };
      return { state: { over, open }, lines: [open] };
    }
    return { state: { over, open: state.open }, lines: [] };
  }
  return { state: LAG_START, lines: state.open ? [close("cleared")] : [] };
}

export interface LagCounter {
  episodes: number; // 연 에피소드(닫힌 것과 열린 것)
  closed: number;
  misfires: number;
  share: number | null; // misfires / closed
  open: boolean; // 지금 알림이 올라가 있다
}

export function lagCounterOf(lines: readonly LagEpisodeLine[], now: number, days = 7): LagCounter {
  const since = now - days * DAY;
  const win = lines.filter((l) => Date.parse(l.at) >= since);
  const closed = win.filter((l) => l.op === "close");
  const misfires = closed.filter((l) => l.misfire).length;
  return { episodes: win.filter((l) => l.op === "open").length, closed: closed.length, misfires, share: closed.length ? misfires / closed.length : null, open: openLagOf(lines) !== null };
}

// 알림 한 줄의 글(한국어)
export const lagLineOf = (o: Pick<LagEpisodeLine, "p99Ms" | "thresholdMs" | "windows">): string =>
  `서버 이벤트 루프가 느림 — 지연 p99 ${Math.round(o.p99Ms)}ms(기준 ${o.thresholdMs}ms)가 ${o.windows ?? 0}개 구간 연달아 넘음`;

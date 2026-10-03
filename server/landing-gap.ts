import { quantile } from "./fuel-view.ts";

// HOME "착륙 없음" 정지 규칙의 기준·스위치·MISFIRE(ATC-501, docs/home-flow.md 4.3). 순수 함수만 — 읽고 쓰는 것은 landing-gap-run.ts.
// 기준 = 그 AIRPORT의 지난 7일 연속 착륙(ON) 간격의 p90, 바닥 30분. 간격이 8개보다 적으면 그 AIRPORT는 간격 규칙이 없다.
// 스위치는 SUPERVISOR만 바꾼다(설정 창). off는 간격 규칙만 뺀다 — ground stop과 main CI 빨강은 사실이라 그대로 막힘이다.

const MIN = 60_000;
const DAY = 86_400_000;
export const GAP_FLOOR_MIN = 30;
export const GAP_WINDOW_DAYS = 7;
export const GAP_MIN_SAMPLES = 8;

export type GapSwitch = "off" | "on";
export const GAP_SWITCHES: readonly GapSwitch[] = ["off", "on"];
// 파일에 없거나 모르는 값이면 on(live first). 끄는 것은 SUPERVISOR가 쓴 off뿐이다
export const parseGapSwitch = (v: unknown): GapSwitch => (v === "off" ? "off" : "on");

export interface GapThreshold {
  thresholdMin: number; // 바닥을 적용한 기준(분). 간격이 모자라면 바닥
  samples: number; // 창 안의 간격 수
  rule: boolean; // 간격이 GAP_MIN_SAMPLES 이상이라 규칙이 있다
}

// 한 AIRPORT의 기준. landingsAt은 그 AIRPORT 착륙(ON) 시각(ISO). 창: 지난 7일에 닿은 착륙 사이의 간격
export function gapThresholdOf(landingsAt: readonly string[], now: number, floorMin = GAP_FLOOR_MIN): GapThreshold {
  const since = now - GAP_WINDOW_DAYS * DAY;
  const ts = landingsAt
    .map((t) => Date.parse(t))
    .filter((t) => Number.isFinite(t) && t >= since && t <= now)
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < ts.length; i++) gaps.push((ts[i]! - ts[i - 1]!) / MIN);
  const p90 = quantile(gaps, 0.9);
  return { thresholdMin: Math.max(floorMin, p90 === null ? floorMin : Math.ceil(p90)), samples: gaps.length, rule: gaps.length >= GAP_MIN_SAMPLES };
}

// AIRPORT별 기준(landings: 전 AIRPORT의 착륙 줄)
export function gapThresholdsOf(airports: readonly string[], landings: readonly { airport: string; at: string }[], now: number): Record<string, GapThreshold> {
  const out: Record<string, GapThreshold> = {};
  for (const code of airports) out[code] = gapThresholdOf(landings.filter((l) => l.airport === code).map((l) => l.at), now);
  return out;
}

// ── 에피소드 기록(landing-gap-episodes.jsonl, 추가만): 간격 규칙이 막힘을 낸 구간 ──
export type EpisodeEnd = "landing" | "stop" | "ci" | "switch" | "work-gone";
export interface EpisodeLine {
  at: string;
  op: "open" | "close";
  airport: string;
  thresholdMin: number;
  lastOn?: string | null; // open: 마지막 착륙(ON)의 시각. 막힘은 lastOn + 기준에 시작한다
  endedBy?: EpisodeEnd; // close
  misfire?: boolean; // close: 확률이 높은 MISFIRE
}

// 이 AIRPORT 이번 순간의 사실(흐름판 판정에서 뽑는다)
export interface GapFacts {
  airport: string;
  gapStopped: boolean; // 간격 규칙이 막힘을 냈다(ground stop·main CI가 먼저 막으면 false)
  groundStop: boolean;
  mainRed: boolean;
  lastOn: string | null; // 마지막 착륙(ON)
}

export const openEpisodesOf = (lines: readonly EpisodeLine[]): Map<string, EpisodeLine> => {
  const open = new Map<string, EpisodeLine>();
  for (const l of lines) {
    if (l.op === "open") open.set(l.airport, l);
    else open.delete(l.airport);
  }
  return open;
};

// 다음에 덧붙일 줄. 열린 에피소드가 없는데 막힘이면 open. 열려 있는데 막힘이 아니면 close
// MISFIRE: 스스로 끝났다 = 착륙으로 끝났고(ground stop·CI·스위치·일 없어짐이 아님), 막힘 시작(lastOn + 기준)에서 한 기준 안에 끝났다(착륙 간격 ≤ 2 × 기준)
export function episodeStep(open: ReadonlyMap<string, EpisodeLine>, facts: readonly GapFacts[], thresholds: Readonly<Record<string, number>>, sw: GapSwitch, now: number): EpisodeLine[] {
  const out: EpisodeLine[] = [];
  const at = new Date(now).toISOString();
  for (const f of facts) {
    const o = open.get(f.airport);
    if (!o && f.gapStopped) {
      out.push({ at, op: "open", airport: f.airport, thresholdMin: thresholds[f.airport] ?? GAP_FLOOR_MIN, lastOn: f.lastOn });
    } else if (o && !f.gapStopped) {
      const landed = f.lastOn !== null && Date.parse(f.lastOn) > Date.parse(o.at);
      const endedBy: EpisodeEnd = f.groundStop ? "stop" : f.mainRed ? "ci" : sw === "off" ? "switch" : landed ? "landing" : "work-gone";
      const start = o.lastOn ? Date.parse(o.lastOn) : NaN;
      const within = landed && Number.isFinite(start) && Date.parse(f.lastOn!) - start <= 2 * o.thresholdMin * MIN;
      out.push({ at, op: "close", airport: f.airport, thresholdMin: o.thresholdMin, endedBy, misfire: endedBy === "landing" && within });
    }
  }
  return out;
}

export interface GapCounter {
  episodes: number; // 연 에피소드(닫힌 것과 열린 것)
  closed: number;
  misfires: number;
  share: number | null; // misfires / closed
  open: string[]; // 지금 열린 AIRPORT
}

export function gapCounterOf(lines: readonly EpisodeLine[], now: number, days = GAP_WINDOW_DAYS): GapCounter {
  const since = now - days * DAY;
  const inWin = lines.filter((l) => Date.parse(l.at) >= since);
  const closed = inWin.filter((l) => l.op === "close");
  const misfires = closed.filter((l) => l.misfire).length;
  return { episodes: inWin.filter((l) => l.op === "open").length, closed: closed.length, misfires, share: closed.length ? misfires / closed.length : null, open: [...openEpisodesOf(lines).keys()].sort() };
}

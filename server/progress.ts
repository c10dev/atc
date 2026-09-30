import { quantile } from "./fuel-view.ts";
import type { LogEntry } from "./logbook.ts";
import type { Milestones } from "./milestones.ts";

// FLIGHT 진행 막대의 셈(ATC-211, docs/dispatch.md "Progress as built"). 순수 함수만 두고 그리는 것과 나눈다(GLOBE도 이 모델을 쓴다).
// 지난 이정표(OOOI)는 사실이다. 추정은 지금 구간 안에서만, 그 구간의 지난 FLIGHT들이 보통 걸린 범위(p25–p75)와 견줄 뿐이다.
// 퍼센트도 도착 시각 하나도 만들지 않는다. 팀이 스스로 알리는 진행(%, todo)은 읽지 않는다.
// 브라우저에서도 쓰므로 node 모듈을 끌어오지 않는다(타입 import와 fuel-view의 순수 함수만).

export const SEGMENTS = ["work", "landing", "rts", "done"] as const;
export type Segment = (typeof SEGMENTS)[number];

export const PROGRESS_DAYS = 60; // 보통 걸린 시간이 배우는 기간(TRIP FUEL과 같다)
export const PROGRESS_MIN_SAMPLES = 3; // MEDIAN_MIN_SAMPLES와 같다. 적으면 WAKE, 그다음 AIRPORT로 넓힌다

const DAY = 86_400_000;
const MIN = 60_000;

export type TypicalLevel = "TYPE×WAKE" | "WAKE" | "AIRPORT";
export interface Typical {
  p25: number; // 분
  p50: number;
  p75: number;
  n: number;
  level: TypicalLevel;
  group: string; // "BUILD·M" · "M" · AIRPORT 코드
}
export interface FlightTarget {
  key?: string | null; // 이 FLIGHT의 다른 줄(여러 PR)은 표본에서 뺀다
  class: { type: string; wake: string } | null;
  airport: string | null;
}
export interface TypicalDurations {
  work: Typical | null; // OUT→OFF(blockMin)
  landing: Typical | null; // OFF→ON(landingWaitMin)
}

type Sample = Pick<LogEntry, "flight" | "class" | "airport" | "arrivedAt" | "blockMin" | "landingWaitMin" | "reverted" | "pr">;

const round1 = (v: number) => Math.round(v * 10) / 10;

// 표본 하나 고르기: TYPE×WAKE → WAKE → AIRPORT, 표본이 min 이상인 첫 단계. 없으면 null
function typicalOf(pick: (e: Sample) => number | null, target: FlightTarget, pool: readonly Sample[], min: number): Typical | null {
  const c = target.class;
  const levels: { level: TypicalLevel; group: string; hit: (e: Sample) => boolean }[] = [
    ...(c
      ? [
          { level: "TYPE×WAKE" as const, group: `${c.type}·${c.wake}`, hit: (e: Sample) => e.class?.type === c.type && e.class?.wake === c.wake },
          { level: "WAKE" as const, group: c.wake, hit: (e: Sample) => e.class?.wake === c.wake },
        ]
      : []),
    ...(target.airport ? [{ level: "AIRPORT" as const, group: target.airport, hit: (e: Sample) => e.airport === target.airport }] : []),
  ];
  for (const l of levels) {
    const xs = pool.filter(l.hit).map(pick).filter((v): v is number => v !== null && Number.isFinite(v) && v >= 0);
    if (xs.length < min) continue;
    return { p25: round1(quantile(xs, 0.25)!), p50: round1(quantile(xs, 0.5)!), p75: round1(quantile(xs, 0.75)!), n: xs.length, level: l.level, group: l.group };
  }
  return null;
}

// LOGBOOK의 최근 줄에서 보통 걸린 시간. 되돌려진 줄, PR 없는 줄(STAND 없는 FLIGHT), 값이 null인 줄은 뺀다
export function typicalDurations(target: FlightTarget, entries: readonly Sample[], now: number, days = PROGRESS_DAYS, min = PROGRESS_MIN_SAMPLES): TypicalDurations {
  const since = now - days * DAY;
  const pool = entries.filter((e) => e.pr && !e.reverted && (!target.key || e.flight !== target.key) && Date.parse(e.arrivedAt) >= since && Date.parse(e.arrivedAt) <= now);
  return { work: typicalOf((e) => e.blockMin, target, pool, min), landing: typicalOf((e) => e.landingWaitMin, target, pool, min) };
}

export interface FlightProgress {
  segment: Segment;
  elapsedMin: number | null; // 지금 구간에 든 뒤 분. done이면 null
  typical: Typical | null; // work·landing만. 표본이 모자라거나 rts·done이면 null
  late: boolean; // 보통 범위의 p75를 넘음
  marker: number | null; // 막대 위 위치 0..1(4칸 전체). 추정이 없어도 지금 구간의 시작에 선다. done이면 null
  standFree: boolean; // PR 없는 FLIGHT: work 한 칸뿐(막대도 한 칸)
}

export interface ProgressInput {
  milestones: Milestones;
  awaitsRts: boolean; // ON 뒤 RTS가 이 FLIGHT를 서비스에 넣는다(MCC AIRPORT의 FLIGHT). 아니면 ON이 끝이다
  arrivedWithoutPr: boolean; // STAND 없는 FLIGHT의 ARRIVED(ATC-72)가 기록됨
  typical: TypicalDurations;
}

const minutesSince = (iso: string | null, now: number) => (iso && Number.isFinite(Date.parse(iso)) ? Math.max(0, Math.round((now - Date.parse(iso)) / MIN)) : null);

// FLIGHT 하나의 진행(순수). OUT이 없으면 막대가 없다(null)
export function progressOf(inp: ProgressInput, now: number): FlightProgress | null {
  const m = inp.milestones;
  if (!m.out) return null;
  const standFree = inp.arrivedWithoutPr && !m.off && !m.on;
  let segment: Segment;
  let since: string | null;
  if (standFree) {
    segment = "done";
    since = null;
  } else if (m.in || (m.on && !inp.awaitsRts)) {
    segment = "done";
    since = null;
  } else if (m.on) {
    segment = "rts";
    since = m.on;
  } else if (m.off) {
    segment = "landing";
    since = m.off;
  } else {
    segment = "work";
    since = m.out;
  }
  const idx = SEGMENTS.indexOf(segment);
  if (segment === "done") return { segment, elapsedMin: null, typical: null, late: false, marker: null, standFree };
  const elapsedMin = minutesSince(since, now);
  const typical = segment === "work" ? inp.typical.work : segment === "landing" ? inp.typical.landing : null;
  const late = Boolean(typical && elapsedMin !== null && elapsedMin > typical.p75);
  const frac = typical && elapsedMin !== null && typical.p75 > 0 ? Math.min(1, elapsedMin / typical.p75) : 0;
  return { segment, elapsedMin, typical, late, marker: (idx + frac) / 4, standFree };
}

// ── 글 ──

export const SEGMENT_LABEL: Record<Segment, string> = { work: "작업", landing: "착륙 대기", rts: "RTS 대기", done: "완료" };

export function minText(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`;
}
const rangeText = (t: Typical) => {
  const a = Math.round(t.p25);
  const b = Math.round(t.p75);
  return a <= 60 && b <= 60 ? `${a}–${b}분` : `${minText(a)}–${minText(b)}`;
};

// 막대 옆 한 줄: "작업 42분 · 보통 30–60분 (BUILD·M, n=12)" · "작업 42분 · 데이터 부족" · "RTS 대기 5분"
export function progressText(p: FlightProgress | null): string {
  if (!p) return "";
  if (p.segment === "done") return SEGMENT_LABEL.done;
  const head = `${SEGMENT_LABEL[p.segment]} ${p.elapsedMin === null ? "—" : minText(p.elapsedMin)}`;
  if (p.segment === "rts") return head;
  return p.typical ? `${head} · 보통 ${rangeText(p.typical)} (${p.typical.group}, n=${p.typical.n})${p.late ? " · 길어짐" : ""}` : `${head} · 데이터 부족`;
}

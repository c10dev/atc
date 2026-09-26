import type { Hono } from "hono";
import { allClearances } from "./clearances.ts";
import type { Clearance, TrafficEvent } from "./model.ts";
import { type RecordLine, readRecords, type Sample } from "./recorder.ts";

// 운용 지표. FLIGHT RECORDER 기록과 CLEARANCE 기록을 집계한다(순수 함수 computeMetrics).
// 2단계(DISPATCH)로 넘어갈지 판단하는 근거로 쓴다.

const MIN = 60_000;
const DAY = 86_400_000;
const OVERDUE_MS = 10 * MIN;
const SHORT_CONFLICT_MS = 5 * MIN; // 이보다 빨리 풀린 충돌은 오경보였을 가능성이 크다
const MAX_POINTS = 240;

// 2단계 진입 제안 기준. 운용해 보며 조정한다.
export const READINESS = {
  towerDays: 3, // TOWER가 브리핑을 처리한 날
  readbackRate: 0.9,
  readbackMedianMin: 5,
  shortConflictShare: 0.3,
  minClearances: 5, // 이보다 적으면 READBACK 지표는 "데이터 부족"
  minConflicts: 3,
};

type Status = "pass" | "fail" | "insufficient";

export interface Readiness {
  id: string;
  label: string;
  value: string;
  target: string;
  status: Status;
}

export interface DailyRow {
  date: string;
  conflicts: number;
  handoffs: number;
  clearances: number;
  readBack: number;
  landings: number;
  lost: number;
  towerActive: boolean;
}

export interface SeriesPoint extends Sample {
  t: string;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
const day = (iso: string) => iso.slice(0, 10);
// LANDING SEQUENCE 한 건: PR(저장소#번호). PR 이전 기록(Linear Ready to Merge)은 티켓 key.
const landingKey = (e: TrafficEvent) => (e.repo && e.pull ? `${e.repo}#${e.pull}` : (e.ticketKey ?? null));

// 발생 → 해소 짝짓기. key가 같은 다음 cleared/left 이벤트가 끝이다. 끝이 없으면 아직 열려 있다.
function spans(events: TrafficEvent[], start: (e: TrafficEvent) => string | null, end: (e: TrafficEvent) => string | null, now: number) {
  const open = new Map<string, number>();
  const done: { key: string; startedAt: number; ms: number }[] = [];
  for (const e of events) {
    const s = start(e);
    if (s && !open.has(s)) open.set(s, Date.parse(e.at));
    const k = end(e);
    if (k && open.has(k)) {
      const startedAt = open.get(k)!;
      done.push({ key: k, startedAt, ms: Date.parse(e.at) - startedAt });
      open.delete(k);
    }
  }
  return { done, open: [...open].map(([key, startedAt]) => ({ key, startedAt, ms: now - startedAt })) };
}

// 너무 많은 표본은 구간 평균으로 줄인다.
function downsample(points: SeriesPoint[]): SeriesPoint[] {
  if (points.length <= MAX_POINTS) return points;
  const size = Math.ceil(points.length / MAX_POINTS);
  const out: SeriesPoint[] = [];
  for (let i = 0; i < points.length; i += size) {
    const chunk = points.slice(i, i + size);
    const avg = (k: keyof Sample) => round1(chunk.reduce((a, p) => a + p[k], 0) / chunk.length)!;
    out.push({
      t: chunk[chunk.length - 1].t,
      airborne: avg("airborne"),
      holding: avg("holding"),
      claims: avg("claims"),
      conflicts: avg("conflicts"),
      alerts: avg("alerts"),
      landing: avg("landing"),
      pendingClearances: avg("pendingClearances"),
    });
  }
  return out;
}

export function computeMetrics(records: RecordLine[], clearances: Clearance[], now: number, days: number) {
  const since = now - days * DAY;
  const inRange = (iso: string) => Date.parse(iso) >= since && Date.parse(iso) <= now;
  const events = records
    .filter((r): r is Extract<RecordLine, { kind: "event" }> => r.kind === "event" && inRange(r.t))
    .map((r) => r.event)
    .sort((a, b) => a.at.localeCompare(b.at));
  const acks = records.filter((r) => r.kind === "ack" && inRange(r.t));
  const series = downsample(
    records
      .filter((r): r is Extract<RecordLine, { kind: "sample" }> => r.kind === "sample" && inRange(r.t))
      .map(({ kind: _kind, ...p }) => p)
      .sort((a, b) => a.t.localeCompare(b.t)),
  );

  const conflictKey = (e: TrafficEvent) => `${e.alertKind}|${e.workspacePath ?? ""}|${e.ticketKey ?? ""}`;
  const conflicts = spans(
    events,
    (e) => (e.kind === "alert.raised" && e.alertKind === "conflict" ? conflictKey(e) : null),
    (e) => (e.kind === "alert.cleared" && e.alertKind === "conflict" ? conflictKey(e) : null),
    now,
  );
  const landings = spans(
    events,
    (e) => (e.kind === "landing.requested" ? landingKey(e) : null),
    (e) => (e.kind === "landing.left" ? landingKey(e) : null),
    now,
  );
  const count = (kind: TrafficEvent["kind"], alertKind?: string) =>
    events.filter((e) => e.kind === kind && (!alertKind || e.alertKind === alertKind)).length;

  const issued = clearances.filter((c) => inRange(c.at));
  const readBack = issued.filter((c) => c.readbackAt);
  const readbackMs = readBack.map((c) => Date.parse(c.readbackAt!) - Date.parse(c.at));
  const overdue = issued.filter(
    (c) => !c.cancelledAt && (c.readbackAt ? Date.parse(c.readbackAt) - Date.parse(c.at) > OVERDUE_MS : now - Date.parse(c.at) > OVERDUE_MS),
  );
  const answerable = issued.filter((c) => !c.cancelledAt);
  const readbackRate = answerable.length ? answerable.filter((c) => c.readbackAt).length / answerable.length : null;
  const byType: Record<string, number> = {};
  for (const c of issued) byType[c.type] = (byType[c.type] ?? 0) + 1;

  const allConflicts = [...conflicts.done, ...conflicts.open];
  const shortShare = conflicts.done.length ? conflicts.done.filter((x) => x.ms < SHORT_CONFLICT_MS).length / conflicts.done.length : null;
  const towerDays = new Set(acks.map((a) => day(a.t)));

  const daily: DailyRow[] = [];
  for (let t = now - (days - 1) * DAY; t <= now; t += DAY) {
    const d = day(new Date(t).toISOString());
    const dayIssued = issued.filter((c) => day(c.at) === d);
    daily.push({
      date: d,
      conflicts: allConflicts.filter((x) => day(new Date(x.startedAt).toISOString()) === d).length,
      handoffs: events.filter((e) => e.kind === "handoff" && day(e.at) === d).length,
      clearances: dayIssued.length,
      readBack: dayIssued.filter((c) => c.readbackAt).length,
      landings: landings.done.filter((x) => day(new Date(x.startedAt + x.ms).toISOString()) === d).length,
      lost: events.filter((e) => e.kind === "session.lost" && day(e.at) === d).length,
      towerActive: towerDays.has(d),
    });
  }

  const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
  const minutes = (ms: number | null) => (ms === null ? "—" : `${round1(ms / MIN)}분`);
  const readbackMedian = median(readbackMs);
  const readiness: Readiness[] = [
    {
      id: "tower-days",
      label: "TOWER 운용 일수",
      value: `${towerDays.size}일`,
      target: `≥ ${READINESS.towerDays}일`,
      status: towerDays.size >= READINESS.towerDays ? "pass" : "fail",
    },
    {
      id: "readback-rate",
      label: "READBACK 비율",
      value: pct(readbackRate),
      target: `≥ ${READINESS.readbackRate * 100}%`,
      status: answerable.length < READINESS.minClearances ? "insufficient" : readbackRate! >= READINESS.readbackRate ? "pass" : "fail",
    },
    {
      id: "readback-median",
      label: "READBACK까지 걸린 시간(중앙값)",
      value: minutes(readbackMedian),
      target: `≤ ${READINESS.readbackMedianMin}분`,
      status: readBack.length < READINESS.minClearances ? "insufficient" : readbackMedian! <= READINESS.readbackMedianMin * MIN ? "pass" : "fail",
    },
    {
      id: "short-conflicts",
      label: "5분 안에 풀린 충돌 비율(오경보 추정)",
      value: pct(shortShare),
      target: `≤ ${READINESS.shortConflictShare * 100}%`,
      status: conflicts.done.length < READINESS.minConflicts ? "insufficient" : shortShare! <= READINESS.shortConflictShare ? "pass" : "fail",
    },
  ];

  return {
    range: { from: new Date(since).toISOString(), to: new Date(now).toISOString(), days },
    recording: { since: records[0]?.t ?? null, samples: series.length },
    conflicts: {
      count: allConflicts.length,
      open: conflicts.open.length,
      medianMin: conflicts.done.length ? round1(median(conflicts.done.map((x) => x.ms))! / MIN) : null,
      shortShare,
    },
    handoffs: count("handoff"),
    clearances: {
      issued: issued.length,
      byType,
      readBack: readBack.length,
      readbackRate,
      readbackMedianMin: readbackMedian === null ? null : round1(readbackMedian / MIN),
      overdue: overdue.length,
      cancelled: issued.filter((c) => c.cancelledAt).length,
    },
    landing: {
      requests: count("landing.requested"),
      landed: landings.done.length,
      waiting: landings.open.length,
      medianWaitMin: landings.done.length ? round1(median(landings.done.map((x) => x.ms))! / MIN) : null,
      maxWaitMin: landings.done.length ? round1(Math.max(...landings.done.map((x) => x.ms)) / MIN) : null,
    },
    lost: count("session.lost"),
    away: count("away.started"),
    noContact: count("alert.raised", "no-workspace"),
    unattended: count("alert.raised", "unattended"),
    towerDays: towerDays.size,
    readiness,
    daily,
    series,
  };
}

export type Metrics = ReturnType<typeof computeMetrics>;

export function mountMetrics(app: Hono) {
  app.get("/api/metrics", (c) => {
    const days = Math.min(30, Math.max(1, Number(c.req.query("days")) || 7));
    const now = Date.now();
    return c.json(computeMetrics(readRecords(now - days * DAY), allClearances(), now, days));
  });
}

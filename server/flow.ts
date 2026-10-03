import type { RecordLine } from "./recorder.ts";

// FLOW(ATC-468): 일이 어디서 시간을 쓰는지 보는 숫자. 순수 함수만(읽고 쓰는 것은 metrics.ts, jobs/ticket-state.ts, jobs/sample.ts).
// - idle-empty-min: 놀고 있는(available) AIRCRAFT가 있는데 기다리는 Todo FLIGHT가 없던 분. 5분 표본의 두 칸(available, waiting)에서 센다
// - created-todo, todo-release, release-launch: 이슈 하나가 지나는 세 구간의 중앙값

export const FLOW_NAMES = ["idle-empty-min", "created-todo", "todo-release", "release-launch"] as const;
export type FlowName = (typeof FLOW_NAMES)[number];
export const STRETCH_NAMES = ["created-todo", "todo-release", "release-launch"] as const;
export type StretchName = (typeof STRETCH_NAMES)[number];
export const isFlowName = (s: string): s is FlowName => (FLOW_NAMES as readonly string[]).includes(s.toLowerCase());

const MIN = 60_000;
export const SAMPLE_MINUTES = 5; // recorder.SAMPLE_MS와 같다. 표본 하나가 대표하는 분
export const BORN_MS = 10 * MIN; // 처음 본 이슈의 만든 시각이 이 안이면 그 상태로 태어난 것으로 본다(서버가 Linear를 60초마다 읽는다)

// ── 표본에 싣는 두 사실(signalsOf가 읽는 것과 같다) ──
export interface PlanFacts {
  available: number; // 배정 받을 수 있는 놀고 있는 AIRCRAFT 수
  waiting: number; // 일감이 있는데 아직 배정되지 않은 Todo FLIGHT 수
}
// ── Linear 상태 변화(FLIGHT RECORDER `ticket` 줄) ──
export type TicketLine = Extract<RecordLine, { kind: "ticket" }>;
export interface TicketLike {
  key: string;
  state: string;
  createdAt: string | null;
}

// 지난 상태(prev)와 지금을 견줘 줄을 만든다. prev에 없는 이슈는 BORN_MS 안에 만들어졌을 때만 from null로 적는다(그렇지 않으면 처음 보는 것이라 바뀐 때를 모른다).
// prev를 새 상태로 갱신해 돌려준다(호출한 쪽이 다음에 다시 넣는다)
export function stateChangesOf(prev: ReadonlyMap<string, string>, tickets: readonly TicketLike[], now: number): { lines: TicketLine[]; next: Map<string, string> } {
  const lines: TicketLine[] = [];
  const next = new Map(prev); // 읽기가 잠깐 비었다 돌아온 이슈의 지난 상태를 잃지 않게 덮어쓰기만 한다
  const t = new Date(now).toISOString();
  for (const k of tickets) {
    next.set(k.key, k.state);
    const was = prev.get(k.key);
    if (was === undefined) {
      const born = k.createdAt ? now - Date.parse(k.createdAt) : Infinity;
      if (born >= 0 && born <= BORN_MS) lines.push({ t, kind: "ticket", op: "state", key: k.key, from: null, to: k.state });
    } else if (was !== k.state) lines.push({ t, kind: "ticket", op: "state", key: k.key, from: was, to: k.state });
  }
  return { lines, next };
}

// ── 구간 ──
export type StretchSource = "record" | "substitute";
export interface Stretch {
  key: string;
  name: StretchName;
  startMs: number;
  endMs: number; // 이 구간을 마친 시각(기간에 드는지는 이것으로 본다)
  ms: number;
  source: StretchSource; // record: 서버가 본 상태 변화나 기존 기록이 그대로. substitute: 만든 시각으로 대신함(todo-release만)
}
export interface FlowInput {
  tickets: readonly { key: string; createdAt: string | null }[];
  ticketLines: readonly TicketLine[];
  releases: readonly { flight: string; at: string }[]; // releases.jsonl의 release 줄
  launches: readonly { flight: string; t: string }[]; // fleet launch 줄 가운데 ok이고 flight가 있는 것
}

const isTodo = (s: string) => s.toLowerCase() === "todo";

// 이슈마다 세 구간을 계산한다. 마치지 못한 구간은 없다. 시계가 거꾸로 간 구간(음수)도 없다
export function stretchesOf(input: FlowInput): Stretch[] {
  const out: Stretch[] = [];
  const linesBy = new Map<string, TicketLine[]>();
  for (const l of [...input.ticketLines].sort((a, b) => a.t.localeCompare(b.t))) {
    const a = linesBy.get(l.key) ?? [];
    a.push(l);
    linesBy.set(l.key, a);
  }
  const relBy = new Map<string, number[]>();
  for (const r of input.releases) {
    const a = relBy.get(r.flight) ?? [];
    a.push(Date.parse(r.at));
    relBy.set(r.flight, a);
  }
  const launchBy = new Map<string, number[]>();
  for (const l of input.launches) {
    const a = launchBy.get(l.flight) ?? [];
    a.push(Date.parse(l.t));
    launchBy.set(l.flight, a);
  }
  const push = (key: string, name: StretchName, startMs: number, endMs: number, source: StretchSource) => {
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) out.push({ key, name, startMs, endMs, ms: endMs - startMs, source });
  };
  for (const tk of input.tickets) {
    const created = tk.createdAt ? Date.parse(tk.createdAt) : NaN;
    if (!Number.isFinite(created)) continue;
    // Todo가 된 처음 때: 태어날 때부터 Todo면 만든 시각, 아니면 서버가 본 처음 변화
    const first = (linesBy.get(tk.key) ?? []).find((l) => isTodo(l.to));
    const todoAt = first ? (first.from === null ? created : Date.parse(first.t)) : null;
    if (todoAt !== null) push(tk.key, "created-todo", created, todoAt, "record");
    // Todo 뒤 첫 발권. Todo가 된 때를 모르면 만든 시각으로 대신한다
    const startMs = todoAt ?? created;
    const rels = (relBy.get(tk.key) ?? []).filter((r) => r >= startMs).sort((a, b) => a - b);
    const release = rels[0];
    if (release !== undefined) push(tk.key, "todo-release", startMs, release, todoAt !== null ? "record" : "substitute");
    // 발권 뒤 첫 성공한 LAUNCH. Todo 뒤 발권이 없으면 그 이슈의 첫 발권부터
    const from = release ?? (relBy.get(tk.key) ?? []).sort((a, b) => a - b)[0];
    if (from !== undefined) {
      const launch = (launchBy.get(tk.key) ?? []).filter((l) => l >= from).sort((a, b) => a - b)[0];
      if (launch !== undefined) push(tk.key, "release-launch", from, launch, "record");
    }
  }
  return out;
}

// ── 중앙값 ──
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const round1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
export interface StretchStat {
  n: number;
  medianMin: number | null;
  record: { n: number; medianMin: number | null };
  substitute: { n: number; medianMin: number | null };
}
// 끝난 때가 [from, to)에 드는 구간만
export function stretchStat(all: readonly Stretch[], name: StretchName, from: number, to: number): StretchStat {
  const xs = all.filter((s) => s.name === name && s.endMs >= from && s.endMs < to);
  const m = (a: Stretch[]) => ({ n: a.length, medianMin: round1(median(a.map((s) => s.ms / MIN))) });
  return { ...m(xs), record: m(xs.filter((s) => s.source === "record")), substitute: m(xs.filter((s) => s.source === "substitute")) };
}

// ── 놀고-큐가 빈 분 ──
export interface SampleRow {
  t: string;
  available?: number;
  waiting?: number;
}
export const sampleRowsOf = (records: readonly RecordLine[]): SampleRow[] =>
  records.flatMap((r) => (r.kind === "sample" ? [{ t: r.t, available: r.available, waiting: r.waiting }] : []));

// 두 칸이 모두 있는 표본만 센다(옛 표본은 "기록 안 됨"이지 0이 아니다)
export const hasFacts = (s: SampleRow): s is SampleRow & PlanFacts => typeof s.available === "number" && typeof s.waiting === "number";
export const idleEmptyAt = (samples: readonly SampleRow[]): number[] => samples.filter(hasFacts).filter((s) => s.available > 0 && s.waiting === 0).map((s) => Date.parse(s.t));

export interface IdleStat {
  minutes: number | null; // 기록된 표본이 하나도 없으면 null
  recordedSamples: number;
  unrecordedSamples: number; // 두 칸이 없는 옛 표본
  recordedSince: string | null;
}
export function idleStat(samples: readonly SampleRow[], from: number, to: number): IdleStat {
  const inRange = samples.filter((s) => {
    const t = Date.parse(s.t);
    return t >= from && t < to;
  });
  const rec = inRange.filter(hasFacts);
  const since = samples.filter(hasFacts).map((s) => s.t).sort()[0] ?? null;
  return {
    minutes: rec.length ? idleEmptyAt(rec).length * SAMPLE_MINUTES : null,
    recordedSamples: rec.length,
    unrecordedSamples: inRange.length - rec.length,
    recordedSince: since,
  };
}

// FLIGHT RECORDER 줄과 발권 줄에서 FlowInput을 만든다(순수)
export function flowInputOf(records: readonly RecordLine[], tickets: readonly { key: string; createdAt: string | null }[], releaseLines: readonly { op: string; flight?: string; at?: string }[]): FlowInput {
  return {
    tickets,
    ticketLines: records.filter((r): r is TicketLine => r.kind === "ticket" && r.op === "state"),
    releases: releaseLines.flatMap((l) => (l.op === "release" && l.flight && l.at ? [{ flight: l.flight, at: l.at }] : [])),
    launches: records.flatMap((r) => (r.kind === "fleet" && r.op === "launch" && r.ok && r.flight ? [{ flight: r.flight, t: r.t }] : [])),
  };
}

// ── 평결에 쓰는 데이터(effect-check.ts가 읽는다) ──
export interface FlowData {
  idleAt: readonly number[]; // 놀고-큐가 빈 표본의 시각(ms)
  stretches: readonly Stretch[];
  coverage: Readonly<Record<FlowName, number | null>>; // 이름마다 기록이 시작된 가장 이른 때(ms). 없으면 null
}
const minOf = (xs: readonly number[]) => (xs.length ? Math.min(...xs) : null);
export function flowDataOf(input: FlowInput, samples: readonly SampleRow[]): FlowData {
  const stretches = stretchesOf(input);
  const relFirst = minOf(input.releases.map((r) => Date.parse(r.at)).filter(Number.isFinite));
  const created = minOf(input.tickets.flatMap((t) => (t.createdAt ? [Date.parse(t.createdAt)] : [])).filter(Number.isFinite));
  const lineFirst = minOf(input.ticketLines.map((l) => Date.parse(l.t)).filter(Number.isFinite));
  const sampleFirst = minOf(samples.filter(hasFacts).map((s) => Date.parse(s.t)));
  return {
    idleAt: idleEmptyAt(samples),
    stretches,
    coverage: {
      "idle-empty-min": sampleFirst,
      "created-todo": lineFirst,
      // 만든 시각이 있는 가장 이른 이슈와 가장 이른 발권 중 늦은 쪽부터 센다
      "todo-release": relFirst === null || created === null ? null : Math.max(relFirst, created),
      "release-launch": relFirst,
    },
  };
}

// ── METRICS 화면의 모양 ──
export interface FlowView {
  recordedSince: { ticketLines: string | null; samples: string | null };
  idleEmpty: IdleStat;
  stretches: Record<StretchName, StretchStat>;
}
export function flowViewOf(input: FlowInput, samples: readonly SampleRow[], from: number, to: number): FlowView {
  const all = stretchesOf(input);
  const lines = [...input.ticketLines].map((l) => l.t).sort();
  const idle = idleStat(samples, from, to);
  return {
    recordedSince: { ticketLines: lines[0] ?? null, samples: idle.recordedSince },
    idleEmpty: idle,
    stretches: {
      "created-todo": stretchStat(all, "created-todo", from, to),
      "todo-release": stretchStat(all, "todo-release", from, to),
      "release-launch": stretchStat(all, "release-launch", from, to),
    },
  };
}

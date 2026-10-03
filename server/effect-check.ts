import { type FlowData, type FlowName, isFlowName, SAMPLE_MINUTES, stretchStat, type StretchName } from "./flow.ts";
import type { LeakRecord } from "./leaks.ts";

// EFFECT CHECK(ATC-402, docs/autonomy.md 원칙 7): 작업 지시서가 `## Measure`에 적은 것을 배포 앞뒤로 비교해 FLIGHT마다 평결 하나를 남긴다. 순수 함수만.
// 읽고 쓰는 것은 effect-check-run.ts. 측정은 atc가 이미 기록하는 것만: leak(건수·붙잡은 분), misfire, 알림 종류별 발생 수, CLEARANCE 종류별 수,
// flow(ATC-468: 놀고-큐가 빈 분의 합, 이슈가 지나는 세 구간의 중앙값. flow.ts).

// ── ## Measure ──
export const MEASURE_SOURCES = ["leak", "leak-minutes", "misfire", "alert", "clearance", "flow"] as const;
export type MeasureSource = (typeof MEASURE_SOURCES)[number];
export type CountSource = Exclude<MeasureSource, "flow">; // 세는 종류. flow는 분과 중앙값이라 따로 읽는다
export interface Measure {
  source: MeasureSource;
  name: string; // leak: 종류(PROPOSAL…), misfire: dispatch, alert: alertKind, clearance: 종류(FIX…), flow: idle-empty-min | created-todo | todo-release | release-launch
  direction: "down" | "up";
  windowDays: number;
}
export type MeasureParse = { kind: "measure"; measure: Measure } | { kind: "none" } | { kind: "missing" } | { kind: "invalid"; reason: string };
export const WINDOW_MAX_DAYS = 30;
export const NAME_MAX = 32;
const NAME_RE = new RegExp(`^[A-Za-z0-9][A-Za-z0-9 _:-]{0,${NAME_MAX - 1}}$`);

// 본문의 `## Measure` 절(다음 `#` 제목 앞까지). 없으면 null
export function measureSectionOf(description: string | null | undefined): string | null {
  const lines = (description ?? "").split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}\s*measure\s*$/i.test(l.trim()));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,6}\s/.test(l.trim()));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}

// 절의 글: `None`이면 잴 것이 없다. 아니면 줄마다 `metric: <source>:<name>`, `direction: down|up`, `window: <n>d`(글머리 `*`·`-` 가능)
export function measureOf(description: string | null | undefined): MeasureParse {
  const sec = measureSectionOf(description);
  if (sec === null) return { kind: "missing" };
  const text = sec.replace(/^[\s*-]+|[\s*-]+$/g, "");
  if (!text || /^none\.?$/i.test(text)) return { kind: "none" };
  const field = (k: string) => new RegExp(`^[\\s*-]*${k}\\s*:\\s*(.+?)\\s*$`, "im").exec(sec)?.[1]?.replace(/^`|`$/g, "").trim();
  const metric = field("metric");
  const dir = field("direction")?.toLowerCase();
  const win = field("window");
  if (!metric) return { kind: "invalid", reason: "metric이 없음(예: metric: leak:PROPOSAL)" };
  const [src, ...nameParts] = metric.split(":");
  const name = nameParts.join(":").trim();
  if (!(MEASURE_SOURCES as readonly string[]).includes(src.toLowerCase())) return { kind: "invalid", reason: `모르는 측정 종류 ${src}(${MEASURE_SOURCES.join("·")})` };
  if (!name) return { kind: "invalid", reason: "metric에 이름이 없음(source:name)" };
  if (src.toLowerCase() === "flow" && !isFlowName(name)) return { kind: "invalid", reason: `모르는 flow 이름 ${name}(idle-empty-min·created-todo·todo-release·release-launch)` };
  if (!NAME_RE.test(name)) return { kind: "invalid", reason: `metric 이름은 글자·숫자·-·_·:·공백 ${NAME_MAX}자까지` }; // 본문의 글이 DUTY REVIEW 프롬프트에 산문으로 들어가지 못하게
  if (dir !== "down" && dir !== "up") return { kind: "invalid", reason: "direction은 down 또는 up" };
  const w = /^(\d{1,2})\s*d(ays?)?$/i.exec(win ?? "");
  const windowDays = w ? Number(w[1]) : 0;
  if (windowDays < 1 || windowDays > WINDOW_MAX_DAYS) return { kind: "invalid", reason: `window는 1d~${WINDOW_MAX_DAYS}d` };
  const source = src.toLowerCase() as MeasureSource;
  return { kind: "measure", measure: { source, name: source === "flow" ? name.toLowerCase() : name, direction: dir, windowDays } };
}
export const measureText = (m: Measure) => `${m.source}:${m.name} ${m.direction} ${m.windowDays}d`;

// ── 세기 ──
const DAY = 86_400_000;
export interface EffectData {
  leaks: readonly LeakRecord[]; // leaks.jsonl
  misfires: readonly { at: string }[]; // 자동 승인한 날 + 틀렸다고 드러난 카드(misfire.ts)의 승인 시각
  alerts: readonly { at: string; kind: string }[]; // FLIGHT RECORDER alert.raised
  clearances: readonly { at: string; type: string }[];
  // 그 종류의 기록이 시작된 가장 이른 시각(ms). 없으면 null. 그 앞은 "기록이 없었다"가 아니라 "몰랐다"라 평결이 too little data가 된다
  coverageFrom: Readonly<Record<CountSource, number | null>>;
  flow?: FlowData; // flow 측정에 쓰는 것(없으면 flow는 too little data)
}

const inWin = (iso: string, from: number, to: number) => {
  const t = Date.parse(iso);
  return t >= from && t < to;
};
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// [from, to)의 값
export function countOf(m: Pick<Measure, "source" | "name">, d: EffectData, from: number, to: number): number {
  switch (m.source) {
    case "flow":
      return flowValueOf(m.name, d, from, to).value ?? 0;
    case "leak":
      return d.leaks.filter((r) => r.ev === "open" && same(r.kind, m.name) && inWin(r.t, from, to)).length;
    case "leak-minutes": {
      const opens = new Map(d.leaks.flatMap((r) => (r.ev === "open" ? [[`${r.id}|${r.since}`, r.kind] as const] : [])));
      return d.leaks.reduce((n, r) => (r.ev === "close" && same(opens.get(`${r.id}|${r.since}`) ?? "", m.name) && inWin(r.t, from, to) ? n + r.heldMin : n), 0);
    }
    case "misfire":
      return d.misfires.filter((x) => inWin(x.at, from, to)).length;
    case "alert":
      return d.alerts.filter((a) => same(a.kind, m.name) && inWin(a.at, from, to)).length;
    case "clearance":
      return d.clearances.filter((c) => same(c.type, m.name) && inWin(c.at, from, to)).length;
  }
}

// flow 값: idle-empty-min은 그 창의 분 합계(n은 표본 수), 세 구간은 끝난 이슈들의 중앙값(분, n은 이슈 수). 하나도 없으면 value null
export function flowValueOf(name: string, d: Pick<EffectData, "flow">, from: number, to: number): { value: number | null; n: number } {
  const f = d.flow;
  if (!f || !isFlowName(name)) return { value: null, n: 0 };
  const n0 = name.toLowerCase() as FlowName;
  if (n0 === "idle-empty-min") {
    const n = f.idleAt.filter((t) => t >= from && t < to).length;
    return { value: n * SAMPLE_MINUTES, n };
  }
  const st = stretchStat(f.stretches, n0 as StretchName, from, to);
  return { value: st.medianMin, n: st.n };
}

// ── 평결 ──
export const VERDICTS = ["improved", "not improved", "worse", "too little data"] as const;
export type Verdict = (typeof VERDICTS)[number];
export const MIN_BASELINE = 3; // down: 앞 구간에 이만큼은 있어야 줄었는지 말할 수 있다. up: 앞뒤를 합쳐 이만큼
export const CHANGE_SHARE = 0.2; // 20% 이상 움직여야 움직인 것이다(그리고 하나 이상)

export interface Judged {
  verdict: Verdict;
  before: number;
  after: number;
  reason: string;
}
export function judge(m: Measure, deployedAt: number, d: EffectData): Judged {
  const w = m.windowDays * DAY;
  let before = countOf(m, d, deployedAt - w, deployedAt);
  let after = countOf(m, d, deployedAt, deployedAt + w);
  const cov = m.source === "flow" ? (d.flow?.coverage[m.name.toLowerCase() as FlowName] ?? null) : d.coverageFrom[m.source];
  const j = (verdict: Verdict, reason: string): Judged => ({ verdict, before, after, reason });
  if (cov === null || cov > deployedAt - w) return j("too little data", "그 기록이 앞 구간 전체를 덮지 않는다");
  // 구간 중앙값: 앞뒤 창 모두 이슈가 MIN_BASELINE 이상이어야 중앙값을 견줄 수 있다. 그 밖은 아래 20% 규칙을 그대로 쓴다
  const isMedian = m.source === "flow" && m.name.toLowerCase() !== "idle-empty-min";
  if (isMedian) {
    const b = flowValueOf(m.name, d, deployedAt - w, deployedAt);
    const a = flowValueOf(m.name, d, deployedAt, deployedAt + w);
    before = b.value ?? 0;
    after = a.value ?? 0;
    if (b.n < MIN_BASELINE || a.n < MIN_BASELINE) return j("too little data", `중앙값에 쓸 이슈가 앞 ${b.n}건·뒤 ${a.n}건뿐(각각 ${MIN_BASELINE}건 이상이어야 한다)`);
  }
  if (m.direction === "down") {
    if (!isMedian && before < MIN_BASELINE) return j("too little data", `앞 구간에 ${before}건뿐(${MIN_BASELINE}건 이상이어야 줄었는지 알 수 있다)`);
    if (after <= before * (1 - CHANGE_SHARE) && before - after >= 1) return j("improved", "줄었다");
    if (after >= before * (1 + CHANGE_SHARE) && after - before >= 1) return j("worse", "늘었다");
    return j("not improved", "20% 이상 줄지 않았다");
  }
  if (!isMedian && before + after < MIN_BASELINE) return j("too little data", `앞뒤 합쳐 ${before + after}건뿐`);
  if (after >= before * (1 + CHANGE_SHARE) && after - before >= 1) return j("improved", "늘었다");
  if (after <= before * (1 - CHANGE_SHARE) && before - after >= 1) return j("worse", "줄었다");
  return j("not improved", "20% 이상 늘지 않았다");
}

// 배포한 뒤 창이 다 지났나(평결을 낼 수 있나)
export const windowElapsed = (deployedAt: number, m: Pick<Measure, "windowDays">, now: number) => now >= deployedAt + m.windowDays * DAY;

// ── 기록(effect-verdicts.jsonl, 추가만) ──
export type EffectLine =
  | { v: 1; ev: "verdict"; at: string; flight: string; release: string | null; deployedAt: string; metric: string; direction: "down" | "up"; windowDays: number; before: number; after: number; verdict: Verdict; reason: string }
  | { v: 1; ev: "mark"; at: string; flight: string; wrong: boolean };

export interface EffectVerdict {
  flight: string;
  release: string | null;
  at: string;
  deployedAt: string;
  metric: string;
  direction: "down" | "up";
  windowDays: number;
  before: number;
  after: number;
  verdict: Verdict;
  reason: string;
  wrong: boolean; // SUPERVISOR가 틀렸다고 표시했다(마지막 표시가 이긴다)
}

// FLIGHT마다 평결은 하나(처음 것). 표시는 마지막 것
export function foldEffects(lines: readonly EffectLine[]): EffectVerdict[] {
  const by = new Map<string, EffectVerdict>();
  for (const l of lines) {
    if (l.ev === "verdict") {
      if (!by.has(l.flight)) by.set(l.flight, { flight: l.flight, release: l.release, at: l.at, deployedAt: l.deployedAt, metric: l.metric, direction: l.direction, windowDays: l.windowDays, before: l.before, after: l.after, verdict: l.verdict, reason: l.reason, wrong: false });
    } else {
      const v = by.get(l.flight);
      if (v) v.wrong = l.wrong;
    }
  }
  return [...by.values()].sort((a, b) => b.at.localeCompare(a.at));
}

// misfire: SUPERVISOR가 틀렸다고 표시한 평결(원칙 5: 클릭이 아니라 늦게 드러나는 결과가 진실이지만, 평결 자체의 오류는 사람이 알려 준다)
export function misfireOf(vs: readonly EffectVerdict[]): { verdicts: number; wrong: number; share: number | null } {
  const wrong = vs.filter((v) => v.wrong).length;
  return { verdicts: vs.length, wrong, share: vs.length ? wrong / vs.length : null };
}

// 아직 열린 나쁜 평결: not improved·worse이고 틀렸다고 표시되지 않은 것. HOME과 DUTY REVIEW가 읽는다
export const openBadOf = (vs: readonly EffectVerdict[]): EffectVerdict[] => vs.filter((v) => (v.verdict === "not improved" || v.verdict === "worse") && !v.wrong);

export const effectLine = (v: Pick<EffectVerdict, "flight" | "verdict" | "metric" | "direction" | "windowDays" | "before" | "after">) =>
  `${v.flight} ${v.verdict}: ${v.metric} ${v.direction} ${v.windowDays}d, ${v.before} → ${v.after}`;

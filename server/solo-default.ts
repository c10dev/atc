import { classOf, type Wake } from "./crew.ts";

// SOLO 기본(ATC-559, docs/dispatch.md "Solo by default as built"): WAKE L·M FLIGHT는 CAPTAIN 혼자(CREW 없이) 난다.
// CREW는 WAKE H·J나 여러 영역에 걸친 일만. DISPATCH가 FLIGHT끼리 나란히 보내는 것은 그대로다.
// FLIGHT PLAN의 한 줄이 그 결정을 CAPTAIN에게 알린다(다른 AIRPORT도 이 줄로 안다). 여기는 순수 함수만. 입출력은 solo-default-run.ts·solo-default-switch.ts

export type CrewCall = "SOLO" | "CREW";
export interface CrewPlan {
  call: CrewCall;
  wake: Wake;
  why: "wake" | "multi-area" | null; // CREW인 까닭. SOLO면 null
  areas: string[]; // multi-area일 때 그 영역들
}

// ── multi-area ──
// 여러 영역: Linear `Area` 라벨 그룹의 서로 다른 라벨이 둘 이상(`Area:Web`, `Area:Database`),
// 또는 DOCS가 아닌 TYPE RATING(UI·DATA·SEC, `Risk:*`는 SEC)이 둘 이상. 둘을 섞어 세지 않는다(`Area:Web` + `rating:UI`는 한 영역일 수 있다)
export function areasOf(labels: readonly string[]): string[] {
  const areas = new Set<string>();
  for (const raw of labels) {
    const m = /^([^:]+):\s*(.+)$/.exec(raw.trim());
    if (m && m[1].trim().toLowerCase() === "area") areas.add(m[2].trim());
  }
  if (areas.size >= 2) return [...areas].sort();
  const ratings = classOf([...labels]).ratings.filter((r) => r !== "DOCS");
  return ratings.length >= 2 ? ratings : [];
}

// 라벨 → SOLO·CREW. 스위치가 꺼졌으면 null(오늘처럼 줄을 넣지 않는다). 라벨이 없으면 classOf의 기본 WAKE M → SOLO
export function crewPlanOf(labels: readonly string[] | null | undefined, enabled: boolean): CrewPlan | null {
  if (!enabled) return null;
  const wake = classOf([...(labels ?? [])]).wake;
  if (wake === "H" || wake === "J") return { call: "CREW", wake, why: "wake", areas: [] };
  const areas = areasOf(labels ?? []);
  if (areas.length) return { call: "CREW", wake, why: "multi-area", areas };
  return { call: "SOLO", wake, why: null, areas: [] };
}

// Linear 이슈 상세(fetchIssueDetail)의 라벨 → "그룹:이름"(sources/linear.ts의 스냅샷 라벨과 같은 꼴). 없으면 빈 목록
export function detailLabelsOf(detail: unknown): string[] {
  const nodes = (detail as { labels?: { nodes?: unknown } } | null)?.labels?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.flatMap((n) => {
    const l = n as { name?: unknown; parent?: { name?: unknown } | null };
    if (typeof l?.name !== "string") return [];
    return [typeof l.parent?.name === "string" && l.parent.name ? `${l.parent.name}:${l.name}` : l.name];
  });
}

// FLIGHT PLAN·DIRECT 지시서의 한 줄(세션끼리 주고받는 글이라 영어, ATC-126)
export const SOLO_RULE = "fly this FLIGHT as a solo CAPTAIN. Implement it yourself, with no CREW; subagents may search or review but do not write code. If it turns out to need CREW, add it and say why under Pilot's discretion in the PR.";
export const CREW_RULE = "you may split the implementation across your CREW COMPLEMENT.";
export function crewLineOf(plan: CrewPlan | null): string | null {
  if (!plan) return null;
  if (plan.call === "SOLO") return `SOLO (WAKE ${plan.wake}): ${SOLO_RULE}`;
  const why = plan.why === "multi-area" ? `multi-area: ${plan.areas.join(", ")}` : `WAKE ${plan.wake}`;
  return `CREW (${why}): ${CREW_RULE}`;
}
// 보낸 FLIGHT PLAN이 SOLO였나·CREW였나(저장된 문구에서 읽는다). 줄이 없으면(스위치 off·옛 카드) null
export function crewCallOfMessage(message: string | null | undefined): CrewCall | null {
  if (!message) return null;
  if (/^SOLO \(WAKE [A-Z]\): /m.test(message)) return "SOLO";
  if (/^CREW \((?:WAKE [A-Z]|multi-area: [^)]*)\): /m.test(message)) return "CREW";
  return null;
}

// ── 스위치 파일(solo-default.json) ──
// { default: on|off, airports: { 코드: on|off }, migrated?: { id: "ATC-559", at } }. SUPERVISOR만(설정 창).
// 파일이 없으면 on(내놓은 값), 깨졌으면 off(오늘의 동작). 모르는 값은 off. 파일에 없는 AIRPORT는 default
export const SOLO_MODES = ["on", "off"] as const;
export type SoloMode = (typeof SOLO_MODES)[number];
export const isSoloMode = (v: unknown): v is SoloMode => v === "on" || v === "off";
export const SOLO_MIGRATION_ID = "ATC-559";
export interface SoloSwitch {
  source: "ok" | "missing" | "broken";
  fallback: SoloMode;
  airports: Record<string, SoloMode>;
  migrated: { id: string; at: string } | null; // 배포 뒤 첫 시작의 시각 = 오작동 수가 비교하는 기준(앞 7일)
}
export function soloSwitchOf(raw: unknown, source: "ok" | "missing" | "broken"): SoloSwitch {
  if (source === "missing") return { source, fallback: "on", airports: {}, migrated: null };
  const off: SoloSwitch = { source: "broken", fallback: "off", airports: {}, migrated: null };
  if (source === "broken" || !raw || typeof raw !== "object" || Array.isArray(raw)) return off;
  const r = raw as { default?: unknown; airports?: unknown; migrated?: unknown };
  const airports: Record<string, SoloMode> = {};
  if (r.airports && typeof r.airports === "object" && !Array.isArray(r.airports)) {
    for (const [k, v] of Object.entries(r.airports as Record<string, unknown>)) airports[k.toUpperCase()] = isSoloMode(v) ? v : "off";
  }
  const m = r.migrated as { id?: unknown; at?: unknown } | undefined;
  return {
    source,
    fallback: r.default === undefined ? "on" : isSoloMode(r.default) ? r.default : "off",
    airports,
    migrated: m && typeof m === "object" && m.id === SOLO_MIGRATION_ID && typeof m.at === "string" ? { id: m.id, at: m.at } : null,
  };
}
// AIRPORT를 모르는 카드는 default를 따른다(대부분 on)
export function soloModeAt(sw: Pick<SoloSwitch, "fallback" | "airports">, airport: string | null | undefined): SoloMode {
  return (airport ? sw.airports[airport.toUpperCase()] : undefined) ?? sw.fallback;
}

// 배포 뒤 첫 시작에 한 번(ATC-560과 같은 꼴): 열린 AIRPORT마다 on, default on, migrated에 시각. 이미 적은 AIRPORT 값은 지킨다.
// 깨진 파일은 건드리지 않는다(off로 읽힌다). 기록이 있으면 아무것도 하지 않는다
export function upgradeSoloOnce(sw: SoloSwitch, raw: unknown, openAirports: readonly string[], at: string): Record<string, unknown> | null {
  if (sw.source === "broken" || sw.migrated) return null;
  const prev = sw.source === "ok" && raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const airports: Record<string, SoloMode> = {};
  for (const code of openAirports) airports[code.toUpperCase()] = "on";
  return { ...prev, default: prev.default ?? "on", airports: { ...airports, ...sw.airports }, migrated: { id: SOLO_MIGRATION_ID, at } };
}

// ── 오작동 수(ATC-559): AIRPORT마다 최근 7일. 화면에 보이기만 하고 스위치를 스스로 끄지 않는다 ──
// (a) SOLO로 보낸 FLIGHT인데 CAPTAIN이 CREW를 썼거나(LOGBOOK measured crew = CREW) CREW가 없어 막혔다(BLOCKED·UNABLE·SUPERVISOR 질문에 crew)
// (b) SOLO로 보낸 FLIGHT의 block time(DEPARTED → PR)이 배포 앞 7일 같은 AIRPORT·같은 WAKE 중앙값보다 길다
// (c) 착륙한 FLIGHT당 토큰(CAPTAIN + CREW, LOGBOOK fuel)의 WAKE별 중앙값: 최근 7일 대 배포 앞 7일
export const SOLO_MISFIRE_DAYS = 7;
export const SOLO_MIN_SAMPLES = 3; // 중앙값을 믿는 최소 수(logbook.ts MEDIAN_MIN_SAMPLES와 같다)
const DAY = 86_400_000;
export const CREW_WORD_RE = /\bcrews?\b/i;

export interface SoloSent {
  id: string;
  flight: string;
  airport: string | null;
  sentAt: string;
  call: CrewCall | null; // 보낸 문구의 줄. null이면 줄이 없었다
  asked: string[]; // 이 카드의 BLOCKED 보고·UNABLE 사유·SUPERVISOR 질문 글(이 FLIGHT, 보낸 뒤)
}
export interface SoloLanded {
  flight: string | null;
  airport: string | null;
  wake: Wake | null;
  departedAt: string;
  arrivedAt: string;
  blockMin: number | null;
  tokens: number | null; // fuel이 없으면 null
  crew: CrewCall | null; // measured crew
}
export interface SoloMisfireInputs {
  sent: readonly SoloSent[];
  landed: readonly SoloLanded[];
  airports: readonly string[];
  modes: Record<string, SoloMode>;
  anchor: string | null; // 배포 시각(migrated.at). 없으면 (b)·(c)의 기준이 없다
  now: number;
  days?: number;
}
export interface MedianN {
  median: number | null; // 표본이 SOLO_MIN_SAMPLES보다 적으면 null
  n: number;
}
export interface SoloMisfireRow {
  airport: string;
  mode: SoloMode;
  solo: number; // 최근 7일 SOLO로 보낸 FLIGHT PLAN
  crew: number; // CREW로 보낸 것
  tookCrew: string[]; // (a) FLIGHT 키
  slow: { over: string[]; judged: number }; // (b) 기준보다 긴 FLIGHT, 기준이 있어 잰 수
  tokens: { wake: "L" | "M" | "H"; before: MedianN; after: MedianN }[]; // (c)
  blockBaseline: { wake: "L" | "M" | "H"; before: MedianN }[];
  days: number;
}

export const medianOf = (xs: readonly number[]): MedianN => {
  if (xs.length < SOLO_MIN_SAMPLES) return { median: null, n: xs.length };
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return { median: v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2, n: xs.length };
};
const up = (s: string | null | undefined) => (s ? s.toUpperCase() : null);
const WAKES3 = ["L", "M", "H"] as const;

export function soloMisfiresOf(i: SoloMisfireInputs): SoloMisfireRow[] {
  const days = i.days ?? SOLO_MISFIRE_DAYS;
  const anchor = i.anchor ? Date.parse(i.anchor) : NaN;
  const from = Math.max(i.now - days * DAY, Number.isFinite(anchor) ? anchor : -Infinity);
  const inAfter = (t: string) => Date.parse(t) >= from && Date.parse(t) <= i.now;
  const inBefore = (t: string) => Number.isFinite(anchor) && Date.parse(t) >= anchor - days * DAY && Date.parse(t) < anchor;
  const codes = [...new Set([...i.airports.map((a) => a.toUpperCase()), ...i.sent.flatMap((p) => (inAfter(p.sentAt) && p.airport ? [p.airport.toUpperCase()] : []))])].sort();
  return codes.map((airport) => {
    const sent = i.sent.filter((p) => up(p.airport) === airport && inAfter(p.sentAt));
    const solo = sent.filter((p) => p.call === "SOLO");
    const landedHere = i.landed.filter((e) => up(e.airport) === airport);
    // 이 카드 뒤에 도착한 그 FLIGHT의 LOGBOOK 줄
    const landedOf = (p: SoloSent) => landedHere.find((e) => e.flight === p.flight && Date.parse(e.arrivedAt) >= Date.parse(p.sentAt));
    const tookCrew = solo.filter((p) => landedOf(p)?.crew === "CREW" || p.asked.some((t) => CREW_WORD_RE.test(t))).map((p) => p.flight);
    const before = landedHere.filter((e) => inBefore(e.arrivedAt));
    const baseline = new Map(WAKES3.map((w) => [w, medianOf(before.filter((e) => e.wake === w && e.blockMin !== null).map((e) => e.blockMin!))]));
    const over: string[] = [];
    let judged = 0;
    for (const p of solo) {
      const e = landedOf(p);
      if (!e || e.blockMin === null || !e.wake || e.wake === "J") continue;
      const b = baseline.get(e.wake)?.median ?? null;
      if (b === null) continue;
      judged++;
      if (e.blockMin > b) over.push(p.flight);
    }
    const after = landedHere.filter((e) => inAfter(e.arrivedAt));
    const tok = (es: readonly SoloLanded[], w: Wake) => medianOf(es.filter((e) => e.wake === w && e.tokens !== null).map((e) => e.tokens!));
    return {
      airport,
      mode: i.modes[airport] ?? "on",
      solo: solo.length,
      crew: sent.filter((p) => p.call === "CREW").length,
      tookCrew: [...new Set(tookCrew)].sort(),
      slow: { over: [...new Set(over)].sort(), judged },
      tokens: WAKES3.map((w) => ({ wake: w, before: tok(before, w), after: tok(after, w) })),
      blockBaseline: WAKES3.map((w) => ({ wake: w, before: baseline.get(w)! })),
      days,
    };
  });
}

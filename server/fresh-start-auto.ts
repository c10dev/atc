import type { SessionOrigin } from "./session-origin.ts";
import { isBackground } from "./session-origin.ts";
import { tokensShort } from "./fuel-context.ts";

// 자동 FRESH START(ATC-560, docs/fleet.md 8.6 · docs/dispatch.md): 승인된 ASSIGN을 받을 AIRCRAFT의 세션이 이미 FLIGHT를 날았으면,
// SUPERVISOR의 클릭 없이 ATC-73의 STOP → LAUNCH(CREW BRIEFING + FLIGHT PLAN이 첫 프롬프트)를 한다. 여기는 순수 함수만.
// 스위치는 AIRPORT마다 off | always | over(fresh-start.json, SUPERVISOR만). 실행·기록은 fresh-start-run.ts

export const FRESH_START_MODES = ["off", "always", "over"] as const;
export type FreshStartMode = (typeof FRESH_START_MODES)[number];
export const isFreshStartMode = (v: unknown): v is FreshStartMode => typeof v === "string" && (FRESH_START_MODES as readonly string[]).includes(v);

// ── 스위치 파일(fresh-start.json) ──
// { default: 모드, airports: { 코드: 모드 }, migrated?: { id: "ATC-560", at } }. 없거나 깨진 파일은 모두 off.
// 파일에 없는 AIRPORT는 default(없거나 모르는 값이면 off), 모르는 값은 off(오타가 세션을 멈추게 하지 않는다)
export const FRESH_START_MIGRATION_ID = "ATC-560";
export interface FreshStartSwitch {
  source: "ok" | "missing" | "broken";
  fallback: FreshStartMode;
  airports: Record<string, FreshStartMode>;
  migrated: { id: string; at: string } | null;
}
export function freshStartSwitchOf(raw: unknown, source: "ok" | "missing" | "broken"): FreshStartSwitch {
  const off: FreshStartSwitch = { source, fallback: "off", airports: {}, migrated: null };
  if (source !== "ok") return off;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...off, source: "broken" };
  const r = raw as { default?: unknown; airports?: unknown; migrated?: unknown };
  const airports: Record<string, FreshStartMode> = {};
  if (r.airports && typeof r.airports === "object" && !Array.isArray(r.airports)) {
    for (const [k, v] of Object.entries(r.airports as Record<string, unknown>)) airports[k.toUpperCase()] = isFreshStartMode(v) ? v : "off";
  }
  const m = r.migrated as { id?: unknown; at?: unknown } | undefined;
  return {
    source,
    fallback: isFreshStartMode(r.default) ? r.default : "off",
    airports,
    migrated: m && typeof m === "object" && m.id === FRESH_START_MIGRATION_ID && typeof m.at === "string" ? { id: m.id, at: m.at } : null,
  };
}
export function freshStartModeAt(sw: Pick<FreshStartSwitch, "fallback" | "airports">, airport: string | null | undefined): FreshStartMode {
  if (!airport) return "off"; // AIRPORT를 모르는 카드는 멈추지 않는다
  return sw.airports[airport.toUpperCase()] ?? sw.fallback;
}

// 배포 뒤 첫 시작에 한 번(ATC-553과 같은 꼴): 파일이 없거나 읽을 수 있는데 올린 기록이 없으면 열린 AIRPORT마다 always, default always.
// 깨진 파일은 건드리지 않는다(off로 읽힌다). 기록이 있으면 아무것도 하지 않는다 — 그 뒤로는 설정 창만 값을 바꾼다
export function upgradeFreshStartOnce(sw: FreshStartSwitch, raw: unknown, openAirports: readonly string[], at: string): Record<string, unknown> | null {
  if (sw.source === "broken" || sw.migrated) return null;
  const prev = sw.source === "ok" && raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const airports: Record<string, FreshStartMode> = {};
  for (const code of openAirports) airports[code.toUpperCase()] = "always";
  return {
    ...prev,
    default: "always",
    airports: { ...airports, ...(sw.source === "ok" ? sw.airports : {}) }, // SUPERVISOR가 이미 적은 값은 지킨다
    migrated: { id: FRESH_START_MIGRATION_ID, at, from: sw.source === "missing" ? null : { default: prev.default ?? null, airports: prev.airports ?? null } },
  };
}

// ── `over`의 기준: 세션의 첫 CAPTAIN 요청(base, 시스템 프롬프트·규칙·CREW BRIEFING) + 여유 ──
// 2026-10 근거: 세션의 첫 FLIGHT는 51k에서 시작하고 두 번째는 159k. base + 50k(보통 ~100k)는 첫 FLIGHT를 넘기지 않고 두 번째 FLIGHT를 넘는다
export const FRESH_START_OVER_MARGIN = 50_000;
export const FRESH_START_BASE_GUESS = 50_000; // base를 모를 때(0)
export const overThresholdOf = (base: number) => (base > 0 ? base : FRESH_START_BASE_GUESS) + FRESH_START_OVER_MARGIN;

// ── 이 세션이 이미 FLIGHT를 날았나 ──
// 세션 시작(startedAt) 뒤에: (1) 이 AIRCRAFT에 보낸 FLIGHT PLAN(지금 카드 말고, 다시 approved로 돌아간 것 말고),
// (2) FLIGHT를 첫 프롬프트로 띄운 LAUNCH(launch 카드·K3 RELAUNCH·FLEET LAUNCH with a FLIGHT; 세션 시작 ±10분),
// (3) 그 AIRCRAFT가 DEPARTED한 LOGBOOK FLIGHT(직접 맡긴 일). 날았던 FLIGHT 키를 돌려준다(없으면 빈 목록)
const LAUNCH_SKEW_MS = 10 * 60_000;
export interface FlownInputs {
  startedAt: string;
  currentId: string;
  proposals: readonly { id: string; flight: string; status: string; sentAt: string | null }[]; // 이 AIRCRAFT의 ASSIGN
  launches: readonly { t: string; flight?: string }[]; // 이 AIRCRAFT의 성공한 fleet launch 줄
  departures: readonly { flight: string | null; departedAt: string }[]; // 이 AIRCRAFT의 LOGBOOK
}
export function flownInSessionOf(i: FlownInputs): string[] {
  const start = Date.parse(i.startedAt);
  if (!Number.isFinite(start)) return [];
  const out = new Set<string>();
  for (const p of i.proposals) if (p.id !== i.currentId && p.sentAt && p.status !== "approved" && Date.parse(p.sentAt) >= start) out.add(p.flight);
  for (const l of i.launches) if (l.flight && Math.abs(Date.parse(l.t) - start) <= LAUNCH_SKEW_MS) out.add(l.flight);
  for (const d of i.departures) if (d.flight && Date.parse(d.departedAt) >= start) out.add(d.flight);
  return [...out].sort();
}

// ── 판정 ──
export interface AutoFreshFacts {
  registration: string;
  mode: FreshStartMode;
  launch: boolean; // launch 카드(세션이 없어 LAUNCH on approve가 띄운다)
  groundStop: boolean;
  origin: SessionOrigin | null; // 살아 있는 세션의 출처. 없으면 null
  flown: readonly string[];
  retired: boolean;
  aog: boolean;
  status: string; // AircraftView.status
  restarting: boolean;
  nordo: boolean;
  openPr: boolean; // 열린 PR의 STAND를 쥠
  flying: readonly string[]; // 쥔 STAND의 FLIGHT
  arrived: ReadonlySet<string>; // LOGBOOK에 ARRIVED한 FLIGHT
  limit: boolean;
  fuelHold: boolean;
  context: { contextTokens: number | null; base: number } | null;
}
export const AUTO_SKIP_CODES = ["retired", "not-background", "not-idle", "stand", "open-pr", "limit", "fuel-hold", "context-unknown", "under-threshold"] as const;
export type AutoSkipCode = (typeof AUTO_SKIP_CODES)[number];
// none: 해당 없음(기록하지 않고 전처럼 보낸다, 나중 판정도 막지 않는다). skip: 다시 띄울 일이지만 막힘 — 사유를 한 줄 남기고 전처럼 보낸다. restart: 자동 FRESH START
export type AutoFreshDecision =
  | { act: "none"; why: string }
  | { act: "skip"; code: AutoSkipCode; why: string; threshold: number | null }
  | { act: "restart"; why: string; threshold: number | null };

export function autoFreshStartOf(f: AutoFreshFacts): AutoFreshDecision {
  if (f.mode === "off") return { act: "none", why: "스위치 off" };
  if (f.launch) return { act: "none", why: "launch 카드 — LAUNCH가 FLIGHT PLAN을 첫 프롬프트로 가져간다" };
  if (f.groundStop) return { act: "none", why: "GROUND STOP — 풀린 뒤에 판정한다" };
  if (!f.origin) return { act: "none", why: "살아 있는 세션 없음" };
  if (!f.flown.length) return { act: "none", why: "이 세션의 첫 FLIGHT" };
  const threshold = f.mode === "over" ? overThresholdOf(f.context?.base ?? 0) : null;
  const skip = (code: AutoSkipCode, why: string): AutoFreshDecision => ({ act: "skip", code, why, threshold });
  const reg = f.registration;
  if (f.retired || f.aog) return skip("retired", `${reg}는 RETIRED·AOG`);
  if (!isBackground(f.origin)) return skip("not-background", `${reg}는 백그라운드 세션이 아님(${f.origin}) — atc는 데스크톱·터미널 세션을 멈추지 않는다`);
  if (f.status !== "idle" || f.restarting || f.nordo) return skip("not-idle", `${reg}가 쉬는 중이 아님(${f.nordo ? "NORDO" : f.restarting ? "RESTARTING" : f.status})`);
  const open = f.flying.filter((k) => !f.arrived.has(k));
  if (open.length) return skip("stand", `끝나지 않은 FLIGHT의 STAND가 있음(${open.join(", ")})`);
  if (f.openPr) return skip("open-pr", `${reg}에 열린 PR이 있음`);
  if (f.limit) return skip("limit", `${reg}가 LIMIT`);
  if (f.fuelHold) return skip("fuel-hold", `${reg}의 ACCOUNT가 FUEL hold`);
  if (f.mode === "over") {
    const c = f.context?.contextTokens ?? null;
    if (c === null) return skip("context-unknown", `${reg}의 대화 크기를 모름`);
    if (c <= threshold!) return skip("under-threshold", `대화 ${tokensShort(c)} — 기준 ${tokensShort(threshold!)}(base + ${tokensShort(FRESH_START_OVER_MARGIN)}) 아래`);
  }
  return { act: "restart", why: `이 세션이 이미 날았음(${f.flown.join(", ")})${f.mode === "over" ? ` · 대화 ${tokensShort(f.context!.contextTokens!)} > 기준 ${tokensShort(threshold!)}` : ""}`, threshold };
}

// release가 기다리게 할 때의 문구. OCC 절차의 `… RESTARTING …` 줄이 받는다(보내지 않고 승인은 그대로, 다음 바퀴에 다시 release)
export const autoFreshWaitText = (name: string) => `${name}: RESTARTING — 자동 FRESH START(ATC-560) 중: 세션을 멈추고 새로 띄워 FLIGHT PLAN을 첫 프롬프트로 보낸다. 보내지 않는다(승인은 그대로다)`;

// ── FLIGHT RECORDER 줄(dispatch, op fresh-start-auto): 판정 하나마다 한 줄, 입력과 함께(docs/autonomy.md 원칙 7) ──
export interface FreshStartAutoLine {
  t: string;
  kind: "dispatch";
  op: "fresh-start-auto";
  id: string;
  flight: string;
  aircraft: string;
  by: "auto";
  airport: string | null;
  mode: FreshStartMode;
  decision: "restart" | "skip";
  code?: AutoSkipCode;
  why: string;
  contextTokens: number | null;
  base: number | null;
  threshold: number | null;
  flown: string[];
  sessionStartedAt: string | null;
}

// ── 오작동 수(ATC-560): AIRPORT마다 최근 7일. 화면에 보이기만 하고 스위치를 스스로 끄지 않는다 ──
export interface MisfireProposal {
  id: string;
  flight: string;
  airport: string | null;
  aircraft: string; // REGISTRATION
  sentAt: string; // 보낸 시각(7일 창 안)
  restarted: boolean; // 자동 FRESH START로 보냄(sentVia fresh-start + 자동 restart 줄)
}
export interface MisfireInputs {
  proposals: readonly MisfireProposal[];
  autoLines: readonly Pick<FreshStartAutoLine, "t" | "id" | "airport" | "decision" | "code">[];
  failures: readonly { t: string; id: string; stage: "stop" | "launch" | "send" }[]; // 자동 FRESH START의 실패한 단계 줄
  blocked: ReadonlySet<string>; // BLOCKED 보고(blocked ≠ none)나 SUPERVISOR 질문(await-supervisor)이 있던 제안 id
  tokens: ReadonlyMap<string, number>; // 제안 id → 그 FLIGHT의 토큰(LOGBOOK FUEL, 도착한 것만)
  rework: ReadonlySet<string>; // FIX·GO AROUND가 보낸 뒤에 나간 제안 id
  airports: readonly string[];
  modes: Record<string, FreshStartMode>;
  days: number;
}
export interface MisfireGroup {
  flights: number;
  blocked: number; // (a) BLOCKED·질문
  tokensMedian: number | null; // (b) FLIGHT당 토큰 중앙값(도착해 FUEL이 있는 것만)
  tokensN: number;
  rework: number; // (c) 뒤따른 FIX·GO AROUND
}
export interface MisfireRow {
  airport: string;
  mode: FreshStartMode;
  restarts: number;
  skipped: number;
  skipCodes: Partial<Record<AutoSkipCode, number>>;
  failed: { stop: number; launch: number; send: number }; // (d)
  restarted: MisfireGroup;
  kept: MisfireGroup; // 같은 AIRCRAFT의 다시 띄우지 않은 FLIGHT
  worseAircraft: string[]; // (a) 다시 띄운 FLIGHT가 BLOCKED·질문이 더 잦은 AIRCRAFT
  days: number;
}
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
};
const groupOf = (ps: readonly MisfireProposal[], i: MisfireInputs): MisfireGroup => {
  const toks = ps.flatMap((p) => (i.tokens.has(p.id) ? [i.tokens.get(p.id)!] : []));
  return { flights: ps.length, blocked: ps.filter((p) => i.blocked.has(p.id)).length, tokensMedian: median(toks), tokensN: toks.length, rework: ps.filter((p) => i.rework.has(p.id)).length };
};
export function freshStartMisfiresOf(i: MisfireInputs): MisfireRow[] {
  const airportOfId = new Map(i.proposals.map((p) => [p.id, p.airport]));
  const codes = [...new Set([...i.airports, ...i.proposals.flatMap((p) => (p.airport ? [p.airport] : [])), ...i.autoLines.flatMap((l) => (l.airport ? [l.airport] : []))])].sort();
  return codes.map((airport) => {
    const lines = i.autoLines.filter((l) => l.airport === airport);
    const skipCodes: Partial<Record<AutoSkipCode, number>> = {};
    for (const l of lines) if (l.decision === "skip" && l.code) skipCodes[l.code] = (skipCodes[l.code] ?? 0) + 1;
    const failed = { stop: 0, launch: 0, send: 0 };
    for (const f of i.failures) if ((airportOfId.get(f.id) ?? lines.find((l) => l.id === f.id)?.airport) === airport) failed[f.stage]++;
    const here = i.proposals.filter((p) => p.airport === airport);
    const restartedAircraft = new Set(here.filter((p) => p.restarted).map((p) => p.aircraft));
    const mine = here.filter((p) => restartedAircraft.has(p.aircraft));
    const worseAircraft = [...restartedAircraft].sort().filter((a) => {
      const r = mine.filter((p) => p.aircraft === a && p.restarted);
      const k = mine.filter((p) => p.aircraft === a && !p.restarted);
      if (!r.length || !k.length) return false;
      const rate = (ps: MisfireProposal[]) => ps.filter((p) => i.blocked.has(p.id)).length / ps.length;
      return rate(r) > rate(k);
    });
    return {
      airport,
      mode: i.modes[airport] ?? "off",
      restarts: lines.filter((l) => l.decision === "restart").length,
      skipped: lines.filter((l) => l.decision === "skip").length,
      skipCodes,
      failed,
      restarted: groupOf(mine.filter((p) => p.restarted), i),
      kept: groupOf(mine.filter((p) => !p.restarted), i),
      worseAircraft,
      days: i.days,
    };
  });
}

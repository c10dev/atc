import { type AircraftView, applyPatch, DEFAULT_FLEET, FleetError } from "./fleet.ts";
import { ACTUALS_DAYS, type LogEntry } from "./logbook.ts";
import type { Ticket } from "./model.ts";
import { aircraftRows, type AircraftRow, type RouteRow } from "./network.ts";
import type { ProjectGoal } from "./sources/linear-projects.ts";
import { regKey } from "./registration.ts";

// OCC의 TARGET·ROUTE 변경 초안(ATC-25, docs/fleet.md 7.4). SCHEDULE 작업의 두 종류로, AIRCRAFT 하나의 FLEET TARGETS나
// ROUTE를 바꾸자는 제안이다. 지금은 그림자 운용만: SUPERVISOR가 판정하고, 아무것도 fleet.json에 쓰지 않는다.
// 근거 숫자는 OCC가 옮겨 적지 않고 atc가 초안을 만들 때 NETWORK와 같은 함수로 붙인다(OCC가 잘못 인용할 수 없게).
// 계산은 모두 순수 함수. schedule.ts가 입력(FLEET 보기, LOGBOOK, Linear 프로젝트)을 모아 부른다.

const DAY = 86_400_000;
export const NETWORK_KINDS = ["TARGET", "ROUTE"] as const;
export type NetworkKind = (typeof NETWORK_KINDS)[number];
export const isNetworkKind = (k: unknown): k is NetworkKind => (NETWORK_KINDS as readonly unknown[]).includes(k);

export const TARGET_MIN_ARRIVED = 3; // 최근 14일 ARRIVED가 이만큼은 있어야 TARGET 초안을 쓴다
export const FPW_STEP = { abs: 2, rel: 0.5 }; // flightsPerWeek는 한 번에 2나 50% 가운데 큰 만큼까지
export const ON_TIME_STEP = 0.1;

// 거절은 400이다. 초안 경로의 409는 atcctl이 "열린 초안 한도(LIMIT)"로 읽어 OCC가 그 바퀴를 멈추기 때문
export class NetworkDraftError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface TargetValues {
  flightsPerWeek: number | null;
  onTime: number | null;
}

// 초안을 쓸 때 atc가 붙이는 근거(그때의 숫자 그대로 남는다)
export interface TargetEvidence {
  aircraft: AircraftRow; // TARGETS와 실적(NETWORK AIRCRAFT 행과 같다)
  arrived14: number; // 최근 14일 ARRIVED
  weekly: { from: string; arrived: number }[]; // 최근 4주, 7일씩 ARRIVED(오래된 주 먼저)
  routes: RouteRow[]; // 그 AIRCRAFT ROUTE의 행(열린 FLIGHT 대기)
}
export interface RouteEvidence {
  routes: RouteRow[]; // 더하거나 빼는 프로젝트의 행. Linear·보드에 없으면 빠진다
  where: { project: string | null; arrived: number }[]; // 최근 14일 그 AIRCRAFT의 ARRIVED가 실제로 간 프로젝트(null은 AD HOC·모름)
}

// TARGET: 바꾸는 값만 담는다. null은 그 목표를 지운다. from은 초안을 쓸 때의 값
export interface TargetPayload {
  registration: string;
  flightsPerWeek?: number | null;
  onTime?: number | null;
  from: TargetValues;
  evidence: TargetEvidence;
}
// ROUTE: 더하거나 뺄 Linear 프로젝트 이름. from은 초안을 쓸 때의 ROUTE
export interface RoutePayload {
  registration: string;
  add?: string[];
  remove?: string[];
  from: string[];
  evidence: RouteEvidence;
}
export type NetworkPayload = TargetPayload | RoutePayload;

export interface NetworkCtx {
  views: Pick<AircraftView, "registration" | "callsign" | "status" | "routes" | "targets" | "actuals" | "retired" | "aog">[];
  entries: LogEntry[];
  tickets: Ticket[];
  goals: ProjectGoal[] | null; // Linear 프로젝트(못 읽었으면 null)
  routeRows: RouteRow[]; // NETWORK ROUTE 행(routeRows)
  now: number;
}

const upper = (v: unknown) => regKey(String(v ?? "").trim().replace(/^TAIL:\s*/i, "")); // `Team G`도 TEAM_G(ATC-67)

function viewOf(ctx: NetworkCtx, registration: unknown) {
  const reg = upper(registration);
  if (!reg) throw new NetworkDraftError("AIRCRAFT(registration)가 필요함");
  const v = ctx.views.find((x) => x.registration === reg);
  if (!v) throw new NetworkDraftError(`FLEET에 없는 AIRCRAFT: ${reg}`);
  if (v.retired) throw new NetworkDraftError(`${reg}는 퇴역 상태 — 초안을 쓰지 않는다`);
  if (v.aog) throw new NetworkDraftError(`${reg}는 AOG — 복귀한 뒤에 쓴다`);
  return v;
}

export const targetsNow = (v: Pick<AircraftView, "targets">): TargetValues => ({ flightsPerWeek: v.targets.flightsPerWeek ?? null, onTime: v.targets.onTime ?? null });

// "none"·null·""이면 null(목표를 지움), 없으면 undefined(바꾸지 않음), 나머지는 숫자
function numOrNull(v: unknown, name: string): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "" || String(v).toLowerCase() === "none") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new NetworkDraftError(`${name}는 숫자나 none`);
  return n;
}

// 한 번에 바꿀 수 있는 폭. 지금 값이 없으면(처음 정함) 폭 제한은 없다. 지우기(null)도 된다
export function stepError(from: TargetValues, to: Partial<TargetValues>): string | null {
  if (to.flightsPerWeek != null && from.flightsPerWeek != null) {
    const max = Math.max(FPW_STEP.abs, from.flightsPerWeek * FPW_STEP.rel);
    if (Math.abs(to.flightsPerWeek - from.flightsPerWeek) > max + 1e-9)
      return `flightsPerWeek ${from.flightsPerWeek} → ${to.flightsPerWeek}: 한 번에 ${max}까지(2나 50% 가운데 큰 쪽). 더 큰 변경은 SUPERVISOR가 FLEET 탭에서 직접`;
  }
  if (to.onTime != null && from.onTime != null && Math.abs(to.onTime - from.onTime) > ON_TIME_STEP + 1e-9)
    return `onTime ${from.onTime} → ${to.onTime}: 한 번에 ${ON_TIME_STEP}까지. 더 큰 변경은 SUPERVISOR가 FLEET 탭에서 직접`;
  return null;
}

// 최근 4주 7일씩 그 AIRCRAFT의 ARRIVED(되돌림 포함, FLEET 실적과 같은 셈)
export function weeklyArrived(entries: LogEntry[], registration: string, now: number, weeks = 4): TargetEvidence["weekly"] {
  const mine = entries.filter((e) => e.aircraft === registration).map((e) => Date.parse(e.arrivedAt));
  return Array.from({ length: weeks }, (_, i) => {
    const to = now - (weeks - 1 - i) * 7 * DAY;
    const from = to - 7 * DAY;
    return { from: new Date(from).toISOString(), arrived: mine.filter((t) => t > from && t <= to).length };
  });
}

// 최근 14일 그 AIRCRAFT의 ARRIVED가 간 프로젝트(티켓으로 찾는다). 많은 것 먼저
export function arrivedByProject(entries: LogEntry[], tickets: Pick<Ticket, "key" | "project">[], registration: string, now: number): RouteEvidence["where"] {
  const projectOf = new Map(tickets.map((t) => [t.key, t.project]));
  const since = now - ACTUALS_DAYS * DAY;
  const count = new Map<string | null, number>();
  for (const e of entries) {
    const at = Date.parse(e.arrivedAt);
    if (e.aircraft !== registration || at < since || at > now) continue;
    const p = (e.flight && projectOf.get(e.flight)) || null;
    count.set(p, (count.get(p) ?? 0) + 1);
  }
  return [...count].map(([project, arrived]) => ({ project, arrived })).sort((a, b) => b.arrived - a.arrived || String(a.project).localeCompare(String(b.project)));
}

export function parseTarget(raw: Record<string, unknown>, ctx: NetworkCtx): TargetPayload {
  const v = viewOf(ctx, raw.registration ?? raw.aircraft);
  const fpw = numOrNull(raw.flightsPerWeek, "flightsPerWeek");
  const onTime = numOrNull(raw.onTime, "onTime");
  if (fpw === undefined && onTime === undefined) throw new NetworkDraftError("TARGET에는 flightsPerWeek나 onTime이 필요함");
  const from = targetsNow(v);
  const to: Partial<TargetValues> = {};
  if (fpw !== undefined) to.flightsPerWeek = fpw;
  if (onTime !== undefined) to.onTime = onTime;
  // FLEET 탭(PATCH /api/fleet)과 같은 검사
  const merged = { ...from, ...to };
  try {
    applyPatch({}, { targets: merged }, DEFAULT_FLEET.defaults);
  } catch (e) {
    if (e instanceof FleetError) throw new NetworkDraftError(e.message);
    throw e;
  }
  if (!targetChanges(from, to).length) throw new NetworkDraftError(`${v.registration}의 TARGETS가 이미 그렇게 되어 있음 — 바꿀 것이 없음`);
  const step = stepError(from, to);
  if (step) throw new NetworkDraftError(step);
  if (v.actuals.total < TARGET_MIN_ARRIVED)
    throw new NetworkDraftError(`${v.registration}의 최근 ${ACTUALS_DAYS}일 ARRIVED가 ${v.actuals.total}건 — 근거가 ${TARGET_MIN_ARRIVED}건은 있어야 TARGET 초안을 쓴다`);
  const [aircraft] = aircraftRows([v]);
  return {
    registration: v.registration,
    ...to,
    from,
    evidence: {
      aircraft,
      arrived14: v.actuals.total,
      weekly: weeklyArrived(ctx.entries, v.registration, ctx.now),
      routes: ctx.routeRows.filter((r) => v.routes.includes(r.project)),
    },
  };
}

const nameList = (v: unknown) => [...new Set((v == null ? [] : Array.isArray(v) ? v : [v]).map((x) => String(x).trim()).filter(Boolean))];

export function parseRoute(raw: Record<string, unknown>, ctx: NetworkCtx): RoutePayload {
  const v = viewOf(ctx, raw.registration ?? raw.aircraft);
  if (!ctx.goals) throw new NetworkDraftError("Linear 프로젝트를 아직 읽지 못함 — 잠시 뒤 다시", 503);
  const live = ctx.goals.filter((g) => g.state !== "completed" && g.state !== "canceled").map((g) => g.name);
  const find = (list: string[], name: string) => list.find((p) => p.toLowerCase() === name.toLowerCase());
  const add: string[] = [];
  for (const name of nameList(raw.add)) {
    const p = find(live, name);
    if (!p) throw new NetworkDraftError(`더할 수 없는 프로젝트: ${name} (끝나지 않은 Linear 프로젝트만. 가능: ${live.sort().join(", ")})`);
    if (find(v.routes, p)) throw new NetworkDraftError(`${v.registration}의 ROUTE에 이미 있음: ${p}`);
    add.push(p);
  }
  const remove: string[] = [];
  for (const name of nameList(raw.remove)) {
    const p = find(v.routes, name);
    if (!p) throw new NetworkDraftError(`${v.registration}의 ROUTE에 없음: ${name} (지금: ${v.routes.join(", ") || "없음"})`);
    remove.push(p);
  }
  if (!add.length && !remove.length) throw new NetworkDraftError("ROUTE에는 add나 remove가 하나 이상 필요함");
  const touched = new Set([...add, ...remove]);
  return {
    registration: v.registration,
    ...(add.length ? { add } : {}),
    ...(remove.length ? { remove } : {}),
    from: [...v.routes],
    evidence: {
      routes: ctx.routeRows.filter((r) => touched.has(r.project)),
      where: arrivedByProject(ctx.entries, ctx.tickets, v.registration, ctx.now),
    },
  };
}

export function parseNetwork(kind: NetworkKind, raw: Record<string, unknown>, ctx: NetworkCtx): NetworkPayload {
  return kind === "TARGET" ? parseTarget(raw, ctx) : parseRoute(raw, ctx);
}

const pct = (n: number | null) => (n == null ? "없음" : `${Math.round(n * 100)}%`);
const num = (n: number | null) => (n == null ? "없음" : String(n));

function targetChanges(from: TargetValues, to: Partial<TargetValues>): string[] {
  const out: string[] = [];
  if (to.flightsPerWeek !== undefined && to.flightsPerWeek !== from.flightsPerWeek) out.push(`flightsPerWeek ${num(from.flightsPerWeek)} → ${num(to.flightsPerWeek)}`);
  if (to.onTime !== undefined && to.onTime !== from.onTime) out.push(`onTime ${pct(from.onTime)} → ${pct(to.onTime)}`);
  return out;
}

// 지금 FLEET 등록부에 적용하면 바뀌는 것. 바뀌는 게 없으면 빈 배열(FLEET 탭에서 이미 그렇게 바꿈)
export function networkChangesOf(kind: NetworkKind, payload: NetworkPayload, view: Pick<AircraftView, "targets" | "routes"> | undefined): string[] {
  if (!view) return [];
  const reg = payload.registration;
  if (kind === "TARGET") {
    const p = payload as TargetPayload;
    const to: Partial<TargetValues> = {};
    if (p.flightsPerWeek !== undefined) to.flightsPerWeek = p.flightsPerWeek;
    if (p.onTime !== undefined) to.onTime = p.onTime;
    return targetChanges(targetsNow(view), to).map((x) => `${reg} ${x}`);
  }
  const p = payload as RoutePayload;
  const has = (name: string) => view.routes.some((r) => r.toLowerCase() === name.toLowerCase());
  return [...(p.add ?? []).filter((x) => !has(x)).map((x) => `${reg} ROUTE + ${x}`), ...(p.remove ?? []).filter(has).map((x) => `${reg} ROUTE − ${x}`)];
}

// 열린 초안을 닫을 이유(없으면 null): AIRCRAFT가 없거나 퇴역, 또는 SUPERVISOR가 FLEET 탭에서 이미 그렇게 바꿈
export function networkSupersedeReason(kind: NetworkKind, payload: NetworkPayload, views: NetworkCtx["views"]): string | null {
  const v = views.find((x) => x.registration === payload.registration);
  if (!v) return "AIRCRAFT가 FLEET에 없음";
  if (v.retired) return "AIRCRAFT가 퇴역함";
  if (!networkChangesOf(kind, payload, v).length) return "FLEET에 이미 반영됨";
  return null;
}

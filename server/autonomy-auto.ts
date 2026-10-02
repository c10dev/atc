import type { FleetProposal } from "./fleet-plan.ts";
import type { ScheduleMode, ScheduleOp } from "./schedule.ts";
import { sameJson } from "./schedule.ts";

// SCHEDULE 초안과 FLEET PLAN 제안을 사람 없이 적용한다(ATC-370, docs/autonomy.md P3·P5). 순수 함수만 — 읽고 쓰는 것은 autonomy-auto-run.ts.
// DISPATCH(ATC-367)처럼 CROSSCHECK 일치도 SUPERVISOR 판정도 기다리지 않는다. 기존 상한(FUEL hold, ATC_MAX_LAUNCHED, 하루 상한)은 그대로 지킨다.
// 방향(ROUTE·TARGET)과 새 FLIGHT의 풀어 줌(NEW는 Backlog 제안까지만)은 사람 몫이다. 끄는 스위치는 둘, SUPERVISOR만 바꾼다(설정 창).

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export type AutoSwitch = "off" | "on";
export const AUTO_SWITCHES: readonly AutoSwitch[] = ["off", "on"];
// 파일에 없거나 모르는 값이면 on(출시 때 둘 다 켜진다, live first). 끄는 것은 SUPERVISOR가 쓴 off뿐이다
export const parseAutoSwitch = (v: unknown): AutoSwitch => (v === "off" ? "off" : "on");

// 서버가 적용하는 종류. PRIORITIZE·ROUTE·TARGET(방향)과 ENTRY·ACCOUNT CHANGE·REPOSITION·RETIRE·RETURN은 제안으로 남는다
export const SCHEDULE_AUTO_KINDS: readonly ScheduleOp["kind"][] = ["CLASSIFY", "TAIL", "CLOSE", "WAYPOINT", "NEW"];
export const FLEET_AUTO_KINDS: readonly FleetProposal["kind"][] = ["LAUNCH", "STOP", "RESTART", "REFRESH", "AOG"];
// 세션을 띄우는 종류(하루 LAUNCH 상한이 센다)
const LAUNCHING: readonly string[] = ["LAUNCH", "RESTART", "REFRESH"];

export type AutoWhy = "switch-off" | "mode" | "kind" | "not-open" | "manual" | "daily-cap" | "launch-daily-cap" | "cooling";

export interface ScheduleAutoCtx {
  sw: AutoSwitch;
  mode: ScheduleMode; // schedule.json: approval이어야 승인·발부 길이 열려 있다
  appliedToday: number; // 지난 24시간의 자동 적용(이 규칙과 일치 기반 자동 승인의 SCHEDULE 승인)
  max: number; // dispatch.json autoApproveMax
}

// 열린 SCHEDULE 초안을 서버가 승인해도 되나. 막히면 까닭, 되면 null
export function scheduleAutoWhyNot(op: Pick<ScheduleOp, "kind" | "status">, c: ScheduleAutoCtx): AutoWhy | null {
  if (c.sw !== "on") return "switch-off";
  if (c.mode !== "approval") return "mode";
  if (op.status !== "draft") return "not-open";
  if (!SCHEDULE_AUTO_KINDS.includes(op.kind)) return "kind";
  if (c.appliedToday >= c.max) return "daily-cap";
  return null;
}

export interface FleetAutoCtx {
  sw: AutoSwitch;
  mode: "shadow" | "approval"; // fleet-plan.json mode
  launchesToday: number; // 지난 24시간의 자동 LAUNCH 계열(LAUNCH·RESTART·REFRESH)
  launchMax: number; // dispatch.json autoLaunchMax
  actsToday: number; // 지난 24시간의 자동 적용 전부
  actMax: number; // dispatch.json autoApproveMax
  cooling: ReadonlySet<string>; // 최근에 서버가 건드린 AIRCRAFT(같은 AIRCRAFT를 쉴 새 없이 오가지 않게)
  aircraftKey: string; // 이 제안의 AIRCRAFT 열쇠
}

// 열린 FLEET PLAN 제안을 서버가 실행해도 되나. 단계 자체의 거절(ATC_MAX_LAUNCHED, FUEL hold, 조건이 바뀜)은 실행기(executionOf, launchAircraft)가 다시 본다
export function fleetAutoWhyNot(p: Pick<FleetProposal, "kind" | "status" | "reasons">, manual: boolean, c: FleetAutoCtx): AutoWhy | null {
  if (c.sw !== "on") return "switch-off";
  if (c.mode !== "approval") return "mode";
  if (p.status !== "open") return "not-open";
  if (!FLEET_AUTO_KINDS.includes(p.kind)) return "kind";
  if (manual) return "manual"; // 데스크톱·터미널 세션의 REFRESH는 atc가 다시 띄우지 않는다
  if (c.cooling.has(c.aircraftKey)) return "cooling";
  if (c.actsToday >= c.actMax) return "daily-cap";
  if (LAUNCHING.includes(p.kind) && c.launchesToday >= c.launchMax) return "launch-daily-cap";
  return null;
}

// ── 기록(auto-actions.jsonl, 추가만 하는 JSONL): 서버가 한 일 ──
export interface ActionLine {
  at: string;
  kind: "schedule" | "fleet";
  op: "apply" | "fail";
  id: string; // S-0001 / F-0001
  what: string; // 초안·제안의 종류(CLASSIFY, STOP …)
  flight?: string | null;
  aircraft?: string; // 정규화한 REGISTRATION
  error?: string;
}

// ── 오작동(misfires.jsonl): 서버가 한 일을 사람이나 다음 일이 되돌린 것 ──
export type MisfireWhy = "undone" | "stop-launch" | "idle-launch" | "restart-loop";
export interface MisfireLine {
  at: string;
  kind: "schedule" | "fleet";
  id: string;
  why: MisfireWhy;
  what: string;
  flight?: string | null;
  aircraft?: string;
  detail?: string;
}
export const misfireKey = (m: Pick<MisfireLine, "kind" | "id" | "why">) => `${m.kind}|${m.id}|${m.why}`;

// 지난 24시간(굴러가는 창)의 자동 적용 수
export const recentActs = (lines: readonly ActionLine[], now: number, kind: ActionLine["kind"]): ActionLine[] =>
  lines.filter((l) => l.kind === kind && l.op === "apply" && now - Date.parse(l.at) < DAY_MS);
export const isLaunching = (what: string) => LAUNCHING.includes(what);

// 서버가 방금 건드린 AIRCRAFT(30분)와 실패해서 쉬는 AIRCRAFT(1시간)
export function coolingOf(lines: readonly ActionLine[], now: number, applyMin = 30, failMin = 60): Set<string> {
  const out = new Set<string>();
  for (const l of lines) {
    if (l.kind !== "fleet" || !l.aircraft) continue;
    const age = now - Date.parse(l.at);
    if (age < (l.op === "fail" ? failMin : applyMin) * 60_000) out.add(l.aircraft);
  }
  return out;
}

// ── SCHEDULE 오작동: 자동 승인한 초안이 APPLIED가 된 뒤 되돌려졌다 ──
// CLASSIFY의 라벨이 빠지거나 TAIL이 다른 REGISTRATION으로 바뀌거나 CLOSE한 이슈가 다시 열렸거나, 같은 FLIGHT에 같은 종류의 뒤 초안이 다른 값을 낸다.
export interface TicketFacts {
  key: string;
  labels: string[];
  stateType: string;
}
export function scheduleMisfireOf(op: ScheduleOp, all: readonly ScheduleOp[], ticket: TicketFacts | undefined, now: number, windowMs = 3 * DAY_MS): MisfireLine | null {
  if (op.via !== "auto" || op.status !== "applied" || !op.flight) return null;
  if (now - Date.parse(op.statusAt) > windowMs) return null;
  const misfire = (detail: string): MisfireLine => ({ at: new Date(now).toISOString(), kind: "schedule", id: op.id, why: "undone", what: op.kind, flight: op.flight, detail });
  if (ticket) {
    if (op.kind === "CLOSE" && !["completed", "canceled"].includes(ticket.stateType)) return misfire("CLOSE한 이슈가 다시 열림");
    if (op.kind === "TAIL") {
      const reg = (op.payload as { registration?: string }).registration;
      const tails = ticket.labels.filter((l) => l.startsWith("tail:"));
      if (reg && tails.length && !tails.includes(`tail:${reg}`)) return misfire(`tail:${reg}가 ${tails.join(", ")}로 바뀜`);
    }
    if (op.kind === "CLASSIFY") {
      const p = op.payload as { type?: string; wake?: string };
      const want = [p.type, p.wake].filter((x): x is string => Boolean(x));
      // 그룹 라벨은 "type:BUILD"처럼 접두어가 붙어 있을 수 있어 끝 이름으로 본다
      const missing = want.filter((w) => !ticket.labels.some((l) => l === w || l.endsWith(`:${w}`)));
      if (missing.length) return misfire(`라벨 ${missing.join(", ")}가 빠짐`);
    }
  }
  const later = all.find((o) => o.id !== op.id && o.flight === op.flight && o.kind === op.kind && o.at > op.statusAt && ["draft", "agreed", "approved", "released", "applied"].includes(o.status) && !sameJson(o.payload, op.payload));
  if (later) return misfire(`뒤 초안 ${later.id}가 다른 값을 냄`);
  return null;
}

// ── FLEET PLAN 오작동 ──
export interface FleetLaunchFact {
  aircraft: string;
  at: string;
}
export interface FleetMisfireCtx {
  now: number;
  launches: readonly FleetLaunchFact[]; // 성공한 LAUNCH 전부(FLIGHT RECORDER)
  idleNow: (aircraft: string) => boolean; // 그 AIRCRAFT의 세션이 지금 놀고 있나(없으면 false)
}
export function fleetMisfiresOf(actions: readonly ActionLine[], c: FleetMisfireCtx): MisfireLine[] {
  const out: MisfireLine[] = [];
  const stamp = new Date(c.now).toISOString();
  const applied = actions.filter((a) => a.kind === "fleet" && a.op === "apply" && a.aircraft);
  for (const a of applied) {
    const t = Date.parse(a.at);
    const reg = a.aircraft!;
    const line = (why: MisfireWhy, detail: string): MisfireLine => ({ at: stamp, kind: "fleet", id: a.id, why, what: a.what, aircraft: reg, detail });
    // STOP 뒤 1시간 안에 같은 AIRCRAFT를 다시 LAUNCH
    if (a.what === "STOP") {
      const l = c.launches.find((x) => x.aircraft === reg && Date.parse(x.at) > t && Date.parse(x.at) - t <= HOUR_MS);
      if (l) out.push(line("stop-launch", `STOP ${Math.round((Date.parse(l.at) - t) / 60_000)}분 뒤 LAUNCH`));
    }
    // LAUNCH가 1시간 뒤에도 놀고 있음(하루 안에서만 본다)
    if (a.what === "LAUNCH" && c.now - t >= HOUR_MS && c.now - t < DAY_MS && c.idleNow(reg)) out.push(line("idle-launch", "LAUNCH 1시간 뒤에도 놀고 있음"));
    // RESTART 고리: 같은 AIRCRAFT의 RESTART·REFRESH가 6시간 안에 3번째
    if (a.what === "RESTART" || a.what === "REFRESH") {
      const same = applied.filter((x) => x.aircraft === reg && (x.what === "RESTART" || x.what === "REFRESH") && Date.parse(x.at) <= t && t - Date.parse(x.at) < 6 * HOUR_MS);
      if (same.length >= 3) out.push(line("restart-loop", `${same.length}번째 RESTART가 6시간 안`));
    }
  }
  return out;
}

// 하루별 오작동 수(UTC 날짜). 같은 사건은 한 번만
export function misfiresByDay(lines: readonly MisfireLine[]): { day: string; schedule: number; fleet: number }[] {
  const seen = new Set<string>();
  const days = new Map<string, { day: string; schedule: number; fleet: number }>();
  for (const m of lines) {
    const k = misfireKey(m);
    if (seen.has(k)) continue;
    seen.add(k);
    const day = m.at.slice(0, 10);
    const d = days.get(day) ?? { day, schedule: 0, fleet: 0 };
    d[m.kind]++;
    days.set(day, d);
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

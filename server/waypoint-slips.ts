import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";
import { dayKey } from "./network.ts";
import type { EtaReason, Route, WaypointState } from "./routes.ts";

// WAYPOINT ETA와 지연 경고(ATC-24). ROUTE MAP이 계산한 ETA·late를 OCC 브리핑(schedule brief)과 SCHEDULE 탭에 옮긴다.
// 지연 경고는 FLIGHT FOLLOWING처럼 OCC가 새것(fresh)만 SUPERVISOR에게 한 번 보고하고 ack한다.
// 설계: docs/routes.md 7단계, docs/occ.md 5.7

const DAY = 86_400_000;

export interface WaypointEta {
  route: string;
  id: string; // Linear 마일스톤 id
  name: string;
  state: Exclude<WaypointState, "passed">;
  targetDate: string | null; // YYYY-MM-DD
  progress: number | null;
  eta: string | null; // YYYY-MM-DD, 모르면 null
  reason: EtaReason | null; // ETA를 모르는 이유
  remaining: number;
  cumulative: number;
  late: boolean;
}

// target-passed: 목표일이 지났는데 WAYPOINT를 지나지 못함 · eta-after-target: ETA가 목표일보다 늦음 · linear-overdue: Linear가 overdue라 함
export type SlipCode = "target-passed" | "eta-after-target" | "linear-overdue";

export interface Slip {
  key: string; // 마일스톤 id:code. 반복 보고를 막는 key
  code: SlipCode;
  route: string;
  waypoint: string;
  id: string;
  state: Exclude<WaypointState, "passed">;
  targetDate: string | null;
  eta: string | null;
  days: number | null; // 목표일을 넘긴 날수(target-passed는 오늘, eta-after-target은 ETA 기준)
  text: string;
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

// ROUTE마다 지나지 않은 WAYPOINT의 ETA. WAYPOINT가 없는 ROUTE는 뺀다. ROUTE 이름순, 그 안은 ROUTE MAP 순서
export function waypointEtasOf(routes: Route[]): WaypointEta[] {
  return [...routes]
    .sort((a, b) => a.project.localeCompare(b.project))
    .flatMap((r) =>
      r.waypoints.flatMap((w): WaypointEta[] =>
        w.state === "passed"
          ? []
          : [{
              route: r.project,
              id: w.id,
              name: w.name,
              state: w.state,
              targetDate: w.targetDate?.slice(0, 10) ?? null,
              progress: w.progress,
              eta: w.eta?.at ?? null,
              reason: w.eta?.reason ?? null,
              remaining: w.eta?.remaining ?? 0,
              cumulative: w.eta?.cumulative ?? 0,
              late: w.late,
            }],
      ),
    );
}

// 지연 경고 하나(없으면 null). 목표일이 지난 것을 ETA가 늦는 것보다 먼저 본다. isLate와 같은 조건이다
export function slipOf(w: WaypointEta, now: number): Slip | null {
  if (!w.late) return null;
  const today = dayKey(now);
  const base = { route: w.route, waypoint: w.name, id: w.id, state: w.state, targetDate: w.targetDate, eta: w.eta };
  const etaText = w.eta ? `ETA ${w.eta}` : `ETA 모름(${w.reason ?? "no-flights"})`;
  const left = `남은 FLIGHT ${w.cumulative}`;
  if (w.targetDate && w.targetDate < today) {
    const days = daysBetween(w.targetDate, today);
    return { ...base, key: `${w.id}:target-passed`, code: "target-passed", days, text: `${w.route} · ${w.name}: 목표일 ${w.targetDate}이 ${days}일 지났는데 지나지 못함 — ${etaText}, ${left}` };
  }
  if (w.targetDate && w.eta && w.eta > w.targetDate) {
    const days = daysBetween(w.targetDate, w.eta);
    return { ...base, key: `${w.id}:eta-after-target`, code: "eta-after-target", days, text: `${w.route} · ${w.name}: ${etaText}가 목표일 ${w.targetDate}보다 ${days}일 늦음 — ${left}` };
  }
  return { ...base, key: `${w.id}:linear-overdue`, code: "linear-overdue", days: null, text: `${w.route} · ${w.name}: Linear가 overdue로 표시 — ${etaText}, ${left}` };
}

export const slipsOf = (etas: WaypointEta[], now: number): Slip[] => etas.flatMap((w) => slipOf(w, now) ?? []);

// ── 반복 보고 막기(following-state.json과 같은 모양): 보고한 경고의 key를 적고, 풀린 경고는 지워서 다시 생기면 새로 보고한다 ──

const STATE_FILE = () => join(config.stateDir, "waypoint-slips.json");
export interface SlipsReported {
  reported: Record<string, string>; // slip key → 보고한 시각
}
export function loadSlipsReported(file = STATE_FILE()): SlipsReported {
  try {
    const r = JSON.parse(readFileSync(file, "utf8"));
    return { reported: r.reported && typeof r.reported === "object" ? r.reported : {} };
  } catch {
    return { reported: {} };
  }
}
export function saveSlipsReported(r: SlipsReported, file = STATE_FILE()) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(r, null, 2) + "\n");
  renameSync(tmp, file);
}

export const freshSlipKeys = (slips: Slip[], r: SlipsReported) => slips.map((s) => s.key).filter((k) => !(k in r.reported));

// 보고했다고 적는다(순수): 지금 있는 경고만 남기고, ack한 key를 더한다
export function ackSlips(slips: Slip[], r: SlipsReported, keys: string[], now: string): SlipsReported {
  const current = new Set(slips.map((s) => s.key));
  const next: Record<string, string> = {};
  for (const [k, at] of Object.entries(r.reported)) if (current.has(k)) next[k] = at;
  for (const k of keys) if (current.has(k)) next[k] ??= now;
  return { reported: next };
}

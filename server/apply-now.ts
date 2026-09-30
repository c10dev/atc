// LAUNCH ACCOUNT APPLY NOW(ATC-244, docs/accounts.md "APPLY NOW as built"): LAUNCH ACCOUNT를 지금 돌고 있는 세션에도 적용하는 계획(순수).
// 돌고 있는 세션은 시작한 설정 폴더에 묶여 있어 폴더를 바꿔 --resume할 수 없다. 그래서 "적용"은 STOP + LAUNCH이고, 안전한 세션만 한다:
// AIRCRAFT는 ACCOUNT CHANGE와 같은 시험(FLIGHT 사이: 쉬고, FLIGHT·점유·PR 없고, FLIGHT를 받지 않음), 관제 세션은 CONTROL RECYCLE의 안전한 순간.
// 입출력은 apply-now-run.ts. 여기는 사실을 받아 행(row)과 행동을 돌려주기만 한다.

import { compareRegistration } from "./registration.ts";

export type ApplyKind = "aircraft" | "control";
export type ApplyAction = "move-now" | "after-flight" | "wait-safe" | "skip";

export interface ApplyAircraft {
  registration: string;
  current: string | null; // 지금 세션이 도는 ACCOUNT(관찰한 것)
  session: "background" | "other" | null; // 백그라운드(atc가 띄움) | 데스크톱·터미널 | 세션 없음
  idle: boolean; // a.status === "idle"
  retired: boolean;
  aog: boolean;
  flights: string[]; // 쥔 STAND·kept FLIGHT의 key(없으면 빈 목록)
  openPr: boolean;
  assigned: boolean; // 이번 DISPATCH 계획에서 FLIGHT를 받음
  launchedRecently: boolean; // minDwell 안에 LAUNCH함
  limitCut: boolean; // 한도로 잘린 턴: RESUME(같은 ACCOUNT)
}
export interface ApplyControl {
  name: string;
  current: string | null;
  session: "background" | "other" | null;
  idle: boolean; // job이 턴 사이(jobIdle)
  blocks: string[]; // safeBlocksOf + 쿨다운 등. 비면 안전
}
export interface ApplyTarget {
  label: string;
  refused: string | null; // 로그인 안 됨 · FUEL hold
  maxLaunched: number | null;
  running: number; // 그 폴더의 백그라운드 세션 수
}
export interface ApplyRow {
  kind: ApplyKind;
  name: string;
  from: string | null;
  to: string;
  action: ApplyAction;
  reason: string;
}

export interface ApplyInputs {
  aircraft: readonly ApplyAircraft[];
  control: readonly ApplyControl[];
  launchAccount: { aircraft: string | null; control: string | null }; // 등록부에 있는 라벨만
  targets: readonly ApplyTarget[];
}

const row = (kind: ApplyKind, name: string, from: string | null, to: string, action: ApplyAction, reason: string): ApplyRow => ({ kind, name, from, to, action, reason });

// 종류마다 LAUNCH ACCOUNT가 정해져 있을 때만 그 종류의 행이 있다("각 home"이면 옮길 곳이 없다).
// 행은 그 ACCOUNT에 있지 않은 세션마다 하나. 세션이 없는 AIRCRAFT·RETIRED는 행이 없다
export function applyNowPlanOf(i: ApplyInputs): ApplyRow[] {
  const out: ApplyRow[] = [];
  const planned = new Map<string, number>(); // 목표마다 이번에 move-now로 가는 수(ACCOUNT 상한 검사)
  const target = (label: string) => i.targets.find((t) => t.label === label) ?? null;
  // 목표가 거절하거나 상한이 찼으면 skip의 사유, 아니면 null
  const refusal = (t: ApplyTarget | null, label: string): string | null => {
    if (!t) return `ACCOUNT ${label}가 등록부에 없음`;
    if (t.refused) return `ACCOUNT ${label}: ${t.refused}`;
    if (t.maxLaunched && t.running + (planned.get(label) ?? 0) >= t.maxLaunched) return `ACCOUNT ${label}: 상한 ${t.maxLaunched} 찼음`;
    return null;
  };

  const to = i.launchAccount.aircraft;
  if (to) {
    for (const a of [...i.aircraft].sort((x, y) => compareRegistration(x.registration, y.registration))) {
      if (!a.session || a.retired || a.current === to) continue;
      const r = (action: ApplyAction, reason: string) => row("aircraft", a.registration, a.current, to, action, reason);
      if (a.session !== "background") {
        out.push(r("skip", "데스크톱·터미널 세션 — atc가 멈추거나 다시 띄울 수 없다(그 세션에서 직접 옮긴다)"));
        continue;
      }
      if (a.aog) {
        out.push(r("skip", "AOG"));
        continue;
      }
      if (!a.idle || a.flights.length) out.push(r("after-flight", `FLIGHT 중${a.flights.length ? `(${a.flights.join(", ")})` : ""} — 살아 있는 FLIGHT는 옮기지 않는다`));
      else if (a.openPr) out.push(r("after-flight", "열린 PR이 있음"));
      else if (a.assigned) out.push(r("after-flight", "이번 계획에서 FLIGHT를 받음"));
      else if (a.launchedRecently) out.push(r("after-flight", "방금 LAUNCH함(minDwell 안)"));
      else if (a.limitCut) out.push(r("after-flight", "한도로 잘린 턴 — RESUME은 같은 ACCOUNT에서"));
      else {
        const why = refusal(target(to), to);
        if (why) out.push(r("skip", why));
        else {
          planned.set(to, (planned.get(to) ?? 0) + 1);
          out.push(r("move-now", "FLIGHT 사이 — 쉬고 FLIGHT·점유·PR이 없음"));
        }
      }
    }
  }
  const cto = i.launchAccount.control;
  if (cto) {
    for (const c of i.control) {
      if (!c.session || c.current === cto) continue;
      const r = (action: ApplyAction, reason: string) => row("control", c.name, c.current, cto, action, reason);
      if (c.session !== "background") {
        out.push(r("skip", "claude --bg 세션이 아님 — atc가 다시 띄울 수 없다(tmux·터미널은 그 창에서 직접)"));
        continue;
      }
      const why = refusal(target(cto), cto);
      if (why) {
        out.push(r("skip", why));
        continue;
      }
      const blocks = [...(c.idle ? [] : ["턴 사이가 아님"]), ...c.blocks];
      if (blocks.length) out.push(r("wait-safe", `안전한 순간이 아님: ${blocks.join("; ")}`));
      else {
        planned.set(cto, (planned.get(cto) ?? 0) + 1);
        out.push(r("move-now", "안전한 순간 — 턴 사이이고 RTS·TOWER·OCC·MCC 조건이 없음"));
      }
    }
  }
  return out;
}

// ── 대기(pending): after-flight·wait-safe는 설정이 바뀌거나 24시간이 지날 때까지 기다렸다가 그때 옮긴다 ──
export const APPLY_PENDING_MS = 24 * 3_600_000;
export interface ApplyPending {
  at: string; // SUPERVISOR가 누른 시각
  aircraft: string | null; // 그때의 LAUNCH ACCOUNT(없으면 그 종류는 대기 안 함)
  control: string | null;
}
// 아직 유효한 종류만 남긴다: 24시간 안이고 LAUNCH ACCOUNT가 그대로여야 한다(바뀌었으면 그 종류는 끝). 둘 다 끝이면 null
export function pendingLiveOf(p: ApplyPending | null, launchAccount: { aircraft: string | null; control: string | null }, now: number): { aircraft: string | null; control: string | null } | null {
  if (!p) return null;
  const at = Date.parse(p.at);
  if (!Number.isFinite(at) || now - at >= APPLY_PENDING_MS || now < at) return null;
  const aircraft = p.aircraft && launchAccount.aircraft === p.aircraft ? p.aircraft : null;
  const control = p.control && launchAccount.control === p.control ? p.control : null;
  return aircraft || control ? { aircraft, control } : null;
}
export function pendingOfFile(raw: unknown): ApplyPending | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const label = (v: unknown) => (typeof v === "string" && /^[a-z0-9-]+$/.test(v) ? v : null);
  if (typeof o.at !== "string") return null;
  return { at: o.at, aircraft: label(o.aircraft), control: label(o.control) };
}
// 기다릴 행이 남았나(move-now는 곧 실행되므로 세지 않는다)
export const waitingOf = (rows: readonly ApplyRow[]) => rows.filter((r) => r.action === "after-flight" || r.action === "wait-safe");

export interface ApplyCounts {
  moved: number;
  failed: number;
  waiting: number;
  skipped: number;
}
export const countsOf = (rows: readonly ApplyRow[], results: Readonly<Record<string, { ok: boolean }>>): ApplyCounts => {
  const done = Object.values(results);
  return { moved: done.filter((r) => r.ok).length, failed: done.filter((r) => !r.ok).length, waiting: waitingOf(rows).length, skipped: rows.filter((r) => r.action === "skip").length };
};

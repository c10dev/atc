import { chainRootOf, resendLinksOf } from "./clearance-resend.ts";
import type { Clearance } from "./model.ts";

// TOWER CARRY-OVER(ATC-565, docs/control-recycle.md 6): CONTROL RECYCLE이 overdue CLEARANCE를 막는 것으로 보지 않고 새 TOWER에 넘긴다.
// 새 TOWER는 기록(clearance-resend.ts의 resentBy·resendOf)에서 두 번째 RESEND와 "답 없음"을 가린다. 스위치는 SUPERVISOR만(기본 on, off = 오늘처럼 기다림).
// 순수 함수: 스위치 값 읽기와 오작동 수. 읽고 쓰기는 recycle-carry-run.ts

export const CARRY_SWITCHES = ["off", "on"] as const;
export type CarrySwitch = (typeof CARRY_SWITCHES)[number];
export const parseCarrySwitch = (raw: unknown): CarrySwitch => (raw === "off" ? "off" : "on");

// 넘긴 CLEARANCE가 RESEND를 받아야 했는데(아직 RESEND가 없던 고리) 이만큼 지나도 RESEND도 답도 취소도 없으면 놓친 것으로 센다
export const LOST_AFTER_MS = 30 * 60_000;

export interface CarryRecordLike {
  t: string;
  session: string;
  result: string;
  carried?: string[];
}

export interface CarryMisfire {
  t: string; // 재시작 시각
  carried: number; // 넘긴 고리 수
  repeated: string[]; // 중복 RESEND: 재시작 전에 이미 RESEND가 있었는데 새 세션이 또 보냈다(또는 새 세션이 두 번 보냈다). 고리 뿌리 id
  lost: string[]; // 놓침: 아직 RESEND가 없던 고리에 새 세션이 LOST_AFTER_MS 안에 RESEND도 하지 않았고 답·취소도 없었다
}

export interface CarryCounter {
  days: number;
  restarts: number; // CLEARANCE를 넘긴 TOWER 재시작
  chains: number; // 넘긴 고리 수(원래 CLEARANCE + RESEND를 하나로)
  repeated: number;
  lost: number;
  misfires: number; // 잘못이 하나라도 있었던 재시작
  recent: CarryMisfire[]; // 최근 다섯(새것부터)
}

const closedAtOf = (c: Clearance | undefined): number => {
  const ts = [c?.readbackAt, c?.unableAt, c?.cancelledAt].filter((x): x is string => Boolean(x)).map(Date.parse);
  return ts.length ? Math.min(...ts) : Infinity;
};

// 넘긴 고리마다: 재시작 뒤(다음 TOWER 재시작 전까지) 나간 RESEND를 센다. "답 없음" 보고는 ATC LOG(대화)에만 있어 atc가 보지 못한다 — 세지 않는다
export function carryCounterOf(records: readonly CarryRecordLike[], clearances: readonly Clearance[], now: number, days = 30): CarryCounter {
  const since = now - days * 86_400_000;
  const links = resendLinksOf(clearances);
  const byId = new Map(clearances.map((c) => [c.id, c]));
  const towers = records.filter((r) => r.session === "TOWER" && r.result === "recycled").sort((a, b) => a.t.localeCompare(b.t));
  const rows: CarryMisfire[] = [];
  let chains = 0;
  towers.forEach((r, i) => {
    const t = Date.parse(r.t);
    if (!r.carried?.length || !Number.isFinite(t) || t < since) return;
    const end = i + 1 < towers.length ? Date.parse(towers[i + 1]!.t) : Infinity; // 다음 재시작 뒤의 RESEND는 그 재시작의 몫
    const roots = [...new Set(r.carried.map((id) => chainRootOf(id, links)))];
    chains += roots.length;
    const row: CarryMisfire = { t: r.t, carried: roots.length, repeated: [], lost: [] };
    for (const root of roots) {
      const sent = (links.get(root)?.resentBy ?? []).map((id) => byId.get(id)).filter((c): c is Clearance => Boolean(c));
      const before = sent.filter((c) => Date.parse(c.at) < t).length;
      const after = sent.filter((c) => Date.parse(c.at) >= t && Date.parse(c.at) < end).length;
      if (after > 0 && before + after >= 2) row.repeated.push(root);
      else if (before === 0 && after === 0 && Math.min(now, end) - t >= LOST_AFTER_MS && closedAtOf(byId.get(root)) > t + LOST_AFTER_MS) row.lost.push(root);
    }
    rows.push(row);
  });
  const bad = rows.filter((x) => x.repeated.length || x.lost.length);
  return {
    days,
    restarts: rows.length,
    chains,
    repeated: rows.reduce((n, x) => n + x.repeated.length, 0),
    lost: rows.reduce((n, x) => n + x.lost.length, 0),
    misfires: bad.length,
    recent: bad.slice(-5).reverse(),
  };
}

import { closeSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import type { SquelchLast } from "./control-view.ts";
import { isRole, type Role } from "./squelch.ts";
import { readState, type SquelchFile } from "./squelch-run.ts";

// 관제 세션마다 SQUELCH의 마지막 판정(ATC-127, 헤더 CONTROL 띠의 마지막 tick). 읽기만 한다: squelch.jsonl 꼬리와 squelch.json.
const LOG_TAIL = 64 * 1024;
type Decision = { lastAt: string; open: boolean; reason: string };

// squelch.jsonl 꼬리(줄마다 {t, role, open, reason}) → 역할별 가장 늦은 판정. 잘린 첫 줄과 모르는 줄은 건너뛴다
export function lastDecisionsOf(tail: string): Partial<Record<Role, Decision>> {
  const out: Partial<Record<Role, Decision>> = {};
  for (const raw of tail.split("\n")) {
    if (!raw.trim()) continue;
    try {
      const d = JSON.parse(raw) as { t?: unknown; role?: unknown; open?: unknown; reason?: unknown };
      if (typeof d.t !== "string" || Number.isNaN(Date.parse(d.t)) || typeof d.role !== "string" || !isRole(d.role)) continue;
      const cur = out[d.role];
      if (!cur || Date.parse(d.t) >= Date.parse(cur.lastAt)) out[d.role] = { lastAt: new Date(d.t).toISOString(), open: d.open === true, reason: typeof d.reason === "string" ? d.reason : "" };
    } catch {}
  }
  return out;
}

// 로그의 마지막 판정 + 상태 파일의 마지막 OPEN·QUIET 수. 판정 기록이 없는 역할은 없다
export function squelchLastOf(tail: string, roles: SquelchFile["roles"]): Partial<Record<Role, SquelchLast>> {
  const out: Partial<Record<Role, SquelchLast>> = {};
  for (const [role, d] of Object.entries(lastDecisionsOf(tail)) as [Role, Decision][]) {
    const s = roles[role];
    out[role] = { ...d, openedAt: s?.openedAt ?? null, quietSince: s?.quietSince ?? null, quietCount: s?.quietCount ?? 0 };
  }
  return out;
}

function tailOf(path: string, max: number): string {
  try {
    const fd = openSync(path, "r");
    try {
      const size = statSync(path).size;
      const len = Math.min(size, max);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, size - len);
      return buf.toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return "";
  }
}

export function readSquelchLast(): Partial<Record<Role, SquelchLast>> {
  try {
    return squelchLastOf(tailOf(join(config.stateDir, "squelch.jsonl"), LOG_TAIL), readState().roles);
  } catch {
    return {};
  }
}

// 관제 세션 이름(TOWER …) → 그 역할의 마지막 판정. ENGINEERING처럼 역할이 아니면 null
export const squelchOfName = (all: Partial<Record<Role, SquelchLast>>, name: string): SquelchLast | null => {
  const r = name.toLowerCase();
  return isRole(r) ? (all[r] ?? null) : null;
};

// SQUELCH opens-by-field(ATC-297, docs/squelch.md): 어떤 필드가 바뀌어서 tick이 열렸고, 그 tick이 실제로 일을 했는가.
// 순수 함수만 둔다(입출력은 squelch-opens-run.ts). 값은 어디에도 없다: 필드 경로와 수만 센다.

export interface Decision {
  t: string;
  role: string;
  open: boolean;
  reason: string; // off | quiet | first | manual | signal | heartbeat | fail-open, shadow일 때는 앞에 `shadow:`
  would?: "open" | "quiet"; // v2가 on이었다면
  fields?: string[]; // v1 신호로 열렸을 때 바뀐 필드
  fields2?: string[];
}

// ATC-292(docs/research/control-skills.md): 도구 호출이 2번 이하면 quiet tick, 3번 이상이면 일을 한 tick
export const WORKED_MIN = 3;
// 한 tick의 끝은 같은 역할의 다음 열린 판정. 열린 판정이 없으면 이 시간 안에서 끊는다
export const TICK_WINDOW_MS = 30 * 60_000;
export const TOP_FIELDS = 15;

export type Verdict = "worked" | "idle" | "unknown";
const baseReason = (r: string) => r.replace(/^shadow:/, "");
// 판정이 한 tick을 열었는가(자연 열림: first·manual·signal·heartbeat). off·fail-open·quiet은 아니다
const NATURAL = new Set(["first", "manual", "signal", "heartbeat"]);
export const isNaturalOpen = (d: Decision) => NATURAL.has(baseReason(d.reason));

// uses: 그 역할 세션의 도구 호출 시각(ms, 오름차순). null이면 기록을 못 찾은 것
export function verdictOf(uses: readonly number[] | null, startMs: number, endMs: number, nowMs: number): Verdict {
  if (!uses) return "unknown";
  if (endMs > nowMs) return "unknown"; // 아직 끝나지 않은 tick
  let n = 0;
  for (const u of uses) if (u > startMs && u <= endMs) n++;
  return n >= WORKED_MIN ? "worked" : "idle";
}

export interface FieldRow {
  field: string;
  opens: number;
  idle: number; // 그 tick이 일을 하지 않았다
  worked: number;
  unknown: number;
}
export interface RoleOpens {
  decisions: number;
  opens: number; // 자연 열림 수
  reasons: Record<string, number>; // 판정 이유(shadow: 뗀 것)
  signal: { total: number; idle: number; worked: number; unknown: number };
  fields: FieldRow[]; // 신호 열림 가운데 일을 하지 않은 것이 많은 필드부터
  v2: { shadowed: number; wouldQuiet: number; wouldQuietIdle: number; wrongSkips: number; wouldQuietUnknown: number };
}

const blank = (): RoleOpens => ({ decisions: 0, opens: 0, reasons: {}, signal: { total: 0, idle: 0, worked: 0, unknown: 0 }, fields: [], v2: { shadowed: 0, wouldQuiet: 0, wouldQuietIdle: 0, wrongSkips: 0, wouldQuietUnknown: 0 } });

export function opensTable(decisions: readonly Decision[], usesOf: (role: string) => number[] | null, nowMs: number): Record<string, RoleOpens> {
  const out: Record<string, RoleOpens> = {};
  const byRole = new Map<string, Decision[]>();
  for (const d of [...decisions].sort((a, b) => a.t.localeCompare(b.t))) (byRole.get(d.role) ?? byRole.set(d.role, []).get(d.role)!).push(d);
  for (const [role, list] of byRole) {
    const r = (out[role] = blank());
    const uses = usesOf(role);
    const fields = new Map<string, FieldRow>();
    list.forEach((d, i) => {
      r.decisions++;
      const base = baseReason(d.reason);
      r.reasons[base] = (r.reasons[base] ?? 0) + 1;
      if (d.would) r.v2.shadowed++;
      if (!isNaturalOpen(d)) return;
      r.opens++;
      const start = Date.parse(d.t);
      // 이 tick의 끝: 같은 역할의 다음 열린 판정(없으면 TICK_WINDOW_MS)
      const next = list.slice(i + 1).find((x) => x.open);
      const end = Math.min(next ? Date.parse(next.t) : Infinity, start + TICK_WINDOW_MS);
      const v = verdictOf(uses, start, end, nowMs);
      if (base === "signal") {
        r.signal.total++;
        r.signal[v === "idle" ? "idle" : v === "worked" ? "worked" : "unknown"]++;
        for (const f of d.fields ?? []) {
          const row = fields.get(f) ?? { field: f, opens: 0, idle: 0, worked: 0, unknown: 0 };
          row.opens++;
          row[v === "idle" ? "idle" : v === "worked" ? "worked" : "unknown"]++;
          fields.set(f, row);
        }
      }
      if (d.would === "quiet") {
        r.v2.wouldQuiet++;
        if (v === "idle") r.v2.wouldQuietIdle++;
        else if (v === "worked") r.v2.wrongSkips++; // v2가 버렸을 tick이 실제로 일을 했다
        else r.v2.wouldQuietUnknown++;
      }
    });
    r.fields = [...fields.values()].sort((a, b) => b.idle - a.idle || b.opens - a.opens || a.field.localeCompare(b.field)).slice(0, TOP_FIELDS);
  }
  return out;
}

// 읽은 줄 하나가 판정인가(모르는 줄은 건너뛴다)
export function decisionOf(raw: string): Decision | null {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (typeof o.t !== "string" || Number.isNaN(Date.parse(o.t)) || typeof o.role !== "string" || typeof o.reason !== "string") return null;
    const strs = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : undefined);
    return {
      t: o.t,
      role: o.role,
      open: o.open === true,
      reason: o.reason,
      ...(o.would === "open" || o.would === "quiet" ? { would: o.would } : {}),
      ...(strs(o.fields) ? { fields: strs(o.fields) } : {}),
      ...(strs(o.fields2) ? { fields2: strs(o.fields2) } : {}),
    };
  } catch {
    return null;
  }
}

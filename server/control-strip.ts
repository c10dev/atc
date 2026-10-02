import type { ControlLive, ControlSession } from "./control-view.ts";
import type { Session } from "./model.ts";

// 헤더 CONTROL 띠의 계산(ATC-127). 브라우저에서도 도는 순수 함수만 둔다(타입만 import). 화면은 web/src/ControlPanel.tsx(ATC-445).
// 관제 세션마다 칩 하나: FLEET CONTROL SESSIONS가 아는 것(배지·job·NEEDS YOU)과 snapshot의 마지막 활동·health, SQUELCH의 마지막 tick.

export const STRIP_CODES: Record<string, string> = { TOWER: "TWR", OCC: "OCC", MCC: "MCC", CROSSCHECK: "XCHK", REVIEW: "REV", ENGINEERING: "ENG" };
export type StripState = "ok" | "working" | "needs" | "late" | "down";
export type TickSource = "squelch" | "activity";
export type StripSession = Pick<Session, "name" | "status" | "lastActiveAt" | "health">;

export interface StripChip {
  name: string;
  code: string;
  state: StripState;
  intervalMin: number | null; // 첫 메시지 `/loop <n>m …`의 n. 모르면 null(ENGINEERING 포함)
  lastTickAt: string | null;
  lastTickSource: TickSource | null; // squelch: SQUELCH 판정 시각, activity: 세션의 lastActiveAt(SQUELCH 기록이 없을 때만)
  kind: string; // BG <id> | tmux <세션> | interactive | not running
  title: string; // 툴팁(줄바꿈으로 구분)
}

// `/loop 3m /tick` → 3. 없거나 분 단위가 아니면 null
export const loopIntervalOf = (prompt: string | null | undefined): number | null => {
  const m = /^\s*\/loop\s+(\d+)m\b/.exec(prompt ?? "");
  return m ? Number(m[1]) : null;
};
// 마지막 tick이 이보다 오래되면 늦은 것: 2 × 주기 + 1분
export const lateAfterMin = (intervalMin: number): number => 2 * intervalMin + 1;

const hm = (iso: string) => `${iso.slice(11, 16)}Z`;
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

function kindOf(live: ControlLive[]): { kind: string; bg: ControlLive | undefined } {
  const bg = live.find((l) => l.kind === "background" && l.id);
  const tmux = bg ? undefined : live.find((l) => l.tmux);
  const other = live.find((l) => l !== bg);
  return { bg, kind: bg ? `BG ${bg.id}` : tmux ? `tmux ${tmux.tmux}` : other ? "interactive" : "not running" };
}

export function controlStripOf(sessions: ControlSession[] | null | undefined, snapshot: StripSession[] | null | undefined, now: number): StripChip[] {
  return (sessions ?? []).map((c): StripChip => {
    const code = STRIP_CODES[c.name] ?? c.name.slice(0, 4);
    const { kind, bg } = kindOf(c.live);
    const mine = (snapshot ?? []).filter((s) => s.name.toUpperCase() === c.name);
    const alive = mine.filter((s) => s.status !== "dead");
    // 살아 있는 줄이 없거나, 줄은 있는데 이름이 같은 세션이 모두 죽었으면 down
    const down = c.live.length === 0 || (mine.length > 0 && alive.length === 0);
    const lines: string[] = [`${c.name} · ${kind}`];
    if (c.name === "ENGINEERING") return { name: c.name, code, state: down ? "down" : "ok", intervalMin: null, lastTickAt: null, lastTickSource: null, kind, title: [...lines, down ? "down" : "up"].join("\n") };

    const intervalMin = loopIntervalOf(c.prompt);
    const job = bg?.job ?? null;
    const alertHealth = alive.map((s) => s.health).find((h) => h?.level === "alert") ?? null;
    const needs = job?.state === "blocked" || Boolean(job?.needs) || alertHealth !== null;
    // 마지막 tick: SQUELCH 판정이 있으면 그것, 없을 때만 세션의 마지막 활동
    const activityAt = alive.map((s) => s.lastActiveAt).filter((t): t is string => Boolean(t) && !Number.isNaN(Date.parse(t!))).sort().at(-1) ?? null;
    const sq = c.squelch ?? null;
    const lastTickAt = sq?.lastAt ?? activityAt;
    const lastTickSource: TickSource | null = sq?.lastAt ? "squelch" : activityAt ? "activity" : null;
    const last = ms(lastTickAt);
    const late = intervalMin !== null && Number.isFinite(last) && now - last > lateAfterMin(intervalMin) * 60_000;
    const state: StripState = down ? "down" : needs ? "needs" : late ? "late" : job?.state === "working" ? "working" : "ok";

    if (job) lines.push(`job ${job.state}${job.detail ? ` · ${job.detail}` : ""}`);
    if (job?.needs) lines.push(`NEEDS: ${job.needs}`);
    if (alertHealth) lines.push(`health ${alertHealth.code} (alert)`);
    lines.push(intervalMin !== null ? `loop ${intervalMin}m · late after ${lateAfterMin(intervalMin)}m` : "loop 주기 모름");
    if (lastTickAt && lastTickSource === "squelch") lines.push(`last tick ${hm(lastTickAt)} (SQUELCH ${sq!.open ? "OPEN" : "QUIET"}${sq!.reason ? ` · ${sq!.reason}` : ""})`);
    else if (lastTickAt) lines.push(`last tick ${hm(lastTickAt)} (activity — SQUELCH 기록 없음)`);
    else lines.push("last tick 모름");
    if (sq && (sq.openedAt || sq.quietCount > 0)) lines.push(`QUIET ${sq.quietCount}${sq.openedAt ? ` since last OPEN ${hm(sq.openedAt)}` : ""}`);
    if (down) lines.push(c.live.length === 0 ? "떠 있지 않음" : "세션이 죽음");
    return { name: c.name, code, state, intervalMin, lastTickAt, lastTickSource, kind, title: lines.join("\n") };
  });
}

// 좁은 화면의 한 칩: ok·working이면 "ok"로 세고, 하나라도 그 밖이면 down(빨강)이 우선, 아니면 amber
export function controlStripSummary(chips: StripChip[]): { ok: number; total: number; tone: "ok" | "amber" | "down" } {
  const ok = chips.filter((c) => c.state === "ok" || c.state === "working").length;
  return { ok, total: chips.length, tone: chips.some((c) => c.state === "down") ? "down" : ok < chips.length ? "amber" : "ok" };
}

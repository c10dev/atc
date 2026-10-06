// CONTROL SHARE(ATC-551, docs/control-plane.md W8): 관제 세션이 전체 토큰에서 차지하는 몫과, 일을 한 관제 turn 하나의 토큰.
// 순수 함수만 둔다(읽기는 control-share-run.ts). 숫자와 시각만 쓰고 본문은 어디에도 없다.

export const CONTROL_ROLES = ["tower", "mcc", "occ", "crosscheck", "review"] as const;
export type ControlRole = (typeof CONTROL_ROLES)[number];
// 일을 한 turn: 도구 호출이 3번 이상(docs/squelch.md의 opens 표와 같은 문턱, ATC-292)
export const WORKED_MIN = 3;

// 세션 하나의 turn 시작 시각(ms, 오름차순)과 도구 호출 시각(ms) → 일을 한 turn들의 시작 시각. turn은 다음 turn 시작 전까지
export function workingTurnStarts(turns: readonly number[], uses: readonly number[]): number[] {
  const ts = [...turns].sort((a, b) => a - b);
  const us = [...uses].sort((a, b) => a - b);
  const out: number[] = [];
  let j = 0;
  for (let i = 0; i < ts.length; i++) {
    const end = i + 1 < ts.length ? ts[i + 1]! : Infinity;
    while (j < us.length && us[j]! <= ts[i]!) j++;
    let n = 0;
    for (let k = j; k < us.length && us[k]! <= end && n < WORKED_MIN; k++) n++;
    if (n >= WORKED_MIN) out.push(ts[i]!);
  }
  return out;
}

export interface TokenAt {
  session: string;
  t: string; // ISO
  tokens: number;
}
export interface ControlSession {
  session: string;
  role: string;
  turns: readonly number[];
  uses: readonly number[];
}
// 하루·역할 한 칸
export interface Cell {
  tokens: number; // 그 역할 세션의 토큰(CREW 포함)
  turns: number; // 그 역할의 turn 수
  working: number; // 그 가운데 도구 호출 3번 이상
}
export interface DayRow {
  day: string; // UTC YYYY-MM-DD
  all: number; // 그날 모든 세션의 토큰
  roles: Record<string, Cell>;
}
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function dayRows(tokens: readonly TokenAt[], sessions: readonly ControlSession[], fromMs: number, toMs: number): DayRow[] {
  const roleOf = new Map(sessions.map((s) => [s.session, s.role]));
  const rows = new Map<string, DayRow>();
  const row = (d: string) => rows.get(d) ?? rows.set(d, { day: d, all: 0, roles: {} }).get(d)!;
  const cell = (r: DayRow, role: string) => (r.roles[role] ??= { tokens: 0, turns: 0, working: 0 });
  for (const x of tokens) {
    const t = Date.parse(x.t);
    if (!(t >= fromMs && t < toMs)) continue;
    const r = row(day(t));
    r.all += x.tokens;
    const role = roleOf.get(x.session);
    if (role) cell(r, role).tokens += x.tokens;
  }
  for (const s of sessions) {
    const working = new Set(workingTurnStarts(s.turns, s.uses));
    for (const t of s.turns) {
      if (!(t >= fromMs && t < toMs)) continue;
      const c = cell(row(day(t)), s.role);
      c.turns++;
      if (working.has(t)) c.working++;
    }
  }
  return [...rows.values()].sort((a, b) => a.day.localeCompare(b.day));
}

// 몫(%, 소수 한 자리)과 일을 한 turn 하나의 토큰. 나눌 수 없으면 null
export const sharePct = (control: number, all: number): number | null => (all > 0 ? Math.round((control / all) * 1000) / 10 : null);
export const perWorking = (tokens: number, working: number): number | null => (working > 0 ? Math.round(tokens / working) : null);

export interface ControlSummary {
  all: number;
  tokens: number;
  turns: number;
  working: number;
  share: number | null;
  perWorking: number | null;
}
export function summarize(rows: readonly DayRow[], role?: string): ControlSummary {
  let all = 0;
  let tokens = 0;
  let turns = 0;
  let working = 0;
  for (const r of rows) {
    all += r.all;
    for (const [k, c] of Object.entries(r.roles)) {
      if (role && k !== role) continue;
      tokens += c.tokens;
      turns += c.turns;
      working += c.working;
    }
  }
  return { all, tokens, turns, working, share: sharePct(tokens, all), perWorking: perWorking(tokens, working) };
}

// ── Measure(`control:<이름>`) ──
// share(모든 관제), share-<역할>, tokens-per-turn(모든 관제), tokens-per-turn-<역할>. 값 단위: share는 %, tokens-per-turn은 천 토큰(K)
export const CONTROL_NAMES = ["share", "tokens-per-turn", ...CONTROL_ROLES.flatMap((r) => [`share-${r}`, `tokens-per-turn-${r}`])] as readonly string[];
export const isControlName = (n: string) => CONTROL_NAMES.includes(n.toLowerCase());

export interface ControlData {
  rows: readonly DayRow[];
  coverage: number | null; // 토큰 기록이 있는 가장 이른 날의 0시(ms). 그 앞은 "없었다"가 아니라 "몰랐다"
}
export const controlDataOf = (rows: readonly DayRow[]): ControlData => ({ rows, coverage: rows.length ? Date.parse(`${rows[0]!.day}T00:00:00Z`) : null });

// 창 [from, to)의 값. n은 표본(share는 날 수, tokens-per-turn은 일을 한 turn 수). 값이 없으면 value null
export function controlValueOf(name: string, d: Pick<{ control?: ControlData }, "control">, from: number, to: number): { value: number | null; n: number } {
  if (!d.control || !isControlName(name)) return { value: null, n: 0 };
  const n0 = name.toLowerCase();
  const rows = d.control.rows.filter((r) => Date.parse(`${r.day}T00:00:00Z`) >= from && Date.parse(`${r.day}T00:00:00Z`) < to);
  const per = n0.startsWith("tokens-per-turn");
  const role = n0.slice((per ? "tokens-per-turn" : "share").length + 1) || undefined;
  const s = summarize(rows, role);
  if (per) return { value: s.perWorking === null ? null : Math.round(s.perWorking / 100) / 10, n: s.working };
  return { value: s.share, n: rows.filter((r) => r.all > 0).length };
}

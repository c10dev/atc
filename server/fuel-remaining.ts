import type { FuelStatusRecord, FuelWindowName } from "../hooks/fuel-statusline.mjs";
import { hhmm } from "./health.ts";

// FUEL REMAINING(ATC-55, docs/fuel.md 6): statusline hook(hooks/fuel-statusline.mjs)이 남긴 rate_limits를
// session → AIRCRAFT → ACCOUNT로 잇고, ACCOUNT마다 가장 새 값을 쓴다. 순수 함수만 둔다(화면도 쓴다). 파일 읽기는 fuel-run.ts의 readFuelRecords
// 백분율은 쓴 몫(used)이다. 임계값도 쓴 몫으로 잰다(INFO 80 %, HOLD 95 %).

export interface FuelConfig {
  infoPct: number; // 이 이상이면 TOWER·OCC에 INFO
  holdPct: number; // 이 이상이고 hold가 켜져 있으면 DISPATCH가 건너뛴다(D3)
  hold: boolean; // SUPERVISOR 스위치. 기본 꺼짐
}
export const DEFAULT_FUEL: FuelConfig = { infoPct: 80, holdPct: 95, hold: false };

export interface FuelWindow {
  name: FuelWindowName;
  pct: number; // 쓴 몫 0–100
  resetsAt: string;
}

export interface FuelRemaining {
  group: string; // ACCOUNT 라벨, 모르면 aircraft:<REGISTRATION>
  account: string | null;
  at: string; // 그 값을 적은 시각(statusline)
  from: string; // 그 값을 적은 세션의 REGISTRATION
  windows: FuelWindow[]; // reset이 아직 오지 않은 창
  top: FuelWindow; // 가장 많이 쓴 창(먼저 막히는 창)
  level: "ok" | "info" | "hold"; // 임계값 기준. hold는 스위치와 상관없이 holdPct 이상
  aircraft: string[]; // 같은 ACCOUNT(모르면 그 AIRCRAFT 하나)
}

const WINDOWS: FuelWindowName[] = ["five_hour", "seven_day", "spend_limit"];
const SHORT: Record<FuelWindowName, string> = { five_hour: "5h", seven_day: "7d", spend_limit: "spend" };

// 설정값 검사: 1–100의 숫자, hold는 true일 때만 켠다
export function fuelConfigOf(raw: unknown): FuelConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pct = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 100 ? v : d);
  const infoPct = pct(r.infoPct, DEFAULT_FUEL.infoPct);
  return { infoPct, holdPct: Math.max(infoPct, pct(r.holdPct, DEFAULT_FUEL.holdPct)), hold: r.hold === true };
}

// 기록 하나의 창들. reset이 지난 창은 뺀다(그 창의 몫은 이미 0으로 돌아갔다)
export function windowsOf(rec: FuelStatusRecord, now: number): FuelWindow[] {
  return WINDOWS.flatMap((name) => {
    const w = rec.rate_limits[name];
    return w && w.resets_at * 1000 > now ? [{ name, pct: w.used_percentage, resetsAt: new Date(w.resets_at * 1000).toISOString() }] : [];
  });
}

const levelOf = (pct: number, cfg: FuelConfig): FuelRemaining["level"] => (pct >= cfg.holdPct ? "hold" : pct >= cfg.infoPct ? "info" : "ok");

// AIRCRAFT마다 그 ACCOUNT의 가장 새 값. ACCOUNT를 모르면(null) 그 AIRCRAFT 자신의 세션 값만 쓴다.
// sessions: 이름이 REGISTRATION인 세션(죽은 세션도 — 마지막 값은 reset까지 유효하다)
export function fuelRemainingOf(
  aircraft: { registration: string; account: string | null; sessionIds: string[] }[],
  records: FuelStatusRecord[],
  cfg: FuelConfig,
  now: number,
): Record<string, FuelRemaining> {
  const bySession = new Map(records.map((r) => [r.sessionId, r]));
  const groups = new Map<string, { account: string | null; members: typeof aircraft }>();
  for (const a of aircraft) {
    const key = a.account ?? `aircraft:${a.registration.toUpperCase()}`;
    const g = groups.get(key) ?? { account: a.account, members: [] };
    g.members.push(a);
    groups.set(key, g);
  }
  const out: Record<string, FuelRemaining> = {};
  for (const [group, g] of groups) {
    let best: { rec: FuelStatusRecord; windows: FuelWindow[]; from: string } | null = null;
    for (const a of g.members) {
      for (const id of a.sessionIds) {
        const rec = bySession.get(id);
        if (!rec) continue;
        const windows = windowsOf(rec, now);
        if (windows.length && (!best || Date.parse(rec.t) > Date.parse(best.rec.t))) best = { rec, windows, from: a.registration.toUpperCase() };
      }
    }
    if (!best) continue;
    const top = best.windows.reduce((x, y) => (y.pct > x.pct ? y : x));
    const f: FuelRemaining = {
      group,
      account: g.account,
      at: best.rec.t,
      from: best.from,
      windows: best.windows,
      top,
      level: levelOf(top.pct, cfg),
      aircraft: g.members.map((a) => a.registration.toUpperCase()).sort(),
    };
    for (const a of g.members) out[a.registration.toUpperCase()] = f;
  }
  return out;
}

// DISPATCH HOLD(D3): 스위치가 켜져 있고 holdPct 이상일 때만
export const fuelHolds = (f: FuelRemaining | null | undefined, cfg: FuelConfig) => Boolean(f && cfg.hold && f.top.pct >= cfg.holdPct);

const pctText = (p: number) => `${Math.round(p)}%`;

// FLEET 줄: FUEL 82% · resets 21:00Z (가장 많이 쓴 창)
export const fuelLabel = (f: FuelRemaining, now: number) => `FUEL ${pctText(f.top.pct)} · resets ${hhmm(Date.parse(f.top.resetsAt), now)}`;

// 툴팁: 창마다 쓴 몫과 reset, 언제 누가 적었나
export const fuelTitle = (f: FuelRemaining, now: number) =>
  `${f.account ? `ACCOUNT ${f.account} · ` : ""}쓴 몫 ${f.windows.map((w) => `${SHORT[w.name]} ${pctText(w.pct)} (reset ${hhmm(Date.parse(w.resetsAt), now)})`).join(", ")} · ${f.from} statusline ${hhmm(Date.parse(f.at), now)}`;

// DISPATCH 사유: HOLD · FUEL 96% (account pro-2) until 21:00Z
export const fuelHoldReason = (f: FuelRemaining, now: number) =>
  `HOLD · FUEL ${pctText(f.top.pct)}${f.account ? ` (account ${f.account})` : ""} until ${hhmm(Date.parse(f.top.resetsAt), now)} — ${SHORT[f.top.name]} 한도의 ${pctText(f.top.pct)}를 씀`;

export interface FuelInfo {
  key: string; // 같은 ACCOUNT·창·reset이면 같은 키 — 한 번만 알린다
  account: string | null;
  aircraft: string[];
  window: FuelWindowName;
  pct: number;
  resetsAt: string;
  level: "info" | "hold";
  text: string;
}

// TOWER·OCC에 알릴 것: infoPct 이상인 ACCOUNT(모르면 AIRCRAFT)마다 하나
export function fuelInfos(byAircraft: Record<string, FuelRemaining>, now: number): FuelInfo[] {
  const seen = new Map<string, FuelRemaining>();
  for (const f of Object.values(byAircraft)) if (f.level !== "ok") seen.set(f.group, f);
  return [...seen.values()]
    .sort((a, b) => b.top.pct - a.top.pct || a.group.localeCompare(b.group))
    .map((f) => ({
      key: `fuel|${f.group}|${f.top.name}|${f.top.resetsAt}`,
      account: f.account,
      aircraft: f.aircraft,
      window: f.top.name,
      pct: f.top.pct,
      resetsAt: f.top.resetsAt,
      level: f.level as "info" | "hold",
      text: `${fuelLabel(f, now)}${f.account ? ` (account ${f.account})` : ""} — ${f.aircraft.join(", ")}`,
    }));
}

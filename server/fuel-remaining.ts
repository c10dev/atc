import type { FuelLimitsRecord, FuelWindowName } from "../hooks/fuel-statusline.mjs";
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
  group: string; // ACCOUNT 라벨, 모르면 aircraft:<REGISTRATION>이나 control:<이름>
  account: string | null;
  at: string; // 그 값을 적은 시각(statusline)
  from: string; // 그 값을 적은 세션의 REGISTRATION이나 관제 이름
  fromKind: "aircraft" | "control";
  windows: FuelWindow[]; // reset이 아직 오지 않은 창
  top: FuelWindow; // 가장 많이 쓴 창(먼저 막히는 창)
  level: "ok" | "info" | "hold"; // 임계값 기준. hold는 스위치와 상관없이 holdPct 이상
  aircraft: string[]; // 같은 ACCOUNT의 AIRCRAFT(모르면 그 AIRCRAFT 하나)
  control: string[]; // 같은 ACCOUNT의 관제 세션(ATC-60). 붙들지 않는다 — 누가 쓰는지 보이기만
}

// ACCOUNT의 구성원 하나: AIRCRAFT나 관제 세션. sessionIds는 그 이름의 세션(죽은 세션도 — 마지막 값은 reset까지 유효하다)
export interface FuelMember {
  name: string;
  kind: "aircraft" | "control";
  account: string | null;
  sessionIds: string[];
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
export function windowsOf(rec: FuelLimitsRecord, now: number): FuelWindow[] {
  return WINDOWS.flatMap((name) => {
    const w = rec.rate_limits[name];
    return w && w.resets_at * 1000 > now ? [{ name, pct: w.used_percentage, resetsAt: new Date(w.resets_at * 1000).toISOString() }] : [];
  });
}

const levelOf = (pct: number, cfg: FuelConfig): FuelRemaining["level"] => (pct >= cfg.holdPct ? "hold" : pct >= cfg.infoPct ? "info" : "ok");

// ACCOUNT마다 구성원(AIRCRAFT·관제 세션) 누구의 것이든 가장 새 기록 하나. ACCOUNT를 모르면(null) 구성원마다 따로 묶는다.
// 기록이 없는(또는 모든 창의 reset이 지난) ACCOUNT는 빠진다
export function fuelAccountsOf(members: FuelMember[], records: FuelLimitsRecord[], cfg: FuelConfig, now: number): FuelRemaining[] {
  const bySession = new Map(records.map((r) => [r.sessionId, r]));
  const groups = new Map<string, { account: string | null; members: FuelMember[] }>();
  for (const m of members) {
    const key = m.account ?? `${m.kind}:${m.name.toUpperCase()}`;
    const g = groups.get(key) ?? { account: m.account, members: [] };
    g.members.push(m);
    groups.set(key, g);
  }
  const out: FuelRemaining[] = [];
  for (const [group, g] of groups) {
    let best: { rec: FuelLimitsRecord; windows: FuelWindow[]; from: FuelMember } | null = null;
    for (const m of g.members) {
      for (const id of m.sessionIds) {
        const rec = bySession.get(id);
        if (!rec) continue;
        const windows = windowsOf(rec, now);
        if (windows.length && (!best || Date.parse(rec.t) > Date.parse(best.rec.t))) best = { rec, windows, from: m };
      }
    }
    if (!best) continue;
    const top = best.windows.reduce((x, y) => (y.pct > x.pct ? y : x));
    const names = (kind: FuelMember["kind"]) => [...new Set(g.members.filter((m) => m.kind === kind).map((m) => m.name.toUpperCase()))].sort();
    out.push({
      group,
      account: g.account,
      at: best.rec.t,
      from: best.from.name.toUpperCase(),
      fromKind: best.from.kind,
      windows: best.windows,
      top,
      level: levelOf(top.pct, cfg),
      aircraft: names("aircraft"),
      control: names("control"),
    });
  }
  return out.sort((a, b) => b.top.pct - a.top.pct || a.group.localeCompare(b.group));
}

// AIRCRAFT(REGISTRATION 대문자)마다 그 ACCOUNT의 값. FLEET 줄·DISPATCH·FOLLOWING이 쓴다
export function fuelByAircraft(accounts: FuelRemaining[]): Record<string, FuelRemaining> {
  const out: Record<string, FuelRemaining> = {};
  for (const f of accounts) for (const a of f.aircraft) out[a] = f;
  return out;
}

// AIRCRAFT만 있을 때의 짧은 길(F6). 관제 세션은 fuelAccountsOf에 control 구성원으로 넣는다
export function fuelRemainingOf(
  aircraft: { registration: string; account: string | null; sessionIds: string[] }[],
  records: FuelLimitsRecord[],
  cfg: FuelConfig,
  now: number,
): Record<string, FuelRemaining> {
  return fuelByAircraft(fuelAccountsOf(aircraft.map((a) => ({ name: a.registration, kind: "aircraft", account: a.account, sessionIds: a.sessionIds })), records, cfg, now));
}

// 구성원 글: TEAM_K, TEAM_L · control MCC
export const membersText = (f: Pick<FuelRemaining, "aircraft" | "control">) =>
  [f.aircraft.join(", "), f.control.length ? `control ${f.control.join(", ")}` : ""].filter(Boolean).join(" · ");

// DISPATCH HOLD(D3): 스위치가 켜져 있고 holdPct 이상일 때만
export const fuelHolds = (f: FuelRemaining | null | undefined, cfg: FuelConfig) => Boolean(f && cfg.hold && f.top.pct >= cfg.holdPct);

const pctText = (p: number) => `${Math.round(p)}%`;

// ACCOUNT의 사용 한도(ATC-81): 늘 쓴 몫이라고 적는다 — "FUEL 87%"는 남은 눈금처럼 읽힌다. 남은 몫은 AIRCRAFT 자기 연료 FOB(fuel-context.ts)
// FLEET FUEL 블록·카드: 사용 82% · resets 21:00Z (가장 많이 쓴 창)
export const fuelLabel = (f: FuelRemaining, now: number) => `사용 ${pctText(f.top.pct)} · resets ${hhmm(Date.parse(f.top.resetsAt), now)}`;

// 관제·FLEET PLAN 글에 끼우는 꼴: FUEL 사용 82% · resets 21:00Z
export const fuelUsedText = (f: FuelRemaining, now: number) => `FUEL ${fuelLabel(f, now)}`;

// 툴팁: 창마다 쓴 몫과 reset, 언제 누가 적었나
export const fuelTitle = (f: FuelRemaining, now: number) =>
  `${f.account ? `ACCOUNT ${f.account} · ` : ""}사용 ${f.windows.map((w) => `${SHORT[w.name]} ${pctText(w.pct)} (reset ${hhmm(Date.parse(w.resetsAt), now)})`).join(", ")} · ${f.fromKind === "control" ? "control " : ""}${f.from} statusline ${hhmm(Date.parse(f.at), now)}${f.control.length ? ` · 같은 ACCOUNT의 관제 세션 ${f.control.join(", ")}` : ""}`;

// FLEET 줄의 HOLD 꼬리표: HOLD · FUEL (account pro-2) until 21:00Z. %는 싣지 않는다 — 붙드는 사실만
export const fuelHoldTag = (f: FuelRemaining, now: number) =>
  `HOLD · FUEL${f.account ? ` (account ${f.account})` : ""} until ${hhmm(Date.parse(f.top.resetsAt), now)}`;

// DISPATCH 사유: HOLD · FUEL (account pro-2) until 21:00Z — 5h 한도 사용 96%
export const fuelHoldReason = (f: FuelRemaining, now: number) => `${fuelHoldTag(f, now)} — ${SHORT[f.top.name]} 한도 사용 ${pctText(f.top.pct)}`;

export interface FuelInfo {
  key: string; // 같은 ACCOUNT·창·reset이면 같은 키 — 한 번만 알린다
  account: string | null;
  aircraft: string[];
  control: string[]; // 같은 ACCOUNT의 관제 세션(ATC-60)
  window: FuelWindowName;
  pct: number;
  resetsAt: string;
  level: "info" | "hold";
  text: string;
}

// TOWER·OCC에 알릴 것: infoPct 이상인 ACCOUNT(모르면 AIRCRAFT)마다 하나
// accounts: fuelAccountsOf의 결과(관제 세션만 있는 ACCOUNT도 들어간다). AIRCRAFT별 Record를 줘도 된다
export function fuelInfos(accounts: FuelRemaining[] | Record<string, FuelRemaining>, now: number): FuelInfo[] {
  const seen = new Map<string, FuelRemaining>();
  for (const f of Array.isArray(accounts) ? accounts : Object.values(accounts)) if (f.level !== "ok") seen.set(f.group, f);
  return [...seen.values()]
    .sort((a, b) => b.top.pct - a.top.pct || a.group.localeCompare(b.group))
    .map((f) => ({
      key: `fuel|${f.group}|${f.top.name}|${f.top.resetsAt}`,
      account: f.account,
      aircraft: f.aircraft,
      control: f.control,
      window: f.top.name,
      pct: f.top.pct,
      resetsAt: f.top.resetsAt,
      level: f.level as "info" | "hold",
      text: `${fuelUsedText(f, now)}${f.account ? ` (account ${f.account})` : ""} — ${membersText(f)}`,
    }));
}

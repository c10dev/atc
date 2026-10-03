import { compareRegistration, TEAM_REGISTRATION } from "../../server/registration.ts";
import type { Freq, Transmission } from "../../server/radio.ts";

// RADIO 탭(ATC-171)의 순수 계산: 합치기, 거르기, 답 묶기, 나이·overdue, 링크, 되감기. 화면(views/Radio.tsx)과 분리해 node:test로 본다.

export const FREQS: readonly Freq[] = ["DELIVERY", "TOWER", "GROUND", "COMPANY", "PREFLIGHT"];
export const WINDOW_MS = 6 * 3_600_000; // 서버 GET /api/radio의 기본 창(R1)
// 되감기에서 열린 호출을 overdue로 세는 기준. 서버의 규칙(FLIGHT PLAN·RECALL·CREW CHANGE·CLEARANCE READBACK 10분)과 같다.
// 서버는 답이 붙으면 overdueAt을 지우므로, 되감기는 호출 시각 + 10분으로 센다(STANDBY로 다시 세는 것은 되감기에서 무시)
export const REPLAY_OVERDUE_MS = 10 * 60_000;
export const SPEEDS = [1, 4, 16] as const;
export type Speed = (typeof SPEEDS)[number];

export interface Filter {
  freqs: ReadonlySet<Freq>;
  airport: string | null;
  aircraft: string | null;
}
export const ALL_FILTER: Filter = { freqs: new Set(FREQS), airport: null, aircraft: null };

const at = (t: Transmission) => Date.parse(t.at);

// 기존 목록에 들어온 교신을 id로 합친다(같은 id는 새것으로). 시각순(같으면 호출 먼저, 들어온 순서), 6시간 창 밖은 버린다
export function mergeTx(prev: readonly Transmission[], incoming: readonly Transmission[], now: number): Transmission[] {
  const byId = new Map(prev.map((t) => [t.id, t]));
  for (const t of incoming) byId.set(t.id, t);
  const order = new Map([...byId.keys()].map((id, i) => [id, i]));
  return [...byId.values()]
    .filter((t) => now - at(t) <= WINDOW_MS && Number.isFinite(at(t)))
    .sort((a, b) => at(a) - at(b) || Number(Boolean(a.replyTo)) - Number(Boolean(b.replyTo)) || order.get(a.id)! - order.get(b.id)!);
}

export const passes = (t: Transmission, f: Filter) =>
  f.freqs.has(t.freq) && (!f.airport || t.airport === f.airport) && (!f.aircraft || t.aircraft === f.aircraft);

export const filterTx = (txs: readonly Transmission[], f: Filter) => txs.filter((t) => passes(t, f));

// 필터에 쓸 값 목록(정렬, 중복 없음)
export function optionsOf(txs: readonly Transmission[], key: "airport" | "aircraft"): string[] {
  return [...new Set(txs.map((t) => t[key]).filter((v): v is string => Boolean(v)))].sort(key === "aircraft" ? compareRegistration : undefined);
}

// 한 FLIGHT의 교신(ATC-379, FLIGHT 서랍): flight가 그 FLIGHT인 호출과 그 호출의 답. 답은 flight 칸이 없을 수 있어 호출 id로 따라간다
export function flightTx(txs: readonly Transmission[], flight: string): Transmission[] {
  const calls = new Set(txs.filter((t) => !t.replyTo && t.flight === flight).map((t) => t.id));
  return txs.filter((t) => (t.replyTo ? calls.has(t.replyTo) || t.flight === flight : calls.has(t.id)));
}

export interface Thread {
  tx: Transmission;
  replies: Transmission[];
}

// 답을 그 호출 밑으로 묶는다. 호출이 목록에 없는 답(orphan이거나 필터·창 밖)은 스스로 한 줄이 된다.
// 같은 호출의 답은 시각순
export function threadsOf(txs: readonly Transmission[]): Thread[] {
  const calls = new Map<string, Thread>();
  const out: Thread[] = [];
  for (const t of txs) {
    if (t.replyTo) continue;
    const th = { tx: t, replies: [] };
    calls.set(t.id, th);
    out.push(th);
  }
  const rest: Thread[] = [];
  for (const t of txs) {
    if (!t.replyTo) continue;
    const th = calls.get(t.replyTo);
    if (th) th.replies.push(t);
    else rest.push({ tx: t, replies: [] });
  }
  return [...out, ...rest].sort((a, b) => at(a.tx) - at(b.tx));
}

// 되감기 시각(ms)의 화면: 그때까지 있던 교신만, 호출은 그때 열려 있었는지를 다시 정한다.
// (호출이 그때 열려 있었다 = 서버가 아직 열어 둔 것이거나, 닫는 답이 cursor 뒤에 있다)
export function asOf(txs: readonly Transmission[], cursor: number): Transmission[] {
  const laterReply = new Set<string>();
  for (const t of txs) if (t.replyTo && at(t) > cursor && t.kind !== "STANDBY") laterReply.add(t.replyTo);
  return txs
    .filter((t) => at(t) <= cursor)
    .map((t) => (!t.replyTo && !t.open && laterReply.has(t.id) ? { ...t, open: true as const, overdueAt: new Date(at(t) + REPLAY_OVERDUE_MS).toISOString() } : t));
}

// 열린 호출의 나이 "4분"·"1시간 2분"
export function ageText(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 1) return "1분 미만";
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h}시간 ${min % 60}분` : `${h}시간`;
}

export type OpenState = { kind: "open"; ageMs: number } | { kind: "overdue"; ageMs: number } | null;
export function openState(t: Transmission, now: number): OpenState {
  if (!t.open || t.replyTo) return null;
  const ageMs = now - at(t);
  return t.overdueAt && now > Date.parse(t.overdueAt) ? { kind: "overdue", ageMs } : { kind: "open", ageMs };
}

export interface Link {
  href: string;
  label: string;
}
export const REPO_URL = "https://github.com/chaehy5665/atc";
const baseId = (id: string) => id.split("#")[0];

// 이 교신이 속한 화면으로 가는 링크(최대 둘): 기록(PR · DISPATCH · STRIPS · FLEET)과 AIRCRAFT의 FLEET 카드
export function linksOf(t: Transmission): Link[] {
  const out: Link[] = [];
  const id = baseId(t.replyTo ?? t.id);
  if (t.pr) out.push({ href: `${REPO_URL}/pull/${t.pr}`, label: `PR #${t.pr}` });
  else if (/^D-\d+/.test(id)) out.push({ href: "#home", label: id });
  else if (/^CC-\d+/.test(id) && t.aircraft) out.push({ href: `#fleet/${encodeURIComponent(t.aircraft)}`, label: id });
  else if (/^C-\d+/.test(id)) out.push({ href: "#flights", label: id });
  if (t.aircraft && TEAM_REGISTRATION.test(t.aircraft) && !out.some((l) => l.href.startsWith("#fleet/"))) out.push({ href: `#fleet/${encodeURIComponent(t.aircraft)}`, label: t.aircraft });
  return out;
}

// head "TOWER → GOLF · GO AROUND · ATC-147" → 스테이션 부분과 나머지
export function splitHead(head: string): { stations: string; rest: string } {
  const i = head.indexOf(" · ");
  return i < 0 ? { stations: head, rest: "" } : { stations: head.slice(0, i), rest: head.slice(i + 3) };
}

// ── localStorage(atc.radio.*): 못 읽으면 전부 보기 ──
const KEY = { freqs: "atc.radio.freqs", airport: "atc.radio.airport", aircraft: "atc.radio.aircraft" } as const;

export function loadFilter(storage: Pick<Storage, "getItem"> | null): Filter {
  try {
    if (!storage) return ALL_FILTER;
    const raw = storage.getItem(KEY.freqs);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const freqs = Array.isArray(parsed) ? parsed.filter((f): f is Freq => (FREQS as readonly unknown[]).includes(f)) : [];
    // PREFLIGHT가 생기기 전에 저장된 "네 주파수 전부"는 전부 보기로 읽는다
    if (freqs.length === FREQS.length - 1 && !freqs.includes("PREFLIGHT")) freqs.push("PREFLIGHT");
    return { freqs: freqs.length ? new Set(freqs) : ALL_FILTER.freqs, airport: storage.getItem(KEY.airport) || null, aircraft: storage.getItem(KEY.aircraft) || null };
  } catch {
    return ALL_FILTER;
  }
}

export function saveFilter(storage: Pick<Storage, "setItem" | "removeItem"> | null, f: Filter) {
  try {
    if (!storage) return;
    storage.setItem(KEY.freqs, JSON.stringify([...f.freqs]));
    for (const k of ["airport", "aircraft"] as const) f[k] ? storage.setItem(KEY[k], f[k]!) : storage.removeItem(KEY[k]);
  } catch {}
}

// ── 스테이션 필터(ATC-446): RADIO 사이드바. 관제 세션(TOWER·OCC·MCC·REVIEW·DUTY …)과 AIRCRAFT를 나누어 센다 ──
export interface Station {
  id: string; // 관제는 이름 그대로(TOWER), AIRCRAFT는 REGISTRATION(TEAM_G)
  label: string; // AIRCRAFT는 콜사인(GOLF), 관제는 id
  kind: "control" | "aircraft";
}
export interface StationCount extends Station {
  count: number;
}
const CONTROL_ORDER = ["TOWER", "OCC", "MCC", "REVIEW", "DUTY"];
// 서버가 보낸 쪽을 알 수 없을 때 채우는 자리 이름(server/radio.ts)과 CROSSCHECK 판정 줄의 보낸 쪽은 스테이션이 아니다. 그 줄은 aircraft로 거른다
const NOT_STATIONS = ["ALL", "?", "AIRCRAFT", "CROSSCHECK"];

// 교신의 "TOWER" · "GOLF (TEAM_G)" → 스테이션. 모두에게 하는 방송("ALL")과 빈 값, 자리 이름은 스테이션이 아니다
export function stationOf(name: string): Station | null {
  const n = name.trim();
  if (!n || NOT_STATIONS.includes(n)) return null;
  const m = /^(.*?)\s*\(([^()]+)\)$/.exec(n);
  return m ? { id: m[2], label: m[1] || m[2], kind: "aircraft" } : { id: n, label: n, kind: "control" };
}

// 이 스테이션들의 id(보낸 쪽, 받는 쪽, 그리고 aircraft). PREFLIGHT 줄(CROSSCHECK → OCC, HOLD → ALL)은 AIRCRAFT가 보낸·받는 쪽에 없고 aircraft에만 있다
function stationsIn(t: Transmission): Station[] {
  const out = new Map<string, Station>();
  for (const s of [t.from, t.to]) {
    const st = stationOf(s);
    if (st && !out.has(st.id)) out.set(st.id, st);
  }
  if (t.aircraft && !out.has(t.aircraft)) out.set(t.aircraft, { id: t.aircraft, label: t.aircraft, kind: "aircraft" });
  return [...out.values()];
}

// 이 교신이 그 스테이션의 것인가(보낸 쪽이거나 받는 쪽이거나 그 교신의 AIRCRAFT). id가 null이면 전부
export function stationPasses(t: Transmission, id: string | null): boolean {
  if (!id) return true;
  return stationsIn(t).some((s) => s.id === id);
}
export const filterByStation = (txs: readonly Transmission[], id: string | null) => (id ? txs.filter((t) => stationPasses(t, id)) : [...txs]);

// 사이드바 목록: 스테이션마다 교신 수(stationPasses와 같은 규칙, 한 교신은 스테이션마다 한 번). 관제는 TOWER·OCC·MCC·REVIEW·DUTY 순 뒤에 이름순, AIRCRAFT는 REGISTRATION순
export function stationsOf(txs: readonly Transmission[]): { control: StationCount[]; aircraft: StationCount[] } {
  const by = new Map<string, StationCount>();
  for (const t of txs) {
    for (const st of stationsIn(t)) {
      const cur = by.get(st.id);
      if (cur) cur.count += 1;
      else by.set(st.id, { ...st, count: 1 });
    }
  }
  const rank = (id: string) => (CONTROL_ORDER.includes(id) ? CONTROL_ORDER.indexOf(id) : CONTROL_ORDER.length);
  const all = [...by.values()];
  return {
    control: all.filter((s) => s.kind === "control").sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id)),
    aircraft: all.filter((s) => s.kind === "aircraft").sort((a, b) => compareRegistration(a.id, b.id)),
  };
}

// 주소 #radio/<스테이션>에서 필터 값. #radio만이면 null(전부)
export function stationOfHash(hash: string): string | null {
  const [head, sub] = hash.replace(/^#/, "").split("/");
  if (head !== "radio" || !sub) return null;
  try {
    return decodeURIComponent(sub);
  } catch {
    return sub;
  }
}

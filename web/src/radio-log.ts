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

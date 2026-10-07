import { resendLinksOf } from "./clearance-resend.ts";
import type { Clearance, Session } from "./model.ts";

// 받는 세션이 끝난 CLEARANCE(ATC-567, 순수 함수). FLIGHT가 없는 열린 CLEARANCE의 받는 세션이 끝난 지 ENDED_GRACE_MS가 지나면
// 서버가 `undeliverable`(사유 "addressee ended")로 닫는다. 그래야 `clearances.pending[]`·`overdue`에서 빠지고 TOWER의 RESEND 고리가 멈춘다.
// FLIGHT가 있는 것은 CLEARANCE MOOT(ATC-515) 규칙 그대로다. 스위치는 SUPERVISOR만 바꾼다(기본 on). 읽기·쓰기는 clearance-ended-run.ts

export const ENDED_SWITCHES = ["off", "on"] as const;
export type EndedSwitch = (typeof ENDED_SWITCHES)[number];
export const parseEndedSwitch = (raw: unknown): EndedSwitch => (raw === "off" ? "off" : "on");

export const ENDED_REASON = "addressee ended";
export const ENDED_CAUSE = "absent"; // address.ts CAUSES. 사유 글만으로는 "other"가 되므로 원인을 적어 둔다
// 유예 2시간: NO READBACK(10분)과 RESTARTING(30분)보다 길어 overdue가 먼저 뜨고 /clear 뒤 새 세션은 닫히지 않는다.
// 서버 재시작(RTS)·호스트 재부팅 뒤 같은 세션이 돌아오는 시간도 넉넉히 덮고, TOWER의 RESEND·"답 없음" 보고가 한 번 돈 뒤 같은 날 안에 닫는다
export const ENDED_GRACE_MS = 2 * 3_600_000;
export const CAME_BACK_WINDOW_MS = 24 * 3_600_000; // 닫은 뒤 이 안에 같은 세션이 살아 돌아오면 MISFIRE(CLEARANCE MOOT의 24시간과 같다)
export const COUNT_DAYS = 7;

const isOpen = (c: Clearance) => !c.readbackAt && !c.unableAt && !c.cancelledAt;
const answered = (c: Clearance) => Boolean(c.readbackAt || c.unableAt);
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

export type EndedSession = Pick<Session, "id" | "status"> & Partial<Pick<Session, "lastActiveAt">>;

// FLEET과 같은 살아 있음: 스냅샷에 그 id의 세션이 있고 dead가 아니다. job이 사라진 세션(ATC-534)은 sources/claude.ts가 이미 dead로 읽는다
export const isLive = (sessions: readonly EndedSession[], id: string) => sessions.some((x) => x.id === id && x.status !== "dead");

export interface EndedInput {
  clearances: readonly Clearance[];
  sessions: readonly EndedSession[];
  restarting?: (toName: string) => boolean; // /clear 뒤 새 세션을 기다리는 AIRCRAFT(RESTARTING, ATC-91)의 이름이면 true: 닫지 않는다
  now: number;
}

// 언제부터 셀까: 보낸 시각, 첫 STANDBY, 받는 세션의 마지막 기록(세션 파일이 남은 dead 세션만 안다) 가운데 가장 늦은 것
function baseOf(c: Clearance, sessions: readonly EndedSession[]): number {
  const s = sessions.find((x) => x.id === c.to);
  return Math.max(...[c.at, c.standbyAt, s?.lastActiveAt].map(ms).filter((t) => !Number.isNaN(t)));
}

// 닫을 CLEARANCE. 조건: 열려 있고, FLIGHT가 없고, 받는 세션이 살아 있지 않고(RESTARTING도 아니고), 기준 시각에서 ENDED_GRACE_MS가 지났다.
// RESEND 고리(ATC-565)는 함께 닫는다: 고리의 하나가 조건을 채우면 고리의 열린 것을 모두(원래 것과 RESEND 모두, 막 나간 RESEND도) 닫는다.
// 고리의 하나라도 READBACK·ROGER·UNABLE을 받았으면 받는 이가 답한 것이라 고리를 닫지 않는다(answeredVia, overdue에서 이미 빠졌다).
// 살아 있는 세션이 스냅샷에 하나도 없으면(세션 폴더를 못 읽음) 아무것도 닫지 않는다
export function endedClosuresOf(i: EndedInput, sw: EndedSwitch): Clearance[] {
  if (sw === "off") return [];
  if (!i.sessions.some((x) => x.status !== "dead")) return [];
  const links = resendLinksOf(i.clearances);
  const byId = new Map(i.clearances.map((c) => [c.id, c]));
  const chainOf = (c: Clearance): Clearance[] => {
    const root = links.get(c.id)?.resendOf ?? c.id;
    return [root, ...(links.get(root)?.resentBy ?? [])].map((x) => byId.get(x)).filter((x): x is Clearance => Boolean(x));
  };
  const candidate = (c: Clearance) => isOpen(c) && !c.flight && !isLive(i.sessions, c.to) && !i.restarting?.(c.toName);
  const out = new Map<string, Clearance>();
  for (const c of i.clearances) {
    if (out.has(c.id) || !candidate(c)) continue;
    if (i.now - baseOf(c, i.sessions) <= ENDED_GRACE_MS) continue;
    const chain = chainOf(c);
    if (chain.some(answered)) continue;
    for (const x of chain) if (candidate(x)) out.set(x.id, x);
  }
  return [...out.values()];
}

// 기록(clearance-ended-events.jsonl, 추가만): closed = 서버가 이 CLEARANCE를 닫았다, misfire = 닫은 뒤 틀렸다고 드러났다
export type EndedMisfireWhy = "answered" | "came-back";
export type EndedEvent =
  | { op: "closed"; t: string; id: string; to: string; root: string }
  | { op: "misfire"; t: string; id: string; why: EndedMisfireWhy };

export function closedEvents(closed: readonly Clearance[], clearances: readonly Clearance[], now: number): EndedEvent[] {
  const links = resendLinksOf(clearances);
  return closed.map((c) => ({ op: "closed" as const, t: new Date(now).toISOString(), id: c.id, to: c.to, root: links.get(c.id)?.resendOf ?? c.id }));
}

const misfired = (events: readonly EndedEvent[]) => new Set(events.flatMap((e) => (e.op === "misfire" ? [e.id] : [])));

// MISFIRE "came-back": 닫은 뒤 CAME_BACK_WINDOW_MS 안에 같은 세션 id가 다시 살아 있다. id마다 한 번
export function cameBackMisfires(events: readonly EndedEvent[], sessions: readonly EndedSession[], now: number): EndedEvent[] {
  const counted = misfired(events);
  const out: EndedEvent[] = [];
  for (const e of events) {
    if (e.op !== "closed" || counted.has(e.id)) continue;
    if (now - Date.parse(e.t) > CAME_BACK_WINDOW_MS || !isLive(sessions, e.to)) continue;
    counted.add(e.id);
    out.push({ op: "misfire", t: new Date(now).toISOString(), id: e.id, why: "came-back" });
  }
  return out;
}

// MISFIRE "answered": 이 규칙이 닫은 CLEARANCE에 READBACK·ROGER·UNABLE·STANDBY가 왔다(닫혀 있어 답은 409로 거절되고 기록에 남지 않으니 답 경로가 부른다). id마다 한 번
export function answeredMisfire(events: readonly EndedEvent[], id: string, now: number): EndedEvent | null {
  if (!events.some((e) => e.op === "closed" && e.id === id) || misfired(events).has(id)) return null;
  return { op: "misfire", t: new Date(now).toISOString(), id, why: "answered" };
}

export interface EndedCounter {
  days: number;
  closed: number; // 최근 days일 닫은 CLEARANCE
  misfires: number; // 최근 days일 MISFIRE
  answered: number;
  cameBack: number;
}
export function endedCounterOf(events: readonly EndedEvent[], now: number, days = COUNT_DAYS): EndedCounter {
  const from = now - days * 86_400_000;
  const recent = events.filter((e) => Date.parse(e.t) >= from && Date.parse(e.t) <= now);
  const ids = (op: EndedEvent["op"], why?: EndedMisfireWhy) => new Set(recent.flatMap((e) => (e.op === op && (!why || (e.op === "misfire" && e.why === why)) ? [e.id] : []))).size;
  return { days, closed: ids("closed"), misfires: ids("misfire"), answered: ids("misfire", "answered"), cameBack: ids("misfire", "came-back") };
}

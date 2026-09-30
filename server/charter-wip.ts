import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";

// 진행 중인 CHARTER REQUEST(ATC-169, docs/control-recycle.md): SUPERVISOR가 OCC 세션에서 일을 요청해 AD HOC FLIGHT 초안(`schedule draft NEW`)으로 다듬는 동안,
// 그 요청이 대화에만 있으면 OCC를 다시 띄울 때 사라진다. 그래서 다듬는 동안 서버에 한 줄로 둔다.
// SCHEDULE 초안이 아니다: 상태 기계·발부·5건 한도와 무관하다(초안 한도에 세지 않고, 한도를 피하는 길도 아니다 — 초안은 그대로 `schedule draft NEW`로 쓴다).
// 원자적으로 바꿔 쓰는 JSON(charter-wip.json). 요청 글은 SUPERVISOR가 OCC에 한 말의 요약이라 짧게만 둔다.

export const WIP_TEXT_MAX = 600;
export const WIP_MAX_OPEN = 3; // 동시에 열어 둘 수 있는 수
export const WIP_KEEP_MS = 24 * 3_600_000; // 이만큼 손대지 않으면 서버가 버린다(영원히 남지 않게)

export interface CharterWip {
  id: string; // W-0001
  text: string; // 요청 요약(짧게, SUPERVISOR 말 그대로가 아니어도 된다)
  at: string; // 열린 시각
  touchedAt: string; // 마지막으로 손댄 시각
}

export class WipError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const idNum = (id: string) => Number(/^W-(\d+)$/.exec(id)?.[1] ?? 0);
const cleanText = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

// 오래 손대지 않은 것을 버린다(순수)
export function liveWips(items: readonly CharterWip[], now: number): CharterWip[] {
  return items.filter((w) => now - Date.parse(w.touchedAt) < WIP_KEEP_MS);
}

// 새로 연다(순수). 잘못이면 WipError
export function openWip(items: readonly CharterWip[], textRaw: unknown, now: number): { items: CharterWip[]; wip: CharterWip } {
  const text = cleanText(textRaw);
  if (!text) throw new WipError("요청 요약이 필요함");
  if (text.length > WIP_TEXT_MAX) throw new WipError(`요청 요약은 ${WIP_TEXT_MAX}자 이내`);
  const live = liveWips(items, now);
  if (live.length >= WIP_MAX_OPEN) throw new WipError(`진행 중인 CHARTER REQUEST가 ${WIP_MAX_OPEN}건 — 하나를 끝내거나 닫는다`, 409);
  const next = Math.max(0, ...items.map((w) => idNum(w.id))) + 1;
  const at = new Date(now).toISOString();
  const wip: CharterWip = { id: `W-${String(next).padStart(4, "0")}`, text, at, touchedAt: at };
  return { items: [...live, wip], wip };
}

// 손댄다(순수): 글을 고치면 바꾸고, 시각만 갱신할 수도 있다. 없으면 404
export function touchWip(items: readonly CharterWip[], id: string, textRaw: unknown, now: number): { items: CharterWip[]; wip: CharterWip } {
  const live = liveWips(items, now);
  const cur = live.find((w) => w.id === id);
  if (!cur) throw new WipError(`${id} 진행 중인 CHARTER REQUEST가 없음(24시간 넘게 손대지 않으면 서버가 버린다)`, 404);
  const text = textRaw === undefined || textRaw === null || textRaw === "" ? cur.text : cleanText(textRaw);
  if (!text) throw new WipError("요청 요약이 필요함");
  if (text.length > WIP_TEXT_MAX) throw new WipError(`요청 요약은 ${WIP_TEXT_MAX}자 이내`);
  const wip = { ...cur, text, touchedAt: new Date(now).toISOString() };
  return { items: live.map((w) => (w.id === id ? wip : w)), wip };
}

// 끝낸다(초안이 나왔거나 SUPERVISOR가 그만두라고 했다). 순수. 없으면 404
export function closeWip(items: readonly CharterWip[], id: string, now: number): CharterWip[] {
  const live = liveWips(items, now);
  if (!live.some((w) => w.id === id)) throw new WipError(`${id} 진행 중인 CHARTER REQUEST가 없음`, 404);
  return live.filter((w) => w.id !== id);
}

// schedule brief에 실을 모양: 손댄 지 몇 분인지를 붙인다
export function wipView(items: readonly CharterWip[], now: number) {
  return liveWips(items, now).map((w) => ({ ...w, idleMin: Math.max(0, Math.floor((now - Date.parse(w.touchedAt)) / 60_000)) }));
}

const FILE = () => join(config.stateDir, "charter-wip.json");

export function readWips(file = FILE()): CharterWip[] {
  try {
    const j = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(j.items) ? j.items.filter((w: unknown): w is CharterWip => Boolean(w) && typeof (w as CharterWip).id === "string" && typeof (w as CharterWip).text === "string" && typeof (w as CharterWip).touchedAt === "string") : [];
  } catch {
    return [];
  }
}

export function saveWips(items: readonly CharterWip[], file = FILE()) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ items }, null, 2) + "\n");
  renameSync(tmp, file);
}

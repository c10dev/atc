import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { allClearances } from "./clearances.ts";
import { type FlightPr, listedEvents, type MootEvent, type MootSwitch, mootClearancesOf, mootCounterOf, newMisfires, parseMootSwitch } from "./clearance-moot.ts";
import { config } from "./config.ts";
import type { Clearance, Snapshot } from "./model.ts";
import { loadLogbook } from "./logbook.ts";
import { record } from "./recorder.ts";

// 이유를 잃은 CLEARANCE의 읽고 쓰기(ATC-515). 규칙은 clearance-moot.ts(순수). 스위치는 clearance-moot.json(원자적 JSON, 기본 on)이고 설정 창에서만 바꾼다 — atcctl 명령은 없다.
// 기록은 clearance-moot-events.jsonl(추가만). 서버는 고르고 기록만 한다: 취소는 TOWER의 `atcctl cancel`이다

const SWITCH_FILE = () => join(config.stateDir, "clearance-moot.json");
const EVENTS = () => join(config.stateDir, "clearance-moot-events.jsonl");

export function loadMootSwitch(file = SWITCH_FILE()): MootSwitch {
  try {
    return parseMootSwitch(JSON.parse(readFileSync(file, "utf8")).mode);
  } catch {
    return "on";
  }
}

// 바뀐 것만 FLIGHT RECORDER에 남긴다. 임시 파일을 넘기면(시험) 운영 기록에 쓰지 않는다
export function saveMootSwitch(v: MootSwitch, by = "SUPERVISOR", file = SWITCH_FILE()) {
  const from = loadMootSwitch(file);
  if (from === v) return;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ mode: v }, null, 2) + "\n");
  renameSync(tmp, file);
  if (file === SWITCH_FILE()) record({ t: new Date().toISOString(), kind: "policy", op: "clearance-moot-mode", by, from, to: v });
}

export function readMootEvents(file = EVENTS()): MootEvent[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: MootEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as MootEvent);
    } catch {}
  }
  return out;
}

function appendMootEvents(lines: readonly MootEvent[], file = EVENTS()) {
  if (!lines.length) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, lines.map((l) => JSON.stringify(l) + "\n").join(""));
}

// FLIGHT별 PR 상태: 열린 PR(스냅샷), 머지된 PR(LOGBOOK의 ARRIVED, 되돌린 것은 뺀다), 기본 브랜치에 닿지 않은 머지(stranded).
// 머지 없이 닫힌 PR은 서버가 기록하지 않아 모른다(그런 FLIGHT는 고르지 않는다)
export function flightPrsOf(s: Pick<Snapshot, "pulls" | "stranded">, logbook: readonly { flight: string | null; reverted: boolean; arrivedAt?: string; pr?: { number: number } }[]): FlightPr[] {
  const out: FlightPr[] = [];
  const seen = new Set<string>();
  const add = (flight: string | null | undefined, number: number, state: FlightPr["state"], at?: string) => {
    if (!flight || seen.has(`${flight}#${number}`)) return;
    seen.add(`${flight}#${number}`);
    out.push({ flight, number, state, at });
  };
  for (const p of s.pulls ?? []) add(p.ticketKey, p.number, "open");
  for (const e of logbook) if (e.pr && !e.reverted) add(e.flight, e.pr.number, "merged", e.arrivedAt);
  for (const x of s.stranded ?? []) add(x.flight, x.number, "merged");
  return out;
}

// 브리핑이 읽는다: 지금 고른 CLEARANCE(스위치 off면 없다). 읽기만 한다 — listed 기록은 1분 일(trackMoot)이 한다
export function mootNow(s: Pick<Snapshot, "pulls" | "stranded">, clearances: readonly Clearance[] = allClearances()): Clearance[] {
  const sw = loadMootSwitch();
  if (sw === "off") return [];
  return mootClearancesOf(clearances, flightPrsOf(s, loadLogbook()), sw);
}

// 1분 일: 새로 고른 것을 listed로, 취소된 뒤 틀렸다고 드러난 것을 misfire로 덧붙인다
export function trackMoot(s: Pick<Snapshot, "pulls" | "stranded">, now = Date.now(), file = EVENTS()): MootEvent[] {
  const sw = loadMootSwitch();
  if (sw === "off") return [];
  const clearances = allClearances();
  const prs = flightPrsOf(s, loadLogbook());
  const events = readMootEvents(file);
  const lines = [...listedEvents(mootClearancesOf(clearances, prs, sw), prs, events, now), ...newMisfires(events, clearances, prs.filter((p) => p.state === "open"), now, sw)];
  appendMootEvents(lines, file);
  return lines;
}

export function mountClearanceMoot(app: Hono) {
  // 스위치와 MISFIRE 수(읽기 전용). 스위치는 설정 창(PUT /api/settings)에서만 바꾼다
  app.get("/api/clearance-moot", (c) => c.json({ switch: loadMootSwitch(), ...mootCounterOf(readMootEvents(), allClearances()) }));
}

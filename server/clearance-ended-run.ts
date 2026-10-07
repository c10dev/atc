import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { allClearances, markClearance } from "./clearances.ts";
import { answeredMisfire, cameBackMisfires, closedEvents, ENDED_CAUSE, ENDED_REASON, type EndedEvent, type EndedSwitch, endedClosuresOf, endedCounterOf, parseEndedSwitch } from "./clearance-ended.ts";
import { config } from "./config.ts";
import { loadDispatchConfig } from "./dispatch.ts";
import type { Snapshot } from "./model.ts";
import { bustQueue } from "./queue-bust.ts";
import { record } from "./recorder.ts";
import { regKey } from "./registration.ts";

// 받는 세션이 끝난 CLEARANCE의 읽고 쓰기(ATC-567). 규칙은 clearance-ended.ts(순수). 스위치는 clearance-ended.json(원자적 JSON, 기본 on)이고 설정 창에서만 바꾼다 — atcctl 명령은 없다.
// 닫기는 clearances.jsonl에 undeliverable 줄을 덧붙이는 것(고쳐 쓰지 않는다). 무엇을 닫았는지와 MISFIRE는 clearance-ended-events.jsonl(추가만)

const SWITCH_FILE = () => join(config.stateDir, "clearance-ended.json");
const EVENTS = () => join(config.stateDir, "clearance-ended-events.jsonl");

export function loadEndedSwitch(file = SWITCH_FILE()): EndedSwitch {
  try {
    return parseEndedSwitch(JSON.parse(readFileSync(file, "utf8")).mode);
  } catch {
    return "on";
  }
}

// 바뀐 것만 FLIGHT RECORDER에 남긴다. 임시 파일을 넘기면(시험) 운영 기록에 쓰지 않는다
export function saveEndedSwitch(v: EndedSwitch, by = "SUPERVISOR", file = SWITCH_FILE()) {
  const from = loadEndedSwitch(file);
  if (from === v) return;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ mode: v }, null, 2) + "\n");
  renameSync(tmp, file);
  if (file === SWITCH_FILE()) record({ t: new Date().toISOString(), kind: "policy", op: "clearance-ended-mode", by, from, to: v });
}

export function readEndedEvents(file = EVENTS()): EndedEvent[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: EndedEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as EndedEvent);
    } catch {}
  }
  return out;
}

function appendEndedEvents(lines: readonly EndedEvent[], file = EVENTS()) {
  if (!lines.length) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, lines.map((l) => JSON.stringify(l) + "\n").join(""));
}

// 1분 일: 받는 세션이 끝난 CLEARANCE를 닫고(스위치 on일 때만), 닫은 세션이 돌아왔는지 본다(MISFIRE는 스위치와 상관없이 센다)
export function trackEnded(s: Pick<Snapshot, "sessions" | "restarting">, now = Date.now(), file = EVENTS()): EndedEvent[] {
  const teamPattern = loadDispatchConfig().teamPattern;
  const restartingRegs = new Set((s.restarting ?? []).map((r) => r.registration.toUpperCase()));
  const clearances = allClearances();
  const picked = endedClosuresOf({ clearances, sessions: s.sessions, restarting: (name) => restartingRegs.has(regKey(name, teamPattern).toUpperCase()), now }, loadEndedSwitch());
  const closed = picked.filter((c) => {
    const r = markClearance(c.id, "undeliverable", ENDED_REASON, ENDED_CAUSE);
    return Boolean(r && !("error" in r));
  });
  const events = readEndedEvents(file);
  const lines = [...closedEvents(closed, clearances, now)];
  lines.push(...cameBackMisfires([...events, ...lines], s.sessions, now));
  appendEndedEvents(lines, file);
  if (closed.length) bustQueue();
  return lines;
}

// 답 경로(controller.ts)가 부른다: 이 규칙이 닫은 CLEARANCE에 답이 왔으면 MISFIRE 한 줄
export function noteEndedAnswer(id: string, now = Date.now(), file = EVENTS()): EndedEvent | null {
  const line = answeredMisfire(readEndedEvents(file), id, now);
  if (line) appendEndedEvents([line], file);
  return line;
}

export const endedData = (now = Date.now()) => ({ switch: loadEndedSwitch(), ...endedCounterOf(readEndedEvents(), now) });

export function mountClearanceEnded(app: Hono) {
  // 스위치와 최근 7일 수(읽기 전용). 스위치는 설정 창(PUT /api/settings)에서만 바꾼다
  app.get("/api/clearance-ended", (c) => c.json(endedData()));
}

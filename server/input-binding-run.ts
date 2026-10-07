import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { parseReadbackHashSwitch, type ReadbackHashEvent, type ReadbackHashSwitch, readbackHashCounterOf, readbackHashWhy } from "./input-binding.ts";
import { record } from "./recorder.ts";
import { releaseIdOf } from "./release.ts";
import { readReleaseView } from "./release-store.ts";

// 입력 묶기(ATC-555)의 읽고 쓰기. 규칙은 input-binding.ts(순수).
// - READBACK HASH 스위치: readback-hash.json(원자적 JSON, 기본 on). 설정 창에서만 바꾼다 — atcctl 명령은 없다
// - 거절 기록: readback-hash-events.jsonl(추가만). CAPTAIN의 READBACK을 기록하는 길(POST /api/dispatch/proposals/:id/accept)이 refuseReadbackHash를 부른다
// - 기록 줄의 release id: 그 FLIGHT의 가장 나중 발권(release.ts releaseIdOf). 못 읽으면 null(칸을 넣지 않는다)

const SWITCH_FILE = () => join(config.stateDir, "readback-hash.json");
const EVENTS = () => join(config.stateDir, "readback-hash-events.jsonl");

export function loadReadbackHashSwitch(file = SWITCH_FILE()): ReadbackHashSwitch {
  try {
    return parseReadbackHashSwitch(JSON.parse(readFileSync(file, "utf8")).mode);
  } catch {
    return "on";
  }
}

// 바뀐 것만 FLIGHT RECORDER에 남긴다. 임시 파일을 넘기면(시험) 운영 기록에 쓰지 않는다
export function saveReadbackHashSwitch(v: ReadbackHashSwitch, by = "SUPERVISOR", file = SWITCH_FILE()) {
  const from = loadReadbackHashSwitch(file);
  if (from === v) return;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ mode: v }, null, 2) + "\n");
  renameSync(tmp, file);
  if (file === SWITCH_FILE()) record({ t: new Date().toISOString(), kind: "policy", op: "readback-hash-mode", by, from, to: v });
}

export function readReadbackHashEvents(file = EVENTS()): ReadbackHashEvent[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: ReadbackHashEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as ReadbackHashEvent);
    } catch {}
  }
  return out;
}

// 파일에 못 쓴 줄은 메모리에 남겨 다음 거절 때 다시 쓰고, 그 사이에도 셈에 넣는다(stale-reply-run.ts와 같다)
const unwritten: ReadbackHashEvent[] = [];
export function flushReadbackHashEvents(file = EVENTS()) {
  if (!unwritten.length) return;
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, unwritten.map((e) => JSON.stringify(e) + "\n").join(""));
    unwritten.length = 0;
  } catch (e) {
    console.error(`[atc] readback-hash: 거절 ${unwritten.length}건을 기록하지 못함(메모리에 남김): ${e instanceof Error ? e.message : e}`);
  }
}

// READBACK을 거절할 사유(없으면 null). 스위치가 off거나 저장된 FLIGHT PLAN에 해시가 없으면(옛 글) 거르지 않는다. 거절하면 한 줄 센다
export function refuseReadbackHash(p: { id: string; flight: string | null; message: string | null }, quoted: string | null, now = Date.now(), file = EVENTS(), sw = loadReadbackHashSwitch()): string | null {
  if (sw === "off") return null;
  const r = readbackHashWhy(p.id, p.message, quoted);
  if (!r) return null;
  unwritten.push({ t: new Date(now).toISOString(), id: p.id, flight: p.flight, reason: r.reason, quoted, expected: r.expected });
  flushReadbackHashEvents(file);
  return r.why;
}

export const readbackHashData = (now = Date.now()) => {
  flushReadbackHashEvents();
  return readbackHashCounterOf([...readReadbackHashEvents(), ...unwritten], now, 7);
};

// 그 FLIGHT의 발권 id(<FLIGHT>@<발권 시각>). 발권 기록이 없거나 못 읽으면 null
export function releaseOfFlightNow(flight: string | null | undefined): string | null {
  if (!flight) return null;
  try {
    const r = readReleaseView().records[flight];
    return r ? releaseIdOf(r) : null;
  } catch {
    return null;
  }
}

export function mountInputBinding(app: Hono) {
  // 스위치와 거절 수(읽기 전용). 스위치는 설정 창(PUT /api/settings)에서만 바꾼다
  app.get("/api/input-binding", (c) => {
    const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || 7));
    flushReadbackHashEvents();
    const events = [...readReadbackHashEvents(), ...unwritten];
    return c.json({ switch: loadReadbackHashSwitch(), ...readbackHashCounterOf(events, Date.now(), days), recent: events.slice(-10).reverse() });
  });
}

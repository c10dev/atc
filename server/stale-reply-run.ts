import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { record } from "./recorder.ts";
import { type CallKind, type CallRef, latestOfReason, parseStaleReplySwitch, type StaleReplyEvent, type StaleReplySwitch, staleReplyCounterOf, staleReplyWhy } from "./stale-reply.ts";

// 닫혔거나 밀린 부름에 온 답의 거절(ATC-554)의 읽고 쓰기. 규칙은 stale-reply.ts(순수). 스위치는 stale-reply.json(원자적 JSON, 기본 on)이고 설정 창에서만 바꾼다 — atcctl 명령은 없다.
// 기록은 stale-reply-events.jsonl(추가만). 답을 기록하는 길(clearances·dispatch·crew-change의 POST)이 refuseStaleReply를 먼저 부른다

const SWITCH_FILE = () => join(config.stateDir, "stale-reply.json");
const EVENTS = () => join(config.stateDir, "stale-reply-events.jsonl");

export function loadStaleReplySwitch(file = SWITCH_FILE()): StaleReplySwitch {
  try {
    return parseStaleReplySwitch(JSON.parse(readFileSync(file, "utf8")).mode);
  } catch {
    return "on";
  }
}

// 바뀐 것만 FLIGHT RECORDER에 남긴다. 임시 파일을 넘기면(시험) 운영 기록에 쓰지 않는다
export function saveStaleReplySwitch(v: StaleReplySwitch, by = "SUPERVISOR", file = SWITCH_FILE()) {
  const from = loadStaleReplySwitch(file);
  if (from === v) return;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ mode: v }, null, 2) + "\n");
  renameSync(tmp, file);
  if (file === SWITCH_FILE()) record({ t: new Date().toISOString(), kind: "policy", op: "stale-reply-mode", by, from, to: v });
}

export function readStaleReplyEvents(file = EVENTS()): StaleReplyEvent[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: StaleReplyEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as StaleReplyEvent);
    } catch {}
  }
  return out;
}

// 거절할 사유(없으면 null)를 돌려주고, 거절하면 한 줄 센다. 스위치가 off면 아무것도 하지 않는다. 기록을 못 써도 거절은 그대로(닫는 쪽으로 실패)
export function refuseStaleReply(kind: CallKind, id: string, op: string, calls: readonly CallRef[], now = Date.now(), file = EVENTS(), sw = loadStaleReplySwitch()): string | null {
  if (sw === "off") return null;
  const why = staleReplyWhy(id, calls);
  if (!why) return null;
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify({ t: new Date(now).toISOString(), kind, id, op, latest: latestOfReason(why) } satisfies StaleReplyEvent) + "\n");
  } catch (e) {
    console.warn(`[atc] stale-reply: ${e instanceof Error ? e.message : e}`);
  }
  return why;
}

export const staleReplyData = (now = Date.now()) => staleReplyCounterOf(readStaleReplyEvents(), now, 7);

export function mountStaleReply(app: Hono) {
  // 스위치와 거절 수(읽기 전용). 스위치는 설정 창(PUT /api/settings)에서만 바꾼다
  app.get("/api/stale-reply", (c) => {
    const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || 7));
    const events = readStaleReplyEvents();
    return c.json({ switch: loadStaleReplySwitch(), ...staleReplyCounterOf(events, Date.now(), days), recent: events.slice(-10).reverse() });
  });
}

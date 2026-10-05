import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { type LagEpisodeLine, type LagState, type LagSwitch, lagCounterOf, lagLineOf, lagStep, type LoopLag, openLagOf, parseLagSwitch } from "./event-loop-lag.ts";
import { record } from "./recorder.ts";

// EVENT LOOP LAG의 읽고 쓰기(ATC-538). 규칙은 event-loop-lag.ts(순수). 스위치는 event-loop-lag.json(원자적 JSON, 기본 on)이고 설정 창(fromThisApp)에서만 바꾼다 — atcctl 명령은 없다(K3).
// 에피소드는 event-loop-lag-episodes.jsonl(추가만): 알림이 올라간 때(open)와 내려간 때(close, MISFIRE 표시). 구간은 JOB TIMING의 구간(job-timing-run.ts)을 그대로 쓴다.
const SWITCH_FILE = () => join(config.stateDir, "event-loop-lag.json");
const EPISODES = () => join(config.stateDir, "event-loop-lag-episodes.jsonl");

export function loadLagSwitch(file = SWITCH_FILE()): LagSwitch {
  try {
    return parseLagSwitch(JSON.parse(readFileSync(file, "utf8")).mode);
  } catch {
    return "on";
  }
}

// 바뀐 것만 FLIGHT RECORDER에 남긴다. 임시 파일을 넘기면(시험) 운영 기록에 쓰지 않는다. 끄면 올라간 알림을 바로 내린다
export function saveLagSwitch(v: LagSwitch, by = "SUPERVISOR", file = SWITCH_FILE()) {
  const from = loadLagSwitch(file);
  if (from === v) return;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ mode: v }, null, 2) + "\n");
  renameSync(tmp, file);
  if (file === SWITCH_FILE()) {
    record({ t: new Date().toISOString(), kind: "policy", op: "event-loop-lag-mode", by, from, to: v });
    if (v === "off") trackLag(null, Date.now());
  }
}

export function readLagEpisodes(file = EPISODES()): LagEpisodeLine[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: LagEpisodeLine[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as LagEpisodeLine);
    } catch {}
  }
  return out;
}

export function appendLagEpisodes(lines: readonly LagEpisodeLine[], file = EPISODES()) {
  if (!lines.length) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, lines.map((l) => JSON.stringify(l) + "\n").join(""));
}

// 서버가 도는 동안의 상태. 다시 뜰 때는 파일에서 열린 에피소드를 이어 받는다(연속 구간 수는 열 때의 수로 둔다)
let state: LagState | null = null;
const stateNow = (): LagState => {
  if (!state) {
    const open = openLagOf(readLagEpisodes());
    state = { over: open?.windows ?? 0, open };
  }
  return state;
};

// JOB TIMING 구간이 닫힐 때마다 부른다. win이 null이면 못 쟀다. 덧붙인 줄을 돌려준다
export function trackLag(win: LoopLag | null, now = Date.now()): LagEpisodeLine[] {
  const r = lagStep(stateNow(), win, { thresholdMs: config.eventLoopLagMs, windows: config.eventLoopLagWindows }, loadLagSwitch(), now);
  state = r.state;
  try {
    appendLagEpisodes(r.lines);
  } catch (e) {
    console.warn(`[atc] event-loop-lag: ${e instanceof Error ? e.message : e}`);
  }
  return r.lines;
}

// 지금 올라가 있는 알림(스위치가 on일 때만). supervisor-alerts-run이 읽는다
export function lagAlertNow(): { line: string; since: string } | null {
  if (loadLagSwitch() === "off") return null;
  const o = stateNow().open;
  return o ? { line: lagLineOf(o), since: o.at } : null;
}

export function mountEventLoopLag(app: Hono) {
  // 스위치와 에피소드·MISFIRE 수(읽기 전용). 스위치는 설정 창(PUT /api/settings)에서만 바꾼다
  app.get("/api/event-loop-lag", (c) => {
    const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || 7));
    const lines = readLagEpisodes();
    return c.json({ switch: loadLagSwitch(), thresholdMs: config.eventLoopLagMs, windows: config.eventLoopLagWindows, ...lagCounterOf(lines, Date.now(), days), recent: lines.filter((l) => l.op === "close").slice(-10).reverse() });
  });
}

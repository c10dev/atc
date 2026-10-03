import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import type { FlowView } from "./home-flow.ts";
import { type EpisodeLine, episodeStep, type GapFacts, type GapSwitch, gapCounterOf, openEpisodesOf, parseGapSwitch } from "./landing-gap.ts";
import { record } from "./recorder.ts";

// 착륙 간격 규칙의 읽고 쓰기(ATC-501). 규칙은 landing-gap.ts(순수). 스위치는 landing-gap.json(원자적 JSON, 기본 on)이고 설정 창(fromThisApp)에서만 바꾼다 — atcctl 명령은 없다(K3).
// 에피소드는 landing-gap-episodes.jsonl(추가만): 간격 규칙이 막힘을 낸 구간의 열림·닫힘과 MISFIRE 표시.

const SWITCH_FILE = () => join(config.stateDir, "landing-gap.json");
const EPISODES = () => join(config.stateDir, "landing-gap-episodes.jsonl");

export function loadGapSwitch(file = SWITCH_FILE()): GapSwitch {
  try {
    return parseGapSwitch(JSON.parse(readFileSync(file, "utf8")).mode);
  } catch {
    return "on";
  }
}

// 바뀐 것만 FLIGHT RECORDER에 남긴다. 임시 파일을 넘기면(시험) 운영 기록에 쓰지 않는다
export function saveGapSwitch(v: GapSwitch, by = "SUPERVISOR", file = SWITCH_FILE()) {
  const from = loadGapSwitch(file);
  if (from === v) return;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ mode: v }, null, 2) + "\n");
  renameSync(tmp, file);
  if (file === SWITCH_FILE()) record({ t: new Date().toISOString(), kind: "policy", op: "landing-gap-mode", by, from, to: v });
}

export function readEpisodes(file = EPISODES()): EpisodeLine[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: EpisodeLine[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as EpisodeLine);
    } catch {}
  }
  return out;
}

export function appendEpisodes(lines: readonly EpisodeLine[], file = EPISODES()) {
  if (!lines.length) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, lines.map((l) => JSON.stringify(l) + "\n").join(""));
}

// 이번 흐름판 판정에서 에피소드를 열고 닫는다(1분 일). 쓴 줄을 돌려준다
export function trackEpisodes(view: Pick<FlowView, "airports">, sw: GapSwitch, now = Date.now(), file = EPISODES()): EpisodeLine[] {
  const facts: GapFacts[] = view.airports.map((a) => ({
    airport: a.code,
    gapStopped: Boolean(a.gapStopped),
    groundStop: a.verdict === "stopped" && !a.gapStopped && Boolean(a.reason?.startsWith("ground stop")),
    mainRed: a.verdict === "stopped" && !a.gapStopped && a.reason === "main CI 빨강",
    lastOn: a.lastOnAt ?? null,
  }));
  const thresholds = Object.fromEntries(view.airports.map((a) => [a.code, a.thresholdMin]));
  const lines = episodeStep(openEpisodesOf(readEpisodes(file)), facts, thresholds, sw, now);
  appendEpisodes(lines, file);
  return lines;
}

export function mountLandingGap(app: Hono) {
  // 스위치와 에피소드·MISFIRE 수(읽기 전용). 스위치는 설정 창(PUT /api/settings)에서만 바꾼다
  app.get("/api/landing-gap", (c) => {
    const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || 7));
    const lines = readEpisodes();
    return c.json({ switch: loadGapSwitch(), ...gapCounterOf(lines, Date.now(), days), recent: lines.filter((l) => l.op === "close" && l.misfire).slice(-10).reverse() });
  });
}

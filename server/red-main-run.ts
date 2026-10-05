import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { readAutoRevertLines } from "./auto-revert.ts";
import { config } from "./config.ts";
import type { Snapshot } from "./model.ts";
import { parseRedMainSwitch, type RedMainHold, type RedMainLine, type RedMainSwitch, redMainCounterOf, redMainHoldsOf, syncEpisodes } from "./red-main.ts";
import { record } from "./recorder.ts";

// RED MAIN 줄의 읽고 쓰기(ATC-536). 규칙은 red-main.ts(순수). 스위치는 red-main.json(원자적 JSON, 기본 on)이고 설정 창(fromThisApp)에서만 바꾼다 — atcctl 명령은 없다(K3).
// 줄 자체는 파일이 아니라 지금의 상태(AUTO-REVERT의 HOLD 줄 + main + 열린 PR)에서 만든다. 에피소드 기록은 올림·닫힘을 세기 위한 것뿐이다.
const SWITCH_FILE = () => join(config.stateDir, "red-main.json");
const EPISODES = () => join(config.stateDir, "red-main-episodes.jsonl");

export function loadRedMainSwitch(file = SWITCH_FILE()): RedMainSwitch {
  try {
    return parseRedMainSwitch(JSON.parse(readFileSync(file, "utf8")).mode);
  } catch {
    return "on";
  }
}

// 바뀐 것만 FLIGHT RECORDER에 남긴다. 임시 파일을 넘기면(시험) 운영 기록에 쓰지 않는다
export function saveRedMainSwitch(v: RedMainSwitch, by = "SUPERVISOR", file = SWITCH_FILE()) {
  const from = loadRedMainSwitch(file);
  if (from === v) return;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ mode: v }, null, 2) + "\n");
  renameSync(tmp, file);
  if (file === SWITCH_FILE()) record({ t: new Date().toISOString(), kind: "policy", op: "red-main-mode", by, from, to: v });
}

export function readRedMainLines(file = EPISODES()): RedMainLine[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: RedMainLine[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as RedMainLine);
    } catch {}
  }
  return out;
}

// 지금 열려 있어야 하는 줄(스위치 off면 없다)
export function redMainNow(s: Snapshot, lines = readAutoRevertLines()): RedMainHold[] {
  if (loadRedMainSwitch() === "off") return [];
  const mains = s.airports.flatMap((a) => {
    const m = s.atfm.mains.find((x) => x.repo === a.repo);
    return m ? [{ airport: a.code, repo: a.repo, sha: m.sha, state: m.state, failing: [...new Set([...m.failing, ...(m.workflowsFailing ?? [])])] }] : [];
  });
  return redMainHoldsOf({ lines, mains, pulls: s.pulls ?? [] });
}

// 스냅샷이 새로 나올 때 부른다: 올림·닫힘을 기록으로 맞춘다(큐는 redMainNow를 따로 읽는다)
export function runRedMain(s: Snapshot, now = Date.now()) {
  try {
    const add = syncEpisodes(readRedMainLines(), redMainNow(s), loadRedMainSwitch() === "off", new Date(now).toISOString());
    if (!add.length) return;
    mkdirSync(dirname(EPISODES()), { recursive: true });
    appendFileSync(EPISODES(), add.map((l) => JSON.stringify(l) + "\n").join(""));
  } catch (e) {
    console.warn(`[atc] red-main: ${e instanceof Error ? e.message : e}`); // 기록을 못 써도 줄은 그대로
  }
}

export function mountRedMain(app: Hono) {
  // 스위치와 올림·닫힘 수(읽기 전용). 스위치는 설정 창(PUT /api/settings)에서만 바꾼다
  app.get("/api/red-main", (c) => {
    const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || 7));
    const lines = readRedMainLines();
    return c.json({ switch: loadRedMainSwitch(), ...redMainCounterOf(lines, Date.now(), days), recent: lines.slice(-10).reverse() });
  });
}

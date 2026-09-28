import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "../config.ts";
import { type CrosscheckVerdict, crosscheckRateOf, type HumanDecision } from "../crosscheck.ts";
import type { Rating } from "../crew.ts";
import { type ClassifyJudgment, JUDGE_FAMILIES, type JudgeFamily } from "./classify.ts";
import type { EngineName } from "./engines.ts";

// 판정 계열의 스위치와 기록(ATC-36).
// - 스위치 ~/.local/state/atc/judges.json {"jev": "off"|"replay"|"shadow"} — 원자적으로 바꿔 쓴다. 기본 off.
//   SUPERVISOR만 바꾼다(설정 창 PUT /api/settings의 judgesJev, 이 화면 Origin만). atcctl에는 명령이 없다.
// - 기록 ~/.local/state/atc/judges.jsonl — 계열마다 추가만 하는 `judge` 줄. schedule.jsonl과 CROSSCHECK 칸은 건드리지 않는다.
//   초안 상태를 바꾸지 않고, 20건·80% 게이트(gateOf)에도 들지 않는다.

export type JudgeMode = "off" | "replay" | "shadow";
export const JUDGE_MODES: readonly JudgeMode[] = ["off", "replay", "shadow"];
export type JudgesConfig = Record<JudgeFamily, JudgeMode>;
export const DEFAULT_JUDGES: JudgesConfig = { jev: "off" };

const CONFIG_FILE = () => join(config.stateDir, "judges.json");
const RECORD_FILE = () => join(config.stateDir, "judges.jsonl");

// 모르는 값은 off — 깨진 파일이 무엇도 켜지 않게
export function parseJudges(raw: unknown): JudgesConfig {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(JUDGE_FAMILIES.map((f) => [f, JUDGE_MODES.includes(o[f] as JudgeMode) ? o[f] : "off"])) as JudgesConfig;
}

export function loadJudges(file = CONFIG_FILE()): JudgesConfig {
  try {
    return parseJudges(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return { ...DEFAULT_JUDGES };
  }
}

export function saveJudges(cfg: JudgesConfig, file = CONFIG_FILE()) {
  let user: Record<string, unknown> = {};
  try {
    user = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...user, ...cfg }, null, 2) + "\n");
  renameSync(tmp, file);
}

// ---- 기록 ----
export type JudgeRun = "replay" | "shadow";

export interface JudgeLine {
  op: "judge";
  family: JudgeFamily;
  target: "schedule"; // 지금은 SCHEDULE CLASSIFY만(DISPATCH는 범위 밖)
  id: string; // S-0001
  flight: string | null;
  at: string;
  run: JudgeRun;
  engine: EngineName;
  model: string; // 응답의 모델 id(jev-1.13.0), stub은 "stub"
  verdict: CrosscheckVerdict; // 초안과 같은 분류면 agree
  reason: string;
  judgment: ClassifyJudgment;
  withheld: string | null; // 본문을 보내지 않은 이유(제목만 보냄). 보냈으면 null
  sent: string[]; // 보낸 칸(title, goal, allowed_scope, done_criteria)
}

// 모드 변경 기록(누가·언제 켰나)
export interface JudgeModeLine {
  op: "mode";
  family: JudgeFamily;
  at: string;
  from: JudgeMode;
  to: JudgeMode;
}

export type JudgesLogLine = JudgeLine | JudgeModeLine;

export function readJudgeLines(file = RECORD_FILE()): JudgesLogLine[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: JudgesLogLine[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const l = JSON.parse(line);
      if (l && (l.op === "judge" || l.op === "mode") && JUDGE_FAMILIES.includes(l.family)) out.push(l);
    } catch {}
  }
  return out;
}

export function appendJudgeLines(lines: JudgesLogLine[], file = RECORD_FILE()) {
  if (!lines.length) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

export function setJudgeMode(family: JudgeFamily, mode: JudgeMode, at = new Date().toISOString()) {
  const cfg = loadJudges();
  if (cfg[family] === mode) return;
  saveJudges({ ...cfg, [family]: mode });
  appendJudgeLines([{ op: "mode", family, at, from: cfg[family], to: mode }]);
}

// 초안마다·계열마다 마지막 mark
export type JudgeMarks = Map<string, Partial<Record<JudgeFamily, JudgeLine>>>;
export function marksOf(lines: JudgesLogLine[]): JudgeMarks {
  const out: JudgeMarks = new Map();
  for (const l of lines) {
    if (l.op !== "judge") continue;
    out.set(l.id, { ...out.get(l.id), [l.family]: l });
  }
  return out;
}

// ---- 일치율과 화면 ----
export interface JudgedOp {
  id: string;
  kind: string;
  human: HumanDecision | null; // SUPERVISOR 판정(schedule.ts humanOf). ATFM 자동 판정은 null
}

// 계열별 일치율: crosscheckRateOf를 그대로 쓴다(byModel 키가 계열).
// CROSSCHECK와 달리 판정 뒤에 단 mark(replay)도 센다 — 판정 계열의 입력에는 SUPERVISOR 판정이 들어가지 않는다.
export function judgeRateOf(ops: JudgedOp[], marks: JudgeMarks) {
  const items = ops
    .filter((o) => o.kind === "CLASSIFY")
    .flatMap((o) =>
      JUDGE_FAMILIES.map((f) => {
        const m = marks.get(o.id)?.[f];
        return { crosscheck: m && o.human ? { by: f, model: f, verdict: m.verdict, reason: m.reason, at: o.human.at } : null, human: o.human };
      }),
    );
  const { byModel } = crosscheckRateOf(items);
  return Object.fromEntries(JUDGE_FAMILIES.map((f) => [f, byModel[f] ?? { marked: 0, matched: 0, rate: null }])) as Record<JudgeFamily, { marked: number; matched: number; rate: number | null }>;
}

export interface JudgeMarkView {
  family: JudgeFamily;
  verdict: CrosscheckVerdict;
  reason: string;
  model: string;
  engine: EngineName;
  run: JudgeRun;
  at: string;
  type: string;
  wake: string;
  ratings: Record<Rating, number>;
  withheld: string | null;
}

// SCHEDULE 브리핑의 judges: 스위치, 계열별 일치율, mark.
// mark는 SUPERVISOR가 판정한 초안에만 보인다(쏠림 방지). 열린 초안의 mark는 세기만 한다(pending).
// shown이 있으면 그 초안의 mark만 싣는다(일치율은 모든 초안으로)
export function judgesViewOf(ops: JudgedOp[], marks: JudgeMarks, modes: JudgesConfig, shown?: Set<string>) {
  const decided = new Set(ops.filter((o) => o.human).map((o) => o.id));
  const visible: Record<string, JudgeMarkView[]> = {};
  let hidden = 0;
  for (const o of ops) {
    const m = marks.get(o.id);
    if (!m) continue;
    const list = Object.values(m) as JudgeLine[];
    if (!decided.has(o.id)) {
      hidden += list.length;
      continue;
    }
    if (shown && !shown.has(o.id)) continue;
    visible[o.id] = list.map((l) => ({
      family: l.family,
      verdict: l.verdict,
      reason: l.reason,
      model: l.model,
      engine: l.engine,
      run: l.run,
      at: l.at,
      type: l.judgment.type,
      wake: l.judgment.wake,
      ratings: l.judgment.ratings,
      withheld: l.withheld,
    }));
  }
  return { modes, rate: judgeRateOf(ops, marks), marks: visible, hidden };
}

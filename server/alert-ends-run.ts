import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";
import { type EndsState, emptyEnds, type Reappeared } from "./alert-ends.ts";

// 알림 끝 규칙(ATC-385)의 기록. 계산은 alert-ends.ts(순수).
// alert-ends.json: 처음 본 시각과 끝 규칙이 뺀 알림(설정류라 원자적으로 바꿔 쓴다). alert-reappeared.jsonl: 돌아온 알림(추가만 한다)
const STATE_FILE = () => join(config.stateDir, "alert-ends.json");
const LOG_FILE = () => join(config.stateDir, "alert-reappeared.jsonl");

export function loadEnds(file = STATE_FILE()): EndsState {
  try {
    const r = JSON.parse(readFileSync(file, "utf8"));
    return { firstSeen: r.firstSeen && typeof r.firstSeen === "object" ? r.firstSeen : {}, cleared: r.cleared && typeof r.cleared === "object" ? r.cleared : {} };
  } catch {
    return emptyEnds();
  }
}

export function saveEnds(s: EndsState, file = STATE_FILE()): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s) + "\n");
  renameSync(tmp, file);
}

export function appendReappeared(recs: readonly Reappeared[], file = LOG_FILE()): void {
  if (!recs.length) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, recs.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

export function readReappeared(file = LOG_FILE()): Reappeared[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: Reappeared[] = [];
  for (const l of text.split("\n")) {
    try {
      const r = JSON.parse(l);
      if (typeof r?.key === "string" && typeof r.t === "string") out.push(r);
    } catch {
      // 깨진 줄은 건너뛴다
    }
  }
  return out;
}

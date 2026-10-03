import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";
import type { EffectLine } from "./effect-check.ts";

// EFFECT CHECK 평결 기록(effect-verdicts.jsonl)의 읽기·추가(ATC-402). 추가만 한다.
// effect-check-run.ts에서 떼어 냈다(ATC-454): 큐(supervisor-queue-run.ts)도 읽는데, effect-check-run → leaks-run → 큐로 이어지는 순환을 막으려고 파일 입출력만 여기 둔다.
export const VERDICTS_FILE = () => join(config.stateDir, "effect-verdicts.jsonl");

export function readEffectLines(file = VERDICTS_FILE()): EffectLine[] {
  if (!existsSync(file)) return [];
  const out: EffectLine[] = [];
  for (const l of readFileSync(file, "utf8").split("\n")) {
    if (!l) continue;
    try {
      const r = JSON.parse(l);
      if (r?.v === 1 && (r.ev === "verdict" || r.ev === "mark") && typeof r.flight === "string") out.push(r);
    } catch {}
  }
  return out;
}

export function appendEffectLine(line: EffectLine, file = VERDICTS_FILE()) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(line) + "\n");
}

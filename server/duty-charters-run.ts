// duty-charters.jsonl(상태 폴더)의 읽기·붙이기(ATC-233). 계산은 duty-charters.ts(순수). schedule brief와 duty-api.ts가 같이 쓴다.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";
import { loadDutyConfig } from "./duty-config.ts";
import { type CharterLine, type CharterMode, chartersOf, dutySourceOf, parseCharterLines } from "./duty-charters.ts";

export const chartersFile = () => join(config.stateDir, "duty-charters.jsonl");

export function readCharterLines(): CharterLine[] {
  try {
    return parseCharterLines(readFileSync(chartersFile(), "utf8"));
  } catch {
    return [];
  }
}

export function appendCharterLine(line: CharterLine) {
  const f = chartersFile();
  mkdirSync(dirname(f), { recursive: true });
  appendFileSync(f, `${JSON.stringify(line)}\n`);
}

export const charterModeNow = (): CharterMode => loadDutyConfig().charter;

// schedule brief의 duty 구역(off면 null)
export const dutySourceNow = () => dutySourceOf(charterModeNow(), chartersOf(readCharterLines()));

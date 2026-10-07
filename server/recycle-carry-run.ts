import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { allClearances } from "./clearances.ts";
import { config } from "./config.ts";
import { type CarrySwitch, carryCounterOf, parseCarrySwitch } from "./recycle-carry.ts";
import { readRecords, record } from "./recorder.ts";

// TOWER CARRY-OVER의 읽고 쓰기(ATC-565). 규칙은 recycle-carry.ts(순수). 스위치는 control-recycle-carry.json(원자적 JSON, 기본 on)이고
// 설정 창에서만 바꾼다 — atcctl 명령은 없다. 오작동 수는 FLIGHT RECORDER의 control recycle 줄(carried)과 clearances.jsonl에서 읽을 때마다 센다(새 기록 없음)

const SWITCH_FILE = () => join(config.stateDir, "control-recycle-carry.json");

export function loadCarrySwitch(file = SWITCH_FILE()): CarrySwitch {
  try {
    return parseCarrySwitch(JSON.parse(readFileSync(file, "utf8")).mode);
  } catch {
    return "on";
  }
}

// 바뀐 것만 FLIGHT RECORDER에 남긴다. 임시 파일을 넘기면(시험) 운영 기록에 쓰지 않는다
export function saveCarrySwitch(v: CarrySwitch, by = "SUPERVISOR", file = SWITCH_FILE()) {
  const from = loadCarrySwitch(file);
  if (from === v) return;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ mode: v }, null, 2) + "\n");
  renameSync(tmp, file);
  if (file === SWITCH_FILE()) record({ t: new Date().toISOString(), kind: "policy", op: "control-recycle-carry-mode", by, from, to: v });
}

// 설정 창 블록의 수(30일)
export function carryData(now = Date.now()) {
  const days = 30;
  const recs = readRecords(now - (days + 1) * 86_400_000).flatMap((r) => (r.kind === "control" && r.op === "recycle" ? [r] : []));
  return carryCounterOf(recs, allClearances(), now, days);
}

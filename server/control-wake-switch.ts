import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";
import { parseWakeSwitch, type WakeMode, type WakeRole, type WakeSwitch } from "./control-wake.ts";
import { record } from "./recorder.ts";

// CONTROL WAKE 스위치(ATC-557)의 파일: ~/.local/state/atc/control-wake.json { roles: { tower, occ, mcc } } (원자적으로 바꿔 쓴다).
// SUPERVISOR만 설정 창에서 바꾼다(server/switches/control-wake-*.ts). 바꾸면 FLIGHT RECORDER에 policy control-wake-mode 한 줄(BREAKER가 그 역할을 처음부터 센다).
// session-control.ts(LAUNCH의 첫 프롬프트)도 읽으므로 이 파일은 control-wake-run.ts를 가져오지 않는다(순환 없음)

const FILE = () => join(config.stateDir, "control-wake.json");

export function loadWakeSwitch(file = FILE()): WakeSwitch {
  try {
    return parseWakeSwitch(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return parseWakeSwitch(null);
  }
}

export function saveWakeMode(role: WakeRole, v: WakeMode, by = "SUPERVISOR", file = FILE()) {
  const cur = loadWakeSwitch(file);
  if (cur[role] === v) return;
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {}
  const next = { ...raw, roles: { ...cur, [role]: v } };
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  renameSync(tmp, file);
  if (file === FILE()) record({ t: new Date().toISOString(), kind: "policy", op: "control-wake-mode", by, role, from: cur[role], to: v });
}

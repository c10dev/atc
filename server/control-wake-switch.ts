import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";
import { type DailyMode, parseWakeDaily, parseWakeSwitch, ROLE_NAME, WAKE_ROLES, type WakeMode, type WakeRole, type WakeSwitch } from "./control-wake.ts";
import { readRecords, record } from "./recorder.ts";
import { type Breaker, type BreakerScope, breakerOf } from "./server-send.ts";

// CONTROL WAKE 스위치(ATC-557)의 파일: ~/.local/state/atc/control-wake.json { roles: { tower, occ, mcc, review }, daily: "on"|"off" } (원자적으로 바꿔 쓴다).
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

// 하루 한 번 점검 턴(ATC-557 d)의 스위치. 바꾸면 policy control-wake-daily 한 줄(깨움 BREAKER는 그대로 — 그 줄은 control-wake-mode만 본다)
export function loadWakeDaily(file = FILE()): DailyMode {
  try {
    return parseWakeDaily(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return parseWakeDaily(null);
  }
}
export function saveWakeDaily(v: DailyMode, by = "SUPERVISOR", file = FILE()) {
  const cur = loadWakeDaily(file);
  if (cur === v) return;
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {}
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...raw, daily: v }, null, 2) + "\n");
  renameSync(tmp, file);
  if (file === FILE()) record({ t: new Date().toISOString(), kind: "policy", op: "control-wake-daily", by, from: cur, to: v });
}

// 역할마다 깨움 BREAKER(ATC-562 BREAKER와 같은 규칙, 범위만 다르다): 그 역할의 깨움이 대화 기록에 보이지 않으면 그 역할만 멈춘다. 팀 FLIGHT PLAN은 상관없다
export const wakeScope = (role: WakeRole): BreakerScope => ({ kind: "control-wake", policyOp: "control-wake-mode", of: (l) => l.role === role, handTo: `${ROLE_NAME[role]} 깨움을 멈추고 /loop로 돌린다`, probe: "깨움 하나로" });

// 실제로 쓰는 모드(ATC-557 리뷰): 스위치가 wake여도 그 역할의 깨움 BREAKER가 켜져(armed) 있지 않으면 loop로 본다(fail safe).
// 멈춘 동안 LAUNCH는 /loop를 걸고, /loop로 뜨지 않은 세션은 /loop로 한 번 다시 띄운다. BREAKER가 시험 깨움으로 다시 켜지면 wake로 돌아간다
type AnyLine = { t: string; kind: string; op?: string } & Record<string, unknown>;
const DAY = 86_400_000;
export function effectiveWakeOf(sw: WakeSwitch, lines: readonly AnyLine[], now: number): { eff: WakeSwitch; breakers: Record<WakeRole, Breaker> } {
  const breakers = Object.fromEntries(WAKE_ROLES.map((r) => [r, breakerOf(lines, now, wakeScope(r))])) as Record<WakeRole, Breaker>;
  const eff = Object.fromEntries(WAKE_ROLES.map((r) => [r, sw[r] === "wake" && breakers[r].state === "armed" ? "wake" : "loop"])) as WakeSwitch;
  return { eff, breakers };
}
export const effectiveWakeSwitch = (now = Date.now()) => effectiveWakeOf(loadWakeSwitch(), readRecords(now - 30 * DAY) as unknown as AnyLine[], now).eff;

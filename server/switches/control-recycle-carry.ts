import { CARRY_SWITCHES, type CarrySwitch } from "../recycle-carry.ts";
import { carryData, loadCarrySwitch, saveCarrySwitch } from "../recycle-carry-run.ts";
import { defineSwitch } from "../switch-def.ts";

// TOWER CARRY-OVER(ATC-565, docs/control-recycle.md 6): control-recycle-carry.json의 스위치(기본 on). 켜면 CONTROL RECYCLE(과 같은 안전 조건을 쓰는 APPLY NOW·CONTROL BULK)이
// TOWER의 overdue CLEARANCE를 막는 것으로 보지 않고 새 세션에 넘긴다(기록 줄의 carried). 끄면 오늘처럼 overdue가 남은 동안 기다린다. SUPERVISOR만(이 화면 Origin), atcctl 명령은 없다
export default defineSwitch({
  key: "controlRecycleCarry",
  label: "TOWER CARRY-OVER",
  group: "operations",
  block: { code: "CONTROL RECYCLE", label: "관제 세션 자동 재시작", windowLabel: "관제 세션 자동 재시작(SUPERVISOR 전용)", words: "carry over 넘겨 줌 overdue CLEARANCE RESEND 답 없음 controlRecycleCarry", searchOrder: 80 },
  values: CARRY_SWITCHES,
  default: "on",
  risky: [], // 재시작 조건 하나를 빼는 것뿐이다. STOP·LAUNCH 자체는 CONTROL RECYCLE 모드가 정한다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: TOWER에 overdue CLEARANCE가 하나라도 있으면 CAP을 넘어도 재시작을 기다린다(지금과 같다). 답이 끝내 오지 않는 CLEARANCE가 있으면 몇 시간이고 기다릴 수 있다.",
    on: "기본: overdue CLEARANCE는 막는 것이 아니라 새 TOWER에 넘길 일이다. 새 TOWER는 brief의 resentBy·resendOf로 두 번째 RESEND와 \"답 없음\" 보고를 가린다. 넘긴 뒤 RESEND가 겹치거나 빠지면 오작동으로 센다.",
  },
  row: () => ({ label: "TOWER CARRY-OVER", env: "controlRecycleCarry", note: "control-recycle-carry.json · overdue CLEARANCE를 새 TOWER에 넘김 · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈" }),
  data: () => carryData(),
  order: 53,
  applyOrder: 145,
  read: () => loadCarrySwitch(),
  save: (v: CarrySwitch) => saveCarrySwitch(v),
  record: (v: CarrySwitch) => `controlRecycleCarry=${v}`,
});

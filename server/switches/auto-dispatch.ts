import { loadDispatchConfig, saveAutoDispatch } from "../dispatch.ts";
import { defineSwitch } from "../switch-def.ts";

// DISPATCH 자동 운항(ATC-367, K3): dispatch.json autoDispatch. 켜면 서버가 필터·상한을 통과한 ASSIGN·launch를 CROSSCHECK·사람 없이 승인한다. SUPERVISOR만, atcctl 명령 없음
export default defineSwitch({
  key: "autoDispatch",
  label: "AUTO DISPATCH",
  group: "operations",
  block: { code: "AUTO APPROVE", label: "일치 기반 자동 승인", windowLabel: "DISPATCH 자동 운항·일치 기반 자동 승인(SUPERVISOR 전용)", words: "", searchOrder: 50 },
  values: ["off", "on"],
  default: "on",
  risky: ["on"], // 기본 on이라 ⚠로 보이고, 껐다 다시 켤 때 확인한다
  error: "off 또는 on",
  warn: {
    off: "off: 열린 ASSIGN·launch 카드는 SUPERVISOR가 DISPATCH 화면에서 하나씩 누르고(아래 두 줄이 정한 만큼은 CROSSCHECK agree 카드를 서버가 승인), 큐와 알림에 다시 나타난다.",
    on: "⚠ 기본: 서버가 DISPATCH의 필터(SETTLED, HELD 아님, 발권된 FLIGHT)와 상한(FUEL hold, ATC_MAX_LAUNCHED, 하루 상한, 실패 뒤 대기)을 통과한 모든 ASSIGN·launch 카드를 CROSSCHECK·blind 표본·SUPERVISOR 없이 승인한다(via auto). 못 가는 카드는 만료되고 planner가 다시 제안한다. 잘못된 승인은 아래 MISFIRE로 센다.",
  },
  row: () => ({ label: "DISPATCH 자동 운항", env: "autoDispatch", note: "dispatch.json · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈. ASSIGN·launch 카드의 승인에서 사람과 CROSSCHECK를 뺀다" }),
  order: 30,
  lineOrder: 140,
  applyOrder: 50,
  read: () => loadDispatchConfig().autoDispatch,
  save: (v: "off" | "on") => saveAutoDispatch(v),
  record: (v: "off" | "on") => `autoDispatch=${v}`,
});

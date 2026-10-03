import { AUTO_SWITCHES, type AutoSwitch } from "../autonomy-auto.ts";
import { loadAutoSwitch, saveAutoSwitch } from "../autonomy-auto-run.ts";
import { defineSwitch } from "../switch-def.ts";

// FLEET PLAN 자동 적용(ATC-370): fleet-plan.json의 auto(기본 on). 사람 승인 없이 서버가 실행한다. 끄는 것은 SUPERVISOR만
export default defineSwitch({
  key: "fleetPlanAuto",
  label: "FLEET PLAN AUTO",
  group: "operations",
  block: { code: "SCHEDULE·FLEET PLAN AUTO", label: "SCHEDULE·FLEET PLAN 자동 적용", windowLabel: "SCHEDULE·FLEET PLAN 사람 없이 적용(SUPERVISOR 전용)", words: "", searchOrder: 60 },
  values: AUTO_SWITCHES,
  default: "on",
  risky: ["on"], // 서버가 FLEET PLAN 제안(LAUNCH·STOP·RESTART·REFRESH·AOG)을 사람 승인 없이 실행한다. 기본 on, off는 SUPERVISOR 몫
  error: "off 또는 on",
  warn: {
    off: "off: FLEET PLAN 제안은 SUPERVISOR가 FLEET 화면에서 승인한다.",
    on: "⚠ 기본: 서버가 FLEET PLAN 제안 LAUNCH·STOP·RESTART·REFRESH·AOG를 사람 승인 없이 실행한다(세션을 띄우고 멈춘다). FUEL hold·ATC_MAX_LAUNCHED·하루 상한을 지키고, ENTRY·ACCOUNT CHANGE·REPOSITION·RETIRE·RETURN은 제안으로 남는다.",
  },
  row: () => ({ label: "FLEET PLAN", env: "fleet-plan.auto", note: "fleet-plan.json · 하루 LAUNCH 상한은 autoLaunchMax, 전체는 autoApproveMax · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈" }),
  order: 21,
  lineOrder: 110,
  applyOrder: 70,
  read: () => loadAutoSwitch("fleetPlan"),
  save: (v: AutoSwitch) => saveAutoSwitch("fleetPlan", v),
  record: (v: AutoSwitch) => `fleet-plan.auto=${v}`,
});

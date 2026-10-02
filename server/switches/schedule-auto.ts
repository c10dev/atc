import { AUTO_SWITCHES, type AutoSwitch } from "../autonomy-auto.ts";
import { loadAutoSwitch, saveAutoSwitch } from "../autonomy-auto-run.ts";
import { defineSwitch } from "../switch-def.ts";

// SCHEDULE 초안 자동 적용(ATC-370): schedule.json의 auto(기본 on). 사람 판정 없이 서버가 적용한다. 끄는 것은 SUPERVISOR만
export default defineSwitch({
  key: "scheduleAuto",
  label: "SCHEDULE AUTO",
  group: "operations",
  block: {
    code: "SCHEDULE·FLEET PLAN AUTO",
    label: "SCHEDULE·FLEET PLAN 자동 적용",
    windowLabel: "SCHEDULE·FLEET PLAN 사람 없이 적용(SUPERVISOR 전용)",
    words: "schedule fleet plan 자동 적용 사람 없이 off on misfire 오작동 scheduleAuto fleetPlanAuto schedule.auto fleet-plan.auto backlog",
    searchOrder: 60,
  },
  values: AUTO_SWITCHES,
  default: "on",
  risky: ["on"], // 서버가 SCHEDULE 초안(CLASSIFY·TAIL·CLOSE·WAYPOINT·NEW)을 사람 판정 없이 승인한다. 기본 on, off는 SUPERVISOR 몫
  error: "off 또는 on",
  warn: {
    off: "off: SCHEDULE 초안은 SUPERVISOR(또는 일치 기반 자동 승인)가 승인한다.",
    on: "⚠ 기본: 서버가 열린 SCHEDULE 초안 CLASSIFY·TAIL·CLOSE·WAYPOINT·NEW를 사람 판정과 CROSSCHECK 없이 승인한다(via auto). NEW는 Backlog에 제안으로만 생기고 SUPERVISOR가 풀어 준다. ROUTE·TARGET·PRIORITIZE는 제안으로 남는다. 하루 상한을 넘으면 기다린다.",
  },
  row: () => ({ label: "SCHEDULE", env: "schedule.auto", note: "schedule.json · 하루 상한은 dispatch.json autoApproveMax · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈" }),
  order: 20,
  lineOrder: 100,
  applyOrder: 60,
  read: () => loadAutoSwitch("schedule"),
  save: (v: AutoSwitch) => saveAutoSwitch("schedule", v),
  record: (v: AutoSwitch) => `schedule.auto=${v}`,
});

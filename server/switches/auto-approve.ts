import { AUTO_MODES, type AutoMode, loadDispatchConfig, saveAutoApprove } from "../dispatch.ts";
import { defineSwitch } from "../switch-def.ts";

// 일치 기반 자동 승인(ATC-334): dispatch.json autoApprove(ASSIGN·SCHEDULE 초안). 기본 off. 상한은 dispatch.json에서만 바꾼다. SUPERVISOR만(atcctl 명령은 없다, K3)
export default defineSwitch({
  key: "autoApprove",
  label: "AUTO APPROVE",
  group: "operations",
  block: { code: "AUTO APPROVE", label: "일치 기반 자동 승인", windowLabel: "DISPATCH 자동 운항·일치 기반 자동 승인(SUPERVISOR 전용)", words: "dispatch schedule crosscheck agree blind launch 자동 승인 autoApprove autoApproveLaunch via auto", searchOrder: 50 },
  values: AUTO_MODES,
  default: "off",
  risky: ["on"], // 서버가 CROSSCHECK가 agree한 ASSIGN·SCHEDULE 초안을 스스로 승인한다(shadow는 기록만, blind·HELD·disagree는 그대로 SUPERVISOR 몫)
  error: "off, shadow, on 중 하나",
  warn: {
    off: "off(기본): ASSIGN과 SCHEDULE 초안은 SUPERVISOR가 하나씩 누른다.",
    shadow: "shadow: 서버가 CROSSCHECK가 agree한 카드를 \"승인했을 것\"이라고 auto-approve.jsonl에만 적는다. 아무것도 승인하지 않는다.",
    on: "⚠ 서버가 CROSSCHECK가 agree한 열린 ASSIGN(LAUNCH 아님)과 SCHEDULE 초안을 스스로 승인한다(via auto). blind 표본·HELD·disagree·주의(caution) 카드와 FUEL hold인 AIRCRAFT는 SUPERVISOR 몫이고, 하루 상한을 넘으면 기다린다.",
  },
  row: () => ({ label: "ASSIGN·SCHEDULE", env: "autoApprove", note: `dispatch.json · 하루 ${loadDispatchConfig().autoApproveMax}건까지(굴러가는 24시간) · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈` }),
  order: 31,
  lineOrder: 120,
  applyOrder: 30,
  read: () => loadDispatchConfig().autoApprove,
  save: (v: AutoMode) => saveAutoApprove("autoApprove", v),
  record: (v: AutoMode) => `autoApprove=${v}`,
});

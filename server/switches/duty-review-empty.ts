import { loadDutyConfig } from "../duty-config.ts";
import { setDutyConfig } from "../duty-run.ts";
import { defineSwitch } from "../switch-def.ts";

// DUTY REVIEW empty 트리거(ATC-470, docs/duty.md): duty.json의 reviewEmpty(기본 on). 받을 수 있는 AIRCRAFT가 있는데 기다리는 Todo FLIGHT가 없는 상태가 이어지면 서버가 DUTY 점검 턴을 시작한다.
// 끄면 empty 트리거만 멈춘다(DUTY REVIEW의 다른 트리거는 그대로). SUPERVISOR만(이 화면 Origin)
export default defineSwitch({
  key: "dutyReviewEmpty",
  label: "DUTY REVIEW EMPTY",
  group: "operations",
  block: { code: "DUTY", label: "DUTY 채팅(atc 안의 대화 상대)", windowLabel: "DUTY 채팅(SUPERVISOR 전용)", words: "empty duty.reviewEmpty DUTY REVIEW EMPTY", searchOrder: 90 },
  values: ["off", "on"],
  default: "on",
  risky: ["on"], // DUTY REVIEW와 같다: 서버가 SUPERVISOR의 글 없이 DUTY 턴을 시작한다(ACCOUNT의 FUEL을 쓴다)
  error: "off 또는 on",
  warn: {
    off: "꺼짐: 놀고 있는 AIRCRAFT가 있어도 일감이 없다는 이유로는 DUTY 점검을 시작하지 않는다. 다른 점검 트리거는 그대로다.",
    on: "⚠ 기본: 받을 수 있는 AIRCRAFT가 있고 기다리는 Todo FLIGHT가 없는 상태가 20분 이어지면(1시간에 한 번까지) 서버가 DUTY 턴을 시작한다. DUTY는 지금 발권할 만한 READY Backlog를 요약에 짚고, 설계 문서의 빠진 단계와 작은 idea를 Backlog 이슈로만 제안한다(한 번에 최대 3개). 발권은 RELEASE 화면에서 SUPERVISOR가 한다.",
  },
  row: () => ({ label: "DUTY REVIEW EMPTY", env: "duty.reviewEmpty", note: "duty.json · 일감이 없는데 AIRCRAFT가 놀 때 DUTY 점검을 시작한다(DUTY REVIEW가 켜져 있을 때만 효과) · 이 화면에서만 바꾼다(SUPERVISOR 전용)" }),
  order: 60.7,
  lineOrder: 91.1,
  applyOrder: 175.5,
  read: () => (loadDutyConfig().reviewEmpty ? "on" : "off"),
  save: async (v: "off" | "on") => {
    await setDutyConfig({ reviewEmpty: v === "on" });
  },
  record: (v: "off" | "on") => `duty.reviewEmpty=${v}`,
});

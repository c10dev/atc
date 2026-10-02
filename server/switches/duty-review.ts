import { loadDutyConfig } from "../duty-config.ts";
import { setDutyConfig } from "../duty-run.ts";
import { defineSwitch } from "../switch-def.ts";

// DUTY REVIEW(ATC-396, docs/duty.md): duty.json의 review(기본 on). 서버가 SUPERVISOR의 글 없이 DUTY 점검 턴을 시작한다. SUPERVISOR만(이 화면 Origin)
export default defineSwitch({
  key: "dutyReview",
  label: "DUTY REVIEW",
  group: "operations",
  block: { code: "DUTY", label: "DUTY 채팅(atc 안의 대화 상대)", windowLabel: "DUTY 채팅(SUPERVISOR 전용)", words: "", searchOrder: 90 },
  values: ["off", "on"],
  default: "on",
  risky: ["on"], // 서버가 SUPERVISOR의 글 없이 DUTY 턴을 시작해 운영을 점검하고 Backlog 제안을 남긴다(ATC-396). 기본 on이라 ⚠로 보이고, 껐다 다시 켤 때 확인한다
  error: "off 또는 on",
  warn: {
    off: "꺼짐: 서버가 DUTY 턴을 스스로 시작하지 않는다. 점검과 병목 분석은 SUPERVISOR가 DUTY 채팅에서 부탁해야 한다.",
    on: "⚠ 기본: 정기적으로, 또는 놀고 있는 AIRCRAFT가 일감을 두고 이어지거나 leak이 오래 열려 있으면 서버가 DUTY 턴을 시작한다(DUTY가 켜져 있을 때, ACCOUNT의 FUEL을 쓴다). DUTY는 채팅에 한국어 요약을 남기고 제안을 Backlog 이슈로만 만든다. Todo로 올려 쏘는 것은 RELEASE 화면에서 SUPERVISOR가 한다.",
  },
  row: () => ({ label: "DUTY REVIEW", env: "duty.review", note: "duty.json · 서버가 스스로 DUTY 점검 턴을 시작한다(주기·트리거) · 이 화면에서만 바꾼다(SUPERVISOR 전용)" }),
  order: 60.6,
  lineOrder: 91,
  applyOrder: 175,
  read: () => (loadDutyConfig().review ? "on" : "off"),
  save: async (v: "off" | "on") => {
    await setDutyConfig({ review: v === "on" });
  },
  record: (v: "off" | "on") => `duty.review=${v}`,
});

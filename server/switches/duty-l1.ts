import { loadDutyConfig } from "../duty-config.ts";
import { setDutyConfig } from "../duty-run.ts";
import { defineSwitch } from "../switch-def.ts";

// DUTY L1(ATC-349, docs/duty.md): duty.json의 l1(기본 off). DUTY가 자기 STAND를 열고 Linear에 쓰는 길을 여는 스위치. 에이전트 자신의 힘을 넓히므로 SUPERVISOR만(이 화면 Origin, atcctl·관제 세션 길 없음)
export default defineSwitch({
  key: "dutyL1",
  label: "DUTY L1",
  group: "operations",
  block: { code: "DUTY", label: "DUTY 채팅(atc 안의 대화 상대)", windowLabel: "DUTY 채팅(SUPERVISOR 전용)", words: "l1 duty.l1 DUTY L1 stand linear", searchOrder: 90 },
  values: ["off", "on"],
  default: "off",
  risky: ["on"], // DUTY가 duty-* STAND에서 문서를 커밋·푸시하고 Linear에 이슈를 쓴다
  error: "off 또는 on",
  warn: {
    off: "꺼짐(기본): DUTY가 STAND를 열거나 Linear에 쓰려 하면 \"L1이 꺼져 있음\"으로 거절된다. L1은 DUTY가 켜져 있을 때만 효과가 있다.",
    on: "⚠ DUTY가 자기 STAND(duty-*)에서 문서를 커밋·푸시해 PR을 열고, Linear ATC 팀에 이슈를 만들고 고친다. 머지와 배포는 하지 않는다. L1은 DUTY가 켜져 있을 때만 효과가 있다.",
  },
  row: () => ({ label: "DUTY L1", env: "duty.l1", note: "duty.json · DUTY의 STAND·Linear 쓰기 길(DUTY가 켜져 있을 때만 효과) · 이 화면에서만 바꾼다(SUPERVISOR 전용)" }),
  order: 61.5,
  lineOrder: 91.5,
  applyOrder: 177,
  read: () => (loadDutyConfig().l1 ? "on" : "off"),
  save: async (v: "off" | "on") => {
    await setDutyConfig({ l1: v === "on" });
  },
  record: (v: "off" | "on") => `duty.l1=${v}`,
});

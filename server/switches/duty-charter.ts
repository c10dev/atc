import { loadDutyConfig } from "../duty-config.ts";
import { setDutyConfig } from "../duty-run.ts";
import { defineSwitch } from "../switch-def.ts";

// DUTY CHARTER(ATC-233, docs/duty.md 3.4·D5): duty.json의 charter. DUTY가 만들고 SUPERVISOR가 확정한 CHARTER REQUEST를 OCC가 읽는 정도. SUPERVISOR만(이 화면, atcctl 명령 없음)
export default defineSwitch({
  key: "dutyCharter",
  label: "DUTY CHARTER",
  group: "operations",
  block: { code: "DUTY", label: "DUTY 채팅(atc 안의 대화 상대)", windowLabel: "DUTY 채팅(SUPERVISOR 전용)", words: "", searchOrder: 90 },
  values: ["off", "shadow", "on"],
  default: "off",
  risky: ["on"], // OCC가 DUTY의 CHARTER REQUEST를 SCHEDULE 초안으로 만든다(shadow는 만들었을 초안만 기록)
  error: "off, shadow, on 중 하나",
  warn: {
    off: "꺼짐(기본): 확정한 요청은 줄에 서지만 OCC의 schedule brief에는 나오지 않는다(카드에 \"switch is off — kept as a draft\").",
    shadow: "OCC가 schedule brief의 duty 구역으로 요청을 읽고, 만들었을 초안을 charter-seen으로 기록만 한다. schedule draft NEW는 하지 않는다. 아래에서 기록을 본다.",
    on: "⚠ OCC가 확정된 요청을 CHARTER REQUEST로 처리한다: schedule wip → schedule draft NEW(AD HOC FLIGHT 초안, 판정은 여전히 SUPERVISOR). 요청 글은 데이터로만 읽는다.",
  },
  row: () => ({
    label: "DUTY CHARTER",
    env: "duty.charter",
    note: "duty.json · DUTY가 만든 CHARTER REQUEST를 SUPERVISOR가 카드에서 확정하면 OCC가 다음 tick에 schedule brief로 읽는다 · 이 화면에서만 바꾼다(atcctl에는 명령이 없다)",
  }),
  order: 61,
  lineOrder: 90,
  applyOrder: 170,
  read: () => loadDutyConfig().charter,
  save: async (v: "off" | "shadow" | "on") => {
    await setDutyConfig({ charter: v });
  },
  record: (v: "off" | "shadow" | "on") => `duty.charter=${v}`,
});

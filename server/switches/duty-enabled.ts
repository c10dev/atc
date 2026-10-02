import { loadDutyConfig } from "../duty-config.ts";
import { setDutyConfig } from "../duty-run.ts";
import { defineSwitch } from "../switch-def.ts";

// DUTY(ATC-220): duty.json의 enabled. 기본 꺼짐. 켜면 SUPERVISOR가 첫 글을 보낼 때 이 서버가 `claude -p`를 띄운다(ACCOUNT의 FUEL을 쓴다). 끄면 실행 중인 프로세스가 끝난다. SUPERVISOR만
export default defineSwitch({
  key: "dutyEnabled",
  label: "DUTY",
  group: "operations",
  block: {
    code: "DUTY",
    label: "DUTY 채팅(atc 안의 대화 상대)",
    windowLabel: "DUTY 채팅(SUPERVISOR 전용)",
    words: "duty chat 채팅 서랍 drawer claude acct-2 duty.enabled 대화 shift charter 차터 duty.charter CHARTER REQUEST OCC",
    searchOrder: 90,
  },
  values: ["off", "on"],
  default: "off",
  risky: ["on"], // 서버가 `claude -p` 프로세스를 띄우고 ACCOUNT의 FUEL을 쓴다(SUPERVISOR가 글을 보낼 때만)
  error: "off 또는 on",
  warn: {
    off: "꺼짐(기본): 헤더에 DUTY가 보이지 않고, 글을 보내도 받지 않는다. 켜 둔 프로세스가 있으면 끝난다.",
    on: "⚠ 헤더의 DUTY 서랍에서 글을 보내면 이 서버가 `claude -p` 프로세스를 띄운다(ACCOUNT의 FUEL을 쓴다). 유휴 시간이 지나면 끝나고 다음 글이 이어서 띄운다. DUTY는 읽기만 하고, 글은 소리로 읽지 않는다.",
  },
  row: () => ({ label: "DUTY", env: "duty.enabled", note: `duty.json · 유휴 ${loadDutyConfig().idleMin}분 뒤 프로세스 종료 · 이 화면에서만 바꾼다` }),
  order: 60,
  lineOrder: 80,
  applyOrder: 160,
  read: () => (loadDutyConfig().enabled ? "on" : "off"),
  save: async (v: "off" | "on") => {
    await setDutyConfig({ enabled: v === "on" });
  },
  record: (v: "off" | "on") => `duty.enabled=${v}`,
});

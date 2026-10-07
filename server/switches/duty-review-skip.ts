import { loadDutyConfig } from "../duty-config.ts";
import { setDutyConfig } from "../duty-run.ts";
import { defineSwitch } from "../switch-def.ts";

// DUTY REVIEW SKIP(ATC-566, docs/duty.md): duty.json의 reviewSkip(기본 on). 서버가 점검을 시작하기 전에 실을 사실의 지문을 지난 점검과 견주고,
// 같고 그 점검이 이슈도 댓글도 내지 않았으면 건너뛴다(하루 한 번 00:00Z 뒤 첫 점검과 사실이 바뀐 때는 돈다). 끄면 오늘처럼 늘 돈다. SUPERVISOR만(이 화면 Origin)
export default defineSwitch({
  key: "dutyReviewSkip",
  label: "DUTY REVIEW SKIP",
  group: "operations",
  block: { code: "DUTY", label: "DUTY 채팅(atc 안의 대화 상대)", windowLabel: "DUTY 채팅(SUPERVISOR 전용)", words: "skip duty.reviewSkip DUTY REVIEW SKIP 건너뛰기", searchOrder: 90 },
  values: ["off", "on"],
  default: "on",
  risky: [], // 켜면 서버가 시작하는 턴이 줄어든다(더 쓰거나 내보내지 않는다)
  error: "off 또는 on",
  warn: {
    off: "꺼짐: 사실이 지난 점검과 같아도 트리거가 서면 DUTY 점검을 시작한다(ATC-566 이전과 같다).",
    on: "기본: 점검이 실을 사실(놀고 있는 AIRCRAFT·기다리는 FLIGHT·열린 leak·착륙 대기열·WARNING/CAUTION 알림·EFFECT CHECK 평결, 분과 컨텍스트 크기는 뺀다)이 지난 점검과 같고 그 점검이 이슈도 댓글도 내지 않았으면 건너뛴다. 사실이 바뀌면 곧바로, 바뀌지 않아도 하루 한 번(00:00Z 뒤 첫 트리거) 돈다. SUPERVISOR가 DUTY에게 쓴 글은 건너뛰지 않는다.",
  },
  row: () => ({ label: "DUTY REVIEW SKIP", env: "duty.reviewSkip", note: "duty.json · 같은 사실이면 서버가 시작하는 DUTY 점검을 건너뛴다(DUTY REVIEW가 켜져 있을 때만 효과) · 이 화면에서만 바꾼다(SUPERVISOR 전용)" }),
  order: 60.8,
  lineOrder: 91.2,
  applyOrder: 175.6,
  read: () => (loadDutyConfig().reviewSkip ? "on" : "off"),
  save: async (v: "off" | "on") => {
    await setDutyConfig({ reviewSkip: v === "on" });
  },
  record: (v: "off" | "on") => `duty.reviewSkip=${v}`,
});

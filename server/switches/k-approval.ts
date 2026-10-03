import { loadMcc } from "../mcc.ts";
import { kLandDays, setKApproval } from "../mcc-run.ts";
import { defineSwitch } from "../switch-def.ts";

// K 승인 착륙(ATC-391, K3): mcc.json의 kApproval(기본 on, 꺼지는 것은 정확히 "off"). 발권 때 승인한 K 효과 안에서 만든 user 등급 PR을 MCC가 사용자 머지 없이 착륙시킨다. 바꾸는 것은 SUPERVISOR만
export default defineSwitch({
  key: "mccKApproval",
  label: "K APPROVAL",
  group: "landing",
  block: { code: "MCC", label: "atc 착륙·RETURN TO SERVICE", windowLabel: "atc 착륙·RETURN TO SERVICE(SUPERVISOR 전용)", words: "k approval kApproval K3 발권 user 등급 착륙 release", searchOrder: 20 },
  values: ["off", "on"],
  default: "on",
  risky: ["on"], // MCC가 발권 때 승인한 K 효과 안의 user 등급 PR을 사용자 머지 없이 착륙시킨다. 기본 on이라 ⚠로 보이고, 껐다 다시 켤 때 확인한다
  error: "on 또는 off",
  warn: {
    off: "off: user 등급 PR은 K 효과를 발권 때 승인했어도 사용자가 머지한다.",
    on: "⚠ 기본 켜짐. 발권(화면 클릭·DUTY 채팅)에 선언한 K3 효과 안에서 만든 user 등급 PR은 INSPECTION pass와 CI 뒤 MCC가 착륙시킨다(사용자 머지 없음). attested 발권만으로는 안 되고 RELEASE 화면에서 한 번 확인해야 한다. 선언을 넘는 변경·ESCALATE·P0/P1·이 검사를 바꾸는 PR·마이그레이션·비밀 경로는 사용자 몫이다.",
  },
  row: () => ({ label: "K APPROVAL", env: "mccKApproval", note: "mcc.json · 이 화면에서만 바꾼다 — MCC 세션은 못 바꿈 · 발권 때 승인한 K 효과 안에서 만든 user 등급 PR을 MCC가 착륙시킨다" }),
  // 최근 7일의 날짜별 K 승인 착륙·revert·ROLLBACK 수. 설정 창의 MCC 블록이 그린다
  data: () => ({ days: kLandDays(7) }),
  order: 31,
  lineOrder: 21,
  applyOrder: 111,
  read: () => loadMcc().kApproval,
  save: (v: "on" | "off") => setKApproval(v),
  record: (v: "on" | "off") => `mcc.kApproval=${v}`,
});

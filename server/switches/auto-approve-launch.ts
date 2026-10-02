import { AUTO_MODES, type AutoMode, loadDispatchConfig, saveAutoApprove } from "../dispatch.ts";
import { defineSwitch } from "../switch-def.ts";

// dispatch.json autoApproveLaunch(ATC-334): launch 카드를 서버가 승인하고 LAUNCH한다. SUPERVISOR만
export default defineSwitch({
  key: "autoApproveLaunch",
  label: "AUTO LAUNCH",
  group: "operations",
  block: { code: "AUTO APPROVE", label: "일치 기반 자동 승인", windowLabel: "DISPATCH 자동 운항·일치 기반 자동 승인(SUPERVISOR 전용)", words: "", searchOrder: 50 },
  values: AUTO_MODES,
  default: "off",
  risky: ["on"], // 서버가 launch 카드를 스스로 승인하고 세션을 띄운다(상한·FUEL hold·막힘·실패 뒤 대기·하루 상한을 지킬 때만)
  error: "off, shadow, on 중 하나",
  warn: {
    off: "off(기본): launch 카드(ABSENT·RESUME)는 SUPERVISOR가 화면에서 승인한다.",
    shadow: "shadow: 승인과 LAUNCH 조건을 모두 갖춘 launch 카드를 \"띄웠을 것\"이라고 auto-approve.jsonl에만 적는다. 아무것도 띄우지 않는다.",
    on: "⚠ 서버가 launch 카드를 스스로 승인하고 세션을 띄운다(사용량을 쓴다). CROSSCHECK agree, blind·HELD 아님, 상한(ATC_MAX_LAUNCHED)이 안 참, ACCOUNT가 FUEL hold 아님, LAUNCH 막힘 아님, 실패한 REGISTRATION은 쉼, 하루 상한 안일 때만.",
  },
  row: () => {
    const c = loadDispatchConfig();
    return { label: "launch 카드", env: "autoApproveLaunch", note: `dispatch.json · 하루 ${c.autoLaunchMax}번까지, 실패한 REGISTRATION은 ${c.autoLaunchBackoffMin}분 쉼 · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈` };
  },
  order: 32,
  lineOrder: 130,
  applyOrder: 40,
  read: () => loadDispatchConfig().autoApproveLaunch,
  save: (v: AutoMode) => saveAutoApprove("autoApproveLaunch", v),
  record: (v: AutoMode) => `autoApproveLaunch=${v}`,
});

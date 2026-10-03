import { loadDispatchConfig, saveK3Hold } from "../dispatch.ts";
import { defineSwitch } from "../switch-def.ts";

// K3 HOLD(ATC-398, K3): dispatch.json k3Hold. 끄면 K3 줄이 읽히지 않거나 allow를 못 주는 발권인 FLIGHT도 보낸다. SUPERVISOR만(이 화면 Origin), atcctl 명령 없음
export default defineSwitch({
  key: "k3Hold",
  label: "K3 HOLD",
  group: "operations",
  block: { code: "K3 HOLD", label: "K3 줄이 있는 FLIGHT는 allow 없이 보내지 않음", windowLabel: "K3 FLIGHT는 allow 없이 보내지 않음(SUPERVISOR 전용)", words: "k3 hold allow 발권 declaration 선언 release 화면 classifier nuisance miss 오작동 k3Hold", searchOrder: 52 },
  values: ["off", "on"],
  default: "on",
  risky: ["off"], // 끄면 K3 줄이 읽히지 않거나 allow를 못 주는 발권인 FLIGHT도 보낸다. 기본 on, 끄는 것이 ⚠
  error: "off 또는 on",
  warn: {
    on: "기본: `## K effects`에 `K3` 줄이 있는 FLIGHT는 줄이 `K3[<라벨>]: <통제> | files: <경로>`로 읽히고 RELEASE 화면(또는 DUTY 채팅)에서 발권됐을 때만 DISPATCH가 보낸다. 아니면 이유와 고치는 길을 제외 사유와 HOME 알림에 보인다.",
    off: "⚠ K3 줄이 읽히지 않거나 세션이 증언한 발권인 FLIGHT도 allow 없이 보낸다. 그 FLIGHT는 이미 SUPERVISOR가 푼 효과에서 classifier 거부로 멈출 수 있다(MISS).",
  },
  row: () => ({ label: "K3 HOLD", env: "k3Hold", note: "dispatch.json · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈 · 오작동 수는 RELEASE 화면" }),
  order: 39,
  lineOrder: 141,
  applyOrder: 56,
  read: () => loadDispatchConfig().k3Hold,
  save: (v: "off" | "on") => saveK3Hold(v),
  record: (v: "off" | "on") => `k3Hold=${v}`,
});

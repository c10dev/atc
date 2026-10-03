import { loadDispatchConfig, saveK3Relaunch } from "../dispatch.ts";
import { defineSwitch } from "../switch-def.ts";

// K3 RELAUNCH(ATC-509, K3): dispatch.json k3Relaunch. 켜면 K3 FLIGHT를 받을 ABSENT AIRCRAFT가 없을 때 쉬는 AIRCRAFT를 멈추고 새로 띄우는 FLEET PLAN 카드를 낸다. 기본 off. SUPERVISOR만(이 화면 Origin), atcctl 명령 없음
export default defineSwitch({
  key: "k3Relaunch",
  label: "K3 RELAUNCH",
  group: "operations",
  block: { code: "K3 RELAUNCH", label: "K3 FLIGHT에 쉬는 AIRCRAFT를 멈추고 새로 띄우는 카드", windowLabel: "K3 FLIGHT에 쉬는 AIRCRAFT를 멈추고 새로 띄우기(SUPERVISOR 전용)", words: "k3 relaunch stop launch fresh 새로 띄움 쉬는 AIRCRAFT fleet plan 카드 오작동 k3Relaunch", searchOrder: 53 },
  values: ["off", "on"],
  default: "off",
  risky: ["on"], // 켜면 승인한 카드가 살아 있는 세션을 멈춘다(process control). 기본 off, 켜는 것이 ⚠
  error: "off 또는 on",
  warn: {
    off: "기본: K3 FLIGHT를 받을 ABSENT AIRCRAFT가 없으면 DISPATCH 제외 사유가 \"K3: needs a fresh LAUNCH\"라고 말만 한다. 카드는 없다.",
    on: "⚠ K3 FLIGHT를 받을 ABSENT AIRCRAFT가 없고 쉬는 AIRCRAFT(PR·STAND 없음, LIMIT·FUEL hold 아님)가 있으면 FLEET PLAN이 \"STOP <REGISTRATION> and LAUNCH it for <FLIGHT>\" 카드를 낸다. 승인하면 그 세션을 멈추고 그 FLIGHT의 K3 allow로 새로 띄운다.",
  },
  row: () => ({ label: "K3 RELAUNCH", env: "k3Relaunch", note: "dispatch.json · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈 · 오작동 수는 RELEASE 화면" }),
  order: 39.5,
  lineOrder: 142,
  applyOrder: 57,
  read: () => loadDispatchConfig().k3Relaunch,
  save: (v: "off" | "on") => saveK3Relaunch(v),
  record: (v: "off" | "on") => `k3Relaunch=${v}`,
});

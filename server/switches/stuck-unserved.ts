import { loadDispatchConfig, saveStuckUnserved } from "../dispatch.ts";
import { record } from "../recorder.ts";
import { defineSwitch } from "../switch-def.ts";

// 막힘 알림 문구(ATC-522): dispatch.json stuckUnserved(기본 on). DISPATCH가 plan.unserved에 올린 Todo FLIGHT의 follow|stuck 알림이
// "제안 없이 Todo n분" 대신 사유(no-aircraft·unqualified·no-tail)·AIRPORT·다음 한 걸음을 적는다. 글만 바뀐다 — 무엇을 막거나 보내지 않는다.
// 끄면 옛 문구. SUPERVISOR만(이 화면 Origin), atcctl 명령 없음
export default defineSwitch({
  key: "stuckUnserved",
  label: "STUCK UNSERVED",
  group: "operations",
  block: { code: "STUCK UNSERVED", label: "받을 AIRCRAFT가 없는 Todo의 막힘 알림 문구", windowLabel: "막힘 알림 문구(SUPERVISOR 전용)", words: "stuck unserved 막힘 알림 문구 no-aircraft unqualified no-tail 받을 AIRCRAFT 없음 LAUNCH stuckUnserved", searchOrder: 102 },
  values: ["off", "on"],
  default: "on",
  risky: [], // 알림 글만 바꾸니 ⚠ 목록에 넣지 않는다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: 받을 AIRCRAFT가 없는 Todo FLIGHT도 옛 문구 \"제안 없이 Todo n분\"으로 알린다. 사유와 다음 한 걸음이 알림에 없다.",
    on: "기본: DISPATCH가 못 받는다고 올린 Todo FLIGHT의 막힘 알림이 사유(no-aircraft 등)·AIRPORT·다음 한 걸음(LAUNCH, K3면 K3 RELAUNCH나 STOP)을 적는다. 다른 막힘의 문구는 그대로다. 새 문구를 쓴 알림 수는 GET /api/stuck-unserved.",
  },
  row: () => ({ label: "STUCK UNSERVED", env: "stuckUnserved", note: "dispatch.json · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈 · 쓴 알림 수는 GET /api/stuck-unserved" }),
  order: 72,
  applyOrder: 62,
  read: () => loadDispatchConfig().stuckUnserved,
  save: (v: "off" | "on") => {
    const from = loadDispatchConfig().stuckUnserved;
    saveStuckUnserved(v);
    if (from !== v) record({ t: new Date().toISOString(), kind: "policy", op: "stuck-unserved-mode", by: "SUPERVISOR", from, to: v });
  },
  record: (v: "off" | "on") => `stuckUnserved=${v}`,
});

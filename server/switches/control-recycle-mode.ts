import { loadRecycle, RECYCLE_MODES, type RecycleMode } from "../control-recycle.ts";
import { setRecycleMode } from "../control-recycle-run.ts";
import { defineSwitch } from "../switch-def.ts";

// CONTROL RECYCLE(ATC-166, docs/control-recycle.md): control-recycle.json의 mode. 기본 off. SUPERVISOR만
export default defineSwitch({
  key: "controlRecycleMode",
  label: "CONTROL RECYCLE",
  group: "operations",
  block: { code: "CONTROL RECYCLE", label: "관제 세션 자동 재시작", windowLabel: "관제 세션 자동 재시작(SUPERVISOR 전용)", words: "cap 컨텍스트 context 재시작 auto alert controlRecycle.mode", searchOrder: 80 },
  values: RECYCLE_MODES,
  default: "off",
  risky: ["on"], // atc가 관제 세션을 스스로 STOP·LAUNCH한다(shadow는 기록만)
  error: "off, shadow, on 중 하나",
  warn: {
    off: "꺼짐(기본): 컨텍스트가 CAP을 넘어도 atc는 관제 세션을 건드리지 않는다. MCC는 MCC LOG에 STOP·LAUNCH를 청한다.",
    shadow: "CAP을 넘고 안전한 순간이면 \"재시작했을 것\"을 FLIGHT RECORDER에만 남긴다(control recycle, would). 세션은 그대로.",
    on: "⚠ CAP을 넘고 턴 사이이며 안전한 순간이면 atc가 그 관제 세션을 STOP하고 같은 ACCOUNT로 LAUNCH한다(FLEET의 버튼과 같은 길, 한 번에 한 세션, 3시간에 한 번). 결과는 FLIGHT RECORDER와 SUPERVISOR ALERT로 남는다.",
  },
  row: () => ({ label: "CONTROL RECYCLE", env: "controlRecycle.mode", note: `control-recycle.json · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈 · 같은 세션은 ${loadRecycle().cooldownHours}시간에 한 번` }),
  order: 50,
  lineOrder: 60,
  applyOrder: 150,
  read: () => loadRecycle().mode,
  save: (v: RecycleMode) => setRecycleMode(v),
});

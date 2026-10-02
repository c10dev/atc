import { loadRecycle } from "../control-recycle.ts";
import { setRecycleAuto } from "../control-recycle-run.ts";
import { defineSwitch } from "../switch-def.ts";

// CONTROL RECYCLE의 세션별 auto(ATC-175): 세션 이름 → 자동 재시작 대상인가(OCC 기본 false, 측정·알림만). SUPERVISOR만. 줄은 화면의 RecycleSessions가 따로 그린다
export default defineSwitch({
  key: "controlRecycleAuto",
  label: "CONTROL RECYCLE AUTO",
  group: "operations",
  block: { code: "CONTROL RECYCLE", label: "관제 세션 자동 재시작", windowLabel: "관제 세션 자동 재시작(SUPERVISOR 전용)", words: "", searchOrder: 80 },
  default: "{}",
  risky: [],
  line: false,
  validate: (raw) => {
    const known = Object.keys(loadRecycle().auto);
    const a = raw as Record<string, unknown>;
    if (!a || typeof a !== "object" || Array.isArray(a) || Object.entries(a).some(([k, v]) => !known.includes(k) || typeof v !== "boolean"))
      return { ok: false, error: `세션 이름(${known.join(", ")}) → true 또는 false` };
    return { ok: true, value: a };
  },
  order: 52,
  applyOrder: 140,
  read: () => JSON.stringify(loadRecycle().auto),
  save: (v: Record<string, boolean>) => setRecycleAuto(v),
});

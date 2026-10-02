import { loadRecycle, recycleCapOk } from "../control-recycle.ts";
import { setRecycleCaps } from "../control-recycle-run.ts";
import { defineSwitch } from "../switch-def.ts";

// CONTROL RECYCLE의 세션별 CAP(ATC-166): 세션 이름 → CAP 토큰(null이면 재시작 안 함). SUPERVISOR만. 줄은 화면의 RecycleSessions가 따로 그린다
export default defineSwitch({
  key: "controlRecycleCaps",
  label: "CONTROL RECYCLE CAPS",
  group: "operations",
  block: { code: "CONTROL RECYCLE", label: "관제 세션 자동 재시작", windowLabel: "관제 세션 자동 재시작(SUPERVISOR 전용)", words: "", searchOrder: 80 },
  default: "{}",
  risky: [],
  line: false,
  validate: (raw) => {
    const known = Object.keys(loadRecycle().caps);
    const caps = raw as Record<string, unknown>;
    const bad = !caps || typeof caps !== "object" || Array.isArray(caps) || Object.entries(caps).some(([k, v]) => !known.includes(k) || !(v === null || recycleCapOk(v)));
    return bad ? { ok: false, error: `세션 이름(${known.join(", ")}) → 50000–900000 토큰 또는 null` } : { ok: true, value: caps };
  },
  order: 51,
  applyOrder: 130,
  read: () => JSON.stringify(loadRecycle().caps),
  save: (v: Record<string, number | null>) => setRecycleCaps(v),
});

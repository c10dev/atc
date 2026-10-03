import { loadDispatchConfig, saveStaleStop } from "../dispatch.ts";
import { record } from "../recorder.ts";
import { defineSwitch } from "../switch-def.ts";

// STALE STOP(ATC-369): dispatch.json staleStop(기본 on). FLIGHT가 머지·ARRIVED인데 PENDING·HUNG으로 30분 남은 AIRCRAFT를 서버가 멈춘다(주기 일 server/jobs/stale-stop.ts). SUPERVISOR만(이 화면 Origin), atcctl 명령 없음
export default defineSwitch({
  key: "staleStop",
  label: "STALE STOP",
  group: "operations",
  block: { code: "STALE STOP", label: "끝난 FLIGHT의 멈춘 AIRCRAFT 정리", windowLabel: "끝난 FLIGHT의 멈춘 AIRCRAFT 정리(SUPERVISOR 전용)", words: "stale stop pending hung 멈춘 정리 staleStop", searchOrder: 51 },
  values: ["off", "on"],
  default: "on",
  risky: [], // 정책 한 줄과 ⚠ 목록에 없던 스위치(ATC-369)
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: 끝난 FLIGHT의 PENDING·HUNG AIRCRAFT를 서버가 멈추지 않는다. SUPERVISOR나 OCC가 STOP한다.",
    on: "기본: FLIGHT가 머지·ARRIVED인데 PENDING·HUNG으로 30분 남은 AIRCRAFT를 서버가 멈추고 FLIGHT RECORDER에 남긴다.",
  },
  row: () => ({ label: "STALE STOP", env: "staleStop", note: "dispatch.json · FLIGHT가 머지·ARRIVED인데 PENDING·HUNG으로 30분 남은 AIRCRAFT를 서버가 멈추고 FLIGHT RECORDER에 남긴다 · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈" }),
  order: 38,
  applyOrder: 55,
  read: () => loadDispatchConfig().staleStop,
  save: (v: "off" | "on") => {
    const from = loadDispatchConfig().staleStop;
    saveStaleStop(v);
    if (from !== v) record({ t: new Date().toISOString(), kind: "policy", op: "stale-stop-mode", by: "SUPERVISOR", from, to: v });
  },
  record: (v: "off" | "on") => `staleStop=${v}`,
});

import { loadServerClearanceSwitch, saveServerClearanceSwitch } from "../server-clearance-run.ts";
import { defineSwitch } from "../switch-def.ts";

// SERVER CLEARANCE RESEND(ATC-557 b): server-clearance.json의 resend(기본 on, shadow 없음). on이면 서버가 RESEND CLEARANCE를 짓고 보낸다.
// off면 TOWER가 오늘처럼 overdue CLEARANCE를 한 번 RESEND한다. SUPERVISOR만(이 화면 Origin), atcctl 명령 없음
export default defineSwitch({
  key: "serverClearanceResend",
  label: "SERVER CLEARANCE RESEND",
  group: "operations",
  block: { code: "SERVER CLEARANCE", label: "서버가 CLEARANCE를 세션에 직접 보냄", words: "resend RESEND" },
  values: ["off", "on"],
  default: "on",
  risky: ["on"], // 서버가 TOWER 없이 AIRCRAFT 세션에 쓴다. 기본 on이라 ⚠로 보이고, 껐다 다시 켤 때 확인한다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: TOWER가 오늘처럼 overdue CLEARANCE를 한 번 RESEND한다.",
    on: "⚠ 기본: 첫 RESEND(답 없이 10분, 첫 STANDBY부터): 같은 받는 이·종류·STAND·FLIGHT로 “RESEND ” + 원래 글. 두 번째 침묵의 “답 없음” 보고는 TOWER. 기록·검사·넘김은 SERVER CLEARANCE INFO 줄과 같다.",
  },
  row: () => ({ label: "SERVER CLEARANCE RESEND", env: "server-clearance.resend", note: "server-clearance.json · 이 화면에서만 바꾼다 — TOWER는 못 바꿈" }),
  order: 76.5,
  applyOrder: 147.5,
  read: () => loadServerClearanceSwitch().resend,
  save: (v: "on" | "off") => saveServerClearanceSwitch("resend", v),
  record: (v: "on" | "off") => `serverClearance.resend=${v}`,
});

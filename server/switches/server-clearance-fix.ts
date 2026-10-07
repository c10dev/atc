import { loadServerClearanceSwitch, saveServerClearanceSwitch } from "../server-clearance-run.ts";
import { defineSwitch } from "../switch-def.ts";

// SERVER CLEARANCE FIX(ATC-557 b): server-clearance.json의 fix(기본 on, shadow 없음). on이면 서버가 FIX CLEARANCE를 짓고 보낸다.
// off면 TOWER가 오늘처럼 FIX(action send)를 보낸다. SUPERVISOR만(이 화면 Origin), atcctl 명령 없음
export default defineSwitch({
  key: "serverClearanceFix",
  label: "SERVER CLEARANCE FIX",
  group: "operations",
  block: { code: "SERVER CLEARANCE", label: "서버가 CLEARANCE를 세션에 직접 보냄", words: "fix FIX" },
  values: ["off", "on"],
  default: "on",
  risky: ["on"], // 서버가 TOWER 없이 AIRCRAFT 세션에 쓴다. 기본 on이라 ⚠로 보이고, 껐다 다시 켤 때 확인한다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: TOWER가 오늘처럼 FIX(action send)를 보낸다.",
    on: "⚠ 기본: FIX(현재 head의 리뷰 지적): landingQueue[].fix.text를 그대로. 기록·검사·넘김은 SERVER CLEARANCE INFO 줄과 같다.",
  },
  row: () => ({ label: "SERVER CLEARANCE FIX", env: "server-clearance.fix", note: "server-clearance.json · 이 화면에서만 바꾼다 — TOWER는 못 바꿈" }),
  order: 76.3,
  applyOrder: 147.3,
  read: () => loadServerClearanceSwitch().fix,
  save: (v: "on" | "off") => saveServerClearanceSwitch("fix", v),
  record: (v: "on" | "off") => `serverClearance.fix=${v}`,
});

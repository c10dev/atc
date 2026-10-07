import { loadServerClearanceSwitch, saveServerClearanceSwitch } from "../server-clearance-run.ts";
import { defineSwitch } from "../switch-def.ts";

// SERVER CLEARANCE LAND(ATC-557 b): server-clearance.json의 land(기본 on, shadow 없음). on이면 서버가 LAND CLEARANCE를 짓고 보낸다.
// off면 TOWER가 오늘처럼 CLEARED PR에 LAND를 보낸다. SUPERVISOR만(이 화면 Origin), atcctl 명령 없음
export default defineSwitch({
  key: "serverClearanceLand",
  label: "SERVER CLEARANCE LAND",
  group: "operations",
  block: { code: "SERVER CLEARANCE", label: "서버가 CLEARANCE를 세션에 직접 보냄", words: "land LAND" },
  values: ["off", "on"],
  default: "on",
  risky: ["on"], // 서버가 TOWER 없이 AIRCRAFT 세션에 쓴다. 기본 on이라 ⚠로 보이고, 껐다 다시 켤 때 확인한다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: TOWER가 오늘처럼 CLEARED PR에 LAND를 보낸다.",
    on: "⚠ 기본: LAND(CLEARED, landBy holder, GROUND STOP·slotHold·이미 나간 LAND 없음): landText를 그대로. 기록·검사·넘김은 SERVER CLEARANCE INFO 줄과 같다.",
  },
  row: () => ({ label: "SERVER CLEARANCE LAND", env: "server-clearance.land", note: "server-clearance.json · 이 화면에서만 바꾼다 — TOWER는 못 바꿈" }),
  order: 76.4,
  applyOrder: 147.4,
  read: () => loadServerClearanceSwitch().land,
  save: (v: "on" | "off") => saveServerClearanceSwitch("land", v),
  record: (v: "on" | "off") => `serverClearance.land=${v}`,
});

import { loadServerClearanceSwitch, saveServerClearanceSwitch } from "../server-clearance-run.ts";
import { defineSwitch } from "../switch-def.ts";

// SERVER CLEARANCE RELAY(ATC-557 b): server-clearance.json의 relay(기본 on, shadow 없음). on이면 서버가 RELAY CLEARANCE를 짓고 보낸다.
// off면 TOWER가 오늘처럼 relays[]를 CLEARANCE로 보내고 relay issued로 표시한다. SUPERVISOR만(이 화면 Origin), atcctl 명령 없음
export default defineSwitch({
  key: "serverClearanceRelay",
  label: "SERVER CLEARANCE RELAY",
  group: "operations",
  block: { code: "SERVER CLEARANCE", label: "서버가 CLEARANCE를 세션에 직접 보냄", words: "relay RELAY" },
  values: ["off", "on"],
  default: "on",
  risky: ["on"], // 서버가 TOWER 없이 AIRCRAFT 세션에 쓴다. 기본 on이라 ⚠로 보이고, 껐다 다시 켤 때 확인한다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: TOWER가 오늘처럼 relays[]를 CLEARANCE로 보내고 relay issued로 표시한다.",
    on: "⚠ 기본: SUPERVISOR RELAY: relays[]의 글·종류·STAND를 그대로 CLEARANCE로 적고 relay issued로 표시. 기록·검사·넘김은 SERVER CLEARANCE INFO 줄과 같다.",
  },
  row: () => ({ label: "SERVER CLEARANCE RELAY", env: "server-clearance.relay", note: "server-clearance.json · 이 화면에서만 바꾼다 — TOWER는 못 바꿈" }),
  order: 76.6,
  applyOrder: 147.6,
  read: () => loadServerClearanceSwitch().relay,
  save: (v: "on" | "off") => saveServerClearanceSwitch("relay", v),
  record: (v: "on" | "off") => `serverClearance.relay=${v}`,
});

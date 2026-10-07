import { loadServerClearanceSwitch, saveServerClearanceSwitch, serverClearanceData } from "../server-clearance-run.ts";
import { defineSwitch } from "../switch-def.ts";

// SERVER CLEARANCE INFO(ATC-557 b): server-clearance.json의 info(기본 on, shadow 없음). on이면 서버가 INFO CLEARANCE를 짓고 보낸다.
// off면 TOWER가 오늘처럼 landingQueue[].info(action send)를 보고 INFO를 보낸다. SUPERVISOR만(이 화면 Origin), atcctl 명령 없음
export default defineSwitch({
  key: "serverClearanceInfo",
  label: "SERVER CLEARANCE",
  group: "operations",
  block: { code: "SERVER CLEARANCE", label: "서버가 CLEARANCE를 세션에 직접 보냄", windowLabel: "서버 CLEARANCE(SUPERVISOR 전용)", words: "server clearance 서버 CLEARANCE TOWER INFO GO AROUND FIX LAND RESEND RELAY 세션 소켓 socket 오작동 misfire 잘못 보냄 두 번 넘김 handback server-clearance.json serverClearanceInfo serverClearanceGoAround serverClearanceFix serverClearanceLand serverClearanceResend serverClearanceRelay", searchOrder: 109 },
  values: ["off", "on"],
  default: "on",
  risky: ["on"], // 서버가 TOWER 없이 AIRCRAFT 세션에 쓴다. 기본 on이라 ⚠로 보이고, 껐다 다시 켤 때 확인한다
  error: "off 또는 on",
  warn: {
    off: "off: TOWER가 오늘처럼 landingQueue[].info(action send)를 보고 INFO를 보낸다.",
    on: "⚠ 기본: APPROACH INFO(막힘 알림)와 AUTOLAND가 넘긴 PR의 INFO: 브리핑 landingQueue[].info.text를 그대로. 서버가 TOWER의 `atcctl issue`와 같은 기록(clearances.jsonl)으로 적고, 같은 검사를 거쳐 받는 AIRCRAFT의 background 세션 소켓에 쓴다(보낸 이 ATC, 답은 글의 끝줄대로 TOWER 이름으로). TOWER 브리핑에는 서버 몫으로 표시돼 TOWER는 보내지 않는다. 데스크톱·터미널 세션, 서버 job이 멈춘 때, 두 번 닿지 않은 것은 TOWER가 보낸다. 쓴 글이 받는 세션에 보이지 않으면 서버 CLEARANCE를 멈추고 TOWER에게 넘기고 30분 뒤 하나로 다시 시험한다. 운영 서버(7700)만 세션에 쓴다.",
  },
  row: () => ({ label: "SERVER CLEARANCE INFO", env: "server-clearance.info", note: "server-clearance.json · 이 화면에서만 바꾼다 — TOWER는 못 바꿈 · 수는 FLIGHT RECORDER server-clearance" }),
  data: () => serverClearanceData(), // 블록의 수(여섯 종류 모두)는 이 스위치가 싣는다
  order: 76.1,
  applyOrder: 147.1,
  read: () => loadServerClearanceSwitch().info,
  save: (v: "on" | "off") => saveServerClearanceSwitch("info", v),
  record: (v: "on" | "off") => `serverClearance.info=${v}`,
});

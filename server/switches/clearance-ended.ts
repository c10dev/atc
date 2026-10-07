import { endedData, loadEndedSwitch, saveEndedSwitch } from "../clearance-ended-run.ts";
import { ENDED_SWITCHES, type EndedSwitch } from "../clearance-ended.ts";
import { defineSwitch } from "../switch-def.ts";

// 받는 세션이 끝난 CLEARANCE(ATC-567): clearance-ended.json의 스위치(기본 on). 켜면 FLIGHT가 없는 열린 CLEARANCE의 받는 세션이 끝난 지 2시간이 지나면
// 서버가 undeliverable("addressee ended")로 닫는다. 끄면 지금처럼 overdue로 남는다. SUPERVISOR만(이 화면 Origin), atcctl 명령은 없다
export default defineSwitch({
  key: "clearanceEnded",
  label: "CLEARANCE ENDED",
  group: "operations",
  block: { code: "CLEARANCE ENDED", label: "받는 세션이 끝난 CLEARANCE 닫기", windowLabel: "받는 세션이 끝난 CLEARANCE 닫기(SUPERVISOR 전용)", words: "clearance ended addressee ended 받는 세션 끝남 dead undeliverable overdue RESEND 닫기 clearanceEnded", searchOrder: 105 },
  values: ENDED_SWITCHES,
  default: "on",
  risky: [], // 기록에 닫는 줄만 덧붙인다. 어느 세션에도 보내지 않는다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: 받는 세션이 끝난 CLEARANCE도 답을 기다리며 overdue로 남고 TOWER가 RESEND·\"답 없음\" 보고를 한다(지금과 같다).",
    on: "기본: FLIGHT가 없는 열린 CLEARANCE의 받는 세션이 끝난 지(FLEET와 같은 살아 있음, job gone 포함) 2시간이 지나면 서버가 undeliverable(사유 \"addressee ended\")로 닫는다. RESEND 고리는 함께 닫는다. FLIGHT가 있는 것은 CLEARANCE MOOT 규칙대로다. 닫은 뒤 답이 오거나 그 세션이 24시간 안에 돌아오면 MISFIRE로 센다.",
  },
  row: () => ({ label: "CLEARANCE ENDED", env: "clearanceEnded", note: "clearance-ended.json · 받는 세션이 끝난 CLEARANCE를 닫음(FLIGHT 없는 것만) · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈" }),
  // 최근 7일 닫은 수와 MISFIRE(설정 창의 CLEARANCE ENDED 블록이 그린다)
  data: () => endedData(),
  order: 73,
  applyOrder: 58,
  read: () => loadEndedSwitch(),
  save: (v: EndedSwitch) => saveEndedSwitch(v),
  record: (v: EndedSwitch) => `clearanceEnded=${v}`,
});

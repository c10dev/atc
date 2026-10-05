import { MOOT_SWITCHES, type MootSwitch } from "../clearance-moot.ts";
import { loadMootSwitch, saveMootSwitch } from "../clearance-moot-run.ts";
import { defineSwitch } from "../switch-def.ts";

// 이유를 잃은 CLEARANCE(ATC-515): clearance-moot.json의 스위치(기본 on). 끄면 브리핑이 아무것도 올리지 않고 TOWER는 이 길로 취소하지 않는다.
// 서버는 고르기만 하고 취소는 TOWER가 `atcctl cancel`로 한다. SUPERVISOR만(이 화면 Origin), atcctl 명령은 없다
export default defineSwitch({
  key: "clearanceMoot",
  label: "CLEARANCE MOOT",
  group: "operations",
  block: { code: "CLEARANCE MOOT", label: "이유를 잃은 CLEARANCE 정리", windowLabel: "이유를 잃은 CLEARANCE 정리(SUPERVISOR 전용)", words: "clearance moot 이유 잃은 취소 cancel 머지된 PR 브리핑 clearanceMoot", searchOrder: 105 },
  values: MOOT_SWITCHES,
  default: "on",
  risky: [], // 고르기만 한다. 취소는 TOWER의 기존 명령이고 어느 세션에도 새로 보내지 않는다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: 브리핑이 이유를 잃은 CLEARANCE를 올리지 않고 TOWER는 이 길로 취소하지 않는다(지금과 같다). 답이 없는 CLEARANCE는 기존 규칙(NO READBACK)대로 간다.",
    on: "기본: READBACK을 기다리는 CLEARANCE의 FLIGHT에 PR이 있고 모두 머지됐거나 닫혔으면 브리핑에 올리고 TOWER가 취소한다. 같은 FLIGHT에 24시간 안에 새 CLEARANCE가 나가거나 PR이 다시 열리면 MISFIRE로 센다.",
  },
  row: () => ({ label: "CLEARANCE MOOT", env: "clearanceMoot", note: "clearance-moot.json · 이유를 잃은 CLEARANCE를 브리핑에 올림(TOWER가 취소) · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈" }),
  order: 73,
  applyOrder: 58,
  read: () => loadMootSwitch(),
  save: (v: MootSwitch) => saveMootSwitch(v),
  record: (v: MootSwitch) => `clearanceMoot=${v}`,
});

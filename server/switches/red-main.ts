import { loadRedMainSwitch, readRedMainLines, saveRedMainSwitch } from "../red-main-run.ts";
import { RED_MAIN_SWITCHES, type RedMainSwitch, redMainCounterOf } from "../red-main.ts";
import { defineSwitch } from "../switch-def.ts";

// RED MAIN(ATC-536): red-main.json의 스위치(기본 on). 끄면 QUEUE 줄이 나오지 않고 올라간 줄도 내려간다. 읽기만 하는 줄이다: 되돌리지도 머지하지도 보내지도 않는다. SUPERVISOR만(이 화면 Origin), atcctl 명령은 없다(K3)
export default defineSwitch({
  key: "redMain",
  label: "RED MAIN",
  group: "landing",
  block: { code: "RED MAIN", label: "빨간 main이 사람의 머지로 HOLD되면 QUEUE 한 줄", windowLabel: "빨간 main HOLD 알림 줄(SUPERVISOR 전용)", words: "red main 빨간 main hold auto-revert 사람의 머지 막힌 PR checks-failed queue needs you redMain", searchOrder: 36 },
  values: RED_MAIN_SWITCHES,
  default: "on",
  risky: [], // 읽기만 한다. 되돌리거나 머지하거나 어느 세션에도 보내지 않는다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: AUTO-REVERT가 사람의 머지라서 HOLD한 채 main이 빨개도 QUEUE에 줄을 내지 않는다(올라간 줄은 내려간다).",
    on: "기본: HOLD한 head의 main이 아직 빨가면 NEEDS YOU 한 줄이 깨진 체크·head·사람의 PR·같은 체크로 막힌 PR을 이름 붙인다. main이 초록이 되거나 새 head가 오면 스스로 닫힌다. 올린 수와 스스로 닫힌 수는 이 블록에 센다.",
  },
  row: () => ({ label: "RED MAIN", env: "redMain", note: "red-main.json · 빨간 main HOLD 줄의 스위치 · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈" }),
  // 최근 7일에 올린 줄 수와 스스로 닫힌 수(설정 창의 RED MAIN 블록이 그린다)
  data: () => redMainCounterOf(readRedMainLines(), Date.now(), 7),
  order: 36,
  applyOrder: 86,
  read: () => loadRedMainSwitch(),
  save: (v: RedMainSwitch) => saveRedMainSwitch(v),
  record: (v: RedMainSwitch) => `redMain=${v}`,
});

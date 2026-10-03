import { STOP_CHECK_SWITCHES, type StopCheckSwitch } from "../control-stop-check.ts";
import { loadStopCheckSwitch, saveStopCheckSwitch, stopCheckData } from "../control-stop-check-run.ts";
import { defineSwitch } from "../switch-def.ts";

// CONTROL STOP CHECK(ATC-521, docs/control-recycle.md): control-stop-check.json의 스위치(기본 on). 켜면 관제 세션 STOP(CONTROL STOP·RECYCLE·APPLY NOW)은 job의 state.json이 한도 안에 stopped가 될 때만 ok로 기록되고,
// 같은 관제 이름의 살아 있는 job이 둘 이상이면 WARNING이 뜬다. 끄면 옛 판정(`claude stop` 종료 코드)과 경고 없음. SUPERVISOR만(이 화면 Origin), atcctl 명령은 없다.
// 이 선언이 server/switches/에 있어 deploy/landing-tier.mjs가 `user` 등급으로 본다(스위치는 SUPERVISOR 판단이라 맞다)
export default defineSwitch({
  key: "controlStopCheck",
  label: "CONTROL STOP CHECK",
  group: "operations",
  block: { code: "CONTROL STOP CHECK", label: "관제 세션 STOP 확인·중복 경고", windowLabel: "관제 세션 STOP 확인과 같은 이름 job 중복 경고(SUPERVISOR 전용)", words: "control stop check 관제 세션 멈춤 확인 state.json stopped 중복 job 경고 controlStopCheck", searchOrder: 102 },
  values: STOP_CHECK_SWITCHES,
  default: "on",
  risky: [], // 읽기와 알림뿐이라 올려도 atc가 밖으로 쓰는 것이 없다. 켜면 막힐 수 있는 것은 RECYCLE의 새 LAUNCH(옛 세션이 안 멈췄을 때)뿐이다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: `claude stop` 종료 코드 0만으로 STOP을 ok로 기록한다(옛 판정). job이 안 멈췄어도 모르고, 같은 이름의 job이 둘 떠도 경고가 없다.",
    on: "기본: STOP은 그 job의 state.json이 20초 안에 stopped가 될 때만 ok다. 아니면 ok:false와 사유를 기록하고 WARNING을 올리며, RECYCLE은 새 세션을 띄우지 않는다. 같은 관제 이름의 살아 있는 job(stopped 아님, 60분 안 활동)이 둘 이상이면 WARNING. 틀린 판정은 오탐으로 센다.",
  },
  row: () => ({ label: "CONTROL STOP CHECK", env: "controlStopCheck", note: "control-stop-check.json · 관제 세션 STOP이 state.json stopped로 확인될 때만 ok · 같은 이름 job 중복 경고 · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈" }),
  data: () => stopCheckData(),
  order: 72,
  applyOrder: 57,
  read: () => loadStopCheckSwitch(),
  save: (v: StopCheckSwitch) => saveStopCheckSwitch(v),
  record: (v: StopCheckSwitch) => `controlStopCheck=${v}`,
});

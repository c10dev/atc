import { LAG_SWITCHES, type LagSwitch } from "../event-loop-lag.ts";
import { loadLagSwitch, saveLagSwitch } from "../event-loop-lag-run.ts";
import { defineSwitch } from "../switch-def.ts";

// EVENT LOOP LAG(ATC-538, docs/job-timing.md): event-loop-lag.json의 스위치(기본 on). 끄면 느림 알림이 나오지 않고 올라간 알림도 내려간다(JOB TIMING의 기록은 그대로). 읽기만 하는 판정이라 어느 화면의 신선도도 바뀌지 않는다. SUPERVISOR만(이 화면 Origin), atcctl 명령은 없다(K3)
export default defineSwitch({
  key: "eventLoopLag",
  label: "EVENT LOOP LAG",
  group: "operations",
  block: { code: "EVENT LOOP LAG", label: "서버 느림 알림(이벤트 루프 지연)", windowLabel: "서버 느림 알림(이벤트 루프 지연, SUPERVISOR 전용)", words: "event loop lag 이벤트 루프 지연 서버 느림 p99 job timing misfire eventLoopLag", searchOrder: 104 },
  values: LAG_SWITCHES,
  default: "on",
  risky: [], // 읽기만 한다. 어느 세션에도 보내지 않는다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: 이벤트 루프 지연이 느려도 알림을 내지 않는다(올라간 알림은 내려간다). JOB TIMING의 p99·max 기록은 그대로 남는다.",
    on: "기본: 지연 p99가 기준(기본 250ms)을 넘는 5분 구간이 연달아 3개(설정)이면 CAUTION 하나, 기준 밑인 구간이 오면 내려간다. 올라간 지 10분 안에 내려간 알림은 MISFIRE로 센다(METRICS).",
  },
  row: () => ({ label: "EVENT LOOP LAG", env: "eventLoopLag", note: "event-loop-lag.json · 서버 느림 알림의 스위치 · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈" }),
  order: 74,
  applyOrder: 59,
  read: () => loadLagSwitch(),
  save: (v: LagSwitch) => saveLagSwitch(v),
  record: (v: LagSwitch) => `eventLoopLag=${v}`,
});

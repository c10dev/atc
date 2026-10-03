import { JOB_TIMING_SWITCHES, type JobTimingSwitch } from "../job-timing.ts";
import { loadJobTimingSwitch, saveJobTimingSwitch } from "../job-timing-run.ts";
import { defineSwitch } from "../switch-def.ts";

// JOB TIMING(ATC-525, docs/job-timing.md): job-timing.json의 스위치(기본 on). 끄면 서버가 일마다 시간을 재지도 적지도 않는다. 읽기만 하는 측정이라 어느 화면의 신선도도 바뀌지 않는다. SUPERVISOR만(이 화면 Origin), atcctl 명령은 없다(K3)
export default defineSwitch({
  key: "jobTiming",
  label: "JOB TIMING",
  group: "operations",
  block: { code: "JOB TIMING", label: "서버 일별 시간 측정", windowLabel: "서버 일별 시간 측정(SUPERVISOR 전용)", words: "job timing 잡 시간 측정 cpu 서버 부하 steady jobTiming", searchOrder: 103 },
  values: JOB_TIMING_SWITCHES,
  default: "on",
  risky: [], // 시간만 잰다. 서버의 어떤 동작도 바꾸지 않는다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: 일마다의 시간 측정과 job-timing/ 기록이 멈춘다(지금까지의 기록은 남는다).",
    on: "기본: 일마다 실행 수·동기 시간·최대 시간을 5분 구간으로 job-timing/ 에 적는다(추가만, 14일 보관). 구간마다 한 줄이고 서버 동작은 바뀌지 않는다.",
  },
  row: () => ({ label: "JOB TIMING", env: "jobTiming", note: "job-timing.json · 일마다의 실행 수·시간 측정과 job-timing/ 기록 · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈" }),
  order: 73,
  applyOrder: 58,
  read: () => loadJobTimingSwitch(),
  save: (v: JobTimingSwitch) => saveJobTimingSwitch(v),
  record: (v: JobTimingSwitch) => `jobTiming=${v}`,
});

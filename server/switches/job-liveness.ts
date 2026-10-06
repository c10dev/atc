import { LIVENESS_SWITCHES, type LivenessSwitch } from "../job-liveness.ts";
import { loadLivenessSwitch } from "../job-liveness-io.ts";
import { livenessData, saveLivenessSwitch } from "../job-liveness-run.ts";
import { defineSwitch } from "../switch-def.ts";

// JOB LIVENESS(ATC-534, docs/fleet.md "as built (ATC-534)"): job-liveness.json의 스위치(기본 on). 켜면 백그라운드 세션은 세션 파일의 pid만이 아니라 daemon roster나 확인된 pid에 그 job의 프로세스가 있어야 살아 있다.
// 없으면 absent(`job gone`)라 승인된 카드가 ATC-388 길(다시 LAUNCH 또는 다른 AIRCRAFT)로 간다. 끄면 지금 규칙(세션 파일의 pid)이다. SUPERVISOR만(이 화면 Origin), atcctl 명령은 없다.
// 이 선언이 server/switches/에 있어 deploy/landing-tier.mjs가 `user` 등급으로 본다(스위치는 SUPERVISOR 판단이라 맞다)
export default defineSwitch({
  key: "jobLiveness",
  label: "JOB LIVENESS",
  group: "operations",
  block: { code: "JOB LIVENESS", label: "백그라운드 job 프로세스 확인", windowLabel: "백그라운드 job 프로세스 확인(SUPERVISOR 전용)", words: "job liveness 백그라운드 job 프로세스 사라짐 job gone absent roster pid init 죽음 approved 카드 jobLiveness", searchOrder: 103 },
  values: LIVENESS_SWITCHES,
  default: "on",
  risky: [], // 기본이 on이다. 켜면 승인된 카드를 서버가 다시 LAUNCH하거나 닫지만(ATC-388) 그 길은 이미 SUPERVISOR의 승인과 같은 상한 안에서만 돈다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: 세션 파일의 pid가 살아 있으면 job의 프로세스가 없어도 idle로 본다(지금 규칙). 사라진 job의 승인된 카드는 보낼 곳 없이 기다린다.",
    on: "기본: 백그라운드 세션은 daemon roster나 확인된 pid에 그 job의 프로세스가 있을 때만 산다. 없으면 absent(`job gone`)라 승인된 ASSIGN 카드는 approvedWaitMin 안에 다시 LAUNCH되거나 닫혀 다른 AIRCRAFT로 간다. init에서 연달아 죽은 AIRCRAFT는 서버가 또 띄우지 않는다.",
  },
  row: () => ({ label: "JOB LIVENESS", env: "jobLiveness", note: "job-liveness.json · 백그라운드 job의 프로세스 증거 · 없으면 absent · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈" }),
  data: () => livenessData(),
  order: 73,
  applyOrder: 58,
  read: () => loadLivenessSwitch(),
  save: (v: LivenessSwitch) => saveLivenessSwitch(v),
  record: (v: LivenessSwitch) => `jobLiveness=${v}`,
});

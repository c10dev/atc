import { loadReadbackHashSwitch, readbackHashData, saveReadbackHashSwitch } from "../input-binding-run.ts";
import { READBACK_HASH_SWITCHES, type ReadbackHashSwitch } from "../input-binding.ts";
import { defineSwitch } from "../switch-def.ts";

// FLIGHT PLAN READBACK의 work-order 해시 확인(ATC-555): readback-hash.json의 스위치(기본 on). 끄면 해시 없는 READBACK도 받는다.
// 해시는 꺼도 FLIGHT PLAN에 적히고 기록 줄에도 남는다(거절만 멈춘다). SUPERVISOR만(이 화면 Origin), atcctl 명령은 없다
export default defineSwitch({
  key: "readbackHash",
  label: "READBACK HASH",
  group: "operations",
  block: { code: "READBACK HASH", label: "FLIGHT PLAN READBACK의 work-order 해시 확인", windowLabel: "READBACK의 work-order 해시 확인(SUPERVISOR 전용)", words: "readback hash 해시 work order 작업 지시서 FLIGHT PLAN 인용 quote @sha 바뀐 지시서 tamper 거절 refused input binding WO-23 readbackHash", searchOrder: 107 },
  values: READBACK_HASH_SWITCHES,
  default: "on",
  risky: [], // 거절만 한다. 어느 세션에도 새로 보내지 않는다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: FLIGHT PLAN의 work-order 해시(@xxxxxx)를 인용하지 않았거나 틀린 READBACK도 지금처럼 받는다. 해시는 FLIGHT PLAN과 기록에 그대로 남는다.",
    on: "기본: 해시가 있는 FLIGHT PLAN에 온 READBACK이 그 해시를 인용하지 않거나 틀리면 409로 거절하고 정확한 답 한 줄(READBACK D-xxxx @xxxxxx)을 알린다. 해시 전의 옛 FLIGHT PLAN은 전처럼 받는다. 거절한 수는 이 블록에 주 단위로 센다.",
  },
  row: () => ({ label: "READBACK HASH", env: "readbackHash", note: "readback-hash.json · 해시 없는 READBACK 거절 · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈" }),
  // 최근 7일에 거절한 READBACK의 수(설정 창의 READBACK HASH 블록이 그린다)
  data: () => readbackHashData(),
  order: 74,
  applyOrder: 59,
  read: () => loadReadbackHashSwitch(),
  save: (v: ReadbackHashSwitch) => saveReadbackHashSwitch(v),
  record: (v: ReadbackHashSwitch) => `readbackHash=${v}`,
});

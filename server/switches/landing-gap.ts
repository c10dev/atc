import { GAP_SWITCHES, type GapSwitch } from "../landing-gap.ts";
import { loadGapSwitch, saveGapSwitch } from "../landing-gap-run.ts";
import { defineSwitch } from "../switch-def.ts";

// 착륙 간격 규칙(ATC-501, docs/home-flow.md 4.3): landing-gap.json의 스위치(기본 on). off는 HOME의 "착륙 없음 → 막힘" 규칙만 뺀다 — ground stop과 main CI 빨강은 그대로 막힘이다. SUPERVISOR만(이 화면 Origin), atcctl 명령은 없다(K3)
export default defineSwitch({
  key: "landingGap",
  label: "LANDING GAP",
  group: "operations",
  block: { code: "LANDING GAP", label: "착륙 없음 막힘 규칙(HOME)", windowLabel: "착륙 없음 막힘 규칙(HOME, SUPERVISOR 전용)", words: "landing gap 착륙 없음 막힘 p90 기준 landingGap", searchOrder: 101 },
  values: GAP_SWITCHES,
  default: "on",
  risky: [], // 읽기만 하는 판정이라 올려도 atc가 밖으로 쓰는 것이 없다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: HOME이 '착륙 없음'만으로는 막힘을 내지 않는다. ground stop과 main CI 빨강은 그대로 막힘이다.",
    on: "기본: AIRPORT마다 지난 7일 착륙 간격의 p90(바닥 30분, 간격이 8개 미만이면 규칙 없음)보다 오래 착륙이 없고 시스템이 움직여야 할 일이 있으면 막힘이다. 스스로 풀린 막힘은 MISFIRE로 센다(METRICS).",
  },
  row: () => ({ label: "LANDING GAP", env: "landingGap", note: "landing-gap.json · HOME '착륙 없음' 막힘 규칙의 스위치 · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈" }),
  order: 71,
  applyOrder: 56,
  read: () => loadGapSwitch(),
  save: (v: GapSwitch) => saveGapSwitch(v),
  record: (v: GapSwitch) => `landingGap=${v}`,
});

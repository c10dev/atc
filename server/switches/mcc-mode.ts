import { loadMcc, MCC_MODES, type MccMode } from "../mcc.ts";
import { setMccMode } from "../mcc-run.ts";
import { defineSwitch } from "../switch-def.ts";

// MCC(docs/mcc.md): mcc.json의 스위치. SUPERVISOR만: MCC 세션은 못 바꾼다. findings 댓글은 모든 모드에서 남긴다
export default defineSwitch({
  key: "mccMode",
  label: "MCC",
  group: "landing",
  block: { code: "MCC", label: "atc 착륙·RETURN TO SERVICE", windowLabel: "atc 착륙·RETURN TO SERVICE(SUPERVISOR 전용)", words: "shadow land rts land+rts rollback 배포 shadow gate mcc.mode", searchOrder: 20 },
  values: MCC_MODES,
  default: "shadow",
  risky: ["land", "land+rts", "rts"], // rts도 ⚠: 사용자가 머지한 main을 서버가 스스로 배포한다
  error: "shadow, land, land+rts, rts 중 하나",
  warn: {
    shadow: "기본: MCC는 INSPECTION하고 착륙·RTS는 would로만 남긴다. 머지·배포는 사용자.",
    land: "⚠ auto·flagged 등급 PR을 CI·INSPECTION pass·정확한 head로 atc가 머지. user 등급과 ESCALATE는 사용자. 배포는 사람.",
    "land+rts": "⚠ land에 더해 머지된 main을 atc-rts 유닛으로 7700에 RETURN TO SERVICE(상태 확인 실패면 ROLLBACK 후 멈춤). 시작은 서버가 스스로 한다.",
    rts: "⚠ MCC는 착륙하지 않는다(would-land만): 사용자가 손으로 머지한 main을 서버가 atc-rts 유닛으로 7700에 스스로 RETURN TO SERVICE(CI 통과, 5분 간격, 상태 확인 실패면 ROLLBACK 후 멈춤). package·유닛 파일 변경은 사람이 배포.",
  },
  row: () => ({
    label: "MCC",
    env: "mcc.mode",
    note: `mcc.json · 맡은 AIRPORT ${loadMcc().airport} · 이 화면에서만 바꾼다 — MCC 세션은 못 바꿈. ROLLBACK 뒤 멈춘 RTS는 모드를 다시 고르면 풀린다`,
  }),
  order: 30,
  lineOrder: 20,
  applyOrder: 110,
  read: () => loadMcc().mode,
  save: (v: MccMode) => setMccMode(v),
  record: (v: MccMode) => `mcc.mode=${v}`,
});

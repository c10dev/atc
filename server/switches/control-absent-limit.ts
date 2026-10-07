import { ABSENT_LIMITS, type AbsentLimit } from "../control-absent.ts";
import { loadAbsentSettings, saveAbsentSetting } from "../control-absent-run.ts";
import { defineSwitch } from "../switch-def.ts";

// CONTROL ABSENT LIMIT(ATC-532): control-absent.json의 limitMin(분, 10~60, 기본 20). 관제 세션이 이만큼 없으면 다시 띄우거나 알린다. 서버가 (다시) 뜬 직후에는 첫 판단에서 2분만 기다린다. SUPERVISOR만(이 화면 Origin)
export default defineSwitch({
  key: "controlAbsentLimit",
  label: "CONTROL ABSENT LIMIT",
  group: "operations",
  block: { code: "CONTROL ABSENT", label: "없는 관제 세션 다시 띄우기·알림", words: "limit 한도 분 minutes controlAbsentLimit control-absent.json" },
  values: ABSENT_LIMITS,
  default: "20",
  risky: [],
  line: false,
  error: "10, 15, 20, 30, 45, 60 가운데 하나(분)",
  warn: Object.fromEntries(ABSENT_LIMITS.map((v) => [v, `${v === "20" ? "기본: " : ""}관제 세션이 ${v}분 넘게 없으면 다시 띄우거나 알린다. 서버가 (다시) 뜬 직후에 이미 없던 역할은 2분 뒤에 판단한다(재부팅 뒤 손으로 띄우지 않게).`])),
  row: () => ({ label: "CONTROL ABSENT LIMIT", env: "control-absent.limitMin", note: "control-absent.json · 분 · 서버가 뜬 직후는 2분" }),
  order: 72.4,
  applyOrder: 57.4,
  read: () => String(loadAbsentSettings().limitMin),
  save: (v: AbsentLimit) => saveAbsentSetting("limitMin", Number(v)),
  record: (v: AbsentLimit) => `controlAbsent.limitMin=${v}`,
});

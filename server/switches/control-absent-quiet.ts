import { ON_OFF, type OnOff } from "../control-absent.ts";
import { loadAbsentSettings, saveAbsentSetting } from "../control-absent-run.ts";
import { defineSwitch } from "../switch-def.ts";

// CONTROL ABSENT QUIET PASS(ATC-532): control-absent.json의 quietPass(기본 on, live first). 켜면 CONTROL ABSENT 알림 항목에 passQuiet가 붙어 브라우저가 조용한 시간에도 WARNING 소리를 낸다.
// ANNUNCIATOR는 조용한 시간에도 배너는 띄우고 소리만 끄는데, 이 칸을 따르는 것은 앱 쪽 변경이다(atc-app). SUPERVISOR만(이 화면 Origin)
export default defineSwitch({
  key: "controlAbsentQuietPass",
  label: "CONTROL ABSENT QUIET PASS",
  group: "operations",
  block: { code: "CONTROL ABSENT", label: "없는 관제 세션 다시 띄우기·알림", words: "quiet 조용한 시간 방해 금지 소리 passQuiet controlAbsentQuietPass" },
  values: ON_OFF,
  default: "on",
  risky: [],
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: CONTROL ABSENT 알림도 다른 알림처럼 조용한 시간에는 소리를 내지 않는다(배너·목록은 그대로).",
    on: "기본: CONTROL ABSENT 알림은 조용한 시간에도 WARNING 소리를 낸다(이 브라우저의 조용한 시간 설정을 지나간다). ANNUNCIATOR는 조용한 시간에도 배너를 띄우고, 소리는 앱이 passQuiet를 읽을 때부터 난다.",
  },
  row: () => ({ label: "CONTROL ABSENT QUIET PASS", env: "control-absent.quietPass", note: "control-absent.json · 알림 항목의 passQuiet · 이 화면에서만 바꾼다" }),
  order: 72.3,
  applyOrder: 57.3,
  read: () => loadAbsentSettings().quietPass,
  save: (v: OnOff) => saveAbsentSetting("quietPass", v),
  record: (v: OnOff) => `controlAbsent.quietPass=${v}`,
});

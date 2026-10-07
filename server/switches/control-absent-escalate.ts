import { ON_OFF, type OnOff } from "../control-absent.ts";
import { loadAbsentSettings, saveAbsentSetting } from "../control-absent-run.ts";
import { defineSwitch } from "../switch-def.ts";

// CONTROL ABSENT ESCALATE(ATC-532): control-absent.json의 escalate(기본 on). 켜면 한도가 지났는데 atc가 다시 띄우지 않았거나 못 띄운 관제 세션마다 WARNING(control|absent|<세션>|<n>)을 올리고
// 30분마다 새 key로 다시 올린다(브라우저·ANNUNCIATOR는 새 key에 알린다). 세션이 다시 보이거나 SUPERVISOR가 확인하면 그친다. SUPERVISOR만(이 화면 Origin)
export default defineSwitch({
  key: "controlAbsentEscalate",
  label: "CONTROL ABSENT ESCALATE",
  group: "operations",
  block: { code: "CONTROL ABSENT", label: "없는 관제 세션 다시 띄우기·알림", words: "escalate 알림 warning annunciator 되풀이 ack 확인 오탐 controlAbsentEscalate" },
  values: ON_OFF,
  default: "on",
  risky: [], // 알림뿐이라 atc가 밖으로 쓰는 것이 없다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: 다시 띄우지 못한 관제 세션에 따로 알리지 않는다. 목록의 `관제 세션 … 없음`(control|down)만 남는다(지금까지와 같다).",
    on: "기본: 한도가 지났는데 다시 띄우지 않았거나 못 띄운 관제 세션마다 WARNING을 올린다. 글에 세션, 없던 분, 마지막 job, 다시 띄우지 않은 이유가 든다. 30분마다 새 알림으로 다시 올리고, 세션이 다시 보이거나 SUPERVISOR가 아래에서 확인하면 그친다.",
  },
  row: () => ({ label: "CONTROL ABSENT ESCALATE", env: "control-absent.escalate", note: "control-absent.json · 화면이 없어도 ANNUNCIATOR에 닿는 WARNING · 30분마다 되풀이 · 이 화면에서만 바꾼다" }),
  order: 72.2,
  applyOrder: 57.2,
  read: () => loadAbsentSettings().escalate,
  save: (v: OnOff) => saveAbsentSetting("escalate", v),
  record: (v: OnOff) => `controlAbsent.escalate=${v}`,
});

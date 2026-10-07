import { DAILY_MODES, type DailyMode } from "../control-wake.ts";
import { loadWakeDaily, saveWakeDaily } from "../control-wake-switch.ts";
import { defineSwitch } from "../switch-def.ts";

// CONTROL WAKE DAILY(ATC-557 d): control-wake.json의 daily(기본 on). on이면 깨움 모드인 TOWER·OCC·MCC·REVIEW에 하루 한 번 정한 UTC 시각
// (01:00Z·01:15Z·01:30Z·01:45Z) 지난 24시간을 돌아보는 점검 턴 하나를 보낸다. /loop인 역할은 받지 않는다. off면 점검 턴이 없다. SUPERVISOR만(이 화면 Origin), atcctl 명령 없음
export default defineSwitch({
  key: "controlWakeDaily",
  label: "CONTROL WAKE DAILY",
  group: "operations",
  block: { code: "CONTROL WAKE", label: "관제 세션을 /loop 대신 일이 생길 때 깨움", windowLabel: "관제 세션 깨움(SUPERVISOR 전용)", words: "", searchOrder: 81 },
  values: DAILY_MODES,
  default: "on",
  risky: [],
  error: "on 또는 off",
  warn: {
    off: "off: 하루 한 번 점검 턴이 없다. 깨움 모드인 관제 세션은 판단할 일이 생길 때만 깬다.",
    on: "기본: 깨움 모드인 관제 세션마다 하루 한 번(TOWER 01:00Z · OCC 01:15Z · MCC 01:30Z · REVIEW 01:45Z) 지난 24시간의 깨움과 LOG를 돌아보고 매뉴얼대로 적는 턴 하나를 보낸다. 시각을 놓치면(서버 꺼짐) 그날 안에 한 번. /loop인 역할은 받지 않는다.",
  },
  row: () => ({ label: "CONTROL WAKE DAILY", env: "control-wake.daily", note: "control-wake.json · 하루 한 번 점검 턴 · 이 화면에서만 바꾼다 · 수는 FLIGHT RECORDER control-wake(daily)" }),
  order: 77.4,
  applyOrder: 146,
  read: () => loadWakeDaily(),
  save: (v: DailyMode) => saveWakeDaily(v),
  record: (v: DailyMode) => `controlWake.daily=${v}`,
});

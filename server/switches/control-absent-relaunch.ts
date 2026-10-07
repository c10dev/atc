import { ON_OFF, type OnOff } from "../control-absent.ts";
import { absentData, loadAbsentSettings, saveAbsentSetting } from "../control-absent-run.ts";
import { defineSwitch } from "../switch-def.ts";

// CONTROL ABSENT RELAUNCH(ATC-532, docs/control-recycle.md "As built: CONTROL ABSENT"): control-absent.json의 relaunch(기본 on). 켜면 관제 세션(TOWER·OCC·MCC·REVIEW)이 한도보다 오래 없고
// 이전 job이 사라졌다는 증거(재부팅·state.json stopped/failed·믿을 수 있는 roster에 worker 없음, 관제 폴더에 프로세스 없음)가 있을 때 atc가 FLEET LAUNCH와 같은 launchControl로 다시 띄운다(운영 서버만).
// OCC는 control-recycle.json auto.OCC가 false인 동안 띄우지 않는다. SUPERVISOR만(이 화면 Origin), atcctl 명령은 없다. 이 선언이 server/switches/에 있어 deploy/landing-tier.mjs가 `user` 등급으로 본다
export default defineSwitch({
  key: "controlAbsentRelaunch",
  label: "CONTROL ABSENT RELAUNCH",
  group: "operations",
  block: { code: "CONTROL ABSENT", label: "없는 관제 세션 다시 띄우기·알림", windowLabel: "없는 관제 세션 다시 띄우기와 알림(SUPERVISOR 전용)", words: "control absent 관제 세션 없음 다시 띄움 relaunch 재부팅 reboot job gone 증거 controlAbsentRelaunch", searchOrder: 102.5 },
  values: ON_OFF,
  default: "on",
  risky: ["on"], // 서버가 관제 세션을 스스로 띄운다(SUPERVISOR 없이). 기본 on이라 ⚠로 보이고, 껐다 다시 켤 때 확인한다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: 관제 세션이 없어도 atc는 다시 띄우지 않는다. 알림 스위치가 켜져 있으면 한도가 지난 뒤 WARNING만 올린다.",
    on: "⚠ 기본: 관제 세션이 한도(서버가 뜬 직후는 2분)보다 오래 없고 이전 job이 사라졌다는 증거가 있으면 atc가 FLEET LAUNCH와 같은 길로 한 번 다시 띄운다(운영 서버만, 역할마다 한 시간에 한 번). SUPERVISOR가 STOP한 세션, auto가 false인 세션(OCC 기본), 살아 있는 줄이 있는 세션은 띄우지 않는다.",
  },
  row: () => ({ label: "CONTROL ABSENT RELAUNCH", env: "control-absent.relaunch", note: "control-absent.json · 증거가 있을 때만 · launchControl의 거절(ACCOUNT 로그인·FUEL hold·폴더 trust)은 그대로 · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈" }),
  data: () => absentData(),
  order: 72.1,
  applyOrder: 57.1,
  read: () => loadAbsentSettings().relaunch,
  save: (v: OnOff) => saveAbsentSetting("relaunch", v),
  record: (v: OnOff) => `controlAbsent.relaunch=${v}`,
});

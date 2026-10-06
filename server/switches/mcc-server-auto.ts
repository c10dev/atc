import { loadMcc } from "../mcc.ts";
import { autoData, setServerAuto } from "../mcc-run.ts";
import { defineSwitch } from "../switch-def.ts";

// 서버 자동 착륙·RTS(ATC-556): mcc.json의 serverAuto(기본 on, 꺼지는 것은 정확히 "off"). 읽을 수 없는 mcc.json이면 off로 읽는다. 바꾸는 것은 SUPERVISOR만(이 화면 Origin, atcctl 명령 없음)
export default defineSwitch({
  key: "mccServerAuto",
  label: "MCC SERVER AUTO",
  group: "landing",
  block: { code: "MCC", label: "atc 착륙·RETURN TO SERVICE", windowLabel: "atc 착륙·RETURN TO SERVICE(SUPERVISOR 전용)", words: "server auto 서버 자동 착륙 land rts mcc.serverAuto 오작동 misfire", searchOrder: 20 },
  values: ["off", "on"],
  default: "on",
  risky: ["on"], // 서버가 사람 없이 머지한다(auto 등급만). 기본 on이라 ⚠로 보이고, 껐다 다시 켤 때 확인한다
  error: "off 또는 on",
  warn: {
    off: "off: 서버는 아무것도 착륙시키지 않는다. MCC 세션이 `mcc land`·`mcc rts`로 다시 한다(모드 shadow는 would만).",
    on: "⚠ 기본: MCC INSPECTION pass가 있는 auto 등급 PR을 CI·정확한 head 등 착륙 조건(L2–L8)이 맞으면 서버가 스스로 머지한다(모드가 shadow여도). flagged·user 등급과 ESCALATE·HOLD·GROUND STOP은 그대로 사람이다. 서버가 착륙시킨 PR만 쌓인 main은 서버가 스스로 RETURN TO SERVICE한다. 모드 rts에서는 착륙하지 않는다.",
  },
  row: () => ({ label: "MCC SERVER AUTO", env: "mcc.serverAuto", note: "mcc.json · 이 화면에서만 바꾼다 — MCC 세션은 못 바꿈 · 오작동은 착륙 뒤 다시 읽었을 때 막았을 조건이 있던 서버 착륙의 수(FLIGHT RECORDER mcc-auto)" }),
  data: () => autoData(),
  order: 31,
  lineOrder: 21,
  applyOrder: 111,
  read: () => loadMcc().serverAuto,
  save: (v: "on" | "off") => setServerAuto(v),
  record: (v: "on" | "off") => `mcc.serverAuto=${v}`,
});

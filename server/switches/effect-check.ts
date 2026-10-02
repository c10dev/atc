import { AUTO_SWITCHES, type AutoSwitch } from "../autonomy-auto.ts";
import { loadEffectSwitch, saveEffectSwitch } from "../effect-check-run.ts";
import { defineSwitch } from "../switch-def.ts";

// EFFECT CHECK(ATC-402): effect-check.json의 on(기본 on). 배포한 FLIGHT가 `## Measure`에 적은 것을 바꿨는지 재고 평결을 남긴다(아무것도 바꾸지 않는다). 끄는 것은 SUPERVISOR만
export default defineSwitch({
  key: "effectCheck",
  label: "EFFECT CHECK",
  group: "operations",
  block: {
    code: "EFFECT CHECK",
    label: "배포 효과 확인(## Measure 평결)",
    windowLabel: "배포 효과 확인(SUPERVISOR 전용)",
    words: "effect check measure 평결 improved not improved worse too little data 효과 측정 effect-check.json 틀림 misfire",
    searchOrder: 55,
  },
  values: AUTO_SWITCHES,
  default: "on",
  risky: [], // 재기만 한다(아무것도 바꾸지 않는다): 켜도 꺼도 확인 창이 필요 없다(ATC-402)
  error: "off 또는 on",
  warn: {
    off: "off: 배포한 FLIGHT의 평결을 내지 않는다. 이미 낸 평결은 그대로 보인다.",
    on: "기본: 배포한 FLIGHT가 작업 지시서 `## Measure`에 적은 것(leak·misfire·알림·CLEARANCE 수)을 배포 앞뒤 같은 기간으로 견줘 improved·not improved·worse·too little data 하나를 남긴다. 재기만 하고 아무것도 바꾸지 않는다. not improved·worse는 HOME에 보이고 틀렸다고 표시할 수 있다(그 수가 오작동 카운터).",
  },
  row: () => ({ label: "평결", env: "effect-check.on", note: "effect-check.json · 평결은 effect-verdicts.jsonl에 추가만 한다 · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈" }),
  order: 19,
  lineOrder: 93,
  applyOrder: 65,
  read: () => loadEffectSwitch(),
  save: (v: AutoSwitch) => saveEffectSwitch(v),
});

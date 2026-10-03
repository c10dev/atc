import { loadReposition, setRepositionMode } from "../fleet-plan-run.ts";
import { REPOSITION_MODES, type RepositionMode } from "../reposition.ts";
import { defineSwitch } from "../switch-def.ts";

// FLEET PLAN REPOSITION(ATC-179, docs/fleet.md 8.6): fleet-plan.json. 기본 shadow. auto는 ⚠(하루 dailyMax 상한, flapping이면 approval로 돌아옴). SUPERVISOR만
export default defineSwitch({
  key: "fleetPlanReposition",
  label: "REPOSITION",
  group: "operations",
  block: { code: "REPOSITION", label: "소속 AIRPORT 옮기기", windowLabel: "쉬는 AIRCRAFT의 소속 AIRPORT 옮기기(SUPERVISOR 전용)", words: "base fleet plan approval auto fleet-plan.reposition", searchOrder: 70 },
  values: REPOSITION_MODES,
  default: "shadow",
  risky: ["auto"], // atc가 쉬는 AIRCRAFT의 base를 스스로 옮긴다(멈추고 다른 저장소에서 다시 띄움)
  error: "off, shadow, approval, auto 중 하나",
  warn: {
    off: "꺼짐: 쉬는 AIRCRAFT의 base를 옮기자는 제안을 내지 않는다.",
    shadow: "기본: 조건이 맞으면 \"옮겼을 것\"(would-reposition)을 FLIGHT RECORDER에만 남긴다. 아무것도 멈추거나 띄우지 않는다.",
    approval: "조건이 맞으면 FLEET PLAN에 REPOSITION 카드를 낸다. SUPERVISOR가 승인하면 그 AIRCRAFT를 멈추고 base를 바꿔 새 AIRPORT 저장소에서 다시 띄운다.",
    auto: "⚠ 카드를 승인 없이 atc가 스스로 실행한다(하루 상한, AIRCRAFT마다 minDwell, 옮길 때마다 알림). 같은 AIRCRAFT가 minDwell 안에 되돌아가려 하면 approval로 돌아온다.",
  },
  row: () => ({ label: "REPOSITION", env: "fleet-plan.reposition", note: `fleet-plan.json · 자동일 때 하루 ${loadReposition().dailyMax}건까지 · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈` }),
  order: 40,
  lineOrder: 70,
  applyOrder: 120,
  read: () => loadReposition().mode,
  save: (v: RepositionMode) => setRepositionMode(v),
});

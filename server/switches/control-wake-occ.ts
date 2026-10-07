import { WAKE_MODES, type WakeMode } from "../control-wake.ts";
import { loadWakeSwitch, saveWakeMode } from "../control-wake-switch.ts";
import { defineSwitch } from "../switch-def.ts";

// CONTROL WAKE OCC(ATC-557 a): control-wake.json의 roles.occ(기본 wake). wake면 OCC는 `/loop` 없이 쉬고, 서버가 판단할 일이 생길 때 글 하나로 깨운다.
// loop면 오늘과 같다(`/loop 10m /tick`). 바꾸면 서버가 안전한 순간에 그 세션을 한 번 다시 띄워 첫 프롬프트를 맞춘다. SUPERVISOR만(이 화면 Origin), atcctl 명령 없음
export default defineSwitch({
  key: "controlWakeOcc",
  label: "CONTROL WAKE OCC",
  group: "operations",
  block: { code: "CONTROL WAKE", label: "관제 세션을 /loop 대신 일이 생길 때 깨움", windowLabel: "관제 세션 깨움(SUPERVISOR 전용)", words: "control wake 깨움 event wake /loop loop tick 관제 TOWER OCC MCC WAKE RESULT 오작동 misfire 깨우지 못함 메뉴 할 일 없음 control-wake.json controlWakeTower controlWakeOcc controlWakeMcc", searchOrder: 81 },
  values: WAKE_MODES,
  default: "wake",
  risky: ["wake"], // 서버가 관제 세션에 직접 쓰고, 바꾸면 그 세션을 한 번 다시 띄운다. 기본 wake라 ⚠로 보이고, 껐다 다시 켤 때 확인한다
  error: "loop 또는 wake",
  warn: {
    loop: "loop: OCC는 오늘처럼 `/loop 10m /tick`로 돈다. 깨움 모드로 떠 있는 세션은 안전한 순간에 한 번 다시 띄워 /loop를 건다.",
    wake: "⚠ 기본: OCC는 /loop 없이 쉬고, 서버가 판단할 일(새 사건·두 번째 침묵·리뷰 지적·메뉴 밖 일)을 볼 때 세션 소켓에 글 하나로 깨운다(팀의 답은 전처럼 이름으로 온다). /loop로 떠 있는 세션은 안전한 순간에 한 번 다시 띄운다. 깨움이 죽으면(job·BREAKER) /loop가 남은 세션의 tick이 다시 일한다. 운영 서버(7700)만 세션에 쓴다.",
  },
  row: () => ({ label: "CONTROL WAKE OCC", env: "control-wake.occ", note: "control-wake.json · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈 · 수는 FLIGHT RECORDER control-wake" }),
  order: 77.1,
  applyOrder: 146,
  read: () => loadWakeSwitch().occ,
  save: (v: WakeMode) => saveWakeMode("occ", v),
  record: (v: WakeMode) => `controlWake.occ=${v}`,
});

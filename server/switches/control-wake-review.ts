import { WAKE_MODES, type WakeMode } from "../control-wake.ts";
import { loadWakeSwitch, saveWakeMode } from "../control-wake-switch.ts";
import { defineSwitch } from "../switch-def.ts";

// CONTROL WAKE REVIEW(ATC-557 d): control-wake.json의 roles.review(기본 wake). wake면 REVIEW는 `/loop` 없이 쉬고, 착륙 리뷰를 기다리는 PR head가 생기면
// 서버가 글 하나로 깨운다(깨움 하나에 2건까지). loop면 오늘과 같다(`/loop 10m /tick`). CROSSCHECK는 은퇴(ATC-371)라 스위치가 없다. SUPERVISOR만(이 화면 Origin), atcctl 명령 없음
export default defineSwitch({
  key: "controlWakeReview",
  label: "CONTROL WAKE REVIEW",
  group: "operations",
  block: { code: "CONTROL WAKE", label: "관제 세션을 /loop 대신 일이 생길 때 깨움", windowLabel: "관제 세션 깨움(SUPERVISOR 전용)", words: "", searchOrder: 81 },
  values: WAKE_MODES,
  default: "wake",
  risky: ["wake"], // 서버가 관제 세션에 직접 쓰고, 바꾸면 그 세션을 한 번 다시 띄운다. 기본 wake라 ⚠로 보이고, 껐다 다시 켤 때 확인한다
  error: "loop 또는 wake",
  warn: {
    loop: "loop: REVIEW는 오늘처럼 `/loop 10m /tick`로 돈다. 깨움 모드로 떠 있는 세션은 안전한 순간에 한 번 다시 띄워 /loop를 건다.",
    wake: "⚠ 기본: REVIEW는 /loop 없이 쉬고, 착륙 리뷰를 기다리는 PR head(landing queue의 pending)가 생기면 서버가 세션 소켓에 글 하나로 깨운다(깨움 하나에 2건까지, 나머지는 앞 깨움이 끝난 뒤). /loop로 떠 있는 세션은 안전한 순간에 한 번 다시 띄운다. 깨움이 죽으면(job·BREAKER) /loop가 남은 세션의 tick이 다시 일한다. 운영 서버(7700)만 세션에 쓴다.",
  },
  row: () => ({ label: "CONTROL WAKE REVIEW", env: "control-wake.review", note: "control-wake.json · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈 · CROSSCHECK는 은퇴라 없음" }),
  order: 77.3,
  applyOrder: 146,
  read: () => loadWakeSwitch().review,
  save: (v: WakeMode) => saveWakeMode("review", v),
  record: (v: WakeMode) => `controlWake.review=${v}`,
});

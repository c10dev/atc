import { loadDispatchConfig, saveContestGuard } from "../dispatch.ts";
import { record } from "../recorder.ts";
import { defineSwitch } from "../switch-def.ts";

// 경합 보호(ATC-547): dispatch.json contestGuard(기본 on). 자리 잡은 열린 ASSIGN 카드는 "더 나은 배정"에 밀려나지 않고, 밀려난 FLIGHT는 나이를 이어받으며,
// 24시간에 두 번 밀려난 FLIGHT는 다시 밀지 않는다. 밀어낸 기록과 날짜별 수(METRICS)가 남는다. 끄면 옛 동작.
// SUPERVISOR만(이 화면 Origin), atcctl 명령 없음
export default defineSwitch({
  key: "contestGuard",
  label: "CONTEST GUARD",
  group: "operations",
  block: { code: "CONTEST GUARD", label: "자리 잡은 DISPATCH 카드를 더 나은 배정이 밀어내지 않음", windowLabel: "DISPATCH 경합 보호(SUPERVISOR 전용)", words: "contest guard 경합 보호 더 나은 배정 밀어냄 displaced supersede settled settle 카드 나이 contestGuard", searchOrder: 103 },
  values: ["off", "on"],
  default: "on",
  risky: [], // 카드를 더 이어 두는 쪽이라 ⚠ 목록에 넣지 않는다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: 올라온 더 높은 점수의 카드가 자리 잡은 카드도 곧바로 대신한다(옛 동작). 점수가 낮은 FLIGHT가 자동 승인 직전에 계속 밀려날 수 있다.",
    on: "기본: 자동 운항에서 자리 잡은(settleMin 지남, 또는 다음 계획 주기 안에 지날) 열린 카드는 밀려나지 않고, 더 높은 점수의 FLIGHT는 다른 빈 AIRCRAFT로 간다. 밀려나야 하는 카드의 FLIGHT는 새 카드가 나이를 이어받고, 24시간에 두 번 밀려난 FLIGHT는 다시 밀지 않는다. 밀어낸 수와 MISFIRE는 METRICS와 GET /api/dispatch/misfire.",
  },
  row: () => ({ label: "CONTEST GUARD", env: "contestGuard", note: "dispatch.json · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈 · 밀어낸 수는 METRICS → MISFIRE" }),
  order: 73,
  applyOrder: 63,
  read: () => loadDispatchConfig().contestGuard,
  save: (v: "off" | "on") => {
    const from = loadDispatchConfig().contestGuard;
    saveContestGuard(v);
    if (from !== v) record({ t: new Date().toISOString(), kind: "policy", op: "contest-guard-mode", by: "SUPERVISOR", from, to: v });
  },
  record: (v: "off" | "on") => `contestGuard=${v}`,
});

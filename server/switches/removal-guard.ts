import { loadMcc } from "../mcc.ts";
import { removalGuardData, setRemovalGuard } from "../mcc-run.ts";
import { defineSwitch } from "../switch-def.ts";

// 지우기 규칙(ATC-495): mcc.json의 removalGuard(기본 on, 꺼지는 것은 정확히 "off"). 작업 지시서가 이름 붙이지 않은 사용자에게 보이는 기능을 지우는 PR을 MCC INSPECTION이 ESCALATE하고
// PR 본문의 `Removed:` 줄을 요구한다. 끄면 inspector는 지우기 때문에 ESCALATE하지 않고 `Removed:` 줄이 없다고 P1을 달지 않는다(SKILL.md의 팀 규칙은 그대로). 바꾸는 것은 SUPERVISOR만
export default defineSwitch({
  key: "removalGuard",
  label: "REMOVAL GUARD",
  group: "landing",
  block: { code: "MCC", label: "atc 착륙·RETURN TO SERVICE", windowLabel: "atc 착륙·RETURN TO SERVICE(SUPERVISOR 전용)", words: "removal guard removalGuard 지우기 기능 삭제 Removed", searchOrder: 20 },
  values: ["off", "on"],
  default: "on",
  risky: [], // 끄면 INSPECTION이 오늘 동작으로 돌아갈 뿐 atc가 더 쓰거나 밖으로 내보내지 않는다. 기본 on
  error: "on 또는 off",
  warn: {
    on: "기본: 작업 지시서가 이름 붙이지 않은 기능(화면 구역·뷰·버튼·화면이 그리는 필드)을 지우는 PR은 MCC INSPECTION이 ESCALATE해 SUPERVISOR가 본다. PR 본문에는 `Removed:` 줄이 있어야 하고 없거나 diff와 다르면 P1이다.",
    off: "off: INSPECTION은 지우기 때문에 ESCALATE하지 않고 `Removed:` 줄이 없다고 P1을 달지 않는다. 팀에게는 SKILL.md의 규칙(기능을 지키거나 BLOCKED로 보고)이 그대로 있다.",
  },
  row: () => ({ label: "REMOVAL GUARD", env: "removalGuard", note: "mcc.json · 이 화면에서만 바꾼다 — MCC 세션은 못 바꿈 · 지우기로 ESCALATE한 PR을 SUPERVISOR가 그대로 착륙시킨 수가 오작동이다" }),
  // 지우기 ESCALATE의 총수와 최근 7일 오작동 수. 설정 창의 MCC 블록이 그린다
  data: () => removalGuardData(),
  order: 32,
  lineOrder: 22,
  applyOrder: 112,
  read: () => loadMcc().removalGuard,
  save: (v: "on" | "off") => setRemovalGuard(v),
  record: (v: "on" | "off") => `mcc.removalGuard=${v}`,
});

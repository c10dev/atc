import { handoffData, loadHandoffMode, setHandoffMode } from "../autoland-handoff-run.ts";
import { defineSwitch } from "../switch-def.ts";

// AUTOLAND 넘김(ATC-513): autoland.json의 handoff(기본 on). merge 모드의 AUTOLAND가 CLEARED PR을 머지하지 않고 SUPERVISOR에게 남기면(제외 사유가 있으면)
// 그 PR은 SUPERVISOR 몫 착륙이다: HOME에 AUTOLAND의 사유가 붙은 LANDING 줄 하나, TOWER는 팀에 LAND를 내지 않는다. off면 오늘처럼 holder로 본다. SUPERVISOR만(이 화면 Origin), atcctl 명령 없음
export default defineSwitch({
  key: "autolandHandoff",
  label: "AUTOLAND 넘김",
  group: "landing",
  block: { code: "AUTOLAND", label: "착륙 자동화", windowLabel: "착륙 자동화(SUPERVISOR 전용)", words: "autoland 넘김 handoff 제외 사유 LANDING land holder 오작동 autolandHandoff", searchOrder: 10 },
  values: ["off", "on"],
  default: "on",
  risky: [], // 끄면 옛 동작(팀에 LAND)이라 ⚠ 목록에 넣지 않는다
  line: false, // 정책 한 줄에는 넣지 않는다(기본 on이고 끄면 옛 동작)
  error: "off 또는 on",
  warn: {
    on: "기본: AUTOLAND가 머지하지 않고 SUPERVISOR에게 남긴 CLEARED PR은 HOME의 LANDING 줄로 보이고(AUTOLAND의 사유가 붙는다) TOWER가 팀에 LAND를 내지 않는다. 팀에는 head마다 INFO 한 번만 간다.",
    off: "off: AUTOLAND가 SUPERVISOR에게 남긴 PR도 오늘처럼 TOWER가 홀더 팀에 LAND를 내고, 팀의 UNABLE로 끝난다. HOME의 LANDING 줄에는 나타나지 않을 수 있다.",
  },
  row: () => ({
    label: "AUTOLAND 넘김",
    env: "autoland.handoff",
    note: "autoland.json · merge 모드에서 AUTOLAND가 SUPERVISOR에게 남긴 PR을 SUPERVISOR 착륙으로 본다 — 이 화면에서만 바꾼다, 관제 세션은 못 바꿈 · 오작동 수는 이 블록(넘김 줄이 머지 없이 닫힌 수, 그래도 팀으로 나간 LAND 수)",
  }),
  data: () => handoffData(),
  order: 21,
  lineOrder: 12,
  applyOrder: 91,
  read: () => loadHandoffMode(),
  save: (v: "off" | "on") => setHandoffMode(v),
  record: (v: "off" | "on") => `autoland.handoff=${v}`,
});

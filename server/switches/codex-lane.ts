import { LANE_SWITCHES, type LaneSwitch, loadLaneSwitch, saveLaneSwitch } from "../codex-lane-run.ts";
import { config } from "../config.ts";
import { defineSwitch } from "../switch-def.ts";

// 조용한 리뷰 레인(ATC-386)의 끄는 스위치(ATC-393): codex-lane.json의 auto(기본 on). SUPERVISOR만: 이 화면 Origin이 있어야 받는다, atcctl 명령 없음
export default defineSwitch({
  key: "codexLane",
  label: "CODEX LANE",
  group: "landing",
  block: { code: "CODEX LANE", label: "Codex 저장소 무응답 레인", windowLabel: "Codex 저장소 무응답 레인(SUPERVISOR 전용)", words: "codex lane silent 무응답 조용한 리뷰 레인 review codex-lane.json lane.auto", searchOrder: 35 },
  values: LANE_SWITCHES,
  default: "on",
  risky: ["on"], // 저장소에서 Codex가 조용하면 PR이 6시간을 기다리지 않고 REVIEW 한 레인으로 착륙할 수 있다(기본 on이라 ⚠로 보이고, 껐다 다시 켤 때 확인한다)
  error: "off 또는 on",
  warn: {
    off: "off: 저장소 수준 판단과 기록을 쉰다. Codex가 조용해도 PR마다 6시간 규칙만 쓰고, REVIEW로 곧바로 가지 않는다.",
    on: `⚠ 기본: Codex를 쓰는 저장소(MCC AIRPORT 제외)에서 PR이 ${Math.round(config.codexLaneSilentMs / 60_000)}분을 기다렸는데 저장소 어디에도 Codex 신호가 없으면 그 저장소를 조용하다고 보고, 기다리는 PR과 새 head를 곧바로 REVIEW로 보낸다. REVIEW pass(P0·P1 없음)가 그 head의 리뷰가 되어 한 레인만으로 착륙할 수 있다. 비밀 경로·보안 규칙·FLIGHT 없음은 그대로 제외다. Codex 신호가 다시 오면 새 head는 Codex로 돌아간다.`,
  },
  row: () => ({ label: "CODEX LANE", env: "codex-lane.auto", note: "codex-lane.json · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈 · 기록은 codex-lane.jsonl·lanes.jsonl" }),
  order: 50,
  lineOrder: 55,
  applyOrder: 115,
  read: () => loadLaneSwitch(),
  save: (v: LaneSwitch) => saveLaneSwitch(v),
  record: (v: LaneSwitch) => `codex-lane.auto=${v}`,
});

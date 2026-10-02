import { AUTO_REVERT_MODES, type AutoRevertMode, loadAutoRevert, readAutoRevertLines, revertDaysOf } from "../auto-revert.ts";
import { setAutoRevertMode, stoppedAirports } from "../auto-revert-run.ts";
import { defineSwitch } from "../switch-def.ts";

// 자동 되돌림(ATC-351): auto-revert.json의 스위치(기본 on, ATC-394). SUPERVISOR만(이 화면 Origin), atcctl 명령은 없다(K3)
export default defineSwitch({
  key: "autoRevert",
  label: "AUTO REVERT",
  group: "landing",
  block: {
    code: "AUTO REVERT",
    label: "main이 빨개지면 lander 머지 자동 되돌림",
    windowLabel: "main이 빨개지면 lander 머지 자동 되돌림(SUPERVISOR 전용)",
    words: "revert 되돌림 main red 빨간 breaker autoRevert flake groundstop",
    searchOrder: 35,
  },
  values: AUTO_REVERT_MODES,
  default: "on",
  risky: ["on"], // atc가 lander 머지가 깬 main의 revert PR을 스스로 열고, 두 번째 빨간 head에는 lane을 한 단계 낮춘다(되돌리기 전에 실패한 체크를 한 번 다시 돌린다. 기본 on, off는 SUPERVISOR 몫)
  error: "off 또는 on",
  warn: {
    off: "off: main이 빨개져도 atc는 되돌리지 않는다. GROUND STOP과 MCC 멈춤은 사람이 읽고 푼다.",
    on: "⚠ 기본 켜짐. lander가 머지해 main을 빨갛게 만든 PR을 atc가 되돌리는 PR을 연다(AIRPORT마다 하나, 같은 리뷰·CI로 착륙, 다음 초록 head가 GROUND STOP을 푼다). 되돌리기 전에 실패한 체크를 같은 head에서 한 번 다시 돌려 flake면 아무것도 하지 않고, 다시 빨갛고 그 PR 자신의 head가 초록이었을 때만 되돌린다. 사람의 머지·마이그레이션(K1)·user 등급(K3) PR은 되돌리지 않고 DUTY에게 알린다. 1시간 안에 빨간 head가 둘이면 멈추고 AUTOLAND merge → update, MCC 착륙 끔으로 내린다.",
  },
  row: () => {
    const stopped = stoppedAirports();
    return {
      label: "AUTO REVERT",
      env: "autoRevert",
      note: `auto-revert.json · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈${stopped.length ? ` · 멈춤: ${stopped.map((x) => `${x.airport ?? "?"}(${x.detail ?? ""})`).join(", ")} — 스위치를 다시 고르면 풀린다` : ""}`,
    };
  },
  // 최근 7일의 날짜별 revert·flake·misfire 수(ATC-394). 설정 창의 AUTO REVERT 블록이 그린다
  data: () => ({ days: revertDaysOf(readAutoRevertLines(), 7, Date.now()) }),
  order: 35,
  lineOrder: 92,
  applyOrder: 85,
  read: () => loadAutoRevert().mode,
  save: (v: AutoRevertMode) => setAutoRevertMode(v),
  record: (v: AutoRevertMode) => `autoRevert=${v}`,
});

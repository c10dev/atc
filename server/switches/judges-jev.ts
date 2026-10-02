import { config } from "../config.ts";
import { engineName } from "../judges/run.ts";
import { JUDGE_MODES, type JudgeMode, loadJudges, setJudgeMode } from "../judges/store.ts";
import { defineSwitch } from "../switch-def.ts";

// 판정 계열(ATC-36): judges.json의 jev 스위치. SUPERVISOR만. 데이터 반출을 켜는 스위치(replay·shadow는 티켓 제목과 허용한 칸이 TypeSafe로 나간다)
export default defineSwitch({
  key: "judgesJev",
  label: "JEV",
  group: "operations",
  block: { code: "JUDGES", label: "판정 계열", windowLabel: "판정 계열(SUPERVISOR 전용)", words: "jev typesafe replay shadow judges.jev", searchOrder: 100 },
  values: JUDGE_MODES,
  default: "off",
  risky: ["replay", "shadow"],
  error: "off, replay, shadow 중 하나",
  warn: {
    off: "꺼짐(기본): 아무것도 읽거나 보내지 않는다.",
    replay: "⚠ SUPERVISOR가 판정한 지난 CLASSIFY 초안과 DISPATCH ASSIGN을 합쳐 1분에 3건씩 다시 판정한다. 제목과 목표·수정 허용 범위·완료 기준이 TypeSafe로 나간다(rating:SEC·Risk:* 티켓은 제목만). ASSIGN은 그 AIRCRAFT의 지난 atc FLIGHT 3개의 제목도 나가고, atc AIRCRAFT의 턴이 끝날 때는 CAPTAIN의 마지막 메시지(경로·URL을 가리고 최대 1,500자)가 나간다.",
    shadow: "⚠ 새 CLASSIFY 초안, 열린 DISPATCH ASSIGN, 끝난 atc AIRCRAFT 턴마다 판정해 둔다(결과는 SUPERVISOR 판정 뒤에만 보임). 반출 범위는 replay와 같다.",
  },
  row: () => {
    const engine = engineName();
    return {
      label: "JEV",
      env: "judges.jev",
      note: `judges.json · 엔진 ${engine}${engine === "jev" ? ` · TYPESAFE_API_KEY ${config.typesafeApiKey ? "있음" : "없음"}` : " (녹화 응답, 네트워크 없음)"} · 이 화면(또는 SUPERVISOR의 API)에서만 바꾼다 — 관제 세션은 못 바꿈`,
    };
  },
  order: 70,
  lineOrder: 30,
  applyOrder: 100,
  read: () => loadJudges().jev,
  save: (v: JudgeMode) => setJudgeMode("jev", v),
  record: (v: JudgeMode) => `judges.jev=${v}`,
});

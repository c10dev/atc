import { config } from "../config.ts";
import { CLAUDE_MODEL, exceptionsData, recordExceptionsMode } from "../judges/exceptions-run.ts";
import { DEFAULT_EXCEPTIONS, EXCEPTIONS_MODES, type ExceptionsMode, loadExceptionsMode, saveExceptionsMode } from "../judges/store.ts";
import { defineSwitch } from "../switch-def.ts";

// 예외 판정(ATC-558): judges.json의 exceptions(on|off, 기본 on, shadow·replay 없음). judges.jev와 따로다(jev가 off여도 on이면 판정한다).
// on이면 관제 세션의 `atcctl exception`과 서버가 본 두 번째 침묵을 Jev → claude -p 순으로 정하고, ESCALATE는 SUPERVISOR 카드가 된다.
// 반출(K2, SUPERVISOR 승인 2026-10-07): 가린 CAPTAIN 글(최대 1,500자)·메뉴·정책이 TypeSafe로, 같은 것이 claude -p로 간다. SUPERVISOR만(이 화면 Origin), atcctl 명령 없음
export default defineSwitch({
  key: "judgesExceptions",
  label: "EXCEPTIONS",
  group: "operations",
  block: { code: "JUDGES", label: "판정 계열", windowLabel: "판정 계열(SUPERVISOR 전용)", words: "exceptions 예외 판정 judges.exceptions ESCALATE", searchOrder: 100 },
  values: EXCEPTIONS_MODES,
  default: DEFAULT_EXCEPTIONS,
  risky: ["on"], // 가린 CAPTAIN 글이 밖(TypeSafe)으로 나가고 판정이 행동이 된다. 기본 on이라 ⚠로 보이고, 껐다 다시 켤 때 확인한다
  error: "off 또는 on",
  warn: {
    off: "off: 관제 세션이 오늘처럼 팀의 UNABLE·질문·두 번째 침묵을 스스로 판단한다(`atcctl exception`은 EXCEPTION OFF로 답한다). 아무것도 보내지 않는다.",
    on: `⚠ 기본: 팀의 UNABLE·질문·두 번째 침묵을 고정 메뉴(RESEND, HOLD_UNTIL, REASSIGN, ANSWER, ESCALATE, ACCEPT_UNDONE)로 정한다. Jev(TypeSafe)가 먼저, 확신 0.8 아래·오류·키 없음이면 claude -p 한 번(${CLAUDE_MODEL}). 가린 CAPTAIN 글(경로·URL·코드·비밀을 가리고 최대 1,500자)·메뉴·정책이 나간다(K2 승인). ANSWER는 정책이 그 점을 정할 때만, 아니면 ESCALATE 카드. judges.jev와 따로 켜진다.`,
  },
  row: () => ({
    label: "EXCEPTIONS",
    env: "judges.exceptions",
    note: `judges.json · Jev ${config.judgeEngine === "stub" ? "stub(녹화 응답)" : `TYPESAFE_API_KEY ${config.typesafeApiKey ? "있음" : "없음 — claude -p만"}`} · claude -p ${CLAUDE_MODEL} · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈`,
  }),
  order: 70.5,
  lineOrder: 30.5,
  applyOrder: 100.5,
  data: () => exceptionsData(),
  read: () => loadExceptionsMode(),
  save: (v: ExceptionsMode) => {
    const from = loadExceptionsMode();
    if (saveExceptionsMode(v) && from !== v) recordExceptionsMode(from, v);
  },
  record: (v: ExceptionsMode) => `judges.exceptions=${v}`,
});

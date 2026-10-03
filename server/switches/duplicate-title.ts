import { loadDispatchConfig, saveDuplicateTitle } from "../dispatch.ts";
import { record } from "../recorder.ts";
import { defineSwitch } from "../switch-def.ts";

// 비슷한 제목 검사(ATC-488): dispatch.json duplicateTitle(기본 on). `duty linear create`가 열린 ATC 이슈와 거의 같은 제목을 409로 거절하고(`--same-title-ok`로 넘기면 세어 둔다),
// RELEASE 화면의 PARKED 줄(MCP로 올린 이슈)에 "possible duplicate of ATC-n" 표시를 단다. 표시는 정보일 뿐 아무것도 숨기거나 합치거나 취소하지 않는다.
// 끄면 둘 다 없다. SUPERVISOR만(이 화면 Origin), atcctl 명령 없음
export default defineSwitch({
  key: "duplicateTitle",
  label: "DUPLICATE TITLE",
  group: "operations",
  block: { code: "DUPLICATE TITLE", label: "작업 지시서 제목이 열린 이슈와 거의 같으면 거절·표시", windowLabel: "비슷한 제목 검사(SUPERVISOR 전용)", words: "duplicate title 중복 제목 비슷한 same-title-ok 409 parked possible duplicate duplicateTitle", searchOrder: 57 },
  values: ["off", "on"],
  default: "on",
  risky: [], // 끄면 옛 동작이라 ⚠ 목록에 넣지 않는다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: DUTY의 `duty linear create`가 거의 같은 제목도 거절하지 않고, PARKED 줄에 중복 표시가 없다. 같은 작업 지시서가 두 번 올라가도 알리지 않는다.",
    on: "기본: DUTY가 열린 ATC 이슈와 거의 같은 제목으로 만들면 409(기존 key와 함께)로 거절하고(`--same-title-ok`로 넘기면 세어 둔다), PARKED 줄에 \"possible duplicate of ATC-n\"을 보인다. 표시는 정보일 뿐이다. 넘긴 수와 둘 다 발권한 수는 RELEASE 화면에 있다.",
  },
  row: () => ({ label: "DUPLICATE TITLE", env: "duplicateTitle", note: "dispatch.json · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈 · 넘긴 수·둘 다 발권한 수는 RELEASE 화면" }),
  order: 44,
  applyOrder: 61,
  read: () => loadDispatchConfig().duplicateTitle,
  save: (v: "off" | "on") => {
    const from = loadDispatchConfig().duplicateTitle;
    saveDuplicateTitle(v);
    if (from !== v) record({ t: new Date().toISOString(), kind: "policy", op: "duplicate-title-mode", by: "SUPERVISOR", from, to: v });
  },
  record: (v: "off" | "on") => `duplicateTitle=${v}`,
});

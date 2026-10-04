import { chatCreateCountsNow } from "../chat-release-run.ts";
import { loadDispatchConfig, saveChatRelease } from "../dispatch.ts";
import { record } from "../recorder.ts";
import { defineSwitch } from "../switch-def.ts";

// 채팅 발권(ATC-471): dispatch.json chatRelease(기본 on). SUPERVISOR가 DUTY 채팅에서 "작업 지시서 만들고 진행해"라고 한 턴에서 DUTY가 `duty linear create --release`로 만든 이슈는 그 글이 발권이다(RELEASE 화면을 또 누르지 않는다).
// K 효과가 있는 작업 지시서는 늘 화면에서 쏜다. 끄면 `--release`는 403이고 RELEASE 화면에서 발권한다. SUPERVISOR만(이 화면 Origin), atcctl 명령 없음
export default defineSwitch({
  key: "chatRelease",
  label: "CHAT RELEASE",
  group: "operations",
  block: { code: "CHAT RELEASE", label: "SUPERVISOR 채팅 글이 시작한 턴의 create --release를 발권으로 받음", windowLabel: "채팅 발권(SUPERVISOR 전용)", words: "chat release 채팅 발권 create --release 작업 지시서 chatRelease", searchOrder: 58 },
  values: ["off", "on"],
  default: "on",
  risky: [], // 끄면 옛 동작(화면 발권만)이라 ⚠ 목록에 넣지 않는다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: DUTY의 `duty linear create --release`는 403이다. SUPERVISOR가 채팅에서 만들라고 해도 RELEASE 화면에서 따로 발권한다(옛 동작).",
    on: "기본: SUPERVISOR 글이 시작한 DUTY 턴에서 `create --release`로 만든 이슈는 그 글을 words로 남기고 발권한다. REVIEW 턴·턴 없음은 403, K 효과가 있으면 409(화면에서 발권). 이 길의 발권 수와, 첫 LAUNCH 전에 버리거나 Backlog로 되돌리거나 거둔 수는 이 줄 아래에 보인다.",
  },
  row: () => ({ label: "CHAT RELEASE", env: "chatRelease", note: "dispatch.json · 이 화면에서만 바꾼다 — DUTY·관제 세션은 못 바꿈 · 발권 수·오작동 수는 이 줄 아래" }),
  data: () => chatCreateCountsNow(),
  order: 47,
  applyOrder: 64,
  read: () => loadDispatchConfig().chatRelease,
  save: (v: "off" | "on") => {
    const from = loadDispatchConfig().chatRelease;
    saveChatRelease(v);
    if (from !== v) record({ t: new Date().toISOString(), kind: "policy", op: "chat-release-mode", by: "SUPERVISOR", from, to: v });
  },
  record: (v: "off" | "on") => `chatRelease=${v}`,
});

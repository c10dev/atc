import { loadStaleReplySwitch, saveStaleReplySwitch, staleReplyData } from "../stale-reply-run.ts";
import { STALE_REPLY_SWITCHES, type StaleReplySwitch } from "../stale-reply.ts";
import { defineSwitch } from "../switch-def.ts";

// 닫혔거나 밀린 부름에 온 답의 거절(ATC-554): stale-reply.json의 스위치(기본 on). 끄면 옛 id에 온 답도 지금처럼 받는다. 거절만 하고 보내지는 않는다. SUPERVISOR만(이 화면 Origin), atcctl 명령은 없다
export default defineSwitch({
  key: "staleReply",
  label: "STALE REPLY",
  group: "operations",
  block: { code: "STALE REPLY", label: "닫혔거나 밀린 부름에 온 답 거절", windowLabel: "옛 부름에 온 답 거절(SUPERVISOR 전용)", words: "stale reply 옛 id 거절 refused superseded 다시 보낸 READBACK UNABLE STANDBY latest call staleReply", searchOrder: 106 },
  values: STALE_REPLY_SWITCHES,
  default: "on",
  risky: [], // 거절만 한다. 어느 세션에도 새로 보내지 않는다
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: 다시 보낸 CLEARANCE·FLIGHT PLAN·CREW CHANGE에 팀이 옛 id로 답해도 지금처럼 받는다(그 답이 답한 것으로 센다).",
    on: "기본: 같은 주제로 뒤에 나간 부름이 있는 옛 id에 온 READBACK·UNABLE·STANDBY를 409로 거절하고 최신 id를 알린다. 거절한 수는 이 블록에 주 단위로 센다 — 틀린 거절이 있으면 여기서 보인다.",
  },
  row: () => ({ label: "STALE REPLY", env: "staleReply", note: "stale-reply.json · 옛 id에 온 답을 거절 · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈" }),
  // 최근 7일에 거절한 답의 수(설정 창의 STALE REPLY 블록이 그린다)
  data: () => staleReplyData(),
  order: 74,
  applyOrder: 59,
  read: () => loadStaleReplySwitch(),
  save: (v: StaleReplySwitch) => saveStaleReplySwitch(v),
  record: (v: StaleReplySwitch) => `staleReply=${v}`,
});

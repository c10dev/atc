import { loadServerSendSwitch, saveServerSendSwitch } from "../server-send-run.ts";
import { defineSwitch } from "../switch-def.ts";

// SERVER SEND retry(ATC-562 c): 닿지 않아(undelivered) approved로 돌아온 FLIGHT PLAN을 그 AIRCRAFT에 살아 있는 세션이 다시 있으면 서버가 한 번 더 보낸다. 기본 on.
// 두 번째 실패는 OCC에게 넘긴다(경보·FLIGHT FOLLOWING undelivered). 끄면 OCC가 전처럼 다시 release한다. SUPERVISOR만
export default defineSwitch({
  key: "serverSendRetry",
  label: "SERVER RETRY",
  group: "operations",
  block: { code: "SERVER SEND", label: "서버가 FLIGHT PLAN을 세션에 직접 보냄", words: "retry 재시도 undelivered" },
  values: ["off", "on"],
  default: "on",
  risky: ["on"],
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: 닿지 않은 FLIGHT PLAN은 OCC가 전처럼 세션이 돌아오면 다시 release한다.",
    on: "⚠ 기본: 닿지 않은 FLIGHT PLAN을 그 AIRCRAFT에 살아 있는 background 세션이 있으면 1분 뒤 서버가 한 번 더 보낸다. 두 번째 실패는 OCC에게 넘긴다.",
  },
  row: () => ({ label: "SERVER SEND retry", env: "server-send.retry", note: "server-send.json · 닿지 않은 것 재시도 한 번 · 이 화면에서만 바꾼다" }),
  order: 78,
  applyOrder: 63,
  read: () => loadServerSendSwitch().retry,
  save: (v: "on" | "off") => saveServerSendSwitch("retry", v),
  record: (v: "on" | "off") => `serverSend.retry=${v}`,
});

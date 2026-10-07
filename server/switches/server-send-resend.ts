import { loadServerSendSwitch, saveServerSendSwitch } from "../server-send-run.ts";
import { defineSwitch } from "../switch-def.ts";

// SERVER SEND resend(ATC-562 b): 서버가 보낸 FLIGHT PLAN에 READBACK 없이 overdue(10분, 첫 STANDBY부터)가 지나면 서버가 같은 글을 한 번 더 보낸다. 기본 on.
// 끄면 다시 보내지 않고 overdue는 SUPERVISOR 보고로 간다(서버가 보낸 카드는 OCC가 다시 보내지 않는다). SUPERVISOR만
export default defineSwitch({
  key: "serverSendResend",
  label: "SERVER RESEND",
  group: "operations",
  block: { code: "SERVER SEND", label: "서버가 FLIGHT PLAN을 세션에 직접 보냄", words: "resend 재송신 overdue" },
  values: ["off", "on"],
  default: "on",
  risky: ["on"],
  line: false,
  error: "off 또는 on",
  warn: {
    off: "off: 서버가 보낸 FLIGHT PLAN을 다시 보내지 않는다. READBACK overdue는 OCC가 SUPERVISOR에게 보고한다.",
    on: "⚠ 기본: 서버가 보낸 FLIGHT PLAN에 READBACK 없이 10분(첫 STANDBY가 있으면 그때부터)이 지나면 서버가 같은 글을 한 번 더 보낸다. 그 사이 답한 AIRCRAFT에는 보내지 않는다.",
  },
  row: () => ({ label: "SERVER SEND resend", env: "server-send.resend", note: "server-send.json · overdue 재송신 한 번 · 이 화면에서만 바꾼다" }),
  order: 77,
  applyOrder: 62,
  read: () => loadServerSendSwitch().resend,
  save: (v: "on" | "off") => saveServerSendSwitch("resend", v),
  record: (v: "on" | "off") => `serverSend.resend=${v}`,
});

import { loadServerSendSwitch, saveServerSendSwitch, serverSendData } from "../server-send-run.ts";
import { defineSwitch } from "../switch-def.ts";

// SERVER SEND first(ATC-562): 승인된 FLIGHT PLAN의 첫 발송을 서버가 세션 소켓으로 한다(sentVia server). server-send.json의 first(기본 on, shadow 없음).
// 끄면 OCC가 전처럼 release·SendMessage. SUPERVISOR만(이 화면 Origin), atcctl 명령 없음. 블록의 수는 이 스위치가 싣는다
export default defineSwitch({
  key: "serverSendFirst",
  label: "SERVER SEND",
  group: "operations",
  block: { code: "SERVER SEND", label: "서버가 FLIGHT PLAN을 세션에 직접 보냄", windowLabel: "서버 발송(SUPERVISOR 전용)", words: "server send 서버 발송 세션 소켓 socket flight plan 첫 발송 재송신 resend 재시도 retry undelivered 닿지 않음 sentVia server 오작동 misfire 잘못 보냄 두 번 server-send.json serverSendFirst serverSendResend serverSendRetry", searchOrder: 108 },
  values: ["off", "on"],
  default: "on",
  risky: ["on"], // 서버가 사람·관제 세션 없이 AIRCRAFT 세션에 쓴다. 기본 on이라 ⚠로 보이고, 껐다 다시 켤 때 확인한다
  error: "off 또는 on",
  warn: {
    off: "off: 승인된 FLIGHT PLAN은 OCC가 전처럼 dispatch release로 받아 SendMessage한다.",
    on: "⚠ 기본: 승인된 FLIGHT PLAN을 서버가 send-guard와 같은 검사를 거쳐 그 AIRCRAFT의 background 세션 소켓에 직접 쓴다(sentVia server). OCC의 release는 409. 데스크톱·터미널 세션, ACCOUNT 불일치, 서버 job이 멈춘 때는 OCC가 보낸다. 쓴 글이 10분 안에 받는 세션에 보이지 않으면 서버 발송을 멈추고 OCC에게 넘긴다.",
  },
  row: () => ({ label: "SERVER SEND first", env: "server-send.first", note: "server-send.json · 첫 발송 · 이 화면에서만 바꾼다 — 관제 세션은 못 바꿈 · 수는 FLIGHT RECORDER server-send" }),
  data: () => serverSendData(),
  order: 76,
  applyOrder: 61,
  read: () => loadServerSendSwitch().first,
  save: (v: "on" | "off") => saveServerSendSwitch("first", v),
  record: (v: "on" | "off") => `serverSend.first=${v}`,
});

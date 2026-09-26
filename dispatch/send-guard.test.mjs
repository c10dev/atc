import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSend } from "./send-guard.mjs";

const MSG = '[DISPATCH D-0007] FLIGHT PLAN · BRAVO (TEAM_B)\nFLIGHT VOC193 · AIRPORT VCDO · PRIORITY High\n권한 정리\n— 맡으면 이 메시지에 "READBACK D-0007", 못 맡으면 사유로 답장해 주세요.';
const sent = { proposal: { id: "D-0007", status: "sent", aircraftName: "TEAM_B", message: MSG }, mode: "approval" };
const with_ = (over) => async () => ({ ...sent, ...over, proposal: { ...sent.proposal, ...over.proposal } });

test("모두 맞으면 통과(이름 뒤 [ref]도 허용)", async () => {
  assert.equal(await checkSend({ to: "TEAM_B", message: MSG }, async () => sent), null);
  assert.equal(await checkSend({ to: "TEAM_B [e698d1]", message: MSG + "\n" }, async () => sent), null);
});

test("막는 경우: shadow 모드, 상태, 받는 사람, 문구, 형식, 없는 제안, atc 연결 실패", async () => {
  const cases = [
    [{ to: "TEAM_B", message: MSG }, with_({ mode: "shadow" }), /2a\(shadow\)/],
    [{ to: "TEAM_B", message: MSG }, with_({ proposal: { status: "approved" } }), /먼저 dispatch release/],
    [{ to: "TEAM_C", message: MSG }, async () => sent, /CAPTAIN\(TEAM_B\)이 아님/],
    [{ to: "TEAM_B", message: MSG.replace("권한 정리", "다른 일") }, async () => sent, /FLIGHT PLAN과 다름/],
    [{ to: "TEAM_B", message: "안녕하세요" }, async () => sent, /FLIGHT PLAN\(\[DISPATCH/],
    [{ to: "TEAM_B", message: { type: "shutdown_request" } }, async () => sent, /문자열이 아님/],
    [{ to: "TEAM_B", message: MSG }, async () => null, /atc에 없음/],
    [{ to: "TEAM_B", message: MSG }, async () => { throw new Error("ECONNREFUSED"); }, /연결할 수 없어/],
  ];
  for (const [input, fetcher, expected] of cases) assert.match(await checkSend(input, fetcher), expected);
});

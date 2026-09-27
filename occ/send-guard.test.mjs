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

const RECALL = '[DISPATCH D-0007] RECALL · BRAVO (TEAM_B)\nFLIGHT VOC193 · AIRPORT VCDO — 이 FLIGHT PLAN을 거둬들입니다.\n권한 정리\n사유: 우선순위 바뀜\n작업을 멈추세요. STAND(워크트리)는 정리하지 말고 그대로 두세요 — 다른 AIRCRAFT가 이어받을 수 있게.\n— 받았으면 이 메시지에 "READBACK D-0007 RECALL"로 답장해 주세요.';
const recalling = { proposal: { id: "D-0007", status: "recalling", aircraftName: "TEAM_B", message: MSG, recallMessage: RECALL }, mode: "approval" };
const recallWith = (over) => async () => ({ ...recalling, ...over, proposal: { ...recalling.proposal, ...over.proposal } });

test("RECALL: recalling 상태이고 CAPTAIN에게 서버 문구 그대로면 통과", async () => {
  assert.equal(await checkSend({ to: "TEAM_B", message: RECALL }, async () => recalling), null);
  assert.equal(await checkSend({ to: "TEAM_B [e698d1]", message: RECALL + "\n" }, async () => recalling), null);
});

test("RECALL 막는 경우: shadow 모드, 상태(sent·accepted·recalled), 받는 사람, 문구, RECALL 상태에서 FLIGHT PLAN 다시 보내기", async () => {
  const cases = [
    [{ to: "TEAM_B", message: RECALL }, recallWith({ mode: "shadow" }), /2a\(shadow\)/],
    [{ to: "TEAM_B", message: RECALL }, recallWith({ proposal: { status: "sent" } }), /RECALL 요청된 제안이 아님\(sent\)/],
    [{ to: "TEAM_B", message: RECALL }, recallWith({ proposal: { status: "recalled" } }), /RECALL 요청된 제안이 아님\(recalled\)/],
    [{ to: "TEAM_C", message: RECALL }, async () => recalling, /CAPTAIN\(TEAM_B\)이 아님/],
    [{ to: "TEAM_B", message: RECALL.replace("우선순위 바뀜", "다른 이유") }, async () => recalling, /RECALL과 다름/],
    [{ to: "TEAM_B", message: RECALL }, recallWith({ proposal: { recallMessage: undefined } }), /RECALL과 다름/],
    [{ to: "TEAM_B", message: MSG }, async () => recalling, /보낼 상태가 아님\(recalling\)/],
    // sent 제안에 RECALL 머리를 붙인 가짜 문구
    [{ to: "TEAM_B", message: "[DISPATCH D-0007] RECALL · 지어낸 문구" }, async () => sent, /RECALL 요청된 제안이 아님\(sent\)/],
  ];
  for (const [input, fetcher, expected] of cases) assert.match(await checkSend(input, fetcher), expected);
});

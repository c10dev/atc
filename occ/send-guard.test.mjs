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

const CC = '[OCC CC-0003] CREW CHANGE · HOTEL (TEAM_H)\n\nTEAM_H CAPTAIN, SUPERVISOR가 이 AIRCRAFT의 CREW COMPLEMENT를 바꿨습니다.\n\n내리는 CREW (멈추고 더 부르지 않습니다)\n- flash-helper: flash-helper\n\n— 받았으면 이 메시지에 "READBACK CC-0003"로 답장해 주세요.';
const ccSent = { change: { id: "CC-0003", status: "sent", registration: "TEAM_H", message: CC }, mode: "approval" };
const ccWith = (over) => async () => ({ ...ccSent, ...over, change: { ...ccSent.change, ...over.change } });

test("CREW CHANGE: sent 상태이고 그 AIRCRAFT에게 발부 문구 그대로면 통과. CC id로 조회한다", async () => {
  const asked = [];
  const fetcher = async (id) => (asked.push(id), ccSent);
  assert.equal(await checkSend({ to: "TEAM_H", message: CC }, fetcher), null);
  assert.equal(await checkSend({ to: "TEAM_H [e698d1]", message: CC + "\n" }, fetcher), null);
  assert.deepEqual(asked, ["CC-0003", "CC-0003"]);
});

test("CREW CHANGE 막는 경우: shadow 모드, 상태(pending·approved·acknowledged·delivered·superseded), 받는 사람, 문구, 없는 건, atc 연결 실패", async () => {
  const cases = [
    [{ to: "TEAM_H", message: CC }, ccWith({ mode: "shadow" }), /2a\(shadow\) — CREW CHANGE/],
    [{ to: "TEAM_H", message: CC }, ccWith({ mode: undefined }), /2a\(shadow\)/],
    ...["pending", "approved", "acknowledged", "delivered", "superseded"].map((status) => [
      { to: "TEAM_H", message: CC },
      ccWith({ change: { status } }),
      new RegExp(`보낼 상태가 아님\\(${status}\\) — 먼저 crew-change send`),
    ]),
    [{ to: "TEAM_B", message: CC }, async () => ccSent, /AIRCRAFT\(TEAM_H\)가 아님/],
    [{ to: "team_h", message: CC }, async () => ccSent, /AIRCRAFT\(TEAM_H\)가 아님/],
    [{ to: "TEAM_H_FAKE", message: CC }, async () => ccSent, /AIRCRAFT\(TEAM_H\)가 아님/],
    [{ to: "TEAM_H", message: CC.replace("flash-helper: flash-helper", "backend: sonnet") }, async () => ccSent, /CREW CHANGE와 다름/],
    [{ to: "TEAM_H", message: CC + "\n추가 지시" }, async () => ccSent, /CREW CHANGE와 다름/],
    [{ to: "TEAM_H", message: CC }, ccWith({ change: { message: null } }), /CREW CHANGE와 다름/],
    [{ to: "TEAM_H", message: CC }, ccWith({ change: { id: "CC-0004" } }), /다른 CREW CHANGE\(CC-0004\)/],
    [{ to: "TEAM_H", message: CC }, async () => null, /CC-0003 CREW CHANGE가 atc에 없음/],
    // D- 조회 결과(proposal)만 오는 경우도 CREW CHANGE가 없는 것으로 본다
    [{ to: "TEAM_H", message: CC }, async () => sent, /CREW CHANGE가 atc에 없음/],
    [{ to: "TEAM_H", message: CC }, async () => { throw new Error("ECONNREFUSED"); }, /연결할 수 없어/],
    // 머리 없는 본문·옛 머리([ATC FLEET])는 CREW CHANGE로 보내지 못한다
    [{ to: "TEAM_H", message: CC.replace("[OCC CC-0003] ", "") }, async () => ccSent, /\[OCC CC-xxxx\]로 시작/],
    [{ to: "TEAM_H", message: "[ATC FLEET] CREW CHANGE · HOTEL (TEAM_H) · CC-0003" }, async () => ccSent, /\[OCC CC-xxxx\]로 시작/],
  ];
  for (const [input, fetcher, expected] of cases) assert.match(await checkSend(input, fetcher), expected);
});

test("CREW CHANGE 문구를 DISPATCH 제안 번호로 속이지 못한다: [DISPATCH …] 머리면 제안 규칙으로만 본다", async () => {
  const fake = CC.replace("[OCC CC-0003]", "[DISPATCH D-0007]");
  assert.match(await checkSend({ to: "TEAM_B", message: fake }, async () => sent), /FLIGHT PLAN과 다름/);
});

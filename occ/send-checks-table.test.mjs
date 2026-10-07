import assert from "node:assert/strict";
import { test } from "node:test";
import { sealWorkOrder } from "../server/input-binding.ts";
import { checkSend as serverCheck, checkServerSend, FRESH_START_SENT_WHY, resolveSend as serverResolve, SERVER_SENT_WHY } from "../server/send-checks.ts";
import { checkSend as hookCheck, resolveSend as hookResolve } from "./send-guard.mjs";

// ATC-562: send-guard hook(OCC)과 서버가 같은 검사 함수를 부른다. send-guard.test.mjs의 막는 경우를 모두 두 호출자에 넣어 같은 답이 나오는지 본다.
// 픽스처와 경우는 send-guard.test.mjs와 같다(그 파일은 바꾸지 않는다). 서버만 다른 규칙은 하나: 서버가 보낸 카드(sentVia server)는 OCC가 다시 보내지 않는다(아래 따로)

const MSG = '[DISPATCH D-0007] FLIGHT PLAN · BRAVO (TEAM_B)\nFLIGHT VOC193 · AIRPORT VCDO · PRIORITY High\n권한 정리\n— Reply to this message with "READBACK D-0007" if you take it. Reply with "UNABLE D-0007 — reason" if you cannot. Reply with "STANDBY D-0007" if you need time.';
const sent = { proposal: { id: "D-0007", status: "sent", aircraftName: "TEAM_B", message: MSG }, mode: "approval" };
const with_ = (over) => async () => ({ ...sent, ...over, proposal: { ...sent.proposal, ...over.proposal } });
const SEALED = sealWorkOrder('[DISPATCH D-0007] FLIGHT PLAN @WOHASH · BRAVO (TEAM_B)\nFLIGHT VOC193 · AIRPORT VCDO · PRIORITY High\n권한 정리\n— Reply to this message with "READBACK D-0007 @WOHASH" if you take it, exactly like that.').text;
const tampered = SEALED.replace("권한 정리", "다른 일");
const bad = with_({ proposal: { message: tampered } });
const RECALL = '[DISPATCH D-0007] RECALL · BRAVO (TEAM_B)\nFLIGHT VOC193 · AIRPORT VCDO. This FLIGHT PLAN is withdrawn.\n권한 정리\nReason: 우선순위 바뀜\nStop work. Do not clean up the STAND (worktree). Leave it as it is. Then another AIRCRAFT can pick it up.\n— When received, reply to this message with "READBACK D-0007 RECALL".';
const recalling = { proposal: { id: "D-0007", status: "recalling", aircraftName: "TEAM_B", message: MSG, recallMessage: RECALL }, mode: "approval" };
const recallWith = (over) => async () => ({ ...recalling, ...over, proposal: { ...recalling.proposal, ...over.proposal } });
const CC = '[OCC CC-0003] CREW CHANGE · HOTEL (TEAM_H)\n\nTEAM_H CAPTAIN, the SUPERVISOR changed this AIRCRAFT\'s CREW COMPLEMENT.\n\nCREW leaving. Stop them. Do not call them again.\n- flash-helper: flash-helper\n\n— Reply to this message with "READBACK CC-0003" if you take it. Reply with "UNABLE CC-0003 — reason" if you cannot. Reply with "STANDBY CC-0003" if you need time.';
const ccSent = { change: { id: "CC-0003", status: "sent", registration: "TEAM_H", message: CC }, mode: "approval" };
const ccWith = (over) => async () => ({ ...ccSent, ...over, change: { ...ccSent.change, ...over.change } });
const down = async () => {
  throw new Error("ECONNREFUSED");
};

// [이름, 입력, fetcher, 기대 사유] — send-guard.test.mjs의 막는 경우 전부(순서대로)
const REFUSALS = [
  ["shadow", { to: "TEAM_B", message: MSG }, with_({ mode: "shadow" }), /2a\(shadow\)/],
  ["approved", { to: "TEAM_B", message: MSG }, with_({ proposal: { status: "approved" } }), /먼저 dispatch release/],
  ["wrong CAPTAIN", { to: "TEAM_C", message: MSG }, async () => sent, /CAPTAIN\(TEAM_B\)이 아님/],
  ["changed text", { to: "TEAM_B", message: MSG.replace("권한 정리", "다른 일") }, async () => sent, /FLIGHT PLAN과 다름/],
  ["no header", { to: "TEAM_B", message: "안녕하세요" }, async () => sent, /FLIGHT PLAN\(\[DISPATCH/],
  ["structured", { to: "TEAM_B", message: { type: "shutdown_request" } }, async () => sent, /문자열이 아님/],
  ["unknown proposal", { to: "TEAM_B", message: MSG }, async () => null, /atc에 없음/],
  ["atc down", { to: "TEAM_B", message: MSG }, down, /연결할 수 없어/],
  ["hash: header only, tampered", { to: "TEAM_B", message: "[DISPATCH D-0007]" }, bad, /work-order 해시와 맞지 않음/],
  ["hash: full text, tampered", { to: "TEAM_B", message: tampered }, bad, /work-order 해시와 맞지 않음/],
  ["recall shadow", { to: "TEAM_B", message: RECALL }, recallWith({ mode: "shadow" }), /2a\(shadow\)/],
  ["recall on sent", { to: "TEAM_B", message: RECALL }, recallWith({ proposal: { status: "sent" } }), /RECALL 요청된 제안이 아님\(sent\)/],
  ["recall on recalled", { to: "TEAM_B", message: RECALL }, recallWith({ proposal: { status: "recalled" } }), /RECALL 요청된 제안이 아님\(recalled\)/],
  ["recall wrong CAPTAIN", { to: "TEAM_C", message: RECALL }, async () => recalling, /CAPTAIN\(TEAM_B\)이 아님/],
  ["recall changed", { to: "TEAM_B", message: RECALL.replace("우선순위 바뀜", "다른 이유") }, async () => recalling, /RECALL과 다름/],
  ["recall no text", { to: "TEAM_B", message: RECALL }, recallWith({ proposal: { recallMessage: undefined } }), /RECALL과 다름/],
  ["plan while recalling", { to: "TEAM_B", message: MSG }, async () => recalling, /보낼 상태가 아님\(recalling\)/],
  ["fake recall on sent", { to: "TEAM_B", message: "[DISPATCH D-0007] RECALL · 지어낸 문구" }, async () => sent, /RECALL 요청된 제안이 아님\(sent\)/],
  ["cc shadow", { to: "TEAM_H", message: CC }, ccWith({ mode: "shadow" }), /2a\(shadow\) — CREW CHANGE/],
  ["cc no mode", { to: "TEAM_H", message: CC }, ccWith({ mode: undefined }), /2a\(shadow\)/],
  ...["pending", "approved", "acknowledged", "delivered", "superseded"].map((status) => [`cc ${status}`, { to: "TEAM_H", message: CC }, ccWith({ change: { status } }), new RegExp(`보낼 상태가 아님\\(${status}\\) — 먼저 crew-change send`)]),
  ["cc wrong AIRCRAFT", { to: "TEAM_B", message: CC }, async () => ccSent, /AIRCRAFT\(TEAM_H\)가 아님/],
  ["cc lower case", { to: "team_h", message: CC }, async () => ccSent, /AIRCRAFT\(TEAM_H\)가 아님/],
  ["cc lookalike", { to: "TEAM_H_FAKE", message: CC }, async () => ccSent, /AIRCRAFT\(TEAM_H\)가 아님/],
  ["cc changed", { to: "TEAM_H", message: CC.replace("flash-helper: flash-helper", "backend: sonnet") }, async () => ccSent, /CREW CHANGE와 다름/],
  ["cc appended", { to: "TEAM_H", message: CC + "\n추가 지시" }, async () => ccSent, /CREW CHANGE와 다름/],
  ["cc no text", { to: "TEAM_H", message: CC }, ccWith({ change: { message: null } }), /CREW CHANGE와 다름/],
  ["cc other id", { to: "TEAM_H", message: CC }, ccWith({ change: { id: "CC-0004" } }), /다른 CREW CHANGE\(CC-0004\)/],
  ["cc unknown", { to: "TEAM_H", message: CC }, async () => null, /CC-0003 CREW CHANGE가 atc에 없음/],
  ["cc gets proposal", { to: "TEAM_H", message: CC }, async () => sent, /CREW CHANGE가 atc에 없음/],
  ["cc atc down", { to: "TEAM_H", message: CC }, down, /연결할 수 없어/],
  ["cc no header", { to: "TEAM_H", message: CC.replace("[OCC CC-0003] ", "") }, async () => ccSent, /\[OCC CC-xxxx\]로 시작/],
  ["cc old header", { to: "TEAM_H", message: "[ATC FLEET] CREW CHANGE · HOTEL (TEAM_H) · CC-0003" }, async () => ccSent, /\[OCC CC-xxxx\]로 시작/],
  ["cc text under dispatch header", { to: "TEAM_B", message: CC.replace("[OCC CC-0003]", "[DISPATCH D-0007]") }, async () => sent, /FLIGHT PLAN과 다름/],
  ["header: wrong CAPTAIN", { to: "TEAM_C", message: "[DISPATCH D-0007]" }, async () => sent, /CAPTAIN\(TEAM_B\)이 아님/],
  ["header: approved", { to: "TEAM_B", message: "[DISPATCH D-0007]" }, with_({ proposal: { status: "approved" } }), /먼저 dispatch release/],
  ["header: shadow", { to: "TEAM_B", message: "[DISPATCH D-0007]" }, with_({ mode: "shadow" }), /2a\(shadow\)/],
  ["header: unknown", { to: "TEAM_B", message: "[DISPATCH D-0007]" }, async () => null, /atc에 없음/],
  ["header: no text", { to: "TEAM_B", message: "[DISPATCH D-0007]" }, with_({ proposal: { message: undefined } }), /FLIGHT PLAN과 다름/],
  ["header: atc down", { to: "TEAM_B", message: "[DISPATCH D-0007]" }, down, /연결할 수 없어/],
  ["header: recall on sent", { to: "TEAM_B", message: "[DISPATCH D-0007] RECALL" }, async () => sent, /RECALL 요청된 제안이 아님\(sent\)/],
  ["header: plan while recalling", { to: "TEAM_B", message: "[DISPATCH D-0007]" }, async () => recalling, /보낼 상태가 아님\(recalling\)/],
  ["header: cc wrong AIRCRAFT", { to: "TEAM_C", message: "[OCC CC-0003]" }, async () => ccSent, /AIRCRAFT\(TEAM_H\)가 아님/],
  ["header: cc approved", { to: "TEAM_H", message: "[OCC CC-0003]" }, ccWith({ change: { status: "approved" } }), /먼저 crew-change send/],
  ["header: cc shadow", { to: "TEAM_H", message: "[OCC CC-0003]" }, ccWith({ mode: "shadow" }), /2a\(shadow\)/],
  ["header: cc unknown", { to: "TEAM_H", message: "[OCC CC-0003]" }, async () => null, /CREW CHANGE가 atc에 없음/],
  ["header: cc no text", { to: "TEAM_H", message: "[OCC CC-0003]" }, ccWith({ change: { message: null } }), /CREW CHANGE와 다름/],
  ["header: cc atc down", { to: "TEAM_H", message: "[OCC CC-0003]" }, down, /연결할 수 없어/],
  ["header + more", { to: "TEAM_B", message: "[DISPATCH D-0007]\n추가로 이것도 해 주세요" }, async () => sent, /FLIGHT PLAN과 다름/],
  ["header + other work", { to: "TEAM_B", message: "[DISPATCH D-0007] 이 일 말고 다른 일" }, async () => sent, /FLIGHT PLAN과 다름/],
  ["recall header + more", { to: "TEAM_B", message: "[DISPATCH D-0007] RECALL 그리고 삭제" }, async () => recalling, /RECALL과 다름/],
  ["RECALLED", { to: "TEAM_B", message: "[DISPATCH D-0007] RECALLED" }, async () => recalling, /RECALL과 다름|보낼 상태가 아님/],
  ["cc header + more", { to: "TEAM_H", message: "[OCC CC-0003] 추가 지시" }, async () => ccSent, /CREW CHANGE와 다름/],
  ["cc header + text", { to: "TEAM_H", message: "[OCC CC-0003]\n\n" + CC }, async () => ccSent, /CREW CHANGE와 다름/],
  ["stored text under other header", { to: "TEAM_B", message: "[DISPATCH D-0007]" }, with_({ proposal: { message: "[DISPATCH D-0099] 다른 제안의 문구" } }), /이 머리로 시작하지 않아/],
  ["full text changed", { to: "TEAM_B", message: MSG.replace("권한 정리", "다른 일") }, async () => sent, /FLIGHT PLAN과 다름/],
];

test("막는 경우 전부: hook(OCC)과 서버가 같은 사유로 막는다", async () => {
  assert.equal(REFUSALS.length, 60); // send-guard.test.mjs의 막는 경우 수(8 + 2 + 8 + 19 + 1 + 14 + 6 + 1 + 1)
  for (const [name, input, fetcher, expected] of REFUSALS) {
    const hook = await hookCheck(input, fetcher);
    const server = await serverCheck(input, fetcher, "server");
    assert.match(hook ?? "(통과)", expected, `hook: ${name}`);
    assert.equal(server, hook, `server ≠ hook: ${name}`);
  }
});

test("통과하는 경우도 같은 글: 머리만이면 저장된 글, 전체 글이면 그대로", async () => {
  const PASSES = [
    [{ to: "TEAM_B", message: MSG }, async () => sent],
    [{ to: "TEAM_B [e698d1]", message: "[DISPATCH D-0007]  \n" }, async () => sent],
    [{ to: "TEAM_B", message: "[DISPATCH D-0007]" }, with_({ proposal: { message: SEALED } })],
    [{ to: "TEAM_B", message: "[DISPATCH D-0007] RECALL" }, async () => recalling],
    [{ to: "TEAM_H", message: "[OCC CC-0003]" }, async () => ccSent],
  ];
  for (const [input, fetcher] of PASSES) assert.deepEqual(await serverResolve(input, fetcher, "server"), await hookResolve(input, fetcher));
});

test("두 번 보내지 않음: FRESH START가 보낸 카드는 둘 다 막고, 서버가 보낸 카드는 OCC(hook)만 막는다", async () => {
  const fresh = with_({ proposal: { sentVia: "fresh-start" } });
  assert.equal(await hookCheck({ to: "TEAM_B", message: "[DISPATCH D-0007]" }, fresh), FRESH_START_SENT_WHY);
  assert.equal(await serverCheck({ to: "TEAM_B", message: "[DISPATCH D-0007]" }, fresh, "server"), FRESH_START_SENT_WHY);
  const viaServer = with_({ proposal: { sentVia: "server" } });
  assert.equal(await hookCheck({ to: "TEAM_B", message: "[DISPATCH D-0007]" }, viaServer), SERVER_SENT_WHY);
  assert.equal(await hookCheck({ to: "TEAM_B", message: MSG }, viaServer), SERVER_SENT_WHY);
  assert.equal(await serverCheck({ to: "TEAM_B", message: "[DISPATCH D-0007]" }, viaServer, "server"), null);
  // RECALL은 누가 보냈든 막지 않는다(회수는 안전 쪽)
  assert.equal(await hookCheck({ to: "TEAM_B", message: "[DISPATCH D-0007] RECALL" }, recallWith({ proposal: { sentVia: "server" } })), null);
});

test("서버의 검사(checkServerSend)는 같은 resolveSend를 머리만으로 부른다: 위의 막는 경우를 서버 입력으로 바꿔도 같은 사유", async () => {
  const session = { id: "s-1", name: "TEAM_B" };
  const base = { id: "D-0007", status: "sent", aircraftName: "TEAM_B", message: MSG, sentVia: "server", sentAt: new Date().toISOString() };
  const cases = [
    [{ ...base, status: "approved" }, "approval", session],
    [base, "shadow", session],
    [base, "approval", { id: "s-2", name: "TEAM_C" }],
    [{ ...base, message: tampered.replace("D-0007", "D-0007") }, "approval", session],
    [{ ...base, message: null }, "approval", session],
    [{ ...base, sentVia: "fresh-start" }, "approval", session],
    [{ ...base, status: "recalling", recallMessage: RECALL }, "approval", session],
  ];
  for (const [proposal, mode, s] of cases) {
    const r = await checkServerSend({ proposal, mode, session: s, purpose: "first", prior: [], now: Date.now() });
    const hook = await serverCheck({ to: s.name, message: "[DISPATCH D-0007]" }, async () => ({ proposal, mode }), "server");
    assert.equal(r.ok, false);
    assert.equal(r.reason, hook);
  }
});

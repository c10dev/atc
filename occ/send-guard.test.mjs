import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkSend, hookOutputOf, resolveSend } from "./send-guard.mjs";

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

// ── ID로 보내기(ATC-119): 머리만 보내면 저장된 문구로 바꿔 넣는다 ──
test("머리만: FLIGHT PLAN·RECALL·CREW CHANGE는 저장된 문구를 돌려준다(뒤 공백·[ref] 허용)", async () => {
  assert.deepEqual(await resolveSend({ to: "TEAM_B", message: "[DISPATCH D-0007]" }, async () => sent), { message: MSG.trim() });
  assert.deepEqual(await resolveSend({ to: "TEAM_B [e698d1]", message: "[DISPATCH D-0007]  \n" }, async () => sent), { message: MSG.trim() });
  assert.deepEqual(await resolveSend({ to: "TEAM_B", message: "[DISPATCH D-0007] RECALL" }, async () => recalling), { message: RECALL.trim() });
  assert.deepEqual(await resolveSend({ to: "TEAM_H", message: "[OCC CC-0003]" }, async () => ccSent), { message: CC.trim() });
  assert.equal(await checkSend({ to: "TEAM_B", message: "[DISPATCH D-0007]" }, async () => sent), null);
});

test("머리만이어도 막는 경우: 받는 사람, 상태, shadow, 없는 기록, atc 연결 실패", async () => {
  const cases = [
    [{ to: "TEAM_C", message: "[DISPATCH D-0007]" }, async () => sent, /CAPTAIN\(TEAM_B\)이 아님/],
    [{ to: "TEAM_B", message: "[DISPATCH D-0007]" }, with_({ proposal: { status: "approved" } }), /먼저 dispatch release/],
    [{ to: "TEAM_B", message: "[DISPATCH D-0007]" }, with_({ mode: "shadow" }), /2a\(shadow\)/],
    [{ to: "TEAM_B", message: "[DISPATCH D-0007]" }, async () => null, /atc에 없음/],
    [{ to: "TEAM_B", message: "[DISPATCH D-0007]" }, with_({ proposal: { message: undefined } }), /FLIGHT PLAN과 다름/],
    [{ to: "TEAM_B", message: "[DISPATCH D-0007]" }, async () => { throw new Error("ECONNREFUSED"); }, /연결할 수 없어/],
    [{ to: "TEAM_B", message: "[DISPATCH D-0007] RECALL" }, async () => sent, /RECALL 요청된 제안이 아님\(sent\)/],
    [{ to: "TEAM_B", message: "[DISPATCH D-0007]" }, async () => recalling, /보낼 상태가 아님\(recalling\)/],
    [{ to: "TEAM_C", message: "[OCC CC-0003]" }, async () => ccSent, /AIRCRAFT\(TEAM_H\)가 아님/],
    [{ to: "TEAM_H", message: "[OCC CC-0003]" }, ccWith({ change: { status: "approved" } }), /먼저 crew-change send/],
    [{ to: "TEAM_H", message: "[OCC CC-0003]" }, ccWith({ mode: "shadow" }), /2a\(shadow\)/],
    [{ to: "TEAM_H", message: "[OCC CC-0003]" }, async () => null, /CREW CHANGE가 atc에 없음/],
    [{ to: "TEAM_H", message: "[OCC CC-0003]" }, ccWith({ change: { message: null } }), /CREW CHANGE와 다름/],
    [{ to: "TEAM_H", message: "[OCC CC-0003]" }, async () => { throw new Error("ECONNREFUSED"); }, /연결할 수 없어/],
  ];
  for (const [input, fetcher, expected] of cases) assert.match(await checkSend(input, fetcher), expected);
});

test("머리 뒤에 다른 글이 붙으면 막는다: 머리 + 추가 지시는 저장된 문구가 아님", async () => {
  const cases = [
    [{ to: "TEAM_B", message: "[DISPATCH D-0007]\n추가로 이것도 해 주세요" }, async () => sent, /FLIGHT PLAN과 다름/],
    [{ to: "TEAM_B", message: "[DISPATCH D-0007] 이 일 말고 다른 일" }, async () => sent, /FLIGHT PLAN과 다름/],
    [{ to: "TEAM_B", message: "[DISPATCH D-0007] RECALL 그리고 삭제" }, async () => recalling, /RECALL과 다름/],
    [{ to: "TEAM_B", message: "[DISPATCH D-0007] RECALLED" }, async () => recalling, /RECALL과 다름|보낼 상태가 아님/],
    [{ to: "TEAM_H", message: "[OCC CC-0003] 추가 지시" }, async () => ccSent, /CREW CHANGE와 다름/],
    [{ to: "TEAM_H", message: "[OCC CC-0003]\n\n" + CC }, async () => ccSent, /CREW CHANGE와 다름/],
  ];
  for (const [input, fetcher, expected] of cases) assert.match(await checkSend(input, fetcher), expected);
});

test("저장된 문구가 그 머리로 시작하지 않으면 머리만으로는 바꿔 넣지 않는다", async () => {
  const odd = with_({ proposal: { message: "[DISPATCH D-0099] 다른 제안의 문구" } });
  assert.match(await checkSend({ to: "TEAM_B", message: "[DISPATCH D-0007]" }, odd), /이 머리로 시작하지 않아/);
});

test("전체 문구는 예전처럼 정확히 같을 때만: 바꿔 넣지 않고 그대로 보낸다", async () => {
  assert.deepEqual(await resolveSend({ to: "TEAM_B", message: MSG }, async () => sent), { message: MSG });
  assert.equal(hookOutputOf({ to: "TEAM_B", message: MSG }, MSG), null);
  assert.match(await checkSend({ to: "TEAM_B", message: MSG.replace("권한 정리", "다른 일") }, async () => sent), /FLIGHT PLAN과 다름/);
});

test("hook 출력: 머리만이면 allow + updatedInput(message와 하네스 사본 content)과 실제로 나간 문구", () => {
  const out = hookOutputOf({ to: "TEAM_B", message: "[DISPATCH D-0007]", content: "[DISPATCH D-0007]", type: "message" }, MSG);
  assert.equal(out.hookSpecificOutput.permissionDecision, "allow");
  assert.deepEqual(out.hookSpecificOutput.updatedInput, { to: "TEAM_B", message: MSG, content: MSG, type: "message" });
  assert.match(out.hookSpecificOutput.additionalContext, /권한 정리/);
  assert.equal("content" in hookOutputOf({ to: "TEAM_B", message: "[DISPATCH D-0007]" }, MSG).hookSpecificOutput.updatedInput, false);
});

// 실제 hook 프로세스: stdin → stdout JSON / exit 2. atc는 임시 서버로 흉내 낸다
test("hook 프로세스: 머리만이면 updatedInput JSON을 내고, 틀리거나 atc가 없으면 exit 2", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/api/dispatch/proposals/D-0007") res.end(JSON.stringify(sent));
    else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const run = (input, atc) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL("./send-guard.mjs", import.meta.url))], { env: { ...process.env, ATC_URL: atc } });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stdin.end(JSON.stringify({ tool_input: input }));
      child.on("close", (code) => resolve({ code, out }));
    });
  try {
    const ok = await run({ to: "TEAM_B", message: "[DISPATCH D-0007]", content: "[DISPATCH D-0007]" }, url);
    assert.equal(ok.code, 0);
    assert.equal(JSON.parse(ok.out).hookSpecificOutput.updatedInput.message, MSG.trim());
    const full = await run({ to: "TEAM_B", message: MSG }, url);
    assert.deepEqual([full.code, full.out], [0, ""]);
    assert.equal((await run({ to: "TEAM_C", message: "[DISPATCH D-0007]" }, url)).code, 2);
    assert.equal((await run({ to: "TEAM_B", message: "[DISPATCH D-0008]" }, url)).code, 2);
    assert.equal((await run({ to: "TEAM_B", message: "[DISPATCH D-0007]" }, "http://127.0.0.1:1")).code, 2);
  } finally {
    server.close();
  }
});

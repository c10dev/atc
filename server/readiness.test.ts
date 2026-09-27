import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { KNOWN_GAPS_LINK, readiness2bOf, sendGuardOf, VOCADO_READBACK_SUGGESTION, vocadoReadbackOf } from "./readiness.ts";

// vocado CLAUDE.md 66행(2026-09-27)과 같은 줄
const ATC_LINE = "- atc TOWER(관제 세션)에서 `[ATC C-xxxx]`로 시작하는 CLEARANCE를 받으면 리더가 그 메시지에 `READBACK C-xxxx`로 답한다. 따를 수 없거나 판단이 필요하면 READBACK 대신 이유를 답한다.";

test("vocado READBACK: [ATC C-xxxx] 줄만 있으면 not-ready와 추가할 문장, [DISPATCH D-xxxx] 줄이 있으면 ready, 파일이 없으면 check", () => {
  const today = ["# vocado", "병렬 작업:", ATC_LINE, ""].join("\n");
  const no = vocadoReadbackOf(today, "/p/CLAUDE.md");
  assert.equal(no.status, "not-ready");
  assert.match(no.detail, /^\/p\/CLAUDE\.md:3은 \[ATC C-xxxx\] → READBACK C-xxxx만 다룬다/);
  assert.match(no.detail, /추가할 문장: - atc OCC/);
  assert.equal(no.suggestion, VOCADO_READBACK_SUGGESTION);
  assert.match(VOCADO_READBACK_SUGGESTION, /`\[DISPATCH D-xxxx\]`로 시작하는 FLIGHT PLAN을 받으면 리더가 그 메시지에 `READBACK D-xxxx`로 답하고, 맡지 못하면/);
  // 제안 문장을 붙이면 ready가 된다
  const fixed = vocadoReadbackOf(`${today}${VOCADO_READBACK_SUGGESTION}\n`, "/p/CLAUDE.md");
  assert.equal(fixed.status, "ready");
  assert.match(fixed.detail, /:4 —/);
  assert.equal(fixed.suggestion, undefined);
  // 두 줄에 흩어진 것은 규칙으로 보지 않는다
  assert.equal(vocadoReadbackOf("[DISPATCH D-xxxx]를 받으면\nREADBACK D-xxxx로", "/p").status, "not-ready");
  assert.match(vocadoReadbackOf("# 없음", "/p").detail, /\/p에 READBACK 규칙이 없다/);
  assert.equal(vocadoReadbackOf(null, "/p").status, "check");
});

test("vocado READBACK: 지금 vocado CLAUDE.md가 있으면 not-ready로 읽힌다(읽기만)", (t) => {
  let text: string;
  try {
    text = readFileSync("/home/c10/projects/vocado_nextjs/CLAUDE.md", "utf8");
  } catch {
    return t.skip("vocado CLAUDE.md 없음");
  }
  if (/\[DISPATCH D-/.test(text)) return t.skip("이미 고쳐짐");
  assert.equal(vocadoReadbackOf(text, "x").status, "not-ready");
});

test("send-guard: 실제 파일은 check(테스트는 서버가 돌리지 않음), 비교가 빠지면 not-ready, 파일이 없으면 not-ready", () => {
  const src = readFileSync(new URL("../occ/send-guard.mjs", import.meta.url), "utf8");
  const ok = sendGuardOf(src, true);
  assert.equal(ok.status, "check");
  assert.match(ok.detail, /sha [0-9a-f]{8}/);
  assert.match(ok.detail, /node --test occ\/send-guard\.test\.mjs/);
  assert.match(ok.link ?? "", /occ\/send-guard\.test\.mjs$/);
  assert.match(sendGuardOf(src, false).detail, /테스트 파일 없음/);
  const noRecall = sendGuardOf(src.replaceAll("proposal.recallMessage", "proposal.x"), true);
  assert.equal(noRecall.status, "not-ready");
  assert.match(noRecall.detail, /RECALL 문구 비교/);
  assert.match(sendGuardOf(src.replaceAll("process.exit(2)", "process.exit(0)"), true).detail, /fail-closed/);
  assert.equal(sendGuardOf(null, false).status, "not-ready");
});

test("점검표: 항목 순서·상태, 게이트는 gateOf의 ready, 코드 사실이 빠지면 not-ready, 알려진 빈틈은 늘 check와 링크", () => {
  const gate = { decided: 12, agreement: 0.75, ready: false, target: { decided: 20, agreement: 0.8 } };
  const sendGuard = sendGuardOf(null, false);
  const vocado = vocadoReadbackOf(null, "/p");
  const r = readiness2bOf({ gate, recallMissing: [], standFreeMissing: [], sendGuard, vocado });
  assert.deepEqual(r.items.map((i) => i.id), ["gate", "recall", "send-guard", "vocado-readback", "stand-free", "known-gaps"]);
  assert.deepEqual(r.items.map((i) => i.status), ["not-ready", "ready", "not-ready", "check", "ready", "check"]);
  assert.equal(r.items[0].detail, "판정 12/20건 · 일치 75% (기준 80%)");
  assert.equal(r.items[5].link, KNOWN_GAPS_LINK);
  const ready = readiness2bOf({ gate: { ...gate, decided: 21, agreement: 0.9, ready: true }, recallMissing: ["POST …/recall"], standFreeMissing: [], sendGuard, vocado });
  assert.equal(ready.items[0].status, "ready");
  assert.deepEqual([ready.items[1].status, ready.items[1].detail], ["not-ready", "코드에서 확인 안 됨: POST …/recall"]);
});

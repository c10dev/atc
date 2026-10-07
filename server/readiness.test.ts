import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { airportReadbackOf, KNOWN_GAPS_LINK, readiness2bOf, sendGuardOf, VOCADO_READBACK_SUGGESTION, vocadoReadbackOf } from "./readiness.ts";

// vocado CLAUDE.md 66행(2026-09-27)과 같은 줄
const ATC_LINE = "- atc TOWER(관제 세션)에서 `[ATC C-xxxx]`로 시작하는 CLEARANCE를 받으면 리더가 그 메시지에 `READBACK C-xxxx`로 답한다. 따를 수 없거나 판단이 필요하면 READBACK 대신 이유를 답한다.";

// 2026-09-27 전의 vocado 제안 문장(CREW CHANGE 없음)
const DISPATCH_ONLY =
  "- atc OCC(운항관제 세션)에서 `[DISPATCH D-xxxx]`로 시작하는 FLIGHT PLAN을 받으면 리더가 그 메시지에 `READBACK D-xxxx`로 답하고, 맡지 못하면 READBACK 대신 이유를 답한다.";

test("vocado READBACK: [ATC C-xxxx] 줄만 있으면 not-ready와 추가할 문장, [DISPATCH]와 [OCC CC] 규칙이 다 있으면 ready, 파일이 없으면 check", () => {
  const today = ["# vocado", "병렬 작업:", ATC_LINE, ""].join("\n");
  const no = vocadoReadbackOf(today, "/p/CLAUDE.md");
  assert.equal(no.status, "not-ready");
  assert.match(no.detail, /^\/p\/CLAUDE\.md:3은 \[ATC C-xxxx\] → READBACK C-xxxx만 다룬다\. CAPTAIN이 FLIGHT PLAN·CREW CHANGE에 답할 규칙이 없음/);
  assert.match(no.detail, /추가할 문장: - atc OCC/);
  assert.equal(no.suggestion, VOCADO_READBACK_SUGGESTION);
  assert.match(VOCADO_READBACK_SUGGESTION, /`\[DISPATCH D-xxxx\]`로 시작하는 FLIGHT PLAN을 받으면 리더가 그 메시지에 `READBACK D-xxxx @xxxxxx`\(끝줄 그대로\)로 답하고, 맡지 못하면/);
  assert.match(VOCADO_READBACK_SUGGESTION, /`\[OCC CC-xxxx\]`로 시작하는 CREW CHANGE를 받으면 `READBACK CC-xxxx`로 답하고/);
  assert.ok(!VOCADO_READBACK_SUGGESTION.includes("\n")); // 한 줄
  // 제안 문장을 붙이면 ready가 된다
  const fixed = vocadoReadbackOf(`${today}${VOCADO_READBACK_SUGGESTION}\n`, "/p/CLAUDE.md");
  assert.equal(fixed.status, "ready");
  assert.match(fixed.detail, /:4 — \[DISPATCH D-xxxx\].*:4 — \[OCC CC-xxxx\] CREW CHANGE에 READBACK CC-xxxx/);
  assert.equal(fixed.suggestion, undefined);
  // FLIGHT PLAN 규칙만 있으면(예전 제안 문장) CREW CHANGE가 빠져 not-ready, 문장에 CC가 들어 있다
  const old = vocadoReadbackOf(`${today}${DISPATCH_ONLY}\n`, "/p/CLAUDE.md");
  assert.equal(old.status, "not-ready");
  assert.match(old.detail, /^\/p\/CLAUDE\.md:4은 \[DISPATCH D-xxxx\]만 다루고 \[OCC CC-xxxx\] → READBACK CC-xxxx가 없다\. CAPTAIN이 CREW CHANGE에 답할/);
  assert.match(old.suggestion ?? "", /READBACK CC-xxxx/);
  // 두 규칙이 서로 다른 줄에 있어도 된다
  const split = vocadoReadbackOf(`${DISPATCH_ONLY}\n- \`[OCC CC-xxxx]\`를 받으면 \`READBACK CC-xxxx\`로 답한다.\n`, "/p");
  assert.equal(split.status, "ready");
  assert.match(split.detail, /\/p:1 — .*\/p:2 — /);
  // 한 규칙이 두 줄에 흩어진 것은 규칙으로 보지 않는다
  assert.equal(vocadoReadbackOf("[DISPATCH D-xxxx]를 받으면\nREADBACK D-xxxx로", "/p").status, "not-ready");
  assert.equal(vocadoReadbackOf(`${DISPATCH_ONLY}\n[OCC CC-xxxx]를 받으면\nREADBACK CC-xxxx로`, "/p").status, "not-ready");
  assert.match(vocadoReadbackOf("# 없음", "/p").detail, /\/p에 READBACK 규칙이 없다/);
  assert.equal(vocadoReadbackOf(null, "/p").status, "check");
});

test("AIRPORT READBACK(vocado 밖): ready·not-ready·저장소 못 찾음(check)·파일 못 읽음(check)", () => {
  const today = ["# ATCC", "병렬 작업:", ""].join("\n");
  const notReady = airportReadbackOf(today, "/atc/CLAUDE.md", "ATCC");
  assert.equal(notReady.status, "not-ready");
  assert.equal(notReady.id, "readback-atcc");
  assert.equal(notReady.label, "ATCC READBACK 규칙");
  assert.match(notReady.detail, /\/atc\/CLAUDE\.md에 READBACK 규칙이 없다/);
  assert.equal(notReady.suggestion, VOCADO_READBACK_SUGGESTION);
  const ready = airportReadbackOf(`${today}${VOCADO_READBACK_SUGGESTION}\n`, "/atc/CLAUDE.md", "ATCC");
  assert.equal(ready.status, "ready");
  // 저장소를 등록부에서 못 찾음(path === null)
  const noRepo = airportReadbackOf(null, null, "XXXX");
  assert.equal(noRepo.status, "check");
  assert.equal(noRepo.id, "readback-xxxx");
  assert.match(noRepo.detail, /등록부에서 찾지 못함/);
  // 저장소는 있지만 CLAUDE.md를 못 읽음
  const noFile = airportReadbackOf(null, "/other/CLAUDE.md", "OTHR");
  assert.equal(noFile.status, "check");
  assert.match(noFile.detail, /\/other\/CLAUDE\.md을 읽지 못함 — 직접 확인$/);
});

test("atc AIRPORT READBACK: 이 저장소의 루트 CLAUDE.md가 airportReadbackOf를 ready로 통과한다", () => {
  const path = fileURLToPath(new URL("../CLAUDE.md", import.meta.url));
  const text = readFileSync(path, "utf8");
  const r = airportReadbackOf(text, path, "ATCC");
  assert.equal(r.status, "ready");
});

test("vocado READBACK: 지금 vocado CLAUDE.md가 있으면 not-ready로 읽힌다(읽기만)", (t) => {
  let text: string;
  try {
    text = readFileSync("/home/c10/projects/vocado_nextjs/CLAUDE.md", "utf8");
  } catch {
    return t.skip("vocado CLAUDE.md 없음");
  }
  if (/\[OCC CC-/.test(text)) return t.skip("이미 고쳐짐");
  assert.equal(vocadoReadbackOf(text, "x").status, "not-ready");
});

test("send-guard: 실제 파일은 check(테스트는 서버가 돌리지 않음), 비교가 빠지면 not-ready, 파일이 없으면 not-ready", () => {
  const src = readFileSync(new URL("../occ/send-guard.mjs", import.meta.url), "utf8");
  // 검사 규칙은 공유 모듈(ATC-562)에 있다. guard는 그 모듈을 가져오고 exit 2를 지킨다
  const shared = readFileSync(new URL("./send-checks.ts", import.meta.url), "utf8");
  const ok = sendGuardOf(src, true, shared);
  assert.equal(ok.status, "check");
  assert.match(ok.detail, /sha [0-9a-f]{8}/);
  assert.match(ok.detail, /node --test occ\/send-guard\.test\.mjs/);
  assert.match(ok.link ?? "", /occ\/send-guard\.test\.mjs$/);
  assert.match(sendGuardOf(src, false, shared).detail, /테스트 파일 없음/);
  const noRecall = sendGuardOf(src, true, shared.replaceAll("proposal.recallMessage", "proposal.x"));
  assert.equal(noRecall.status, "not-ready");
  assert.match(noRecall.detail, /RECALL 문구 비교/);
  assert.match(sendGuardOf(src.replaceAll("process.exit(2)", "process.exit(0)"), true, shared).detail, /fail-closed/);
  assert.match(ok.label, /CREW CHANGE/);
  const noCc = sendGuardOf(src, true, shared.replaceAll("change.message", "change.x"));
  assert.equal(noCc.status, "not-ready");
  assert.match(noCc.detail, /CREW CHANGE 문구 비교\(change\.message\)/);
  assert.match(sendGuardOf(src, true, shared.replaceAll("change.registration", "change.x")).detail, /CREW CHANGE 받는 사람/);
  assert.match(sendGuardOf(src.replace("../server/send-checks.ts", "./elsewhere.ts"), true, shared).detail, /공유 검사 모듈/);
  // 규칙이 guard에 없으니 guard만 보면 not-ready다(공유 모듈을 함께 읽어야 한다)
  assert.equal(sendGuardOf(src, true).status, "not-ready");
  assert.equal(sendGuardOf(null, false).status, "not-ready");
});

test("점검표: 항목 순서·상태(AIRPORT마다 한 줄), 게이트는 gateOf의 ready, 코드 사실이 빠지면 not-ready, 알려진 빈틈은 늘 check와 링크", () => {
  const gate = { decided: 12, agreement: 0.75, ready: false, target: { decided: 20, agreement: 0.8 } };
  const sendGuard = sendGuardOf(null, false);
  const vocado = vocadoReadbackOf(null, "/p");
  const atcc = airportReadbackOf("# ATCC", "/atc/CLAUDE.md", "ATCC");
  const readback = [vocado, atcc];
  const r = readiness2bOf({ gate, recallMissing: [], standFreeMissing: [], crewChangeMissing: [], sendGuard, readback });
  assert.deepEqual(r.items.map((i) => i.id), ["gate", "recall", "send-guard", "vocado-readback", "readback-atcc", "stand-free", "crew-change", "known-gaps"]);
  assert.deepEqual(r.items.map((i) => i.status), ["not-ready", "ready", "not-ready", "check", "not-ready", "ready", "ready", "check"]);
  assert.equal(r.items[0].detail, "판정 12/20건 · 일치 75% (기준 80%)");
  assert.equal(r.items[6].label, "CREW CHANGE 발부");
  assert.match(r.items[6].detail, /crew-change send\(sent\) → READBACK CC-xxxx\(acknowledged\)/);
  assert.equal(r.items[7].link, KNOWN_GAPS_LINK);
  const ready = readiness2bOf({
    gate: { ...gate, decided: 21, agreement: 0.9, ready: true },
    recallMissing: ["POST …/recall"],
    standFreeMissing: [],
    crewChangeMissing: ["atcctl crew-change send"],
    sendGuard,
    readback,
  });
  assert.equal(ready.items[0].status, "ready");
  assert.deepEqual([ready.items[1].status, ready.items[1].detail], ["not-ready", "코드에서 확인 안 됨: POST …/recall"]);
  assert.deepEqual([ready.items[6].status, ready.items[6].detail], ["not-ready", "코드에서 확인 안 됨: atcctl crew-change send"]);
});

test("루트 CLAUDE.md 교신 절은 VOCADO_READBACK_SUGGESTION과 같은 문장을 쓴다(ATC-122: UNABLE·STANDBY·ROGER까지)", () => {
  const md = readFileSync(new URL("../CLAUDE.md", import.meta.url), "utf8");
  assert.ok(md.split("\n").includes(VOCADO_READBACK_SUGGESTION));
  for (const w of ["UNABLE D-xxxx", "STANDBY D-xxxx", "UNABLE CC-xxxx", "ROGER C-xxxx"]) assert.ok(VOCADO_READBACK_SUGGESTION.includes(w), w);
});

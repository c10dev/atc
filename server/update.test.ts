import assert from "node:assert/strict";
import { test } from "node:test";
import type { RtsRecord } from "./mcc.ts";
import { loadPlanRts } from "./update-run.ts";
import { barKindOf, prsOfMessages, rangeRefusalOf, STARTING_MS, type UpdateInput, updateStateOf, type UpdateStatus } from "./update.ts";

const planRts = await loadPlanRts();
const NOW = Date.parse("2026-09-29T09:00:00Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const A = "c0ca22e" + "0".repeat(33);
const B = "4678e03" + "0".repeat(33);
const base: UpdateInput = { deployed: A, main: B, mainCi: "ok", due: { due: true, why: "c0ca22e → 4678e03" }, stop: null, last: null, lastStartAt: null, rangeRefusal: null, guard: null, now: NOW };
const rec = (result: RtsRecord["result"], minAgo: number, extra: Partial<RtsRecord> = {}): RtsRecord => ({ at: iso(minAgo), from: A, to: B, result, ...extra });
const kind = (x: Partial<UpdateInput>) => updateStateOf({ ...base, ...x }).kind;

test("PR 목록: merge 커밋은 본문 첫 줄이 제목, 스쿼시는 (#n)을 뗀다, 중복은 한 번", () => {
  const prs = prsOfMessages([
    "Merge pull request #161 from chaehy5665/claude/x\n\nRun CROSSCHECK on Claude Opus",
    "Run CROSSCHECK on Claude Opus (#161)",
    "Fix a bug (#7)",
    "wip commit",
    "Merge pull request #9 from a/b",
  ]);
  assert.deepEqual(prs, [
    { number: 161, title: "Run CROSSCHECK on Claude Opus" },
    { number: 7, title: "Fix a bug" },
    { number: 9, title: "Merge pull request #9 from a/b" },
  ]);
});

test("범위 거절: planRts 규칙 그대로 — package*.json, deploy/*.service·*.timer", () => {
  assert.equal(rangeRefusalOf(planRts, A, B, ["server/a.ts", "docs/mcc.md"]), null);
  assert.match(rangeRefusalOf(planRts, A, B, ["package-lock.json"])!, /사용자가 배포.*package-lock\.json/);
  assert.match(rangeRefusalOf(planRts, A, B, ["deploy/atc.service"])!, /daemon-reload/);
  assert.match(rangeRefusalOf(planRts, A, B, ["deploy/atc-rts.timer"])!, /사용자가 배포/);
  assert.equal(rangeRefusalOf(planRts, A, B, ["deploy/rts.mjs"]), null);
});

test("상태: 뒤처졌고 CI가 통과면 available, 같으면 current", () => {
  assert.equal(kind({}), "available");
  assert.equal(kind({ main: A }), "current");
  assert.equal(kind({ deployed: null }), "current");
});

test("상태: CI 진행 중·5분 간격은 waiting(버튼 없음), 범위 거절과 시험 서버는 manual", () => {
  assert.deepEqual(updateStateOf({ ...base, mainCi: "pending", due: { due: false, why: "기본 브랜치 CI 진행 중" } }), { kind: "waiting", why: "기본 브랜치 CI 진행 중" });
  assert.equal(kind({ due: { due: false, why: "지난 RTS에서 5분이 안 지남" } }), "waiting");
  assert.deepEqual(updateStateOf({ ...base, rangeRefusal: "사용자가 배포: package.json(의존성(npm ci 필요))" }).kind, "manual");
  assert.match(updateStateOf({ ...base, guard: "시험 서버" }).why, /시험/);
});

test("상태: 시작 직후는 starting, rts.jsonl이 running이면 running", () => {
  assert.equal(kind({ lastStartAt: iso(0.5) }), "starting");
  assert.equal(kind({ lastStartAt: iso(STARTING_MS / 60_000 + 1) }), "available"); // rts.jsonl에 아무것도 안 남고 오래됨
  assert.equal(kind({ lastStartAt: iso(1), last: rec("running", 0.5) }), "running");
});

test("상태: 이 시작이 거절·실패되면 사유를, 옛 거절은 무시", () => {
  const s = updateStateOf({ ...base, lastStartAt: iso(3), last: rec("refused", 2, { detail: "본 체크아웃에 커밋하지 않은 변경이 있음" }) });
  assert.deepEqual(s, { kind: "refused", why: "본 체크아웃에 커밋하지 않은 변경이 있음" });
  assert.equal(kind({ lastStartAt: iso(3), last: rec("failed", 2, { detail: "x" }) }), "failed");
  assert.equal(kind({ lastStartAt: iso(3), last: rec("refused", 30, { detail: "옛" }) }), "available"); // 시작보다 이전 기록
  assert.equal(kind({ lastStartAt: iso(10), last: rec("refused", 9, { to: "f".repeat(40) }) }), "available"); // 다른 main을 향한 거절
});

test("상태: ROLLBACK 뒤 멈춤은 다른 무엇보다 먼저 rollback, 사유는 풀이 방법", () => {
  const s = updateStateOf({ ...base, stop: "ROLLBACK 뒤 멈춤(2026-09-29T08:00:00Z) — SUPERVISOR가 설정 창에서 MCC 모드를 다시 고르면 풀림", last: rec("rollback", 60), rangeRefusal: "x" });
  assert.equal(s.kind, "rollback");
  assert.match(s.why, /설정 창/);
});

const st = (kind: UpdateStatus["kind"]): UpdateStatus => ({ kind, why: "", deployed: A, main: B, mainCi: "ok", prs: [], refusal: null, last: null, at: iso(0) });
const bar = (kind: UpdateStatus["kind"] | null, over: Partial<Parameters<typeof barKindOf>[0]> = {}) => barKindOf({ status: kind ? st(kind) : null, connection: "live", clicked: false, seenBusy: false, ...over });

test("막대: 상태를 그대로, current는 숨김, 누른 직후는 starting", () => {
  assert.equal(bar(null), null);
  assert.equal(bar("current"), null);
  assert.equal(bar("available"), "available");
  assert.equal(bar("available", { clicked: true }), "starting");
  assert.equal(bar("running"), "running");
  assert.equal(bar("rollback"), "rollback");
});

test("막대: RTS 중 연결이 끊기면 '재시작 중', 아닐 때 끊기면 그대로, 돌아와 최신이면 done", () => {
  assert.equal(bar("running", { connection: "lost" }), "restarting");
  assert.equal(bar("starting", { connection: "lost" }), "restarting");
  assert.equal(bar("available", { connection: "lost" }), "available");
  assert.equal(bar("current", { connection: "lost", seenBusy: true }), "restarting");
  assert.equal(bar("current", { seenBusy: true }), "done");
  assert.equal(bar(null, { connection: "lost", seenBusy: true }), "restarting");
});

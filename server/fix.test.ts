import assert from "node:assert/strict";
import { test } from "node:test";
import { criticalLinesOf, fixOf, fixTextOf, infoOf } from "./fix.ts";
import { responseOf } from "./response.ts";
import { CLEARANCE_TYPES } from "./clearances.ts";
import type { Clearance, LandingBlockCode, PullRequest, ReviewFindings } from "./model.ts";

const WT = "/home/c10/projects/worktrees";
const T0 = Date.parse("2026-10-01T02:46:00.000Z");
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();

const MCC_TEXT = "P1: server/x.ts:10 loses the reset case\nP2: nit one\nP2: nit two\nP2: nit three";
const mcc: ReviewFindings = { source: "mcc", by: "MCC INSPECTION", counts: [0, 1, 3], text: MCC_TEXT, from: null };

const pr = (over: Partial<PullRequest> = {}, findings: ReviewFindings | null = mcc, codes: LandingBlockCode[] = []): PullRequest => ({
  repo: "/r", number: 320, title: "t", url: "https://github.com/o/r/pull/320", branch: "claude/atc-257", head: "a090f16abcdef0", base: "main",
  ticketKey: "ATC-257", standPath: `${WT}/atc-257`, draft: false, landing: "APPROACH",
  blocks: [
    ...codes.map((code) => ({ code, text: code, en: code })),
    ...(findings ? [{ code: "review-findings" as const, text: "지적", en: "MCC INSPECTION findings (head a090f16)", findings }] : []),
  ],
  readyAt: null, createdAt: iso(-100), ...over,
});
const clr = (over: Partial<Clearance>): Clearance => ({
  id: "C-0001", at: iso(0), to: "s", toName: "TEAM_E", type: "FIX", stand: `${WT}/atc-257`, flight: "ATC-257", text: "FIX PR #320 … head a090f16",
  readbackAt: null, cancelledAt: null, ...over,
});
const ctx = (over: Partial<Parameters<typeof fixOf>[1]> = {}) => ({ clearances: [], holders: 1, now: T0 + 5 * 60_000, ...over });

test("FIX는 응답 속성 W/U인 CLEARANCE 종류다", () => {
  assert.ok(CLEARANCE_TYPES.includes("FIX"));
  assert.equal(responseOf("clearance", "FIX"), "W/U");
});

test("fixTextOf: P0·P1 줄은 자르지 않고, P2는 개수와 PR 주소, 끝에 head 표지", () => {
  const t = fixTextOf({ pr: 320, head: "a090f16abcdef0", flight: "ATC-257", url: "https://github.com/o/r/pull/320", findings: mcc, en: "" });
  assert.match(t, /^FIX PR #320 \(ATC-257\): MCC INSPECTION returned FINDINGS on head a090f16 \(P0 0 · P1 1 · P2 3\)\. P1: server\/x\.ts:10 loses the reset case\. 3 P2 findings/);
  assert.match(t, /3 P2 findings in the full text on the PR: https:\/\/github\.com\/o\/r\/pull\/320\./);
  assert.match(t, /READBACK, or UNABLE with the reason\. head a090f16$/);
  assert.doesNotMatch(t, /nit one/);
  // 400자를 넘는 P1 줄도 그대로
  const long = `P1: ${"x".repeat(900)}`;
  assert.ok(fixTextOf({ pr: 1, head: "abcdef0123", flight: null, url: "u", findings: { ...mcc, counts: [0, 1, 0], text: long }, en: "" }).includes(long));
  // 등급을 못 읽는 출처(Codex·이어받음)는 막힘 영어 문구를 그대로
  const codex: ReviewFindings = { source: "codex", by: null, counts: null, text: null, from: null };
  assert.match(fixTextOf({ pr: 7, head: "abcdef0123", flight: null, url: "u", findings: codex, en: "Codex findings on head abcdef0" }), /^FIX PR #7: Codex findings on head abcdef0\. .*Codex re-reviews the new head\..* head abcdef0$/);
});

test("criticalLinesOf: P0·P1 줄만, 형식이 다르면 본문 전체, 없으면 빈 목록", () => {
  assert.deepEqual(criticalLinesOf(MCC_TEXT, 0, 1), ["P1: server/x.ts:10 loses the reset case"]);
  assert.deepEqual(criticalLinesOf("see the review", 1, 0), ["see the review"]);
  assert.deepEqual(criticalLinesOf(MCC_TEXT, 0, 0), []);
  assert.deepEqual(criticalLinesOf(null, 1, 0), []);
});

test("fixOf: 상태에서 만든다(이벤트 없이도 send), head마다 한 번, 보낸 뒤 sent", () => {
  const a = fixOf(pr(), ctx())!;
  assert.deepEqual([a.source, a.action, a.why, a.clearance, a.head], ["mcc", "send", null, null, "a090f16"]);
  const sent = fixOf(pr(), ctx({ clearances: [clr({})] }))!;
  assert.deepEqual([sent.action, sent.clearance], ["sent", "C-0001"]);
  // 취소된 것, 다른 STAND, PR이 생기기 전 것은 세지 않는다
  assert.equal(fixOf(pr(), ctx({ clearances: [clr({ cancelledAt: iso(1) })] }))!.action, "send");
  assert.equal(fixOf(pr(), ctx({ clearances: [clr({ stand: `${WT}/atc-999`, flight: "ATC-999" })] }))!.action, "send");
  assert.equal(fixOf(pr(), ctx({ clearances: [clr({ at: iso(-200) })] }))!.action, "send");
  // 새 head에 지적이 있으면 새 FIX, 지적이 없으면 FIX 없음
  assert.equal(fixOf(pr({ head: "b111111abcdef0" }), ctx({ clearances: [clr({})] }))!.action, "send");
  assert.equal(fixOf(pr({ head: "b111111abcdef0" }, null, ["no-review"]), ctx({ clearances: [clr({})] })), null);
  // CLEARED(막힘 없음)나 지적 아닌 막힘만 있으면 없다
  assert.equal(fixOf(pr({ landing: "CLEARED", blocks: [] }), ctx()), null);
  assert.equal(fixOf(pr({}, null, ["checks-pending"]), ctx()), null);
});

test("fixOf: holder가 없으면 SUPERVISOR, 한 시간 안 세 번째 FIX도 SUPERVISOR", () => {
  const none = fixOf(pr(), ctx({ holders: 0 }))!;
  assert.deepEqual([none.action, none.why], ["supervisor", "no-holder"]);
  const two = [clr({ id: "C-0001", text: "head 1111111", at: iso(-30) }), clr({ id: "C-0002", text: "head 2222222", at: iso(-10) })];
  assert.equal(fixOf(pr(), ctx({ clearances: two }))!.action, "send");
  const three = [...two, clr({ id: "C-0003", text: "head 3333333", at: iso(-2) })];
  const rep = fixOf(pr(), ctx({ clearances: three }))!;
  assert.deepEqual([rep.action, rep.why, rep.clearance], ["supervisor", "repeat", "C-0003"]);
  assert.equal(fixOf(pr(), ctx({ clearances: three, now: T0 + 70 * 60_000 }))!.action, "send");
});

test("infoOf: 마지막 INFO 본문과 비교한다(서버 재시작과 상관없이), 지적만 있으면 INFO 없음", () => {
  const p = pr({}, null, ["no-review"]);
  const text = "PR #320 cannot land yet: no-review";
  assert.deepEqual(infoOf(p, text, { clearances: [], holders: 1 }), { text, action: "send", clearance: null });
  const info = clr({ id: "C-0009", type: "INFO", text });
  assert.deepEqual(infoOf(p, text, { clearances: [info], holders: 1 }), { text, action: "sent", clearance: "C-0009" });
  // 본문이 달라졌다(막힘이 바뀜) → 다시
  assert.equal(infoOf(p, `${text} · blocked`, { clearances: [info], holders: 1 })!.action, "send");
  // holder가 없으면 ATC LOG만
  assert.equal(infoOf(p, text, { clearances: [], holders: 0 })!.action, "log");
  // 알리지 않는 막힘만(체크 진행 등)이면 없다. 지적은 FIX 몫이라 INFO를 만들지 않는다
  assert.equal(infoOf(pr({}, null, ["checks-pending"]), "PR #320 cannot land yet: checks-pending", { clearances: [], holders: 1 }), null);
  assert.equal(infoOf(pr(), null, { clearances: [], holders: 1 }), null);
  assert.equal(infoOf(pr({ landing: "CLEARED", blocks: [] }), text, { clearances: [], holders: 1 }), null);
});

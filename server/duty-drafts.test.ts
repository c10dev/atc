import assert from "node:assert/strict";
import test from "node:test";
import { cardDraftOf, charterDraftOf, CHARTER_MAX, nextDraftId, NOTE_MAX, noteDraftOf } from "./duty-drafts.ts";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const ROWS = [
  { kind: "PROPOSAL", key: "D-0007", since: "2026-09-30T09:00:00.000Z", title: "ASSIGN ATC-9 → TEAM_A", hash: "#dispatch" },
  { kind: "LANDING", key: "r#12", since: null, title: "PR #12", hash: "#strips" },
] as const;

test("초안 번호: 있는 DD-n 다음, 없으면 DD-0001", () => {
  assert.equal(nextDraftId([]), "DD-0001");
  assert.equal(nextDraftId(["DD-0001", "DD-0009", "junk", "DD-0003"]), "DD-0010");
});

test("카드: 지금 큐에 있는 kind/key만 받고 줄에 큐 줄을 그대로 싣는다", () => {
  const r = cardDraftOf(ROWS, "proposal", "D-0007", "DD-0001", NOW);
  assert.ok(r.ok);
  assert.deepEqual(r.line, {
    id: "DD-0001",
    at: "2026-09-30T12:00:00.000Z",
    kind: "card",
    card: { queueKind: "PROPOSAL", key: "D-0007", title: "ASSIGN ATC-9 → TEAM_A", since: "2026-09-30T09:00:00.000Z", hash: "#dispatch" },
  });
});

test("카드: 큐에 없으면 사유와 함께 거절한다(다른 kind의 key도, 모르는 kind도)", () => {
  const no = cardDraftOf(ROWS, "PROPOSAL", "D-9999", "DD-0001", NOW);
  assert.ok(!no.ok);
  assert.match(no.error, /PROPOSAL\/D-9999 is not in the SUPERVISOR QUEUE now \(PROPOSAL rows: D-0007\)/);
  assert.ok(!cardDraftOf(ROWS, "LANDING", "D-0007", "DD-0001", NOW).ok);
  const kind = cardDraftOf(ROWS, "MERGE", "x", "DD-0001", NOW);
  assert.ok(!kind.ok);
  assert.match(kind.error, /unknown kind/);
  assert.ok(!cardDraftOf(ROWS, undefined, "x", "DD-0001", NOW).ok);
  assert.ok(!cardDraftOf([], "UPDATE", "u", "DD-0001", NOW).ok);
});

test("note: 글 1~1,000자, 제어 문자 없음, --until은 미래의 ISO 시각만", () => {
  const ok = noteDraftOf("  reject acct-1 proposals until 10-03  ", "2026-10-03T03:00:00Z", "DD-0002", NOW);
  assert.ok(ok.ok);
  assert.deepEqual(ok.line, { id: "DD-0002", at: "2026-09-30T12:00:00.000Z", kind: "note", text: "reject acct-1 proposals until 10-03", until: "2026-10-03T03:00:00.000Z" });
  const noUntil = noteDraftOf("rule", undefined, "DD-0003", NOW);
  assert.ok(noUntil.ok && noUntil.line.kind === "note" && noUntil.line.until === null);
  for (const bad of [undefined, "", "   ", "x".repeat(NOTE_MAX + 1), "a\u0000b", 5]) assert.ok(!noteDraftOf(bad, undefined, "DD-1", NOW).ok, String(bad));
  assert.ok(!noteDraftOf("r", "yesterday", "DD-1", NOW).ok);
  assert.ok(!noteDraftOf("r", "2026-09-01T00:00:00Z", "DD-1", NOW).ok, "지난 시각");
  assert.ok(noteDraftOf("한국어 규칙도 받는다", undefined, "DD-1", NOW).ok);
});

test("charter: 영어만(한글·가나·한자는 거절), 길이 상한, 제어 문자 없음", () => {
  const ok = charterDraftOf("Please run a survey of the fuel cache.", "DD-0004", NOW);
  assert.ok(ok.ok && ok.line.kind === "charter");
  for (const bad of ["한국어 요청", "日本語のリクエスト", "中文请求", "mixed 한글 text", "", "x".repeat(CHARTER_MAX + 1), "a\u0007b"]) assert.ok(!charterDraftOf(bad, "DD-1", NOW).ok, bad.slice(0, 12));
  assert.match((charterDraftOf("한국어", "DD-1", NOW) as { error: string }).error, /English/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { IMAGE_MAX_BYTES, imageCheck, logLineOf, pageOf, searchLog, SEARCH_CAP } from "./duty-log.ts";
import { idleMinOf, parseDutyConfig } from "./duty-config.ts";

test("logLineOf: 완성된 글·도구 줄·알림·턴 사용량만 적고, 조각·상태·init은 적지 않는다", () => {
  const t = "2026-09-30T00:00:00.000Z";
  assert.equal(logLineOf({ type: "text", text: "a", final: false }, t), null);
  assert.deepEqual(logLineOf({ type: "text", text: "a", final: true }, t), { t, kind: "text", text: "a" });
  assert.deepEqual(logLineOf({ type: "tool", id: "x", name: "Bash", summary: "s", error: true }, t), { t, kind: "tool", name: "Bash", summary: "s", error: true });
  assert.equal(logLineOf({ type: "state", state: "idle" }, t), null);
  assert.equal(logLineOf({ type: "usage", turn: null, rates: [] }, t), null);
  assert.equal(logLineOf({ type: "init", sessionId: null, model: null }, t), null);
});

test("pageOf: 뒤에서부터 쪽을 나누고 before로 앞쪽을 읽는다. 깨진 줄은 건너뛴다", () => {
  const line = (n: string) => JSON.stringify({ t: "t", kind: "text", text: n });
  const raw = [line("1"), line("2"), line("3"), "{bad", line("5")].join("\n") + "\n";
  const last = pageOf(raw, undefined, 2);
  assert.deepEqual(last.lines.map((l) => (l as { text?: string }).text), ["5"]);
  assert.equal(last.next, 3);
  const prev = pageOf(raw, last.next!, 2);
  assert.deepEqual(prev.lines.map((l) => [l.n, (l as { text?: string }).text]), [[1, "2"], [2, "3"]]);
  assert.equal(prev.next, 1);
  assert.deepEqual(pageOf(raw, 1, 2).lines.map((l) => (l as { text?: string }).text), ["1"]);
  assert.equal(pageOf(raw, 1, 2).next, null);
  assert.deepEqual(pageOf("", undefined), { lines: [], next: null });
});

test("imageCheck: PNG·JPEG·WebP만, base64만, 크기 상한", () => {
  assert.equal(imageCheck("image/png", "iVBORw0KGgo=").ok, true);
  assert.equal(imageCheck("image/webp", "AAAA").ok, true);
  assert.equal(imageCheck("image/gif", "AAAA").ok, false);
  assert.equal(imageCheck("image/png", "not base64!").ok, false);
  assert.equal(imageCheck("image/png", 5).ok, false);
  assert.equal(imageCheck("image/png", "A".repeat(Math.ceil(((IMAGE_MAX_BYTES + 10) * 4) / 3))).ok, false);
});

test("parseDutyConfig: 기본은 꺼짐·acct-2·30분, 이상한 값은 기본으로", () => {
  assert.deepEqual(parseDutyConfig(null), { enabled: false, account: "acct-2", idleMin: 30, briefMaxChars: 6000, briefDecisions: 20, charter: "off", l1: false, review: true, reviewEveryMin: 240, reviewIdleMin: 20, reviewLeakMin: 60, reviewGapMin: 30, reviewEmpty: true, reviewEmptyMin: 20, reviewEmptyGapMin: 60, reviewSkip: true });
  // REVIEW(ATC-396): 기본 켜짐(live first), false로만 끈다. 범위 밖 분은 기본으로
  assert.equal(parseDutyConfig({ review: false }).review, false);
  assert.equal(parseDutyConfig({ review: "no" }).review, true);
  assert.equal(parseDutyConfig({ reviewEveryMin: 5 }).reviewEveryMin, 240);
  assert.equal(parseDutyConfig({ reviewEveryMin: 90 }).reviewEveryMin, 90);
  assert.equal(parseDutyConfig({ enabled: "yes" }).enabled, false);
  assert.equal(parseDutyConfig({ enabled: true, account: "acct-1", idleMin: 1 }).account, "acct-1");
  assert.equal(parseDutyConfig({ account: "../x" }).account, "acct-2");
  assert.equal(idleMinOf(0), 30);
  assert.equal(idleMinOf(1.5), 30);
  assert.equal(idleMinOf(60), 60);
});

const L = (o: object) => JSON.stringify(o);
test("searchLog: 대소문자 무시, SUPERVISOR·DUTY 글·초안·카드를 찾고 줄 번호를 준다. 깨진 줄은 건너뛴다", () => {
  const raw = [
    L({ t: "2026-10-01T01:00:00Z", kind: "user", text: "Pause the Release for vocado" }),
    "{broken",
    L({ t: "2026-10-01T01:01:00Z", kind: "text", text: "OK, I will PAUSE it\nuntil Monday" }),
    L({ t: "2026-10-01T01:02:00Z", kind: "tool", name: "pause", summary: "pause" }),
    L({ t: "2026-10-01T01:03:00Z", kind: "draft", draftKind: "note", draft: "DD-7", text: "standing pause note", until: null }),
    L({ t: "2026-10-01T01:04:00Z", kind: "card", queueKind: "PAUSE-REVIEW", key: "PR-12", draft: "DD-8" }),
    "",
  ].join("\n");
  const r = searchLog(raw, "  pause ");
  assert.deepEqual(r.hits.map((h) => [h.n, h.kind]), [[5, "card"], [4, "draft"], [2, "text"], [0, "user"]], "최신부터, 도구 줄은 제외, 깨진 줄(1)은 건너뛴다");
  assert.equal(r.truncated, false);
  assert.match(r.hits[2]!.snippet, /PAUSE it until Monday/);
  assert.equal(searchLog(raw, "DD-7").hits[0]!.n, 4, "초안 id로 찾는다");
  assert.equal(searchLog(raw, "pr-12").hits[0]!.n, 5, "카드 키로 찾는다");
  assert.deepEqual(searchLog(raw, "nothing here"), { hits: [], truncated: false });
  assert.deepEqual(searchLog(raw, "p"), { hits: [], truncated: false }, "한 글자는 찾지 않는다");
  assert.deepEqual(searchLog("", "pause"), { hits: [], truncated: false });
});

test("searchLog: 결과 상한과 snippet 길이", () => {
  const raw = Array.from({ length: SEARCH_CAP + 5 }, (_, i) => L({ t: "t", kind: "text", text: `${"x".repeat(300)} needle ${i}` })).join("\n");
  const r = searchLog(raw, "needle");
  assert.equal(r.hits.length, SEARCH_CAP);
  assert.equal(r.truncated, true);
  assert.equal(r.hits[0]!.n, SEARCH_CAP + 4);
  assert.ok(r.hits[0]!.snippet.length < 200);
  assert.match(r.hits[0]!.snippet, /^…/);
  assert.equal(searchLog(raw, "needle", 1000).truncated, false);
});

test("pageOf: size로 한 번에 읽는 줄 수를 늘린다", () => {
  const raw = Array.from({ length: 10 }, (_, i) => L({ t: "t", kind: "text", text: String(i) })).join("\n");
  const p = pageOf(raw, 8, 5);
  assert.deepEqual(p.lines.map((l) => l.n), [3, 4, 5, 6, 7]);
  assert.equal(p.next, 3);
});

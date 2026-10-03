import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatItem } from "./duty-chat.ts";
import { chipText, decisionLog, keyOf, outcomeText, type StatusCtx, statusOf, waitingOf } from "./duty-card-status.ts";
import type { QueueItem } from "./supervisor-queue.ts";

const card = (id: string, queueKind: string, key: string, t = "2030-01-01T10:00:00Z"): ChatItem => ({ id, kind: "card", queueKind, key, draft: `d-${id}`, t });
const note = (id: string, draft: string, until: string | null = null, t = "2030-01-01T10:00:00Z"): ChatItem => ({ id, kind: "draft", draftKind: "note", draft, text: "x", until, t });
const q = (kind: string, key: string) => ({ kind, key }) as unknown as QueueItem;

const ctx = (over: Partial<StatusCtx> = {}): StatusCtx => ({
  items: [q("FLEET PLAN", "P-1"), q("UPDATE", "u")],
  handled: {},
  decisions: { active: [{ id: "S-1", at: "2030-01-01T11:30:00Z" }], confirmedDrafts: {}, dismissed: [] },
  charters: { charters: [] },
  nowMs: Date.parse("2030-01-01T12:00:00Z"),
  ...over,
});

test("큐에 있는 카드는 기다림, 큐에서 빠진 카드는 gone으로 처리됨", () => {
  assert.deepEqual(statusOf(card("1", "FLEET PLAN", "P-1") as never, ctx()), { state: "waiting" });
  assert.deepEqual(statusOf(card("2", "FLEET PLAN", "P-9") as never, ctx()), { state: "handled", outcome: "gone", at: null });
});

test("큐를 아직 못 읽었으면 기다림도 처리됨도 아니다", () => {
  const it = card("1", "FLEET PLAN", "P-1") as never;
  assert.equal(statusOf(it, ctx({ items: null })).state, "unknown");
  assert.deepEqual(waitingOf([card("1", "FLEET PLAN", "P-1")], ctx({ items: null })), []);
});

test("이 화면에서 누른 결정은 결과와 시각으로 처리됨(큐에 아직 있어도)", () => {
  const it = card("1", "FLEET PLAN", "P-1") as never;
  const s = statusOf(it, ctx({ handled: { "FLEET PLAN/P-1": { outcome: "승인", at: "2030-01-01T11:05:00Z" } } }));
  assert.deepEqual(s, { state: "handled", outcome: "승인", at: "2030-01-01T11:05:00Z" });
});

test("초안: 확정(결정 시각), 버림, until 경과, 기다림", () => {
  const n = (id: string) => note("n", id) as never;
  assert.equal(statusOf(n("a"), ctx()).state, "waiting");
  assert.deepEqual(statusOf(n("a"), ctx({ decisions: { active: [{ id: "S-1", at: "2030-01-01T11:30:00Z" }], confirmedDrafts: { a: "S-1" }, dismissed: [] } })), { state: "handled", outcome: "확정", at: "2030-01-01T11:30:00Z" });
  assert.deepEqual(statusOf(n("a"), ctx({ decisions: { active: [], confirmedDrafts: {}, dismissed: ["a"] } })), { state: "handled", outcome: "버림", at: null });
  assert.deepEqual(statusOf(note("n", "a", "2030-01-01T09:00:00Z") as never, ctx()), { state: "handled", outcome: "until 지남", at: "2030-01-01T09:00:00Z" });
  assert.equal(statusOf(n("a"), ctx({ decisions: null })).state, "unknown");
});

test("정해 둔 결정 목록 카드(retire)는 결정을 기다리는 카드가 아니다", () => {
  const r: ChatItem = { id: "r", kind: "draft", draftKind: "retire", draft: "x", text: "", until: null, t: "2030-01-01T10:00:00Z" };
  assert.equal(statusOf(r as never, ctx()).state, "none");
  assert.deepEqual(waitingOf([r], ctx()), []);
});

test("같은 카드가 두 번 나오면 가장 새 것 하나만 세고, 패널은 최신이 먼저", () => {
  const items = [card("1", "FLEET PLAN", "P-1"), card("2", "UPDATE", "u"), card("3", "FLEET PLAN", "P-1")];
  assert.deepEqual(waitingOf(items, ctx()).map((x) => x.id), ["3", "2"]);
});

test("결정 기록은 처리된 카드만, 처리 시각이 늦은 것이 먼저", () => {
  const items = [card("1", "FLEET PLAN", "P-1"), card("2", "UPDATE", "u", "2030-01-01T08:00:00Z"), card("3", "GO", "g", "2030-01-01T09:00:00Z"), note("4", "a")];
  const c = ctx({ handled: { "FLEET PLAN/P-1": { outcome: "동의", at: "2030-01-01T11:50:00Z" } }, items: [q("UPDATE", "u")] });
  const log = decisionLog(items, c);
  assert.deepEqual(log.map((e) => [e.id, e.outcome]), [["1", "동의"], ["3", "gone"]]);
  assert.deepEqual(waitingOf(items, c).map((x) => x.id), ["4", "2"]);
});

test("서랍의 결정 n과 화면 패널은 같은 함수라 같은 수다", () => {
  const items = [card("1", "FLEET PLAN", "P-1"), card("2", "UPDATE", "u"), card("3", "GO", "g"), note("4", "a")];
  assert.equal(waitingOf(items, ctx()).length, 3);
});

test("chip 글: 기다림은 패널을 가리키고 처리됨은 결과와 시각", () => {
  const it = card("1", "FLEET PLAN", "P-1") as never;
  assert.equal(chipText(it, { state: "waiting" }), "FLEET PLAN P-1 → 오른쪽 패널");
  assert.equal(chipText(it, { state: "handled", outcome: "승인", at: "2030-01-01T14:05:09Z" }), "FLEET PLAN P-1 · 승인 · 14:05Z");
  assert.equal(chipText(it, { state: "handled", outcome: "gone", at: null }), "FLEET PLAN P-1 · gone");
  assert.equal(outcomeText("버림", "시각 아님"), "버림");
  assert.equal(keyOf(note("n", "a") as never), "note/a");
});

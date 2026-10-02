import assert from "node:assert/strict";
import { test } from "node:test";
import { actionsOf, cardKey, cardViewOf, prOfKey, queueHeadOf } from "./duty-card.ts";
import { chatFromHistory, emptyChat, foldDuty } from "./duty-chat.ts";
import { QUEUE_KINDS, type QueueItem } from "./supervisor-queue.ts";

const AIRPORTS = [{ name: "atc", code: "ATCC", repo: "/home/c10/projects/atc" }];
const row = (kind: QueueItem["kind"], key: string): QueueItem => ({ kind, key, since: "2026-09-30T00:00:00.000Z", title: `${kind} ${key}`, hash: "#x" });
const t = "2026-09-30T00:00:00.000Z";

test("인라인 버튼은 FLEET PLAN·UPDATE·PROPOSAL(승인·거절, ATC-377)뿐이고, 나머지는 링크다(GO도 링크)", () => {
  for (const kind of QUEUE_KINDS) {
    const a = actionsOf({ kind, key: "atc#7@abc" }, AIRPORTS);
    const inline = a.some((x) => x.type === "inline");
    assert.equal(inline, kind === "FLEET PLAN" || kind === "UPDATE" || kind === "PROPOSAL", kind);
    assert.ok(a.length >= 1);
  }
  assert.deepEqual(actionsOf({ kind: "GO", key: "P-1" }, AIRPORTS), [{ type: "link", label: "AIRCRAFT 보기(FLEET)", hash: "#fleet" }]);
});

test("링크 주소: SCHEDULE·HUMAN CHECK는 탭, LANDING은 PR 서랍(AIRPORT 코드), NEEDS YOU는 FLEET", () => {
  const hash = (kind: QueueItem["kind"], key: string) => (actionsOf({ kind, key }, AIRPORTS)[0] as { hash: string }).hash;
  assert.equal(hash("SCHEDULE", "S-1"), "#schedule");
  assert.equal(hash("HUMAN CHECK", "atc#7@abc"), "#strips");
  assert.equal(hash("LANDING", "atc#7@abc"), "#pr/ATCC/7");
  assert.equal(hash("NEEDS YOU", "sess"), "#fleet");
  // 저장소를 모르면 STRIPS로
  assert.equal(hash("LANDING", "other#9@abc"), "#strips");
  assert.equal(hash("LANDING", "garbage"), "#strips");
});

test("prOfKey", () => {
  assert.deepEqual(prOfKey("atc#7@abc"), { repo: "atc", number: 7 });
  assert.equal(prOfKey("nope"), null);
});

test("카드 보기: 큐에 있으면 live, 없으면 큐에서 빠짐, 눌러서 받아들여졌으면 처리됨, 큐를 못 읽었으면 unknown", () => {
  const items = [row("FLEET PLAN", "FP-1"), row("UPDATE", "abc1234")];
  const live = cardViewOf({ queueKind: "FLEET PLAN", key: "FP-1" }, items, false, AIRPORTS);
  assert.equal(live.state, "live");
  assert.equal(live.state === "live" && live.item.key, "FP-1");
  assert.deepEqual(cardViewOf({ queueKind: "FLEET PLAN", key: "FP-2" }, items, false, AIRPORTS), { state: "gone", reason: "큐에서 빠짐" });
  assert.deepEqual(cardViewOf({ queueKind: "FLEET PLAN", key: "FP-1" }, items, true, AIRPORTS), { state: "gone", reason: "처리됨" });
  assert.deepEqual(cardViewOf({ queueKind: "FLEET PLAN", key: "FP-1" }, null, false, AIRPORTS), { state: "unknown" });
  // kind가 다르면 같은 key여도 다른 줄
  assert.equal(cardViewOf({ queueKind: "UPDATE", key: "FP-1" }, items, false, AIRPORTS).state, "gone");
});

test("QUEUE 머리: 0인 kind는 뺀다", () => {
  assert.equal(queueHeadOf({ PROPOSAL: 1, SCHEDULE: 0, "FLEET PLAN": 2, UPDATE: 0 }, 3), "QUEUE 3 · PROPOSAL 1 · FLEET PLAN 2");
  assert.equal(queueHeadOf({}, 0), "QUEUE 0");
  assert.equal(cardKey({ queueKind: "GO", key: "P-1" }), "GO/P-1");
});

test("카드와 초안은 글과 같은 길로 대화의 그 자리에 들어가고, 기록에서도 같은 자리에 온다", () => {
  const live = [
    { type: "user", text: "q", t },
    { type: "text", text: "before", final: true, t },
    { type: "card", queueKind: "FLEET PLAN", key: "FP-1", draft: "DD-0001", t },
    { type: "text", text: "between", final: true, t },
    { type: "card", queueKind: "PROPOSAL", key: "P-1", draft: "DD-0002", t },
    { type: "draft", draftKind: "note", draft: "DD-0003", text: "a rule", until: null, t },
  ] as const;
  const c = live.reduce((acc, e) => foldDuty(acc, e), emptyChat());
  assert.deepEqual(c.items.map((i) => i.kind), ["user", "text", "card", "text", "card", "draft"]);
  const h = chatFromHistory([
    { t, kind: "user", text: "q" },
    { t, kind: "text", text: "before" },
    { t, kind: "card", queueKind: "FLEET PLAN", key: "FP-1", draft: "DD-0001" },
    { t, kind: "text", text: "between" },
    { t, kind: "card", queueKind: "PROPOSAL", key: "P-1", draft: "DD-0002" },
    { t, kind: "draft", draftKind: "note", draft: "DD-0003", text: "a rule", until: null },
  ]);
  assert.deepEqual(h.items.map((i) => i.kind), c.items.map((i) => i.kind));
  const card = h.items[2]!;
  assert.ok(card.kind === "card" && card.queueKind === "FLEET PLAN" && card.key === "FP-1" && card.draft === "DD-0001");
});

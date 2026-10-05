import assert from "node:assert/strict";
import { test } from "node:test";
import { ageShort, type GroupSpec, groupItems } from "../web/src/kit/todo-group.ts";

// kit 묶음 계산(ATC-504): 같은 종류·같은 필요만, 둘 이상일 때만, 첫 줄 자리에 한 줄로
interface R {
  id: string;
  kind: string;
  need: string;
  tone?: GroupSpec["tone"];
  age?: number | null;
}
const spec = (r: R): GroupSpec => ({ kind: r.kind, need: r.need, tone: r.tone ?? null, ageMin: r.age ?? null });
const r = (id: string, kind: string, need: string, over: Partial<R> = {}): R => ({ id, kind, need, ...over });

test("같은 종류·같은 필요 둘 이상은 첫 항목 자리에 한 줄, 하나뿐인 줄은 그대로", () => {
  const lines = groupItems([r("a", "READY", "발권 필요"), r("b", "TODO", "발권 필요"), r("c", "READY", "발권 필요"), r("d", "READY", "우선순위 먼저")], spec);
  assert.deepEqual(lines.map((l) => (l.type === "group" ? `${l.kind}×${l.count}` : l.item.id)), ["READY×2", "b", "d"]);
  const g = lines[0];
  assert.equal(g.type === "group" && g.items.map((i) => i.id).join(), "a,c");
});

test("필요가 다르면 같은 종류여도 묶이지 않는다", () => {
  const lines = groupItems([r("a", "READY", "x"), r("b", "READY", "y")], spec);
  assert.deepEqual(lines.map((l) => l.type), ["item", "item"]);
});

test("묶음의 톤은 가장 센 것, 최장 나이는 가장 큰 값(없으면 null)", () => {
  const [g] = groupItems([r("a", "K", "n", { tone: "caution", age: 5 }), r("b", "K", "n", { tone: "warning", age: 90 }), r("c", "K", "n")], spec);
  assert.ok(g.type === "group");
  assert.equal(g.tone, "warning");
  assert.equal(g.oldestMin, 90);
  const [h] = groupItems([r("a", "K", "n"), r("b", "K", "n")], spec);
  assert.ok(h.type === "group");
  assert.equal(h.oldestMin, null);
  assert.equal(h.tone, null);
});

test("ageShort는 가장 큰 단위 하나", () => {
  assert.deepEqual([0, 45, 60, 1440].map(ageShort), ["0m", "45m", "1h", "1d"]);
});

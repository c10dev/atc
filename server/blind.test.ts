import assert from "node:assert/strict";
import { test } from "node:test";
import { BLIND_EVERY, blindStatsOf, hashId, isBlind } from "./blind.ts";

test("isBlind: 제안 id 해시로 약 1/5, 같은 id는 늘 같은 답(대소문자 무관)", () => {
  const ids = Array.from({ length: 1000 }, (_, i) => `D-${String(i + 1).padStart(4, "0")}`);
  const rate = ids.filter(isBlind).length / ids.length;
  assert.ok(rate > 0.15 && rate < 0.25, `rate ${rate}`);
  for (const id of ids.slice(0, 50)) assert.equal(isBlind(id), isBlind(id.toLowerCase()));
  assert.equal(isBlind("D-0001"), hashId("D-0001") % BLIND_EVERY === 0);
  assert.equal(hashId("D-0001"), hashId("D-0001"));
});

test("blindStatsOf: 게이트가 센 판정 중 blind인 것만, agreed·approved를 동의로", () => {
  const decided = [
    { status: "agreed", blind: true as const },
    { status: "disagreed", blind: true as const },
    { status: "approved", blind: true as const },
    { status: "agreed" },
    { status: "disagreed" },
  ];
  assert.deepEqual(blindStatsOf(decided), { decided: 3, agreed: 2, agreement: 2 / 3 });
  assert.deepEqual(blindStatsOf([{ status: "agreed" }]), { decided: 0, agreed: 0, agreement: null });
});

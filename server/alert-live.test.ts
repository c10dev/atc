import assert from "node:assert/strict";
import { test } from "node:test";
import { announceCount, announceNew, liveKey, type LiveAlert } from "../web/src/alert-live.ts";

const a = (key: string, level: LiveAlert["level"], text = key): LiveAlert => ({ key, level, text });

test("첫 목록(prev 없음)은 읽지 않는다", () => {
  assert.deepEqual(announceNew(null, [a("x", "warning")]), { polite: "", assertive: "" });
});

test("지난번에 있던 경보는 폴링마다 다시 읽지 않는다", () => {
  assert.deepEqual(announceNew(new Set(["x"]), [a("x", "warning")]), { polite: "", assertive: "" });
});

test("WARNING은 assertive, CAUTION은 polite, ADVISORY는 읽지 않는다", () => {
  const r = announceNew(new Set(), [a("w", "warning", "겹침"), a("c", "caution", "오래됨"), a("v", "advisory", "참고")]);
  assert.equal(r.assertive, "새 경보 1건: 겹침");
  assert.equal(r.polite, "새 경보 1건: 오래됨");
});

test("셋을 넘으면 나머지는 건수로", () => {
  const r = announceNew(new Set(), ["1", "2", "3", "4", "5"].map((k) => a(k, "caution")));
  assert.equal(r.polite, "새 경보 5건: 1; 2; 3 외 2건");
});

test("liveKey는 같은 경보에 같은 값", () => {
  const x = { kind: "conflict", sessionIds: ["s1", "s2"], workspacePath: "/w" };
  assert.equal(liveKey(x), liveKey({ ...x }));
  assert.notEqual(liveKey(x), liveKey({ ...x, kind: "orphan" }));
});

test("atc 알림 수는 늘었을 때만 읽는다", () => {
  assert.equal(announceCount(null, 3), "");
  assert.equal(announceCount(3, 3), "");
  assert.equal(announceCount(3, 1), "");
  assert.equal(announceCount(1, 3), "atc 알림 3건, 2건 늘었음");
});

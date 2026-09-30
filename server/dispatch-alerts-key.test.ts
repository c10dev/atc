import assert from "node:assert/strict";
import { test } from "node:test";
import { proposalAlertKey } from "../web/src/dispatch-alerts.ts";

const k = (...keys: string[]) => keys.map((key) => ({ key }));

test("제안 알림 키: 순서와 상관없이 같은 집합이면 같은 키", () => {
  assert.equal(proposalAlertKey(k("pending|proposal|D-0002", "pending|proposal|D-0001")), proposalAlertKey(k("pending|proposal|D-0001", "pending|proposal|D-0002")));
});

test("제안 알림 키: pending|proposal| 밖의 알림은 무시한다", () => {
  const base = k("pending|proposal|D-0001");
  assert.equal(proposalAlertKey([...base, ...k("pending|schedule|S-1", "nordo|abc", "pending|proposalX|D-9")]), proposalAlertKey(base));
});

test("제안 알림 키: 제안이 생기거나 사라지면 바뀐다", () => {
  const one = proposalAlertKey(k("pending|proposal|D-0001"));
  assert.notEqual(one, proposalAlertKey(k("pending|proposal|D-0001", "pending|proposal|D-0002")));
  assert.notEqual(one, proposalAlertKey([]));
  assert.equal(proposalAlertKey([]), "");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalAccount, holdAccountOf } from "./account-key.ts";

const HOME = "/h/.claude";
const registered = [
  { label: "acct-1", dir: "/h/a1", registered: true },
  { label: "acct-2", dir: HOME, registered: true },
];
const unregistered = [
  { label: "acct-1", dir: "/h/a1", registered: true },
  { label: "default", dir: HOME, registered: false },
];

test("canonicalAccount: default는 ~/.claude를 가리키는 등록 항목과 같은 ACCOUNT", () => {
  assert.equal(canonicalAccount("default", registered, HOME), "acct-2");
  assert.equal(canonicalAccount("acct-2", registered, HOME), "acct-2");
  assert.equal(canonicalAccount("acct-1", registered, HOME), "acct-1");
});

test("canonicalAccount: 등록 항목이 없으면 default 그대로, 모르는 라벨과 빈 목록도 그대로", () => {
  assert.equal(canonicalAccount("default", unregistered, HOME), "default");
  assert.equal(canonicalAccount("zzz", registered, HOME), "zzz");
  assert.equal(canonicalAccount("default", [], HOME), "default");
});

test("holdAccountOf: 관찰한 ACCOUNT가 먼저, 없으면 home, 라벨을 쓰지 않는 등록부는 null", () => {
  const fleet = { defaults: {}, aircraft: { TEAM_A: { account: "acct-1" } } } as never;
  assert.equal(holdAccountOf(fleet, { name: "TEAM_A", account: "default" }, registered, HOME), "acct-2");
  assert.equal(holdAccountOf(fleet, { name: "TEAM_A" }, registered, HOME), "acct-1");
  assert.equal(holdAccountOf({ defaults: {}, aircraft: {} } as never, { name: "TEAM_A", account: "acct-1" }, registered, HOME), null);
});

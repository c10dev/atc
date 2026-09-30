import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccountFolder } from "./accounts.ts";
import { canResumeOn, dutyAccountPatchOf, effectiveDutyFolder } from "./duty-account.ts";

const folders: AccountFolder[] = [
  { label: "acct-2", dir: "/h/.claude-acct-2", registered: true },
  { label: "acct-3", dir: "/h/.claude-acct-3", registered: true },
  { label: "default", dir: "/h/.claude", registered: false },
];

test("등록된 라벨만 받는다: 등록됨 / 모르는 라벨 / 빈 값 / 문자열 아님", () => {
  const reg = ["acct-2", "acct-3"];
  assert.deepEqual(dutyAccountPatchOf("acct-3", reg), { ok: true, label: "acct-3" });
  assert.deepEqual(dutyAccountPatchOf(" acct-2 ", reg), { ok: true, label: "acct-2" });
  for (const bad of ["acct-9", "", "  ", null, 3]) assert.equal(dutyAccountPatchOf(bad, reg).ok, false);
  assert.match((dutyAccountPatchOf("x", reg) as { error: string }).error, /등록: acct-2, acct-3/);
  assert.equal(dutyAccountPatchOf("acct-2", []).ok, false, "등록부가 비면 고를 것이 없다");
});

test("등록부에 없는 라벨은 ~/.claude로 돌아가고 경고한다", () => {
  assert.equal(effectiveDutyFolder("acct-3", folders, "/h/.claude").folder?.dir, "/h/.claude-acct-3");
  assert.equal(effectiveDutyFolder("acct-3", folders, "/h/.claude").warning, null);
  const gone = effectiveDutyFolder("acct-9", folders, "/h/.claude");
  assert.equal(gone.folder?.label, "default");
  assert.match(gone.warning ?? "", /acct-9.*등록부에 없음/);
  assert.equal(effectiveDutyFolder("acct-9", folders.slice(0, 2), "/h/.claude").folder, null);
});

test("--resume은 저장된 대화가 지금 ACCOUNT에서 시작됐을 때만(옛 파일은 예전처럼 이어 간다)", () => {
  assert.ok(canResumeOn("acct-2", "acct-2"));
  assert.ok(canResumeOn(null, "acct-2"));
  assert.ok(!canResumeOn("acct-2", "acct-3"));
});

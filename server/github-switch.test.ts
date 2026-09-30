import assert from "node:assert/strict";
import { test } from "node:test";
import { GITHUB_OFF_REASON, githubStartupWarning, githubSwitchOf } from "./github-switch.ts";

test("기본은 켜짐", () => {
  assert.deepEqual(githubSwitchOf({}), { enabled: true, reason: null });
  assert.deepEqual(githubSwitchOf({ ATC_GITHUB: "" }), { enabled: true, reason: null });
  assert.deepEqual(githubSwitchOf({ ATC_GITHUB: "on" }), { enabled: true, reason: null });
});

test("off 계열 값은 사유와 함께 꺼짐", () => {
  for (const v of ["off", "OFF", " off ", "0", "false", "no"]) assert.deepEqual(githubSwitchOf({ ATC_GITHUB: v }), { enabled: false, reason: GITHUB_OFF_REASON });
});

test("시작 경고: 운영 폴더가 아니고 GitHub가 켜졌을 때만", () => {
  const prod = "/home/x/.local/state/atc";
  assert.match(githubStartupWarning({ enabled: true, stateDir: "/tmp/t", prodStateDir: prod })!, /test server polling GitHub with the SUPERVISOR's token/);
  assert.equal(githubStartupWarning({ enabled: false, stateDir: "/tmp/t", prodStateDir: prod }), null);
  assert.equal(githubStartupWarning({ enabled: true, stateDir: prod + "/", prodStateDir: prod }), null);
});

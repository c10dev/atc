import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { type Denial, hookCommandOf, pendingAircraftOf, policySettingsOf, summarizeDenials } from "./policy-hook.ts";
import { launchPlanOf } from "./session-control.ts";

test("settings: one PermissionRequest command hook carrying state dir and aircraft, quoted", () => {
  const j = JSON.parse(policySettingsOf("TEAM_H", "/var/atc state", "/opt/atc's/hooks/policy.mjs"));
  const h = j.hooks.PermissionRequest[0].hooks[0];
  assert.equal(h.type, "command");
  assert.equal(h.command, hookCommandOf("TEAM_H", "/var/atc state", "/opt/atc's/hooks/policy.mjs"));
  assert.match(h.command, /^node '\/opt\/atc'\\''s\/hooks\/policy\.mjs' --state '\/var\/atc state' --aircraft 'TEAM_H'$/);
  assert.deepEqual(Object.keys(j), ["hooks"]); // 허용 목록·모드를 건드리지 않는다
  assert.deepEqual(Object.keys(j.hooks), ["PermissionRequest"]);
});

test("launchPlanOf: --settings rides before the briefing only when given", () => {
  const input = { registration: "TEAM_H", retired: false, repo: "/r", briefing: "BRIEF" };
  const plain = launchPlanOf(input, []);
  assert.ok(!plain.args.includes("--settings"));
  const withPolicy = launchPlanOf({ ...input, policySettings: policySettingsOf("TEAM_H", "/s") }, []);
  const i = withPolicy.args.indexOf("--settings");
  assert.ok(i > 0);
  assert.equal(withPolicy.args.at(-1), "BRIEF");
  assert.equal(withPolicy.args[i + 2], "BRIEF");
  assert.deepEqual([...withPolicy.args.slice(0, i), ...withPolicy.args.slice(i + 2)], plain.args);
});

test("every AIRCRAFT LAUNCH goes through launchAircraft, which always passes the policy hook", () => {
  const src = readFileSync(new URL("./session-control.ts", import.meta.url), "utf8");
  const calls = [...src.matchAll(/launchPlanOf\(\{/g)];
  assert.equal(calls.length, 1);
  assert.match(src, /launchPlanOf\(\{[^\n]*policySettings: policySettingsOf\(reg\)/);
  // 팀 세션을 `claude --bg`로 띄우는 인자는 launchPlanOf 한 곳(관제 세션은 controlLaunchPlanOf)
  assert.equal([...src.matchAll(/\["--bg", "-n", reg/g)].length, 1);
});

test("summary: window, classes, aircraft", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  const at = (h: number) => new Date(now - h * 3_600_000).toISOString();
  const d = (h: number, cls: string, aircraft: string | null = "TEAM_H"): Denial => ({ t: at(h), aircraft, session: "s", tool: "Write", cls });
  const s = summarizeDenials([d(1, "claude-config"), d(2, "claude-config", "TEAM_K"), d(3, "rm:outside-stand"), d(30, "mcp"), { t: "bad", aircraft: null, session: null, tool: null, cls: "x" }], now);
  assert.equal(s.total, 3);
  assert.deepEqual(s.byClass, [{ cls: "claude-config", n: 2 }, { cls: "rm:outside-stand", n: 1 }]);
  assert.deepEqual(s.byAircraft, [{ aircraft: "TEAM_H", n: 2 }, { aircraft: "TEAM_K", n: 1 }]);
  assert.equal(s.lastAt, at(1));
  assert.deepEqual(summarizeDenials([], now), { windowH: 24, total: 0, byClass: [], byAircraft: [], lastAt: null });
});

test("pending: live team sessions in PENDING only", () => {
  const sessions = [
    { name: "TEAM_B", status: "busy", health: { code: "PENDING" } },
    { name: "TEAM_A", status: "busy", health: { code: "HUNG" } },
    { name: "TEAM_C", status: "dead", health: { code: "PENDING" } },
    { name: "TOWER", status: "busy", health: { code: "PENDING" } },
  ];
  assert.deepEqual(pendingAircraftOf(sessions, "^TEAM_"), ["TEAM_B"]);
});

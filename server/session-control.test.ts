import assert from "node:assert/strict";
import { test } from "node:test";
import { type AgentRow, ControlError, jobIdOf, launchPlanOf, stopTargetOf } from "./session-control.ts";

const base = { registration: "team_k", retired: false, repo: "/home/u/projects/app", briefing: "[ATC FLEET] CREW BRIEFING · KILO (TEAM_K)" };
const bg = (name: string, id = "abc12345"): AgentRow => ({ id, sessionId: `${id}-x`, name, kind: "background", status: "idle", cwd: "/w" });
const ui = (name: string): AgentRow => ({ sessionId: "s-1", name, kind: "interactive", status: "idle", cwd: "/w" });

const refused = (fn: () => unknown, status: number, re: RegExp) =>
  assert.throws(fn, (e: unknown) => e instanceof ControlError && e.status === status && re.test(e.message));

test("launchPlanOf: 이름·권한 모드·브리핑으로 claude --bg 인자를 만든다", () => {
  const p = launchPlanOf(base, [bg("TEAM_H")]);
  assert.equal(p.registration, "TEAM_K");
  assert.equal(p.cwd, "/home/u/projects/app");
  assert.equal(p.permissionMode, "auto");
  assert.deepEqual(p.args, ["--bg", "-n", "TEAM_K", "--permission-mode", "auto", base.briefing]);
});

test("launchPlanOf: 모델과 권한 모드를 고를 수 있다", () => {
  const p = launchPlanOf({ ...base, permissionMode: "acceptEdits", model: " opus " }, []);
  assert.deepEqual(p.args.slice(3, 7), ["--permission-mode", "acceptEdits", "--model", "opus"]);
  assert.equal(p.model, "opus");
});

test("launchPlanOf: bypassPermissions와 이상한 모델 이름은 거절", () => {
  refused(() => launchPlanOf({ ...base, permissionMode: "bypassPermissions" }, []), 400, /permission mode/);
  refused(() => launchPlanOf({ ...base, model: "opus --dangerously-skip-permissions" }, []), 400, /모델/);
});

test("launchPlanOf: 같은 이름 세션이 있으면(대소문자 무시) 띄우지 않는다", () => {
  refused(() => launchPlanOf(base, [ui("team_k")]), 409, /이미 떠 있음\(interactive\)/);
  refused(() => launchPlanOf(base, [bg("TEAM_K", "ff00ff00")]), 409, /bg ff00ff00/);
});

test("launchPlanOf: RETIRED, base 없음, 상한을 막는다", () => {
  refused(() => launchPlanOf({ ...base, retired: true }, []), 409, /RETIRED/);
  refused(() => launchPlanOf({ ...base, repo: null }, []), 409, /base AIRPORT/);
  refused(() => launchPlanOf(base, [bg("A", "a1a1a1"), bg("B", "b2b2b2")], 2), 409, /상한 2/);
  // 상한은 백그라운드 세션만 센다
  assert.equal(launchPlanOf(base, [ui("X"), ui("Y")], 2).registration, "TEAM_K");
});

test("stopTargetOf: 백그라운드 세션만 멈춘다", () => {
  assert.equal(stopTargetOf("team_k", [bg("TEAM_K", "12345678")]).id, "12345678");
  refused(() => stopTargetOf("TEAM_K", [ui("TEAM_K")]), 409, /데스크톱·터미널/);
  refused(() => stopTargetOf("TEAM_K", []), 404, /떠 있지 않음/);
});

test("jobIdOf: claude --bg 출력에서 id를 읽는다", () => {
  assert.equal(jobIdOf("Starting background service…\nbackgrounded · efbbe208 · TEAM_K\n  claude agents"), "efbbe208");
  assert.equal(jobIdOf("Workspace not trusted."), null);
});

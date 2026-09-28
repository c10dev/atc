import assert from "node:assert/strict";
import { test } from "node:test";
import { type AgentRow, CONTROL_SESSIONS, ControlError, controlDirOf, controlLaunchPlanOf, controlRowsOf, controlSpecOf, controlStopTargetOf, inServiceCgroup, isControlRow, launchCommandOf, parentPidOf, tmuxPaneOf, jobIdOf, launchPlanOf, MANUAL_CONTROL, stopTargetOf } from "./session-control.ts";

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

// ── 관제 세션(8.5.1) ──
const MCC = controlSpecOf("mcc")!;
const DIR = "/home/u/projects/atc/mcc";
const row = (over: Partial<AgentRow>): AgentRow => ({ sessionId: "s", kind: "interactive", status: "idle", cwd: "/elsewhere", ...over });

test("관제 세션 목록: TOWER·OCC·MCC만 atc가 띄운다. REVIEW·CROSSCHECK는 ocx라 tmux로", () => {
  assert.deepEqual(CONTROL_SESSIONS.map((c) => `${c.name} ${c.dir} ${c.prompt} ${c.flags.join(" ")}`.trim()), [
    "TOWER controller /loop 3m /tick",
    "OCC occ /loop 10m /tick",
    "MCC mcc /loop 5m /tick --strict-mcp-config",
  ]);
  assert.deepEqual([...MANUAL_CONTROL], ["REVIEW", "CROSSCHECK"]);
  assert.equal(controlSpecOf("review"), null);
  assert.match(controlDirOf(MCC), /\/mcc$/);
});

test("관제 LAUNCH: 권한 모드 auto, 폴더에서, 첫 메시지는 주기 명령. 같은 이름이나 같은 폴더의 세션이 있으면 거절", () => {
  assert.deepEqual(controlLaunchPlanOf(MCC, [row({ name: "TEAM_B", cwd: "/w" })], DIR), {
    cwd: DIR,
    args: ["--bg", "-n", "MCC", "--permission-mode", "auto", "--strict-mcp-config", "/loop 5m /tick"],
  });
  refused(() => controlLaunchPlanOf(MCC, [row({ name: "mcc", kind: "background", id: "0fd590e9" })], DIR), 409, /bg 0fd590e9/);
  // tmux로 이름 없이 띄운 세션도 폴더로 알아본다
  refused(() => controlLaunchPlanOf(MCC, [row({ name: "mcc-b4", cwd: DIR })], DIR), 409, /interactive mcc-b4/);
});

test("관제 STOP: 백그라운드면 claude stop, tmux pane에서 돌면 그 pane, 데스크톱은 409, 없으면 404", () => {
  const bgRow = row({ name: "MCC", kind: "background", id: "abc12345", cwd: DIR });
  assert.deepEqual(controlStopTargetOf(MCC, [bgRow], DIR), { how: "background", row: bgRow });
  refused(() => controlStopTargetOf(MCC, [], DIR), 404, /떠 있지 않음/);
  const tmuxRow = row({ name: "mcc-b4", cwd: DIR, pid: 2055218 });
  const pane = { session: "atc-mcc", pane: "%4", pid: 2055218 };
  assert.deepEqual(controlStopTargetOf(MCC, [tmuxRow], DIR, (r) => (r.pid === 2055218 ? pane : null)), { how: "tmux", row: tmuxRow, pane });
  refused(() => controlStopTargetOf(MCC, [row({ name: "MCC", cwd: DIR, pid: 77 })], DIR, () => null), 409, /데스크톱/);
  assert.equal(controlRowsOf(MCC, [row({ name: "TOWER" }), row({ name: "x", cwd: DIR })], DIR).length, 1);
});

test("tmux pane 찾기: pid 자신이나 조상이 pane의 첫 프로세스일 때만", () => {
  const panes = [{ session: "atc-tower", pane: "%0", pid: 100 }, { session: "atc-mcc", pane: "%4", pid: 200 }];
  const parents: Record<number, number> = { 201: 200, 202: 201, 300: 1 };
  const parentOf = (p: number) => parents[p] ?? null;
  assert.equal(tmuxPaneOf(100, panes, parentOf)?.session, "atc-tower");
  assert.equal(tmuxPaneOf(202, panes, parentOf)?.pane, "%4"); // 쉘로 감싼 claude
  assert.equal(tmuxPaneOf(300, panes, parentOf), null);
  assert.equal(tmuxPaneOf(undefined, panes, parentOf), null);
});

test("부모 pid: /proc/<pid>/stat에서 읽는다", () => {
  assert.equal(parentPidOf(process.pid), process.ppid);
  assert.equal(parentPidOf(999_999_999), null);
});

test("팀 세션 상한은 관제 세션을 세지 않는다", () => {
  const dirs = [DIR];
  assert.equal(isControlRow(row({ name: "TOWER", kind: "background", id: "1" }), dirs), true);
  assert.equal(isControlRow(row({ name: "mcc-b4", cwd: DIR }), dirs), true);
  assert.equal(isControlRow(row({ name: "TEAM_K", kind: "background", id: "2", cwd: "/w" }), dirs), false);
});

test("LAUNCH는 systemd scope에서: claude --bg가 띄우는 daemon이 atc.service 밖에 있게. scope가 없으면 바로", () => {
  assert.deepEqual(launchCommandOf("/b/claude", ["--bg", "-n", "MCC"], "/usr/bin/systemd-run", "atc-claude-1"), {
    cmd: "/usr/bin/systemd-run",
    args: ["--user", "--scope", "--collect", "--quiet", "--unit=atc-claude-1", "--", "/b/claude", "--bg", "-n", "MCC"],
  });
  assert.deepEqual(launchCommandOf("/b/claude", ["agents"], null, "x"), { cmd: "/b/claude", args: ["agents"] });
});

test("daemon이 atc 서비스 cgroup 안에 있나", () => {
  assert.equal(inServiceCgroup(["0::/user.slice/user-1000.slice/user@1000.service/app.slice/atc.service"]), true);
  assert.equal(inServiceCgroup(["0::/user.slice/user-1000.slice/user@1000.service/app.slice/atc-claude-1.scope"]), false);
  assert.equal(inServiceCgroup(["0::/user.slice/user-1000.slice/user@1000.service/app.slice/atc-rts.service"]), false);
  assert.equal(inServiceCgroup([]), false);
});

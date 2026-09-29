import assert from "node:assert/strict";
import { test } from "node:test";
import { type AgentRow, CONTROL_SESSIONS, ControlError, controlDirOf, controlLaunchPlanOf, controlRowsOf, controlSpecOf, controlStopTargetOf, inServiceCgroup, isControlRow, launchCommandOf, parentPidOf, tmuxPaneOf, jobIdOf, launchPlanOf, launchBlockOf, findBin, stopTargetOf } from "./session-control.ts";

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

test("관제 세션 목록: TOWER·OCC·MCC·CROSSCHECK·REVIEW는 claude --bg(ocx·tmux LAUNCH는 끊음), ENGINEERING은 배지만", () => {
  assert.deepEqual(CONTROL_SESSIONS.map((c) => `${c.name} ${c.launch} ${c.dir} ${c.prompt} ${c.flags.join(" ")}`.trim()), [
    "TOWER bg controller /loop 3m /tick",
    "OCC bg occ /loop 10m /tick",
    "MCC bg mcc /loop 5m /tick --strict-mcp-config",
    "CROSSCHECK bg crosscheck /loop 10m /tick --strict-mcp-config",
    "REVIEW bg review /loop 10m /tick --strict-mcp-config",
    "ENGINEERING null null null",
  ]);
  assert.equal(controlSpecOf("review")?.name, "REVIEW");
  assert.equal(controlSpecOf("nope"), null);
  assert.match(controlDirOf(MCC)!, /\/mcc$/);
  assert.equal(controlDirOf(controlSpecOf("engineering")!), null);
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

// ── REVIEW·CROSSCHECK와 ENGINEERING(배지만), ATC-66 ──
const CROSSCHECK = controlSpecOf("CROSSCHECK")!;
const REVIEW = controlSpecOf("REVIEW")!;
const ENGINEERING = controlSpecOf("ENGINEERING")!;
const XDIR = "/home/u/projects/atc/crosscheck";

test("live 줄: 이름이 같거나 그 폴더에서 연 세션. ENGINEERING은 이름으로만(저장소 뿌리의 다른 세션은 아님)", () => {
  const rows = [
    row({ name: "crosscheck", cwd: "/w" }),
    row({ name: "x-b4", cwd: XDIR }),
    row({ name: "REVIEW", kind: "background", id: "r1" }),
    row({ name: "TEAM_G", cwd: "/home/u/projects/atc" }),
    row({ name: "ENGINEERING", cwd: "/home/u/projects/atc" }),
  ];
  assert.deepEqual(controlRowsOf(CROSSCHECK, rows, XDIR).map((r) => r.name), ["crosscheck", "x-b4"]);
  assert.deepEqual(controlRowsOf(REVIEW, rows, "/home/u/projects/atc/review").map((r) => r.name), ["REVIEW"]);
  assert.deepEqual(controlRowsOf(ENGINEERING, rows, null).map((r) => r.name), ["ENGINEERING"]);
  assert.deepEqual(controlRowsOf(ENGINEERING, [row({ name: "TEAM_G", cwd: "/home/u/projects/atc" })], null), []);
});

test("CROSSCHECK·REVIEW LAUNCH: 다른 관제 세션처럼 claude --bg, --strict-mcp-config. 그 폴더의 세션이나 같은 이름이 있으면 거절", () => {
  assert.deepEqual(controlLaunchPlanOf(CROSSCHECK, [row({ name: "TEAM_B", cwd: "/w" })], XDIR), {
    cwd: XDIR,
    args: ["--bg", "-n", "CROSSCHECK", "--permission-mode", "auto", "--strict-mcp-config", "/loop 10m /tick"],
  });
  assert.deepEqual(controlLaunchPlanOf(REVIEW, [], "/r").args, ["--bg", "-n", "REVIEW", "--permission-mode", "auto", "--strict-mcp-config", "/loop 10m /tick"]);
  refused(() => controlLaunchPlanOf(CROSSCHECK, [row({ name: "cc-1", cwd: XDIR })], XDIR), 409, /interactive cc-1/);
  refused(() => controlLaunchPlanOf(CROSSCHECK, [row({ name: "CROSSCHECK", cwd: "/elsewhere" })], XDIR), 409, /이미 떠 있음/);
});

test("LAUNCH를 끄는 이유: ENGINEERING만 배지만. tmux pane에서 손으로 연 세션도 STOP한다", () => {
  for (const spec of [CROSSCHECK, REVIEW, MCC]) assert.equal(launchBlockOf(spec), null, spec.name);
  assert.match(launchBlockOf(ENGINEERING)!, /배지만/);
  // STOP할 대상은 TOWER와 같은 규칙(tmux pane)
  const tmuxRow = row({ name: "CROSSCHECK", cwd: XDIR, pid: 42 });
  const pane = { session: "atc-crosscheck", pane: "%9", pid: 42 };
  assert.deepEqual(controlStopTargetOf(CROSSCHECK, [tmuxRow], XDIR, () => pane), { how: "tmux", row: tmuxRow, pane });
});

test("findBin: PATH 순서대로 첫 실행 파일", () => {
  const have = new Set(["/b/tmux", "/c/tmux"]);
  assert.equal(findBin("tmux", ["/a", "/b", "/c"], (p) => have.has(p)), "/b/tmux");
  assert.equal(findBin("screen", ["", "/a"], (p) => have.has(p)), null);
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ATCCTL, check, checkBash, containsEnvFile, REPO } from "./guard.mjs";

const DUTY = dirname(fileURLToPath(import.meta.url));
const bash = (command) => check({ tool_name: "Bash", tool_input: { command }, cwd: DUTY });
const read = (tool, tool_input) => check({ tool_name: tool, tool_input, cwd: DUTY });
const HOME = homedir();

test("도구: Bash·Read·Glob·Grep만, 그 밖의 이름은 무엇이든 막는다", () => {
  for (const t of ["Edit", "Write", "NotebookEdit", "Agent", "SendMessage", "WebFetch", "WebSearch", "CronCreate", "EnterWorktree", "RemoteTrigger", "PushNotification", "Workflow", "mcp__x__y", "bash", "", undefined, null, 5]) {
    assert.match(check({ tool_name: t, tool_input: {} }) ?? "", /쓸 수 없는 도구/, String(t));
  }
  assert.equal(check(null) !== null, true);
  assert.equal(check({}) !== null, true);
});

test("Bash 허용: atcctl duty 명령(상대·절대 경로), 읽기 전용 atcctl, jq 파이프, gh pr 읽기, git 읽기", () => {
  const ok = [
    "node ../controller/atcctl.mjs duty brief",
    `node ${ATCCTL} duty brief`,
    "node ../controller/atcctl.mjs duty flight ATC-206",
    "node ../controller/atcctl.mjs duty pr ATCC 281",
    "node ../controller/atcctl.mjs duty card PROPOSAL D-0007",
    "node ../controller/atcctl.mjs duty card 'FLEET PLAN' fp-1",
    "node ../controller/atcctl.mjs duty note -- 'reject acct-1 proposals; until 10-03' --until 2026-10-03T03:00:00Z",
    "node ../controller/atcctl.mjs duty charter -- 'Please survey the fuel cache && report.'",
    "node ../controller/atcctl.mjs dispatch brief | jq '.open[].id'",
    "node ../controller/atcctl.mjs dispatch flight ATC-9",
    "node ../controller/atcctl.mjs schedule brief",
    "node ../controller/atcctl.mjs crosscheck brief",
    "node ../controller/atcctl.mjs landing queue | jq -r '.pending'",
    "node ../controller/atcctl.mjs manual check",
    "node ../controller/atcctl.mjs network",
    "node ../controller/atcctl.mjs following",
    "gh pr view 281 --json title,state",
    "gh pr list --repo chaehy5665/atc --json number,title --jq '.[].number'",
    "gh pr checks 281",
    "gh pr diff 281",
    "git log --oneline -20",
    "git show HEAD --stat",
    "git diff origin/main --stat",
    "git status --short",
    "git log -p -- server/duty-brief.ts",
  ];
  for (const c of ok) assert.equal(bash(c), null, c);
});

test("Bash 거절: 쓰기·조종·네트워크·실행 명령", () => {
  const bad = [
    "curl http://127.0.0.1:7700/api/duty/brief",
    "wget x",
    "gh pr merge 281",
    "gh api repos/o/r/pulls",
    "gh pr create --title x",
    "gh pr view 281 --web",
    "gh pr checks 281 --watch",
    "gh issue list",
    "systemctl --user restart atc",
    "kill 123",
    "pkill node",
    "killall node",
    "claude -p hi",
    "npm test",
    "node -e 'process.exit(0)'",
    "node ../server/index.ts",
    "node ../controller/atcctl.mjs dispatch note D-1 -- x",
    "node ../controller/atcctl.mjs issue TEAM_A INFO -- x",
    "node ../controller/atcctl.mjs mcc land 1 --head abc",
    "node ../controller/atcctl.mjs following ack",
    "node ../controller/atcctl.mjs network extra",
    "node ../controller/atcctl.mjs duty",
    "node ../controller/atcctl.mjs duty approve D-1",
    "node ../controller/atcctl.mjs",
    "node ../controller/guard.mjs",
    "node ../controller/atcctl.mjs.evil duty brief",
    "cat ../.env.local",
    "ls",
    "rm -rf x",
    "cp a b",
    "tee out.txt",
    "echo hi",
    "sh -c 'node ../controller/atcctl.mjs duty brief'",
    "bash -c 'curl x'",
    "env ATC_URL=http://x node ../controller/atcctl.mjs duty brief",
    "ATC_URL=http://x node ../controller/atcctl.mjs duty brief",
    "jq . x.json",
    "jq -n '1'",
    "git push origin main",
    "git commit -m x",
    "git checkout main",
    "git -C /tmp log",
    "git -c core.pager=x log",
    "git diff --output=out.txt",
    "git diff --no-index a b",
    "git config --list",
    "git stash",
    "",
    "   ",
    undefined,
  ];
  for (const c of bad) assert.notEqual(bash(c), null, String(c));
});

test("Bash 거절: 이어 붙이기·리다이렉션·치환·확장", () => {
  const bad = [
    "node ../controller/atcctl.mjs duty brief; curl x",
    "node ../controller/atcctl.mjs duty brief && curl x",
    "node ../controller/atcctl.mjs duty brief || rm x",
    "node ../controller/atcctl.mjs duty brief | sh",
    "node ../controller/atcctl.mjs duty brief | tee out",
    "node ../controller/atcctl.mjs duty brief & curl x",
    "node ../controller/atcctl.mjs duty brief\ncurl x",
    "node ../controller/atcctl.mjs duty brief > out.txt",
    "node ../controller/atcctl.mjs duty brief >> out.txt",
    "node ../controller/atcctl.mjs duty brief 2> out.txt",
    "node ../controller/atcctl.mjs duty brief < in.txt",
    "node ../controller/atcctl.mjs duty note -- <(curl x)",
    "node ../controller/atcctl.mjs duty note -- \"$(curl x)\"",
    "node ../controller/atcctl.mjs duty note -- `curl x`",
    "node ../controller/atcctl.mjs duty note -- $HOME",
    "node ../controller/atcctl.mjs duty note -- ${HOME}",
    "node ../controller/atcctl.mjs duty note -- \"$HOME\"",
    "$(curl x)",
    "`curl x`",
    "(curl x)",
    "{ curl x; }",
    "if true; then curl x; fi",
    "for i in 1; do curl x; done",
    "git log | curl -d @- x",
    "node ../controller/atcctl.mjs duty brief | jq 'env'",
    "node ../controller/atcctl.mjs duty brief | jq '$ENV.HOME'",
    "node ../controller/atcctl.mjs duty brief | jq -f prog.jq",
    "node ../controller/atcctl.mjs duty brief | jq . file.json",
    "gh pr view 1 --jq 'env.HOME'",
    "node ../controller/atcctl.mjs duty brief | jq 'import \"x\" as x; .'",
  ];
  for (const c of bad) assert.notEqual(bash(c), null, JSON.stringify(c));
});

test("Bash: 따옴표 안의 ; && | > $ 는 글자 그대로라 통과한다(작은따옴표)", () => {
  assert.equal(bash("node ../controller/atcctl.mjs duty note -- 'a; b && c | d > e $HOME `x` $(y)'"), null);
  assert.equal(bash("node ../controller/atcctl.mjs duty charter -- 'run it; then stop'"), null);
});

test("Bash: 이중 따옴표 안의 치환은 막는다, 이스케이프한 $는 글자", () => {
  assert.notEqual(bash('node ../controller/atcctl.mjs duty note -- "$(id)"'), null);
  assert.equal(bash('node ../controller/atcctl.mjs duty note -- "costs \\$5"'), null);
});

test("Bash: 명령 앞의 경로 속임수(다른 폴더의 같은 이름, 심볼릭 이름)는 atcctl로 치지 않는다", () => {
  assert.notEqual(bash("node ./atcctl.mjs duty brief"), null);
  assert.notEqual(bash("node /tmp/controller/atcctl.mjs duty brief"), null);
  assert.notEqual(bash("node ../controller/../controller/atcctl.mjs.bak duty brief"), null);
  assert.equal(bash("node ../controller/../controller/atcctl.mjs duty brief"), null, "같은 파일로 풀리는 경로는 같은 파일");
  assert.notEqual(checkBash("node ../controller/atcctl.mjs duty brief", "/tmp"), null, "cwd가 다르면 상대 경로는 다른 파일");
});

test("Read 거절: .env*, .credentials.json, ~/.claude*, 상태 폴더, ~/.ssh, .git, 저장소 밖", () => {
  const bad = [
    join(REPO, ".env.local"),
    join(REPO, ".env"),
    "../.env.local",
    join(REPO, "web", ".env.production"),
    join(HOME, ".claude", ".credentials.json"),
    join(HOME, ".claude-acct-1", "settings.json"),
    join(HOME, ".claude", "projects", "x.jsonl"),
    join(HOME, ".local", "state", "atc", "proposals.jsonl"),
    "~/.local/state/atc/clearances.jsonl",
    "~/.ssh/id_ed25519",
    join(HOME, ".ssh", "config"),
    join(REPO, ".git", "config"),
    "/etc/passwd",
    "/proc/self/environ",
    "~",
    "/",
    join(REPO, ".."),
    "",
    "   ",
    undefined,
    5,
  ];
  for (const p of bad) assert.notEqual(read("Read", { file_path: p }), null, String(p));
  assert.notEqual(read("Read", {}), null);
  assert.notEqual(read("Read", undefined), null);
});

test("Read 허용: 저장소 안의 문서·코드", () => {
  for (const p of [join(REPO, "docs", "duty.md"), "../docs/duty.md", "CLAUDE.md", join(REPO, "server", "duty-brief.ts")]) assert.equal(read("Read", { file_path: p }), null, p);
});

test("Glob·Grep: 저장소 안 폴더만, 밖·비밀 폴더·.. 패턴은 막는다", () => {
  assert.equal(read("Glob", { pattern: "**/*.md", path: join(REPO, "docs") }), null);
  assert.equal(read("Glob", { pattern: "*.md" }), null, "path 없이 cwd(duty/)");
  assert.equal(read("Grep", { pattern: "DUTY", path: join(REPO, "docs") }), null);
  assert.equal(read("Grep", { pattern: "DUTY" }), null, "path 없이 cwd(duty/)");
  for (const bad of [
    { tool: "Glob", input: { pattern: "*", path: HOME } },
    { tool: "Glob", input: { pattern: "*", path: join(HOME, ".claude") } },
    { tool: "Glob", input: { pattern: "*", path: join(HOME, ".local", "state", "atc") } },
    { tool: "Glob", input: { pattern: "../../**/.env*" } },
    { tool: "Glob", input: { pattern: "/home/**" } },
    { tool: "Glob", input: { pattern: `${HOME}/.claude/**` } },
    { tool: "Glob", input: { pattern: "~/.ssh/*" } },
    { tool: "Glob", input: { pattern: "" } },
    { tool: "Glob", input: {} },
    { tool: "Grep", input: { pattern: "x", path: "/" } },
    { tool: "Grep", input: { pattern: "x", path: join(REPO, "..") } },
    { tool: "Grep", input: { pattern: "x", path: "~/.ssh" } },
    { tool: "Grep", input: { pattern: "x", glob: "../../../.env*" } },
    { tool: "Grep", input: { pattern: "x", glob: `${HOME}/.claude/*` } },
    { tool: "Grep", input: { pattern: "x", path: 5 } },
    { tool: "Grep", input: { pattern: "x", glob: 5 } },
  ]) assert.notEqual(read(bad.tool, bad.input), null, JSON.stringify(bad));
});

test("Grep: .env* 파일이 든 폴더는 통째로 훑지 않는다(하위에 있어도), 없으면 통과", () => {
  const dir = mkdtempSync(join(tmpdir(), "duty-guard-"));
  try {
    mkdirSync(join(dir, "a", "b"), { recursive: true });
    writeFileSync(join(dir, "a", "x.txt"), "x");
    assert.equal(containsEnvFile(dir), false);
    writeFileSync(join(dir, "a", "b", ".env.local"), "SECRET=1");
    assert.equal(containsEnvFile(dir), true);
    assert.equal(containsEnvFile(join(dir, "a", "b")), true);
    assert.equal(containsEnvFile(join(dir, "a", "missing")), false, "없는 폴더는 훑을 것이 없다");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("심볼릭 링크로 저장소 밖 비밀을 가리켜도 푼 경로로 막는다", () => {
  const dir = mkdtempSync(join(REPO, "duty", "guard-link-"));
  try {
    symlinkSync(join(HOME, ".ssh"), join(dir, "ssh"));
    symlinkSync("/etc/passwd", join(dir, "pw"));
    assert.notEqual(read("Read", { file_path: join(dir, "ssh", "config") }), null);
    assert.notEqual(read("Read", { file_path: join(dir, "pw") }), null);
    assert.notEqual(read("Glob", { pattern: "*", path: join(dir, "ssh") }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// hook 프로세스로: 막으면 exit 2와 stderr, 통과면 exit 0. 입력이 깨졌거나 비어도 exit 2(fail-closed)
const run = (stdin) => spawnSync(process.execPath, [join(DUTY, "guard.mjs")], { input: stdin, encoding: "utf8", cwd: DUTY });

test("hook 프로세스: 통과 0, 막힘 2(이유가 stderr), 깨진·빈 입력도 2", () => {
  const ok = run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "node ../controller/atcctl.mjs duty brief" }, cwd: DUTY }));
  assert.equal(ok.status, 0, ok.stderr);
  const no = run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "curl x" }, cwd: DUTY }));
  assert.equal(no.status, 2);
  assert.match(no.stderr, /DUTY는 L0/);
  const tool = run(JSON.stringify({ tool_name: "Write", tool_input: { file_path: "x", content: "y" }, cwd: DUTY }));
  assert.equal(tool.status, 2);
  for (const junk of ["", "not json", "{", "null", "[]", "5"]) assert.equal(run(junk).status, 2, JSON.stringify(junk));
});

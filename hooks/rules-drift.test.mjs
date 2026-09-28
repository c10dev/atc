import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cleanup, contextOf, MAX_DIFF_LINES, parseArgs, readRecord, run, statusOf, unifiedDiff } from "./rules-drift.mjs";

const SCRIPT = new URL("./rules-drift.mjs", import.meta.url).pathname;

function sandbox() {
  const base = mkdtempSync(join(tmpdir(), "atc-rules-"));
  const root = join(base, "repo");
  const dir = join(base, "state", "rules-ack");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "CLAUDE.md"), "# 규칙\n\n- 하나\n- 둘\n");
  writeFileSync(join(root, "AGENTS.md"), "# agents\n");
  return { base, root, dir, done: () => rmSync(base, { recursive: true, force: true }) };
}
const args = (mode, root, extra = []) => parseArgs([mode, "--root", root, ...extra]);
const input = (event, extra = {}) => ({ session_id: "sess-1", cwd: "/nowhere", hook_event_name: event, transcript_path: "/must/not/read", ...extra });

test("변경 없음 → 출력 없음", () => {
  const s = sandbox();
  try {
    assert.equal(run(args("start", s.root), input("SessionStart", { source: "startup" }), { dir: s.dir }), null);
    assert.equal(run(args("check", s.root), input("UserPromptSubmit"), { dir: s.dir }), null);
    assert.equal(run(args("check", s.root), input("PostToolUse"), { dir: s.dir, now: Date.now() + 60_000 }), null);
  } finally {
    s.done();
  }
});

test("변경 → diff를 한 번 주고 확인됨. 다음 check는 조용하다", () => {
  const s = sandbox();
  try {
    run(args("start", s.root), input("SessionStart", { source: "startup" }), { dir: s.dir });
    writeFileSync(join(s.root, "CLAUDE.md"), "# 규칙\n\n- 하나\n- 둘(고침)\n- 셋\n");
    const out = JSON.parse(run(args("check", s.root), input("UserPromptSubmit"), { dir: s.dir }));
    assert.equal(out.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    const ctx = out.hookSpecificOutput.additionalContext;
    assert.match(ctx, /이 세션이 시작된 뒤 규칙 파일이 바뀌었다: CLAUDE\.md\./);
    assert.match(ctx, /--- a\/CLAUDE\.md\n\+\+\+ b\/CLAUDE\.md\n@@ -1,4 \+1,5 @@/);
    assert.match(ctx, /\n-- 둘\n\+- 둘\(고침\)\n\+- 셋/);
    assert.ok(!/AGENTS/.test(ctx));
    assert.equal(run(args("check", s.root), input("UserPromptSubmit"), { dir: s.dir }), null);
    // PostToolUse에도 같은 모양(이벤트 이름만 다름). 30초 안에는 다시 보지 않는다
    writeFileSync(join(s.root, "AGENTS.md"), "# agents\n- 새 규칙\n");
    assert.equal(run(args("check", s.root), input("PostToolUse"), { dir: s.dir }), null);
    const later = JSON.parse(run(args("check", s.root), input("PostToolUse"), { dir: s.dir, now: Date.now() + 31_000 }));
    assert.equal(later.hookSpecificOutput.hookEventName, "PostToolUse");
    assert.match(later.hookSpecificOutput.additionalContext, /\+- 새 규칙/);
  } finally {
    s.done();
  }
});

test("새 세션은 지금 해시에서 시작한다(시작 전 변경은 알리지 않음). resume은 기준을 그대로 둔다", () => {
  const s = sandbox();
  try {
    writeFileSync(join(s.root, "CLAUDE.md"), "# 규칙 v2\n");
    run(args("start", s.root), input("SessionStart", { session_id: "sess-2", source: "startup" }), { dir: s.dir });
    assert.equal(run(args("check", s.root), input("UserPromptSubmit", { session_id: "sess-2" }), { dir: s.dir }), null);
    // resume: 그 사이 바뀐 것은 다음 check에서 알린다
    writeFileSync(join(s.root, "CLAUDE.md"), "# 규칙 v3\n");
    run(args("start", s.root), input("SessionStart", { session_id: "sess-2", source: "resume" }), { dir: s.dir });
    assert.match(run(args("check", s.root), input("UserPromptSubmit", { session_id: "sess-2" }), { dir: s.dir }), /v3/);
    // start 없이 처음 보는 세션(도중에 hook을 넣음): 지금을 기준으로, 말하지 않는다
    assert.equal(run(args("check", s.root), input("UserPromptSubmit", { session_id: "sess-3" }), { dir: s.dir }), null);
    assert.ok(readRecord(s.dir, "sess-3"));
  } finally {
    s.done();
  }
});

test("fail open: 파일 없음, 상태 파일 손상, 잘못된 입력은 도구 호출을 막지 않는다", () => {
  const s = sandbox();
  try {
    // 감시 파일이 없어도 된다(없는 것도 한 상태)
    rmSync(join(s.root, "AGENTS.md"));
    run(args("start", s.root), input("SessionStart", { source: "startup" }), { dir: s.dir });
    assert.equal(run(args("check", s.root), input("UserPromptSubmit"), { dir: s.dir }), null);
    writeFileSync(join(s.root, "AGENTS.md"), "# 새로 생김\n");
    assert.match(run(args("check", s.root), input("UserPromptSubmit"), { dir: s.dir }), /\+# 새로 생김/);
    // 상태 파일이 깨지면 지금을 기준으로 다시 시작
    writeFileSync(join(s.dir, "sess-1.json"), "{not json");
    assert.equal(run(args("check", s.root), input("UserPromptSubmit"), { dir: s.dir }), null);
    assert.ok(readRecord(s.dir, "sess-1"));
    // 세션 id가 이상하면 아무것도 하지 않는다
    assert.equal(run(args("check", s.root), input("UserPromptSubmit", { session_id: "../x" }), { dir: s.dir }), null);
    // 실제 실행: 쓸 수 없는 상태 폴더, 깨진 stdin → 출력 없이 exit 0
    const notDir = join(s.base, "a-file");
    writeFileSync(notDir, "x"); // 상태 폴더 자리에 파일 → 쓸 수 없음(ENOTDIR)
    for (const stdin of ["{broken", JSON.stringify(input("UserPromptSubmit"))]) {
      const r = spawnSync(process.execPath, [SCRIPT, "check", "--root", s.root], { input: stdin, env: { ...process.env, ATC_STATE_DIR: notDir }, encoding: "utf8", timeout: 5000 });
      assert.equal(r.status, 0);
      assert.equal(r.stdout, "");
    }
  } finally {
    s.done();
  }
});

test("diff 상한: 넘으면 자르고 파일을 다시 읽으라고 한다", () => {
  const before = Array.from({ length: 400 }, (_, i) => `줄 ${i}`).join("\n");
  const after = Array.from({ length: 400 }, (_, i) => `줄 ${i} 고침`).join("\n");
  const d = unifiedDiff(before, after, "CLAUDE.md");
  assert.equal(d.truncated, true);
  assert.equal(d.text.split("\n").length, MAX_DIFF_LINES);
  const ctx = contextOf([{ file: "CLAUDE.md", before, after }], "/repo");
  assert.match(ctx, /diff가 길어 잘랐다\. \/repo\/CLAUDE\.md를 Read로 다시 읽는다/);
  assert.ok(ctx.split("\n").length <= MAX_DIFF_LINES + 3);
  // 이전 내용을 모르면 diff 없이 안내만
  assert.match(contextOf([{ file: "AGENTS.md", before: undefined, after: "x" }], "/repo"), /이전 내용을 몰라/);
});

test("unified diff 모양: 앞뒤 3줄 문맥, 떨어진 변경은 hunk를 나눈다", () => {
  const a = Array.from({ length: 30 }, (_, i) => `l${i}`);
  const b = [...a];
  b[2] = "L2";
  b[25] = "L25";
  const d = unifiedDiff(a.join("\n"), b.join("\n"), "f.md").text.split("\n");
  assert.deepEqual(d.filter((l) => l.startsWith("@@")), ["@@ -1,6 +1,6 @@", "@@ -23,7 +23,7 @@"]);
});

test("대화 기록은 읽지 않는다, 저장소 밖 파일은 감시하지 않는다", () => {
  assert.deepEqual(parseArgs(["check", "--files", "CLAUDE.md,../secret,/etc/passwd,docs/RULES.md"]).files, ["CLAUDE.md", "docs/RULES.md"]);
  const src = readFileSync(SCRIPT, "utf8");
  assert.ok(!/transcript_path\s*[)\]]|readFileSync\([^)]*transcript/.test(src));
});

test("--ref: git ref의 파일을 본다(작업 트리가 아니라)", () => {
  const s = sandbox();
  try {
    const git = (...a) => execFileSync("git", ["-C", s.root, ...a], { stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
    git("init", "-q", "-b", "main");
    git("add", ".");
    git("commit", "-qm", "one");
    run(args("start", s.root, ["--ref", "main"]), input("SessionStart", { source: "startup" }), { dir: s.dir });
    writeFileSync(join(s.root, "CLAUDE.md"), "# 작업 트리만 바뀜\n");
    assert.equal(run(args("check", s.root, ["--ref", "main"]), input("UserPromptSubmit"), { dir: s.dir }), null);
    git("commit", "-qam", "two");
    assert.match(run(args("check", s.root, ["--ref", "main"]), input("UserPromptSubmit"), { dir: s.dir }), /작업 트리만 바뀜/);
    // ref에 없는 파일(git에서 뺀 파일)은 작업 트리에서 읽는다 — vocado CLAUDE.md
    writeFileSync(join(s.root, "LOCAL.md"), "local v1\n");
    const extra = ["--ref", "main", "--files", "CLAUDE.md,LOCAL.md"];
    assert.equal(run(args("check", s.root, extra), input("UserPromptSubmit"), { dir: s.dir }), null); // 목록에 새로 든 파일은 지금부터
    writeFileSync(join(s.root, "LOCAL.md"), "local v2\n");
    assert.match(run(args("check", s.root, extra), input("UserPromptSubmit"), { dir: s.dir }), /\+local v2/);
  } finally {
    s.done();
  }
});

test("정리: 7일 넘게 확인 없는 세션 기록과 가리키는 곳 없는 내용을 지운다. 상태 판정", () => {
  const s = sandbox();
  try {
    run(args("start", s.root), input("SessionStart", { source: "startup" }), { dir: s.dir });
    run(args("start", s.root), input("SessionStart", { session_id: "old", source: "startup" }), { dir: s.dir, now: Date.now() - 8 * 86_400_000 });
    writeFileSync(join(s.dir, "blobs", "deadbeef"), "orphan");
    cleanup(s.dir);
    assert.ok(existsSync(join(s.dir, "sess-1.json")));
    assert.ok(!existsSync(join(s.dir, "old.json")));
    assert.ok(!readdirSync(join(s.dir, "blobs")).includes("deadbeef"));
    const rec = readRecord(s.dir, "sess-1");
    assert.deepEqual(statusOf(rec), { current: true, behind: [] });
    writeFileSync(join(s.root, "CLAUDE.md"), "changed\n");
    assert.deepEqual(statusOf(rec), { current: false, behind: ["CLAUDE.md"] });
  } finally {
    s.done();
  }
});

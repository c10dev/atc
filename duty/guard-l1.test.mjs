import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { check, REPO, standOf, writeForbidden } from "./guard.mjs";

// DUTY L1(D7a)의 guard: Edit·Write는 자기 STAND(.claude/worktrees/duty-*)의 문서만, git·gh는 정해진 형식만.
// 진짜 폴더로 시험한다: 이 저장소의 .claude/worktrees 아래에 duty-gtest-<pid>를 만들었다가 지운다(git 저장소일 필요는 없다).
const DUTY = dirname(fileURLToPath(import.meta.url));
const WT = join(REPO, ".claude", "worktrees");
const SD = join(WT, `duty-gtest-${process.pid}`); // 진짜 STAND
const SD2 = join(WT, `duty-gtest2-${process.pid}`); // 다른 STAND(이것도 DUTY의 것이다)
const OTHER = join(WT, `other-gtest-${process.pid}`); // duty-*가 아닌 워크트리(팀 세션의 것)
let OUT; // 저장소 밖
const B = (n) => `duty-gtest-${process.pid}/${n}`;

before(() => {
  for (const d of [SD, SD2, OTHER]) for (const sub of ["docs", "duty", ".claude/skills", ".github/workflows", "hooks", "deploy", "server", "node_modules/x", "changelog.d"]) mkdirSync(join(d, sub), { recursive: true });
  OUT = mkdtempSync(join(tmpdir(), "duty-gtest-out-"));
  mkdirSync(join(OUT, "dir"));
  writeFileSync(join(OUT, "secret.md"), "x");
  writeFileSync(join(SD, "docs", "a.md"), "x");
  writeFileSync(join(SD, "duty", "settings.json"), "{}");
  // 심볼릭 링크: 밖으로, 자기 권한 파일로, 다른 STAND로, 끊어진 것, 위로
  symlinkSync(join(OUT, "secret.md"), join(SD, "docs", "link-out.md"));
  symlinkSync(join(OUT, "dir"), join(SD, "docs", "dir-out"));
  symlinkSync(join(SD, "duty", "settings.json"), join(SD, "docs", "link-settings.md"));
  symlinkSync(join(SD, "duty"), join(SD, "docs", "dir-duty"));
  symlinkSync(join(SD, ".claude"), join(SD, "docs", "dir-claude"));
  symlinkSync(join(SD2, "docs"), join(SD, "docs", "dir-stand2"));
  symlinkSync(join(OUT, "nope", "x.md"), join(SD, "docs", "dangling.md"));
  symlinkSync(join(SD, "docs", "loop-b"), join(SD, "docs", "loop-a"));
  symlinkSync(join(SD, "docs", "loop-a"), join(SD, "docs", "loop-b"));
  symlinkSync("../..", join(SD, "docs", "dir-up")); // STAND 위(.claude/worktrees)
  symlinkSync(REPO, join(SD, "docs", "dir-repo")); // 운영 저장소 전체
  symlinkSync(OUT, join(WT, `duty-gtest-evil-${process.pid}`)); // duty-* 이름이지만 밖을 가리키는 STAND
});
after(() => {
  for (const p of [SD, SD2, OTHER, OUT, join(WT, `duty-gtest-evil-${process.pid}`)]) rmSync(p, { recursive: true, force: true });
});

const tool = (t, file_path, cwd = DUTY) => check({ tool_name: t, tool_input: { file_path, content: "x", old_string: "a", new_string: "b" }, cwd });
const bash = (command, cwd = DUTY) => check({ tool_name: "Bash", tool_input: { command }, cwd });

test("STAND 판별: duty-<이름>만, 그 안의 조각을 돌려준다", () => {
  assert.deepEqual(standOf(join(SD, "docs", "a.md"))?.rel, ["docs", "a.md"]);
  assert.equal(standOf(join(SD, "docs", "a.md")).root, SD);
  assert.deepEqual(standOf(SD)?.rel, []);
  for (const p of [join(WT, "other-x", "a.md"), join(WT, "duty", "a.md"), join(WT, "duty-", "a.md"), join(WT, "duty-Ab", "a.md"), join(WT, "duty--x", "a.md"), join(REPO, "docs", "a.md"), WT, "/tmp/x.md", "/"]) assert.equal(standOf(p), null, p);
});

test("Edit·Write 허용: 자기 STAND의 문서(.md), 새 파일·새 폴더 포함, 상대 경로는 cwd 기준", () => {
  for (const t of ["Edit", "Write"]) {
    for (const f of ["docs/a.md", "docs/new-topic.md", "docs/new-topic.ko.md", "docs/deep/er/x.md", "changelog.d/ATC-999.md", "changelog.d/ATC-999.ko.md", "README.md", "README.ko.md", "docs/duty.md", "docs/deploy/notes.md", "docs/hooks.md", "server/README.md", "controller/CLAUDE.md", "docs/UPPER.MD"]) {
      assert.equal(tool(t, join(SD, f)), null, `${t} ${f}`);
    }
    assert.equal(tool(t, "docs/x.md", SD), null, "cwd가 STAND면 상대 경로도 된다");
    assert.equal(tool(t, join(SD2, "docs", "x.md")), null, "다른 duty-* STAND도 DUTY의 것이다");
    assert.equal(tool(t, join(SD, "docs", "dir-stand2", "x.md")), null, "다른 STAND를 가리키는 링크는 그 STAND 안이다");
  }
});

test("Edit·Write 거절: STAND 밖(운영 저장소, 팀 워크트리, 홈, /tmp, duty-가 아닌 이름, 이름 없는 duty-)", () => {
  const outside = [
    join(REPO, "docs", "x.md"),
    join(REPO, "README.md"),
    join(OTHER, "docs", "x.md"),
    join(WT, "docs", "x.md"),
    join(WT, "duty", "x.md"),
    join(WT, "duty-", "x.md"),
    join(WT, "duty-UP", "x.md"),
    join(WT, `duty-gtest-evil-${process.pid}`, "x.md"), // 밖을 가리키는 duty-* 링크
    join(OUT, "secret.md"),
    "/tmp/x.md",
    "/etc/passwd",
    "/",
    "~/x.md",
    "~/.claude/settings.json",
    "~",
  ];
  for (const t of ["Edit", "Write"]) for (const f of outside) assert.notEqual(tool(t, f), null, `${t} ${f}`);
});

test("Edit·Write 거절: 상대 경로 · .. 탈출 · STAND 폴더 자체", () => {
  for (const t of ["Edit", "Write"]) {
    for (const f of ["docs/x.md", "../x.md", "x.md"]) assert.notEqual(tool(t, f), null, `${t} ${f}: cwd가 duty/면 STAND 밖`);
    assert.notEqual(tool(t, `${SD}/docs/../../x.md`), null, "STAND 위로 ..");
    assert.notEqual(tool(t, `${SD}/../other-x/x.md`), null);
    assert.notEqual(tool(t, `${SD}/../../../x.md`), null);
    assert.notEqual(tool(t, `${SD}/docs/dir-out/../x.md`), null, "링크 뒤의 ..은 글자로는 STAND 안이지만 OS는 밖으로 간다");
    assert.notEqual(tool(t, `${SD}/docs/dir-stand2/../../duty-gtest-${process.pid}/duty/settings.json`), null);
    assert.notEqual(tool(t, `${SD}/docs/../../../docs/x.md`), null, "저장소 docs로 빠져나간다");
    assert.notEqual(tool(t, "../x.md", SD), null, "cwd가 STAND여도 .. 로 나가면 STAND 밖");
    assert.notEqual(tool(t, "../../docs/x.md", join(SD, "docs")), null);
    assert.notEqual(tool(t, SD), null, "STAND 폴더 자체");
    assert.notEqual(tool(t, `${SD}/`), null);
    assert.notEqual(tool(t, join(SD, ".")), null);
  }
  // .. 로 자기 권한 폴더로 들어가는 것도 이름이 아니라 푼 경로로 본다
  for (const t of ["Edit", "Write"]) for (const f of ["docs/../duty/settings.json", "docs/./../.claude/settings.json", "docs/../.github/workflows/ci.yml", "docs/../../duty-gtest2-x/../../x.md"]) assert.notEqual(tool(t, `${SD}/${f}`), null, f);
});

test("Edit·Write 거절(no-self-authority): duty/, *guard*, .claude/, .github/, package*.json, deploy/, hooks/, 루트 CLAUDE.md, .env*, .git*, node_modules", () => {
  const self = [
    "duty/settings.json",
    "duty/guard.mjs",
    "duty/guard.test.mjs",
    "duty/spawn.mjs",
    "duty/CLAUDE.md",
    "duty/CLAUDE.en.md",
    "duty/brief-hook.mjs",
    "duty/README.md",
    "duty/.claude/settings.json",
    "controller/guard.mjs",
    "occ/send-guard.mjs",
    "docs/my-guard.md",
    "docs/GUARD-notes.md",
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".claude/skills/atc-task/SKILL.md",
    ".claude/worktrees/x/a.md",
    "docs/.claude/x.md",
    "occ/.claude/skills/tick/SKILL.md",
    ".github/workflows/ci.yml",
    ".github/CODEOWNERS",
    ".github/pull_request_template.md",
    "docs/.github/x.md",
    "package.json",
    "package-lock.json",
    "web/package.json",
    "docs/Package.json",
    "deploy/atc.service",
    "deploy/landing-tier.mjs",
    "deploy/README.md",
    "hooks/kill-guard.mjs",
    "hooks/shell.mjs",
    "hooks/README.md",
    "CLAUDE.md",
    "CLAUDE.en.md",
    "claude.md",
    ".env",
    ".env.local",
    ".env.example",
    "docs/.env",
    "docs/.envrc",
    ".git",
    ".gitattributes",
    ".gitmodules",
    ".gitignore",
    "docs/.git/config",
    "docs/.gitattributes",
    "node_modules/x/README.md",
    "node_modules/x/index.js",
    "web/node_modules/x/README.md",
  ];
  for (const t of ["Edit", "Write"]) for (const f of self) assert.notEqual(tool(t, join(SD, f)), null, `${t} ${f}`);
  // writeForbidden이 사유를 돌려준다
  assert.match(writeForbidden(join(SD, "duty", "settings.json")), /no-self-authority/);
  assert.match(writeForbidden(join(SD, "CLAUDE.md")), /CLAUDE\.md/);
  assert.match(writeForbidden(join(SD, "node_modules", "x", "README.md")), /node_modules/);
});

test("Edit·Write 거절: 문서(.md)가 아닌 것(코드·설정·스크립트·이미지) — L2는 없다", () => {
  for (const t of ["Edit", "Write"]) {
    for (const f of ["server/index.ts", "server/x.test.ts", "web/src/App.tsx", "web/src/styles.css", "controller/atcctl.mjs", "docs/x.json", "docs/x.yml", "docs/x.sh", "docs/x.mjs", "docs/x.png", "docs/x", "docs/x.md.sh", "docs/x.md.exe", "docs/md", "changelog.d/x.txt", "vite.config.ts", "tsconfig.json"]) assert.notEqual(tool(t, join(SD, f)), null, `${t} ${f}`);
  }
});

test("Edit·Write 거절: 심볼릭 링크는 푼 경로로 본다(밖으로, 자기 권한 파일로, 위로, 끊어진 것, 고리)", () => {
  for (const t of ["Edit", "Write"]) {
    for (const f of [
      "docs/link-out.md", // 밖의 파일로
      "docs/dir-out/new.md", // 밖의 폴더로, 새 파일
      "docs/dir-out/secret.md",
      "docs/link-settings.md", // duty/settings.json으로
      "docs/dir-duty/settings.json",
      "docs/dir-duty/new.md",
      "docs/dir-claude/x.md",
      "docs/dangling.md", // 끊어진 링크(밖을 가리킨다)
      "docs/loop-a", // 고리
      "docs/loop-a/x.md",
      "docs/dir-up/x.md", // STAND 위(.claude/worktrees)
      "docs/dir-up/other-x/x.md",
      "docs/dir-repo/docs/x.md", // 운영 저장소
      "docs/dir-repo/duty/settings.json",
      "docs/dir-repo/CLAUDE.md",
    ]) assert.notEqual(tool(t, join(SD, f)), null, `${t} ${f}`);
    assert.notEqual(tool(t, join(OUT, "x.md")), null);
  }
});

test("Edit·Write 거절: 잘못된 입력(경로 없음·글이 아님·NUL·빈 값)", () => {
  for (const t of ["Edit", "Write"]) {
    for (const input of [undefined, null, {}, { file_path: "" }, { file_path: "  " }, { file_path: 5 }, { file_path: ["a"] }, { file_path: `${SD}/docs/a.md\u0000.x` }, { path: join(SD, "docs", "a.md") }, { notebook_path: join(SD, "docs", "a.md") }]) {
      assert.notEqual(check({ tool_name: t, tool_input: input, cwd: DUTY }), null, `${t} ${JSON.stringify(input)}`);
    }
  }
  assert.notEqual(check({ tool_name: "NotebookEdit", tool_input: { notebook_path: join(SD, "docs", "a.ipynb") }, cwd: DUTY }), null);
  assert.notEqual(check({ tool_name: "MultiEdit", tool_input: { file_path: join(SD, "docs", "a.md") }, cwd: DUTY }), null);
});

test("git 허용: STAND 안의 add·commit·push·fetch·merge(형식 고정)와 읽기, -C <STAND>", () => {
  const ok = [
    `git -C ${SD} status`,
    `git -C ${SD} status --short`,
    `git -C ${SD} diff --stat`,
    `git -C ${SD} log --oneline -5`,
    `git -C ${SD} show HEAD --stat`,
    `git -C ${SD}/docs status`,
    `git -C ${SD} add -A`,
    `git -C ${SD} add --all`,
    `git -C ${SD} add -u`,
    `git -C ${SD} add docs/new-topic.md docs/new-topic.ko.md`,
    `git -C ${SD} add -- docs/new-topic.md`,
    `git -C ${SD} add docs/`,
    `git -C ${SD} add .`,
    `git -C ${SD} commit -m 'Add the charter design draft'`,
    `git -C ${SD} commit --message 'Add the charter design draft'`,
    `git -C ${SD} commit --message='Add the charter design draft'`,
    `git -C ${SD} commit -a -m 'x'`,
    `git -C ${SD} commit -m 'a > b; c && d'`,
    `git -C ${SD} commit -q -m x`,
    `git -C ${SD} push -u origin claude/duty-charter-desk`,
    `git -C ${SD} push --set-upstream origin claude/duty-charter-desk`,
    `git -C ${SD} push origin claude/duty-x`,
    `git -C ${SD} fetch origin`,
    `git -C ${SD} fetch -q origin main`,
    `git -C ${SD} merge origin/main`,
    `git -C ${SD} merge --no-edit origin/main`,
    `git -C ${SD} merge --abort`,
    `git -C ${SD2} add -A`,
    `git -C ${SD} add -A && git -C ${SD} commit -m x && git -C ${SD} push -u origin claude/duty-x`,
    `git -C ${SD} diff | jq -R .`,
    // 운영 저장소의 읽기(cwd 기준 L0 그대로)
    "git log --oneline -5",
    "git status --short",
    "git diff origin/main --stat",
  ];
  for (const c of ok) assert.equal(bash(c), null, c);
  // cwd가 STAND 안이면 -C 없이도 된다
  for (const c of ["git add -A", "git commit -m x", "git push -u origin claude/duty-x", "git fetch origin", "git merge origin/main", "git status"]) {
    assert.equal(bash(c, SD), null, `cwd=STAND: ${c}`);
    assert.equal(bash(c, join(SD, "docs")), null, `cwd=STAND/docs: ${c}`);
  }
});

test("git 거절: STAND 밖(cwd·-C), 링크로 나가는 -C, 운영 저장소, 팀 워크트리, 없는 폴더", () => {
  for (const sub of ["add -A", "commit -m x", "push -u origin claude/duty-x", "fetch origin", "merge origin/main"]) {
    assert.notEqual(bash(`git ${sub}`), null, `cwd=duty/ 에서 -C 없이: git ${sub}`);
    assert.notEqual(bash(`git ${sub}`, REPO), null, `cwd=운영 저장소: git ${sub}`);
    assert.notEqual(bash(`git ${sub}`, OTHER), null, `cwd=팀 워크트리: git ${sub}`);
    assert.notEqual(bash(`git ${sub}`, WT), null, `cwd=.claude/worktrees: git ${sub}`);
    assert.notEqual(bash(`git ${sub}`, join(SD, "docs", "dir-out")), null, `cwd=밖을 가리키는 링크: git ${sub}`);
    assert.notEqual(bash(`git ${sub}`, join(SD, "docs", "dir-repo")), null, `cwd=운영 저장소 링크: git ${sub}`);
    for (const dir of [REPO, OTHER, WT, `${SD}/..`, `${SD}/docs/../..`, `${SD}/docs/dir-out`, `${SD}/docs/dir-repo`, `${SD}/docs/dir-up`, join(WT, `duty-gtest-evil-${process.pid}`), join(WT, "duty-nope-nonexistent"), "/tmp", OUT, `${SD}/docs/a.md`, "~", "."]) {
      assert.notEqual(bash(`git -C ${dir} ${sub}`), null, `git -C ${dir} ${sub}`);
    }
  }
  for (const c of ["git -C", "git -C ..", "git -C ../.. status", `git -C ${SD} -C ${REPO} status`, `git -C ${REPO} -C ${SD} status`, `git -c core.pager=x -C ${SD} status`, `git --git-dir=${SD}/.git status`, `git --work-tree=${SD} status`, `git -C ${SD} -c x=y status`]) {
    assert.notEqual(bash(c), null, c);
  }
});

test("git 거절: commit — --amend·-n·--no-verify·-F·-C·--author·합친 짧은 옵션·문구 없는 -m", () => {
  for (const o of ["--amend", "--amend -m x", "-n -m x", "--no-verify -m x", "-m x --no-verify", "-m x -n", "-nm x", "-am x", "-F msg.txt", "--file=msg.txt", "-C HEAD", "-c HEAD", "--reuse-message=HEAD", "--author='A <a@b>'", "--date=x -m x", "-m", "--message", "-e", "--allow-empty -m x", "-s -m x", "--no-gpg-sign -m x", "-S -m x", "--fixup HEAD", "--squash HEAD", "--template x", "--cleanup=none -m x", "-t x", "--only x -m x", "-i x -m x", "-p", "--patch", "--interactive", "docs/x.md -m x", "-- docs/x.md", "--include x", "--trailer x -m x"]) {
    assert.notEqual(bash(`git -C ${SD} commit ${o}`), null, `commit ${o}`);
  }
});

test("git 거절: push — --force·-f·+ref·다른 브랜치·refspec·다른 remote·삭제·태그·mirror", () => {
  for (const o of [
    "--force origin claude/duty-x",
    "-f origin claude/duty-x",
    "--force-with-lease origin claude/duty-x",
    "--force-with-lease=claude/duty-x origin claude/duty-x",
    "--force-if-includes origin claude/duty-x",
    "origin +claude/duty-x",
    "origin +claude/duty-x:claude/duty-x",
    "origin claude/duty-x:main",
    "origin claude/duty-x:claude/duty-x",
    "origin HEAD",
    "origin HEAD:main",
    "origin main",
    "origin origin/main",
    "origin claude/other",
    "origin claude/duty-",
    "origin claude/duty-X",
    "origin worktree-atc-1-x",
    "origin claude/duty-x claude/duty-y",
    "origin claude/duty-x main",
    "origin --delete claude/duty-x",
    "--delete origin claude/duty-x",
    "origin :claude/duty-x",
    "--tags origin claude/duty-x",
    "origin claude/duty-x --tags",
    "--mirror origin",
    "--all origin",
    "--prune origin claude/duty-x",
    "upstream claude/duty-x",
    "https://example.com/r.git claude/duty-x",
    "git@github.com:o/r.git claude/duty-x",
    "/tmp/bare.git claude/duty-x",
    "-u origin",
    "-u",
    "",
    "origin",
    "-u origin claude/duty-x --force",
    "-u -f origin claude/duty-x",
    "--receive-pack=x origin claude/duty-x",
    "--repo=x origin claude/duty-x",
    "--push-option=x origin claude/duty-x",
    "-o x origin claude/duty-x",
    "origin claude/duty-x/extra",
    "origin claude/duty-x..y",
    "origin refs/heads/claude/duty-x",
    "origin refs/tags/v1",
  ]) assert.notEqual(bash(`git -C ${SD} push ${o}`), null, `push ${o}`);
});

test("git 거절: add·fetch·merge의 밖으로 나가는 형식", () => {
  for (const o of ["-f docs/x.md", "--force docs/x.md", "-f .env", "/etc/passwd", "~/x", "../x.md", "docs/../../x.md", ":/", ":(top)x", ":(glob)**", "--pathspec-from-file=x", "--pathspec-from-file x", "-i", "--interactive", "-p", "--patch", "-e", "--edit", "-N x", "--intent-to-add x", "--chmod=+x x", "--sparse x", "--renormalize", "--ignore-errors", "--dry-run", "-n"]) {
    assert.notEqual(bash(`git -C ${SD} add ${o}`), null, `add ${o}`);
  }
  for (const o of ["", "upstream", "upstream main", "origin other", "origin main other", "origin +main", "origin main:x", "--all", "--tags origin", "--prune origin", "--upload-pack=x origin", "-u origin", "https://example.com/r.git", "/tmp/bare.git", "origin --force", "origin refs/heads/*:refs/heads/*", "--depth=1 origin", "--unshallow origin"]) {
    assert.notEqual(bash(`git -C ${SD} fetch ${o}`), null, `fetch ${o}`);
  }
  for (const o of ["", "main", "origin/other", "origin/main origin/other", "-X theirs origin/main", "-s ours origin/main", "--squash origin/main", "-m x origin/main", "--allow-unrelated-histories origin/main", "HEAD~1", "claude/duty-y", "--continue", "--quit", "--no-verify origin/main", "-n origin/main", "--strategy=ours origin/main", "origin/main --abort", "--abort origin/main", "../x", "refs/remotes/origin/main", "FETCH_HEAD"]) {
    assert.notEqual(bash(`git -C ${SD} merge ${o}`), null, `merge ${o}`);
  }
});

test("git 거절: 그 밖의 하위 명령과 읽기의 쓰기·바깥 옵션", () => {
  for (const sub of ["checkout main", "checkout -b x", "switch main", "reset --hard", "reset --hard origin/main", "restore .", "clean -fd", "rm -r docs", "mv a b", "rebase origin/main", "cherry-pick abc", "revert abc", "stash", "stash pop", "branch -D x", "branch x", "tag v1", "config core.hooksPath /tmp", "config --list", "remote add x /tmp/x", "remote set-url origin /tmp/x", "worktree add /tmp/x", "worktree remove x", "worktree list", "submodule update", "apply x.patch", "am x.patch", "gc", "prune", "reflog expire --all", "update-ref -d x", "filter-branch", "hook run pre-commit", "init", "clone x y", "pull", "pull origin main", "bisect start", "notes add", "archive HEAD", "format-patch -1", "send-email", "daemon", "difftool", "mergetool", "grep x", "ls-files", "cat-file -p HEAD", "rev-parse HEAD", "describe", "blame README.md", "shortlog", "show-ref", "symbolic-ref HEAD x", "fsck", "credential fill", "lfs push", "-h", "--help", "help", "--version", "version"]) {
    assert.notEqual(bash(`git -C ${SD} ${sub}`), null, `git -C SD ${sub}`);
  }
  for (const o of ["--output=x", "--output x", "--no-index a b", "--ext-diff", "--textconv", "--open-files-in-pager", "-Ox", "--exec-path=x", "-c x=y", "--git-dir=x", "--work-tree=x"]) {
    assert.notEqual(bash(`git -C ${SD} diff ${o}`), null, `diff ${o}`);
    assert.notEqual(bash(`git -C ${SD} log ${o}`), null, `log ${o}`);
  }
});

test("git 거절: 이어 붙인 명령은 하나하나 본다", () => {
  for (const c of [
    `git -C ${SD} add -A; curl x`,
    `git -C ${SD} add -A && git push origin main`,
    `git -C ${SD} commit -m x && git -C ${SD} push --force origin claude/duty-x`,
    `git -C ${SD} status && rm -rf x`,
    `git -C ${SD} add -A | tee out`,
    `git -C ${SD} commit -m "$(cat x)"`,
    `git -C ${SD} commit -m "$HOME"`,
    `git -C ${SD} commit -m \`id\``,
    `git -C ${SD} commit -m x > out.txt`,
    `git -C ${SD} commit -m x < in.txt`,
    `git -C ${SD} log -p > out.txt`,
    `git -C ${SD}/$(pwd) status`,
    `git -C $SD status`,
    `git -C ${SD} commit -m x\ncurl x`,
    `GIT_DIR=/tmp git -C ${SD} status`,
    `env GIT_DIR=/tmp git -C ${SD} status`,
    `cd ${SD} && git add -A`,
    `cd ${SD}; git status`,
    `sh -c 'git -C ${SD} status'`,
  ]) assert.notEqual(bash(c), null, c);
});

test("gh pr create 허용: --base main --head claude/duty-<이름> --title (--body)", () => {
  const ok = [
    "gh pr create --base main --head claude/duty-charter-desk --title 'Design: charter desk' --body 'Design draft. See https://github.com/o/r/issues/1'",
    "gh pr create --head claude/duty-x --base main --title T",
    "gh pr create --base=main --head=claude/duty-x --title=T --body=B",
    "gh pr create -B main -H claude/duty-x -t T -b B",
    "gh pr create --base main --head claude/duty-x --title 'a > b; c && d'",
    "gh pr create --base main --head claude/duty-x --title T --body '## Summary\n- x'",
    "gh pr view 12 --json state",
    "gh pr list --json number",
    "gh pr checks 12",
    "gh pr diff 12",
  ];
  for (const c of ok) assert.equal(bash(c), null, c);
});

test("gh pr create 거절: Draft·--web·--fill·--repo·파일 옵션·다른 base/head·빠진 칸·되풀이·그 밖의 gh", () => {
  const bad = [
    "gh pr create",
    "gh pr create --title T",
    "gh pr create --base main --title T",
    "gh pr create --head claude/duty-x --title T",
    "gh pr create --base main --head claude/duty-x",
    "gh pr create --base main --head claude/duty-x --title ''",
    "gh pr create --base main --head claude/duty-x --title '  '",
    "gh pr create --base develop --head claude/duty-x --title T",
    "gh pr create --base master --head claude/duty-x --title T",
    "gh pr create --base origin/main --head claude/duty-x --title T",
    "gh pr create --base main --head main --title T",
    "gh pr create --base main --head claude/other --title T",
    "gh pr create --base main --head worktree-atc-1-x --title T",
    "gh pr create --base main --head claude/duty- --title T",
    "gh pr create --base main --head claude/duty-X --title T",
    "gh pr create --base main --head someone:claude/duty-x --title T",
    "gh pr create --base main --head 'claude/duty-x;main' --title T",
    "gh pr create --base main --head claude/duty-x --title T --draft",
    "gh pr create --base main --head claude/duty-x --title T -d",
    "gh pr create --base main --head claude/duty-x --title T --draft=true",
    "gh pr create --base main --head claude/duty-x --title T --web",
    "gh pr create --base main --head claude/duty-x --title T -w",
    "gh pr create --base main --head claude/duty-x --title T --fill",
    "gh pr create --base main --head claude/duty-x --title T -f",
    "gh pr create --base main --head claude/duty-x --title T --fill-first",
    "gh pr create --base main --head claude/duty-x --title T --fill-verbose",
    "gh pr create --base main --head claude/duty-x --title T --repo o/r",
    "gh pr create --base main --head claude/duty-x --title T -R o/r",
    "gh pr create --base main --head claude/duty-x --title T --body-file x.md",
    "gh pr create --base main --head claude/duty-x --title T -F x.md",
    "gh pr create --base main --head claude/duty-x --title T --template x",
    "gh pr create --base main --head claude/duty-x --title T --label bug",
    "gh pr create --base main --head claude/duty-x --title T -l bug",
    "gh pr create --base main --head claude/duty-x --title T --assignee @me",
    "gh pr create --base main --head claude/duty-x --title T --reviewer x",
    "gh pr create --base main --head claude/duty-x --title T --milestone x",
    "gh pr create --base main --head claude/duty-x --title T --project x",
    "gh pr create --base main --head claude/duty-x --title T --recover x",
    "gh pr create --base main --head claude/duty-x --title T --no-maintainer-edit",
    "gh pr create --base main --head claude/duty-x --title T --dry-run",
    "gh pr create --base main --base main --head claude/duty-x --title T",
    "gh pr create --base main --head claude/duty-x --head claude/duty-y --title T",
    "gh pr create --base main --head claude/duty-x --title T --title U",
    "gh pr create --base main --head claude/duty-x --title",
    "gh pr create --base main --head claude/duty-x --title T --body",
    "gh pr create --base main --head claude/duty-x --title T extra",
    "gh pr create --base main --head claude/duty-x --title T --",
    "gh pr create --base main --head claude/duty-x --title T --jq .",
    "gh pr create --base main --head claude/duty-x --title T > out",
    "gh pr create --base main --head claude/duty-x --title \"$(id)\"",
    "gh pr create --base main --head claude/duty-x --title T; gh pr merge 1",
    "gh pr create --base main --head claude/duty-x --title T && curl x",
    "gh pr merge 12",
    "gh pr merge 12 --auto",
    "gh pr edit 12 --body x",
    "gh pr close 12",
    "gh pr reopen 12",
    "gh pr comment 12 --body x",
    "gh pr review 12 --approve",
    "gh pr ready 12",
    "gh pr checkout 12",
    "gh pr update-branch 12",
    "gh pr lock 12",
    "gh pr revert 12",
    "gh pr status",
    "gh api repos/o/r/pulls -X POST",
    "gh api graphql",
    "gh issue create --title x",
    "gh issue comment 1 --body x",
    "gh issue close 1",
    "gh repo delete",
    "gh repo view",
    "gh workflow run x",
    "gh release create v1",
    "gh auth token",
    "gh secret set X",
    "gh run rerun 1",
    "gh alias set x y",
    "gh extension install x",
    "gh browse",
    "gh",
    "gh --version",
    "gh pr",
    "gh pr view 12 --web",
    "gh pr checks 12 --watch",
  ];
  for (const c of bad) assert.notEqual(bash(c), null, c);
});

test("atcctl duty stand·stand-done·linear는 duty 하위 명령으로 통과, 그 밖은 그대로 거절", () => {
  for (const c of [
    "node ../controller/atcctl.mjs duty stand charter-desk",
    "node ../controller/atcctl.mjs duty stand-done charter-desk",
    "node ../controller/atcctl.mjs duty linear create --title 'T' --priority 2 --state Todo -- 'Body with `code`'".replace("`code`", "code"),
    "node ../controller/atcctl.mjs duty linear update ATC-1 --priority 3",
    "node ../controller/atcctl.mjs duty linear comment ATC-1 -- 'Note'",
  ]) assert.equal(bash(c), null, c);
  for (const c of ["node ../controller/atcctl.mjs duty stands x", "node ../controller/atcctl.mjs duty linearx create", "node ../controller/atcctl.mjs duty Stand x", "node ../controller/atcctl.mjs duty work ATC-1 -- x", "node ../controller/atcctl.mjs duty merge 1", "node ../controller/atcctl.mjs duty approve x"]) {
    assert.notEqual(bash(c), null, c);
  }
});

test("Read·Glob·Grep은 L0 그대로: STAND 안의 문서는 읽고 .git·.env·저장소 밖은 읽지 않는다", () => {
  assert.equal(check({ tool_name: "Read", tool_input: { file_path: join(SD, "docs", "a.md") }, cwd: DUTY }), null);
  assert.notEqual(check({ tool_name: "Read", tool_input: { file_path: join(SD, ".git") }, cwd: DUTY }), null);
  assert.notEqual(check({ tool_name: "Read", tool_input: { file_path: join(SD, ".env") }, cwd: DUTY }), null);
  assert.notEqual(check({ tool_name: "Read", tool_input: { file_path: join(SD, "docs", "link-out.md") }, cwd: DUTY }), null);
  assert.notEqual(check({ tool_name: "Read", tool_input: { file_path: "/etc/passwd" }, cwd: DUTY }), null);
});

// hook 프로세스로: STAND 안의 Write는 통과(exit 0), 자기 권한 파일과 STAND 밖은 exit 2(fail-closed)
test("hook 프로세스: Write — STAND 안 문서 0, duty/settings.json·STAND 밖 2", () => {
  const run = (input) => spawnSync(process.execPath, [join(DUTY, "guard.mjs")], { input: JSON.stringify(input), encoding: "utf8", cwd: DUTY });
  assert.equal(run({ tool_name: "Write", tool_input: { file_path: join(SD, "docs", "x.md"), content: "x" }, cwd: DUTY }).status, 0);
  const s = run({ tool_name: "Write", tool_input: { file_path: join(SD, "duty", "settings.json"), content: "{}" }, cwd: DUTY });
  assert.equal(s.status, 2);
  assert.match(s.stderr, /DUTY는 L1/);
  assert.match(s.stderr, /no-self-authority/);
  assert.equal(run({ tool_name: "Edit", tool_input: { file_path: join(REPO, "docs", "duty.md") }, cwd: DUTY }).status, 2);
  assert.equal(run({ tool_name: "Edit", tool_input: { file_path: join(SD, "docs", "link-out.md") }, cwd: DUTY }).status, 2);
});

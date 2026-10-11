// readWorkspaces의 서명 캐시(ATC-525 후속): 바뀐 것은 다음 틱에 보이고, 바뀌지 않은 저장소에는 git을 띄우지 않는다.
// 임시 저장소만 쓴다. config.ts가 import할 때 환경을 읽으므로 임시 상태 폴더를 먼저 정하고 동적으로 import한다.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Workspace } from "../model.ts";

const root = mkdtempSync(join(tmpdir(), "atc-git-ws-"));
process.env.ATC_STATE_DIR = join(root, "state");
Object.assign(process.env, {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
});
const g = await import("./git.ts");

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const origin = join(root, "origin.git");
const repo = join(root, "repo");
const wtA = join(root, "wt-a");
let t = Date.now();

// 한 틱: 목록을 읽고, 밀린 status가 있으면 끝날 때까지 기다린 뒤 같은 시각으로 다시 읽는다
async function tick(at = t): Promise<{ ws: Workspace[]; spawns: number }> {
  const s0 = g.gitSpawns();
  await g.readWorkspaces([repo], at);
  await g.workspaceRefresh();
  const ws = await g.readWorkspaces([repo], at);
  return { ws, spawns: g.gitSpawns() - s0 };
}
const byPath = (ws: Workspace[], p: string) => ws.find((w) => w.path === p);

before(() => {
  mkdirSync(process.env.ATC_STATE_DIR!, { recursive: true });
  git(root, "init", "-q", "--bare", origin);
  git(root, "init", "-q", "-b", "main", repo);
  writeFileSync(join(repo, "a.txt"), "a\n");
  git(repo, "add", "a.txt");
  git(repo, "commit", "-q", "-m", "first");
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-q", "-u", "origin", "main");
  git(repo, "worktree", "add", "-q", "-b", "feat", wtA);
});
after(() => rmSync(root, { recursive: true, force: true }));

test("처음 읽은 값은 예전 명령들과 같다: 목록, dirty, 마지막 커밋, pushed, unpushed", async () => {
  g.resetWorkspaceCache();
  const { ws } = await tick();
  assert.deepEqual(ws.map((w) => w.path), [repo, wtA]);
  const main = byPath(ws, repo)!;
  assert.equal(main.isMain, true);
  assert.equal(main.branch, "main");
  assert.equal(main.head, git(repo, "rev-parse", "HEAD").slice(0, 8));
  assert.equal(main.dirty, 0);
  assert.equal(main.lastCommitAt, git(repo, "log", "-1", "--format=%cI"));
  assert.equal(main.pushed, true);
  assert.equal(main.unpushed, 0);
  const a = byPath(ws, wtA)!;
  assert.equal(a.branch, "feat");
  assert.equal(a.pushed, false); // origin/feat가 없다
  assert.equal(a.unpushed, 0);
});

test("아무것도 바뀌지 않은 틱은 git을 띄우지 않는다", async () => {
  g.resetWorkspaceCache();
  await tick();
  const again = await tick(t + 1_000);
  assert.equal(again.spawns, 0);
});

test("HEAD가 바뀌면(브랜치 전환) 다음 틱에 보인다", async () => {
  g.resetWorkspaceCache();
  await tick();
  git(wtA, "switch", "-q", "-c", "feat-2");
  const { ws, spawns } = await tick(t + 2_000);
  assert.ok(spawns > 0);
  assert.equal(byPath(ws, wtA)!.branch, "feat-2");
});

test("새 커밋은 다음 틱에 head, 마지막 커밋, unpushed로 보인다", async () => {
  g.resetWorkspaceCache();
  await tick();
  writeFileSync(join(wtA, "b.txt"), "b\n");
  git(wtA, "add", "b.txt");
  git(wtA, "commit", "-q", "-m", "second");
  const { ws } = await tick(t + 2_000);
  const a = byPath(ws, wtA)!;
  assert.equal(a.head, git(wtA, "rev-parse", "HEAD").slice(0, 8));
  assert.equal(a.lastCommitAt, git(wtA, "log", "-1", "--format=%cI"));
  assert.equal(a.unpushed, 1);
  assert.equal(a.unpushed, Number(git(wtA, "rev-list", "--count", "HEAD", "--not", "--remotes")));
});

test("push하면 pushed가 true, unpushed가 0이 된다", async () => {
  g.resetWorkspaceCache();
  await tick();
  git(wtA, "push", "-q", "-u", "origin", "HEAD");
  const { ws } = await tick(t + 2_000);
  const a = byPath(ws, wtA)!;
  assert.equal(a.pushed, true);
  assert.equal(a.unpushed, 0);
});

test("index·작업 트리 변경(dirty)은 지금처럼 30초 안에 보인다", async () => {
  g.resetWorkspaceCache();
  await tick();
  writeFileSync(join(wtA, "c.txt"), "c\n");
  git(wtA, "add", "c.txt"); // index만 바뀜
  appendFileSync(join(wtA, "a.txt"), "edit\n"); // 추적 파일 편집(index도 HEAD도 그대로)
  writeFileSync(join(wtA, "d.txt"), "d\n"); // 추적하지 않는 새 파일
  const soon = await tick(t + 10_000);
  assert.equal(byPath(soon.ws, wtA)!.dirty, 0); // 30초가 안 됐다(예전과 같은 신선도)
  const later = await tick(t + 31_000);
  assert.equal(byPath(later.ws, wtA)!.dirty, 3);
  git(wtA, "reset", "-q", "--hard");
  git(wtA, "clean", "-qfd");
  const clean = await tick(t + 62_000);
  assert.equal(byPath(clean.ws, wtA)!.dirty, 0);
});

test("워크트리를 더하고 지우면 다음 틱에 보인다", async () => {
  g.resetWorkspaceCache();
  await tick();
  const wtB = join(root, "wt-b");
  git(repo, "worktree", "add", "-q", "-b", "other", wtB);
  const added = await tick(t + 2_000);
  assert.deepEqual(added.ws.map((w) => w.path), [repo, wtA, wtB]);
  assert.equal(byPath(added.ws, wtB)!.dirty, 0);
  git(repo, "worktree", "remove", wtB);
  const removed = await tick(t + 4_000);
  assert.deepEqual(removed.ws.map((w) => w.path), [repo, wtA]);
});

test("작업 트리 폴더를 지우면(prunable) 그 틱부터 빠진다", async () => {
  g.resetWorkspaceCache();
  const wtC = join(root, "wt-c");
  git(repo, "worktree", "add", "-q", "-b", "gone", wtC);
  assert.ok(byPath((await tick()).ws, wtC));
  rmSync(wtC, { recursive: true, force: true });
  assert.equal(byPath((await tick(t + 2_000)).ws, wtC), undefined);
  git(repo, "worktree", "prune");
});

test("저장소가 아닌 AIRPORT 경로는 빈 목록이고, 다음 틱부터 git을 띄우지 않는다", async () => {
  g.resetWorkspaceCache();
  const plain = join(root, "plain");
  mkdirSync(plain);
  const first = await g.readWorkspaces([plain], t);
  assert.deepEqual(first, []);
  const s0 = g.gitSpawns();
  assert.deepEqual(await g.readWorkspaces([plain], t + 2_000), []);
  assert.equal(g.gitSpawns() - s0, 0);
});

test("같은 저장소가 두 번 등록돼도 예전처럼 두 번 나오고 git은 한 벌만 돈다", async () => {
  g.resetWorkspaceCache();
  await tick();
  const s0 = g.gitSpawns();
  const ws = await g.readWorkspaces([repo, repo], t + 1_000);
  assert.equal(ws.length, 4);
  assert.equal(g.gitSpawns() - s0, 0);
});

test("셸 하나가 여러 워크트리의 status를 돌아도 워크트리마다 git status와 같은 수다", async () => {
  g.resetWorkspaceCache();
  const many = Array.from({ length: 9 }, (_, i) => join(root, `wt-m${i}`));
  many.forEach((p, i) => {
    git(repo, "worktree", "add", "-q", "-b", `m${i}`, p);
    for (let k = 0; k < i % 4; k++) writeFileSync(join(p, `n${k}.txt`), "x\n");
  });
  const { ws } = await tick();
  for (const p of many) assert.equal(byPath(ws, p)!.dirty, git(p, "status", "--porcelain").split("\n").filter(Boolean).length, p);
  for (const p of many) git(repo, "worktree", "remove", "--force", p);
});

test("parseStatusBatch: 워크트리마다 변경 수, 실패는 null, 못 간 것은 undefined", () => {
  const out = " M a.txt\n?? b.txt\n\x000\n\x00128\nA  c.txt\n\x000\n";
  assert.deepEqual(g.parseStatusBatch(out, 4), [2, null, 1, undefined]);
  assert.deepEqual(g.parseStatusBatch("", 1), [undefined]);
});

test("unpushedCounts: head마다 원격에 없는 조상 수", () => {
  // c3 → c2 → (c1은 원격에 있어 답에 없다), m 은 c2와 x의 머지
  const rev = ["c3 c2", "c2 c1", "m c2 x", "x c1"].join("\n");
  const n = g.unpushedCounts(rev, ["c3", "m", "c1", "c2"]);
  assert.deepEqual(Object.fromEntries(n), { c3: 2, m: 3, c1: 0, c2: 1 });
});

test("pushedOf: for-each-ref refs/remotes/origin/<branch>처럼 그 아래 ref도 함께 본다", () => {
  const o: [string, string][] = [
    ["refs/remotes/origin/feat", "aaa"],
    ["refs/remotes/origin/feat-2", "bbb"],
    ["refs/remotes/origin/x", "ccc"],
    ["refs/remotes/origin/x/y", "ddd"],
  ];
  assert.equal(g.pushedOf(o, "feat", "aaa"), true); // feat-2는 그 아래가 아니다
  assert.equal(g.pushedOf(o, "x", "ccc"), false); // x/y도 걸려 두 줄이 된다(예전 명령과 같다)
  assert.equal(g.pushedOf(o, "none", "aaa"), false);
  assert.equal(g.pushedOf(o, null, "aaa"), null);
});

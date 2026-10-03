import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { commandAllowed, depsKey, emptyRepoEntry, parseRepos, remoteListFor, repoCounts, repoEntryOf, repoKeyOf, UNKNOWN_REPO } from "./gate-repo.ts";
import { REMOTE_COMMANDS, routeOf } from "./verify-remote.ts";

describe("repoKeyOf: 저장소 맨 위 폴더 이름", () => {
  test("공통 .git이 있는 폴더 이름(워크트리도 본 저장소 이름)", () => {
    assert.equal(repoKeyOf("/home/u/projects/made-up-app/.git", "/home/u/projects/made-up-app/.claude/worktrees/x"), "made-up-app");
  });
  test("bare 저장소는 .git 접미어를 뗀다, git이 아니면 작업 폴더 이름", () => {
    assert.equal(repoKeyOf("/srv/repos/made-up.git", "/x"), "made-up");
    assert.equal(repoKeyOf(null, "/tmp/some-folder"), "some-folder");
  });
  test("전체 경로나 이상한 이름은 키가 되지 않는다", () => {
    assert.equal(repoKeyOf(null, "/"), UNKNOWN_REPO);
    assert.equal(repoKeyOf("/a/b c/.git", "/a/b c"), UNKNOWN_REPO);
    assert.ok(!repoKeyOf("/home/u/projects/made-up-app/.git", "/").includes("/"));
  });
});

describe("parseRepos: 저장소별 설정", () => {
  test("목록과 Chrome 경로를 읽는다", () => {
    const r = parseRepos({ "made-up-app": { remoteCommands: [["pretend", "lint"], ["pretend", "build", "--fast"]], browserExecutable: "/opt/chrome/chrome" } });
    assert.deepEqual(r["made-up-app"], { remoteCommands: [["pretend", "lint"], ["pretend", "build", "--fast"]], browserExecutable: "/opt/chrome/chrome" });
  });
  test("틀린 칸은 버린다: 빈 목록이 안전한 쪽", () => {
    const r = parseRepos({
      a: { remoteCommands: "npm test", browserExecutable: "relative/chrome" },
      b: { remoteCommands: [[], [1], ["x\ny"], "z", ["ok"]], browserExecutable: "/a/../chrome" },
      "bad name": { remoteCommands: [["x"]] },
      c: null,
    });
    assert.deepEqual(r.a, emptyRepoEntry());
    assert.deepEqual(r.b, { remoteCommands: [["ok"]], browserExecutable: null });
    assert.equal(r["bad name"], undefined);
    assert.equal(r.c, undefined);
    assert.deepEqual(parseRepos(null), {});
    assert.deepEqual(parseRepos([]), {});
  });
  test("항목이 없는 저장소는 빈 설정", () => {
    assert.deepEqual(repoEntryOf({}, "nobody"), emptyRepoEntry());
    assert.deepEqual(repoEntryOf({}, "__proto__"), emptyRepoEntry());
  });
});

describe("허용 목록", () => {
  const list = [["pretend", "lint"], ["pretend", "build", "--fast"]];
  test("낱말 하나까지 같아야 한다(접두어도 안 된다)", () => {
    assert.ok(commandAllowed(list, ["pretend", "lint"]));
    assert.ok(!commandAllowed(list, ["pretend", "lint", "--fix"]));
    assert.ok(!commandAllowed(list, ["pretend"]));
    assert.ok(!commandAllowed([], ["pretend", "lint"]));
  });
  test("atc는 박힌 목록, 다른 저장소는 repos.json의 목록뿐", () => {
    const entry = { remoteCommands: list, browserExecutable: null };
    assert.equal(remoteListFor(true, emptyRepoEntry(), REMOTE_COMMANDS), REMOTE_COMMANDS);
    assert.equal(remoteListFor(false, entry, REMOTE_COMMANDS), list);
    assert.deepEqual(remoteListFor(false, emptyRepoEntry(), REMOTE_COMMANDS), []);
  });
  test("다른 저장소가 npm test를 적지 않았으면 npm test도 데스크톱에 가지 않는다", () => {
    const target = { host: "desk", user: "u", port: 22, identityFile: null };
    const base = { remote: "on" as const, atRepoRoot: true, target };
    assert.deepEqual(routeOf({ ...base, argv: ["npm", "test"], commands: [] }), { where: "local", reason: "not-listed" });
    assert.deepEqual(routeOf({ ...base, argv: ["pretend", "lint"], commands: list }), { where: "desktop" });
    assert.deepEqual(routeOf({ ...base, argv: ["pretend", "lint"], commands: [] }), { where: "local", reason: "not-listed" });
    assert.deepEqual(routeOf({ ...base, argv: ["npm", "test"] }), { where: "desktop" }); // 기본은 atc의 세 명령
    assert.deepEqual(routeOf({ ...base, remote: "off", argv: ["pretend", "lint"], commands: list }), { where: "local", reason: "switch-off" });
  });
});

describe("depsKey: 저장소마다 의존 캐시가 따로", () => {
  test("같은 lock이어도 저장소가 다르면 열쇠가 다르다", () => {
    const a = depsKey("made-up-a", false, "lock");
    const b = depsKey("made-up-b", false, "lock");
    assert.notEqual(a, b);
    assert.match(a, /^[0-9a-f]{16}$/);
    assert.equal(a, depsKey("made-up-a", false, "lock"));
  });
  test("atc 자신은 옛 열쇠(lock 내용만)라 이미 만든 캐시를 쓴다", () => {
    assert.equal(depsKey("atc", true, "lock"), depsKey("anything", true, "lock"));
    assert.notEqual(depsKey("atc", true, "lock"), depsKey("atc", false, "lock"));
  });
});

describe("repoCounts: 폴더 이름별 전체·최근 7일", () => {
  const now = Date.parse("2026-10-03T00:00:00Z");
  const day = 86_400_000;
  const at = (d: number, repo?: string) => ({ t: new Date(now - d * day).toISOString(), ...(repo ? { repo } : {}) });
  test("센다, 많은 쪽이 먼저, repo가 없는 줄은 unknown", () => {
    const c = repoCounts([at(1, "made-up-a"), at(2, "made-up-a"), at(30, "made-up-a"), at(1, "made-up-b"), at(1)], now);
    assert.deepEqual(c, [
      { repo: "made-up-a", total: 3, last7d: 2 },
      { repo: "made-up-b", total: 1, last7d: 1 },
      { repo: UNKNOWN_REPO, total: 1, last7d: 1 },
    ]);
  });
  test("경로가 들어 있는 repo 값은 폴더 이름으로 보이지 않는다", () => {
    assert.deepEqual(repoCounts([at(1, "/home/u/secret/path")], now), [{ repo: UNKNOWN_REPO, total: 1, last7d: 1 }]);
  });
  test("기록이 없으면 빈 목록", () => {
    assert.deepEqual(repoCounts([], now), []);
  });
});

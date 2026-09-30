import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { applyMemoryPlan, memoryDirOf, memoryPlanOf, memoryView, memStateOf, projectKeyOf, projectKeys } from "./account-memory.ts";

// SHARE MEMORY(ATC-191). 임시 폴더에서만: 진짜 ~/.claude*와 상태 폴더는 건드리지 않는다
const root = realpathSync(mkdtempSync(join(tmpdir(), "atc-account-memory-")));
after(() => rmSync(root, { recursive: true, force: true }));

const SRC = join(root, ".claude");
const A1 = join(root, ".claude-acct-1");
const A3 = join(root, ".claude-acct-3");
const folders = [
  { label: "acct-2", dir: SRC },
  { label: "acct-1", dir: A1 },
  { label: "acct-3", dir: A3 },
];
const KEY = "-home-x-atc";
const put = (dir: string, key: string, name: string, body = "private") => {
  const d = memoryDirOf(dir, key);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, name), body);
};

test("projectKeyOf: 영문·숫자가 아닌 글자는 -", () => {
  assert.equal(projectKeyOf("/home/c10/projects/atc"), "-home-c10-projects-atc");
  assert.equal(projectKeyOf("/a/b.c_d"), "-a-b-c-d");
});

test("memoryPlanOf: 없음·빈 디렉터리는 링크, 링크는 둠, 파일이 든 것은 충돌(이름만)", () => {
  const st = (dir: string) => (dir === A1 ? { kind: "empty" as const } : { kind: "absent" as const });
  const p = memoryPlanOf(folders, SRC, [KEY, KEY], st);
  assert.deepEqual(p.status, { [SRC]: "shared", [A1]: "separate", [A3]: "separate" });
  assert.equal(p.actions.length, 2); // 원본 폴더는 건너뛰고 키 중복은 합친다
  assert.deepEqual(p.actions.map((a) => a.op), ["link", "link"]);
  const c = memoryPlanOf(folders, SRC, [KEY], (d) => (d === A1 ? { kind: "files", names: ["b.md", "a.md"] } : { kind: "link", target: memoryDirOf(SRC, KEY) }));
  assert.equal(c.status[A1], "conflict");
  assert.equal(c.status[A3], "shared");
  const conflict = c.actions.find((a) => a.op === "conflict");
  assert.deepEqual(conflict && "names" in conflict && conflict.names, ["b.md", "a.md"]);
  const other = memoryPlanOf(folders, SRC, [KEY], () => ({ kind: "link", target: "/elsewhere" }));
  assert.equal(other.actions.every((a) => a.op === "keep"), true);
});

test("apply: 없는 것과 빈 디렉터리를 잇고, 링크로 쓴 memory가 원본에 나타난다", () => {
  put(SRC, KEY, "rules.md", "SRC-BODY");
  mkdirSync(memoryDirOf(A1, KEY), { recursive: true }); // 빈 디렉터리
  const r = applyMemoryPlan(memoryPlanOf(folders, SRC, [KEY], memStateOf));
  assert.deepEqual([r.linked, r.conflicts, r.errors.length], [2, 0, 0]);
  for (const d of [A1, A3]) {
    assert.equal(lstatSync(memoryDirOf(d, KEY)).isSymbolicLink(), true);
    assert.equal(readlinkSync(memoryDirOf(d, KEY)), memoryDirOf(SRC, KEY));
  }
  assert.equal(readFileSync(join(memoryDirOf(A3, KEY), "rules.md"), "utf8"), "SRC-BODY");
  writeFileSync(join(memoryDirOf(A3, KEY), "new.md"), "from-acct-3");
  assert.equal(readFileSync(join(memoryDirOf(SRC, KEY), "new.md"), "utf8"), "from-acct-3");
  const again = applyMemoryPlan(memoryPlanOf(folders, SRC, [KEY], memStateOf));
  assert.deepEqual([again.linked, again.kept], [0, 2]); // 두 번째는 할 일이 없다
  assert.equal(memoryView(folders as never, SRC, [KEY]).every((v) => v.status === "shared"), true);
});

test("apply: 파일이 든 디렉터리는 지우지도 잇지도 않는다", () => {
  const key = "-home-x-other";
  put(SRC, key, "s.md");
  put(A1, key, "mine.md", "keep-me");
  const plan = memoryPlanOf(folders, SRC, [key], memStateOf);
  const view = memoryView(folders as never, SRC, [key]);
  assert.deepEqual(view.find((v) => v.dir === A1)?.conflicts, [{ key, names: ["mine.md"] }]);
  const r = applyMemoryPlan(plan);
  assert.deepEqual([r.linked, r.conflicts], [1, 1]); // A3만 이어진다
  assert.equal(lstatSync(memoryDirOf(A1, key)).isSymbolicLink(), false);
  assert.equal(readFileSync(join(memoryDirOf(A1, key), "mine.md"), "utf8"), "keep-me");
});

test("apply: 계획 뒤에 파일이 생기면 링크하지 않는다", () => {
  const key = "-home-x-race";
  mkdirSync(memoryDirOf(A1, key), { recursive: true });
  const plan = memoryPlanOf([folders[1]], SRC, [key], memStateOf);
  writeFileSync(join(memoryDirOf(A1, key), "late.md"), "x");
  const r = applyMemoryPlan(plan);
  assert.deepEqual([r.linked, r.conflicts], [0, 1]);
  assert.equal(existsSync(join(memoryDirOf(A1, key), "late.md")), true);
});

test("다른 곳을 가리키는 링크는 그대로 둔다", () => {
  const key = "-home-x-link";
  mkdirSync(join(A1, "projects", key), { recursive: true });
  const other = join(root, "elsewhere");
  mkdirSync(other);
  symlinkSync(other, memoryDirOf(A1, key));
  const r = applyMemoryPlan(memoryPlanOf([folders[1]], SRC, [key], memStateOf));
  assert.deepEqual([r.linked, r.kept], [0, 1]);
  assert.equal(readlinkSync(memoryDirOf(A1, key)), other);
});

test("projectKeys: 체크아웃과 AIRPORT 경로, 중복 없이", () => {
  const real = join(root, "proj");
  mkdirSync(real);
  const alias = join(root, "alias");
  symlinkSync(real, alias);
  const keys = projectKeys("/x/atc", [real, alias, ""]);
  assert.deepEqual(keys.sort(), [projectKeyOf("/x/atc"), projectKeyOf(real), projectKeyOf(alias)].sort());
});

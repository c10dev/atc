import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { runFold } from "./changelog-fold.ts";
import { foldChangelog, pairFragments, parseFragment } from "./changelog.ts";

const EN = `# Changelog

Intro.

## [Unreleased]

### Security
- Old security entry.

### Changed
- Old changed entry.
  - Its detail.

### Added
- Old added entry.

## [0.1.0] — 2026-09-26

### Added
- Released entry.
`;

const KO = `# 변경 기록

## [Unreleased]

### 보안
- 옛 보안 항목.

### 바뀜
- 옛 바뀜 항목.

### 추가
- 옛 추가 항목.

## [0.1.0] — 2026-09-26

### 추가
- 릴리스된 항목.
`;

// 원래 줄이 모두 같은 순서로 남는가
const keepsAll = (before: string, after: string) => {
  const rest = after.split("\n");
  let i = 0;
  for (const l of before.split("\n")) {
    while (i < rest.length && rest[i] !== l) i++;
    assert.ok(i < rest.length, `사라진 줄: ${l}`);
    i++;
  }
};
const released = (t: string) => t.slice(t.indexOf("## [0.1.0]"));

test("both languages: each entry goes on top of its section, Korean 바뀜 counts as Changed", () => {
  const en = foldChangelog(EN, "en", [{ name: "ATC-64", text: "### Changed\n- New changed.\n  - Detail.\n\n### Added\n- New added.\n" }]);
  const ko = foldChangelog(KO, "ko", [{ name: "ATC-64", text: "### 변경\n- 새 변경.\n  - 자세히.\n\n### 추가\n- 새 추가.\n" }]);
  assert.deepEqual(en.folded, ["ATC-64"]);
  assert.match(en.text, /### Changed\n- New changed\.\n {2}- Detail\.\n- Old changed entry\./);
  assert.match(en.text, /### Added\n- New added\.\n- Old added entry\./);
  assert.match(ko.text, /### 바뀜\n- 새 변경\.\n {2}- 자세히\.\n- 옛 바뀜 항목\./);
  assert.match(ko.text, /### 추가\n- 새 추가\.\n- 옛 추가 항목\.\n\n## \[0\.1\.0\]/);
  keepsAll(EN, en.text);
  keepsAll(KO, ko.text);
  assert.equal(released(en.text), released(EN));
  assert.equal(released(ko.text), released(KO));
});

test("a missing section is created after the last earlier one in Keep a Changelog order", () => {
  const r = foldChangelog(EN, "en", [{ name: "x", text: "### Fixed\n- A fix.\n" }]);
  assert.match(r.text, /- Old added entry\.\n\n### Fixed\n- A fix\.\n\n## \[0\.1\.0\]/);
  const ko = foldChangelog(KO, "ko", [{ name: "x", text: "### Fixed\n- 고침.\n" }]);
  assert.match(ko.text, /### 수정\n- 고침\.\n\n## \[0\.1\.0\]/);
  // 앞 절이 없으면 첫 절 앞
  const noAdded = "## [Unreleased]\n\n### Fixed\n- f.\n\n## [0.1.0]\n";
  assert.equal(foldChangelog(noAdded, "en", [{ name: "x", text: "### Added\n- a." }]).text, "## [Unreleased]\n\n### Added\n- a.\n\n### Fixed\n- f.\n\n## [0.1.0]\n");
});

test("an empty [Unreleased] gets its sections in order", () => {
  const empty = "# C\n\n## [Unreleased]\n\n## [0.1.0]\n\n### Added\n- r.\n";
  const r = foldChangelog(empty, "en", [{ name: "x", text: "### Fixed\n- f.\n\n### Added\n- a.\n" }]);
  assert.equal(r.text, "# C\n\n## [Unreleased]\n\n### Added\n- a.\n\n### Fixed\n- f.\n\n## [0.1.0]\n\n### Added\n- r.\n");
  const tight = foldChangelog("## [Unreleased]\n## [0.1.0]\n", "en", [{ name: "x", text: "### Added\n- a." }]);
  assert.equal(tight.text, "## [Unreleased]\n\n### Added\n- a.\n\n## [0.1.0]\n");
});

test("an empty set changes nothing", () => {
  assert.equal(foldChangelog(EN, "en", []).text, EN);
  assert.deepEqual(pairFragments([]), { pairs: [], unpaired: [] });
});

test("a repeat run changes nothing, and later names end up on top", () => {
  const frags = [
    { name: "ATC-10", text: "### Added\n- Ten." },
    { name: "ATC-9", text: "### Added\n- Nine." },
  ];
  const once = foldChangelog(EN, "en", frags).text;
  assert.match(once, /### Added\n- Ten\.\n- Nine\.\n- Old added entry\./);
  const twice = foldChangelog(once, "en", frags);
  assert.equal(twice.text, once);
  assert.deepEqual(twice.folded, ["ATC-9", "ATC-10"]);
  // 기존 항목의 앞부분과 같은 한 줄은 이미 있는 것으로 보지 않는다
  assert.match(foldChangelog(EN, "en", [{ name: "x", text: "### Added\n- Old added" }]).text, /### Added\n- Old added\n- Old added entry\./);
});

test("pairing: README is not a fragment; a missing language is reported", () => {
  const { pairs, unpaired } = pairFragments([
    { file: "README.md", text: "" },
    { file: "README.ko.md", text: "" },
    { file: "ATC-64.md", text: "e" },
    { file: "ATC-64.ko.md", text: "k" },
    { file: "ATC-65.md", text: "e" },
    { file: "ATC-66.ko.md", text: "k" },
    { file: "notes.txt", text: "" },
  ]);
  assert.deepEqual(pairs, [{ name: "ATC-64", en: "e", ko: "k" }]);
  assert.deepEqual(unpaired, ["ATC-65.md (ATC-65.ko.md 없음)", "ATC-66.ko.md (ATC-66.md 없음)", "notes.txt"]);
});

test("fragment format errors", () => {
  assert.deepEqual(parseFragment("### Added\n- a.\n#### Detail\n- b.\n").errors, []);
  assert.match(parseFragment("- no heading\n### Added\n- a.").errors[0], /첫 절 제목/);
  assert.match(parseFragment("## [Unreleased]\n### Added\n- a.").errors[0], /절 제목은/);
  assert.match(parseFragment("### Misc\n- a.").errors[0], /절 제목은/);
  assert.match(parseFragment("### Added\n\n").errors[0], /항목이 없음/);
  assert.match(parseFragment("").errors[0], /절이 없음/);
  const bad = foldChangelog(EN, "en", [{ name: "bad", text: "- x" }]);
  assert.equal(bad.text, EN);
  assert.deepEqual(bad.folded, []);
  assert.equal(bad.errors[0].name, "bad");
});

// 임시 저장소에 CHANGELOG 두 개와 조각을 두고 CLI를 돌린다
const repo = (frags: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), "atc-changelog-"));
  writeFileSync(join(root, "CHANGELOG.md"), EN);
  writeFileSync(join(root, "CHANGELOG.ko.md"), KO);
  mkdirSync(join(root, "changelog.d"));
  writeFileSync(join(root, "changelog.d", "README.md"), "# changelog.d\n");
  for (const [f, t] of Object.entries(frags)) writeFileSync(join(root, "changelog.d", f), t);
  return root;
};
const read = (root: string, f: string) => readFileSync(join(root, f), "utf8");

test("fold script: both languages folded, fragments deleted, a repeat run is a no-op", () => {
  const root = repo({ "ATC-64.md": "### Fixed\n- Fixed it.\n", "ATC-64.ko.md": "### 수정\n- 고쳤다.\n" });
  try {
    assert.equal(runFold(root, true).code, 0);
    assert.equal(read(root, "CHANGELOG.md"), EN); // --check는 바꾸지 않는다
    const r = runFold(root, false);
    assert.equal(r.code, 0);
    assert.match(read(root, "CHANGELOG.md"), /### Fixed\n- Fixed it\./);
    assert.match(read(root, "CHANGELOG.ko.md"), /### 수정\n- 고쳤다\./);
    assert.deepEqual(readdirSync(join(root, "changelog.d")), ["README.md"]);
    const after = [read(root, "CHANGELOG.md"), read(root, "CHANGELOG.ko.md")];
    assert.deepEqual(runFold(root, false), { code: 0, out: ["접을 조각 없음."] });
    assert.deepEqual([read(root, "CHANGELOG.md"), read(root, "CHANGELOG.ko.md")], after);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fold script: a missing language pair or a bad fragment changes nothing", () => {
  const root = repo({ "ATC-64.md": "### Added\n- a.\n", "ATC-64.ko.md": "### 추가\n- 가.\n", "ATC-65.md": "### Added\n- b.\n" });
  try {
    const r = runFold(root, false);
    assert.equal(r.code, 1);
    assert.match(r.out[0], /짝 없음: changelog\.d\/ATC-65\.md/);
    assert.equal(read(root, "CHANGELOG.md"), EN);
    assert.equal(read(root, "CHANGELOG.ko.md"), KO);
    assert.ok(existsSync(join(root, "changelog.d", "ATC-64.md")));
    writeFileSync(join(root, "changelog.d", "ATC-65.ko.md"), "추가\n- 나.\n");
    const bad = runFold(root, false);
    assert.equal(bad.code, 1);
    assert.match(bad.out[0], /형식: changelog\.d\/ATC-65\.ko\.md/);
    assert.equal(read(root, "CHANGELOG.ko.md"), KO);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fold script: no changelog.d folder is an empty set", () => {
  const root = repo({});
  try {
    rmSync(join(root, "changelog.d"), { recursive: true });
    assert.deepEqual(runFold(root, false), { code: 0, out: ["접을 조각 없음."] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// 이 저장소의 조각: 모두 짝이 있고 형식이 맞아야 한다(CI가 PR마다 본다)
test("this repository's changelog.d fragments are paired and fold cleanly", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const tmp = mkdtempSync(join(tmpdir(), "atc-changelog-repo-"));
  try {
    for (const f of ["CHANGELOG.md", "CHANGELOG.ko.md"]) cpSync(join(root, f), join(tmp, f));
    if (existsSync(join(root, "changelog.d"))) cpSync(join(root, "changelog.d"), join(tmp, "changelog.d"), { recursive: true });
    const r = runFold(tmp, false);
    assert.equal(r.code, 0, r.out.join("\n"));
    keepsAll(read(root, "CHANGELOG.md"), read(tmp, "CHANGELOG.md"));
    keepsAll(read(root, "CHANGELOG.ko.md"), read(tmp, "CHANGELOG.ko.md"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

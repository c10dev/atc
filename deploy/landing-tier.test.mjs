import assert from "node:assert/strict";
import { test } from "node:test";
import { tierOf } from "./landing-tier.mjs";

test("서버·화면·문서만 바꾸면 auto", () => {
  assert.equal(tierOf(["server/routes.ts", "web/src/views/RouteMap.tsx", "docs/routes.md", "CHANGELOG.md", "README.ko.md"]).tier, "auto");
});

test("관제 세션 매뉴얼·CLI는 flagged", () => {
  assert.equal(tierOf(["server/proposals.ts", "occ/CLAUDE.md"]).tier, "flagged");
  assert.equal(tierOf(["controller/atcctl.mjs"]).tier, "flagged");
  assert.equal(tierOf(["crosscheck/CLAUDE.md"]).tier, "flagged");
  assert.equal(tierOf(["review/CLAUDE.md"]).tier, "flagged");
  assert.equal(tierOf(["review/read-guard.mjs"]).tier, "user");
  assert.equal(tierOf(["mcc/CLAUDE.md"]).tier, "flagged");
  assert.equal(tierOf(["mcc/read-guard.mjs"]).tier, "user");
  assert.equal(tierOf(["mcc/.claude/settings.json"]).tier, "user");
  assert.equal(tierOf(["occ/.claude/skills/tick/SKILL.md"]).tier, "flagged");
});

test("guard 테스트만 바꾸면 flagged, guard 코드는 user", () => {
  assert.equal(tierOf(["controller/guard.test.mjs"]).tier, "flagged");
  assert.equal(tierOf(["controller/guard.mjs"]).tier, "user");
  assert.equal(tierOf(["occ/send-guard.mjs"]).tier, "user");
  assert.equal(tierOf(["occ/mcp-guard.mjs"]).tier, "user");
  assert.equal(tierOf(["crosscheck/read-guard.mjs"]).tier, "user");
});

test("설정·지침·CI·의존성·hook·배포는 user", () => {
  for (const f of [
    "occ/.claude/settings.json",
    ".claude/skills/atc-task/SKILL.md",
    ".claude/settings.json",
    "CLAUDE.md",
    "CLAUDE.en.md",
    ".github/workflows/ci.yml",
    "package.json",
    "package-lock.json",
    "hooks/claim.mjs",
    "deploy/atc.service",
    "deploy/landing-tier.mjs",
  ]) assert.equal(tierOf([f]).tier, "user", f);
  assert.equal(tierOf(["deploy/README.md", "deploy/README.ko.md"]).tier, "auto");
});

test("폴더 CLAUDE.md는 루트가 아니라 flagged", () => {
  assert.equal(tierOf(["occ/CLAUDE.en.md"]).tier, "flagged");
});

test("가장 높은 등급을 쓰고 이유를 남긴다", () => {
  const r = tierOf(["server/a.ts", "occ/CLAUDE.md", "controller/guard.mjs", ""]);
  assert.equal(r.tier, "user");
  assert.deepEqual(r.reasons.map((x) => x.tier), ["flagged", "user"]);
});

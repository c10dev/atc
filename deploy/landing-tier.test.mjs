import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { READ_ONLY, SIDE_EFFECT, tierOf } from "./landing-tier.mjs";

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

test("외부 부작용 서버 파일은 flagged, 읽기 전용은 auto", () => {
  for (const [f] of SIDE_EFFECT) {
    const r = tierOf([f]);
    assert.equal(r.tier, "flagged", f);
    assert.equal(r.reasons[0].why, "외부 부작용", f);
  }
  for (const [f] of READ_ONLY) assert.equal(tierOf([f]).tier, "auto", f);
  assert.equal(tierOf(["server/autoland-run.test.ts", "server/autoland.ts"]).tier, "auto");
  assert.equal(tierOf(["server/mcc-run.ts", "controller/guard.mjs"]).tier, "user");
});

test("목록은 실제 파일이고 두 목록에 겹치지 않는다", () => {
  const side = SIDE_EFFECT.map(([f]) => f);
  const read = READ_ONLY.map(([f]) => f);
  for (const f of [...side, ...read]) assert.ok(existsSync(f), `${f} 없음 — deploy/landing-tier.mjs 목록에서 지우거나 옮길 것`);
  assert.equal(new Set([...side, ...read]).size, side.length + read.length, "같은 파일이 SIDE_EFFECT와 READ_ONLY(또는 한 목록에 두 번)에 있음");
});

// 명령을 돌리거나 GET 아닌 fetch를 하는 server 파일이 등급 없이 auto로 들어오지 못하게 한다
function serverSources(dir = "server") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) return serverSources(p);
    return /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [p] : [];
  });
}

test("명령·비GET fetch를 쓰는 server 파일은 모두 등급 목록에 있다", () => {
  const listed = new Set([...SIDE_EFFECT, ...READ_ONLY].map(([f]) => f));
  const missing = serverSources().filter((f) => {
    const src = readFileSync(f, "utf8");
    const runsCommands = /from\s+["'](node:)?child_process["']/.test(src);
    const writesOut = /method:\s*["'](POST|PUT|PATCH|DELETE)["']/i.test(src);
    return (runsCommands || writesOut) && !listed.has(f);
  });
  assert.deepEqual(
    missing,
    [],
    `deploy/landing-tier.mjs의 SIDE_EFFECT(머지·코멘트·쓰기·세션 시작·정지·메시지 전송이 있으면) 또는 READ_ONLY(읽기만 하면)에 올릴 것: ${missing.join(", ")}`,
  );
});

test("가장 높은 등급을 쓰고 이유를 남긴다", () => {
  const r = tierOf(["server/a.ts", "occ/CLAUDE.md", "controller/guard.mjs", ""]);
  assert.equal(r.tier, "user");
  assert.deepEqual(r.reasons.map((x) => x.tier), ["flagged", "user"]);
});

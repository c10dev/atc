import assert from "node:assert/strict";
import { test } from "node:test";
import { depsChangedOf, planRts } from "./rts.mjs";

// package*.json은 의존성이 실제로 바뀔 때만 거절한다(ATC-217)
const A = "a".repeat(40);
const B = "b".repeat(40);
const base = { branch: "main", dirty: false, head: A, service: A, target: B, ancestor: true, ci: "ok", files: ["server/mcc.ts"] };

const lock = (root = {}, extra = {}) =>
  JSON.stringify({ name: "atc", version: "0.1.0", lockfileVersion: 3, packages: { "": { name: "atc", version: "0.1.0", license: "MIT", dependencies: { hono: "^4" }, ...root }, "node_modules/hono": { version: "4.0.0" }, ...extra } });
const pkg = (over = {}) => JSON.stringify({ name: "atc", version: "0.1.0", license: "MIT", scripts: { test: "x" }, dependencies: { hono: "^4" }, devDependencies: { tsx: "^1" }, ...over });
const facts = (o = {}) => ({ fromPkg: pkg(), toPkg: pkg(), fromLock: lock(), toLock: lock(), ...o });

test("depsChangedOf: license·description·scripts·version만 바뀌면 false", () => {
  assert.equal(depsChangedOf(facts()), false);
  assert.equal(depsChangedOf(facts({ toPkg: pkg({ license: "Apache-2.0", description: "d", scripts: { test: "y" }, version: "0.2.0" }), toLock: lock({ license: "Apache-2.0", version: "0.2.0" }) })), false);
  // 키 순서만 다른 것도 같다
  const reordered = JSON.stringify({ devDependencies: { tsx: "^1" }, dependencies: { hono: "^4" }, license: "MIT", name: "atc", version: "0.1.0", scripts: { test: "x" } });
  assert.equal(depsChangedOf(facts({ toPkg: reordered })), false);
});

test("depsChangedOf: 의존성 필드나 잠금 packages가 다르면 true", () => {
  assert.equal(depsChangedOf(facts({ toPkg: pkg({ dependencies: { hono: "^5" } }) })), true);
  assert.equal(depsChangedOf(facts({ toPkg: pkg({ devDependencies: { tsx: "^1", vite: "^7" } }) })), true);
  for (const f of ["optionalDependencies", "peerDependencies", "overrides", "engines", "packageManager"]) {
    assert.equal(depsChangedOf(facts({ toPkg: pkg({ [f]: f === "packageManager" ? "npm@11" : { x: "1" } }) })), true, f);
  }
  assert.equal(depsChangedOf(facts({ toLock: lock({}, { "node_modules/hono": { version: "4.1.0" } }) })), true);
  assert.equal(depsChangedOf(facts({ toLock: lock({ dependencies: { hono: "^4", zod: "^3" } }) })), true);
  assert.equal(depsChangedOf(facts({ toLock: JSON.stringify({ ...JSON.parse(lock()), lockfileVersion: 4 }) })), true);
});

test("depsChangedOf: 읽지 못하거나 파싱하지 못하면 true(fail closed)", () => {
  assert.equal(depsChangedOf(facts({ fromPkg: null })), true);
  assert.equal(depsChangedOf(facts({ toLock: null })), true);
  assert.equal(depsChangedOf(facts({ toPkg: "{" })), true);
  assert.equal(depsChangedOf(facts({ fromLock: "not json" })), true);
  assert.equal(depsChangedOf(facts({ toLock: "{}" })), true);
});

test("planRts: package*.json은 depsChanged가 false일 때만 통과. 모르거나 true면 거절, 유닛 파일은 그대로 거절", () => {
  const files = ["package.json", "package-lock.json", "README.md"];
  assert.equal(planRts({ ...base, files, depsChanged: false }).action, "go");
  for (const depsChanged of [true, undefined]) assert.match(planRts({ ...base, files, depsChanged }).reason, /사용자가 배포.*package\.json.*package-lock\.json/);
  const unit = planRts({ ...base, files: ["package.json", "deploy/atc.service"], depsChanged: false });
  assert.match(unit.reason, /deploy\/atc\.service/);
  assert.doesNotMatch(unit.reason, /package\.json/);
});

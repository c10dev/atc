import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkEnv, environMatches, serverEnv, prodStateDir, refusal, DIR_PREFIX } from "./testserver.mjs";

const home = "/home/x";

test("7700과 범위 밖 포트는 거절한다", () => {
  assert.match(refusal({ port: 7700, home }), /production/);
  assert.match(refusal({ port: 7701, home }), /outside/);
  assert.match(refusal({ port: 8000, home }), /outside/);
  assert.equal(refusal({ port: 7702, home }), null);
  assert.equal(refusal({ port: 7799, home }), null);
});

test("운영 상태 폴더와 임시 폴더가 아닌 곳은 거절한다", () => {
  assert.match(refusal({ port: 7702, stateDir: prodStateDir(home), home }), /production state/);
  assert.match(refusal({ port: 7702, stateDir: join(prodStateDir(home), "x"), home }), /production state/);
  assert.match(refusal({ port: 7702, stateDir: "/home/x/.local/state", home }), /production state/);
  assert.match(refusal({ port: 7702, stateDir: "/home/x/other", home }), /must be/);
  assert.match(refusal({ port: 7702, stateDir: join(tmpdir(), "plain"), home }), /must be/);
  const dir = mkdtempSync(join(tmpdir(), DIR_PREFIX));
  assert.equal(refusal({ port: 7702, stateDir: dir, home }), null);
  rmSync(dir, { recursive: true });
});

test("environ이 이 시험 서버의 것일 때만 맞다", () => {
  const env = ["A=1", "ATC_PORT=7703", "ATC_STATE_DIR=/tmp/atc-ts-a"].join("\0");
  assert.equal(environMatches(env, { port: 7703, dir: "/tmp/atc-ts-a" }), true);
  assert.equal(environMatches(env, { port: 7700, dir: "/tmp/atc-ts-a" }), false);
  assert.equal(environMatches("ATC_PORT=7700\0", { port: 7700, dir: "/tmp/atc-ts-a" }), false);
});

test(".env.local 값은 서버 환경에만 들어가고 확인 명령 환경에는 들어가지 않는다", () => {
  const base = { PATH: "/bin" };
  const dotenv = { LINEAR_API_KEY: "secret" };
  const srv = serverEnv(base, dotenv, { dir: "/tmp/atc-ts-a", port: 7703 });
  assert.equal(srv.LINEAR_API_KEY, "secret");
  assert.equal(srv.ATC_GITHUB, "off");
  assert.equal(srv.ATC_PORT, "7703");
  const chk = checkEnv(base, { url: "http://127.0.0.1:7703", port: 7703 });
  assert.equal("LINEAR_API_KEY" in chk, false);
  assert.equal(chk.ATC_TEST_URL, "http://127.0.0.1:7703");
  assert.deepEqual(base, { PATH: "/bin" });
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { nodeUrl, setup } from "./cloud-setup.mjs";

// ATC-452: 로컬에서는 아무것도 안 하고, cloud에서만 Node 24 다운로드와 npm ci (둘 다 막아 둔 채로)
const HOOK = fileURLToPath(new URL("./cloud-setup.mjs", import.meta.url));
const settings = JSON.parse(readFileSync(new URL("../.claude/settings.json", import.meta.url), "utf8"));

const fixture = (nodeVersion) => {
  const root = mkdtempSync(join(tmpdir(), "atc-cloud-"));
  const calls = [];
  const exec = (cmd) => ({ status: 0, stdout: cmd === "node" ? `${nodeVersion}\n` : "" });
  const stubs = {
    cwd: root,
    home: root,
    exec,
    download: (url, dir) => {
      calls.push(["download", url]);
      mkdirSync(join(dir, "bin"), { recursive: true });
    },
    npmCi: (dir) => {
      calls.push(["npm-ci", dir]);
      mkdirSync(join(dir, "node_modules"));
    },
  };
  return { root, calls, stubs };
};

test("CLAUDE_CODE_REMOTE 없음 또는 false: 아무것도 하지 않는다", () => {
  for (const env of [{}, { CLAUDE_CODE_REMOTE: "false" }]) {
    const f = fixture("v22.1.0");
    assert.deepEqual(setup({ env, ...f.stubs }), []);
    assert.deepEqual(f.calls, []);
    assert.equal(existsSync(join(f.root, "node_modules")), false);
    rmSync(f.root, { recursive: true });
  }
});

test("cloud, node 22: Node 24 내려받기 + PATH를 환경 파일에 남기기 + npm ci", () => {
  const f = fixture("v22.1.0");
  const envFile = join(f.root, "env");
  const done = setup({ env: { CLAUDE_CODE_REMOTE: "true", PATH: "/usr/bin", CLAUDE_ENV_FILE: envFile }, ...f.stubs });
  assert.deepEqual(done, ["node", "path", "npm-ci"]);
  assert.deepEqual(f.calls[0], ["download", nodeUrl()]);
  assert.match(nodeUrl("24.19.0", "x64"), /^https:\/\/nodejs\.org\/dist\/v24\.19\.0\/node-v24\.19\.0-linux-x64\.tar\.xz$/);
  assert.match(readFileSync(envFile, "utf8"), /export PATH=".*atc-node\/v24\.19\.0\/bin:\$PATH"/);
  assert.ok(existsSync(join(f.root, "node_modules")));
  rmSync(f.root, { recursive: true });
});

test("cloud, node 24 + node_modules 있음: 할 일 없음", () => {
  const f = fixture("v24.19.0");
  mkdirSync(join(f.root, "node_modules"));
  assert.deepEqual(setup({ env: { CLAUDE_CODE_REMOTE: "true" }, ...f.stubs }), []);
  assert.deepEqual(f.calls, []);
  rmSync(f.root, { recursive: true });
});

test("스크립트: 로컬에서 exit 0과 빈 출력 / cloud에서 실패해도 exit 0", () => {
  const root = mkdtempSync(join(tmpdir(), "atc-cloud-"));
  const local = spawnSync(process.execPath, [HOOK], { env: { PATH: process.env.PATH, CLAUDE_PROJECT_DIR: root }, encoding: "utf8" });
  assert.equal(local.status, 0);
  assert.equal(local.stderr, "");
  // cloud인 척, node도 npm도 없는 PATH: 실패해도 세션을 막지 않는다
  const cloud = spawnSync(process.execPath, [HOOK], { env: { PATH: "/nonexistent", HOME: root, CLAUDE_CODE_REMOTE: "true", CLAUDE_PROJECT_DIR: root }, encoding: "utf8" });
  assert.equal(cloud.status, 0);
  rmSync(root, { recursive: true });
});

test("settings: SessionStart에 cloud-setup, 로컬에서는 셸이 바로 exit 0", () => {
  const h = settings.hooks.SessionStart[0].hooks.find((x) => x.command.includes("hooks/cloud-setup.mjs"));
  assert.ok(h);
  assert.ok(h.timeout >= 120);
  assert.match(h.command, /^\[ "\$CLAUDE_CODE_REMOTE" = true \] \|\| exit 0;/);
  assert.match(h.command, /; exit 0$/);
  const r = spawnSync("bash", ["-c", h.command], { env: { PATH: process.env.PATH, CLAUDE_PROJECT_DIR: "/nonexistent" }, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
});

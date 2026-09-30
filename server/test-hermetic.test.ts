import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { config } from "./config.ts";
import { hermeticRoot } from "./test-hermetic.ts";

// ATC-190: test-hermetic.ts를 첫 import로 가져온 시험은 진짜 HOME·상태 폴더를 보지 않는다
test("test-hermetic: HOME·상태 폴더·캐시가 임시 폴더로 바뀐다(~/.claude, ~/.local/state/atc가 아니다)", () => {
  assert.ok(hermeticRoot.startsWith(join(tmpdir(), "atc-hermetic-")));
  assert.equal(homedir(), join(hermeticRoot, "home"));
  assert.equal(config.home, join(hermeticRoot, "home"));
  assert.equal(config.claudeDir, join(hermeticRoot, "home", ".claude"));
  assert.equal(config.codexDir, join(hermeticRoot, "home", ".codex"));
  assert.equal(config.claudeBin, join(hermeticRoot, "home", ".local/bin/claude"));
  assert.equal(config.stateDir, join(hermeticRoot, "state"));
  assert.equal(config.airportsFile, join(hermeticRoot, "state", "airports.json"));
  assert.equal(config.cacheDir, join(hermeticRoot, "cache", "atc"));
});

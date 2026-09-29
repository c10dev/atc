import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { blockReason } from "./kill-guard.mjs";

const blocked = [
  'pkill -f "node server/index.ts"',
  "pkill -f server/index.ts",
  "pkill node",
  "pkill -9 -f 'node server/index'",
  "killall node",
  "killall -9 atc",
  "sudo pkill -f atc",
  "FOO=1 pkill -f node",
  "/usr/bin/pkill -f 'node server'",
  "cd /tmp && pkill -f 'node server/index.ts' ; echo done",
  "kill $(pgrep -f 'node server/index.ts')",
  "kill -9 $(pgrep node)",
  "kill `pidof node`",
  "pgrep -f server/index.ts | xargs kill",
  "ps aux | grep node | xargs -r kill -9",
  "fuser -k 7700/tcp",
  "systemctl --user stop atc",
  "systemctl --user restart atc.service",
  "systemctl --user kill atc",
  "systemctl --user disable --now atc",
  "systemctl stop atc",
  "sudo systemctl --user restart atc",
  "systemctl --user try-restart atc",
];
const allowed = [
  "kill 12345",
  "kill -9 12345",
  'kill "$(cat /tmp/x/server.pid)"',
  "node server/index.ts & echo $! > /tmp/x/server.pid",
  '(set -a; . .env.local; set +a; ATC_PORT=7702 node server/index.ts) & echo $! > "$T/server.pid"',
  "pkill vite",
  "killall firefox",
  "systemctl --user start --no-block atc-rts",
  "systemctl --user status atc",
  "systemctl --user stop atc-rts",
  "systemctl --user restart other",
  "journalctl --user -u atc -f",
  "echo 'pkill -f node server/index.ts'",
  "git log --grep pkill",
  "grep -rn 'systemctl --user restart atc' docs",
  "npm test",
  "",
];

test("막는 명령", () => {
  for (const c of blocked) assert.ok(blockReason(c), `막혀야 함: ${c}`);
});

test("통과하는 명령: kill <pid>, PID 파일, atc-rts, 읽기, 따옴표 안의 글", () => {
  for (const c of allowed) assert.equal(blockReason(c), null, `통과해야 함: ${c}`);
});

test("명령이 문자열이 아니면 막는다(fail-closed)", () => {
  assert.ok(blockReason(undefined));
  assert.ok(blockReason(42));
});

test("hook 실행: 막으면 exit 2와 사유(stderr), 통과하면 exit 0, 입력이 깨지면 exit 2", () => {
  const file = fileURLToPath(new URL("./kill-guard.mjs", import.meta.url));
  const run = (input) => spawnSync(process.execPath, [file], { input, encoding: "utf8" });
  const bad = run(JSON.stringify({ tool_name: "Bash", tool_input: { command: 'pkill -f "node server/index.ts"' } }));
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /KILL GUARD/);
  assert.match(bad.stderr, /server\.pid/);
  assert.equal(run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "kill 123" } })).status, 0);
  assert.equal(run("not json").status, 2);
  assert.equal(run("").status, 2);
  assert.equal(run(JSON.stringify({ tool_name: "Bash", tool_input: {} })).status, 2);
});

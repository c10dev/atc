import assert from "node:assert/strict";
import { test } from "node:test";
import { check } from "./guard.mjs";

const HERE = new URL(".", import.meta.url).pathname.replace(/\/$/, "");

const allowed = [
  "node atcctl.mjs brief",
  "node atcctl.mjs brief | jq '.open.conflicts'",
  `node ${HERE}/atcctl.mjs ack abc:12`,
  'node atcctl.mjs issue TEAM_B HOLD --stand vocado-voc-175 -- "DELTA가 끝날 때까지 대기 (a > b 아님)"',
  "node atcctl.mjs readback C-0007 && node atcctl.mjs brief",
];
const blocked = [
  "ls /home/c10/projects/worktrees",
  "cd /home/c10/projects/worktrees/vocado-voc-175 && git status",
  "node atcctl.mjs brief > brief.json",
  "node other.mjs",
  "node /tmp/atcctl.mjs brief",
  "node atcctl.mjs brief; rm -rf /tmp/x",
  "node atcctl.mjs brief $(touch /tmp/x)",
  "cat <<EOF\nhi\nEOF",
  "FOO=1 node atcctl.mjs brief",
  "",
];

for (const c of allowed) test(`허용: ${c.slice(0, 60)}`, () => assert.equal(check(c, HERE), null));
for (const c of blocked) test(`차단: ${JSON.stringify(c).slice(0, 60)}`, () => assert.notEqual(check(c, HERE), null));

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
  "node atcctl.mjs issue TEAM_B INFO -- '$(이건 글자 그대로) `이것도`'",
  'node atcctl.mjs issue TEAM_B INFO -- "가격 \\$5, 100%"',
  "node atcctl.mjs brief | jq '.events[] | select(.kind == $k)' --arg k x",
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
  'node atcctl.mjs brief -- "$(touch /tmp/x)"',
  "node atcctl.mjs brief -- \"`touch /tmp/x`\"",
  "node atcctl.mjs brief -- `touch /tmp/x`",
  'node atcctl.mjs issue TEAM_B INFO -- "${HOME}"',
  'node atcctl.mjs issue TEAM_B INFO -- "경로 $HOME"',
  "jq -r .x <(node atcctl.mjs brief)",
  "",
];

for (const c of allowed) test(`허용: ${c.slice(0, 60)}`, () => assert.equal(check(c, HERE), null));
for (const c of blocked) test(`차단: ${JSON.stringify(c).slice(0, 60)}`, () => assert.notEqual(check(c, HERE), null));

const OCC = HERE.replace(/controller$/, "occ");
test("OCC 폴더에서: ../controller/atcctl.mjs는 허용, 폴더 안 가짜 atcctl.mjs는 차단", () => {
  assert.equal(check("node ../controller/atcctl.mjs dispatch brief | jq '.open'", OCC), null);
  assert.notEqual(check("node atcctl.mjs dispatch brief", OCC), null);
  assert.notEqual(check("cat ../docs/dispatch.md", OCC), null);
});

test("읽기 전용 gh: --gh-read일 때 gh pr view·checks·diff·list만 허용", () => {
  const ok = [
    "gh pr view 400 -R chaehy5665/vocado_nextjs --json state,headRefOid",
    "gh pr checks 400 -R chaehy5665/vocado_nextjs",
    "gh pr diff 400 -R chaehy5665/vocado_nextjs | jq -R .",
    "gh pr list -R chaehy5665/vocado_nextjs --state open",
  ];
  const no = [
    "gh pr merge 400 -R chaehy5665/vocado_nextjs",
    "gh pr comment 400 --body hi",
    "gh pr view 400 --web",
    "gh api repos/chaehy5665/vocado_nextjs/pulls/400",
    "gh issue close 1",
    "gh pr view 400 $(touch /tmp/x)",
    "GH_TOKEN=x gh pr view 400",
  ];
  for (const c of ok) assert.equal(check(c, OCC, { ghRead: true }), null, c);
  for (const c of no) assert.notEqual(check(c, OCC, { ghRead: true }), null, c);
  // TOWER(옵션 없음)에서는 gh 자체가 막힌다
  assert.notEqual(check(ok[0], HERE), null);
});

const CROSSCHECK = HERE.replace(/controller$/, "crosscheck");
test("--crosscheck: atc CLI 중 읽기와 crosscheck 명령만, gh는 막음", () => {
  const opts = { crosscheck: true };
  const ok = [
    "node ../controller/atcctl.mjs manual check",
    "node ../controller/atcctl.mjs manual ack",
    "node ../controller/atcctl.mjs crosscheck brief | jq '.dispatch.pending'",
    "node ../controller/atcctl.mjs dispatch brief",
    "node ../controller/atcctl.mjs dispatch flight VOC-193",
    "node ../controller/atcctl.mjs schedule brief",
    "node ../controller/atcctl.mjs dispatch crosscheck D-0003 agree -- '본문상 제약 없음'",
    "node ../controller/atcctl.mjs schedule crosscheck S-0001 disagree -- '이미 완료됨'",
  ];
  const no = [
    "node ../controller/atcctl.mjs dispatch note D-0003 -- x",
    "node ../controller/atcctl.mjs dispatch release D-0003",
    "node ../controller/atcctl.mjs dispatch readback D-0003",
    "node ../controller/atcctl.mjs schedule draft CLASSIFY VOC-1 --type MAINT -- x",
    "node ../controller/atcctl.mjs schedule release S-0001",
    "node ../controller/atcctl.mjs issue TEAM_B INFO -- x",
    "node ../controller/atcctl.mjs readback C-0001",
    "node ../controller/atcctl.mjs brief",
    "node ../controller/atcctl.mjs",
    "gh pr view 400 -R chaehy5665/vocado_nextjs",
    "node ../controller/atcctl.mjs crosscheck brief > out.json",
  ];
  for (const c of ok) assert.equal(check(c, CROSSCHECK, opts), null, c);
  for (const c of no) assert.notEqual(check(c, CROSSCHECK, opts), null, c);
  // 옵션 없이는 기존 TOWER 규칙 그대로
  assert.equal(check("node ../controller/atcctl.mjs dispatch note D-0003 -- x", CROSSCHECK), null);
});

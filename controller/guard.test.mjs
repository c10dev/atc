import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { check, checkMarkModel, lastModelOf } from "./guard.mjs";

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

test("--crosscheck --gh-read: PR 사실 확인용 gh pr view·checks·list만, 쓰기·diff·api·--web·이은 명령·치환은 막음", () => {
  const opts = { crosscheck: true, ghRead: true };
  const ok = [
    "gh pr view 393 --repo chaehy5665/vocado_nextjs",
    "gh pr view 393 --repo chaehy5665/vocado_nextjs --json state,mergedAt,title",
    "gh pr view 393 --repo chaehy5665/vocado_nextjs --json state,mergedAt | jq -r .state",
    "gh pr checks 393 --repo chaehy5665/vocado_nextjs",
    "gh pr list --repo chaehy5665/vocado_nextjs --state merged --search VOC-190",
    "node ../controller/atcctl.mjs crosscheck brief",
    "node ../controller/atcctl.mjs dispatch crosscheck D-0003 disagree -- 'PR #393 머지 전 — HOLD'",
  ];
  const no = [
    "gh pr merge 393 --repo chaehy5665/vocado_nextjs",
    "gh pr comment 393 --body hi",
    "gh pr review 393 --approve",
    "gh pr close 393",
    "gh pr edit 393 --add-label x",
    "gh pr diff 393 --repo chaehy5665/vocado_nextjs",
    "gh api repos/chaehy5665/vocado_nextjs/pulls/393",
    "gh pr view 393 --web",
    "gh issue view 1",
    "gh pr view 393 && gh pr merge 393",
    "gh pr view 393; gh pr comment 393 --body x",
    "gh pr view 393 | gh pr merge 393",
    "gh pr view $(gh pr merge 393)",
    "gh pr view 393 --json state > out.json",
    "GH_TOKEN=x gh pr view 393",
    "node ../controller/atcctl.mjs dispatch note D-0003 -- x",
  ];
  for (const c of ok) assert.equal(check(c, CROSSCHECK, opts), null, c);
  for (const c of no) assert.notEqual(check(c, CROSSCHECK, opts), null, c);
  // --crosscheck만이면 gh는 계속 막힌다
  for (const c of ["gh pr view 393 --repo chaehy5665/vocado_nextjs", "gh pr checks 393"]) assert.notEqual(check(c, CROSSCHECK, { crosscheck: true }), null, c);
  // OCC(--gh-read만)는 그대로 diff까지
  assert.equal(check("gh pr diff 393 --repo chaehy5665/vocado_nextjs", CROSSCHECK, { ghRead: true }), null);
});

// ── CROSSCHECK mark의 실제 모델 확인 ──

const TMP = mkdtempSync(join(tmpdir(), "atc-guard-"));
after(() => rmSync(TMP, { recursive: true, force: true }));
const line = (type, model) => JSON.stringify({ type, message: { role: type, model, content: [] } });
const transcript = (...models) => ["{\"type\":\"summary\"}", line("user"), ...models.map((m) => line("assistant", m)), line("user")].join("\n") + "\n";
const MARK = "node ../controller/atcctl.mjs dispatch crosscheck D-0003 disagree -- 'PR #393 머지 전이면 HOLD'";

test("lastModelOf: 마지막 assistant의 model, <synthetic>·깨진 줄은 건너뜀", () => {
  assert.equal(lastModelOf(transcript("claude-opus-5-5", "muse-spark-1.3-contributor")), "muse-spark-1.3-contributor");
  assert.equal(lastModelOf(transcript("muse-spark-1.3-contributor", "<synthetic>") + "{not json\n"), "muse-spark-1.3-contributor");
  assert.equal(lastModelOf(transcript()), null);
  assert.equal(lastModelOf(""), null);
});

test("mark 명령: 실제 모델이 Muse·Terra(두 경로 이름)면 그 이름을 붙이고, Claude·DeepSeek·기록 없음·깨짐은 막는다", () => {
  for (const m of ["claude-ocx-opencode-go--muse-spark-1.3-contributor", "muse-spark-1.3-contributor", "claude-ocx-native--gpt-5.6-terra"]) {
    const r = checkMarkModel(MARK, CROSSCHECK, transcript("claude-opus-5-5", m));
    assert.equal(r.reason, undefined, m);
    assert.equal(r.command, `ATC_CROSSCHECK_MODEL='${m}' ${MARK}`);
  }
  for (const m of ["claude-opus-5-5", "claude-sonnet-5", "deepseek-v4.1-flash"]) assert.match(checkMarkModel(MARK, CROSSCHECK, transcript("muse-spark-1.3-contributor", m)).reason, /쓸 수 없음.*Muse/, m);
  assert.match(checkMarkModel(MARK, CROSSCHECK, null).reason, /읽지 못해/);
  assert.match(checkMarkModel(MARK, CROSSCHECK, "{broken\n").reason, /모델이 없어/);
  assert.match(checkMarkModel(MARK, CROSSCHECK, transcript("muse-spark-1.3-contributor'; x")).reason, /쓸 수 없음/); // 명령에 붙일 수 없는 글자
  // 세션이 모델을 적으려 하면 막는다
  assert.match(checkMarkModel("node ../controller/atcctl.mjs dispatch crosscheck D-0003 agree --model muse -- 'x'", CROSSCHECK, transcript("claude-opus-5-5")).reason, /세션이 적지 않는다/);
  assert.match(checkMarkModel(`${MARK} | jq .`, CROSSCHECK, transcript("muse-spark-1.3-contributor")).reason, /단독으로/);
  // 읽기 명령은 확인하지 않는다
  assert.deepEqual(checkMarkModel("node ../controller/atcctl.mjs crosscheck brief", CROSSCHECK, null), { command: "node ../controller/atcctl.mjs crosscheck brief" });
});

// hook CLI를 settings와 같은 방식으로 부른다(stdin JSON → exit code·stdout)
const runHook = (command, transcriptPath, flags = ["--crosscheck", "--gh-read"]) =>
  spawnSync(process.execPath, [join(HERE, "guard.mjs"), ...flags], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command, description: "d" }, cwd: CROSSCHECK, transcript_path: transcriptPath }),
    encoding: "utf8",
  });

test("guard CLI: opus 기록이면 exit 2, muse 기록이면 updatedInput으로 실제 모델을 붙이고, 기록이 없으면 exit 2, 읽기 명령은 기록과 무관", () => {
  const opus = join(TMP, "opus.jsonl");
  const muse = join(TMP, "muse.jsonl");
  writeFileSync(opus, transcript("claude-opus-5-5"));
  writeFileSync(muse, transcript("muse-spark-1.3-contributor"));
  const blocked = runHook(MARK, opus);
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /claude-opus-5-5.*ocx claude/);
  const ok = runHook(MARK, muse);
  assert.equal(ok.status, 0, ok.stderr);
  const out = JSON.parse(ok.stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, "PreToolUse");
  assert.equal(out.updatedInput.command, `ATC_CROSSCHECK_MODEL='muse-spark-1.3-contributor' ${MARK}`);
  assert.equal(out.updatedInput.description, "d");
  assert.equal(runHook(MARK, join(TMP, "none.jsonl")).status, 2);
  assert.equal(runHook(MARK, undefined).status, 2);
  const read = runHook("node ../controller/atcctl.mjs crosscheck brief", undefined);
  assert.equal(read.status, 0);
  assert.equal(read.stdout, "");
  assert.equal(runHook("gh pr view 393 --repo chaehy5665/vocado_nextjs --json state", opus).status, 0);
  // 세션이 앞에 모델을 적으면(환경 변수) 명령 자체가 막힌다
  assert.equal(runHook(`ATC_CROSSCHECK_MODEL='muse-spark-1.3-contributor' ${MARK}`, opus).status, 2);
  // OCC(--crosscheck 없음)는 이 확인을 하지 않는다
  assert.equal(runHook("node ../controller/atcctl.mjs dispatch brief", undefined, ["--gh-read"]).status, 0);
});

// ── jq: 앞 명령의 출력(stdin)만. 파일·환경·모듈을 읽는 길은 막는다 ──
test("jq: TOWER·OCC·CROSSCHECK 모두 파일 인자·파일 옵션·env·import를 막고, | jq '<필터>'는 통과", () => {
  const sessions = [
    ["TOWER", HERE, {}, "node atcctl.mjs brief"],
    ["OCC", OCC, { ghRead: true }, "node ../controller/atcctl.mjs dispatch brief"],
    ["CROSSCHECK", CROSSCHECK, { crosscheck: true, ghRead: true }, "node ../controller/atcctl.mjs dispatch brief"],
  ];
  for (const [name, cwd, opts, atc] of sessions) {
    const ok = [
      `${atc} | jq '.open'`,
      `${atc} | jq -r '.open[].id'`,
      `${atc} | jq -rc '.open[] | {id, flight}'`,
      `${atc} | jq --arg k VOC-1 '.open[] | select(.flight == $k)'`,
      `${atc} | jq '.open | length' --argjson n 3 --indent 2`,
      `${atc} | jq -S --tab .`,
      `${atc} | jq '.environment'`,
      `${atc} | jq`,
      `${atc} | jq -- '.open'`,
    ];
    const no = [
      "jq -R . /home/c10/projects/atc/.env.local",
      "jq . ~/.local/state/atc/fleet.json",
      `${atc} | jq . /home/c10/projects/atc/.env.local`,
      `${atc} | jq -R . /home/c10/.local/state/atc/fleet.json`,
      `${atc} | jq '.x' -- /etc/hostname`,
      `${atc} | jq -f /tmp/prog.jq`,
      `${atc} | jq --from-file /tmp/prog.jq`,
      `${atc} | jq -rf /tmp/prog.jq`,
      `${atc} | jq --rawfile s /home/c10/projects/atc/.env.local -n '$s'`,
      `${atc} | jq --slurpfile s /home/c10/.local/state/atc/fleet.json -n '$s'`,
      `${atc} | jq -L /tmp '.x'`,
      `${atc} | jq --library-path /tmp '.x'`,
      `${atc} | jq -n '.' --args a b`,
      `${atc} | jq -n '.' --jsonargs 1 2`,
      `${atc} | jq -n env`,
      `${atc} | jq -n '$ENV'`,
      `${atc} | jq -n '$ENV.LINEAR_API_KEY'`,
      `${atc} | jq '.x as $a | env.HOME'`,
      `${atc} | jq 'import "data" as $d {search: "/home/c10/.local/state/atc"}; $d'`,
      `${atc} | jq 'include "m" {search: "/tmp"}; .'`,
      `${atc} | jq --arg k`,
      `${atc} | jq --unknown-future-option .`,
      "jq -n '1'",
      `${atc} | jq . <(cat /etc/hostname)`,
    ];
    for (const c of ok) assert.equal(check(c, cwd, opts), null, `${name} 통과해야 함: ${c}`);
    for (const c of no) assert.notEqual(check(c, cwd, opts), null, `${name} 막아야 함: ${c}`);
  }
});

test("checkJq: 막는 이유를 알려 준다", async () => {
  const { checkJq } = await import("./guard.mjs");
  assert.equal(checkJq(["jq", "-r", ".x"]), null);
  assert.match(checkJq(["jq", ".", "/etc/passwd"]), /파일을 주지 않는다/);
  assert.match(checkJq(["jq", "--rawfile", "a", "b"]), /--rawfile/);
  assert.match(checkJq(["jq", "-rf", "p"]), /-f/);
  assert.match(checkJq(["jq", "-n", "$ENV"]), /env/);
});

test("gh --jq(-q): 내장 jq도 env·$ENV·import를 막는다(OCC·CROSSCHECK)", async () => {
  const { checkGhJq } = await import("./guard.mjs");
  const gh = "gh pr view 393 --repo chaehy5665/vocado_nextjs --json state,title";
  for (const [cwd, opts] of [[OCC, { ghRead: true }], [CROSSCHECK, { crosscheck: true, ghRead: true }]]) {
    assert.equal(check(`${gh} --jq '.state'`, cwd, opts), null);
    assert.equal(check(`${gh} -q .state`, cwd, opts), null);
    assert.equal(check(`${gh} --template '{{.title}}'`, cwd, opts), null);
    for (const bad of [`${gh} --jq '$ENV.CLAUDE_CODE_MESSAGING_TOKEN'`, `${gh} -q 'env.HOME'`, `${gh} --jq='$ENV'`, `${gh} -q'$ENV'`, `${gh} -cq '$ENV'`,
      `${gh} --jq 'import "d" as $d {search: "/home/c10/.local/state/atc"}; $d'`])
      assert.notEqual(check(bad, cwd, opts), null, bad);
  }
  assert.equal(checkGhJq(["gh", "pr", "view", "1", "--", "-q", "$ENV"]), null); // -- 뒤는 인자
});

import "./test-hermetic.ts"; // 진짜 HOME·상태 폴더를 읽지 않게(ATC-190). 첫 import여야 한다
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { projectKeyOf } from "./account-memory.ts";
import { after, test } from "node:test";
import { addAccount, addPlanOf, addPreviewOf, envKeysOf, replaceableSettings, settingsCopyOf, suggestHomeLabel } from "./account-add.ts";
import { AccountsError, loadAccounts } from "./accounts.ts";
import { config } from "./config.ts";

// ADD ACCOUNT(ATC-186). 임시 HOME에서만: 진짜 ~/.claude와 상태 폴더는 건드리지 않는다
const root = realpathSync(mkdtempSync(join(tmpdir(), "atc-account-add-")));
const real = { home: config.home, claudeDir: config.claudeDir, stateDir: config.stateDir };
config.home = root;
config.claudeDir = join(root, ".claude");
config.stateDir = join(root, "state");
mkdirSync(config.claudeDir);
mkdirSync(config.stateDir);
after(() => {
  Object.assign(config, real);
  rmSync(root, { recursive: true, force: true });
});

const D = config.claudeDir;
const SRC = {
  env: { HTTPS_PROXY: "http://secret-proxy:3128", CLAUDE_CODE_SUBAGENT_MODEL: "x" },
  hooks: { PostToolUse: [{ hooks: [{ type: "command", command: "node /atc/hooks/claim.mjs" }] }] },
  statusLine: { type: "command", command: "node /atc/hooks/fuel-statusline.mjs" },
  theme: "dark",
};
writeFileSync(join(D, "settings.json"), JSON.stringify(SRC));
writeFileSync(join(config.stateDir, "fleet.json"), JSON.stringify({ aircraft: { TEAM_A: { account: "acct-2" }, TEAM_B: { account: "acct-2" }, TEAM_C: { account: "pro" } }, control: { TOWER: { account: "acct-2" } } }));

const throwsAcc = (f: () => unknown, re: RegExp) => assert.throws(f, (e: unknown) => e instanceof AccountsError && re.test(e.message));

test("envKeysOf: 키 이름만, 값은 없다", () => {
  assert.deepEqual(envKeysOf(JSON.stringify(SRC)), ["CLAUDE_CODE_SUBAGENT_MODEL", "HTTPS_PROXY"]);
  assert.deepEqual(envKeysOf(null), []);
  assert.deepEqual(envKeysOf("not json"), []);
  assert.ok(!JSON.stringify(envKeysOf(JSON.stringify(SRC))).includes("secret-proxy"));
});

test("replaceableSettings: 없거나 테마뿐이면 바꾼다, 자기 hook·env·권한이 있거나 깨졌으면 둔다", () => {
  assert.equal(replaceableSettings(null), true);
  assert.equal(replaceableSettings('{\n  "theme": "auto"\n}'), true);
  assert.equal(replaceableSettings("{}"), true);
  for (const k of ["hooks", "statusLine", "env", "permissions", "apiKeyHelper"]) assert.equal(replaceableSettings(JSON.stringify({ [k]: {} })), false, k);
  assert.equal(replaceableSettings("{ broken"), false);
  assert.equal(replaceableSettings("[]"), false);
});

test("settingsCopyOf: 통째로 옮기고 dropEnv만 뺀다. env가 비면 env를 없앤다", () => {
  const out = JSON.parse(settingsCopyOf(JSON.stringify(SRC), ["HTTPS_PROXY"]));
  assert.deepEqual(out.env, { CLAUDE_CODE_SUBAGENT_MODEL: "x" });
  assert.deepEqual(out.hooks, SRC.hooks);
  assert.deepEqual(out.statusLine, SRC.statusLine);
  assert.equal("env" in JSON.parse(settingsCopyOf(JSON.stringify(SRC), ["HTTPS_PROXY", "CLAUDE_CODE_SUBAGENT_MODEL"])), false);
  throwsAcc(() => settingsCopyOf("[]"), /JSON 객체/);
});

test("suggestHomeLabel: 가장 많이 쓴 라벨, 같으면 이름순", () => {
  assert.equal(suggestHomeLabel({ aircraft: { A: { account: "acct-2" }, B: { account: "pro" }, C: { account: "acct-2" } } }), "acct-2");
  assert.equal(suggestHomeLabel({ aircraft: { A: { account: "b" }, B: { account: "a" } } }), "a");
  assert.equal(suggestHomeLabel({ aircraft: { A: {}, B: { account: "Bad Label" } } }), null);
  assert.equal(suggestHomeLabel({}), null);
});

test("addPlanOf: 기본 폴더 ~/.claude-<label>, ~/.claude가 없으면 함께 등록", () => {
  const p = addPlanOf({ label: "acct-1", homeLabel: "acct-2" }, {}, D, root);
  assert.equal(p.dir, join(root, ".claude-acct-1"));
  assert.equal(p.homeRegistered, "acct-2");
  assert.deepEqual(p.registry, { "acct-2": { configDir: D }, "acct-1": { configDir: join(root, ".claude-acct-1") } });
  // ~/.claude가 이미 등록돼 있으면 homeLabel은 필요 없다
  const q = addPlanOf({ label: "acct-3" }, { "acct-2": { configDir: D } }, D, root);
  assert.equal(q.homeRegistered, null);
  assert.deepEqual(Object.keys(q.registry), ["acct-2", "acct-3"]);
  // 폴더를 직접 적을 수도 있다
  assert.equal(addPlanOf({ label: "work", configDir: join(root, ".claude-w") }, { "acct-2": { configDir: D } }, D, root).dir, join(root, ".claude-w"));
});

test("addPlanOf: 잘못된 요청은 던진다", () => {
  const reg = { "acct-2": { configDir: D }, "acct-1": { configDir: join(root, ".claude-acct-1") } };
  throwsAcc(() => addPlanOf({ label: "Acct 1" }, reg, D, root), /라벨/);
  throwsAcc(() => addPlanOf({ label: "acct-1" }, reg, D, root), /이미 등록/);
  throwsAcc(() => addPlanOf({ label: "x", configDir: join(root, ".claude-acct-1") }, reg, D, root), /이미 acct-1로 등록/);
  throwsAcc(() => addPlanOf({ label: "x", configDir: D }, reg, D, root), /새 ACCOUNT가 아님/);
  throwsAcc(() => addPlanOf({ label: "x", configDir: "/etc/.claude-x" }, reg, D, root), /\$HOME 아래/);
  throwsAcc(() => addPlanOf({ label: "x", configDir: join(root, "x") }, reg, D, root), /\.claude로 시작/);
  throwsAcc(() => addPlanOf({ label: "acct-1" }, {}, D, root), /~\/\.claude의 ACCOUNT 라벨/);
  throwsAcc(() => addPlanOf({ label: "acct-1", homeLabel: "acct-1" }, {}, D, root), /같은 라벨/);
  throwsAcc(() => addPlanOf({ label: "b", homeLabel: "a" }, { a: { configDir: join(root, ".claude-a") } }, D, root), /이미 다른 폴더/);
});

test("addPreviewOf: env 키 이름·제안 라벨·원본의 atc 조각, 값은 보내지 않는다", () => {
  const p = addPreviewOf();
  assert.equal(p.homeLabel, null);
  assert.equal(p.suggestHomeLabel, "acct-2");
  assert.deepEqual(p.envKeys, ["CLAUDE_CODE_SUBAGENT_MODEL", "HTTPS_PROXY"]);
  assert.deepEqual(p.source, { statusline: true, claimHook: true, healthHook: false });
  assert.ok(!JSON.stringify(p).includes("secret-proxy"));
});

test("addAccount: 이미 있는 테마뿐인 폴더 → settings를 백업하고 바꾸고, ~/.claude와 함께 등록. 다른 파일은 건드리지 않는다", () => {
  const dir = join(root, ".claude-acct-1");
  mkdirSync(dir);
  writeFileSync(join(dir, "settings.json"), '{\n  "theme": "auto"\n}\n');
  writeFileSync(join(dir, ".credentials.json"), "DO-NOT-TOUCH");
  writeFileSync(join(dir, ".claude.json"), '{"oauthAccount":{"emailAddress":"x@example.com"}}');
  const r = addAccount({ label: "acct-1", homeLabel: "acct-2", dropEnv: ["HTTPS_PROXY"] }, new Date("2026-09-30T08:00:00Z"));
  assert.equal(r.folder, "existed");
  assert.equal(r.settings, "replaced");
  assert.equal(r.homeRegistered, "acct-2");
  assert.equal(r.loginCommand, `CLAUDE_CONFIG_DIR=${dir} claude auth login --claudeai`);
  assert.ok(r.backup && readFileSync(r.backup, "utf8").includes('"auto"'));
  assert.equal(statSync(r.backup).mode & 0o777, 0o600);
  const written = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
  assert.deepEqual(written.env, { CLAUDE_CODE_SUBAGENT_MODEL: "x" });
  assert.deepEqual(written.hooks, SRC.hooks);
  assert.equal(statSync(join(dir, "settings.json")).mode & 0o777, 0o600);
  assert.equal(readFileSync(join(dir, ".credentials.json"), "utf8"), "DO-NOT-TOUCH");
  assert.equal(readFileSync(join(dir, ".claude.json"), "utf8"), '{"oauthAccount":{"emailAddress":"x@example.com"}}');
  assert.deepEqual(loadAccounts(join(config.stateDir, "fleet.json"), root, Date.now() + 10_000), { "acct-2": { configDir: D }, "acct-1": { configDir: dir } });
  // fleet.json의 다른 항목은 그대로
  const fleet = JSON.parse(readFileSync(join(config.stateDir, "fleet.json"), "utf8"));
  assert.equal(fleet.aircraft.TEAM_C.account, "pro");
  assert.equal(fleet.control.TOWER.account, "acct-2");
  // 원본 ~/.claude/settings.json은 그대로
  assert.deepEqual(JSON.parse(readFileSync(join(D, "settings.json"), "utf8")), SRC);
});

test("addAccount: 없는 폴더는 0700으로 만들고 복사한다", () => {
  const r = addAccount({ label: "acct-3" });
  const dir = join(root, ".claude-acct-3");
  assert.equal(r.folder, "created");
  assert.equal(r.settings, "copied");
  assert.equal(r.backup, null);
  assert.equal(r.homeRegistered, null);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).env, SRC.env);
  assert.deepEqual(readdirSync(dir), ["projects", "settings.json"]); // ATC-191: memory 링크(atc 체크아웃 키)
  assert.ok((r.memory?.linked ?? 0) >= 1 && r.memory?.conflicts === 0);
  const link = join(dir, "projects", projectKeyOf(resolve(import.meta.dirname, "..")), "memory");
  assert.equal(readlinkSync(link), join(config.claudeDir, "projects", projectKeyOf(resolve(import.meta.dirname, "..")), "memory"));
});

test("addAccount: 자기 설정이 있는 폴더·symlink settings는 두고 등록만 한다", () => {
  const own = join(root, ".claude-own");
  mkdirSync(own);
  const mine = JSON.stringify({ hooks: { Stop: [] }, env: { MINE: "1" } });
  writeFileSync(join(own, "settings.json"), mine);
  const r = addAccount({ label: "own", configDir: own });
  assert.equal(r.settings, "kept");
  assert.equal(readFileSync(join(own, "settings.json"), "utf8"), mine);

  const linked = join(root, ".claude-linked");
  mkdirSync(linked);
  symlinkSync(join(D, "settings.json"), join(linked, "settings.json"));
  assert.equal(addAccount({ label: "linked", configDir: linked }).settings, "kept");
  assert.deepEqual(JSON.parse(readFileSync(join(D, "settings.json"), "utf8")), SRC);
});

test("addAccount: 막히면 폴더도 등록부도 만들지 않는다", () => {
  throwsAcc(() => addAccount({ label: "acct-1" }), /이미 등록/);
  writeFileSync(join(root, ".claude-file"), "x");
  throwsAcc(() => addAccount({ label: "file", configDir: join(root, ".claude-file") }), /폴더가 아님/);
  assert.equal("file" in loadAccounts(join(config.stateDir, "fleet.json"), root, Date.now() + 20_000), false);
  assert.equal(existsSync(join(root, ".claude-bad")), false);
});

import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { forgetAuthStatus } from "./account-health.ts";
import { cancelLogin, codeOf, loginRefusal, loginUrlOf, loginView, markOnboarded, onboardedOf, startLogin, submitCode, versionOf } from "./account-login.ts";
import { AccountsError } from "./accounts.ts";
import { config } from "./config.ts";
import { saveAccounts } from "./fleet.ts";

// 웹 LOGIN(ATC-187). 임시 HOME과 가짜 claude로만: 진짜 로그인·폴더·상태는 건드리지 않는다
const root = realpathSync(mkdtempSync(join(tmpdir(), "atc-account-login-")));
const real = { home: config.home, claudeDir: config.claudeDir, stateDir: config.stateDir, claudeBin: config.claudeBin, airportsFile: config.airportsFile };
config.home = root;
config.claudeDir = join(root, ".claude");
config.stateDir = join(root, "state");
config.airportsFile = join(root, "state", "airports.json");
config.claudeBin = join(root, "bin", "claude");
for (const d of [config.claudeDir, config.stateDir, join(root, "bin")]) mkdirSync(d, { recursive: true });
after(() => {
  Object.assign(config, real);
  forgetAuthStatus();
  rmSync(root, { recursive: true, force: true });
});

// 가짜 claude: auth status는 폴더의 표시 파일로, auth login은 URL을 찍고 코드를 한 줄 읽는다. GOOD-CODE#s1만 로그인시킨다.
// 출력에 email을 섞어 화면으로 새지 않는지 본다
writeFileSync(
  config.claudeBin,
  `#!/bin/sh
case "$1 $2" in
  "auth status")
    if [ -f "$CLAUDE_CONFIG_DIR/.fake-logged-in" ]; then echo '{"loggedIn":true,"authMethod":"claude.ai","email":"leak@example.com"}'; else echo '{"loggedIn":false}'; fi ;;
  "auth login")
    echo "Opening browser to sign in…"
    echo "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=s1"
    printf "Paste code here if prompted > "
    read code
    if [ "$code" = "GOOD-CODE#s1" ]; then touch "$CLAUDE_CONFIG_DIR/.fake-logged-in"; echo "Logged in as leak@example.com"; exit 0; fi
    echo "Invalid code"; exit 1 ;;
  "--version ") echo "2.1.285 (Claude Code)" ;;
  *) exit 1 ;;
esac
`,
);
chmodSync(config.claudeBin, 0o755);
const ATC = join(root, "projects", "atc");
writeFileSync(config.airportsFile, JSON.stringify({ airports: [{ code: "ATCC", path: ATC, closed: false }, { code: "OLD", path: join(root, "old"), closed: true }] }));

const A9 = join(root, ".claude-acct-9");
mkdirSync(A9);
writeFileSync(join(A9, ".claude.json"), JSON.stringify({ userID: "u1", oauthAccount: { emailAddress: "leak@example.com" }, projects: { "/other": { allowedTools: ["x"] } } }));
saveAccounts({ "acct-2": { configDir: config.claudeDir }, "acct-9": { configDir: A9 } });
writeFileSync(join(config.claudeDir, ".fake-logged-in"), "");

test("loginUrlOf: https Claude·Anthropic 호스트의 /oauth/authorize만", () => {
  const good = "https://claude.com/cai/oauth/authorize?code=true&state=s1";
  assert.equal(loginUrlOf(`Opening…\nIf the browser didn't open, visit: ${good}\nPaste code here if prompted > `), good);
  assert.equal(loginUrlOf("visit https://console.anthropic.com/oauth/authorize?x=1"), "https://console.anthropic.com/oauth/authorize?x=1");
  assert.equal(loginUrlOf("visit https://evil.example/oauth/authorize?x=1"), null);
  assert.equal(loginUrlOf("visit https://claude.com.evil.io/oauth/authorize?x=1"), null);
  assert.equal(loginUrlOf("visit http://claude.com/oauth/authorize?x=1"), null);
  assert.equal(loginUrlOf("see https://claude.com/docs then"), null);
  assert.equal(loginUrlOf(""), null);
});

test("codeOf: 앞뒤 공백을 떼고, 코드 글자만", () => {
  assert.equal(codeOf("  abcDEF123-_.~#state  "), "abcDEF123-_.~#state");
  assert.equal(codeOf("short"), null);
  assert.equal(codeOf("has space inside"), null);
  assert.equal(codeOf("abc\ndefghij"), null);
  assert.equal(codeOf("abcdefgh;rm -rf"), null);
  assert.equal(codeOf(42), null);
});

test("versionOf", () => {
  assert.equal(versionOf("2.1.285 (Claude Code)\n"), "2.1.285");
  assert.equal(versionOf("nope"), null);
});

test("onboardedOf: 세 칸만 더하고 다른 칸은 그대로", () => {
  const before = { userID: "u", oauthAccount: { emailAddress: "x@y" }, projects: { "/a": { allowedTools: ["t"] }, "/b": "odd" } };
  const out = onboardedOf(before, "2.1.285", ["/a", "/c"]);
  assert.equal(out.hasCompletedOnboarding, true);
  assert.equal(out.lastOnboardingVersion, "2.1.285");
  assert.deepEqual(out.projects, { "/a": { allowedTools: ["t"], hasTrustDialogAccepted: true }, "/b": "odd", "/c": { hasTrustDialogAccepted: true } });
  assert.deepEqual(out.oauthAccount, before.oauthAccount);
  assert.equal(before.projects["/a"].hasOwnProperty("hasTrustDialogAccepted"), false); // 원본은 그대로
  assert.equal("lastOnboardingVersion" in onboardedOf({}, null, []), false);
});

test("loginRefusal: 등록 안 됨, ~/.claude, 이미 로그인됨", () => {
  assert.match(loginRefusal(undefined, null) ?? "", /등록된 ACCOUNT가 아님/);
  assert.match(loginRefusal({ dir: A9, registered: false }, false) ?? "", /등록된 ACCOUNT가 아님/);
  assert.match(loginRefusal({ dir: config.claudeDir, registered: true }, false) ?? "", /~\/\.claude/);
  assert.match(loginRefusal({ dir: A9, registered: true }, true) ?? "", /이미 로그인됨/);
  assert.equal(loginRefusal({ dir: A9, registered: true }, false), null);
  assert.equal(loginRefusal({ dir: A9, registered: true }, null), null);
});

test("startLogin: ~/.claude와 모르는 라벨은 거절", async () => {
  await assert.rejects(startLogin("acct-2"), (e: unknown) => e instanceof AccountsError && /~\/\.claude/.test(e.message));
  await assert.rejects(startLogin("nope"), (e: unknown) => e instanceof AccountsError && /등록된 ACCOUNT가 아님/.test(e.message));
});

test("LOGIN 흐름: 틀린 코드 → failed, 다시 LOGIN → 맞는 코드 → done과 온보딩, 출력·email은 새지 않는다", async () => {
  const first = await startLogin("acct-9");
  assert.equal(first.state, "waiting-code");
  assert.equal(first.url, "https://claude.com/cai/oauth/authorize?code=true&state=s1");
  assert.equal((await startLogin("acct-9")).startedAt, first.startedAt); // 진행 중이면 같은 것
  await assert.rejects(submitCode("acct-9", "bad"), /코드 모양이 아님/);
  const bad = await submitCode("acct-9", "WRONG-CODE#s1");
  assert.equal(bad.state, "failed");
  assert.match(bad.error ?? "", /로그인되지 않음/);
  await assert.rejects(submitCode("acct-9", "GOOD-CODE#s1"), /먼저 LOGIN/);

  assert.equal((await startLogin("acct-9")).state, "waiting-code");
  const done = await submitCode("acct-9", "  GOOD-CODE#s1\n");
  assert.equal(done.state, "done");
  assert.equal(done.onboarding, "marked");
  assert.equal(done.error, null);
  assert.ok(!JSON.stringify(done).includes("leak@"));
  assert.deepEqual(loginView("acct-9"), done);

  const cj = JSON.parse(readFileSync(join(A9, ".claude.json"), "utf8"));
  assert.equal(cj.hasCompletedOnboarding, true);
  assert.equal(cj.lastOnboardingVersion, "2.1.285");
  assert.deepEqual(cj.projects[ATC], { hasTrustDialogAccepted: true });
  assert.equal(join(root, "old") in cj.projects, false); // 닫힌 AIRPORT는 신뢰하지 않는다
  assert.deepEqual(cj.projects["/other"], { allowedTools: ["x"] });
  assert.equal(cj.oauthAccount.emailAddress, "leak@example.com");
  assert.equal(statSync(join(A9, ".claude.json")).mode & 0o777, 0o600);
  const backups = readdirSync(A9).filter((f) => f.startsWith(".claude.json.atc-bak-"));
  assert.equal(backups.length, 1);
  assert.equal(statSync(join(A9, backups[0])).mode & 0o777, 0o600);

  // 로그인된 뒤에는 다시 LOGIN이 거절된다
  await assert.rejects(startLogin("acct-9"), /이미 로그인됨/);
});

test("cancelLogin: 진행 중인 LOGIN을 멈추고 지운다", async () => {
  const A8 = join(root, ".claude-acct-8");
  mkdirSync(A8);
  saveAccounts({ "acct-2": { configDir: config.claudeDir }, "acct-9": { configDir: A9 }, "acct-8": { configDir: A8 } });
  assert.equal((await startLogin("acct-8")).state, "waiting-code");
  assert.equal(cancelLogin("acct-8"), true);
  assert.equal(loginView("acct-8"), null);
  assert.equal(cancelLogin("acct-8"), false);
  assert.equal(existsSync(join(A8, ".fake-logged-in")), false);
});

test("markOnboarded: JSON 객체가 아니면 건드리지 않는다, 없으면 새로 만든다", async () => {
  const bad = join(root, ".claude-bad");
  mkdirSync(bad);
  writeFileSync(join(bad, ".claude.json"), "[1,2]");
  assert.equal(await markOnboarded(bad, new Date(), "1.0.0"), "failed");
  assert.equal(readFileSync(join(bad, ".claude.json"), "utf8"), "[1,2]");
  const fresh = join(root, ".claude-fresh");
  mkdirSync(fresh);
  assert.equal(await markOnboarded(fresh, new Date(), "1.0.0"), "marked");
  assert.equal(JSON.parse(readFileSync(join(fresh, ".claude.json"), "utf8")).hasCompletedOnboarding, true);
});

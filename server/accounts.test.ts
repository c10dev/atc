import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { authFieldsOf, folderHealthOf, settingsPiecesOf, warningsOf } from "./account-health.ts";
import { AccountsError, accountFolders, checkConfigDir, foldersOf, loadAccounts, observedLabelsOn, validateAccounts } from "./accounts.ts";
import { config } from "./config.ts";
import { fuelAccountsOf, fuelByAircraft, fuelHolds, type FuelMember, observeMembers } from "./fuel-remaining.ts";
import { fuelFiles } from "./fuel-run.ts";
import { jobStateOf } from "./session-control.ts";
import { readJob } from "./job-state.ts";
import { readClaudeSessions, readEndedSessions, sessionDir } from "./sources/claude.ts";
import { sessionDirsOf } from "./crew-observed.ts";

// ACCOUNTS 읽기(ATC-146). 임시 HOME 아래 폴더 셋: ~/.claude(등록 안 함 → default), ~/.claude-acct-1, ~/.claude-acct-3.
// 진짜 ~/.claude와 상태 폴더는 건드리지 않는다. `.credentials.json`은 만들지도 읽지도 않는다
const root = realpathSync(mkdtempSync(join(tmpdir(), "atc-accounts-")));
const real = { home: config.home, claudeDir: config.claudeDir, stateDir: config.stateDir };
config.home = root;
config.claudeDir = join(root, ".claude");
config.stateDir = join(root, "state");
mkdirSync(config.stateDir, { recursive: true });
after(() => {
  Object.assign(config, real);
  rmSync(root, { recursive: true, force: true });
});

const A1 = join(root, ".claude-acct-1");
const A3 = join(root, ".claude-acct-3");
const D = config.claudeDir;

test("validateAccounts: 좋은 등록부는 그대로, 나쁜 경로·모르는 키·라벨은 던진다", () => {
  assert.deepEqual(validateAccounts({ "acct-1": { configDir: A1 } }, root), { "acct-1": { configDir: A1 } });
  assert.deepEqual(validateAccounts(undefined, root), {});
  assert.deepEqual(validateAccounts({ default: { configDir: `${D}/` } }, root), { default: { configDir: D } }); // 끝 / 는 떼고 ~/.claude도 등록할 수 있다
  const bad = (raw: unknown, re: RegExp) => assert.throws(() => validateAccounts(raw, root), (e: unknown) => e instanceof AccountsError && re.test(e.message));
  bad({ x: { configDir: ".claude-x" } }, /절대 경로/);
  bad({ x: { configDir: "/etc/.claude" } }, /\$HOME 아래/);
  bad({ x: { configDir: join(root, "claude-x") } }, /\.claude로 시작/);
  bad({ x: { configDir: `${root}/sub/../.claude-x` } }, /\.\./);
  bad({ x: { configDir: `${root}/./.claude-x` } }, /\.\./);
  bad({ x: { configDir: `${root}/../.claude-x` } }, /\.\./);
  bad({ x: { configDir: 3 } }, /절대 경로 문자열/);
  bad({ x: { configDir: A1, email: "a@b.c" } }, /모르는 키 email/);
  bad({ x: { configDir: A1, token: "t" } }, /모르는 키 token/);
  bad({ "Acct 1": { configDir: A1 } }, /라벨/);
  bad({ a: { configDir: A1 }, b: { configDir: `${A1}/` } }, /같은 폴더/);
  bad([], /객체/);
  bad({ x: "nope" }, /객체/);
});

test("checkConfigDir: symlink로 $HOME 밖을 가리키면 막고, 안쪽을 가리키면 받는다", () => {
  const outside = mkdtempSync(join(tmpdir(), "atc-outside-"));
  try {
    symlinkSync(outside, join(root, ".claude-escape"));
    assert.throws(() => checkConfigDir(join(root, ".claude-escape"), root), /symlink/);
    mkdirSync(join(root, "real-inside"));
    symlinkSync(join(root, "real-inside"), join(root, ".claude-link"));
    assert.equal(checkConfigDir(join(root, ".claude-link"), root), join(root, ".claude-link"));
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

const sessionFile = (dir: string, pid: number, id: string, extra: Record<string, unknown> = {}) => {
  mkdirSync(join(dir, "sessions"), { recursive: true });
  writeFileSync(join(dir, "sessions", `${pid}.json`), JSON.stringify({ pid, sessionId: id, cwd: "/home/x/proj", startedAt: Date.now(), name: `S-${id}`, status: "idle", kind: "bg", ...extra }));
};
const transcript = (dir: string, id: string, title?: string, ageMin = 5) => {
  const p = join(dir, "projects", "-home-x-proj", `${id}.jsonl`);
  mkdirSync(join(dir, "projects", "-home-x-proj"), { recursive: true });
  writeFileSync(p, `${title ? JSON.stringify({ type: "custom-title", customTitle: title }) + "\n" : ""}${JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "x" }] } })}\n`);
  const t = new Date(Date.now() - ageMin * 60_000);
  utimesSync(p, t, t);
  return p;
};
const job = (dir: string, jobId: string, state: string) => {
  mkdirSync(join(dir, "jobs", jobId), { recursive: true });
  writeFileSync(join(dir, "jobs", jobId, "state.json"), JSON.stringify({ state, detail: `d-${jobId}` }));
};

test("등록부가 비어 있으면 폴더는 ~/.claude 하나이고 세션에 account를 붙이지 않는다", () => {
  assert.deepEqual(accountFolders(), [{ label: "default", dir: D, registered: false }]);
  assert.equal(observedLabelsOn(accountFolders()), false);
  sessionFile(D, process.pid, "sess-d", { jobId: "aaaaaa11" });
  const { sessions } = readClaudeSessions();
  assert.equal(sessions.length, 1);
  assert.equal("account" in sessions[0]!, false);
  rmSync(join(D, "sessions"), { recursive: true });
});

test("세 폴더 reader: 세션·job·대화 기록·ended·FUEL 파일이 모두 자기 폴더에서 읽힌다", () => {
  writeFileSync(join(config.stateDir, "fleet.json"), JSON.stringify({ defaults: {}, aircraft: {}, accounts: { "acct-1": { configDir: A1 }, "acct-3": { configDir: A3 }, bad: { configDir: "/etc/.claude" }, "x-x": { configDir: A1, email: "e@x" } } }));
  assert.deepEqual(Object.keys(loadAccounts(join(config.stateDir, "fleet.json"), root, Date.now() + 10_000)), ["acct-1", "acct-3"]); // 나쁜 항목은 읽을 때 버린다
  const folders = accountFolders();
  assert.deepEqual(folders.map((f) => [f.label, f.dir]), [["acct-1", A1], ["acct-3", A3], ["default", D]]);
  assert.equal(observedLabelsOn(folders), true);

  // 같은 세션 id는 폴더마다 다르다(다른 폴더에 같은 id가 있어도 섞이지 않는지는 아래 FUEL 캐시 키에서)
  sessionFile(D, process.pid, "sess-d", { jobId: "dddddd11", name: "TEAM_D" });
  sessionFile(A1, process.pid + 100_000, "sess-1", { jobId: "111111aa", name: "TEAM_ONE" });
  sessionFile(A3, process.pid + 200_000, "sess-3", { jobId: "333333aa", name: "TEAM_THREE" });
  transcript(D, "sess-d");
  transcript(A1, "sess-1");
  transcript(A3, "sess-3");
  job(D, "dddddd11", "working");
  job(A1, "111111aa", "blocked");
  job(A3, "333333aa", "done");
  const { sessions } = readClaudeSessions();
  const by = Object.fromEntries(sessions.map((s) => [s.id, s]));
  assert.deepEqual(Object.keys(by).sort(), ["sess-1", "sess-3", "sess-d"]);
  assert.equal(by["sess-d"]!.account, "default");
  assert.equal(by["sess-1"]!.account, "acct-1");
  assert.equal(by["sess-3"]!.account, "acct-3");
  assert.equal(by["sess-d"]!.status, "idle"); // 살아 있는 pid
  assert.ok(by["sess-d"]!.lastActiveAt && by["sess-d"]!.job?.detail === "d-dddddd11"); // 대화 기록 mtime과 job이 자기 폴더에서
  // 죽은 pid의 세션도 자기 폴더의 대화 기록으로 lastActiveAt을 읽는다
  assert.equal(by["sess-1"]!.status, "dead");
  assert.ok(by["sess-1"]!.lastActiveAt && by["sess-3"]!.lastActiveAt);

  // job: 폴더를 지정하면 그 폴더, 지정하지 않으면 모든 폴더를 차례로
  assert.equal(readJob("111111aa", join(A1, "jobs"))?.detail, "d-111111aa");
  assert.equal(readJob("111111aa", join(A3, "jobs")), null);
  assert.equal(readJob("333333aa")?.detail, "d-333333aa");
  assert.equal(jobStateOf("111111aa"), "blocked");
  assert.equal(jobStateOf("333333aa"), "done");
  assert.equal(jobStateOf("dddddd11"), "working");
  assert.equal(jobStateOf("ffffffff"), null);
  assert.equal(jobStateOf("111111aa", [join(A3, "jobs")]), null);

  // 대화 기록 경로: ACCOUNT 라벨로 폴더를 찾는다
  assert.equal(sessionDir("/home/x/proj", "sess-3", "acct-3"), join(A3, "projects", "-home-x-proj", "sess-3"));
  assert.equal(sessionDir("/home/x/proj", "sess-d", "default"), join(D, "projects", "-home-x-proj", "sess-d"));
  assert.equal(sessionDir("/home/x/proj", "sess-d"), join(D, "projects", "-home-x-proj", "sess-d"));

  // ended 세션(세션 파일 없는 최근 대화 기록): 세 폴더 모두
  transcript(A1, "ended-1", "TEAM_E1");
  transcript(A3, "ended-3", "TEAM_E3");
  transcript(D, "ended-d", "TEAM_ED");
  const ended = readEndedSessions(new Set(sessions.map((s) => s.id)), Date.now(), 30 * 60_000).map((e) => e.name).sort();
  assert.deepEqual(ended, ["TEAM_E1", "TEAM_E3", "TEAM_ED"]);

  // FUEL 파일: 세 폴더의 projects/를 모두 걷고, 같은 세션 id가 두 폴더에 있어도 경로(=캐시 키)가 다르다
  transcript(A3, "sess-1"); // acct-1의 sess-1과 같은 id
  const files = fuelFiles(0);
  assert.equal(files.filter((f) => f.session === "sess-1").length, 2);
  assert.equal(new Set(files.map((f) => f.path)).size, files.length);
  assert.ok(files.some((f) => f.path.startsWith(join(A1, "projects"))) && files.some((f) => f.path.startsWith(join(A3, "projects"))) && files.some((f) => f.path.startsWith(join(D, "projects"))));
  assert.equal(fuelFiles(0, join(A1, "projects")).every((f) => f.path.startsWith(join(A1, "projects"))), true);

  // crew-observed: 세션이 있는 폴더의 세션 폴더를 이어 준다
  mkdirSync(join(A3, "projects", "-home-x-proj", "sess-3"), { recursive: true });
  const dirs = sessionDirsOf("TEAM_THREE", [{ id: "sess-3", name: "TEAM_THREE", cwd: "/home/x/proj", agent: "claude", status: "idle", account: "acct-3" }]);
  assert.deepEqual(dirs, [join(A3, "projects", "-home-x-proj", "sess-3")]);
});

test("foldersOf: 등록부가 ~/.claude를 이미 가리키면 default를 더하지 않는다", () => {
  assert.deepEqual(foldersOf({ "acct-2": { configDir: D } }, D), [{ label: "acct-2", dir: D, registered: true }]);
});

const rec = (sessionId: string, t: string, pct: number) => ({ t, sessionId, rate_limits: { five_hour: { used_percentage: pct, resets_at: Math.floor(Date.parse("2026-09-30T20:00:00Z") / 1000) } } }) as never;

test("FUEL: 관찰한 ACCOUNT로 statusline 기록을 묶는다(home과 달라도 폴더의 한도)", () => {
  const now = Date.parse("2026-09-30T10:00:00Z");
  const cfg = { infoPct: 80, holdPct: 95, hold: false };
  // TEAM_A는 home이 acct-2인데 세션은 acct-1 폴더에서 돈다. TEAM_B는 acct-2 폴더
  const members: FuelMember[] = [
    { name: "TEAM_A", kind: "aircraft", account: "acct-2", sessionIds: ["sa-old", "sa-live"] },
    { name: "TEAM_B", kind: "aircraft", account: "acct-2", sessionIds: ["sb"] },
    { name: "TOWER", kind: "control", account: "acct-2", sessionIds: ["st"] },
  ];
  const observed = new Map([["sa-old", "acct-2"], ["sa-live", "acct-1"], ["sb", "acct-2"], ["st", "acct-2"]]);
  const live = new Set(["sa-live", "sb", "st"]);
  const obs = observeMembers(members, observed, live);
  assert.deepEqual(obs.map((m) => [m.name, m.account, m.sessionIds]), [["TEAM_A", "acct-1", ["sa-live"]], ["TEAM_B", "acct-2", ["sb"]], ["TOWER", "acct-2", ["st"]]]);
  const records = [rec("sa-live", "2026-09-30T09:59:00Z", 96), rec("sa-old", "2026-09-30T09:00:00Z", 10), rec("sb", "2026-09-30T09:58:00Z", 20), rec("st", "2026-09-30T09:57:00Z", 21)];
  const out = fuelAccountsOf(obs, records, cfg, now);
  const a1 = out.find((f) => f.account === "acct-1")!;
  const a2 = out.find((f) => f.account === "acct-2")!;
  assert.deepEqual([a1.aircraft, a1.top.pct, a1.level], [["TEAM_A"], 96, "hold"]);
  assert.deepEqual([a2.aircraft, a2.control, a2.top.pct], [["TEAM_B"], ["TOWER"], 20]);
  // 관찰 값이 없거나 라벨이 없는 구성원은 그대로
  const same = observeMembers([{ name: "TEAM_C", kind: "aircraft", account: null, sessionIds: ["sc"] }, { name: "TEAM_D", kind: "aircraft", account: "acct-2", sessionIds: ["sd"] }], new Map([["sc", "acct-1"]]), new Set(["sc", "sd"]));
  assert.deepEqual(same.map((m) => [m.name, m.account]), [["TEAM_C", null], ["TEAM_D", "acct-2"]]);
});

test("auth status 필터: loggedIn·authMethod·요금제 세 칸만 남는다(ATC-348)", () => {
  const full = JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "someone@example.com", orgId: "org-1", orgName: "Org", subscriptionType: "max", apiKeySource: "x", token: "sk-secret" });
  const got = authFieldsOf(full);
  assert.deepEqual(got, { loggedIn: true, authMethod: "claude.ai", plan: "max" });
  assert.deepEqual(Object.keys(got).sort(), ["authMethod", "loggedIn", "plan"]);
  for (const leak of ["example.com", "org-1", "Org", "sk-secret"]) assert.equal(JSON.stringify(got).includes(leak), false, leak);
  assert.deepEqual(authFieldsOf(JSON.stringify({ loggedIn: false })), { loggedIn: false, authMethod: null, plan: null });
  // 로그인 안 된 폴더의 옛 요금제 글은 보이지 않는다. 이상한 글자도 버린다
  assert.equal(authFieldsOf(JSON.stringify({ loggedIn: false, subscriptionType: "max" })).plan, null);
  assert.equal(authFieldsOf(JSON.stringify({ loggedIn: true, subscriptionType: "max; rm -rf" })).plan, null);
  assert.equal(authFieldsOf(JSON.stringify({ loggedIn: true, subscriptionType: "someone@example.com" })).plan, null);
  assert.equal(authFieldsOf(JSON.stringify({ loggedIn: true, subscriptionType: 3 })).plan, null);
  assert.deepEqual(authFieldsOf(JSON.stringify({ loggedIn: true, authMethod: "a b; rm -rf" })), { loggedIn: true, authMethod: null, plan: null });
  assert.deepEqual(authFieldsOf("not json"), { loggedIn: null, authMethod: null, plan: null });
  assert.deepEqual(authFieldsOf("{}"), { loggedIn: null, authMethod: null, plan: null });
  assert.deepEqual(authFieldsOf("null"), { loggedIn: null, authMethod: null, plan: null });
});

test("폴더 health: settings 조각 검사와 경고 글, auth 출력은 걸러 저장", async () => {
  const both = settingsPiecesOf(JSON.stringify({ statusLine: { command: "node /x/hooks/fuel-statusline.mjs" }, hooks: { PostToolUse: [{ hooks: [{ command: "node /x/hooks/claim.mjs" }] }], StopFailure: [{ hooks: [{ command: "node /x/hooks/health.mjs" }] }] } }));
  assert.deepEqual(both, { statusline: true, claimHook: true, healthHook: true });
  assert.deepEqual(warningsOf("acct-2", { loggedIn: true, authMethod: "claude.ai", plan: null }, both), []);
  const none = settingsPiecesOf(null);
  assert.deepEqual(warningsOf("acct-1", { loggedIn: false, authMethod: null, plan: null }, none), ["not logged in on acct-1", "FUEL blind on acct-1 (no atc statusline)", "health blind on acct-1 (no health.mjs hook)", "claims blind on acct-1 (no claim.mjs hook)"]);

  writeFileSync(join(A1, "settings.json"), JSON.stringify({ statusLine: { command: "node fuel-statusline.mjs" } }));
  const seen: string[] = [];
  const run = async (dir: string) => {
    seen.push(dir);
    return JSON.stringify({ loggedIn: dir === A1, authMethod: "claude.ai", email: "leak@example.com" });
  };
  const health = await folderHealthOf(accountFolders(), Date.now() + 1_000_000, run);
  assert.deepEqual(seen.sort(), [A1, A3, D].sort());
  assert.equal(JSON.stringify(health).includes("leak@example.com"), false);
  const h1 = health.find((h) => h.label === "acct-1")!;
  assert.deepEqual([h1.loggedIn, h1.statusline, h1.claimHook, h1.healthHook], [true, true, false, false]);
  assert.ok(h1.warnings.every((w) => w.includes("acct-1")));
  assert.equal(health.find((h) => h.label === "acct-3")!.loggedIn, false);
});

test("DISPATCH: ACCOUNT CHANGE로 옮긴 AIRCRAFT는 다시 배정할 수 있다(FUEL HOLD와 FOLLOWING이 관찰한 ACCOUNT를 쓴다)", () => {
  const now = Date.parse("2026-09-30T10:00:00Z");
  const cfg = { infoPct: 80, holdPct: 95, hold: true };
  const records = [rec("s-old", "2026-09-30T09:59:00Z", 97), rec("s-new", "2026-09-30T09:58:00Z", 30)];
  const home = (ids: string[]): FuelMember[] => [{ name: "TEAM_A", kind: "aircraft", account: "acct-2", sessionIds: ids }];
  const fuelOf = (ids: string[], observed: [string, string][], live: string[]) =>
    fuelByAircraft(fuelAccountsOf(observeMembers(home(ids), new Map(observed), new Set(live)), records, cfg, now)).TEAM_A;
  // 옮기기 전: 세션이 acct-2 폴더에 있고 acct-2가 97% → hold라 DISPATCH가 건너뛴다
  const before = fuelOf(["s-old"], [["s-old", "acct-2"]], ["s-old"]);
  assert.equal(before.account, "acct-2");
  assert.equal(fuelHolds(before, cfg), true);
  // 옮긴 뒤: 옛 세션은 죽었고 새 세션이 acct-1 폴더에서 산다 → 관찰한 ACCOUNT는 acct-1(30%). home은 acct-2 그대로지만 배정할 수 있다
  const after = fuelOf(["s-old", "s-new"], [["s-old", "acct-2"], ["s-new", "acct-1"]], ["s-new"]);
  assert.equal(after.account, "acct-1");
  assert.equal(after.top.pct, 30);
  assert.equal(fuelHolds(after, cfg), false);
});

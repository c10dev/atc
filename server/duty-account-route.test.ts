import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Hono } from "hono";
import { config } from "./config.ts";
import { mountSettings } from "./settings.ts";

// DUTY ACCOUNT의 설정 경로(ATC-242). 임시 HOME·임시 상태 폴더만 쓴다: DUTY 프로세스는 띄우지 않고 운영 상태 폴더도 건드리지 않는다.
const root = realpathSync(mkdtempSync(join(tmpdir(), "atc-dutyacct-")));
const real = { home: config.home, claudeDir: config.claudeDir, stateDir: config.stateDir };
after(() => {
  Object.assign(config, real);
  rmSync(root, { recursive: true, force: true });
});
config.home = root;
config.claudeDir = join(root, ".claude");
config.stateDir = join(root, "state");
mkdirSync(config.stateDir, { recursive: true });
writeFileSync(
  join(config.stateDir, "fleet.json"),
  JSON.stringify({ defaults: {}, aircraft: {}, accounts: { "acct-2": { configDir: join(root, ".claude-acct-2") }, "acct-3": { configDir: join(root, ".claude-acct-3") } } }),
);
writeFileSync(join(config.stateDir, "duty.json"), JSON.stringify({ enabled: true, account: "acct-2" }));

const app = new Hono();
mountSettings(app);
const APP = { "content-type": "application/json", origin: "http://localhost:7700" };
const put = (body: unknown, headers: Record<string, string> = APP) => app.request("/api/settings", { method: "PUT", headers, body: JSON.stringify(body) });
const duty = async () => ((await (await app.request("/api/settings")).json()) as { duty: { account: string; accountWarning: string | null } }).duty;

test("dutyAccount: 모르는 라벨·빈 값은 400, 이 화면 밖 요청은 403, 아무것도 바뀌지 않는다", async () => {
  const unknown = await put({ dutyAccount: "acct-9" });
  assert.equal(unknown.status, 400);
  assert.match(((await unknown.json()) as { errors: { dutyAccount: string } }).errors.dutyAccount, /등록되지 않은 ACCOUNT: acct-9/);
  assert.equal((await put({ dutyAccount: "" })).status, 400);
  assert.equal((await put({ dutyAccount: "acct-3" }, { "content-type": "application/json" })).status, 403, "Origin이 없으면 받지 않는다");
  assert.equal((await duty()).account, "acct-2");
});

test("dutyAccount: 등록된 라벨은 duty.json에 저장되고, 바뀐 것이 duty.jsonl에 한 줄 남는다", async () => {
  const res = await put({ dutyAccount: "acct-3" });
  assert.equal(res.status, 200);
  assert.equal((await duty()).account, "acct-3");
  assert.equal(JSON.parse(readFileSync(join(config.stateDir, "duty.json"), "utf8")).account, "acct-3");
  assert.equal(JSON.parse(readFileSync(join(config.stateDir, "duty.json"), "utf8")).enabled, true, "다른 칸은 그대로");
  const lines = readFileSync(join(config.stateDir, "duty.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => [l.kind, l.from, l.to, l.by]), [["account", "acct-2", "acct-3", "SUPERVISOR"]]);
  // 같은 값을 다시 저장해도 줄이 늘지 않는다
  await put({ dutyAccount: "acct-3" });
  assert.equal(readFileSync(join(config.stateDir, "duty.jsonl"), "utf8").trim().split("\n").length, 1);
  assert.ok(!existsSync(join(config.stateDir, "duty-images")));
});

test("등록부에서 사라진 라벨이 저장돼 있으면 accountWarning이 켜진다", async () => {
  writeFileSync(join(config.stateDir, "duty.json"), JSON.stringify({ enabled: true, account: "acct-9" }));
  const d = await duty();
  assert.equal(d.account, "acct-9");
  assert.match(d.accountWarning ?? "", /acct-9.*등록부에 없음/);
  writeFileSync(join(config.stateDir, "duty.json"), JSON.stringify({ enabled: true, account: "acct-2" }));
  assert.equal((await duty()).accountWarning, null);
});

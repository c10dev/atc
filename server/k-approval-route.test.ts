import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Hono } from "hono";
import { config } from "./config.ts";
import { loadMcc, readMccRecords } from "./mcc.ts";
import { mountSettings } from "./settings.ts";
import { needsSupervisor, resetHashCache, sha256hex, supervisorGate } from "./supervisor-auth.ts";

// K 승인 착륙 스위치(ATC-391)의 설정 길. 임시 HOME·임시 상태 폴더만 쓴다(운영 상태 폴더는 건드리지 않는다).
const root = realpathSync(mkdtempSync(join(tmpdir(), "atc-kapproval-")));
const real = { home: config.home, claudeDir: config.claudeDir, stateDir: config.stateDir };
after(() => {
  Object.assign(config, real);
  rmSync(root, { recursive: true, force: true });
});
config.home = root;
config.claudeDir = join(root, ".claude");
config.stateDir = join(root, "state");
mkdirSync(config.stateDir, { recursive: true });

const app = new Hono();
mountSettings(app);
const APP = { "content-type": "application/json", origin: "http://localhost:7700" };
const put = (body: unknown, headers: Record<string, string> = APP) => app.request("/api/settings", { method: "PUT", headers, body: JSON.stringify(body) });
const modeLines = () => readMccRecords().filter((r) => r.op === "mode");

test("mccKApproval: on·off만 받고, 다른 값은 400이며 아무것도 바뀌지 않는다", async () => {
  for (const bad of ["shadow", "ON", true, 1, null, ""]) {
    const res = await put({ mccKApproval: bad });
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.match(((await res.json()) as { errors: { mccKApproval: string } }).errors.mccKApproval, /on 또는 off/);
  }
  assert.equal(loadMcc().kApproval, "on");
  assert.equal(modeLines().length, 0);
});

test("mccKApproval: 이 화면(Origin) 밖의 요청은 403이고 스위치는 그대로다", async () => {
  assert.equal((await put({ mccKApproval: "off" }, { "content-type": "application/json" })).status, 403);
  assert.equal((await put({ mccKApproval: "off" }, { "content-type": "application/json", origin: "https://evil.example" })).status, 403);
  assert.equal(loadMcc().kApproval, "on");
});

test("mccKApproval: off로 바꾸면 mcc.json에 쓰고 mcc.jsonl에 kApproval이 든 mode 줄이 한 줄 남는다. 같은 값은 줄을 더하지 않는다", async () => {
  const res = await put({ mccKApproval: "off" });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { switches: { key: string; value: string }[] }).switches.find((x) => x.key === "mccKApproval")?.value, "off");
  assert.equal(JSON.parse(readFileSync(join(config.stateDir, "mcc.json"), "utf8")).kApproval, "off");
  const lines = modeLines();
  assert.equal(lines.length, 1);
  const l = lines[0] as { mode: string; kApproval?: string; detail: string };
  assert.equal(l.kApproval, "off"); // detail을 읽지 않아도 구별된다
  assert.equal(l.mode, "shadow"); // MCC 모드는 그대로
  assert.match(l.detail, /kApproval on → off/);
  await put({ mccKApproval: "off" });
  assert.equal(modeLines().length, 1);
  // 다시 켠다: 설정에 on, 기록 한 줄 더
  assert.equal((await put({ mccKApproval: "on" })).status, 200);
  assert.equal(loadMcc().kApproval, "on");
  assert.equal(modeLines().length, 2);
});

test("설정 읽기: mccKApproval 스위치의 값과 7일 수(data.days)가 함께 온다", async () => {
  const j = (await (await app.request("/api/settings")).json()) as { switches: { key: string; value: string; data?: { days: { day: string; landed: number }[] } }[] };
  const sw = j.switches.find((x) => x.key === "mccKApproval")!;
  assert.equal(sw.value, "on");
  assert.equal(sw.data!.days.length, 7);
  assert.ok(sw.data!.days.every((d) => d.landed === 0));
});

// ── 자격 문(ATC-373)이 이 길을 막는다: 허용 목록(에이전트가 쓰는 길)에 없는 쓰기는 모두 SUPERVISOR 자격이 있어야 한다 ──
test("k-confirm and the K-approval switch are behind the SUPERVISOR credential gate (default deny), while attest stays an agent route", () => {
  assert.equal(needsSupervisor("POST", "/api/releases/k-confirm"), true);
  assert.equal(needsSupervisor("PUT", "/api/settings"), true);
  assert.equal(needsSupervisor("POST", "/api/releases/attest"), false); // agent가 쓰는 길: 이것만으로는 K 권한이 없다
});

test("a forged localhost Origin without the credential gets 403 on k-confirm and on the switch; the right credential reaches the route", async () => {
  const SECRET = "k-confirm-test-secret-0123456789abcdefghijkl";
  const file = join(root, "supervisor.sha256");
  writeFileSync(file, `${sha256hex(SECRET)}\n`);
  const saved = { f: process.env.ATC_SUPERVISOR_HASH_FILE, u: process.env.ATC_SUPERVISOR_ALLOW_USER_FILE };
  process.env.ATC_SUPERVISOR_HASH_FILE = file;
  process.env.ATC_SUPERVISOR_ALLOW_USER_FILE = "1";
  resetHashCache();
  try {
    const gated = new Hono();
    gated.use("/api/*", supervisorGate());
    gated.post("/api/releases/k-confirm", (c) => c.json({ reached: true }));
    gated.put("/api/settings", (c) => c.json({ reached: true }));
    gated.post("/api/releases/attest", (c) => c.json({ reached: true }));
    const call = (method: string, path: string, headers: Record<string, string>) => gated.request(path, { method, headers: { "content-type": "application/json", ...headers }, body: "{}" });
    const forged = { origin: "http://localhost:7700" };
    assert.equal((await call("POST", "/api/releases/k-confirm", forged)).status, 403);
    assert.equal((await call("PUT", "/api/settings", forged)).status, 403);
    assert.equal((await call("POST", "/api/releases/k-confirm", { ...forged, "x-atc-supervisor": "wrong".repeat(10) })).status, 403);
    assert.equal((await call("POST", "/api/releases/k-confirm", { ...forged, "x-atc-supervisor": SECRET })).status, 200);
    assert.equal((await call("PUT", "/api/settings", { ...forged, "x-atc-supervisor": SECRET })).status, 200);
    assert.equal((await call("POST", "/api/releases/attest", {})).status, 200); // agent는 attest만 쓸 수 있다
  } finally {
    if (saved.f === undefined) delete process.env.ATC_SUPERVISOR_HASH_FILE;
    else process.env.ATC_SUPERVISOR_HASH_FILE = saved.f;
    if (saved.u === undefined) delete process.env.ATC_SUPERVISOR_ALLOW_USER_FILE;
    else process.env.ATC_SUPERVISOR_ALLOW_USER_FILE = saved.u;
    resetHashCache();
  }
});

test("a corrupt mcc.json fails closed for K approval (off); a missing file is the default (on)", () => {
  const dir = join(root, "corrupt");
  mkdirSync(dir, { recursive: true });
  assert.equal(loadMcc(join(dir, "missing.json")).kApproval, "on");
  writeFileSync(join(dir, "broken.json"), "{ not json");
  assert.equal(loadMcc(join(dir, "broken.json")).kApproval, "off");
  assert.equal(loadMcc(join(dir, "broken.json")).mode, "shadow"); // MCC 모드는 전처럼 기본
  writeFileSync(join(dir, "ok.json"), JSON.stringify({ mode: "land" }));
  assert.equal(loadMcc(join(dir, "ok.json")).kApproval, "on");
});

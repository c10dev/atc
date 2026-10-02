import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hono } from "hono";
import { fromThisApp } from "./origin.ts";
import { hashStateOf, isAgentRoute, needsSupervisor, readHashState, resetHashCache, secretMatches, sha256hex, supervisorGate, verdictOf } from "./supervisor-auth.ts";

const SECRET = "k3Yq9-forged-by-nobody_0123456789abcdefghij";
const GOOD = { text: `${sha256hex(SECRET)}\n`, uid: 0, mode: 0o100644 };

test("hashStateOf: no file or no hash lines is unpaired; a file the service user could rewrite is insecure", () => {
  assert.deepEqual(hashStateOf(null, { serviceUid: 1000 }), { state: "unpaired" });
  assert.deepEqual(hashStateOf({ ...GOOD, text: "# nothing\nnot-a-hash\n" }, { serviceUid: 1000 }), { state: "unpaired" });
  assert.equal(hashStateOf({ ...GOOD, uid: 1000 }, { serviceUid: 1000 }).state, "insecure");
  assert.equal(hashStateOf({ ...GOOD, mode: 0o100664 }, { serviceUid: 1000 }).state, "insecure");
  assert.equal(hashStateOf({ ...GOOD, mode: 0o100666 }, { serviceUid: 1000 }).state, "insecure");
  const ok = hashStateOf({ ...GOOD, text: `${sha256hex("a".repeat(40))}\n\n${sha256hex(SECRET).toUpperCase()}\n` }, { serviceUid: 1000 });
  assert.ok(ok.state === "ok" && ok.hashes.length === 2);
  // 개발용 스위치만 사용자 소유 파일을 받는다
  assert.equal(hashStateOf({ ...GOOD, uid: 1000 }, { serviceUid: 1000, allowUserOwned: true }).state, "ok");
});

test("secretMatches: only the secret whose sha256 is listed, and only secrets of a sane length", () => {
  const hashes = [sha256hex(SECRET)];
  assert.equal(secretMatches(SECRET, hashes), true);
  assert.equal(secretMatches(SECRET + "x", hashes), false);
  assert.equal(secretMatches("short", [sha256hex("short")]), false);
  assert.equal(secretMatches(undefined, hashes), false);
  assert.equal(secretMatches(sha256hex(SECRET), hashes), false); // the hash itself is not the secret
});

test("verdictOf names why a request is refused", () => {
  const ok = { state: "ok" as const, hashes: [sha256hex(SECRET)] };
  assert.equal(verdictOf(SECRET, ok), "valid");
  assert.equal(verdictOf("w".repeat(40), ok), "invalid");
  assert.equal(verdictOf(undefined, ok), "missing");
  assert.equal(verdictOf(SECRET, { state: "unpaired" }), "unpaired");
  assert.equal(verdictOf(SECRET, { state: "insecure", why: "x" }), "insecure");
});

test("readHashState reads a real file (a user-owned file is insecure unless the dev switch is given)", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-sup-"));
  try {
    const f = join(dir, "supervisor.sha256");
    assert.equal(readHashState(f).state, "unpaired");
    writeFileSync(f, `${sha256hex(SECRET)}\n`);
    chmodSync(f, 0o644);
    if (process.getuid?.() !== 0) assert.equal(readHashState(f).state, "insecure");
    assert.equal(readHashState(f, { allowUserOwned: true }).state, "ok");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 문: 실제 서버와 같은 모양(어느 라우트보다 먼저 건 supervisorGate, SUPERVISOR 전용 라우트는 Origin 검사를 한 번 더 한다)
function appWith(file: string) {
  process.env.ATC_SUPERVISOR_HASH_FILE = file;
  process.env.ATC_SUPERVISOR_ALLOW_USER_FILE = "1";
  resetHashCache();
  const app = new Hono();
  app.use("/api/*", supervisorGate());
  app.post("/api/dispatch/mode", (c) => (fromThisApp(c) ? c.json({ ok: true }) : c.json({ error: "origin" }, 403)));
  app.post("/api/clearances", (c) => c.json({ ok: "agent" }));
  app.get("/api/snapshot", (c) => c.json({ ok: "read" }));
  const post = (path: string, headers: Record<string, string> = {}) =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });
  return { app, post };
}

test("forged localhost Origin + JSON content type, with no credential, gets 403 on a SUPERVISOR-only route", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-sup-"));
  try {
    const f = join(dir, "h");
    writeFileSync(f, `${sha256hex(SECRET)}\n`);
    const { post } = appWith(f);
    const forged = await post("/api/dispatch/mode", { origin: "http://localhost:7700" });
    assert.equal(forged.status, 403);
    assert.equal(((await forged.json()) as { reason: string }).reason, "missing");
    assert.equal((await post("/api/dispatch/mode", { origin: "http://localhost:7700", "x-atc-supervisor": "z".repeat(43) })).status, 403); // wrong secret
    assert.equal((await post("/api/dispatch/mode", { origin: "http://localhost:7700", "x-atc-supervisor": SECRET })).status, 200); // the SUPERVISOR's screen
    assert.equal((await post("/api/dispatch/mode", { "x-atc-supervisor": SECRET })).status, 403); // the secret alone is not enough: Origin check still applies
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.ATC_SUPERVISOR_HASH_FILE;
    delete process.env.ATC_SUPERVISOR_ALLOW_USER_FILE;
    resetHashCache();
  }
});

test("a route nobody checked before (mode switch, ATFM, RECALL, SCHEDULE) is refused without the credential, whatever the Origin", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-sup-"));
  try {
    const f = join(dir, "h");
    writeFileSync(f, `${sha256hex(SECRET)}\n`);
    const app = new Hono();
    process.env.ATC_SUPERVISOR_HASH_FILE = f;
    process.env.ATC_SUPERVISOR_ALLOW_USER_FILE = "1";
    resetHashCache();
    app.use("/api/*", supervisorGate());
    app.all("/api/*", (c) => c.json({ reached: true })); // no route-level check at all, like those routes today
    for (const path of ["/api/schedule/mode", "/api/atfm/switch", "/api/atfm/off", "/api/atfm/stops", "/api/dispatch/proposals/D-0001/recall", "/api/schedule/ops/S-1/approve"]) {
      const res = await app.request(path, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:7700" }, body: "{}" });
      assert.equal(res.status, 403, path);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.ATC_SUPERVISOR_HASH_FILE;
    delete process.env.ATC_SUPERVISOR_ALLOW_USER_FILE;
    resetHashCache();
  }
});

test("unpaired (no hash file) fails closed; agent routes and reads still work", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-sup-"));
  try {
    const { app, post } = appWith(join(dir, "missing"));
    const r = await post("/api/dispatch/mode", { origin: "http://localhost:7700", "x-atc-supervisor": SECRET });
    assert.equal(r.status, 403);
    assert.equal(((await r.json()) as { reason: string }).reason, "unpaired");
    assert.equal((await post("/api/clearances")).status, 200); // atcctl keeps working with no credential
    assert.equal((await app.request("/api/snapshot")).status, 200);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.ATC_SUPERVISOR_HASH_FILE;
    delete process.env.ATC_SUPERVISOR_ALLOW_USER_FILE;
    resetHashCache();
  }
});

test("needsSupervisor: SUPERVISOR-only actions need it, atcctl's writes and reads do not", () => {
  const need = [
    ["POST", "/api/dispatch/mode"], ["POST", "/api/schedule/mode"], ["POST", "/api/atfm/switch"], ["POST", "/api/atfm/off"], ["POST", "/api/atfm/stops"],
    ["POST", "/api/dispatch/proposals/D-0001/approve"], ["POST", "/api/dispatch/proposals/D-0001/reject"], ["POST", "/api/dispatch/proposals/D-0001/recall"], ["POST", "/api/dispatch/proposals/D-0001/cancel"],
    ["POST", "/api/schedule/ops/S-1/approve"], ["POST", "/api/schedule/ops/S-1/reject"], ["PUT", "/api/settings"], ["POST", "/api/pr/ATCC/12/merge"],
    ["POST", "/api/fleet/TEAM_A/launch"], ["POST", "/api/fleet/TEAM_A/stop"], ["POST", "/api/control/TOWER/stop"], ["POST", "/api/relay"], ["POST", "/api/relay/R-0001/hand"],
    ["POST", "/api/clearances/C-0001/hand"], ["POST", "/api/mcc/hold"], ["POST", "/api/autoland/hold"], ["PUT", "/api/accounts"], ["DELETE", "/api/airports/x"], ["POST", "/api/duty/message"],
    ["POST", "/api/duty/charters/d1/confirm"], ["POST", "/api/fleet/crew-change/x/approve"], ["PATCH", "/api/fleet/TEAM_A"], ["POST", "/api/fleet"], ["POST", "/api/effect/mark"],
  ] as const;
  for (const [m, p] of need) assert.equal(needsSupervisor(m, p), true, `${m} ${p}`);
  const free = [
    ["GET", "/api/snapshot"], ["POST", "/api/controller/ack"], ["POST", "/api/clearances"], ["POST", "/api/clearances/C-0001/readback"], ["POST", "/api/dispatch/proposals/D-0001/release"],
    ["POST", "/api/dispatch/proposals/D-0001/note"], ["POST", "/api/mcc/land/411"], ["POST", "/api/mcc/rts"], ["POST", "/api/relay/R-0001/issued"], ["POST", "/api/squelch/TOWER"],
    ["POST", "/api/schedule/ops/S-1/release"], ["POST", "/api/duty/card"], ["POST", "/api/landing/review/atc/411"],
  ] as const;
  for (const [m, p] of free) assert.equal(needsSupervisor(m, p), false, `${m} ${p}`);
  assert.equal(needsSupervisor("POST", "/not-api"), false);
  assert.equal(isAgentRoute("PUT", "/api/clearances"), false);
});

test("every write that controller/atcctl.mjs makes is still allowed without the credential", () => {
  const src = readFileSync(new URL("../controller/atcctl.mjs", import.meta.url), "utf8");
  const paths = new Set<string>();
  for (const m of src.matchAll(/(?:call\("POST", |method: "POST", path: )([`"])(\/api\/[^`"]*)\1/g)) paths.add(m[2]!);
  assert.ok(paths.size >= 30, `found only ${paths.size} POST paths`);
  const ops = ["readback", "roger", "unable", "standby", "cancel", "undeliverable", "issued", "411", "x"];
  for (const p of paths) {
    const base = p.replace(/\$\{[^}]*\}/g, "x");
    const candidates = p.includes("${") && /\$\{[^}]*\}$/.test(p) ? ops.map((op) => p.replace(/\$\{[^}]*\}$/, op).replace(/\$\{[^}]*\}/g, "x")) : [base];
    assert.ok(candidates.some((c) => isAgentRoute("POST", c)), `atcctl POST ${p} would need the SUPERVISOR credential`);
  }
});

test("server/index.ts installs the gate before it mounts any route, and the gate never logs the secret", () => {
  const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const gate = index.indexOf('app.use("/api/*", supervisorGate())');
  assert.ok(gate > 0, "supervisorGate is not installed");
  assert.ok(gate < index.indexOf("mountController(app"), "the gate must come before the first mount");
  assert.ok(gate < index.indexOf('app.get("/api/snapshot"'), "the gate must come before the first route");
  const auth = readFileSync(new URL("./supervisor-auth.ts", import.meta.url), "utf8");
  assert.equal(/console\.|log\(/.test(auth), false, "supervisor-auth.ts must not print or log");
});

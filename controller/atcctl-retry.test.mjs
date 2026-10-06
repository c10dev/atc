import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// ATC-561: atcctl → atc 서버 구간. 서버가 잠깐 연결을 끊어도 GET은 다시 시도하고, 서버가 받았는지 모르는 쓰기는 다시 보내지 않는다.
// BASE와 STATE는 가져올 때 읽으므로 가짜 서버와 임시 상태 폴더를 먼저 정한다
const hits = [];
let mode = "reset-once";
const notes = [];
const server = createServer((req, res) => {
  if (req.url === "/api/linear-calls/note") {
    // atcctl이 시도 기록을 서버에 알린다: 세지 않는다
    notes.push(req.method);
    return void res.writeHead(200, { "content-type": "application/json" }).end("{}");
  }
  hits.push(req.method);
  if (mode === "reset-once" && hits.length === 1) return req.socket.destroy();
  if (mode === "reset-always") return req.socket.destroy();
  if (mode === "503-once" && hits.length === 1) return void res.writeHead(503, { "retry-after": "0" }).end("{}");
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const state = mkdtempSync(join(tmpdir(), "atcctl-retry-"));
process.env.ATC_URL = `http://127.0.0.1:${server.address().port}`;
process.env.ATC_STATE_DIR = state;
const { fetchWithRetry } = await import("./atcctl.mjs");
const reset = (m) => {
  hits.length = 0;
  mode = m;
};

test("GET: 연결이 한 번 끊겨도 다시 시도해 답을 받는다", async () => {
  reset("reset-once");
  const res = await fetchWithRetry("GET", "/api/x");
  assert.equal(res.status, 200);
  assert.deepEqual(hits, ["GET", "GET"]);
});

test("GET: 503은 다시 시도한다", async () => {
  reset("503-once");
  assert.equal((await fetchWithRetry("GET", "/api/x")).status, 200);
  assert.equal(hits.length, 2);
});

test("POST: 서버가 받았는지 모르는 끊김은 다시 보내지 않는다(쓰기가 두 번 가지 않게)", async () => {
  reset("reset-once");
  await assert.rejects(fetchWithRetry("POST", "/api/x", { a: 1 }), (e) => /fetch failed \(atcctl → atc server\)/.test(e.message));
  assert.deepEqual(hits, ["POST"]);
});

test("끝까지 끊기면 구간과 원인 종류가 오류에 적힌다. 횟수 0이면 한 번만 시도한다", async () => {
  reset("reset-always");
  await assert.rejects(fetchWithRetry("GET", "/api/x"), (e) => /^fetch failed \(atcctl → atc server\) \[connect (ECONNRESET|UND_ERR_SOCKET)\]$/.test(e.message) || /^fetch failed \(atcctl → atc server\)/.test(e.message));
  assert.equal(hits.length, 3); // 처음 + 다시 두 번
  writeFileSync(join(state, "linear-retry.json"), JSON.stringify({ retries: 0 }));
  reset("reset-always");
  await assert.rejects(fetchWithRetry("GET", "/api/x"), /fetch failed/);
  assert.equal(hits.length, 1);
});

test("정리", () => {
  server.close();
  rmSync(state, { recursive: true, force: true });
});

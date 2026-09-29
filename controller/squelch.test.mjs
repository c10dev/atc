import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { askSquelch, atcBase, blockOutput, hookDecision, isPlainTick, isQuiet, quietText, squelchLine } from "./squelch.mjs";

const hook = (prompt, extra = {}) => JSON.stringify({ session_id: "s", hook_event_name: "UserPromptSubmit", prompt, ...extra });
const reply = (status, body) => async () => ({ status, json: async () => (body instanceof Error ? Promise.reject(body) : body) });
const QUIET = { open: false, reason: "quiet", quietSince: "2026-09-29T03:03:07.000Z", quietCount: 4 };
const calls = [];
const stub = (impl) => async (url, init) => (calls.push({ url, init }), impl(url, init));
const deps = (impl) => ({ fetchImpl: stub(impl), base: "http://atc.test" });

test("isPlainTick: 공백은 봐 주고, 인자가 붙거나 다른 프롬프트는 아니다", () => {
  assert.equal(isPlainTick("/tick"), true);
  assert.equal(isPlainTick("/tick   "), true);
  assert.equal(isPlainTick("  /tick\n"), true);
  assert.equal(isPlainTick("/tick now"), false);
  assert.equal(isPlainTick("/loop 3m /tick"), false);
  assert.equal(isPlainTick("[ATC C-0001] TEAM_A · LAND"), false);
  assert.equal(isPlainTick("tick"), false);
  assert.equal(isPlainTick(""), false);
  for (const x of [undefined, null, 5, {}, ["/tick"]]) assert.equal(isPlainTick(x), false);
});

test("quietText·blockOutput: 시각(UTC)과 숫자만, 짧게", () => {
  assert.equal(quietText(QUIET), "QUIET since 03:03 (4)");
  assert.equal(blockOutput(QUIET), '{"decision":"block","reason":"SQUELCH QUIET since 03:03Z (4)"}');
  assert.equal(quietText({ open: false }), "QUIET (0)");
  assert.equal(blockOutput({ open: false, quietSince: "nope", quietCount: -2 }), '{"decision":"block","reason":"SQUELCH QUIET (0)"}');
  // 서버가 무엇을 보내도 사유에는 문자열 필드가 들어가지 않는다
  assert.doesNotMatch(blockOutput({ ...QUIET, reason: "SECRET", error: "SECRET", quietCount: "SECRET" }), /SECRET/);
});

test("isQuiet: 명시적 open:false만", () => {
  assert.equal(isQuiet(QUIET), true);
  for (const x of [{ open: true }, {}, null, undefined, "false", 0, { open: "false" }, { open: 0 }, { open: null }, []]) assert.equal(isQuiet(x), false);
});

test("hook: /tick 아닌 프롬프트는 서버를 부르지 않고 출력도 없다", async () => {
  calls.length = 0;
  for (const p of ["/tick now", "/loop 3m /tick", "[DISPATCH D-0001] FLIGHT PLAN", "hello", ""]) assert.equal(await hookDecision(hook(p), "tower", deps(reply(200, QUIET))), null);
  assert.equal(calls.length, 0);
});

test("hook: /tick + QUIET은 차단한다(공백이 붙어도)", async () => {
  calls.length = 0;
  for (const p of ["/tick", "/tick   "]) assert.equal(await hookDecision(hook(p), "occ", deps(reply(200, QUIET))), '{"decision":"block","reason":"SQUELCH QUIET since 03:03Z (4)"}');
  assert.equal(calls[0].url, "http://atc.test/api/squelch/occ");
  assert.equal(calls[0].init.method, "POST");
  assert.ok(calls[0].init.signal);
});

test("hook: OPEN은 통과한다", async () => {
  for (const body of [{ open: true, reason: "signal", quietSince: null, quietCount: 0 }, { open: true, reason: "shadow:quiet" }, { open: true, reason: "fail-open", error: "x" }])
    assert.equal(await hookDecision(hook("/tick"), "tower", deps(reply(200, body))), null);
});

test("hook: 오류는 모두 통과한다 — 500, 404, 나쁜 JSON, 엉뚱한 본문, 서버 없음, 시간 초과", async () => {
  const cases = {
    "500": reply(500, QUIET), // 본문이 QUIET처럼 보여도 200이 아니면 통과
    "404": reply(404, { error: "x" }),
    "bad json": reply(200, new SyntaxError("Unexpected token")),
    "null body": reply(200, null),
    "string body": reply(200, "quiet"),
    "no open": reply(200, { reason: "quiet" }),
    "server down": async () => {
      throw new TypeError("fetch failed");
    },
  };
  for (const [name, impl] of Object.entries(cases)) assert.equal(await hookDecision(hook("/tick"), "tower", deps(impl)), null, name);
  // 시간 초과: signal이 abort되면 던지는 fetch. 3초를 기다리지 않게 timeoutMs를 줄인다
  const hang = (_u, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const t0 = Date.now();
  assert.equal(await hookDecision(hook("/tick"), "tower", { fetchImpl: hang, base: "http://atc.test", timeoutMs: 30 }), null);
  assert.ok(Date.now() - t0 < 1000);
});

test("hook: 깨진 stdin과 모르는 역할도 통과한다", async () => {
  assert.equal(await hookDecision("not json", "tower", deps(reply(200, QUIET))), null);
  assert.equal(await hookDecision("", "tower", deps(reply(200, QUIET))), null);
  assert.equal(await hookDecision("null", "tower", deps(reply(200, QUIET))), null);
  assert.equal(await hookDecision(hook("/tick"), "nobody", deps(reply(200, QUIET))), null);
  assert.equal(await hookDecision(hook("/tick"), "", deps(reply(200, QUIET))), null);
});

test("askSquelch: 기본 시간 제한은 3초, 기본 주소는 atcctl과 같다", async () => {
  const src = readFileSync(fileURLToPath(new URL("./squelch.mjs", import.meta.url)), "utf8");
  assert.match(src, /TIMEOUT_MS = 3000/);
  const atcctl = readFileSync(fileURLToPath(new URL("./atcctl.mjs", import.meta.url)), "utf8");
  assert.match(atcctl, /const BASE = atcBase\(\);/);
  const saved = process.env.ATC_URL;
  delete process.env.ATC_URL;
  assert.equal(atcBase(), "http://127.0.0.1:7700");
  process.env.ATC_URL = "http://127.0.0.1:7702";
  assert.equal(atcBase(), "http://127.0.0.1:7702");
  if (saved === undefined) delete process.env.ATC_URL;
  else process.env.ATC_URL = saved;
  await assert.rejects(askSquelch("tower", deps(reply(503, {}))));
});

test("squelchLine: atcctl squelch의 출력", async () => {
  assert.equal(await squelchLine("tower", deps(reply(200, QUIET))), "QUIET since 03:03 (4)");
  assert.equal(await squelchLine("tower", deps(reply(200, { open: true, reason: "shadow:quiet", quietSince: null, quietCount: 0 }))), "OPEN shadow:quiet");
  assert.equal(await squelchLine("tower", deps(reply(200, { open: true, reason: "fail-open", error: "boom" }))), "OPEN fail-open (boom)");
  assert.equal(await squelchLine("tower", deps(reply(500, {}))), "OPEN fail-open (HTTP 500)");
  assert.equal(await squelchLine("tower", deps(async () => Promise.reject(new TypeError("fetch failed")))), "OPEN fail-open (fetch failed)");
});

test("squelch.mjs의 소스에는 exit 2도 guard 이름도 없다(fail-open 설계)", () => {
  const src = readFileSync(fileURLToPath(new URL("./squelch.mjs", import.meta.url)), "utf8");
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /exit\(2\)|exitCode\s*=\s*2|\bguard\b/i);
});

// ── 진짜 프로세스: stdin·종료 코드·출력 ──
test("프로세스: QUIET이면 JSON을 찍고, 그 밖에는 조용히 0으로 끝난다", async () => {
  let body = QUIET;
  let status = 200;
  const server = createServer((req, res) => {
    res.statusCode = status;
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    // 같은 프로세스의 서버를 부르므로 비동기 spawn을 쓴다(spawnSync는 이벤트 루프를 막는다)
    const go = (input, role = "tower", u = url) =>
      new Promise((resolve) => {
        const p = spawn(process.execPath, [fileURLToPath(new URL("./squelch.mjs", import.meta.url)), role], { env: { ...process.env, ATC_URL: u } });
        let out = "";
        let err = "";
        p.stdout.on("data", (d) => (out += d));
        p.stderr.on("data", (d) => (err += d));
        p.on("close", (code) => resolve({ code, out, err }));
        p.stdin.end(input);
      });
    assert.deepEqual(await go(hook("/tick")), { code: 0, out: '{"decision":"block","reason":"SQUELCH QUIET since 03:03Z (4)"}\n', err: "" });
    assert.deepEqual(await go(hook("/tick now")), { code: 0, out: "", err: "" });
    body = { open: true, reason: "signal", quietCount: 0 };
    assert.deepEqual(await go(hook("/tick")), { code: 0, out: "", err: "" });
    body = "not json";
    assert.deepEqual(await go(hook("/tick")), { code: 0, out: "", err: "" });
    body = QUIET;
    status = 500;
    assert.deepEqual(await go(hook("/tick")), { code: 0, out: "", err: "" });
    assert.deepEqual(await go("garbage"), { code: 0, out: "", err: "" });
    assert.deepEqual(await go(hook("/tick"), "tower", "http://127.0.0.1:1"), { code: 0, out: "", err: "" }); // 서버 없음
  } finally {
    server.close();
  }
});

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { briefHookText } from "./brief-hook.mjs";

const HOOK = new URL("brief-hook.mjs", import.meta.url).pathname;
const run = (env) =>
  new Promise((resolve) => {
    const p = execFile(process.execPath, [HOOK], { env: { ...process.env, ...env }, encoding: "utf8", timeout: 15_000 }, (err, stdout) => resolve({ code: err ? (err.code ?? 1) : 0, stdout }));
    p.stdin.end("{}");
  });

test("서버가 답하면 brief의 text를 그대로 찍는다", async () => {
  const fetchImpl = async () => ({ status: 200, json: async () => ({ text: "DUTY BRIEF x\nQUEUE 0" }) });
  assert.equal(await briefHookText({ fetchImpl, base: "http://x" }), "DUTY BRIEF x\nQUEUE 0");
});

test("fail-open: HTTP 오류·빈 답·깨진 답·연결 실패는 던지지 않고 'brief unavailable: …' 한 줄", async () => {
  const cases = [
    [async () => ({ status: 500, json: async () => ({}) }), /^brief unavailable: HTTP 500$/],
    [async () => ({ status: 200, json: async () => ({ text: "  " }) }), /^brief unavailable: empty brief$/],
    [
      async () => ({
        status: 200,
        json: async () => {
          throw new Error("bad json");
        },
      }),
      /^brief unavailable: bad json$/,
    ],
    [
      async () => {
        throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
      },
      /^brief unavailable: ECONNREFUSED$/,
    ],
  ];
  for (const [fetchImpl, re] of cases) {
    const out = await briefHookText({ fetchImpl, base: "http://x" });
    assert.match(out, re);
    assert.ok(!out.includes("\n"), "한 줄");
  }
});

test("fail-open: 느린 서버는 제한 시간 뒤 'no answer in …s'", async () => {
  const fetchImpl = (_u, { signal }) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted"))));
  const t0 = Date.now();
  const out = await briefHookText({ fetchImpl, base: "http://x", timeoutMs: 80 });
  assert.match(out, /^brief unavailable: no answer in \d+s$/);
  assert.ok(Date.now() - t0 < 2000);
});

test("실행 파일: 서버가 내려가 있어도(닫힌 포트) 종료 코드 0과 'brief unavailable' 한 줄", async () => {
  const r = await run({ ATC_URL: "http://127.0.0.1:9" });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^brief unavailable: /);
});

test("실행 파일: 서버가 있으면 brief text를 찍고 0으로 끝난다", async () => {
  const srv = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(req.url === "/api/duty/brief" ? JSON.stringify({ text: "DUTY BRIEF hello" }) : "{}");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const { port } = srv.address();
  try {
    const r = await run({ ATC_URL: `http://127.0.0.1:${port}` });
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), "DUTY BRIEF hello");
  } finally {
    srv.close();
  }
});

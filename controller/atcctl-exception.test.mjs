import assert from "node:assert/strict";
import { test } from "node:test";
import { parseExceptionArgs } from "./atcctl.mjs";

// atcctl exception(ATC-558): 관제 세션이 팀의 UNABLE·질문·두 번째 침묵을 예외 판정에 묻는다
test("exception: <D-/C-id> --kind unable|question|silence, 글은 -- 뒤(silence는 없어도 된다)", () => {
  assert.deepEqual(parseExceptionArgs(["c-0012", "--kind", "unable", "--", "UNABLE", "C-0012", "—", "needs", "ATC-7"]), { ref: "C-0012", kind: "unable", text: "UNABLE C-0012 — needs ATC-7" });
  assert.deepEqual(parseExceptionArgs(["D-0003", "--kind", "silence"]), { ref: "D-0003", kind: "silence", text: "" });
  assert.throws(() => parseExceptionArgs(["CC-0003", "--kind", "unable", "--", "x"]), /exception <D-0003\|C-0007>/);
  assert.throws(() => parseExceptionArgs(["C-0012", "--kind", "maybe", "--", "x"]), /--kind/);
  assert.throws(() => parseExceptionArgs(["C-0012", "--kind", "question"]), /CAPTAIN의 글/);
  assert.throws(() => parseExceptionArgs(["C-0012", "--", "x"]), /--kind/);
});

test("exception: 서버의 답(line)만 찍고 CAPTAIN 글은 되찍지 않는다. 역할은 id에서", async () => {
  const { createServer } = await import("node:http");
  const { execFile } = await import("node:child_process");
  const bodies = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (b) => (raw += b));
    req.on("end", () => {
      bodies.push({ url: `${req.method} ${req.url}`, body: JSON.parse(raw || "{}") });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ line: "EXCEPTION EX-C-0012-abcd1234 · ESCALATE · jev 91%\nCARD: DC-0007", judgment: {} }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const run = (...args) =>
    new Promise((resolve) => execFile(process.execPath, [new URL("./atcctl.mjs", import.meta.url).pathname, "exception", ...args], { env: { ...process.env, ATC_URL: url } }, (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout, stderr })));
  try {
    const r = await run("C-0012", "--kind", "question", "--", "secret-ish question text");
    assert.equal(r.code, 0);
    assert.equal(r.stdout, "EXCEPTION EX-C-0012-abcd1234 · ESCALATE · jev 91%\nCARD: DC-0007\n");
    assert.ok(!r.stdout.includes("secret-ish"));
    assert.deepEqual(bodies, [{ url: "POST /api/exceptions", body: { ref: "C-0012", kind: "question", text: "secret-ish question text", role: "tower" } }]);
  } finally {
    server.close();
  }
});

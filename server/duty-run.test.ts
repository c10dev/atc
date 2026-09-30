import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Hono } from "hono";
import { config } from "./config.ts";
import { DutyRuntime, mountDutyRun } from "./duty-run.ts";
import { parseDutyConfig, type DutyConfig } from "./duty-config.ts";

// 가짜 claude: stream-json을 흉내 낸다(진짜 프로세스도 API도 쓰지 않는다).
// 사용자 줄 하나마다 init → 조각 → assistant → result. 글이 "slow"로 시작하면 result를 늦춘다. 글이 "guard"면 거절된 도구 호출을 낸다.
// interrupt를 받으면 중단 결과를 내고 프로세스는 그대로. stdin이 닫히면 끝난다. 인자는 argv.log에 남긴다
const FAKE = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const { createInterface } = require("node:readline");
const { existsSync } = require("node:fs");
appendFileSync(__dirname + "/argv.log", JSON.stringify(process.argv.slice(2)) + "\\n");
appendFileSync(__dirname + "/env.log", String(process.env.ATC_URL) + "\\n");
appendFileSync(__dirname + "/cfgdir.log", String(process.env.CLAUDE_CONFIG_DIR) + "\\n");
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
let timer = null;
const finish = (text, extra = {}) => {
  out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }], stop_reason: null } });
  out({ type: "rate_limit_event", rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.1, resetsAt: 1 } } } });
  out({ type: "result", subtype: "success", is_error: false, result: text, total_cost_usd: 0.01, num_turns: 1, usage: { input_tokens: 2, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 5 }, ...extra });
};
createInterface({ input: process.stdin }).on("line", (line) => {
  const j = JSON.parse(line);
  if (j.type === "control_request") {
    clearTimeout(timer);
    out({ type: "control_response", response: { subtype: "success", request_id: j.request_id } });
    out({ type: "result", subtype: "error_during_execution", is_error: true, usage: {} });
    return;
  }
  const c = j.message.content;
  const text = c.filter((b) => b.type === "text").map((b) => b.text).join("");
  const hasImage = c.some((b) => b.type === "image");
  out({ type: "system", subtype: "init", session_id: "s", model: "fake" });
  if (text.startsWith("guard")) {
    out({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "curl http://x" } }] } });
    out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "PreToolUse:Bash hook error: blocked" }] } });
  }
  out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "re" } } });
  const reply = "re:" + text + (hasImage ? "+image" : "");
  if (text.startsWith("slow")) timer = setTimeout(() => finish(reply), 400);
  else finish(reply);
});
process.stdin.on("end", () => process.exit(0));
if (existsSync(__dirname + "/crash")) { process.stderr.write("fake crash\\n"); process.exit(3); }
`;

const rigs: DutyRuntime[] = [];
after(() => rigs.forEach((r) => r.dispose())); // 실패한 시험이 프로세스를 남겨 러너가 멈추지 않게

function rig(over: { idleMs?: number; cfg?: Partial<DutyConfig>; crash?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "duty-run-"));
  const state = join(dir, "state");
  mkdirSync(state, { recursive: true });
  const bin = join(dir, "claude");
  writeFileSync(bin, FAKE);
  chmodSync(bin, 0o755);
  if (over.crash) writeFileSync(join(dir, "crash"), "");
  const cfg = parseDutyConfig({ enabled: true, ...over.cfg });
  const rt = new DutyRuntime({ stateDir: state, claudeBin: bin, loadConfig: () => cfg, accountDir: (l) => (l === "acct-2" ? join(dir, "acct") : l === "acct-3" ? join(dir, "acct3") : null), idleTickMs: 20, ...(over.idleMs ? { idleMs: over.idleMs } : {}) });
  rigs.push(rt);
  const events: { type: string; final?: boolean }[] = [];
  rt.subscribe((e) => events.push(e as { type: string; final?: boolean }));
  const log = () => (existsSync(join(state, "duty.jsonl")) ? readFileSync(join(state, "duty.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { kind: string; text?: string; name?: string; error?: boolean; image?: string; summary?: string }) : []);
  const argv = () => readFileSync(join(dir, "argv.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]);
  return { rt, state, events, log, argv, cfg, dir };
}
const until = async (f: () => boolean, ms = 4000) => {
  const t = Date.now();
  while (!f()) {
    if (Date.now() - t > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 15));
  }
};
const idle = (r: ReturnType<typeof rig>) => until(() => r.rt.status().state === "idle" && r.events.some((e) => e.type === "usage"));

test("첫 글이 프로세스를 띄우고, 사용자 글·DUTY 글·사용량이 duty.jsonl에 순서대로 남는다", async () => {
  const r = rig();
  assert.equal(r.rt.status().state, "idle");
  assert.ok(!existsSync(join(r.state, "duty-session.json")), "글을 보내기 전에는 아무것도 띄우지 않는다");
  assert.deepEqual(await r.rt.send("hello"), { verdict: "sent" });
  await idle(r);
  const kinds = r.log().map((l) => l.kind);
  assert.deepEqual(kinds, ["user", "text", "usage"]);
  assert.equal(r.log()[1]!.text, "re:hello");
  const st = r.rt.status();
  assert.equal(st.context, 1002);
  assert.equal(st.costUsd, 0.01);
  assert.equal(st.account, "acct-2");
  assert.equal(st.rates[0]!.window, "five_hour");
  assert.ok(r.events.some((e) => e.type === "text" && e.final === false), "조각이 스트림으로 나간다");
  assert.equal(readFileSync(join(r.dir, "env.log"), "utf8").trim(), `http://127.0.0.1:${config.port}`, "DUTY의 atcctl은 자기를 띄운 서버에 말한다");
  const a = r.argv()[0]!;
  assert.ok(a.includes("--session-id") && a.includes("--tools") && a.includes("--strict-mcp-config"));
  const saved = JSON.parse(readFileSync(join(r.state, "duty-session.json"), "utf8")) as { sessionId: string };
  assert.equal(a[a.indexOf("--session-id") + 1], saved.sessionId);
  r.rt.dispose();
});

test("턴이 도는 중 둘째 글은 줄 서고 순서대로 답한다(로그에 두 글이 순서대로)", async () => {
  const r = rig();
  assert.equal((await r.rt.send("slow one")).verdict, "sent");
  assert.equal((await r.rt.send("two")).verdict, "queued");
  assert.equal(r.rt.status().queued, 1);
  await until(() => r.log().filter((l) => l.kind === "text").length === 2);
  await idle(r);
  assert.deepEqual(r.log().filter((l) => l.kind === "user" || l.kind === "text").map((l) => l.text), ["slow one", "re:slow one", "two", "re:two"]);
  assert.equal(r.argv().length, 1, "프로세스는 하나");
  r.rt.dispose();
});

test("stop은 interrupt를 써서 턴만 끝내고 프로세스는 남는다. 다음 글은 같은 프로세스가 답한다", async () => {
  const r = rig();
  await r.rt.send("slow long answer");
  await until(() => r.rt.status().state === "thinking");
  r.rt.stop();
  await until(() => r.rt.status().state === "idle");
  assert.ok(!r.log().some((l) => l.kind === "text"), "중단된 턴은 글이 없다");
  assert.ok(!r.log().some((l) => l.kind === "notice"), "중단은 오류 알림이 아니다");
  assert.equal((await r.rt.send("after")).verdict, "sent");
  await until(() => r.log().some((l) => l.text === "re:after"));
  assert.equal(r.argv().length, 1);
  r.rt.dispose();
});

test("유휴 시간이 지나면 stdin을 닫아 끝내고, 다음 글은 같은 대화 id로 --resume 한다", async () => {
  const r = rig({ idleMs: 60 });
  await r.rt.send("first");
  await idle(r);
  const id = JSON.parse(readFileSync(join(r.state, "duty-session.json"), "utf8")).sessionId as string;
  await until(() => r.argv().length === 1 && r.rt.status().state === "idle");
  await new Promise((res) => setTimeout(res, 250)); // 유휴 종료를 기다린다
  await r.rt.settled();
  await r.rt.send("second");
  await until(() => r.log().some((l) => l.text === "re:second"));
  const second = r.argv()[1]!;
  assert.ok(second.includes("--resume"), "두 번째 프로세스는 resume");
  assert.equal(second[second.indexOf("--resume") + 1], id);
  r.rt.dispose();
});

test("ACCOUNT가 바뀌면 다음 글은 새 CLAUDE_CONFIG_DIR의 새 --session-id(--resume 없음), 로그에 account 줄(ATC-242)", async () => {
  const r = rig({ idleMs: 60 });
  await r.rt.send("one");
  await idle(r);
  const id = JSON.parse(readFileSync(join(r.state, "duty-session.json"), "utf8")).sessionId as string;
  const prev = { ...r.cfg };
  r.cfg.account = "acct-3";
  await r.rt.configChanged(prev, r.cfg);
  assert.equal(r.rt.status().account, "acct-3");
  assert.equal(r.rt.status().sessionId, null);
  assert.ok(r.log().some((l) => l.kind === "account" && (l as never as { from: string }).from === "acct-2" && (l as never as { to: string }).to === "acct-3"));
  await r.rt.send("two");
  await until(() => r.log().some((l) => l.text === "re:two"));
  const second = r.argv()[1]!;
  assert.ok(second.includes("--session-id") && !second.includes("--resume"));
  assert.notEqual(second[second.indexOf("--session-id") + 1], id);
  assert.deepEqual(readFileSync(join(r.dir, "cfgdir.log"), "utf8").trim().split("\n"), [join(r.dir, "acct"), join(r.dir, "acct3")]);
  assert.equal(JSON.parse(readFileSync(join(r.state, "duty-session.json"), "utf8")).account, "acct-3");
  r.rt.dispose();
});

test("돌고 있는 턴은 옛 ACCOUNT에서 끝나고, 줄 선 글은 새 ACCOUNT의 새 대화가 받는다(ATC-242)", async () => {
  const r = rig();
  await r.rt.send("slow answer");
  await until(() => r.rt.status().state === "thinking");
  assert.equal((await r.rt.send("queued")).verdict, "queued");
  const prev = { ...r.cfg };
  r.cfg.account = "acct-3";
  await r.rt.configChanged(prev, r.cfg);
  await until(() => r.log().some((l) => l.text === "re:queued"));
  assert.ok(r.log().some((l) => l.text === "re:slow answer"), "돌던 턴은 죽지 않고 끝난다");
  assert.equal(r.argv().length, 2);
  assert.ok(!r.argv()[1]!.includes("--resume"));
  assert.deepEqual(readFileSync(join(r.dir, "cfgdir.log"), "utf8").trim().split("\n"), [join(r.dir, "acct"), join(r.dir, "acct3")]);
  r.rt.dispose();
});

test("서버가 내려가 있는 사이 duty.json의 ACCOUNT가 바뀌었으면(저장된 대화의 ACCOUNT와 다름) --resume하지 않는다(ATC-242)", async () => {
  const r = rig({ idleMs: 60 });
  await r.rt.send("one");
  await idle(r);
  r.rt.dispose();
  const r2 = rig({ cfg: { account: "acct-3" } });
  writeFileSync(join(r2.state, "duty-session.json"), readFileSync(join(r.state, "duty-session.json")));
  const rt2 = new DutyRuntime({ stateDir: r2.state, claudeBin: join(r2.dir, "claude"), loadConfig: () => r2.cfg, accountDir: (l) => join(r2.dir, l), idleTickMs: 20 });
  await rt2.send("after restart");
  await until(() => existsSync(join(r2.dir, "argv.log")));
  assert.ok(!r2.argv()[0]!.includes("--resume"));
  rt2.dispose();
  r2.rt.dispose();
});

test("NEW SHIFT: 프로세스를 끝내고 다음 글은 새 --session-id. 로그에 shift 줄", async () => {
  const r = rig();
  await r.rt.send("one");
  await idle(r);
  const id = JSON.parse(readFileSync(join(r.state, "duty-session.json"), "utf8")).sessionId as string;
  await r.rt.newShift();
  assert.equal(r.rt.status().sessionId, null);
  await r.rt.send("two");
  await until(() => r.log().some((l) => l.text === "re:two"));
  const second = r.argv()[1]!;
  assert.ok(second.includes("--session-id") && !second.includes("--resume"));
  assert.notEqual(second[second.indexOf("--session-id") + 1], id);
  assert.ok(r.log().some((l) => l.kind === "shift"));
  r.rt.dispose();
});

test("guard가 거절한 도구 호출은 도구 오류 줄로 남고(입력 없음), 턴은 계속된다", async () => {
  const r = rig();
  await r.rt.send("guard test");
  await idle(r);
  const tool = r.log().find((l) => l.kind === "tool" && l.error)!;
  assert.equal(tool.name, "Bash");
  assert.equal(tool.summary, "PreToolUse:Bash hook error: blocked");
  assert.equal(r.log().at(-2)!.kind, "text");
  r.rt.dispose();
});

test("그림을 붙이면 상태 폴더 duty-images/에 파일로 두고 로그에는 파일 이름만. 형식·크기 검사", async () => {
  const r = rig();
  const png = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
  assert.equal((await r.rt.send("look", { mediaType: "image/png", base64: png })).verdict, "sent");
  await idle(r);
  const u = r.log()[0]!;
  assert.match(u.image ?? "", /\.png$/);
  assert.deepEqual(readdirSync(join(r.state, "duty-images")), [u.image]);
  assert.equal(r.log()[1]!.text, "re:look+image");
  const bad = await r.rt.send("x", { mediaType: "image/gif", base64: png });
  assert.equal(bad.verdict, "refused");
  const big = await r.rt.send("x", { mediaType: "image/png", base64: "A".repeat(8 * 1024 * 1024) });
  assert.equal(big.verdict, "refused");
  r.rt.dispose();
});

test("예상 밖 종료는 down + stderr 줄. 다음 글은 다시 띄우고, 5분 안에 3번이면 막혀서 글을 거절한다", async () => {
  const r = rig({ crash: true });
  await r.rt.send("a");
  await until(() => r.rt.status().state === "down");
  assert.equal(r.rt.status().error, "fake crash");
  assert.equal((await r.rt.send("b")).verdict, "sent");
  await until(() => r.rt.status().state === "down" && r.argv().length === 2);
  assert.equal((await r.rt.send("c")).verdict, "sent");
  await until(() => r.rt.status().blocked);
  const refused = await r.rt.send("d");
  assert.equal(refused.verdict, "refused");
  assert.equal(r.argv().length, 3, "막힌 뒤에는 다시 띄우지 않는다");
  await r.rt.newShift();
  assert.ok(!r.rt.status().blocked);
  r.rt.dispose();
});

test("꺼져 있으면 보내지 않고 이유를 준다. ACCOUNT를 못 찾아도 띄우지 않는다", async () => {
  const off = rig({ cfg: { enabled: false } });
  const r1 = await off.rt.send("hi");
  assert.equal(r1.verdict, "refused");
  assert.match(r1.reason ?? "", /꺼져/);
  assert.ok(!existsSync(join(off.state, "duty-session.json")));
  const noAcct = rig({ cfg: { account: "acct-9" } });
  const r2 = await noAcct.rt.send("hi");
  assert.equal(r2.verdict, "refused");
  assert.match(r2.reason ?? "", /acct-9/);
  off.rt.dispose();
  noAcct.rt.dispose();
});

test("끄면(configChanged) 실행 중인 프로세스가 끝난다", async () => {
  const r = rig();
  await r.rt.send("hi");
  await idle(r);
  await r.rt.configChanged({ ...r.cfg, enabled: true }, { ...r.cfg, enabled: false });
  await r.rt.settled();
  assert.equal(r.rt.status().state, "idle");
});

test("history: 뒤에서부터 쪽을 나눈다", async () => {
  const r = rig();
  await r.rt.send("h");
  await idle(r);
  const all = r.rt.history();
  assert.equal(all.lines.length, 3);
  assert.equal(all.next, null);
  assert.deepEqual(r.rt.history(1).lines.map((l) => l.kind), ["user"]);
  r.rt.dispose();
});

// ── 라우트: Origin과 enabled ──
const J = { "content-type": "application/json" };
function routes(enabled: boolean) {
  const r = rig({ cfg: { enabled } });
  const app = new Hono();
  mountDutyRun(app, () => r.rt);
  return { ...r, app };
}
const post = (app: Hono, path: string, headers: Record<string, string>, body: unknown = {}) => app.request(path, { method: "POST", headers, body: JSON.stringify(body) });

test("POST /api/duty/*: Origin이 없거나 다른 사이트면 403(atcctl은 보낼 수 없다), JSON이 아니어도 403", async () => {
  const { app, rt } = routes(true);
  for (const p of ["/api/duty/message", "/api/duty/stop", "/api/duty/new-shift"]) {
    assert.equal((await post(app, p, J, { text: "x" })).status, 403, `${p} Origin 없음`);
    assert.equal((await post(app, p, { ...J, origin: "https://evil.example" }, { text: "x" })).status, 403, `${p} 다른 사이트`);
    assert.equal((await post(app, p, { origin: "http://localhost:7700" }, { text: "x" })).status, 403, `${p} JSON 아님`);
  }
  assert.equal(rt.status().state, "idle");
  assert.equal(rt.history().lines.length, 0, "거절된 요청은 아무것도 쓰지 않는다");
  rt.dispose();
});

test("POST /api/duty/*: enabled가 꺼져 있으면 409와 이유(프로세스 없음)", async () => {
  const { app, rt, state } = routes(false);
  const H = { ...J, origin: "http://localhost:7700" };
  for (const p of ["/api/duty/message", "/api/duty/stop", "/api/duty/new-shift"]) {
    const res = await post(app, p, H, { text: "x" });
    assert.equal(res.status, 409, p);
    assert.match(((await res.json()) as { error: string }).error, /꺼져/);
  }
  assert.ok(!existsSync(join(state, "duty-session.json")));
  rt.dispose();
});

test("POST /api/duty/message: 검사(빈 글·긴 글·깨진 JSON)와 보냄·줄 섬 응답", async () => {
  const { app, rt } = routes(true);
  const H = { ...J, origin: "http://127.0.0.1:7700" };
  assert.equal((await post(app, "/api/duty/message", H, { text: "  " })).status, 400);
  assert.equal((await post(app, "/api/duty/message", H, { text: "x".repeat(20_001) })).status, 413);
  assert.equal((await app.request("/api/duty/message", { method: "POST", headers: H, body: "{nope" })).status, 400);
  const a = await post(app, "/api/duty/message", H, { text: "slow route" });
  assert.equal(a.status, 200);
  const b = await post(app, "/api/duty/message", H, { text: "second" });
  assert.equal(b.status, 202);
  assert.deepEqual(await b.json(), { queued: true, note: "DUTY is answering — 차례를 기다립니다" });
  await until(() => rt.history().lines.filter((l) => l.kind === "text").length === 2);
  const st = (await (await app.request("/api/duty/status")).json()) as { state: string; enabled: boolean };
  assert.equal(st.enabled, true);
  const hist = (await (await app.request("/api/duty/history?before=2")).json()) as { lines: unknown[] };
  assert.equal(hist.lines.length, 2);
  assert.equal((await app.request("/api/duty/history?before=-1")).status, 400);
  rt.dispose();
});

test("D3: 받아들인 카드·초안은 duty.jsonl과 이벤트에 글 사이의 제자리로 들어간다", async () => {
  const r = rig();
  await r.rt.send("hello");
  await idle(r);
  r.rt.recordDraft({ id: "DD-0001", at: "x", kind: "card", card: { queueKind: "FLEET PLAN", key: "FP-1", title: "t", since: null, hash: "#fleet" } });
  r.rt.recordDraft({ id: "DD-0002", at: "x", kind: "note", text: "a rule", until: null });
  r.rt.recordDraft({ id: "DD-0003", at: "x", kind: "charter", text: "do it" });
  const lines = r.log() as { kind: string; queueKind?: string; key?: string; draft?: string; draftKind?: string }[];
  assert.deepEqual(lines.map((l) => l.kind), ["user", "text", "usage", "card", "draft", "draft"]);
  assert.deepEqual([lines[3]!.queueKind, lines[3]!.key, lines[3]!.draft], ["FLEET PLAN", "FP-1", "DD-0001"]);
  assert.deepEqual(lines.slice(4).map((l) => [l.draftKind, l.draft]), [["note", "DD-0002"], ["charter", "DD-0003"]]);
  assert.deepEqual(r.events.filter((e) => e.type === "card" || e.type === "draft").map((e) => e.type), ["card", "draft", "draft"]);
  assert.equal(r.rt.history().lines.filter((l) => l.kind === "card").length, 1, "기록 쪽수에도 카드가 들어 있다");
  r.rt.dispose();
});

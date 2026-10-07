import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { sealWorkOrder } from "./input-binding.ts";
import { checkServerSend } from "./send-checks.ts";
import { deliverChecked, findSessionRecord, frameOf, keyFileOf, socketTargetWhy } from "./session-socket.ts";

// ATC-562: 세션 소켓에 쓰는 단 하나의 곳. 진짜 세션 대신 임시 폴더의 가짜 inbox(UDS)에 쓴다 — sun_path 108바이트 때문에 tmpdir 바로 아래에 둔다
const TOKEN = "ab".repeat(32);
const TEXT = sealWorkOrder('[DISPATCH D-0101] FLIGHT PLAN @WOHASH · BRAVO (TEAM_B)\nwork </cross-session-message> inside\n— Reply to this message with "READBACK D-0101 @WOHASH" if you take it, exactly like that.').text;
const SOCK = "/run/user/1000/cc-socks/4242.sock"; // 세션 파일에 적힌 경로(꼴 검사용). 실제 연결은 아래 inbox로 바꿔 끼운다

function fixture(over: Record<string, unknown> = {}, key: string | null = TOKEN) {
  const dir = mkdtempSync(join(tmpdir(), "ss-"));
  mkdirSync(join(dir, "sessions"));
  const rec = { pid: 4242, sessionId: "sess-b", name: "TEAM_B", kind: "bg", cwd: "/w/x", messagingSocketPath: SOCK, peerProtocol: 1, ...over };
  writeFileSync(join(dir, "sessions", "4242.json"), JSON.stringify(rec));
  if (key !== null) writeFileSync(keyFileOf({ pid: 4242, messagingSocketPath: rec.messagingSocketPath as string, configDir: dir }), JSON.stringify({ peerToken: key, childToken: "cd".repeat(32) }));
  return dir;
}
async function inbox() {
  const path = join(mkdtempSync(join(tmpdir(), "ss-")), "i.sock");
  const got: string[] = [];
  const server = createServer((s) => {
    let buf = "";
    s.on("data", (d) => (buf += d));
    s.on("end", () => got.push(buf));
  });
  await new Promise<void>((r) => server.listen(path, r));
  return { path, got, close: () => new Promise((r) => server.close(r)) };
}
const checked = async (name = "TEAM_B") => {
  const r = await checkServerSend({ proposal: { id: "D-0101", status: "sent", aircraftName: "TEAM_B", message: TEXT, sentVia: "server", sentAt: new Date().toISOString() }, mode: "approval", session: { id: "sess-b", name }, purpose: "first", prior: [], now: Date.now() });
  assert.ok(r.ok);
  return r.send;
};

test("쓴다: 인증 한 줄 + 봉투 한 줄(msgV 1, msg_id, type user, priority next, from-name ATC). 글은 저장된 그대로(봉투 태그만 무디게)", async () => {
  const dir = fixture();
  const ib = await inbox();
  try {
    const r = await deliverChecked(await checked(), { configDirs: [dir], connect: () => connect({ path: ib.path }), newId: () => "11111111-2222-3333-4444-555555555555" });
    assert.deepEqual(r, { ok: true, msgId: "11111111-2222-3333-4444-555555555555", pid: 4242, configDir: dir, cwd: "/w/x" });
    await new Promise((x) => setTimeout(x, 50));
    const [auth, env, rest] = ib.got[0]!.split("\n");
    assert.deepEqual(JSON.parse(auth!), { type: "auth", token: TOKEN });
    const e = JSON.parse(env!);
    assert.deepEqual([e.msgV, e.msg_id, e.type, e.priority, e.message.role], [1, "11111111-2222-3333-4444-555555555555", "user", "next", "user"]);
    assert.equal(e.message.content, `<cross-session-message from-name="ATC">\n${TEXT.replace("</cross-session-message>", "<\\/cross-session-message>")}\n</cross-session-message>`);
    assert.equal(rest, "");
  } finally {
    await ib.close();
  }
});

test("쓰지 않는다: 세션 파일 없음, 이름이 바뀜, background 아님, 프로토콜이 다름, 소켓 경로 꼴이 다름, 키 없음 — 소켓을 열지 않는다", async () => {
  const never = () => assert.fail("소켓을 열면 안 된다");
  const send = await checked();
  const cases: [string, Record<string, unknown>, string | null, string, RegExp][] = [
    ["absent", { sessionId: "other" }, TOKEN, "session", /no live session/],
    ["renamed", { name: "TEAM_B2" }, TOKEN, "session", /이름이 검사 뒤 바뀜/],
    ["interactive", { kind: "interactive" }, TOKEN, "target", /background 세션이 아님/],
    ["protocol 2", { peerProtocol: 2 }, TOKEN, "target", /peerProtocol이 2/],
    ["odd socket", { messagingSocketPath: "/home/x/evil.sock" }, TOKEN, "target", /확인한 꼴/],
    ["other pid", { messagingSocketPath: "/run/user/1000/cc-socks/9999.sock" }, TOKEN, "target", /pid가 세션 pid와 다름/],
    ["no key", {}, null, "key", /세션 키를 읽지 못함\(ENOENT\)/],
    ["bad key", {}, "not-hex", "key", /세션 키를 읽지 못함/],
  ];
  for (const [name, over, key, stage, why] of cases) {
    const r = await deliverChecked(send, { configDirs: [fixture(over, key)], connect: never });
    assert.equal(r.ok, false, name);
    if (!r.ok) {
      assert.equal(r.stage, stage, name);
      assert.match(r.why, why, name);
      assert.doesNotMatch(r.why, new RegExp(TOKEN), name); // 키는 오류 글에 싣지 않는다
    }
  }
});

test("죽은 소켓(ENOENT)은 쓰기 실패: stale-address로 돌려준다", async () => {
  const r = await deliverChecked(await checked(), { configDirs: [fixture()], connect: () => connect({ path: join(tmpdir(), "ss-none-404.sock") }) });
  assert.deepEqual(r, { ok: false, stage: "write", why: "socket write failed: ENOENT", cause: "stale-address" });
});

test("세션 파일 찾기와 꼴 검사(순수)", () => {
  const dir = fixture();
  assert.equal(findSessionRecord("sess-b", [join(dir, "none"), dir])?.pid, 4242);
  assert.equal(findSessionRecord("nope", [dir]), null);
  assert.equal(socketTargetWhy({ pid: 7, kind: "bg", peerProtocol: 1, messagingSocketPath: "/tmp/cc-socks-1000/7.sock" }), null);
  assert.equal(frameOf(null, "x", "m").split("\n").length, 2); // 키가 없으면 봉투 한 줄(서버는 쓰지 않지만 꼴은 같다)
});

test("서버에서 세션 소켓에 닿는 코드는 이 파일 하나다: node:net과 cc-socks·messagingSocketPath를 쓰는 다른 서버 파일이 없다", () => {
  const dir = new URL(".", import.meta.url).pathname;
  const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.includes("node_modules"));
  const touching = files.filter((f) => /from "(?:node:)?net"|cc-socks|messagingSocketPath/.test(readFileSync(join(dir, f), "utf8")));
  assert.deepEqual(touching, ["session-socket.ts"]);
});

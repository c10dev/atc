import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Hono } from "hono";
import { config } from "./config.ts";
import { gatherInputs, mountSquelch, readState, type SquelchDeps } from "./squelch-run.ts";

// 시험은 임시 상태 폴더에서 돈다. 진짜 ~/.local/state/atc는 읽지도 쓰지도 않는다
const dir = mkdtempSync(join(tmpdir(), "squelch-"));
config.stateDir = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const file = (n: string) => join(dir, n);
const lines = () => (existsSync(file("squelch.jsonl")) ? readFileSync(file("squelch.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
// ATC-553: 코드 기본값이 on·v2라, 이 시험들이 보는 shadow·v1 흐름은 파일에 적어서 만든다
const SHADOW_FILE = JSON.stringify({ config: { mode: "shadow", fingerprint: { tower: "v1", mcc: "v1", occ: "v1", crosscheck: "v1", review: "v1" } }, roles: {} });
const reset = () => {
  writeFileSync(file("squelch.json"), SHADOW_FILE);
  rmSync(file("squelch.jsonl"), { force: true });
};

const review = (head: string) => ({ pending: [{ pr: "atc#150", head }], excluded: [], recent: [] });
function setup(over: SquelchDeps & { head?: string } = {}) {
  const box = { head: over.head ?? "abc1234", manual: false, calls: [] as string[] };
  const app = new Hono();
  mountSquelch(app, {
    get: async (path) => {
      box.calls.push(path);
      return review(box.head);
    },
    manual: async () => box.manual,
    ...over,
  });
  const post = (role: string) => app.request(`/api/squelch/${role}`, { method: "POST" });
  return { app, box, post };
}

test("shadow가 기본: 늘 열리고, 둘째는 shadow:quiet, 바뀌면 shadow:signal", async () => {
  reset();
  const { post, box } = setup();
  const one = await (await post("review")).json();
  assert.deepEqual([one.open, one.reason, one.quietCount], [true, "shadow:first", 0]);
  const two = await (await post("review")).json();
  assert.deepEqual([two.open, two.reason, two.quietCount], [true, "shadow:quiet", 1]);
  assert.ok(two.quietSince);
  const three = await (await post("review")).json();
  assert.deepEqual([three.open, three.reason, three.quietCount, three.quietSince], [true, "shadow:quiet", 2, two.quietSince]);
  box.head = "def5678";
  const four = await (await post("review")).json();
  assert.deepEqual([four.open, four.reason, four.quietCount, four.quietSince], [true, "shadow:signal", 0, null]);
  assert.deepEqual(readState().config.mode, "shadow");
});

test("manual 바뀜은 QUIET을 깬다", async () => {
  reset();
  const { post, box } = setup();
  await post("review");
  box.manual = true;
  assert.equal((await (await post("review")).json()).reason, "shadow:manual");
});

test("호출마다 jsonl 한 줄: { t, role, open, reason, fp }", async () => {
  reset();
  const { post } = setup();
  await post("review");
  await post("review");
  await post("mcc"); // 다른 역할(stub은 review 모양을 주지만 죽지 않는다)
  const l = lines();
  assert.equal(l.length, 3);
  assert.deepEqual(Object.keys(l[0]).sort(), ["fingerprint", "fp", "fp2", "mode", "open", "reason", "reason2", "role", "t", "would"]); // ATC-297: v2 그림자 칸, ATC-553: mode
  assert.deepEqual(l.map((x) => x.role), ["review", "review", "mcc"]);
  assert.match(l[0].fp, /^[0-9a-f]{64}$/);
  assert.equal(l[0].fp, l[1].fp);
});

test("모르는 역할은 404이고 아무것도 쓰지 않는다", async () => {
  reset();
  const { post, box } = setup();
  const r = await post("nobody");
  assert.equal(r.status, 404);
  assert.equal(box.calls.length, 0);
  assert.equal(readFileSync(file("squelch.json"), "utf8"), SHADOW_FILE); // 아무것도 쓰지 않았다
  assert.equal(lines().length, 0);
  assert.equal((await post("tower")).status, 200);
});

test("오류는 200 fail-open이고 절대 막지 않는다", async () => {
  reset();
  const { post } = setup({
    get: async () => {
      throw new Error("boom");
    },
  });
  const r = await post("tower");
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual([j.open, j.reason, j.error], [true, "fail-open", "boom"]);
  assert.deepEqual(lines().map((x) => [x.role, x.open, x.reason, x.fp]), [["tower", true, "fail-open", null]]);
  // 상태 파일은 그 오류로 바뀌지 않는다
  assert.equal(readFileSync(file("squelch.json"), "utf8"), SHADOW_FILE); // 아무것도 쓰지 않았다
});

test("manual check가 던져도 fail-open", async () => {
  reset();
  const { post } = setup({
    manual: async () => {
      throw new Error("no manual");
    },
  });
  const j = await (await post("review")).json();
  assert.deepEqual([j.open, j.reason], [true, "fail-open"]);
});

test("모드 on이면 QUIET이 open:false, off는 늘 열림(상태 그대로)", async () => {
  reset();
  const { post } = setup();
  await post("review"); // 상태 파일 만들기
  const s = readState();
  writeFileSync(file("squelch.json"), JSON.stringify({ ...s, config: { ...s.config, mode: "on" } }));
  const quiet = await (await post("review")).json();
  assert.deepEqual([quiet.open, quiet.reason, quiet.quietCount], [false, "quiet", 1]);
  writeFileSync(file("squelch.json"), JSON.stringify({ ...readState(), config: { ...readState().config, mode: "off" } }));
  const off = await (await post("review")).json();
  assert.deepEqual([off.open, off.reason, off.quietCount], [true, "off", 1]); // off는 세지도 옮기지도 않는다
});

test("하트비트: 마지막 통과에서 heartbeatMin분이 지나면 다시 열린다", async () => {
  reset();
  const { post } = setup();
  await post("review");
  const s = readState();
  s.roles.review!.openedAt = new Date(Date.now() - 51 * 60_000).toISOString();
  writeFileSync(file("squelch.json"), JSON.stringify(s));
  assert.equal((await (await post("review")).json()).reason, "shadow:heartbeat");
});

test("상태 파일은 원자적으로 쓴다: 임시 파일이 남지 않고, 깨진 파일은 기본값으로 읽는다", async () => {
  reset();
  const { post } = setup();
  await post("review");
  await post("review");
  assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith("squelch")).sort(), ["squelch.json", "squelch.jsonl"]);
  const j = JSON.parse(readFileSync(file("squelch.json"), "utf8"));
  assert.equal(j.config.mode, "shadow");
  assert.equal(j.config.heartbeatMin.tower, 50);
  assert.equal(j.config.heartbeatMin.review, 50);
  assert.deepEqual(Object.keys(j.roles.review).sort(), ["fp", "openedAt", "proj", "quietCount", "quietSince", "v2"]);
  assert.deepEqual(j.config.fingerprint, { tower: "v1", mcc: "v1", occ: "v1", crosscheck: "v1", review: "v1" }); // 기본은 모두 v1
  writeFileSync(file("squelch.json"), "{ 깨짐");
  assert.equal(readState().config.mode, "shadow");
  assert.equal((await (await post("review")).json()).reason, "shadow:first"); // 깨진 파일 뒤에도 열린다
  writeFileSync(file("squelch.json"), JSON.stringify({ config: { mode: "bogus", heartbeatMin: { tower: -3, occ: 20 } }, roles: {} }));
  const c = readState().config;
  assert.deepEqual([c.mode, c.heartbeatMin.tower, c.heartbeatMin.occ], ["shadow", 50, 20]);
});

test("GET /api/squelch: 설정과 역할별 상태", async () => {
  reset();
  const { post, app } = setup();
  await post("review");
  const g = await (await app.request("/api/squelch")).json();
  assert.equal(g.config.mode, "shadow");
  assert.ok(g.roles.review.fp);
  assert.equal(g.roles.tower, undefined);
});

test("gatherInputs: 역할마다 atcctl이 읽는 브리핑 경로를 부른다", async () => {
  const seen: Record<string, string[]> = {};
  for (const role of ["tower", "mcc", "occ", "crosscheck", "review"] as const) {
    const paths: string[] = [];
    await gatherInputs(role, async (p) => (paths.push(p), {}));
    seen[role] = paths.sort();
  }
  assert.deepEqual(seen.tower, ["/api/controller/brief?consumer=controller"]);
  assert.deepEqual(seen.mcc, ["/api/mcc/queue"]);
  assert.deepEqual(seen.occ, ["/api/dispatch/brief", "/api/fleet/crew-changes/brief", "/api/following", "/api/schedule/brief"]);
  assert.deepEqual(seen.crosscheck, ["/api/dispatch/brief", "/api/schedule/brief"]);
  assert.deepEqual(seen.review, ["/api/landing/reviews"]);
});

test("기본 fetcher는 같은 앱 안의 핸들러를 부른다(네트워크 없음)", async () => {
  reset();
  const app = new Hono();
  app.get("/api/landing/reviews", (c) => c.json(review("abc1234")));
  mountSquelch(app, { manual: async () => false });
  const j = await (await app.request("/api/squelch/review", { method: "POST" })).json();
  assert.equal(j.reason, "shadow:first");
  // 브리핑이 오류(500)이면 fail-open
  const app2 = new Hono();
  mountSquelch(app2, { manual: async () => false });
  const k = await (await app2.request("/api/squelch/review", { method: "POST" })).json();
  assert.deepEqual([k.open, k.reason], [true, "fail-open"]);
});

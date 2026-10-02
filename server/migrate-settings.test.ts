import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Hono } from "hono";
import { config } from "./config.ts";
import { mountSettings } from "./settings.ts";

// 마이그레이션 리허설 스위치의 설정 경로(ATC-368). 임시 상태 폴더와 임시 airports.json만 쓴다: 호스티드 DB는 부르지 않는다.
const root = realpathSync(mkdtempSync(join(tmpdir(), "atc-migrate-")));
const real = { home: config.home, claudeDir: config.claudeDir, stateDir: config.stateDir, airportsFile: config.airportsFile, token: config.supabaseMigrateToken };
after(() => {
  Object.assign(config, { home: real.home, claudeDir: real.claudeDir, stateDir: real.stateDir, airportsFile: real.airportsFile, supabaseMigrateToken: real.token });
  rmSync(root, { recursive: true, force: true });
});
config.home = root;
config.claudeDir = join(root, ".claude");
config.stateDir = join(root, "state");
config.airportsFile = join(root, "state", "airports.json");
config.supabaseMigrateToken = "";
mkdirSync(config.stateDir, { recursive: true });
const entry = (code: string, hostedDb?: unknown) => ({ id: code, root: code, code, name: code, path: join(root, code), closed: false, addedAt: "2026-10-02T00:00:00Z", ...(hostedDb ? { hostedDb } : {}) });
writeFileSync(
  config.airportsFile,
  JSON.stringify({
    airports: [
      entry("READY", { provider: "supabase", projectRef: "abcd1234", testProjectRef: "wxyz5678" }),
      entry("NOTEST", { provider: "supabase", projectRef: "efgh5678" }),
      entry("PLAIN"),
    ],
  }),
);

const app = new Hono();
mountSettings(app);
const APP = { "content-type": "application/json", origin: "http://localhost:7700" };
const put = (body: unknown, headers: Record<string, string> = APP) => app.request("/api/settings", { method: "PUT", headers, body: JSON.stringify(body) });
const err = async (res: Response) => ((await res.json()) as { errors: { migrateRehearsal: string } }).errors.migrateRehearsal;
const switches = () => {
  try {
    return JSON.parse(readFileSync(join(config.stateDir, "migrate.json"), "utf8")).airports as Record<string, boolean>;
  } catch {
    return {};
  }
};

test("migrateRehearsal: 이 화면 밖 요청은 403, 값이 틀리면 400, 아무것도 바뀌지 않는다", async () => {
  assert.equal((await put({ migrateRehearsal: { READY: true } }, { "content-type": "application/json" })).status, 403);
  for (const bad of ["on", null, [], {}, { READY: "on" }]) assert.equal((await put({ migrateRehearsal: bad })).status, 400, JSON.stringify(bad));
  assert.deepEqual(switches(), {});
});

test("migrateRehearsal: 모르는 AIRPORT, hostedDb 없는 AIRPORT, 시험 DB·토큰이 없는 AIRPORT는 켜지 못한다", async () => {
  const unknown = await put({ migrateRehearsal: { ZZZ: true } });
  assert.equal(unknown.status, 400);
  assert.match(await err(unknown), /hostedDb가 있는 AIRPORT가 아님/);
  assert.equal((await put({ migrateRehearsal: { PLAIN: true } })).status, 400);
  const notest = await put({ migrateRehearsal: { NOTEST: true } });
  assert.equal(notest.status, 400);
  assert.match(await err(notest), /시험 DB가 없음/);
  const notoken = await put({ migrateRehearsal: { READY: true } });
  assert.equal(notoken.status, 400);
  assert.match(await err(notoken), /토큰이 없음/);
  assert.deepEqual(switches(), {});
});

test("migrateRehearsal: 준비된 AIRPORT는 켜고 끌 수 있다(토큰 값은 설정 응답에 없다)", async () => {
  config.supabaseMigrateToken = "sbp_secret_value";
  const on = await put({ migrateRehearsal: { READY: true } });
  assert.equal(on.status, 200);
  const body = (await on.json()) as { switches: { key: string; data?: unknown }[] };
  const view = { migrate: body.switches.find((x) => x.key === "migrateRehearsal")!.data as { tokenSet: boolean; airports: { code: string; enabled: boolean; why: string | null }[] } };
  assert.equal(view.migrate.tokenSet, true);
  assert.deepEqual(view.migrate.airports.map((a) => [a.code, a.enabled, a.why === null]), [["READY", true, true], ["NOTEST", false, false]]);
  assert.ok(!JSON.stringify(view).includes("sbp_secret_value"));
  assert.deepEqual(switches(), { READY: true });
  assert.equal((await put({ migrateRehearsal: { READY: false } })).status, 200);
  assert.deepEqual(switches(), {});
});

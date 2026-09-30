import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Hono } from "hono";
import { config } from "./config.ts";
import { foreignOrigin, mountDuty } from "./duty-api.ts";
import type { Snapshot } from "./model.ts";

test("Origin: 없으면(atcctl) 통과, localhost는 통과, 다른 사이트·깨진 값은 거절", () => {
  assert.equal(foreignOrigin(undefined), false);
  assert.equal(foreignOrigin("http://localhost:7700"), false);
  assert.equal(foreignOrigin("http://127.0.0.1:7702"), false);
  assert.equal(foreignOrigin("http://[::1]:7700"), false);
  for (const bad of ["https://evil.example", "http://localhost.evil.example", "null", "not a url", ""]) assert.equal(foreignOrigin(bad), true, bad);
});

test("초안 경로: 다른 사이트의 POST는 403이고 아무것도 쓰지 않는다, Origin 없는 POST는 한 줄 붙는다", async () => {
  const app = new Hono();
  mountDuty(app, async () => ({}) as Snapshot, async () => null);
  const file = join(config.stateDir, "duty-drafts.jsonl");
  const post = (headers: Record<string, string>) => app.request("/api/duty/note", { method: "POST", headers, body: JSON.stringify({ text: "a rule" }) });
  const foreign = await post({ "content-type": "text/plain", origin: "https://evil.example" });
  assert.equal(foreign.status, 403);
  assert.equal(existsSync(file), false, "거절된 요청은 파일을 만들지 않는다");
  const ok = await post({ "content-type": "application/json" });
  assert.equal(ok.status, 200);
  const lines = readFileSync(file, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).text, "a rule");
});

test("D3: 받아들인 초안만 onDraft로 간다(거절된 카드 요청은 대화에 아무것도 남기지 않는다)", async () => {
  const app = new Hono();
  const seen: string[] = [];
  mountDuty(app, async () => ({ pulls: [], sessions: [], airports: [], tickets: [] }) as unknown as Snapshot, async () => null, (l) => seen.push(`${l.kind}:${l.id}`));
  const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const refused = await post("/api/duty/card", { kind: "PROPOSAL", key: "P-404" });
  assert.equal(refused.status, 400);
  assert.match(((await refused.json()) as { error: string }).error, /not in the SUPERVISOR QUEUE/);
  assert.deepEqual(seen, []);
  const note = await post("/api/duty/note", { text: "a rule" });
  assert.equal(note.status, 200);
  assert.equal(seen.length, 1);
  assert.match(seen[0]!, /^note:DD-/);
});

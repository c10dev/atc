import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { type AirportEntry, type Candidate, cloneId, deriveCode, loadRegistry, mountAirports, reconcile, updateAirport } from "./airports.ts";
import { config } from "./config.ts";

const NOW = "2026-09-26T07:30:00.000Z";
const P = "/home/c10/projects";
const entry = (id: string, code: string, path: string, closed = false): AirportEntry => ({
  id, root: id.split("~")[0], code, name: path.split("/").pop()!, path, closed, addedAt: NOW,
});
const found = (root: string, path: string, discovered = true): Candidate => ({ root, path, discovered });
const exists = (paths: string[]) => (p: string) => paths.includes(p);

test("이름에서 코드 만들기: 첫 글자 + 자음, 겹치면 마지막 글자", () => {
  assert.equal(deriveCode("tennis", new Set()), "TNNS");
  assert.equal(deriveCode("DesignLAB", new Set()), "DSGN");
  assert.equal(deriveCode("ab", new Set()), "ABBX");
  assert.equal(deriveCode("tennis", new Set(["TNNS"])), "TNNA");
});

test("처음 보는 저장소는 이름에서 만든 코드로 개설", () => {
  const r = reconcile([], [found("r1", `${P}/vocado_nextjs`), found("r2", `${P}/tennis`)], exists([]), NOW);
  assert.equal(r.changed, true);
  assert.deepEqual(r.entries.map((e) => `${e.name}=${e.code}`).sort(), ["tennis=TNNS", "vocado_nextjs=VCDN"]);
});

test("같은 저장소·같은 경로면 바뀐 것 없음", () => {
  const entries = [entry("r1", "VCDO", `${P}/vocado_nextjs`)];
  const r = reconcile(entries, [found("r1", `${P}/vocado_nextjs`)], exists([`${P}/vocado_nextjs`]));
  assert.equal(r.changed, false);
  assert.equal(r.matched.get("r1")?.path, `${P}/vocado_nextjs`);
});

test("폴더를 옮기면 같은 AIRPORT·같은 코드로 경로만 갱신", () => {
  const entries = [entry("r1", "VCDO", `${P}/vocado_nextjs`)];
  const r = reconcile(entries, [found("r1", `${P}/vocado-web`)], exists([`${P}/vocado-web`]));
  assert.equal(r.changed, true);
  assert.deepEqual(r.entries, [{ ...entries[0], path: `${P}/vocado-web` }]);
});

test("같은 저장소의 다른 클론은 따로 개설", () => {
  const entries = [entry("r1", "VCDO", `${P}/vocado_nextjs`)];
  const both = [`${P}/vocado_nextjs`, `${P}/vocado_copy`];
  const r = reconcile(entries, [found("r1", both[0]), found("r1", both[1])], exists(both), NOW);
  assert.equal(r.entries.length, 2);
  assert.equal(r.entries[1].id, cloneId("r1", `${P}/vocado_copy`));
  assert.match(r.entries[1].id, /^r1~[0-9a-f]{8}$/);
  assert.notEqual(r.entries[1].code, "VCDO");
});

test("폐쇄한 AIRPORT는 코드를 지키고, 새 저장소가 그 코드를 가져가지 못한다", () => {
  const entries = [entry("r1", "TNNS", `${P}/tennis`, true)];
  const r = reconcile(entries, [found("r1", `${P}/tennis`), found("r9", `${P}/tennis2`)], exists([`${P}/tennis`, `${P}/tennis2`]), NOW);
  assert.equal(r.entries[0].closed, true);
  assert.notEqual(r.entries[1].code, "TNNS");
});

test("홈 밖에서 개설한(자동 발견 아닌) 저장소는 등록부에 있을 때만 잡는다", () => {
  const r = reconcile([], [found("r5", "/home/c10/vocado-documents", false)], exists([]), NOW);
  assert.equal(r.entries.length, 0);
  const r2 = reconcile([entry("r5", "VDOC", "/home/c10/vocado-documents")], [found("r5", "/home/c10/vocado-documents", false)], exists(["/home/c10/vocado-documents"]));
  assert.equal(r2.matched.get("r5")?.discovered, false);
});

test("같은 첫 커밋 저장소가 여럿일 때 옮겨진 AIRPORT는 폴더 이름이 같은 쪽으로", () => {
  const entries = [entry("r1", "ALPH", `${P}/alpha`), entry(cloneId("r1", `${P}/beta`), "BETA", `${P}/beta`)];
  const now = [`${P}/beta`, "/home/c10/elsewhere/alpha", `${P}/gamma`];
  const r = reconcile(entries, [found("r1", now[0]), found("r1", now[1]), found("r1", now[2])], exists(now), NOW);
  assert.equal(r.entries.find((e) => e.code === "ALPH")?.path, "/home/c10/elsewhere/alpha");
  assert.equal(r.entries.find((e) => e.code === "BETA")?.path, `${P}/beta`);
  assert.equal(r.entries.length, 3);
});

// teamsMerge(ATC-154): 있으면 false만 적고, 옛 파일은 그대로 읽히고, SUPERVISOR(이 화면)만 바꾼다
test("teamsMerge: false를 적고 true면 필드를 지운다, 옛 항목은 그대로, 불리언이 아니면 거절", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-apt-"));
  const file = join(dir, "airports.json");
  const prev = config.airportsFile;
  (config as { airportsFile: string }).airportsFile = file;
  try {
    const old = entry("a1", "ATAP", `${P}/atc-app`);
    writeFileSync(file, JSON.stringify({ airports: [old, entry("b1", "VCDO", `${P}/vocado`)] }));
    assert.equal("teamsMerge" in loadRegistry().entries[0], false); // 옛 파일: 필드 없음 = true
    assert.equal(updateAirport("a1", { teamsMerge: false }).teamsMerge, false);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).airports[0].teamsMerge, false);
    assert.equal("teamsMerge" in JSON.parse(readFileSync(file, "utf8")).airports[1], false); // 다른 AIRPORT는 그대로
    updateAirport("a1", { teamsMerge: true });
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).airports[0], old); // 기본값은 파일에 안 남는다
    for (const bad of ["false", 0, null]) assert.throws(() => updateAirport("a1", { teamsMerge: bad as never }), /true 또는 false/);
    assert.throws(() => updateAirport("nope", { teamsMerge: false }), /없음/);
  } finally {
    (config as { airportsFile: string }).airportsFile = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("teamsMerge: PATCH는 이 화면(localhost Origin의 JSON)에서만, 다른 필드는 예전처럼", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-apt-"));
  const file = join(dir, "airports.json");
  const prev = config.airportsFile;
  (config as { airportsFile: string }).airportsFile = file;
  try {
    writeFileSync(file, JSON.stringify({ airports: [entry("a1", "ATAP", `${P}/atc-app`)] }));
    const app = new Hono();
    mountAirports(app);
    const patch = (body: unknown, headers: Record<string, string> = {}) =>
      app.request("/api/airports/a1", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
    assert.equal((await patch({ teamsMerge: false })).status, 403); // Origin 없음: 세션·CLI
    assert.equal((await patch({ teamsMerge: false }, { origin: "https://evil.example" })).status, 403);
    assert.equal(loadRegistry().entries[0].teamsMerge, undefined);
    assert.equal((await patch({ teamsMerge: false }, { origin: "http://localhost:7700" })).status, 200);
    assert.equal(loadRegistry().entries[0].teamsMerge, false);
    assert.equal((await patch({ teamsMerge: "no" }, { origin: "http://localhost:7700" })).status, 400);
    assert.equal((await patch({ name: "atc-app 2" })).status, 200); // 이름·코드·폐쇄는 예전과 같다
  } finally {
    (config as { airportsFile: string }).airportsFile = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

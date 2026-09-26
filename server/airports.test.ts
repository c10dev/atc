import assert from "node:assert/strict";
import { test } from "node:test";
import { type AirportEntry, type Candidate, cloneId, deriveCode, reconcile } from "./airports.ts";

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

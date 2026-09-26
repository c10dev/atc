import assert from "node:assert/strict";
import { test } from "node:test";
import { assignAirports, deriveCode } from "./airports.ts";

test("이름에서 코드 만들기: 첫 글자 + 자음", () => {
  assert.equal(deriveCode("tennis", new Set()), "TNNS");
  assert.equal(deriveCode("DesignLAB", new Set()), "DSGN");
  assert.equal(deriveCode("atc", new Set()), "ATCT");
  assert.equal(deriveCode("ab", new Set()), "ABBX");
});

test("겹치면 마지막 글자를 바꾼다", () => {
  assert.equal(deriveCode("tennis", new Set(["TNNS"])), "TNNA");
});

test("airports.json 값이 우선, 잘못된 값과 중복은 자동 코드로", () => {
  const airports = assignAirports(["/p/tennis", "/p/vocado_nextjs", "/p/vocado_RN", "/p/bad"], {
    vocado_nextjs: "VCDO",
    vocado_RN: "VCDO",
    bad: "no",
  });
  const byName = Object.fromEntries(airports.map((a) => [a.name, a.code]));
  assert.equal(byName.vocado_nextjs, "VCDO");
  assert.notEqual(byName.vocado_RN, "VCDO");
  assert.match(byName.bad, /^[A-Z]{4}$/);
  assert.equal(byName.tennis, "TNNS");
  assert.equal(new Set(airports.map((a) => a.code)).size, airports.length);
});

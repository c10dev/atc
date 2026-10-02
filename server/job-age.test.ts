import assert from "node:assert/strict";
import { test } from "node:test";
import { jobAgeText, jobKnownText } from "./job-age.ts";

const now = Date.parse("2026-10-02T12:00:00Z");
const at = (min: number) => new Date(now - min * 60_000).toISOString();

test("age: minutes, hours, days; writtenAt wins over since", () => {
  assert.equal(jobAgeText({ writtenAt: at(0) }, now), "just now");
  assert.equal(jobAgeText({ writtenAt: at(5) }, now), "5 min ago");
  assert.equal(jobAgeText({ writtenAt: at(17 * 60 + 10) }, now), "17 h ago");
  assert.equal(jobAgeText({ writtenAt: at(3 * 1440) }, now), "3 d ago");
  assert.equal(jobAgeText({ writtenAt: at(5), since: at(600) }, now), "5 min ago");
  assert.equal(jobAgeText({ writtenAt: null, since: at(120) }, now), "2 h ago");
});

test("unknown time → null, text still says last known", () => {
  assert.equal(jobAgeText({}, now), null);
  assert.equal(jobKnownText({ writtenAt: "x" }, now), "last known");
  assert.equal(jobKnownText({ writtenAt: at(17 * 60) }, now), "last known, 17 h ago");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { type StaleFacts, staleStopOf } from "./stale-stop.ts";

const now = Date.parse("2026-10-02T12:00:00Z");
const ago = (min: number) => new Date(now - min * 60_000).toISOString();
const base = (over: Partial<StaleFacts> = {}): StaleFacts => ({
  registration: "TEAM_H",
  background: true,
  health: { code: "PENDING", since: ago(45) },
  startedAt: ago(300),
  flights: ["ATC-369"],
  arrivals: [{ flight: "ATC-369", arrivedAt: ago(60) }],
  ...over,
});

test("done FLIGHT + PENDING 45 min → stop", () => {
  const v = staleStopOf(base(), now);
  assert.equal(v.stop, true);
  if (v.stop) assert.deepEqual({ code: v.code, heldMin: v.heldMin, flights: v.flights }, { code: "PENDING", heldMin: 45, flights: ["ATC-369"] });
});

test("HUNG counts the same; the FLIGHT may have left the STAND (no open flights)", () => {
  assert.equal(staleStopOf(base({ health: { code: "HUNG", since: ago(31) }, flights: [] }), now).stop, true);
});

test("under 30 min, other health codes, no health: not yet", () => {
  assert.deepEqual(staleStopOf(base({ health: { code: "PENDING", since: ago(29) } }), now), { stop: false, why: "too-young" });
  assert.deepEqual(staleStopOf(base({ health: { code: "LIMIT", since: ago(90) } }), now), { stop: false, why: "not-stuck" });
  assert.deepEqual(staleStopOf(base({ health: null }), now), { stop: false, why: "not-stuck" });
});

test("FLIGHT not finished: no arrival, an arrival before this session, or another FLIGHT still open", () => {
  assert.deepEqual(staleStopOf(base({ arrivals: [] }), now), { stop: false, why: "no-arrival" });
  assert.deepEqual(staleStopOf(base({ arrivals: [{ flight: "ATC-369", arrivedAt: ago(400) }] }), now), { stop: false, why: "no-arrival" });
  assert.deepEqual(staleStopOf(base({ flights: ["ATC-369", "ATC-370"] }), now), { stop: false, why: "open-flight" });
});

test("startedAt unknown: past arrivals are not this session's, so it is not stopped (DIRECT and AD HOC work)", () => {
  assert.deepEqual(staleStopOf(base({ startedAt: null }), now), { stop: false, why: "no-arrival" });
  assert.deepEqual(staleStopOf(base({ startedAt: "garbage" }), now), { stop: false, why: "no-arrival" });
});

test("only atc's own background sessions", () => {
  assert.deepEqual(staleStopOf(base({ background: false }), now), { stop: false, why: "not-background" });
});

test("an arrival without a FLIGHT key (AD HOC) counts as finished when nothing else is open", () => {
  assert.equal(staleStopOf(base({ flights: [], arrivals: [{ flight: null, arrivedAt: ago(50) }] }), now).stop, true);
});

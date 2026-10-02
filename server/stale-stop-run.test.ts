import assert from "node:assert/strict";
import { test } from "node:test";
import type { Snapshot } from "./model.ts";
import type { RecordLine } from "./recorder.ts";
import { runStaleStop, type StaleIO } from "./stale-stop-run.ts";

const now = Date.parse("2026-10-02T12:00:00Z");
const ago = (min: number) => new Date(now - min * 60_000).toISOString();
const fact = (registration: string, over: Record<string, unknown> = {}) => ({
  registration,
  background: true,
  health: { code: "HUNG" as const, since: ago(40) },
  startedAt: ago(300),
  flights: ["ATC-1"],
  arrivals: [{ flight: "ATC-1", arrivedAt: ago(90) }],
  ...over,
});

function io(over: Partial<StaleIO> & { facts: StaleIO["facts"] }) {
  const stops: string[] = [];
  const lines: RecordLine[] = [];
  const base: StaleIO = {
    mode: () => "on",
    stop: async (reg, by) => {
      stops.push(`${reg}|${by}`);
      return { ok: true, jobId: "abc123" };
    },
    record: (l) => lines.push(l),
    ...over,
  };
  return { io: base, stops, lines };
}

const snap = {} as Snapshot;

test("stops a finished AIRCRAFT stuck in HUNG, records it with the reason", async () => {
  const t = io({ facts: () => [fact("TEAM_A"), fact("TEAM_B", { health: null })] });
  const r = await runStaleStop(snap, now, t.io);
  assert.deepEqual(r, { stopped: ["TEAM_A"], failed: [] });
  assert.equal(t.stops.length, 1);
  assert.match(t.stops[0], /^TEAM_A\|auto stale-stop \(HUNG 40m, ATC-1\)$/);
  assert.equal(t.lines.length, 1);
  assert.deepEqual({ ...t.lines[0], t: "x" }, { t: "x", kind: "policy", op: "stale-stop", aircraft: "TEAM_A", ok: true, code: "HUNG", heldMin: 40, flights: ["ATC-1"], jobId: "abc123" });
});

test("switch off: nothing is read or stopped", async () => {
  let read = 0;
  const t = io({ mode: () => "off", facts: () => ((read++), [fact("TEAM_A")]) });
  assert.deepEqual(await runStaleStop(snap, now, t.io), { stopped: [], failed: [] });
  assert.equal(read, 0);
  assert.equal(t.stops.length, 0);
});

test("a failed STOP is recorded and not retried for 10 minutes", async () => {
  const t = io({ facts: () => [fact("TEAM_F")], stop: async () => ({ ok: false, error: "claude stop 실패" }) });
  assert.deepEqual(await runStaleStop(snap, now, t.io), { stopped: [], failed: ["TEAM_F"] });
  assert.equal(t.lines[0].kind === "policy" && t.lines[0].op === "stale-stop" && t.lines[0].ok, false);
  assert.deepEqual(await runStaleStop(snap, now + 5 * 60_000, t.io), { stopped: [], failed: [] });
  assert.deepEqual(await runStaleStop(snap, now + 11 * 60_000, t.io), { stopped: [], failed: ["TEAM_F"] });
});

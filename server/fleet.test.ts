import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyPatch, canHoldSec, DEFAULT_FLEET, FleetError, fleetView, loadFleet } from "./fleet.ts";
import type { Session } from "./model.ts";

const D = DEFAULT_FLEET.defaults;

test("FLEET 파일: 없으면 기본값, 있으면 defaults를 기본값 위에 합친다", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-fleet-"));
  assert.deepEqual(loadFleet(join(dir, "none.json")), DEFAULT_FLEET);
  const f = join(dir, "fleet.json");
  writeFileSync(f, JSON.stringify({ defaults: { ratings: ["DOCS"] }, aircraft: { TEAM_B: { ratings: ["SEC"] } } }));
  const fleet = loadFleet(f);
  assert.deepEqual(fleet.defaults.ratings, ["DOCS"]);
  assert.deepEqual(fleet.defaults.complement, D.complement);
  assert.deepEqual(fleet.aircraft.TEAM_B, { ratings: ["SEC"] });
});

test("SEC: 보안 작업을 맡을 팀원이 있어야 줄 수 있다", () => {
  assert.equal(canHoldSec(D.complement), true);
  assert.equal(canHoldSec([{ position: "helper", agent: "flash-helper" }]), false);
  assert.equal(canHoldSec([{ position: "backend", agent: "claude-opus-5-5", limits: ["no SEC"] }]), false);
  assert.throws(
    () => applyPatch({}, { ratings: ["SEC"], complement: [{ position: "helper", agent: "flash-helper" }] }, D),
    (e) => e instanceof FleetError && /SEC/.test(e.message),
  );
});

test("PATCH: 검사하고 정리하며, null은 기본값으로 돌린다", () => {
  const p = applyPatch({}, { ratings: ["DOCS", "SEC", "DOCS"], routes: [" Beta Readiness ", ""], targets: { flightsPerWeek: 3, onTime: 0.8 }, base: "VCDO" }, D);
  assert.deepEqual(p, { ratings: ["SEC", "DOCS"], routes: ["Beta Readiness"], targets: { flightsPerWeek: 3, onTime: 0.8 }, base: "VCDO" });
  assert.deepEqual(applyPatch(p, { ratings: null, routes: null, targets: null, base: null }, D), {});
  assert.throws(() => applyPatch({}, { ratings: ["PILOT"] }, D), /모르는 TYPE RATING/);
  assert.throws(() => applyPatch({}, { targets: { onTime: 2 } }, D), /onTime/);
  assert.throws(() => applyPatch({}, { complement: [{ position: "x" }] }, D), /position과 agent/);
  assert.throws(() => applyPatch({}, { base: "vc" }, D), /AIRPORT 코드/);
});

test("FLEET 화면: 살아 있는 TEAM 세션과 등록 항목을 합치고, 없는 팀은 absent", () => {
  const session = (id: string, name: string, status: Session["status"] = "idle") =>
    ({ id, name, status, repo: "/r/vocado", cwd: "/r/vocado", agent: "claude", pid: 1, startedAt: "", lastActiveAt: "", workspacePath: null }) as Session;
  const view = fleetView(
    {
      sessions: [session("b", "TEAM_B", "busy"), session("x", "President"), session("d", "TEAM_D", "dead")],
      claims: [{ sessionId: "b", workspacePath: "/w/voc-193", since: "", lastAt: "", source: "hook", tool: null, state: "active", handedOffTo: null }],
      workspaces: [{ path: "/w/voc-193", name: "voc-193", repo: "/r/vocado", isMain: false, branch: null, head: "", dirty: 0, lastCommitAt: null, ticketKey: "VOC-193" }],
      airports: [{ id: "r", code: "VCDO", name: "vocado", repo: "/r/vocado" }],
    },
    { defaults: D, aircraft: { TEAM_E: { ratings: ["SEC", "DATA"], routes: ["Beta Readiness"] } } },
  );
  assert.deepEqual(
    view.map((a) => `${a.registration}:${a.callsign}:${a.status}:${a.base}:${a.ratings.join("+")}:${a.flying.join(",")}`),
    ["TEAM_B:BRAVO:busy:VCDO:UI+DATA+DOCS:VOC-193", "TEAM_E:ECHO:absent:null:SEC+DATA:"],
  );
  assert.equal(view[0].ratingsIsDefault, true);
  assert.equal(view[1].ratingsIsDefault, false);
});

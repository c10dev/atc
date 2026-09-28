import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyPatch, canHoldSec, DEFAULT_FLEET, FleetError, fleetView, loadFleet } from "./fleet.ts";
import { computeActuals } from "./logbook.ts";
import type { Session, Ticket } from "./model.ts";

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

test("FLEET 화면: FLYING FLIGHT의 제목, 가장 이른 점유 시각, 세션 마지막 활동(ATC-44)", () => {
  const session = { id: "b", name: "TEAM_B", status: "busy", repo: "/r/vocado", cwd: "/r/vocado", agent: "claude", pid: 1, startedAt: "", lastActiveAt: "2026-09-28T05:40:00Z", workspacePath: null } as Session;
  const claim = (path: string, since: string) => ({ sessionId: "b", workspacePath: path, since, lastAt: since, source: "hook" as const, tool: null, state: "active" as const, handedOffTo: null });
  const ws = (path: string, ticketKey: string) => ({ path, name: path, repo: "/r/vocado", isMain: false, branch: null, head: "", dirty: 0, lastCommitAt: null, ticketKey });
  const [b] = fleetView(
    {
      sessions: [session],
      claims: [claim("/w/voc-193", "2026-09-28T05:10:00Z"), claim("/w/voc-194", "2026-09-28T04:50:00Z")],
      workspaces: [ws("/w/voc-193", "VOC-193"), ws("/w/voc-194", "VOC-194")],
      airports: [{ id: "r", code: "VCDO", name: "vocado", repo: "/r/vocado" }],
      tickets: [{ key: "VOC-193", title: "Practice player two columns" } as Ticket],
    },
    { defaults: D, aircraft: {} },
  );
  assert.deepEqual(b.flights, [
    { key: "VOC-193", title: "Practice player two columns" },
    { key: "VOC-194", title: null },
  ]);
  assert.equal(b.flyingSince, "2026-09-28T04:50:00Z");
  assert.equal(b.lastActiveAt, "2026-09-28T05:40:00Z");
});

test("ENTRY INTO SERVICE: 템플릿으로 새 AIRCRAFT를 들이고, 있는 이름·퇴역한 이름·형식 오류는 거절", async () => {
  const { entryIntoService, nextRegistration } = await import("./fleet.ts");
  const P = "^TEAM[\\s_-]?[A-Z]$";
  const fleet = { defaults: D, aircraft: { TEAM_E: { ratings: ["SEC"] as "SEC"[] }, TEAM_Z: { retired: { at: "t" } } } };
  const r = entryIntoService(fleet, { registration: "team_g", configuration: "security", base: "VCDO", routes: ["Beta Readiness"] }, ["TEAM_A"], P, "2026-09-26T00:00:00.000Z");
  assert.equal(r.registration, "TEAM_G");
  assert.deepEqual(r.profile.ratings, ["SEC", "DATA", "DOCS"]);
  assert.equal(r.profile.complement?.[0].agent, "claude-opus-5-5");
  assert.equal(r.profile.configuration, "security");
  assert.equal(r.profile.enteredAt, "2026-09-26T00:00:00.000Z");
  // general은 팀원·자격을 기본값에 맡긴다
  const g = entryIntoService(fleet, { registration: "TEAM_H" }, [], P);
  assert.equal(g.profile.complement, undefined);
  assert.equal(g.profile.ratings, undefined);
  assert.throws(() => entryIntoService(fleet, { registration: "TEAM_A" }, ["TEAM_A"], P), /이미 FLEET에 있음/);
  assert.throws(() => entryIntoService(fleet, { registration: "TEAM_E" }, [], P), /이미 FLEET에 있음/);
  assert.throws(() => entryIntoService(fleet, { registration: "TEAM_Z" }, [], P), /퇴역/);
  assert.throws(() => entryIntoService(fleet, { registration: "ALPHA" }, [], P), /TEAM_X 형식/);
  assert.throws(() => entryIntoService(fleet, { registration: "TEAM_I", configuration: "pilots" }, [], P), /모르는 CONFIGURATION/);
  assert.equal(nextRegistration(["TEAM_A", "team_b", "President"]), "TEAM_C");
});

test("AOG·RETIREMENT: 사유를 받아 기록하고 null·false로 푼다", () => {
  const now = "2026-09-26T01:00:00.000Z";
  const a = applyPatch({}, { aog: { reason: " 컨텍스트 정리 ", until: "2026-09-27" } }, D, now);
  assert.deepEqual(a.aog, { reason: "컨텍스트 정리", until: "2026-09-27", at: now });
  assert.deepEqual(applyPatch(a, { aog: null }, D), {});
  assert.throws(() => applyPatch({}, { aog: { reason: "" } }, D), /사유/);
  assert.throws(() => applyPatch({}, { aog: { reason: "x", until: "내일" } }, D), /YYYY-MM-DD/);
  assert.deepEqual(applyPatch({}, { retired: { reason: "합침" } }, D, now).retired, { at: now, reason: "합침" });
  assert.deepEqual(applyPatch({ retired: { at: now } }, { retired: false }, D), {});
});

test("CREW BRIEFING: 등록번호·폴더·팀원·자격·교신 규칙을 담고, approval 모드에서만 FLIGHT PLAN 줄이 들어간다", async () => {
  const { crewBriefing } = await import("./fleet.ts");
  const a = {
    registration: "TEAM_G", callsign: "GOLF", status: "absent" as const, base: "VCDO", complement: D.complement, complementIsDefault: true,
    ratings: ["SEC", "DATA"] as ("SEC" | "DATA")[], ratingsIsDefault: false, routes: ["Beta Readiness"], targets: {}, note: null, flying: [], flights: [], flyingSince: null, lastActiveAt: null,
    configuration: "security" as const, enteredAt: null, aog: null, retired: null, actuals: computeActuals([], "TEAM_G", 0),
  };
  const text = crewBriefing(a, "/home/c10/projects/vocado_nextjs", "shadow");
  assert.ok(text.startsWith("[ATC FLEET] CREW BRIEFING · GOLF (TEAM_G) · AIRPORT VCDO"));
  assert.ok(text.includes("이 세션의 이름은 TEAM_G입니다. 작업 폴더는 /home/c10/projects/vocado_nextjs입니다."));
  assert.ok(text.includes("- flash-helper: flash-helper (no BUILD, no CHECK verdicts, no SEC)"));
  assert.ok(text.includes("SEC 작업은 Codex Engineering Task 템플릿을 쓰고"));
  assert.ok(text.includes("tail:TEAM_G"));
  assert.ok(text.includes("READBACK C-xxxx"));
  assert.ok(!text.includes("READBACK D-xxxx"));
  assert.ok(crewBriefing(a, null, "approval").includes("READBACK D-xxxx"));
});

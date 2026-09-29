import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyPatch, canHoldSec, DEFAULT_FLEET, FleetError, fleetView, loadFleet } from "./fleet.ts";
import { computeActuals } from "./logbook.ts";
import type { PullRequest, Session, Ticket } from "./model.ts";

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

test("ACCOUNT 라벨(ATC-51): 소문자로 받고, 비우면 지우고, email·형식 오류는 거절", () => {
  assert.equal(applyPatch({}, { account: " Pro-2 " }, D).account, "pro-2");
  assert.equal("account" in applyPatch({ account: "main" }, { account: "" }, D), false);
  assert.equal("account" in applyPatch({ account: "main" }, { account: null }, D), false);
  assert.throws(() => applyPatch({}, { account: "someone@example.com" }, D), /email은 쓰지 않는다/);
  assert.throws(() => applyPatch({}, { account: "a b" }, D), FleetError);
  assert.throws(() => applyPatch({}, { account: "x".repeat(25) }, D), FleetError);
});

test("FLEET 화면: ACCOUNT와 같은 ACCOUNT의 LIMIT HOLD(ATC-51). 라벨이 하나도 없으면 null", () => {
  const now = Date.parse("2026-09-28T07:38:00Z");
  const limit = { code: "LIMIT" as const, level: "alert" as const, since: "2026-09-28T07:37:00Z", resetsAt: "2026-09-28T07:40:00.000Z", detail: "limit", next: "", holds: true };
  const session = (id: string, name: string, health: Session["health"] = null) =>
    ({ id, name, status: "idle", repo: "/r/vocado", cwd: "/r/vocado", agent: "claude", pid: 1, startedAt: "", lastActiveAt: "", workspacePath: null, health }) as Session;
  const s = { sessions: [session("k", "TEAM_K", limit), session("l", "TEAM_L"), session("m", "TEAM_M")], claims: [], workspaces: [], airports: [] };
  const view = fleetView(s, { defaults: D, aircraft: { TEAM_K: { account: "pro-2" }, TEAM_L: { account: "pro-2" }, TEAM_N: { account: "pro-2" } } }, undefined, [], now);
  assert.deepEqual(
    view.map((a) => `${a.registration}:${a.account}:${a.accountIsDefault}:${a.accountHold?.by.join(",") ?? "-"}`),
    ["TEAM_K:pro-2:false:-", "TEAM_L:pro-2:false:TEAM_K", "TEAM_M:default:true:-", "TEAM_N:pro-2:false:-"], // 세션 없는 TEAM_N은 붙들 것이 없다
  );
  const bare = fleetView(s, { defaults: D, aircraft: {} }, undefined, [], now);
  assert.deepEqual(bare.map((a) => `${a.account}:${a.accountIsDefault}:${a.accountHold}`), ["null:false:null", "null:false:null", "null:false:null"]);
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
  const noDetail = { commit: null, pushed: null, pr: null }; // 워크트리 head·origin·PR을 모르면
  assert.deepEqual(b.flights, [
    { key: "VOC-193", title: "Practice player two columns", detail: noDetail },
    { key: "VOC-194", title: null, detail: noDetail },
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

test("TARGETS: FUEL 목표(fuelPerFlight USD, cacheHit 0~1)를 받고 범위 밖은 거절(FUEL F8)", () => {
  assert.deepEqual(applyPatch({}, { targets: { fuelPerFlight: 8, cacheHit: 0.95 } }, D), { targets: { fuelPerFlight: 8, cacheHit: 0.95 } });
  assert.deepEqual(applyPatch({ targets: { fuelPerFlight: 8 } }, { targets: { fuelPerFlight: null, cacheHit: null } }, D), {});
  assert.throws(() => applyPatch({}, { targets: { fuelPerFlight: 0 } }, D), /fuelPerFlight/);
  assert.throws(() => applyPatch({}, { targets: { cacheHit: 1.5 } }, D), /cacheHit/);
});

test("FLEET 화면: fuelBurn은 최근 14일 값, fuelRecent는 최근 FLIGHT 순서로. fuel 없는 옛 줄은 null(FUEL F8)", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  const line = (n: number, fuel: boolean) => ({
    key: `o/atc#${n}`, aircraft: "TEAM_J", flight: `ATC-${n}`, class: null, airport: "ATCC", pr: { repo: "o/atc", number: n, url: "", title: "" }, stands: [],
    departedAt: new Date(now - 2 * 86_400_000).toISOString(), departedFrom: "departure" as const, arrivedAt: new Date(now - n * 3_600_000).toISOString(),
    blockMin: 30, landingWaitMin: 5, codexFindings: 0, changesRequested: false, reverted: false, los: 0,
    ...(fuel
      ? {
          fuel: { captain: { input: 0, cacheWrite5m: 0, cacheWrite1h: 100, cacheRead: 900, output: 10, requests: 3, cacheHit: 0.9 }, crew: { input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, requests: 0, cacheHit: null, outputLowerBound: true as const }, cacheHit: 0.9, models: { "claude-opus-5-5": 3 } },
          fuelCost: { captain: null, crew: null, total: { input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 3, total: 3 }, leakCost: 1, netCost: 2, unpriced: [] },
        }
      : {}),
  });
  const [a] = fleetView({ sessions: [], claims: [], workspaces: [], airports: [] }, { defaults: D, aircraft: { TEAM_J: {} } }, undefined, [line(1, true), line(2, false)], now);
  assert.equal(a.fuelBurn?.arrived, 2);
  assert.equal(a.fuelBurn?.costPerFlight, 3);
  assert.equal(a.fuelBurn?.cacheHit?.captain, 0.9);
  assert.deepEqual(
    a.fuelRecent?.map((f) => [f.key, f.tokens, f.cost, f.net, f.verdict]),
    [
      ["o/atc#1", 1010, 3, 2, null],
      ["o/atc#2", null, null, null, null],
    ],
  );
});

test("관제 세션 ACCOUNT(ATC-60): 이름이나 관제 폴더로 알아보고, 라벨이 없으면 default, 라벨이 하나도 없으면 null", async () => {
  const { accountOf, accountsLabeled, controlAccountOf, controlNameOf } = await import("./crew.ts");
  const dirs = { TOWER: "/r/atc/controller", OCC: "/r/atc/occ", CROSSCHECK: "/r/atc/crosscheck", MCC: "/r/atc/mcc" };
  assert.equal(controlNameOf({ name: "mcc", cwd: "/elsewhere" }, dirs), "MCC");
  assert.equal(controlNameOf({ name: "ENGINEERING", cwd: "/r/atc" }, dirs), "ENGINEERING");
  assert.equal(controlNameOf({ name: "3f2a91c0", cwd: "/r/atc/crosscheck/" }, dirs), "CROSSCHECK"); // tmux로 이름 없이 띄운 CROSSCHECK
  assert.equal(controlNameOf({ name: "President", cwd: "/r/atc" }, dirs), null);
  const none = { aircraft: {} };
  assert.equal(controlAccountOf(none, "MCC"), null);
  const onlyControl = { aircraft: { TEAM_A: {} }, control: { MCC: { account: "pro-2" } } };
  assert.equal(accountsLabeled(onlyControl), true);
  assert.equal(controlAccountOf(onlyControl, "MCC"), "pro-2");
  assert.equal(controlAccountOf(onlyControl, "TOWER"), "default");
  assert.equal(accountOf(onlyControl, "TEAM_A"), "default"); // 관제 세션 라벨만 있어도 atc는 계정을 안다
});

test("관제 세션 ACCOUNT 저장: 소문자로, 다른 항목은 그대로, 비우면 지우고, email·모르는 이름은 거절. 옛 파일은 그대로 읽힌다", async () => {
  const { saveControlAccount } = await import("./fleet.ts");
  const dir = mkdtempSync(join(tmpdir(), "atc-fleet-"));
  const file = join(dir, "fleet.json");
  writeFileSync(file, JSON.stringify({ aircraft: { TEAM_A: { account: "main" } } }));
  assert.equal("control" in loadFleet(file), false);
  assert.equal(saveControlAccount("mcc", " Pro-2 ", file), "pro-2");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { aircraft: { TEAM_A: { account: "main" } }, control: { MCC: { account: "pro-2" } } });
  assert.deepEqual(loadFleet(file).control, { MCC: { account: "pro-2" } });
  assert.throws(() => saveControlAccount("OCC", "someone@example.com", file), /email은 쓰지 않는다/);
  assert.throws(() => saveControlAccount("REVIEW", "main", file), /관제 세션이 아님/);
  assert.equal(saveControlAccount("MCC", "", file), null);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { aircraft: { TEAM_A: { account: "main" } } });
});

test("FLEET 화면(ATC-67): `Team G` 세션은 TEAM_G 항목과 한 AIRCRAFT, 이름 힌트. 같은 REGISTRATION의 세션 둘은 충돌", () => {
  const session = (id: string, name: string) =>
    ({ id, name, status: "idle", repo: "/r/vocado", cwd: "/r/vocado", agent: "claude", pid: 1, startedAt: "", lastActiveAt: "", workspacePath: null }) as Session;
  const fleet = { defaults: D, aircraft: { TEAM_G: { ratings: ["SEC" as const], account: "pro-2" }, Team_H: { note: "옛 키 표기" } } };
  const view = fleetView({ sessions: [session("g", "Team G"), session("h1", "TEAM_H"), session("h2", "team-h"), session("t", "TOWER")], claims: [], workspaces: [], airports: [] }, fleet);
  assert.deepEqual(
    view.map((a) => `${a.registration}:${a.status}:${a.ratings.join("+")}:${a.account}:${a.note}:${a.sessionName}:${a.sessionConflict?.join(",") ?? "-"}`),
    ["TEAM_G:idle:SEC:pro-2:null:Team G:-", "TEAM_H:idle:UI+DATA+DOCS:default:옛 키 표기:team-h:TEAM_H,team-h"],
  );
  // 정식 이름이면 힌트 없음
  const plain = fleetView({ sessions: [session("g", "TEAM_G")], claims: [], workspaces: [], airports: [] }, fleet);
  assert.equal(plain[0].sessionName, null);
  assert.equal(plain[0].sessionConflict, null);
});


test("FLEET 화면(ATC-86): 멈춘 AIRCRAFT는 점유(claimTtl)가 지나 claims에서 빠져도 FLIGHT를 잃지 않는다. 마지막 커밋·push·PR을 붙인다", () => {
  const D2 = D;
  const mk = (name: string, over: Partial<Session> = {}) => ({ id: `s-${name}`, name, status: "idle", repo: "/r/atc", cwd: "/r/atc", agent: "claude", pid: 1, startedAt: "", lastActiveAt: "2026-09-28T18:11:06Z", workspacePath: null, ...over }) as Session;
  const ws = (path: string, ticketKey: string, over = {}) => ({ path, name: path, repo: "/r/atc", isMain: false, branch: `claude/${ticketKey.toLowerCase()}`, head: "59a9fdc1234", dirty: 0, lastCommitAt: "2026-09-28T18:00:00Z", ticketKey, pushed: true, ...over });
  const views = fleetView(
    {
      sessions: [mk("TEAM_G", { keptFlights: ["ATC-72"] }), mk("TEAM_H", { keptFlights: ["ATC-77"] }), mk("TEAM_I")],
      claims: [], // G·H의 점유는 3시간 TTL로 빠졌다
      workspaces: [ws("/w/atc-72", "ATC-72"), ws("/w/atc-77", "ATC-77", { head: "7955be6ffff", pushed: false })],
      airports: [{ id: "r", code: "ATCC", name: "atc", repo: "/r/atc" }],
      tickets: [{ key: "ATC-72", title: "STAND-free" } as Ticket, { key: "ATC-77", title: "Waypoint" } as Ticket],
      pulls: [{ number: 147, url: "https://x/147", draft: false, ticketKey: "ATC-72" } as PullRequest],
    },
    { defaults: D2, aircraft: {} },
  );
  const by = (r: string) => views.find((v) => v.registration === r)!;
  assert.deepEqual(by("TEAM_G").flying, []); // STAND를 쥔 것은 아니다(FLEET PLAN·SCHEDULE은 그대로)
  assert.deepEqual(by("TEAM_G").flights, [{ key: "ATC-72", title: "STAND-free", kept: true, detail: { commit: { sha: "59a9fdc", at: "2026-09-28T18:00:00Z" }, pushed: true, pr: { number: 147, url: "https://x/147", draft: false } } }]);
  assert.deepEqual(by("TEAM_H").flights, [{ key: "ATC-77", title: "Waypoint", kept: true, detail: { commit: { sha: "7955be6", at: "2026-09-28T18:00:00Z" }, pushed: false, pr: null } }]);
  assert.deepEqual(by("TEAM_I").flights, []);
});

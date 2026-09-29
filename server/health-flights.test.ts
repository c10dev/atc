import assert from "node:assert/strict";
import { test } from "node:test";
import { applyFlightHealth } from "./health-flights.ts";
import { DEFAULT_HEALTH, type Health } from "./health.ts";
import type { Claim, Session, Ticket } from "./model.ts";

// FLIGHT를 쥔 AIRCRAFT의 health(ATC-86): STALLED와, 점유(claimTtl)가 지난 뒤에도 FLEET 줄이 FLIGHT를 잃지 않게 하는 것.
// TEAM_G·TEAM_H가 2026-09-28 18:10Z에 한도로 멈췄을 때 hook은 다 봤지만(점유는 18:10:58에 갱신) claimTtl(3시간) 뒤 스냅샷의 claims에서 빠졌고
// FLEET 줄은 flights: []가 됐다. Linear에는 tail:TEAM_G·TEAM_H가 In Progress로 남아 있었다
const TEAM = "^TEAM_[A-Z]$";
const at = (hms: string, day = "2026-09-29") => Date.parse(`${day}T${hms}Z`);
const iso = (hms: string, day = "2026-09-29") => `${day}T${hms}Z`;
const session = (name: string, over: Partial<Session> = {}): Session => ({ id: `s-${name}`, agent: "claude", name, status: "idle", pid: 1, cwd: "/w", startedAt: iso("00:00:00"), lastActiveAt: iso("00:00:00"), repo: "/r", workspacePath: null, ...over });
const ticket = (key: string, over: Partial<Ticket> = {}): Ticket => ({ key, title: `${key} title`, state: "In Progress", stateType: "started", labels: [], ...over }) as Ticket;
const claim = (sessionId: string, workspacePath: string, lastAt: string): Claim => ({ sessionId, workspacePath, since: iso("14:00:00", "2026-09-28"), lastAt, source: "hook", state: "active", handedOffTo: null, tool: "Bash" });
const ws = (path: string, ticketKey: string) => ({ path, ticketKey });
const cut = (): Health => ({ code: "LIMIT", level: "alert", since: iso("18:10:48", "2026-09-28"), detail: "d", next: "n", holds: true, cut: true, cutAt: iso("18:10:48", "2026-09-28") });

const base = { teamPattern: TEAM, workspaces: [ws("/w/atc-72", "ATC-72"), ws("/w/atc-77", "ATC-77")], pulls: [], freshClaims: [] as Claim[], staleClaims: [] as Claim[], now: at("09:00:00"), cfg: DEFAULT_HEALTH };

test("한도로 멈춘 TEAM_G: 점유가 TTL을 넘어 claims에서 빠져도 keptFlights에 FLIGHT가 남는다(STAND 점유 + tail: 라벨)", () => {
  const g = session("TEAM_G", { health: cut() });
  const h = session("TEAM_H", { health: cut() });
  applyFlightHealth({
    ...base,
    sessions: [g, h],
    staleClaims: [claim("s-TEAM_G", "/w/atc-72", iso("18:10:58", "2026-09-28"))], // G: 점유만 남았다
    tickets: [ticket("ATC-77", { labels: ["tail:TEAM_H"] }), ticket("ATC-72")], // H: tail: 라벨만(점유 파일이 없다)
  });
  assert.deepEqual(g.keptFlights, ["ATC-72"]);
  assert.deepEqual(h.keptFlights, ["ATC-77"]);
  assert.equal(g.health?.code, "LIMIT"); // 이미 있는 health는 그대로
});

test("keptFlights는 멈춘 health(cut LIMIT·RESUME·STALLED)일 때만. 지금 점유 중인 FLIGHT와 Done·Canceled FLIGHT의 옛 워크트리는 넣지 않는다", () => {
  const healthy = session("TEAM_A");
  const resume = session("TEAM_B", { health: { ...cut(), code: "RESUME", cut: undefined } });
  const plain = session("TEAM_C", { health: { ...cut(), cut: undefined } }); // 오류 LIMIT(cut 아님)
  applyFlightHealth({
    ...base,
    sessions: [healthy, resume, plain],
    workspaces: [ws("/w/atc-72", "ATC-72"), ws("/w/atc-77", "ATC-77"), ws("/w/atc-60", "ATC-60")],
    staleClaims: ["A", "B", "C"].map((x) => claim(`s-TEAM_${x}`, "/w/atc-72", iso("18:10:58", "2026-09-28"))),
    freshClaims: [claim("s-TEAM_B", "/w/atc-77", iso("08:59:00"))],
    tickets: [ticket("ATC-72", { labels: ["tail:TEAM_B"] }), ticket("ATC-77"), ticket("ATC-60", { stateType: "completed", state: "Done" })],
  });
  assert.equal(healthy.keptFlights, undefined);
  assert.equal(plain.keptFlights, undefined);
  assert.deepEqual(resume.keptFlights, ["ATC-72"]); // ATC-77은 지금 점유 중이라 flying이 맡는다
  // Done FLIGHT의 옛 점유는 넣지 않는다
  const s = session("TEAM_D", { health: cut() });
  applyFlightHealth({ ...base, sessions: [s], staleClaims: [claim("s-TEAM_D", "/w/atc-60", iso("18:10:58", "2026-09-28"))], tickets: [ticket("ATC-60", { stateType: "completed" })] });
  assert.equal(s.keptFlights, undefined);
});

test("STALLED: In Progress FLIGHT(점유나 tail: 라벨)를 쥐고 60분 넘게 idle, 열린 PR 없음. 다른 health가 있으면 그것이 우선", () => {
  const stalled = session("TEAM_E", { lastActiveAt: iso("07:30:00") });
  const withPr = session("TEAM_F", { lastActiveAt: iso("07:30:00") });
  const busy = session("TEAM_G", { status: "busy", lastActiveAt: iso("07:30:00") });
  const recent = session("TEAM_H", { lastActiveAt: iso("08:30:00") });
  const holding = session("TEAM_I", { lastActiveAt: iso("07:30:00"), health: { ...cut(), code: "PENDING", cut: undefined } });
  const survey = session("TEAM_J", { lastActiveAt: iso("07:30:00") });
  applyFlightHealth({
    ...base,
    sessions: [stalled, withPr, busy, recent, holding, survey],
    pulls: [{ ticketKey: "ATC-2" }],
    tickets: [
      ticket("ATC-1", { labels: ["tail:TEAM_E"] }),
      ticket("ATC-2", { labels: ["tail:TEAM_F"] }),
      ticket("ATC-3", { labels: ["tail:TEAM_G"] }),
      ticket("ATC-4", { labels: ["tail:TEAM_H"] }),
      ticket("ATC-5", { labels: ["tail:team-i"] }),
      ticket("ATC-6", { labels: ["tail:TEAM_J", "type:survey"] }), // STAND 없는 FLIGHT는 PR을 내지 않는다
    ],
  });
  assert.equal(stalled.health?.code, "STALLED");
  assert.match(stalled.health!.detail, /ATC-1 In Progress/);
  assert.equal(withPr.health ?? null, null);
  assert.equal(busy.health ?? null, null);
  assert.equal(recent.health ?? null, null); // 30분
  assert.equal(holding.health?.code, "PENDING");
  assert.equal(survey.health ?? null, null);
  // STALLED는 FLIGHT를 놓치지 않게: tail: 라벨로 keptFlights에도 든다
  assert.deepEqual(stalled.keptFlights, ["ATC-1"]);
});

test("STALLED: 점유한 FLIGHT도 Linear가 started여야 하고, Done이면 아니다. 죽은 세션·팀이 아닌 세션은 건드리지 않는다", () => {
  const done = session("TEAM_E", { lastActiveAt: iso("07:00:00") });
  const dead = session("TEAM_F", { status: "dead", lastActiveAt: iso("07:00:00") });
  const control = session("TOWER", { lastActiveAt: iso("07:00:00") });
  applyFlightHealth({
    ...base,
    sessions: [done, dead, control],
    freshClaims: [claim("s-TEAM_E", "/w/atc-72", iso("07:00:00"))],
    tickets: [ticket("ATC-72", { stateType: "completed", state: "Done" }), ticket("ATC-7", { labels: ["tail:TEAM_F"] }), ticket("ATC-8", { labels: ["tail:TOWER"] })],
  });
  for (const x of [done, dead, control]) assert.equal(x.health ?? null, null);
});

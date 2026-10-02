import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_DISPATCH_CONFIG, loadDispatchConfig, planDispatch, saveK3Hold } from "./dispatch.ts";
import { DEFAULT_FLEET, type FleetFile } from "./crew.ts";
import { k3CheckOf, k3HoldOf, k3LaunchOf, k3StatusOf, K3_NOT_DECLARATION_WHY, K3_RELEASE_WHY } from "./k3-allow.ts";
import { k3MisfiresOf } from "./k3-hold.ts";
import type { Snapshot, Ticket } from "./model.ts";
import { type ReleaseChannel, type ReleaseView, releaseHashOf } from "./release.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// K3 hold(ATC-398): K3 줄이 있는 FLIGHT는 그 효과의 allow와 함께 떠나거나 떠나지 않는다
const AT = Date.parse("2026-10-02T06:00:00Z");
const ATCC = "/home/c10/projects/atc";
const DECLARED = "## Goal\nx\n\n## K effects\n\n* K3[Security Weaken]: CROSSCHECK condition in the auto approve | files: server/auto-approve-run.ts\n";
// ATC-371의 줄: `K3:` 뒤에 산문만 있다
const ATC371 = "## Goal\nx\n\n## K effects\n\n* K3: this FLIGHT changes the guard, the SUPERVISOR knows\n";
const NONE = "## Goal\nx\n\n## K effects\n\n* K3: none\n";
const PLAIN = "## Goal\nx\n\n## K effects\n\n* None\n";

const ticket = (key: string, body: string, over: Partial<Ticket> = {}): Ticket => {
  const k = k3CheckOf(body);
  return {
    key, title: key, state: "Todo", stateType: "unstarted", stateColor: null, assignee: null, takenBy: null, priority: 3, url: null, updatedAt: "2026-10-02T00:00:00Z",
    project: null, labels: [], createdAt: "2026-10-02T00:00:00Z", startedAt: null, blocks: [], blockedBy: [], related: [], parent: null, children: [], releaseHash: releaseHashOf(body),
    ...(k.declared.length ? { k3: k.declared } : {}), ...(k.check ? { k3Check: k.check } : {}), ...over,
  };
};
const releasedBy = (t: Ticket, channel: ReleaseChannel): ReleaseView => ({ armedAt: "2026-10-02T00:00:00Z", records: { [t.key]: { flight: t.key, channel, at: "2026-10-02T01:00:00Z", hash: t.releaseHash! } } });
const snap = (t: Ticket, releases: ReleaseView): Snapshot => ({
  at: new Date(AT).toISOString(), linear: { enabled: true, error: null, fetchedAt: null }, github: { enabled: true, error: null, fetchedAt: null }, pulls: [], atfm: { mains: [], groundStops: [] },
  sessions: [], workspaces: [], tickets: [t], columns: [], claims: [], handoffs: [], alerts: [], clearances: [], airports: [{ id: "r", code: "ATCC", name: "atc", repo: ATCC }], releases,
  absent: [{ registration: "TEAM_G", launchedAt: "2026-10-02T03:00:00Z", jobId: "2b7110c1", cut: null }],
});
const cfg = { ...DEFAULT_DISPATCH_CONFIG, candidateTeams: ["ATC"] };
const fleet: FleetFile = { ...DEFAULT_FLEET, aircraft: { TEAM_G: { base: "ATCC" } } };
const plan = (t: Ticket, releases: ReleaseView, c = cfg) => planDispatch(snap(t, releases), new Map(), c, AT, undefined, fleet);

test("the ATC-371 line (prose K3:) is held with the reason 'not a declaration'", () => {
  const t = ticket("ATC-371", ATC371);
  const p = plan(t, releasedBy(t, "screen"));
  assert.deepEqual(p.assign, []);
  const why = p.excluded.find((e) => e.flight === "ATC-371")!.reason;
  assert.ok(why.includes(K3_NOT_DECLARATION_WHY) && why.includes("not a declaration"), why);
  assert.match(why, /K3\[<라벨>\]/); // 고치는 길이 같이 보인다
});

test("an attested release with a valid declaration is held with the reason 'release on the screen'", () => {
  const t = ticket("ATC-398", DECLARED);
  const p = plan(t, releasedBy(t, "attested"));
  assert.deepEqual(p.assign, []);
  const why = p.excluded.find((e) => e.flight === "ATC-398")!.reason;
  assert.ok(why.includes(K3_RELEASE_WHY) && why.includes("release on the screen"), why);
});

test("a screen release with a valid declaration is sent and LAUNCHed with the allow", () => {
  for (const ch of ["screen", "duty-chat"] as const) {
    const t = ticket("ATC-398", DECLARED);
    const rel = releasedBy(t, ch);
    const p = plan(t, rel);
    assert.deepEqual(p.assign.map((a) => [a.flight, a.registration, a.launch]), [["ATC-398", "TEAM_G", true]]);
    const k = k3LaunchOf({ flight: t.key, declared: t.k3, hash: t.releaseHash, releases: rel, repo: ATCC })!;
    assert.equal(k.entries.length, 1);
    assert.deepEqual(JSON.parse(k.settings).autoMode.allow[0], "$defaults");
  }
});

test("a FLIGHT with no K3 line is not held, even with an attested release", () => {
  for (const body of [PLAIN, "## Goal\nx\n"]) {
    const t = ticket("ATC-5", body);
    assert.equal(t.k3Check, undefined);
    assert.equal(plan(t, releasedBy(t, "attested")).assign.length, 1);
  }
});

test("the off switch sends the FLIGHT as before; it is on by default and a broken file reads as on", () => {
  const t = ticket("ATC-371", ATC371);
  assert.equal(plan(t, releasedBy(t, "screen"), { ...cfg, k3Hold: "off" }).assign.length, 1);
  assert.equal(DEFAULT_DISPATCH_CONFIG.k3Hold, "on");
  const dir = mkdtempSync(join(tmpdir(), "k3hold-"));
  const f = join(dir, "dispatch.json");
  assert.equal(loadDispatchConfig(f).k3Hold, "on"); // 파일 없음
  saveK3Hold("off", f);
  assert.equal(loadDispatchConfig(f).k3Hold, "off");
  saveK3Hold("on", f);
  assert.equal(loadDispatchConfig(f).k3Hold, "on");
  writeFileSync(f, JSON.stringify({ k3Hold: "maybe" }));
  assert.equal(loadDispatchConfig(f).k3Hold, "on");
});

test("k3HoldOf: unparsed lines, release channels, stale body", () => {
  const t = ticket("ATC-1", DECLARED);
  const hold = (body: Ticket, rel: ReleaseView) => k3HoldOf({ check: body.k3Check, declared: body.k3, flight: body.key, hash: body.releaseHash, releases: rel })?.code ?? null;
  assert.equal(hold(t, releasedBy(t, "screen")), null);
  assert.equal(hold(t, releasedBy(t, "duty-chat")), null);
  assert.equal(hold(t, releasedBy(t, "attested")), "release-on-screen");
  assert.equal(hold(t, { armedAt: null, records: {} }), "release-on-screen");
  assert.equal(hold({ ...t, releaseHash: "changed" }, releasedBy(t, "screen")), "release-on-screen");
  const bad = ticket("ATC-2", ATC371);
  assert.equal(hold(bad, releasedBy(bad, "screen")), "not-declaration");
});

test("a K3 line that declares no effect is held as a nuisance; a prose line is not", () => {
  const none = ticket("ATC-3", NONE);
  const h = k3HoldOf({ check: none.k3Check, declared: none.k3, flight: none.key, hash: none.releaseHash, releases: releasedBy(none, "screen") })!;
  assert.equal(h.code, "not-declaration");
  assert.equal(h.nuisance, true);
  const prose = ticket("ATC-4", ATC371);
  assert.equal(k3HoldOf({ check: prose.k3Check, declared: prose.k3, flight: prose.key, hash: prose.releaseHash, releases: releasedBy(prose, "screen") })!.nuisance, false);
});

test("RELEASE screen status: parses and grants before the click", () => {
  const t = ticket("ATC-1", DECLARED);
  const none: ReleaseView = { armedAt: null, records: {} };
  const st = (tk: Ticket, rel: ReleaseView) => k3StatusOf({ check: tk.k3Check, declared: tk.k3, flight: tk.key, hash: tk.releaseHash, releases: rel })!;
  assert.deepEqual([st(t, none).parses, st(t, none).willGrant, st(t, none).grants], [true, true, false]);
  assert.equal(st(t, releasedBy(t, "screen")).grants, true);
  assert.equal(st(t, releasedBy(t, "attested")).grants, false);
  assert.deepEqual(st(ticket("ATC-2", ATC371), none).parses, false);
  assert.equal(k3StatusOf({ flight: "ATC-9", hash: "h", releases: none }), null); // K3 줄이 없다
});

test("misfires: nuisance (K3 line without an effect) and miss (departed without allow, then denied)", () => {
  const tickets = [ticket("ATC-3", NONE), ticket("ATC-4", ATC371), ticket("ATC-6", DECLARED), ticket("ATC-7", "## Goal\nx\n")];
  const launches = [
    { t: "2026-10-02T01:00:00Z", aircraft: "TEAM_G", flight: "ATC-6", withAllow: false },
    { t: "2026-10-02T01:00:00Z", aircraft: "TEAM_H", flight: "ATC-6", withAllow: true },
    { t: "2026-10-02T01:00:00Z", aircraft: "TEAM_J", flight: "ATC-7", withAllow: false },
  ];
  const m = k3MisfiresOf({ tickets, launches, denied: new Set(["TEAM_G", "TEAM_H", "TEAM_J"]) });
  assert.deepEqual(m.nuisance, ["ATC-3"]);
  assert.deepEqual(m.miss.map((x) => [x.flight, x.aircraft]), [["ATC-6", "TEAM_G"]]); // allow가 있었거나 K3 줄이 없는 FLIGHT는 miss가 아니다
  assert.deepEqual(k3MisfiresOf({ tickets, launches, denied: new Set() }).miss, []);
});

test("HOME alert: a held FLIGHT shows the reason and the fix, and goes to alerts", async () => {
  const { supervisorAlertsOf, destOf } = await import("./supervisor-alerts.ts");
  const items = supervisorAlertsOf({ sessions: [], alerts: [], workspaces: [], tickets: [], following: [], proposals: [], pulls: [], rts: null, k3Holds: [{ flight: "ATC-371", text: K3_NOT_DECLARATION_WHY, fix: "rewrite the line" }] });
  const a = items.find((i) => i.key === "alert|k3-hold|ATC-371")!;
  assert.ok(a.text.includes("not a declaration") && a.next === "rewrite the line" && a.flight === "ATC-371");
  assert.equal(destOf(a), "alerts");
});

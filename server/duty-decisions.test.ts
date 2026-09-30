import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Hono } from "hono";
import { config } from "./config.ts";
import { briefDecisionsOf, dutyBriefOf, type DutyBriefInput, shortKey } from "./duty-brief.ts";
import { confirmOf, type DecisionLine, decisionsOf, nextDecisionId, parseDecisionLines, retireOf } from "./duty-decisions.ts";
import { mountDuty } from "./duty-api.ts";
import { cardDraftOf, nextDraftId } from "./duty-drafts.ts";
import type { Snapshot } from "./model.ts";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const note = (id: string, at: string, text: string, from: string, until?: string): DecisionLine => ({ op: "note", id, at, text, from, ...(until ? { until } : {}) });

test("decisionsOf: note는 켜지고, retire가 끄고, until이 지나면 retire 없이도 꺼진다", () => {
  const lines: DecisionLine[] = [
    note("SD-0001", "2026-09-30T01:00:00Z", "a", "DD-0001"),
    note("SD-0002", "2026-09-30T02:00:00Z", "b", "DD-0002", "2026-09-30T11:00:00Z"), // 지남
    note("SD-0003", "2026-09-30T03:00:00Z", "c", "DD-0003", "2026-10-03T03:00:00Z"),
    note("SD-0004", "2026-09-30T04:00:00Z", "d", "DD-0004"),
    { op: "retire", id: "SD-0004", at: "2026-09-30T05:00:00Z", why: "done" },
    { op: "retire", id: "SD-9999", at: "2026-09-30T05:00:00Z" }, // 없는 것
  ];
  const v = decisionsOf(lines, NOW);
  assert.deepEqual(v.active.map((d) => d.id), ["SD-0001", "SD-0003"]);
  assert.deepEqual(v.expired, ["SD-0002"]);
  assert.deepEqual(v.retired, ["SD-0004"]);
  assert.equal(v.confirmedDrafts["DD-0003"], "SD-0003");
  assert.equal(v.active[1]!.until, "2026-10-03T03:00:00Z");
  // 시각이 지나가면 같은 줄에서 꺼진다
  assert.deepEqual(decisionsOf(lines, Date.parse("2026-10-04T00:00:00Z")).active.map((d) => d.id), ["SD-0001"]);
});

test("decisionsOf: 같은 id가 두 번 와도 첫 줄만, 깨진 줄·모르는 op는 건너뛴다", () => {
  const raw = [JSON.stringify(note("SD-0001", "2026-09-30T01:00:00Z", "first", "DD-1")), JSON.stringify(note("SD-0001", "2026-09-30T02:00:00Z", "second", "DD-2")), "{bad", JSON.stringify({ op: "weird", id: "x" }), JSON.stringify({ op: "note", id: 1 })].join("\n");
  const lines = parseDecisionLines(raw);
  assert.equal(lines.length, 2);
  assert.equal(decisionsOf(lines, NOW).active[0]!.text, "first");
});

test("번호: SD-n 다음", () => {
  assert.equal(nextDecisionId([]), "SD-0001");
  assert.equal(nextDecisionId([note("SD-0007", "x", "t", "DD-1"), { op: "retire", id: "SD-0009", at: "x" }]), "SD-0008");
});

test("confirmOf·retireOf: 초안의 글 그대로 확정, 이중 확정·버린 초안·지난 until은 거절, 켜진 것만 해제", () => {
  const view = decisionsOf([], NOW);
  const d = { id: "DD-0001", kind: "note", text: "rule", until: null };
  const ok = confirmOf(d, view, new Set(), [], NOW);
  assert.ok(ok.ok && ok.line.op === "note" && ok.line.text === "rule" && ok.line.from === "DD-0001" && ok.line.id === "SD-0001");
  const lines = [(ok as { line: DecisionLine }).line];
  const v2 = decisionsOf(lines, NOW);
  const again = confirmOf(d, v2, new Set(), lines, NOW);
  assert.ok(!again.ok && again.status === 409);
  assert.ok(!confirmOf(d, view, new Set(["DD-0001"]), [], NOW).ok);
  assert.ok(!confirmOf({ ...d, until: "2026-09-30T11:00:00Z" }, view, new Set(), [], NOW).ok);
  assert.ok(!confirmOf({ id: "DD-2", kind: "charter", text: "x" }, view, new Set(), [], NOW).ok);
  assert.ok(!confirmOf(undefined, view, new Set(), [], NOW).ok);
  assert.ok(retireOf("SD-0001", v2, "why", NOW).ok);
  assert.ok(!retireOf("SD-0002", v2, "", NOW).ok);
});

const input = (over: Partial<DutyBriefInput> = {}): DutyBriefInput => ({
  at: "2026-09-30T12:00:00.000Z",
  queue: { count: 0, counts: {}, items: [] },
  alerts: [],
  fleet: [],
  flights: [],
  fuel: [],
  ...over,
});
const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `SD-${String(i + 1).padStart(4, "0")}`, text: `rule ${i + 1}`, until: null as string | null }));

test("brief: 정해 둔 결정이 맨 위 구역, 오래된 것부터 id·글·until", () => {
  const b = dutyBriefOf(input({ decisions: [{ id: "SD-0001", text: "reject acct-1 proposals", until: "2026-10-03T03:00:00Z" }, { id: "SD-0002", text: "UI work goes through DISPATCH", until: null }] }));
  const t = b.text.split("\n");
  assert.match(t[1]!, /^STANDING DECISIONS 2/);
  assert.equal(t[2], "  SD-0001 — reject acct-1 proposals (until 2026-10-03T03:00:00Z)");
  assert.equal(t[3], "  SD-0002 — UI work goes through DISPATCH");
  assert.match(t[4]!, /^QUEUE 0/);
});

test("brief: 가장 최근 briefDecisions개만 싣고 나머지 수를 적는다", () => {
  const b = dutyBriefOf(input({ decisions: many(25), decisionsMax: 20 }));
  const rows = b.text.split("\n").filter((l) => /^ {2}SD-/.test(l));
  assert.equal(rows.length, 20);
  assert.match(rows[0]!, /SD-0006/);
  assert.match(rows[19]!, /SD-0025/);
  assert.match(b.text, /… 5 older decisions not shown \(briefDecisions 20\)/);
  assert.equal(briefDecisionsOf(undefined), 20);
  assert.equal(briefDecisionsOf(5), 5);
  assert.equal(briefDecisionsOf(0), 20);
  assert.equal(briefDecisionsOf(101), 20);
});

test("brief 상한: 결정은 맨 마지막에 덜고, 덜면 그렇게 적는다. 다른 구역이 먼저 줄어든다", () => {
  const fleet = Array.from({ length: 60 }, (_, i) => ({ registration: `TEAM_${i}`, status: "AIRBORNE", airport: "ATCC", account: "acct-2", flight: null, more: 0, fuelHold: false }));
  const b = dutyBriefOf(input({ fleet, decisions: many(10) }), 1200);
  assert.ok(b.truncated && b.text.length <= 1200);
  assert.match(b.text, /rows dropped from FLEET/);
  assert.equal(b.text.split("\n").filter((l) => /^ {2}SD-/.test(l)).length, 10, "결정은 아직 그대로");
  // 더 좁히면 결정도 덜리고 DECISIONS가 적힌다
  const long = many(10).map((d) => ({ ...d, text: `${d.text} ${"y".repeat(40)}` }));
  const tight = dutyBriefOf(input({ fleet, decisions: long }), 500);
  assert.ok(tight.text.length <= 500);
  assert.match(tight.text, /DECISIONS/);
  assert.ok(tight.text.split("\n").filter((l) => /^ {2}SD-/.test(l)).length < 10);
});

test("brief: 결정 글은 한 줄 300자로 자르고 줄바꿈을 접는다", () => {
  const b = dutyBriefOf(input({ decisions: [{ id: "SD-0001", text: `a\n\nb ${"x".repeat(400)}`, until: null }] }));
  const row = b.text.split("\n").find((l) => l.startsWith("  SD-0001"))!;
  assert.ok(row.length < 330 && row.includes("a b ") && row.endsWith("…"));
});

test("shortKey: 알림 key의 worktree 경로는 STAND 이름만", () => {
  assert.equal(shortKey("blocked:/home/c10/projects/atc/.claude/worktrees/atc-230-duty-d3"), "blocked:atc-230-duty-d3");
  assert.equal(shortKey("cold-cache|/home/c10/projects/worktrees/atc-9/"), "cold-cache|atc-9");
  assert.equal(shortKey("alert|TEAM_A"), "alert|TEAM_A");
  const b = dutyBriefOf(input({ alerts: [{ key: "blocked:/home/c10/w/atc-1", level: "warning", aircraft: null, flight: null, text: "x", since: null }] }));
  assert.ok(b.text.includes("WARNING blocked:atc-1") && !b.text.includes("/home/"));
});

test("retire 카드 요청: DECISIONS retire만, 큐 줄이 아니어도 받는다", () => {
  const ok = cardDraftOf([], "decisions", "retire", "DD-0005", NOW);
  assert.ok(ok.ok && ok.line.kind === "retire-card");
  assert.ok(!cardDraftOf([], "DECISIONS", "other", "DD-0005", NOW).ok);
  assert.equal(nextDraftId(["DD-0005"]), "DD-0006");
});

// ── 경로 ──
const app = () => {
  const a = new Hono();
  mountDuty(a, async () => ({ pulls: [], sessions: [], airports: [], tickets: [], workspaces: [], claims: [], at: new Date().toISOString() }) as unknown as Snapshot, async () => null);
  return a;
};
const APP = { "content-type": "application/json", origin: "http://localhost:7700" };
const post = (a: Hono, path: string, body: unknown, headers: Record<string, string> = APP) => a.request(path, { method: "POST", headers, body: JSON.stringify(body) });
const reset = () => {
  for (const f of ["duty-drafts.jsonl", "decisions.jsonl"]) rmSync(join(config.stateDir, f), { force: true });
};
const decisionsFile = () => join(config.stateDir, "decisions.jsonl");

test("경로: 확정·해제·버림은 Origin 없이(atcctl)·다른 사이트·JSON 아닌 요청을 403으로 거절하고 아무것도 쓰지 않는다", async () => {
  reset();
  const a = app();
  const n = await post(a, "/api/duty/note", { text: "a rule" }); // atcctl처럼 Origin 없음(제안)
  assert.equal(n.status, 200);
  const id = ((await n.json()) as { draft: { id: string } }).draft.id;
  for (const headers of [{ "content-type": "application/json" } as Record<string, string>, { "content-type": "application/json", origin: "https://evil.example" }, { "content-type": "text/plain", origin: "http://localhost:7700" }]) {
    assert.equal((await post(a, "/api/duty/decisions", { draft: id }, headers)).status, 403);
    assert.equal((await post(a, "/api/duty/decisions/SD-0001/retire", {}, headers)).status, 403);
    assert.equal((await post(a, `/api/duty/drafts/${id}/dismiss`, {}, headers)).status, 403);
  }
  assert.equal(existsSync(decisionsFile()), false);
  assert.ok(!readFileSync(join(config.stateDir, "duty-drafts.jsonl"), "utf8").includes("dismiss"));
});

test("경로: 제안 → 확정(글은 서버가 초안에서 읽는다) → GET에 보임 → brief 맨 위 → 이중 확정 409 → 해제 → brief에서 빠짐", async () => {
  reset();
  const a = app();
  const n = await post(a, "/api/duty/note", { text: "reject acct-1 proposals", until: "2099-01-01T00:00:00Z" });
  const id = ((await n.json()) as { draft: { id: string } }).draft.id;
  const c = await post(a, "/api/duty/decisions", { draft: id, text: "화면이 보낸 다른 글" });
  assert.equal(c.status, 200);
  const dec = ((await c.json()) as { decision: { id: string; text: string } }).decision;
  assert.equal(dec.text, "reject acct-1 proposals", "화면이 보낸 글을 쓰지 않는다");
  assert.equal((await post(a, "/api/duty/decisions", { draft: id })).status, 409);
  assert.equal((await post(a, `/api/duty/drafts/${id}/dismiss`, {})).status, 409, "확정한 초안은 버릴 수 없다");
  const got = (await (await a.request("/api/duty/decisions")).json()) as { active: { id: string }[]; confirmedDrafts: Record<string, string> };
  assert.deepEqual(got.active.map((d) => d.id), [dec.id]);
  assert.equal(got.confirmedDrafts[id], dec.id);
  let brief = ((await (await a.request("/api/duty/brief")).json()) as { text: string }).text;
  assert.ok(brief.split("\n")[1]!.startsWith("STANDING DECISIONS 1") && brief.includes(`${dec.id} — reject acct-1 proposals`));
  assert.equal((await post(a, `/api/duty/decisions/${dec.id}/retire`, { why: "no longer" })).status, 200);
  assert.equal((await post(a, `/api/duty/decisions/${dec.id}/retire`, {})).status, 404, "이미 해제한 것");
  brief = ((await (await a.request("/api/duty/brief")).json()) as { text: string }).text;
  assert.ok(brief.includes("STANDING DECISIONS 0") && !brief.includes(dec.id));
  assert.equal(parseDecisionLines(readFileSync(decisionsFile(), "utf8")).length, 2);
});

test("경로: 버림은 초안에 dismiss 줄을 붙이고(id 없음), 버린 초안은 확정할 수 없고, note가 아니면 404", async () => {
  reset();
  const a = app();
  const id = ((await (await post(a, "/api/duty/note", { text: "r" })).json()) as { draft: { id: string } }).draft.id;
  const ch = ((await (await post(a, "/api/duty/charter", { text: "do a thing" })).json()) as { draft: { id: string } }).draft.id;
  assert.equal((await post(a, `/api/duty/drafts/${id}/dismiss`, {})).status, 200);
  assert.equal((await post(a, `/api/duty/drafts/${id}/dismiss`, {})).status, 409);
  assert.equal((await post(a, "/api/duty/decisions", { draft: id })).status, 409);
  assert.equal((await post(a, `/api/duty/drafts/${ch}/dismiss`, {})).status, 404);
  assert.equal((await post(a, "/api/duty/decisions", { draft: ch })).status, 404);
  assert.equal((await post(a, "/api/duty/decisions", {})).status, 400);
  const lines = readFileSync(join(config.stateDir, "duty-drafts.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { id?: string; kind: string; draft?: string });
  assert.deepEqual(lines.filter((l) => l.kind === "dismiss").map((l) => [l.id, l.draft]), [[undefined, id]]);
  assert.equal(nextDraftId(lines.flatMap((l) => (l.id ? [l.id] : []))), "DD-0003", "버림 줄은 초안 번호를 세지 않는다");
  const got = (await (await a.request("/api/duty/decisions")).json()) as { dismissed: string[] };
  assert.deepEqual(got.dismissed, [id]);
});

test("경로: until이 이미 지난 초안은 확정할 수 없고, briefDecisions(duty.json)가 brief의 수를 정한다", async () => {
  reset();
  const a = app();
  // 제안은 미래 until만 받으니 지난 until 초안은 파일에 직접 둔다(시간이 지난 경우)
  const { appendFileSync, writeFileSync } = await import("node:fs");
  appendFileSync(join(config.stateDir, "duty-drafts.jsonl"), `${JSON.stringify({ id: "DD-0001", at: "2020-01-01T00:00:00Z", kind: "note", text: "old", until: "2020-01-02T00:00:00Z" })}\n`);
  assert.equal((await post(a, "/api/duty/decisions", { draft: "DD-0001" })).status, 409);
  for (let i = 0; i < 4; i++) {
    const id = ((await (await post(a, "/api/duty/note", { text: `rule ${i}` })).json()) as { draft: { id: string } }).draft.id;
    assert.equal((await post(a, "/api/duty/decisions", { draft: id })).status, 200);
  }
  const cfg = join(config.stateDir, "duty.json");
  writeFileSync(cfg, JSON.stringify({ briefDecisions: 2 }));
  try {
    const brief = ((await (await a.request("/api/duty/brief")).json()) as { text: string }).text;
    assert.equal(brief.split("\n").filter((l) => /^ {2}SD-/.test(l)).length, 2);
    assert.match(brief, /2 older decisions not shown \(briefDecisions 2\)/);
  } finally {
    rmSync(cfg, { force: true });
  }
});

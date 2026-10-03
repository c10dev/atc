import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hono } from "hono";
import { answerLineOf, type DecisionOp, decisionAnswerOf, decisionDefaultOf, decisionInputOf, duplicateOf, foldDecisions, nextDecisionId, unackedAnswers } from "./decision-card.ts";
import { type QueueInput, supervisorQueueOf } from "./supervisor-queue.ts";

const NOW = Date.parse("2026-10-02T12:00:00Z");
const good = { role: "tower", key: "pr#7@abc1234", ask: "PR 7을 머지할까요?", options: ["머지", "보류"], pr: { number: 7, head: "abc1234" } };
const create = (id: string, extra: Record<string, unknown> = {}): DecisionOp => ({ op: "create", id, at: "2026-10-02T11:00:00.000Z", ...(decisionInputOf({ ...good, ...extra }) as object) }) as DecisionOp;
const emptyQ = (): QueueInput => ({ proposals: [], schedule: { mode: "approval", ops: [] }, fleetPlan: [], pulls: [], update: null, sessions: [], blockedMin: 3 });

test("decisionInputOf: validates role, key, ask, 2~6 distinct options, pr", () => {
  assert.deepEqual(decisionInputOf(good), good);
  assert.match((decisionInputOf({ ...good, role: "team" }) as { error: string }).error, /role/);
  assert.match((decisionInputOf({ ...good, key: "a b" }) as { error: string }).error, /key/);
  assert.match((decisionInputOf({ ...good, ask: "" }) as { error: string }).error, /ask/);
  assert.match((decisionInputOf({ ...good, ask: "ありがとう" }) as { error: string }).error, /일본어/);
  assert.match((decisionInputOf({ ...good, options: ["only"] }) as { error: string }).error, /options/);
  assert.match((decisionInputOf({ ...good, options: ["a", "a"] }) as { error: string }).error, /같은/);
  assert.match((decisionInputOf({ ...good, pr: { number: 0 } }) as { error: string }).error, /pr.number/);
  assert.match((decisionInputOf({ ...good, pr: { number: 1, head: "zz" } }) as { error: string }).error, /pr.head/);
  assert.deepEqual((decisionInputOf({ ...good, pr: undefined }) as { pr: unknown }).pr, null);
  assert.ok("error" in decisionInputOf(null));
});

test("foldDecisions: create → answer → ack; withdraw only while open", () => {
  const ops: DecisionOp[] = [create("DC-0001"), { op: "answer", id: "DC-0001", at: "2026-10-02T11:05:00.000Z", choice: 0, text: "go" }, create("DC-0002", { key: "k2" }), { op: "withdraw", id: "DC-0002", at: "2026-10-02T11:06:00.000Z" }];
  let all = foldDecisions(ops);
  assert.deepEqual(all.map((d) => [d.id, d.status]), [["DC-0001", "answered"], ["DC-0002", "withdrawn"]]);
  assert.equal(unackedAnswers(all, "tower").length, 1);
  assert.equal(unackedAnswers(all, "occ").length, 0);
  all = foldDecisions([...ops, { op: "ack", id: "DC-0001", at: "2026-10-02T11:07:00.000Z" }, { op: "answer", id: "DC-0001", at: "x", choice: 1, text: "" }]);
  assert.equal(unackedAnswers(all, "tower").length, 0);
  assert.equal(all[0]!.answer?.choice, 0); // 두 번째 답은 무시
  assert.equal(nextDecisionId(ops), "DC-0003");
});

test("duplicateOf: the same role+key is not filed twice; a withdrawn card can be refiled; another role is separate", () => {
  const open = foldDecisions([create("DC-0001")]);
  assert.equal(duplicateOf(open, "tower", good.key)?.id, "DC-0001");
  assert.equal(duplicateOf(open, "occ", good.key), null);
  assert.equal(duplicateOf(open, "tower", "other"), null);
  const answered = foldDecisions([create("DC-0001"), { op: "answer", id: "DC-0001", at: "x", choice: 0, text: "" }]);
  assert.equal(duplicateOf(answered, "tower", good.key)?.id, "DC-0001"); // 답이 왔어도 다시 묻지 않는다
  const withdrawn = foldDecisions([create("DC-0001"), { op: "withdraw", id: "DC-0001", at: "x" }]);
  assert.equal(duplicateOf(withdrawn, "tower", good.key), null);
});

test("decisionAnswerOf and answerLineOf", () => {
  const d = { options: ["머지", "보류"] };
  assert.deepEqual(decisionAnswerOf(d, { choice: 1 }), { choice: 1, text: "" });
  assert.deepEqual(decisionAnswerOf(d, { text: " 기다려 " }), { choice: null, text: "기다려" });
  assert.ok("error" in decisionAnswerOf(d, { choice: 2 }));
  assert.ok("error" in decisionAnswerOf(d, {}));
  assert.match(answerLineOf({ id: "DC-0001", key: "k", role: "mcc", options: ["merge", "hold"], answer: { choice: 1, text: "after CI" } }), /DC-0001 \[k\] ANSWERED by SUPERVISOR — option 2 \(hold\) · note: after CI — .*atcctl decision ack mcc DC-0001/);
});

test("QUEUE: an open card is one DECISION row; answered or withdrawn cards leave it", () => {
  const [open, answered] = foldDecisions([create("DC-0001"), create("DC-0002", { key: "k2" }), { op: "answer", id: "DC-0002", at: "x", choice: 0, text: "" }]);
  const q = supervisorQueueOf({ ...emptyQ(), decisions: [open!, answered!] }, NOW);
  assert.equal(q.length, 1);
  assert.deepEqual([q[0]!.kind, q[0]!.key, q[0]!.hash], ["DECISION", "DC-0001", "#strips"]);
  assert.match(q[0]!.title, /^TOWER PR #7: PR 7을 머지할까요\?/);
  assert.deepEqual(q[0]!.decision?.options, ["머지", "보류"]);
});

test("QUEUE: a blocked control session is not a NEEDS YOU row (it is a rule breach alert instead)", () => {
  const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
  const s = (id: string, name: string) => ({ id, name, job: { state: "blocked", since: ago(9), needs: "x" }, lastActiveAt: ago(9) }) as never;
  const q = supervisorQueueOf({ ...emptyQ(), sessions: [s("a", "TOWER"), s("b", "TEAM_B")] }, NOW);
  assert.deepEqual(q.map((i) => i.key), ["b"]);
});

test("routes: file → duplicate → answer needs the screen origin → list → ack only by the owning role", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-decision-"));
  try {
    const { config } = await import("./config.ts");
    (config as { stateDir: string }).stateDir = dir;
    const { mountDecisionCards } = await import("./decision-card-run.ts");
    const app = new Hono();
    mountDecisionCards(app);
    const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    const r1 = (await (await app.request("/api/decisions", json(good))).json()) as { decision: { id: string }; duplicate: boolean };
    assert.equal(r1.duplicate, false);
    const r2 = (await (await app.request("/api/decisions", json(good))).json()) as { decision: { id: string }; duplicate: boolean };
    assert.deepEqual([r2.duplicate, r2.decision.id], [true, r1.decision.id]);
    assert.equal((await app.request("/api/decisions", json({ ...good, options: ["x"] }))).status, 400);
    const id = r1.decision.id;
    // atcctl(Origin 없음)은 답할 수 없다
    assert.equal((await app.request(`/api/decisions/${id}/answer`, json({ choice: 0 }))).status, 403);
    assert.equal((await app.request(`/api/decisions/${id}/answer`, json({ choice: 0 }, { origin: "http://localhost:7700" }))).status, 200);
    assert.equal((await app.request(`/api/decisions/${id}/answer`, json({ choice: 1 }, { origin: "http://localhost:7700" }))).status, 409);
    const list = (await (await app.request("/api/decisions?role=tower")).json()) as { decisions: { status: string }[] };
    assert.deepEqual(list.decisions.map((d) => d.status), ["answered"]);
    assert.equal((await app.request(`/api/decisions/${id}/ack`, json({ role: "occ" }))).status, 403);
    assert.equal((await app.request(`/api/decisions/${id}/ack`, json({ role: "tower" }))).status, 200);
    assert.deepEqual(((await (await app.request("/api/decisions?role=tower")).json()) as { decisions: unknown[] }).decisions, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tick: a quiet role becomes ACT with the SUPERVISOR answer until the session acks it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-decision-tick-"));
  try {
    const { config } = await import("./config.ts");
    (config as { stateDir: string }).stateDir = dir;
    const { mountDecisionCards } = await import("./decision-card-run.ts");
    const { mountTick } = await import("./tick-run.ts");
    const app = new Hono();
    mountDecisionCards(app);
    mountTick(app, { get: async () => ({ pulls: [] }), seenFile: () => join(dir, "tick-seen.json") });
    const tick = async () => (await (await app.request("/api/tick/mcc")).json()) as { act: boolean; reasons: string[]; answers?: string[] };
    assert.equal((await tick()).act, false);
    const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    const filed = (await (await app.request("/api/decisions", json({ ...good, role: "mcc" }))).json()) as { decision: { id: string } };
    assert.equal((await tick()).act, false); // 열린 카드만으로는 깨우지 않는다
    await app.request(`/api/decisions/${filed.decision.id}/answer`, json({ choice: 0, text: "go" }, { origin: "http://localhost:7700" }));
    const t = await tick();
    assert.deepEqual([t.act, t.reasons], [true, ["decision-answered"]]);
    assert.match(t.answers![0]!, /option 1 \(머지\) · note: go/);
    await app.request(`/api/decisions/${filed.decision.id}/ack`, json({ role: "mcc" }));
    assert.equal((await tick()).act, false);
    assert.equal(((await (await app.request("/api/tick/tower")).json()) as { answers?: string[] }).answers, undefined); // 다른 role에는 안 간다
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("default: a non-K1–K3 decision is checked and recorded without a card", async () => {
  assert.deepEqual(decisionDefaultOf({ role: "occ", key: "resend@D-1", what: "다시 보낼까", chose: "한 번 더 보낸다" }), { role: "occ", key: "resend@D-1", what: "다시 보낼까", chose: "한 번 더 보낸다" });
  assert.match((decisionDefaultOf({ role: "x", key: "k", what: "a", chose: "b" }) as { error: string }).error, /role/);
  assert.match((decisionDefaultOf({ role: "occ", key: "bad key", what: "a", chose: "b" }) as { error: string }).error, /key/);
  assert.match((decisionDefaultOf({ role: "occ", key: "k", what: "", chose: "b" }) as { error: string }).error, /what/);
  assert.match((decisionDefaultOf({ role: "occ", key: "k", what: "a", chose: "日本語" }) as { error: string }).error, /chose/);
  const dir = mkdtempSync(join(tmpdir(), "atc-decision-"));
  try {
    const { config } = await import("./config.ts");
    (config as { stateDir: string }).stateDir = dir;
    const { mountDecisionCards, allDecisions } = await import("./decision-card-run.ts");
    const app = new Hono();
    mountDecisionCards(app);
    const post = (body: unknown) => app.request("/api/decisions/default", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const ok = await post({ role: "occ", key: "k", what: "a", chose: "b" });
    assert.deepEqual(await ok.json(), { recorded: true, card: false });
    assert.equal((await post({ role: "occ", key: "k", what: "a" })).status, 400);
    assert.deepEqual(allDecisions(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { callCountsOf, type LinearCallLine, lineOf, linearGql, noteLinesOf } from "./linear-call.ts";
import { mountLinearCalls } from "./linear-call-run.ts";
import { backoffMs, causeOf, hopText, HttpFailure, parseRetries, retryable, retryAfterMs, withRetry } from "./net-retry.ts";
import { createDutyBlocks, createDutyComment, createDutyIssue, fetchDutyIssue } from "./sources/linear-write.ts";

// ATC-561: `fetch failed`가 가끔 SUPERVISOR의 일을 막았다. 네트워크 실패는 짧게 다시 시도하고, 쓰기는 두 번 만들지 않는다.
const netErr = (code: string, msg = "fetch failed") => Object.assign(new TypeError(msg), { cause: Object.assign(new Error(code), { code }) });
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

test("causeOf: DNS·연결·시간 초과·TLS·HTTP를 가르고, 요청이 닿았을 수 있는지를 말한다", () => {
  assert.deepEqual(causeOf(netErr("ENOTFOUND")), { cls: "dns", code: "ENOTFOUND", mayHaveSent: false });
  assert.deepEqual(causeOf(netErr("EAI_AGAIN")), { cls: "dns", code: "EAI_AGAIN", mayHaveSent: false });
  assert.deepEqual(causeOf(netErr("ECONNREFUSED")), { cls: "connect", code: "ECONNREFUSED", mayHaveSent: false });
  assert.deepEqual(causeOf(netErr("UND_ERR_CONNECT_TIMEOUT")), { cls: "connect", code: "UND_ERR_CONNECT_TIMEOUT", mayHaveSent: false });
  assert.deepEqual(causeOf(netErr("ECONNRESET")), { cls: "connect", code: "ECONNRESET", mayHaveSent: true });
  assert.deepEqual(causeOf(netErr("UND_ERR_HEADERS_TIMEOUT")), { cls: "timeout", code: "UND_ERR_HEADERS_TIMEOUT", mayHaveSent: true });
  assert.equal(causeOf(new DOMException("timed out", "TimeoutError")).cls, "timeout");
  assert.equal(causeOf(netErr("CERT_HAS_EXPIRED")).cls, "tls");
  assert.equal(causeOf(new HttpFailure(503, "HTTP 503")).cls, "http");
  assert.equal(causeOf(new TypeError("fetch failed")).cls, "network");
  assert.equal(causeOf(new Error("Entity not found")).cls, "other"); // GraphQL 오류는 네트워크 실패가 아니다
});

test("retryable: 네트워크 실패와 429·502·503·504만. TLS·다른 4xx·GraphQL 오류는 아니다", () => {
  for (const c of ["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "UND_ERR_HEADERS_TIMEOUT"]) assert.equal(retryable(causeOf(netErr(c))), true, c);
  for (const s of [429, 502, 503, 504]) assert.equal(retryable(causeOf(new HttpFailure(s, ""))), true, String(s));
  for (const s of [400, 401, 403, 404, 409, 500]) assert.equal(retryable(causeOf(new HttpFailure(s, ""))), false, String(s));
  assert.equal(retryable(causeOf(netErr("CERT_HAS_EXPIRED"))), false);
  assert.equal(retryable(causeOf(new Error("Entity not found"))), false);
});

test("backoffMs: 약 250ms, 약 1s에 지터, 429는 Retry-After가 더 길면 그것(상한 안에서)", () => {
  assert.equal(backoffMs(1, () => 0.5), 250);
  assert.equal(backoffMs(2, () => 0.5), 1000);
  assert.equal(backoffMs(1, () => 0), 200);
  assert.equal(backoffMs(1, () => 1), 300);
  assert.equal(backoffMs(1, () => 0.5, 3000), 3000);
  assert.equal(backoffMs(1, () => 0.5, 60_000), 5000);
  assert.equal(retryAfterMs("2"), 2000);
  assert.equal(retryAfterMs(null), null);
  assert.equal(retryAfterMs("Thu, 01 Jan 2026 00:00:10 GMT", Date.parse("2026-01-01T00:00:00Z")), 10_000);
});

test("hopText·parseRetries", () => {
  assert.equal(hopText("fetch failed", "atc-server-to-linear"), "fetch failed (atc server → Linear)");
  assert.equal(hopText("fetch failed [dns ENOTFOUND]", "atcctl-to-atc-server"), "fetch failed (atcctl → atc server) [dns ENOTFOUND]");
  assert.equal(hopText("fetch failed (atc server → Linear) [dns ENOTFOUND]", "atcctl-to-atc-server"), "fetch failed (atcctl → atc server) [dns ENOTFOUND]");
  assert.deepEqual([parseRetries("0"), parseRetries(3), parseRetries("9"), parseRetries(undefined), parseRetries("x")], [0, 3, 2, 2, 2]);
});

// ── 읽기: 한 번·두 번·세 번 실패 ──
const harness = () => {
  const lines: LinearCallLine[] = [];
  const sleeps: number[] = [];
  return { lines, sleeps, sink: (l: LinearCallLine) => void lines.push(l), sleep: async (ms: number) => void sleeps.push(ms), rand: () => 0.5 };
};
const failing = (n: number, make: () => Error | Response) => {
  let calls = 0;
  const fn = (async () => {
    calls++;
    if (calls <= n) {
      const f = make();
      if (f instanceof Response) return f;
      throw f;
    }
    return json({ data: { ok: calls } });
  }) as typeof fetch;
  return { fn, calls: () => calls };
};
const read = (h: ReturnType<typeof harness>, fetchFn: typeof fetch, retries = 2) =>
  linearGql<{ ok: number }>({ endpoint: "http://x", apiKey: "k", query: "q", variables: {}, op: "read", key: "ATC-1", retries, fetchFn, sink: h.sink, sleep: h.sleep, rand: h.rand });

test("읽기: 한 번 실패하면 다시 시도해 복구하고 기록한다(재시도 줄과 recovered 줄)", async () => {
  const h = harness();
  const f = failing(1, () => netErr("ECONNRESET"));
  assert.deepEqual(await read(h, f.fn), { ok: 2 });
  assert.equal(f.calls(), 2);
  assert.deepEqual(h.sleeps, [250]);
  assert.deepEqual(h.lines.map((l) => [l.hop, l.op, l.attempt, l.outcome, l.cause, l.code, l.key]), [
    ["atc-server-to-linear", "read", 1, "retry", "connect", "ECONNRESET", "ATC-1"],
    ["atc-server-to-linear", "read", 2, "recovered", "connect", "ECONNRESET", "ATC-1"],
  ]);
});

test("읽기: 두 번 실패해도 두 번째 다시 시도에서 복구한다(250ms, 1s)", async () => {
  const h = harness();
  const f = failing(2, () => netErr("ENOTFOUND"));
  assert.deepEqual(await read(h, f.fn), { ok: 3 });
  assert.deepEqual(h.sleeps, [250, 1000]);
  assert.deepEqual(h.lines.map((l) => l.outcome), ["retry", "retry", "recovered"]);
});

test("읽기: 세 번 실패하면 포기하고, 오류에 구간과 원인 종류가 적힌다", async () => {
  const h = harness();
  const f = failing(3, () => netErr("ENOTFOUND"));
  await assert.rejects(read(h, f.fn), (e: Error) => e.message === "fetch failed (atc server → Linear) [dns ENOTFOUND]");
  assert.equal(f.calls(), 3);
  assert.deepEqual(h.lines.map((l) => l.outcome), ["retry", "retry", "gave-up"]);
  assert.ok(h.lines.every((l) => !("title" in l) && !("token" in l)));
});

test("횟수 0은 지금과 같다: 다시 시도하지 않는다", async () => {
  const h = harness();
  const f = failing(1, () => netErr("ECONNRESET"));
  await assert.rejects(read(h, f.fn, 0), /fetch failed/);
  assert.equal(f.calls(), 1);
  assert.deepEqual(h.sleeps, []);
});

test("429는 Retry-After를 따르고, 502·503·504도 다시 시도한다. 4xx와 GraphQL 오류(200)는 다시 시도하지 않는다", async () => {
  const h = harness();
  const f = failing(1, () => json({}, 429, { "retry-after": "3" }));
  assert.deepEqual(await read(h, f.fn), { ok: 2 });
  assert.deepEqual(h.sleeps, [3000]);
  for (const status of [502, 503, 504]) {
    const g = failing(1, () => json({}, status));
    assert.deepEqual(await read(harness(), g.fn), { ok: 2 });
  }
  // GraphQL 오류(200 안)는 다시 시도하지도 기록하지도 않는다
  const gq = failing(5, () => json({ errors: [{ message: "Entity not found" }] }));
  const hq = harness();
  await assert.rejects(read(hq, gq.fn), (e: Error) => e.message === "Entity not found");
  assert.equal(gq.calls(), 1);
  assert.deepEqual(hq.lines, []);
  // 429가 아닌 4xx와 500은 다시 시도하지 않고, 기록에는 http 원인으로 한 줄(gave-up)이 남는다
  for (const [status, body] of [[400, { errors: [{ message: "nope" }] }], [401, {}], [403, {}], [404, {}], [409, {}], [500, {}]] as const) {
    const g = failing(5, () => json(body, status));
    const hh = harness();
    await assert.rejects(read(hh, g.fn));
    assert.equal(g.calls(), 1, String(status));
    assert.deepEqual(hh.lines.map((l) => [l.outcome, l.cause, l.code]), [["gave-up", "http", String(status)]]);
    assert.deepEqual(hh.sleeps, []);
  }
});

test("withRetry: canRetry가 false면 다시 시도하지 않는다", async () => {
  let n = 0;
  await assert.rejects(withRetry(async () => (n++, Promise.reject(netErr("ECONNRESET"))), { retries: 2, canRetry: () => false, sleep: async () => {} }), /fetch failed/);
  assert.equal(n, 1);
});

// ── 쓰기: 이슈·댓글을 두 번 만들지 않는다 ──
// 가짜 Linear: 만들기를 id로 저장한다. mode에 따라 만들기 시도를 (닿기 전에 실패 | 받은 뒤 답 전에 끊김 | 정상)으로 처리
type Mode = "before" | "after" | "ok";
function fakeLinear(plan: Mode[], opts: { unknownId?: boolean } = {}) {
  const issues = new Map<string, { identifier: string; url: string; title: string }>();
  const comments = new Map<string, { id: string; body: string; createdAt: string }>();
  const log: string[] = [];
  let creates = 0;
  let n = 0;
  const fn = (async (_url: string, init: RequestInit) => {
    const { query, variables } = JSON.parse(String(init.body));
    if (query.includes("mutation DutyCreate")) {
      log.push("create");
      if (opts.unknownId && "id" in variables.input) return json({ errors: [{ message: 'Field "id" is not defined by type IssueCreateInput.' }] }, 400);
      const mode = plan[n++] ?? "ok";
      if (mode === "before") throw netErr("ECONNREFUSED");
      creates++;
      const id = variables.input.id ?? `auto-${creates}`;
      issues.set(id, { identifier: `ATC-${100 + creates}`, url: `https://linear.app/x/${100 + creates}`, title: variables.input.title });
      if (mode === "after") throw netErr("ECONNRESET");
      return json({ data: { issueCreate: { success: true, issue: issues.get(id) } } });
    }
    if (query.includes("DutyCreatedByTitle")) {
      log.push("lookup-title");
      const hit = [...issues.values()].find((i) => i.title === variables.title);
      return json({ data: { issues: { nodes: hit ? [hit] : [] } } });
    }
    if (query.includes("DutyCreated")) {
      log.push("lookup-id");
      return json({ data: { issue: issues.get(variables.id) ?? null } });
    }
    if (query.includes("mutation DutyComment")) {
      log.push("comment");
      const mode = plan[n++] ?? "ok";
      if (mode === "before") throw netErr("ECONNREFUSED");
      creates++;
      const id = variables.input.id ?? `c-${creates}`;
      comments.set(id, { id, body: variables.input.body, createdAt: new Date().toISOString() });
      if (mode === "after") throw netErr("UND_ERR_HEADERS_TIMEOUT");
      return json({ data: { commentCreate: { success: true, comment: { id } } } });
    }
    if (query.includes("DutyCommented")) {
      log.push("lookup-comment-id");
      return json({ data: { comment: comments.get(variables.id) ?? null } });
    }
    throw new Error(`unexpected query ${query.slice(0, 40)}`);
  }) as typeof fetch;
  return { fn, issues, comments, log, creates: () => creates };
}
const write = (h: ReturnType<typeof harness>, f: { fn: typeof fetch }) => ({ retries: 2, fetchFn: f.fn, sink: h.sink, sleep: h.sleep, rand: h.rand });
const input = { teamId: "t1", title: "T", description: "D", priority: 2, stateId: "s1", labelIds: [] };

test("이슈 만들기: Linear에 닿기 전에 실패하면 다시 보내고 하나만 생긴다(찾아보지 않는다)", async () => {
  process.env.ATC_LINEAR_WRITE_URL = "http://127.0.0.1:1/graphql";
  const h = harness();
  const f = fakeLinear(["before", "ok"]);
  assert.deepEqual(await createDutyIssue(input, write(h, f)), { key: "ATC-101", url: "https://linear.app/x/101" });
  assert.equal(f.creates(), 1);
  assert.deepEqual(f.log, ["create", "create"]);
  assert.deepEqual(h.lines.map((l) => [l.op, l.outcome]), [["create", "retry"], ["create", "recovered"]]);
});

test("이슈 만들기: Linear가 받은 뒤 답 전에 끊겨도 두 번째 이슈가 생기지 않고 같은 key를 돌려준다", async () => {
  process.env.ATC_LINEAR_WRITE_URL = "http://127.0.0.1:1/graphql";
  const h = harness();
  const f = fakeLinear(["after", "ok"]);
  assert.deepEqual(await createDutyIssue(input, write(h, f)), { key: "ATC-101", url: "https://linear.app/x/101" });
  assert.equal(f.creates(), 1); // 만들기는 한 번뿐
  assert.deepEqual(f.log, ["create", "lookup-id"]); // 다시 보내기 전에 id로 찾았다
  assert.deepEqual(h.lines.map((l) => l.outcome), ["retry", "recovered"]);
});

test("이슈 만들기: 마지막 시도가 받은 뒤 끊겨도 거짓 실패 없이 만든 이슈를 돌려준다", async () => {
  process.env.ATC_LINEAR_WRITE_URL = "http://127.0.0.1:1/graphql";
  const h = harness();
  const f = fakeLinear(["before", "before", "after"]);
  assert.equal((await createDutyIssue(input, write(h, f))).key, "ATC-101");
  assert.equal(f.creates(), 1);
  assert.equal(h.lines.at(-1)?.outcome, "recovered");
  assert.ok(h.lines.every((l) => l.outcome !== "gave-up")); // 한 호출이 gave-up과 recovered 둘로 세이지 않는다
});

test("이슈 만들기: 끝까지 닿지 않으면 포기하고, 아무것도 만들지 않고, 오류에 구간과 원인이 적힌다", async () => {
  process.env.ATC_LINEAR_WRITE_URL = "http://127.0.0.1:1/graphql";
  const h = harness();
  const f = fakeLinear(["before", "before", "before"]);
  await assert.rejects(createDutyIssue(input, write(h, f)), (e: Error) => e.message === "fetch failed (atc server → Linear) [connect ECONNREFUSED]");
  assert.equal(f.creates(), 0);
  assert.deepEqual(h.lines.map((l) => l.outcome), ["retry", "retry", "gave-up"]);
});

test("이슈 만들기: 받은 뒤 끊기고 끝까지 끊기는데 찾아도 없으면(받지 않았다) 포기한다", async () => {
  process.env.ATC_LINEAR_WRITE_URL = "http://127.0.0.1:1/graphql";
  const h = harness();
  const fn = (async (_u: string, init: RequestInit) => {
    const { query } = JSON.parse(String(init.body));
    if (query.includes("mutation")) throw netErr("ECONNRESET");
    return json({ data: { issue: null } });
  }) as typeof fetch;
  await assert.rejects(createDutyIssue(input, { retries: 2, fetchFn: fn, sink: h.sink, sleep: h.sleep, rand: h.rand }), /ECONNRESET/);
});

test("횟수 0: 쓰기도 지금과 같다(다시 보내지도 찾지도 않는다)", async () => {
  process.env.ATC_LINEAR_WRITE_URL = "http://127.0.0.1:1/graphql";
  const h = harness();
  const f = fakeLinear(["after"]);
  await assert.rejects(createDutyIssue(input, { ...write(h, f), retries: 0 }), /fetch failed/);
  assert.deepEqual(f.log, ["create"]);
});

test("이슈 만들기: Linear가 id 필드를 모르면 id 없이 보내고 같은 제목을 찾아 중복을 막는다", async () => {
  process.env.ATC_LINEAR_WRITE_URL = "http://127.0.0.1:1/graphql";
  const h = harness();
  const f = fakeLinear(["after", "ok"], { unknownId: true });
  // 첫 보내기는 id 때문에 거절(아무것도 만들지 않음) → id 없이 다시: 받은 뒤 끊김 → 제목으로 찾아 같은 이슈
  const r = await createDutyIssue(input, write(h, f));
  assert.equal(r.key, "ATC-101");
  assert.equal(f.creates(), 1);
  assert.deepEqual(f.log, ["create", "create", "lookup-title"]);
});

test("댓글: 받은 뒤 끊겨도 두 번째 댓글이 생기지 않는다. 닿기 전에 실패하면 다시 보낸다", async () => {
  process.env.ATC_LINEAR_WRITE_URL = "http://127.0.0.1:1/graphql";
  const a = fakeLinear(["after", "ok"]);
  const ha = harness();
  const c1 = await createDutyComment("issue-1", "hello", write(ha, a));
  assert.equal(a.creates(), 1);
  assert.deepEqual(a.log, ["comment", "lookup-comment-id"]);
  assert.equal([...a.comments.keys()][0], c1.id);
  const b = fakeLinear(["before", "ok"]);
  await createDutyComment("issue-1", "hello", write(harness(), b));
  assert.equal(b.creates(), 1);
  assert.deepEqual(b.log, ["comment", "comment"]);
});

test("읽기와 관계: 읽기는 다시 시도하고, 관계는 이미 있으면 다시 만들지 않는다", async () => {
  process.env.ATC_LINEAR_WRITE_URL = "http://127.0.0.1:1/graphql";
  const h = harness();
  const f = failing(1, () => netErr("ECONNRESET"));
  const fn = (async (u: string, init: RequestInit) => {
    const { query } = JSON.parse(String(init.body));
    return query.includes("DutyIssue") ? f.fn(u, init) : json({ data: {} });
  }) as typeof fetch;
  // fetchDutyIssue의 답 모양과 다르면 TypeError가 나므로 모양을 맞춘다
  const fn2 = (async (u: string, init: RequestInit) => {
    const r = await fn(u, init);
    const b = (await r.clone().json()) as { data?: { ok?: number } };
    return b.data?.ok ? json({ data: { issue: { id: "i", identifier: "ATC-1", state: { name: "Todo", type: "unstarted" }, team: null, labels: { nodes: [] } } } }) : r;
  }) as typeof fetch;
  assert.equal((await fetchDutyIssue("ATC-1", { retries: 2, fetchFn: fn2, sink: h.sink, sleep: h.sleep, rand: h.rand }))?.key, "ATC-1");
  assert.equal(f.calls(), 2);
  // 관계: 첫 보내기가 받은 뒤 끊김 → 이미 있는 관계를 찾아 끝낸다
  let relCreates = 0;
  const rel = (async (_u: string, init: RequestInit) => {
    const { query } = JSON.parse(String(init.body));
    if (query.includes("mutation DutyBlocks")) {
      relCreates++;
      throw netErr("ECONNRESET");
    }
    return json({ data: { issue: { relations: { nodes: [{ type: "blocks", relatedIssue: { id: "B" } }] } } } });
  }) as typeof fetch;
  await createDutyBlocks("A", "B", { retries: 2, fetchFn: rel, sink: h.sink, sleep: h.sleep, rand: h.rand });
  assert.equal(relCreates, 1);
});

test("noteLinesOf: atcctl의 기록은 모르는 값이 있으면 그 줄을 버리고 글을 싣지 않는다", () => {
  const now = new Date("2026-10-06T10:00:00Z");
  const lines = noteLinesOf({ events: [{ op: "read", attempt: 1, outcome: "retry", cause: "connect", code: "ECONNREFUSED" }, { op: "x", attempt: 1, outcome: "retry", cause: "dns" }, { op: "read", attempt: 2, outcome: "recovered", cause: "dns", code: "bad code!" }, { op: "update", attempt: 1, outcome: "gave-up", cause: "network", title: "SECRET" }] }, now);
  assert.deepEqual(lines.map((l) => [l.hop, l.op, l.attempt, l.outcome, l.cause, l.code]), [
    ["atcctl-to-atc-server", "read", 1, "retry", "connect", "ECONNREFUSED"],
    ["atcctl-to-atc-server", "read", 2, "recovered", "dns", undefined],
    ["atcctl-to-atc-server", "update", 1, "gave-up", "network", undefined],
  ]);
  assert.ok(!JSON.stringify(lines).includes("SECRET"));
  assert.deepEqual(noteLinesOf(null), []);
  assert.deepEqual(noteLinesOf({ events: "x" }), []);
});

test("callCountsOf: 날·구간·원인마다 실패한 시도, 복구, 포기", () => {
  const l = (t: string, hop: LinearCallLine["hop"], outcome: LinearCallLine["outcome"], cause: LinearCallLine["cause"]): LinearCallLine => ({ t, kind: "linear-call", hop, op: "read", attempt: 1, outcome, cause });
  const S = "atc-server-to-linear" as const;
  const lines = [l("2026-10-06T01:00:00Z", S, "retry", "dns"), l("2026-10-06T01:00:01Z", S, "recovered", "dns"), l("2026-10-06T02:00:00Z", S, "retry", "dns"), l("2026-10-06T02:00:02Z", S, "gave-up", "dns"), l("2026-10-05T02:00:00Z", "atcctl-to-atc-server", "gave-up", "connect"), l("2026-09-01T00:00:00Z", S, "gave-up", "dns")];
  const c = callCountsOf(lines, Date.parse("2026-10-01T00:00:00Z"), Date.parse("2026-10-07T00:00:00Z"));
  assert.deepEqual(c, [
    { day: "2026-10-06", hop: S, cause: "dns", failedAttempts: 3, recovered: 1, gaveUp: 1 },
    { day: "2026-10-05", hop: "atcctl-to-atc-server", cause: "connect", failedAttempts: 1, recovered: 0, gaveUp: 1 },
  ]);
});

test("id 필드를 모르는 Linear: 대체 길로 가는 검증 거절은 기록하지 않는다", async () => {
  process.env.ATC_LINEAR_WRITE_URL = "http://127.0.0.1:1/graphql";
  const h = harness();
  const f = fakeLinear(["ok"], { unknownId: true });
  assert.equal((await createDutyIssue(input, write(h, f))).key, "ATC-101");
  assert.deepEqual(h.lines, []); // 첫 보내기의 400이 포기로 세이지 않는다
});

test("기록의 key는 이슈 key 모양일 때만(내부 UUID는 넣지 않는다)", () => {
  const e = { attempt: 1, outcome: "retry" as const, cause: { cls: "dns" as const, code: "ENOTFOUND", mayHaveSent: false } };
  assert.equal(lineOf(e, "atc-server-to-linear", "update", "ATC-561").key, "ATC-561");
  assert.equal("key" in lineOf(e, "atc-server-to-linear", "update", "3f2b8c1e-0d7a-4c55-9d3e-2a1b7c9e0f11"), false);
});

test("POST /api/linear-calls/note: Origin이 붙은 요청(브라우저)은 403", async () => {
  const app = new Hono();
  mountLinearCalls(app);
  const body = JSON.stringify({ events: [] });
  const withOrigin = await app.request("/api/linear-calls/note", { method: "POST", headers: { origin: "http://evil.example", "content-type": "application/json" }, body });
  assert.equal(withOrigin.status, 403);
  const plain = await app.request("/api/linear-calls/note", { method: "POST", headers: { "content-type": "application/json" }, body });
  assert.equal(plain.status, 200);
  assert.deepEqual(await plain.json(), { recorded: 0 });
});

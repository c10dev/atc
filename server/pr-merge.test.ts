import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { type MergeFacts, mergeInfoOf, mergeMethodOf, mergeVerdictOf, parseMergeBody } from "./pr-merge.ts";
import { type MergeDeps, mountPrMerge } from "./pr-merge-run.ts";
import type { Snapshot } from "./model.ts";

const HEAD = "a".repeat(40);
const OTHER = "b".repeat(40);

const facts = (over: Partial<MergeFacts> = {}, live: Partial<MergeFacts["live"]> = {}): MergeFacts => ({
  isMccAirport: true,
  live: { state: "open", draft: false, head: HEAD, base: "main", fork: false, ...live },
  defaultBranch: "main",
  tier: "user",
  escalated: false,
  held: false,
  polled: { head: HEAD, landing: "CLEARED", blocks: [] },
  ...over,
});

test("본문: 40자 sha만(대소문자는 소문자로), 짧은 sha·다른 모양은 오류", () => {
  assert.deepEqual(parseMergeBody({ head: HEAD.toUpperCase() }), { ok: true, head: HEAD });
  for (const bad of [null, undefined, [], "x", {}, { head: "abc1234" }, { head: `${HEAD}0` }, { head: "g".repeat(40) }, { head: 5 }]) assert.equal(parseMergeBody(bad).ok, false, JSON.stringify(bad));
});

test("머지 방식: MCC AIRPORT는 merge, 그 밖은 AUTOLAND의 방식", () => {
  assert.equal(mergeMethodOf("ATCC", "ATCC", "squash"), "merge");
  assert.equal(mergeMethodOf("VCDO", "ATCC", "squash"), "squash");
  assert.equal(mergeMethodOf("VCDO", "ATCC", "rebase"), "rebase");
});

test("판정: user 등급·CLEARED·head 그대로면 통과", () => {
  assert.deepEqual(mergeVerdictOf(HEAD, facts()), { ok: true });
});

test("판정: MCC의 auto·flagged는 절대 머지하지 않는다(403), ESCALATE한 PR은 user로 본다", () => {
  for (const tier of ["auto", "flagged"] as const) {
    const v = mergeVerdictOf(HEAD, facts({ tier }));
    assert.ok(!v.ok && v.status === 403, tier);
    assert.match((v as { error: string }).error, /MCC가 착륙시킨다/);
  }
  assert.deepEqual(mergeVerdictOf(HEAD, facts({ tier: "auto", escalated: true })), { ok: true });
  const unknown = mergeVerdictOf(HEAD, facts({ tier: null }));
  assert.ok(!unknown.ok && unknown.status === 409, "등급을 모르면 머지하지 않는다");
});

test("판정: MCC AIRPORT가 아니면 403", () => {
  const v = mergeVerdictOf(HEAD, facts({ isMccAirport: false }));
  assert.ok(!v.ok && v.status === 403);
});

test("판정: 닫힘·Draft·fork·기본 브랜치가 아닌 쪽은 409", () => {
  for (const live of [{ state: "closed" }, { state: "merged" }, { draft: true }, { fork: true }, { base: "feature" }]) {
    const v = mergeVerdictOf(HEAD, facts({}, live));
    assert.ok(!v.ok && v.status === 409, JSON.stringify(live));
  }
});

test("판정: head가 움직였으면 409와 새 head", () => {
  const v = mergeVerdictOf(HEAD, facts({}, { head: OTHER }));
  assert.ok(!v.ok && v.status === 409);
  assert.equal(v.currentHead, OTHER);
  assert.match(v.error, /head가 움직임/);
});

test("판정: HOLD, atc가 이 head를 아직 보지 못함, CLEARED가 아님은 409", () => {
  assert.ok(!mergeVerdictOf(HEAD, facts({ held: true })).ok);
  assert.ok(!mergeVerdictOf(HEAD, facts({ polled: null })).ok);
  assert.ok(!mergeVerdictOf(HEAD, facts({ polled: { head: OTHER, landing: "CLEARED", blocks: [] } })).ok, "폴링한 head가 다르면");
  const v = mergeVerdictOf(HEAD, facts({ polled: { head: HEAD, landing: "APPROACH", blocks: ["CI failed"] } }));
  assert.ok(!v.ok && v.status === 409);
  assert.deepEqual(v.blocks, ["CI failed"]);
});

test("서랍용 정보: 되면 allowed·why null, 안 되면 까닭", () => {
  const ok = mergeInfoOf(facts(), "merge");
  assert.deepEqual(ok, { allowed: true, why: null, head: HEAD, tier: "user", escalated: false, method: "merge" });
  const no = mergeInfoOf(facts({ tier: "auto" }), "merge");
  assert.equal(no.allowed, false);
  assert.match(no.why ?? "", /MCC/);
});

// ── 길: gh는 모두 스텁이다. 진짜 gh를 부르지 않는다 ──
type Call = string[];
function setup(over: { pr?: Partial<{ state: string; draft: boolean; head: string; base: string; fork: boolean }>; files?: string[]; put?: () => Promise<string>; tier?: "auto" | "flagged" | "user"; polled?: object | null; held?: number[]; escalated?: boolean; airport?: string; mccAirport?: string } = {}) {
  const calls: Call[] = [];
  const records: Record<string, unknown>[] = [];
  const forgot: string[] = [];
  const pr = { state: "open", draft: false, head: HEAD, base: "main", fork: false, ...over.pr };
  const deps: MergeDeps = {
    gh: async (args) => {
      calls.push(args);
      if (args[0] === "api" && args[1] === `repos/o/r/pulls/7`) return JSON.stringify({ state: pr.state, draft: pr.draft, head: { sha: pr.head, repo: { full_name: pr.fork ? "x/r" : "o/r" } }, base: { ref: pr.base, repo: { full_name: "o/r" } } });
      if (args.includes("--paginate")) return (over.files ?? ["docs/x.md", "CLAUDE.md"]).join("\n");
      if (args.includes("PUT")) return over.put ? over.put() : "{}";
      throw new Error(`스텁에 없는 gh 호출: ${args.join(" ")}`);
    },
    slugOf: async () => "o/r",
    mccAirport: () => over.mccAirport ?? "ATCC",
    holds: () => over.held ?? [],
    escalated: () => over.escalated ?? false,
    autolandMethod: () => "squash",
    tierOf: async () => over.tier ?? "user",
    record: ((l: Record<string, unknown>) => void records.push(l)) as unknown as MergeDeps["record"],
    forget: (repo, n) => void forgot.push(`${repo}#${n}`),
    now: () => new Date("2026-09-30T12:00:00Z"),
  };
  const snap = {
    airports: [{ code: "ATCC", repo: "/r/atc" }, { code: "VCDO", repo: "/r/vocado" }],
    atfm: { mains: [{ repo: "/r/atc", branch: "main" }] },
    pulls: over.polled === null ? [] : [{ repo: "/r/atc", number: 7, head: HEAD, landing: "CLEARED", blocks: [], ...(over.polled ?? {}) }],
  } as unknown as Snapshot;
  const app = new Hono();
  mountPrMerge(app, async () => snap, deps);
  const post = (body: unknown, headers: Record<string, string> = { "content-type": "application/json", origin: "http://localhost:7700" }, airport = over.airport ?? "ATCC") =>
    app.request(`/api/pr/${airport}/7/merge`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
  const puts = () => calls.filter((c) => c.includes("PUT"));
  return { post, calls, puts, records, forgot };
}

test("길: 이 화면(Origin localhost·JSON)이 아니면 403이고 gh를 부르지 않는다", async () => {
  const t = setup();
  for (const headers of [{} as Record<string, string>, { "content-type": "application/json" }, { "content-type": "application/json", origin: "https://evil.example" }, { origin: "http://localhost:7700" }, { "content-type": "text/plain", origin: "http://localhost:7700" }]) {
    const r = await t.post({ head: HEAD }, headers);
    assert.equal(r.status, 403, JSON.stringify(headers));
  }
  assert.equal(t.calls.length, 0, "gh를 한 번도 부르지 않았다");
  assert.equal(t.records.length, 0);
});

test("길: 본문·주소가 틀리면 400, 없는 AIRPORT는 404 — 머지하지 않는다", async () => {
  const t = setup();
  assert.equal((await t.post({ head: "abc" })).status, 400);
  assert.equal((await t.post("not json")).status, 400);
  assert.equal((await t.post({ head: HEAD }, undefined, "NOPE")).status, 404);
  assert.equal(t.puts().length, 0);
});

test("길: user 등급 CLEARED PR을 정확한 head로 머지한다(sha 고정, merge 방식, auto-merge 없음)", async () => {
  const t = setup();
  const r = await t.post({ head: HEAD });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { merged: true, head: HEAD, method: "merge", tier: "user", escalated: false });
  assert.equal(t.puts().length, 1);
  assert.deepEqual(t.puts()[0], ["api", "-X", "PUT", "repos/o/r/pulls/7/merge", "-f", `sha=${HEAD}`, "-f", "merge_method=merge"]);
  for (const c of t.calls) assert.ok(!c.some((a) => /auto/i.test(a)), "auto-merge를 켜지 않는다");
  assert.deepEqual(t.records, [{ t: "2026-09-30T12:00:00.000Z", kind: "pr", op: "merge", by: "supervisor", airport: "ATCC", number: 7, head: HEAD, ok: true, result: "merged", method: "merge" }]);
  assert.deepEqual(t.forgot, ["/r/atc#7"]);
});

test("길: auto·flagged 등급은 머지하지 않고(403) 한 줄 남긴다", async () => {
  for (const tier of ["auto", "flagged"] as const) {
    const t = setup({ tier });
    const r = await t.post({ head: HEAD });
    assert.equal(r.status, 403, tier);
    assert.equal(t.puts().length, 0, tier);
    assert.equal(t.records.length, 1);
    assert.equal(t.records[0].ok, false);
    assert.equal(t.records[0].result, "refused");
  }
  const esc = setup({ tier: "auto", escalated: true });
  assert.equal((await esc.post({ head: HEAD })).status, 200, "ESCALATE한 PR은 user로 본다");
});

test("길: head가 움직였으면 409와 새 head를 주고 머지하지 않는다", async () => {
  const t = setup({ pr: { head: OTHER } });
  const r = await t.post({ head: HEAD });
  assert.equal(r.status, 409);
  const b = (await r.json()) as { currentHead: string };
  assert.equal(b.currentHead, OTHER);
  assert.equal(t.puts().length, 0);
  assert.equal(t.records[0].result, "rejected");
});

test("길: CLEARED가 아니거나 atc가 이 head를 못 봤거나 HOLD면 409, 머지하지 않는다", async () => {
  for (const o of [{ polled: { landing: "APPROACH", blocks: [{ en: "CI failed" }] } }, { polled: null }, { polled: { head: OTHER } }, { held: [7] }]) {
    const t = setup(o as never);
    assert.equal((await t.post({ head: HEAD })).status, 409, JSON.stringify(o));
    assert.equal(t.puts().length, 0);
  }
});

test("길: 열린 PR이 아니거나 Draft·fork면 409, 다른 AIRPORT(MCC 아님)는 403", async () => {
  for (const pr of [{ state: "closed" }, { draft: true }, { fork: true }]) {
    const t = setup({ pr });
    assert.equal((await t.post({ head: HEAD })).status, 409, JSON.stringify(pr));
    assert.equal(t.puts().length, 0);
  }
  const t = setup({ mccAirport: "VCDO" });
  assert.equal((await t.post({ head: HEAD })).status, 403);
  assert.equal(t.puts().length, 0);
});

test("길: GitHub이 머지를 거절하면(head 불일치 422 등) 409로 사유를 주고 성공을 적지 않는다", async () => {
  const t = setup({ put: async () => { throw Object.assign(new Error("x"), { stderr: "gh: Head branch was modified. Review and try the merge again. (HTTP 409)" }); } });
  const r = await t.post({ head: HEAD });
  assert.equal(r.status, 409);
  assert.equal(((await r.json()) as { result: string }).result, "rejected");
  assert.equal(t.records.length, 1);
  assert.equal(t.records[0].ok, false);
  assert.equal(t.records[0].result, "rejected");
  assert.deepEqual(t.forgot, []);
});

test("길: 파일 목록을 못 읽어 등급을 모르면 머지하지 않는다", async () => {
  const t = setup({ files: [] });
  assert.equal((await t.post({ head: HEAD })).status, 409);
  assert.equal(t.puts().length, 0);
});

test("길: 소스에 auto-merge와 gh pr merge --auto가 없다", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./pr-merge-run.ts", import.meta.url), "utf8");
  assert.ok(!/--auto\b|enableAutoMerge|auto_merge|"auto"/.test(src));
  assert.ok(!/execFile|spawn\(|exec\(/.test(src), "이 파일은 명령을 직접 돌리지 않는다(gh는 mcc-run의 것)");
});

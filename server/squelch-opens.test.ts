import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import { readSessionCalls } from "./skill-calls-run.ts";
import { emptyScan, scanLine, scanTranscript } from "./skill-calls.ts";
import { type Decision, decisionOf, isNaturalOpen, opensTable, TICK_WINDOW_MS, verdictOf, WORKED_MIN } from "./squelch-opens.ts";
import { mountSquelchOpens, opensView, readDecisions } from "./squelch-opens-run.ts";

// 시험은 임시 폴더의 가짜 기록만 읽는다. 실제 ~/.claude*와 ~/.local/state/atc는 읽지 않는다
const T0 = Date.parse("2026-10-01T06:00:00Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const ms = (min: number) => T0 + min * 60_000;
const dec = (min: number, o: Partial<Decision> = {}): Decision => ({ t: at(min), role: "tower", open: true, reason: "signal", ...o });
const useAt = (...mins: number[]) => mins.map(ms);

test("verdictOf: 도구 호출 3번 이상이면 worked, 2번 이하는 idle(ATC-292), 기록이 없거나 아직 끝나지 않은 tick은 unknown", () => {
  assert.equal(WORKED_MIN, 3);
  const now = ms(100);
  assert.equal(verdictOf(useAt(1, 2), ms(0), ms(10), now), "idle");
  assert.equal(verdictOf(useAt(1, 2, 3), ms(0), ms(10), now), "worked");
  assert.equal(verdictOf(useAt(0, 11, 12, 13), ms(0), ms(10), now), "idle"); // 구간 밖 호출은 세지 않는다(시작은 포함하지 않는다)
  assert.equal(verdictOf(null, ms(0), ms(10), now), "unknown");
  assert.equal(verdictOf(useAt(1, 2, 3), ms(0), ms(10), ms(5)), "unknown"); // tick이 아직 끝나지 않음
});

test("isNaturalOpen: first·manual·signal·heartbeat만(shadow: 접두어는 뗀다), quiet·off·fail-open은 아니다", () => {
  for (const r of ["first", "manual", "signal", "heartbeat", "shadow:signal", "shadow:first"]) assert.equal(isNaturalOpen(dec(0, { reason: r })), true, r);
  for (const r of ["quiet", "shadow:quiet", "off", "fail-open"]) assert.equal(isNaturalOpen(dec(0, { reason: r })), false, r);
});

test("opensTable: 필드마다 열림·idle·worked를 세고, idle이 많은 필드가 먼저", () => {
  const decisions = [
    dec(0, { reason: "first" }),
    dec(10, { fields: ["open.healthAlerts[]"], would: "quiet" }), // 다음 tick(20분)까지 도구 1번 → idle
    dec(20, { fields: ["open.healthAlerts[]", "events[]"], would: "open" }), // 4번 → worked
    dec(30, { reason: "quiet", open: false }),
    dec(40, { fields: ["open.healthAlerts[]"], would: "quiet" }), // 다음 열린 판정 없음 → 창 30분: 도구 3번 → worked
    dec(300, { reason: "shadow:signal", fields: ["landingQueue[].head"] }), // 도구 0번 → idle
  ];
  const uses = useAt(15, 21, 22, 23, 24, 41, 42, 43);
  const t = opensTable(decisions, () => uses, ms(1000)).tower!;
  assert.equal(t.decisions, 6);
  assert.equal(t.opens, 5);
  assert.deepEqual(t.reasons, { first: 1, signal: 4, quiet: 1 });
  assert.deepEqual(t.signal, { total: 4, idle: 2, worked: 2, unknown: 0 });
  const by = Object.fromEntries(t.fields.map((f) => [f.field, f]));
  assert.deepEqual(by["open.healthAlerts[]"], { field: "open.healthAlerts[]", opens: 3, idle: 1, worked: 2, unknown: 0 });
  assert.deepEqual(by["events[]"], { field: "events[]", opens: 1, idle: 0, worked: 1, unknown: 0 });
  assert.equal(t.fields[0]!.idle >= t.fields.at(-1)!.idle, true);
  assert.equal(JSON.stringify(t).includes("SECRET"), false);
});

test("opensTable: v2가 버렸을 tick(would: quiet)이 idle이면 wouldQuietIdle, 일을 했으면 wrongSkips", () => {
  const decisions = [dec(0, { would: "quiet" }), dec(40, { would: "quiet" }), dec(80, { would: "open" }), dec(120, { would: "quiet" })];
  // tick 0: idle, tick 40: 도구 3번 → worked(wrong skip), tick 80: would open, tick 120: 이후 30분에 도구 0번 → idle
  const uses = useAt(41, 42, 43, 85);
  const r = opensTable(decisions, (role) => (role === "tower" ? uses : null), ms(1000));
  const v2 = r.tower!.v2;
  assert.equal(v2.shadowed, 4);
  assert.equal(v2.wouldQuiet, 3);
  assert.equal(v2.wouldQuietIdle, 2);
  assert.equal(v2.wrongSkips, 1);
  assert.equal(v2.wouldQuietUnknown, 0);
  // 세션 기록을 못 찾으면 모두 unknown이고 wrongSkips는 0
  const none = opensTable(decisions, () => null, ms(1000)).tower!.v2;
  assert.deepEqual([none.wrongSkips, none.wouldQuietIdle, none.wouldQuietUnknown], [0, 0, 3]);
});

test("opensTable: 한 tick의 끝은 같은 역할의 다음 열린 판정이고, 다른 역할은 섞이지 않는다", () => {
  const decisions = [dec(0), dec(5, { role: "mcc" }), dec(10)];
  const uses = useAt(1, 2, 3, 4, 6, 7, 8, 9, 11); // tower: 0~10분 사이 8번
  const r = opensTable(decisions, (role) => (role === "tower" ? uses : useAt()), ms(1000));
  assert.equal(r.tower!.signal.worked, 1); // 첫 tower tick
  assert.equal(r.mcc!.signal.idle, 1);
  assert.equal(r.tower!.signal.total, 2);
  assert.ok(TICK_WINDOW_MS > 0);
});

test("decisionOf: 판정 줄만 읽고 모르는 줄은 건너뛴다", () => {
  assert.deepEqual(decisionOf(JSON.stringify({ t: at(0), role: "tower", open: true, reason: "signal", fp: "x", would: "quiet", fields: ["a", 1, "b"] })), { t: at(0), role: "tower", open: true, reason: "signal", would: "quiet", fields: ["a", "b"] });
  for (const bad of ["", "not json", "{}", JSON.stringify({ t: "x", role: "tower", reason: "r" }), JSON.stringify({ t: at(0), role: 1, reason: "r" })]) assert.equal(decisionOf(bad), null, bad);
});

// ── 도구 호출 시각(이름 없이) ──
const asst = (min: number, ...blocks: object[]) => JSON.stringify({ type: "assistant", timestamp: at(min), isSidechain: false, message: { content: blocks } });
const tool = (name: string, input: object) => ({ type: "tool_use", id: "t", name, input });

test("scanLine: uses는 요청했을 때만, 도구 호출마다 그 줄의 시각 하나씩(이름·입력은 읽지 않는다), sidechain은 뺀다", () => {
  const text = [
    asst(1, tool("Bash", { command: "SECRET-CMD" })),
    asst(2, { type: "text", text: "no tool" }),
    asst(3, tool("Read", { file_path: "SECRET-PATH" }), tool("Bash", { command: "x" })),
    JSON.stringify({ type: "assistant", timestamp: at(4), isSidechain: true, message: { content: [tool("Bash", {})] } }),
    JSON.stringify({ type: "user", timestamp: at(5), message: { content: "SECRET-TEXT" } }),
  ].join("\n");
  const st = emptyScan(true);
  for (const l of text.split("\n")) scanLine(l, st);
  assert.deepEqual(st.uses, [at(1), at(3), at(3)]);
  assert.equal(JSON.stringify(st.uses).includes("SECRET"), false);
  assert.equal(scanTranscript(text).uses, undefined); // 기본은 담지 않는다
});

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "atc-opens-"));
  mkdirSync(join(root, "-srv-atc-controller"), { recursive: true });
  mkdirSync(join(root, "-srv-other-repo"), { recursive: true });
  writeFileSync(join(root, "-srv-atc-controller", "t1.jsonl"), [asst(11, tool("Bash", {})), asst(12, tool("Bash", {})), asst(13, tool("Bash", {}))].join("\n") + "\n");
  writeFileSync(join(root, "-srv-other-repo", "x1.jsonl"), asst(11, tool("Bash", {})) + "\n"); // 관제 폴더가 아니면 읽지 않는다
  return root;
}

test("readSessionCalls(uses): 관제 세션 폴더만 읽고 uses를 담는다", () => {
  const root = fixtureRoot();
  try {
    const s = readSessionCalls(0, [root], "/srv/atc", undefined, { uses: true });
    assert.equal(s.length, 1);
    assert.equal(s[0]!.role, "tower");
    assert.deepEqual(s[0]!.uses, [at(11), at(12), at(13)]);
    // 옵션 없이 읽으면(ATC-289의 일일 기록) 모든 폴더를 읽고 uses는 없다
    const all = readSessionCalls(0, [root], "/srv/atc");
    assert.equal(all.length, 2);
    assert.ok(all.every((x) => x.uses === undefined));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("GET /api/squelch/opens: 로그와 세션 기록을 합쳐 역할별 표를 주고, days가 틀리면 400", async () => {
  const root = fixtureRoot();
  const dir = mkdtempSync(join(tmpdir(), "atc-opens-state-"));
  try {
    const file = join(dir, "squelch.jsonl");
    writeFileSync(
      file,
      [
        { t: at(10), role: "tower", open: true, reason: "signal", would: "quiet", fields: ["open.healthAlerts[]"] },
        { t: at(20), role: "tower", open: true, reason: "signal", would: "open", fields: ["events[]"] },
        { t: "2020-01-01T00:00:00Z", role: "tower", open: true, reason: "signal", fields: ["old[]"] }, // 창 밖
      ]
        .map((x) => JSON.stringify(x))
        .join("\n") + "\nnot json\n",
    );
    const deps = { now: () => ms(120), file: () => file, sessions: (since: number) => readSessionCalls(since, [root], "/srv/atc", undefined, { uses: true }) };
    assert.equal(readDecisions(file, ms(0)).length, 2);
    const app = new Hono();
    mountSquelchOpens(app, deps);
    const res = await app.request("/api/squelch/opens?days=1");
    assert.equal(res.status, 200);
    const body = (await res.json()) as ReturnType<typeof opensView>;
    const t = body.roles.tower!;
    assert.equal(t.opens, 2);
    assert.deepEqual(t.signal, { total: 2, idle: 1, worked: 1, unknown: 0 }); // 첫 tick(10~20분)은 도구 3번(11·12·13분), 둘째(20~50분)는 0번
    assert.deepEqual(t.v2, { shadowed: 2, wouldQuiet: 1, wouldQuietIdle: 0, wrongSkips: 1, wouldQuietUnknown: 0 }); // v2가 버렸을 첫 tick이 일을 했다
    assert.deepEqual(t.fields.map((f) => f.field).sort(), ["events[]", "open.healthAlerts[]"]);
    assert.equal((await app.request("/api/squelch/opens?days=0")).status, 400);
    assert.equal((await app.request("/api/squelch/opens?days=x")).status, 400);
    // 파일이 없으면 빈 표
    const empty = new Hono();
    mountSquelchOpens(empty, { ...deps, file: () => join(dir, "none.jsonl") });
    assert.deepEqual(((await (await empty.request("/api/squelch/opens")).json()) as ReturnType<typeof opensView>).roles, {});
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

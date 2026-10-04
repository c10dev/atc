import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { chatReleaseHooks } from "./chat-release-run.ts";
import { defaultL1Deps, type L1Deps, mountDutyL1 } from "./duty-l1-run.ts";
import type { RecordLine } from "./recorder.ts";
import { chatCreateMisfiresOf, foldReleases, releaseHashOf, type ReleaseLine } from "./release.ts";

// 채팅 발권(ATC-471): `duty linear create --release`. 가짜 Linear·가짜 DUTY 턴만 쓴다(진짜 Linear 쓰기도 세션 메시지도 없다)
const okBody = "## Goal\nx\n\n## Done when\nx\n\n## K effects\nNone\n\n## Measure\nNone";
const createBody = { action: "create", title: "Speed up the thing", body: okBody, priority: 3 };
const relBody = { ...createBody, release: true };
const post = (app: Hono, body: unknown) => app.request("/api/duty/linear", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// Linear는 본문을 Markdown으로 저장하며 기호 앞에 역슬래시를 둔다(`k3\_allow.ts`, `\[x\]`)
const linearEscape = (s: string) => s.replace(/([_[\]])/g, "\\$1");

function rig(over: { on?: boolean; turn?: string | null; review?: boolean; readBack?: "escaped" | "none" } = {}) {
  let stored: string | null = null;
  const calls: unknown[][] = [];
  const events: string[] = []; // create와 발권 기록의 순서
  const written: ReleaseLine[] = [];
  const lines: RecordLine[] = [];
  const states = [{ id: "sb", name: "Backlog", type: "backlog" }, { id: "st", name: "Todo", type: "unstarted" }];
  const issue = { id: "i1", key: "ATC-7", team: "ATC", state: { name: "Todo", type: "unstarted" }, labels: [], states };
  const hooks = chatReleaseHooks(() => (over.turn === undefined ? "만들고 진행해: speed up the thing" : over.turn), (l) => void (written.push(l), events.push("release")));
  const d: L1Deps = {
    ...defaultL1Deps,
    repo: process.cwd(),
    enabled: () => true,
    team: async () => ({ id: "T", states, labels: [] }),
    issue: async (k) => (k === "ATC-7" ? issue : k === "ATC-99" ? { ...issue, id: "i99", key: "ATC-99", description: over.readBack === "none" ? null : stored } : null),
    create: async (i) => (calls.push(["create", i]), events.push("create"), (stored = over.readBack === "escaped" ? linearEscape(i.description) : i.description), { key: "ATC-99", url: "https://linear.app/x/ATC-99" }),
    blocks: async () => {},
    forget: () => {},
    record: ((l: RecordLine) => void lines.push(l)) as L1Deps["record"],
    now: () => new Date("2026-10-04T00:00:00Z"),
    reviewTurn: () => over.review === true,
    chatRelease: { ...hooks.chatRelease, on: () => over.on ?? true },
  };
  const app = new Hono();
  mountDutyL1(app, d);
  return { app, calls, written, events, lines };
}

test("--release: SUPERVISOR 턴이면 Todo로 만들고, 이슈가 생긴 뒤에 duty-chat 발권을 적는다(words = 그 글, 해시 = 스냅숏이 내는 값)", async () => {
  const c = rig();
  const r = await post(c.app, relBody);
  assert.equal(r.status, 200);
  const b = (await r.json()) as { key: string; state: string; released: boolean };
  assert.deepEqual([b.key, b.state, b.released], ["ATC-99", "Todo", true], "상태를 안 주면 Todo");
  assert.deepEqual(c.events, ["create", "release"], "발권은 이슈가 생긴 뒤에");
  const line = c.written[0]!;
  assert.ok(line.op === "release");
  assert.deepEqual([line.channel, line.via, line.flight, line.words], ["duty-chat", "create", "ATC-99", "만들고 진행해: speed up the thing"]);
  // 스냅숏(sources/linear.ts)은 Linear가 저장한 본문에 releaseHashOf를 쓴다: 다시 읽은 본문의 해시와 같아야 한다
  const input = c.calls[0]![1] as { description: string; stateId: string };
  assert.equal(line.hash, releaseHashOf(input.description));
  assert.equal(input.stateId, "st");
  assert.equal(foldReleases(c.written).records["ATC-99"]?.hash, releaseHashOf(input.description));
});

test("--release: 해시는 Linear가 이스케이프해 저장한 본문을 다시 읽은 것에서 만든다(보낸 본문의 해시면 곧바로 stale)", async () => {
  const c = rig({ readBack: "escaped" });
  const body = "## Goal\nRename k3_allow.ts and tick [x] items\n\n## Done when\nthe_file is renamed\n\n## K effects\nNone\n\n## Measure\nNone";
  assert.equal((await post(c.app, { ...relBody, body })).status, 200);
  const sent = (c.calls[0]![1] as { description: string }).description;
  const stored = linearEscape(sent);
  assert.notEqual(releaseHashOf(sent), releaseHashOf(stored), "이 본문은 이스케이프로 해시가 달라진다");
  const line = c.written[0]!;
  assert.ok(line.op === "release");
  assert.equal(line.hash, releaseHashOf(stored), "스냅숏이 계산하는 값");
});

test("--release: 저장된 본문을 다시 읽지 못하면 발권을 적지 않고 이슈는 Todo로 남는다(화면에서 발권)", async () => {
  const c = rig({ readBack: "none" });
  const r = await post(c.app, relBody);
  assert.equal(r.status, 200);
  const b = (await r.json()) as { released: boolean; warning?: string };
  assert.equal(b.released, false);
  assert.match(b.warning ?? "", /RELEASE 화면/);
  assert.equal(c.written.length, 0);
});

test("--release: 글이 500자를 넘으면 앞 500자(채팅 발권과 같은 한도)", async () => {
  const c = rig({ turn: "가".repeat(700) });
  assert.equal((await post(c.app, relBody)).status, 200);
  const line = c.written[0]!;
  assert.ok(line.op === "release");
  assert.equal(line.words?.length, 500);
});

test("--release: REVIEW 턴이면 403, 턴이 없으면 403 — 아무것도 만들지 않는다", async () => {
  for (const over of [{ review: true, turn: null }, { review: true }, { turn: null }]) {
    const c = rig(over);
    assert.equal((await post(c.app, relBody)).status, 403, JSON.stringify(over));
    assert.equal(c.calls.length, 0);
    assert.equal(c.written.length, 0);
  }
});

test("--release: K 효과가 있으면 409(화면에서 발권) — K3 줄이든 None이 아닌 글이든 아무것도 만들지 않는다", async () => {
  const k3 = "## Goal\nx\n\n## Done when\nx\n\n## K effects\nK3[Security Weaken]: loosen the guard | files: controller/guard.mjs\n\n## Measure\nNone";
  const other = "## Goal\nx\n\n## Done when\nx\n\n## K effects\nWrites production data.\n\n## Measure\nNone";
  for (const body of [k3, other]) {
    const c = rig();
    const r = await post(c.app, { ...relBody, body });
    assert.equal(r.status, 409, body);
    assert.match(((await r.json()) as { error: string }).error, /fire this one on the RELEASE screen/);
    assert.equal(c.calls.length, 0);
    assert.equal(c.written.length, 0);
  }
  // None으로 시작하는 글은 K 효과 없음
  const ok = rig();
  assert.equal((await post(ok.app, { ...relBody, body: okBody.replace("K effects\nNone", "K effects\nNone — code only") })).status, 200);
});

test("--release: 스위치(chatRelease)가 꺼지면 아무것도 쓰기 전에 403이고 RELEASE 화면에서 쏘라고 답한다", async () => {
  const c = rig({ on: false });
  const r = await post(c.app, relBody);
  assert.equal(r.status, 403);
  assert.match(((await r.json()) as { error: string }).error, /RELEASE 화면/);
  assert.equal(c.calls.length, 0);
  assert.equal(c.written.length, 0);
  assert.equal((await post(c.app, createBody)).status, 200, "--release가 없는 create는 그대로");
  assert.equal(c.written.length, 0);
});

test("--release: --state Backlog는 400. update·comment에는 칸이 없다. 우선순위 필수. blockedBy는 같이 쓸 수 있다", async () => {
  const c = rig();
  const bk = await post(c.app, { ...relBody, state: "Backlog" });
  assert.equal(bk.status, 400);
  assert.match(((await bk.json()) as { error: string }).error, /Backlog/);
  assert.equal((await post(c.app, { ...relBody, release: "yes" })).status, 400);
  assert.equal((await post(c.app, { action: "update", key: "ATC-7", release: true })).status, 400);
  assert.equal((await post(c.app, { action: "comment", key: "ATC-7", body: "x", release: true })).status, 400);
  const { priority: _p, ...noPriority } = relBody;
  assert.equal((await post(c.app, noPriority)).status, 400);
  assert.equal(c.calls.length, 0);
  const blocked = await post(c.app, { ...relBody, blockedBy: ["ATC-7"] });
  assert.equal(blocked.status, 200);
  assert.deepEqual(((await blocked.json()) as { blockedBy: string[] }).blockedBy, ["ATC-7"]);
  assert.equal(c.written.length, 1);
});

test("--release: 본문 모양 점검이 먼저 거절하면 발권 판정까지 가지 않는다", async () => {
  const c = rig({ turn: null });
  assert.equal((await post(c.app, { ...relBody, body: "no sections" })).status, 400);
});

test("오작동 수: 첫 LAUNCH 전에 Canceled·Duplicate·Backlog가 됐거나 거둔 것만 센다. 시작한 이슈와 다른 길의 발권은 세지 않는다", () => {
  const at = "2026-10-03T10:00:00.000Z";
  const rel = (flight: string, via?: "create" | "click"): ReleaseLine => ({ op: "release", flight, channel: via === "create" ? "duty-chat" : "screen", at, hash: "h", ...(via ? { via } : {}) });
  const lines: ReleaseLine[] = [
    ...["ATC-1", "ATC-2", "ATC-3", "ATC-4", "ATC-5"].map((k) => rel(k, "create")),
    rel("ATC-6", "click"),
    rel("ATC-7", "create"),
    { op: "revoke", flight: "ATC-7", at: "2026-10-03T11:00:00.000Z", reason: "r", by: "SUPERVISOR" },
  ];
  const tickets = [
    { key: "ATC-1", stateType: "canceled" },
    { key: "ATC-2", stateType: "backlog" },
    { key: "ATC-3", stateType: "unstarted" },
    { key: "ATC-4", stateType: "started" },
    { key: "ATC-5", stateType: "duplicate" },
    { key: "ATC-6", stateType: "canceled" },
    { key: "ATC-7", stateType: "unstarted" },
  ];
  assert.deepEqual(chatCreateMisfiresOf(lines, tickets, Date.parse("2026-10-04T00:00:00Z")), { released: 6, misfires: ["ATC-1", "ATC-2", "ATC-5", "ATC-7"] });
  assert.deepEqual(chatCreateMisfiresOf(lines, tickets, Date.parse("2026-10-20T00:00:00Z")), { released: 0, misfires: [] }, "7일이 지나면 세지 않는다");
});

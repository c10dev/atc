import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Hono } from "hono";
import {
  bound,
  clearanceHeadOf,
  contentHashOf,
  parseReadbackHashSwitch,
  quotedHashOf,
  readbackHashCounterOf,
  readbackHashWhy,
  readbackLineOf,
  sealWorkOrder,
  WO_SLOT,
  workOrderHashIn,
  workOrderHashOf,
  workOrderSealOk,
} from "./input-binding.ts";
import { config } from "./config.ts";
import type { Snapshot } from "./model.ts";

// ATC-555(WO-23): FLIGHT PLAN의 work-order 해시, READBACK이 인용하는 해시, 기록 줄의 입력 해시. 상태는 test-hermetic의 임시 폴더만 쓴다
const DRAFT = `[DISPATCH D-0123] FLIGHT PLAN ${WO_SLOT} · GOLF (TEAM_G)\nFLIGHT ATC200\nGoal: tidy the button\n— Reply to this message with "READBACK D-0123 ${WO_SLOT}" if you take it.`;

test("seal: the header and the reply line carry the same hash, and the stored text hashes back to it", () => {
  const { text, hash } = sealWorkOrder(DRAFT);
  assert.match(hash, /^[0-9a-f]{6}$/);
  assert.ok(text.startsWith(`[DISPATCH D-0123] FLIGHT PLAN @${hash} · GOLF (TEAM_G)\n`));
  assert.ok(text.includes(`"READBACK D-0123 @${hash}"`));
  assert.ok(!text.includes(WO_SLOT));
  assert.equal(workOrderHashIn(text), hash);
  assert.equal(workOrderHashOf(text), hash);
  assert.equal(workOrderSealOk(text), true);
  assert.equal(sealWorkOrder(DRAFT).hash, hash); // 같은 글이면 같은 해시
});

test("seal: any one-character edit of the stored text breaks it; an old FLIGHT PLAN without a hash is not checked", () => {
  const { text, hash } = sealWorkOrder(DRAFT);
  const edited = text.replace("tidy the button", "tidy the buttons");
  assert.equal(workOrderHashIn(edited), hash);
  assert.notEqual(workOrderHashOf(edited), hash);
  assert.equal(workOrderSealOk(edited), false);
  const forged = text.replace(`@${hash}`, "@000000");
  assert.equal(workOrderSealOk(forged), false);
  const old = '[DISPATCH D-0007] FLIGHT PLAN · BRAVO (TEAM_B)\nFLIGHT VOC193\n— Reply to this message with "READBACK D-0007" if you take it.';
  assert.equal(workOrderHashIn(old), null);
  assert.equal(workOrderSealOk(old), null);
  assert.equal(workOrderHashIn(null), null);
  // RECALL 머리에는 해시가 없다
  assert.equal(workOrderHashIn("[DISPATCH D-0123] RECALL · GOLF (TEAM_G)"), null);
});

test("quoted hash: @hash, bare hash, or the whole reply line; anything else is none", () => {
  assert.equal(quotedHashOf("@a1b2c3"), "a1b2c3");
  assert.equal(quotedHashOf("A1B2C3"), "a1b2c3");
  assert.equal(quotedHashOf('READBACK D-0123 @a1b2c3'), "a1b2c3");
  assert.equal(quotedHashOf('"READBACK D-0123 @a1b2c3"'), "a1b2c3");
  for (const v of [undefined, null, 7, "", "READBACK D-0123", "@a1b2c", "@a1b2c3d", "a1b2cz"]) assert.equal(quotedHashOf(v), null, String(v));
});

test("READBACK check: the right hash passes, a missing or wrong one is refused with the exact reply line, an old plan passes", () => {
  const { text, hash } = sealWorkOrder(DRAFT);
  assert.equal(readbackHashWhy("D-0123", text, hash), null);
  const missing = readbackHashWhy("D-0123", text, null)!;
  assert.equal(missing.reason, "missing");
  assert.equal(missing.expected, hash);
  assert.ok(missing.why.includes(`quote the work-order hash @${hash}`));
  assert.ok(missing.why.includes(`"${readbackLineOf("D-0123", hash)}"`));
  const wrong = readbackHashWhy("D-0123", text, "000000")!;
  assert.equal(wrong.reason, "mismatch");
  assert.match(wrong.why, /quoted @000000/);
  assert.equal(readbackHashWhy("D-0007", "[DISPATCH D-0007] FLIGHT PLAN · BRAVO (TEAM_B)\nx", null), null);
});

test("weekly counter and switch parse", () => {
  const now = Date.parse("2026-10-07T00:00:00Z");
  const e = (days: number, reason: "missing" | "mismatch") => ({ t: new Date(now - days * 86_400_000).toISOString(), id: "D-1", flight: "ATC-1", reason, quoted: null, expected: "a1b2c3" });
  assert.deepEqual(readbackHashCounterOf([e(1, "missing"), e(2, "mismatch"), e(9, "missing")], now, 7), { refused: 2, missing: 1, mismatch: 1, days: 7 });
  assert.equal(parseReadbackHashSwitch("off"), "off");
  for (const v of ["on", undefined, "x"]) assert.equal(parseReadbackHashSwitch(v), "on");
});

test("content hash: key order does not matter, values do; bound adds only fields that exist", () => {
  assert.equal(contentHashOf({ a: 1, b: [1, { c: 2, d: 3 }] }), contentHashOf({ b: [1, { d: 3, c: 2 }], a: 1 }));
  assert.notEqual(contentHashOf({ a: 1 }), contentHashOf({ a: 2 }));
  assert.equal(contentHashOf({ a: 1, b: undefined }), contentHashOf({ a: 1 }));
  assert.match(contentHashOf("x"), /^[0-9a-f]{16}$/);
  assert.deepEqual(bound({ op: "x" }, null, null), { op: "x" });
  assert.deepEqual(bound({ op: "x" }, "h", "ATC-1@t"), { op: "x", hash: "h", release: "ATC-1@t" });
});

test("clearance head: head in the text, then the one #PR, then the STAND's PR; otherwise none", () => {
  const pulls = [
    { number: 10, head: "abc1234def5678abc1234def5678abc1234def56", standPath: "/w/a" },
    { number: 11, head: "1111111222222233333334444444555555566666", standPath: "/w/b" },
  ];
  assert.equal(clearanceHeadOf("FIX ... head abc1234", null, pulls), pulls[0]!.head); // 짧은 head는 PR의 전체 sha로
  assert.equal(clearanceHeadOf("FIX ... head deadbee", null, pulls), "deadbee"); // 모르는 head는 글 그대로
  assert.equal(clearanceHeadOf("LAND PR #11 now", null, pulls), pulls[1]!.head);
  assert.equal(clearanceHeadOf("PR #10 and #11", "/w/b", pulls), pulls[1]!.head); // PR이 둘이면 STAND로
  assert.equal(clearanceHeadOf("hold", "/w/a", pulls), pulls[0]!.head);
  assert.equal(clearanceHeadOf("hold", null, pulls), null);
  assert.equal(clearanceHeadOf("PR #99", "/w/zzz", pulls), null);
});

test("record binding: proposal create, verdict and send lines get the input hash and the release id; old lines fold as before", async () => {
  const { bindProposalOps, fold, proposalInputHashOf } = await import("./proposals.ts");
  const create = { op: "create" as const, id: "D-0001", at: "2026-10-07T00:00:00Z", kind: "ASSIGN" as const, flight: "ATC-1", aircraft: "s1", aircraftName: "TEAM_G", registration: "TEAM_G", airport: "ATCC", score: 1, factors: [] };
  const { text, hash } = sealWorkOrder(DRAFT);
  const rel = (f: string | null | undefined) => (f === "ATC-1" ? "ATC-1@2026-10-06T00:00:00Z" : null);
  const out = bindProposalOps([create, { op: "approve", id: "D-0001", at: "t" }, { op: "send", id: "D-0001", at: "t", message: text }, { op: "standby", id: "D-0001", at: "t" }], () => undefined, rel);
  const h = proposalInputHashOf(create);
  assert.equal((out[0] as { hash?: string }).hash, h);
  assert.equal((out[0] as { release?: string }).release, "ATC-1@2026-10-06T00:00:00Z");
  assert.equal((out[1] as { hash?: string }).hash, h); // 승인은 본 카드의 해시
  assert.equal((out[2] as { hash?: string }).hash, hash); // send는 work-order 해시
  assert.deepEqual(out[3], { op: "standby", id: "D-0001", at: "t" }); // 나머지 줄은 그대로
  // 접은 제안에는 hash·release가 들어가지 않는다 — 옛 줄과 새 줄이 같은 모양으로 접힌다
  const [p] = fold(out);
  assert.equal("hash" in p!, false);
  assert.equal("release" in p!, false);
  assert.equal(proposalInputHashOf(p!), h); // 접은 제안에서 다시 계산해도 같다
  assert.deepEqual(fold([create]), fold([out[0]!]));
});

test("record binding: SCHEDULE drafts and FLEET PLAN proposals", async () => {
  const { bindScheduleLines, scheduleInputHashOf } = await import("./schedule.ts");
  const draft = { op: "draft" as const, id: "S-0001", at: "t", kind: "CLASSIFY" as const, flight: "ATC-2", payload: { type: "BUILD" } as never, reason: "r" };
  const lines = bindScheduleLines([draft, { op: "approve", id: "S-0001", at: "t" }, { op: "apply", id: "S-0001", at: "t", ref: "x" }], () => undefined, () => "ATC-2@r");
  assert.equal((lines[0] as { hash?: string }).hash, scheduleInputHashOf(draft));
  assert.equal((lines[1] as { hash?: string }).hash, scheduleInputHashOf(draft));
  assert.equal((lines[1] as { release?: string }).release, "ATC-2@r");
  assert.deepEqual(lines[2], { op: "apply", id: "S-0001", at: "t", ref: "x" });
  const { bindFleetPlanOps, fleetInputHashOf, foldFleetPlan } = await import("./fleet-plan.ts");
  const fc = { op: "create" as const, id: "F-0001", key: "k", kind: "STOP" as const, aircraft: "TEAM_G", airport: null, reasons: [], at: "t" };
  const fops = bindFleetPlanOps([fc, { op: "verdict", id: "F-0001", verdict: "agree", by: "SUPERVISOR", at: "t" }], () => undefined);
  assert.equal((fops[0] as { hash?: string }).hash, fleetInputHashOf(fc));
  assert.equal((fops[1] as { hash?: string }).hash, fleetInputHashOf(fc));
  assert.equal("hash" in foldFleetPlan(fops)[0]!, false);
});

test("accept route: READBACK must quote the hash of a hashed FLIGHT PLAN; an old plan and the off switch pass; refusals are counted", async () => {
  const dir = config.stateDir;
  mkdirSync(dir, { recursive: true });
  const { text, hash } = sealWorkOrder(DRAFT);
  const at = new Date().toISOString();
  const create = (id: string, flight: string) => ({ op: "create", id, at, kind: "ASSIGN", flight, aircraft: "s1", aircraftName: "TEAM_G", registration: "TEAM_G", airport: "ATCC", score: 1, factors: [] });
  const ops = [
    create("D-0123", "ATC-200"),
    { op: "approve", id: "D-0123", at },
    { op: "send", id: "D-0123", at, message: text },
    create("D-0124", "ATC-201"),
    { op: "approve", id: "D-0124", at },
    { op: "send", id: "D-0124", at, message: '[DISPATCH D-0124] FLIGHT PLAN · GOLF (TEAM_G)\nold text' },
  ];
  writeFileSync(join(dir, "proposals.jsonl"), ops.map((o) => JSON.stringify(o)).join("\n") + "\n");
  const { mountDispatch } = await import("./proposals.ts");
  const app = new Hono();
  const snap = { tickets: [], workspaces: [], sessions: [], pulls: [], airports: [] } as unknown as Snapshot;
  mountDispatch(app, async () => snap, undefined, undefined, undefined, undefined, (() => []) as never);
  const post = (id: string, body?: unknown) => app.request(`/api/dispatch/proposals/${id}/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });

  const none = await post("D-0123");
  assert.equal(none.status, 409);
  assert.ok(((await none.json()) as { error: string }).error.includes(`"READBACK D-0123 @${hash}"`));
  const wrong = await post("D-0123", { hash: "000000" });
  assert.equal(wrong.status, 409);
  const ok = await post("D-0123", { hash: `@${hash}` });
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { proposal: { status: string } }).proposal.status, "accepted");
  // 해시 전의 옛 FLIGHT PLAN: 전처럼 받는다
  assert.equal((await post("D-0124")).status, 200);

  const events = readFileSync(join(dir, "readback-hash-events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(events.map((e) => [e.id, e.reason, e.quoted, e.expected]), [["D-0123", "missing", null, hash], ["D-0123", "mismatch", "000000", hash]]);

  // 스위치 off: 해시 없는 READBACK도 받는다(새 제안으로)
  const { saveReadbackHashSwitch, readbackHashData } = await import("./input-binding-run.ts");
  assert.equal(readbackHashData().refused, 2);
  writeFileSync(join(dir, "proposals.jsonl"), [create("D-0125", "ATC-202"), { op: "approve", id: "D-0125", at }, { op: "send", id: "D-0125", at, message: sealWorkOrder(DRAFT.replaceAll("D-0123", "D-0125")).text }].map((o) => JSON.stringify(o)).join("\n") + "\n", { flag: "a" });
  saveReadbackHashSwitch("off", "SUPERVISOR", join(dir, "readback-hash.json"));
  assert.equal((await post("D-0125")).status, 200);
  assert.equal(readbackHashData().refused, 2);

  // 새 줄에는 입력 묶기 칸이 붙는다: accept 줄은 그대로, 앞의 create·send 줄(손으로 쓴 옛 줄)도 그대로
  const lines = readFileSync(join(dir, "proposals.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(lines[0].hash, undefined);
  assert.deepEqual(Object.keys(lines.find((l) => l.op === "accept")).sort(), ["at", "id", "op"]);
});

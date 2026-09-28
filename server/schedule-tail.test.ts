import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ticket } from "./model.ts";
import { callsOf, candidatesOf, changesOf, draftOps, fold, gateOf, type ScheduleOp, ScheduleError, syncLines } from "./schedule.ts";
import { parseTail, type TailCtx, tailCautionOf, tailLabelsOf, type TailSignalInput, tailSignalsOf } from "./schedule-tail.ts";
import { labelSetOf } from "./sources/linear-labels.ts";

const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const t = (key: string, over: Partial<Ticket> = {}) =>
  ({ key, title: key, state: "In Progress", stateType: "started", labels: [], priority: 3, project: "Beta Readiness", url: null, ...over }) as Ticket;

const PATTERN = "^TEAM[\\s_-]?[A-Z]$";
const ctx: TailCtx = {
  teamPattern: PATTERN,
  fleet: [
    { registration: "TEAM_A", retired: false },
    { registration: "TEAM_E", retired: false },
    { registration: "TEAM_J", retired: false },
    { registration: "TEAM_Z", retired: true },
    { registration: "TEAM_K", retired: false },
  ],
  tailLabels: labelSetOf(["tail:TEAM_A", "tail:TEAM_E", "tail:TEAM_J", "tail:TEAM_Z"]),
};
const view = (registration: string, over: Partial<{ status: "busy" | "idle" | "dead" | "absent"; flying: string[] }> = {}) => ({
  registration,
  retired: null,
  aog: null,
  status: "idle" as const,
  flying: [] as string[],
  ...over,
});

test("TAIL 입력 검사: teamPattern, FLEET, RETIRED, Linear 라벨, 이미 붙은 tail:", () => {
  const f = t("VOC-196");
  assert.equal(parseTail({ registration: "team_e" }, f, ctx), "TEAM_E");
  assert.equal(parseTail({ registration: "tail:TEAM_E" }, f, ctx), "TEAM_E");
  assert.throws(() => parseTail({}, f, ctx), /REGISTRATION이 필요함/);
  assert.throws(() => parseTail({ registration: "OCC" }, f, ctx), /teamPattern/);
  assert.throws(() => parseTail({ registration: "TEAM_Q" }, f, ctx), /FLEET에 없음/);
  assert.throws(() => parseTail({ registration: "TEAM_Z" }, f, ctx), /RETIRED/);
  // FLEET에 있지만 Linear 라벨이 없다: 사유가 ENGINEERING이나 사용자가 만든다고 말한다
  assert.throws(() => parseTail({ registration: "TEAM_K" }, f, ctx), /tail:TEAM_K 라벨이 없음 — ENGINEERING이나 사용자가/);
  assert.throws(() => parseTail({ registration: "TEAM_E" }, f, { ...ctx, tailLabels: null }), (e: Error & { status?: number }) => /라벨 목록을 아직 읽지 못함/.test(e.message) && e.status === 503);
  assert.throws(() => parseTail({ registration: "TEAM_E" }, t("VOC-196", { labels: ["tail:TEAM_E"] }), ctx), /이미 tail:TEAM_E가 있음/);
});

test("발부 뒤 라벨: 없음, 같음, 다른 tail: 바꿈, lane: 별칭은 그대로", () => {
  assert.deepEqual(tailLabelsOf([], "TEAM_J"), ["tail:TEAM_J"]);
  assert.deepEqual(tailLabelsOf(["type:BUILD", "tail:TEAM_J"], "TEAM_J"), ["type:BUILD", "tail:TEAM_J"]);
  assert.deepEqual(tailLabelsOf(["type:BUILD", "tail:TEAM_A", "rating:UI"], "TEAM_J"), ["type:BUILD", "rating:UI", "tail:TEAM_J"]);
  assert.deepEqual(tailLabelsOf(["lane:TEAM_A", "wake:M"], "TEAM_J"), ["lane:TEAM_A", "wake:M", "tail:TEAM_J"]);
  assert.deepEqual(changesOf("TAIL", { registration: "TEAM_J" }, t("VOC-1", { labels: ["tail:TEAM_A"] })), ["+ tail:TEAM_J", "− tail:TEAM_A"]);
  assert.deepEqual(changesOf("TAIL", { registration: "TEAM_J" }, t("VOC-1", { labels: ["tail:team_j"] })), []);
});

test("TAIL 발부 호출: save_issue 하나(라벨만)와 근거 댓글, 상태·담당은 없음", () => {
  const base = { at: iso(10), status: "approved" as const, statusAt: iso(5), verdictReason: null, calls: null, appliedRef: null, decision: null, crosscheck: null, reason: "SUPERVISOR 지시" };
  const op: ScheduleOp = { ...base, id: "S-0007", kind: "TAIL", flight: "VOC-196", payload: { registration: "TEAM_J" } };
  const none = callsOf(op, t("VOC-196", { labels: ["type:BUILD"] }), "Vocado");
  assert.deepEqual(none[0], { tool: "save_issue", input: { id: "VOC-196", addLabels: ["tail:TEAM_J"] } });
  const other = callsOf(op, t("VOC-196", { labels: ["type:BUILD", "tail:TEAM_A", "lane:TEAM_B"] }), "Vocado");
  assert.deepEqual(other[0], { tool: "save_issue", input: { id: "VOC-196", addLabels: ["tail:TEAM_J"], removeLabels: ["tail:TEAM_A"] } });
  assert.equal(other.filter((c) => c.tool === "save_issue").length, 1);
  assert.equal(other[1].tool, "save_comment");
  assert.match(String(other[1].input.body), /^\[OCC S-0007\] TAIL ASSIGNMENT tail:TEAM_J \(tail:TEAM_A 대신\) — 근거: SUPERVISOR 지시/);
  for (const c of other) for (const k of ["state", "assignee", "delegate", "labels"]) assert.equal(k in c.input, false);
});

test("CAUTION: 다른 팀의 tail:을 그 팀이 AIRBORNE이거나 STAND를 쥔 채 바꿀 때만", () => {
  const f = t("VOC-196", { labels: ["tail:TEAM_A"] });
  assert.match(tailCautionOf(f, "TEAM_J", [view("TEAM_A", { status: "busy" })])!, /TEAM_A가 AIRBORNE/);
  assert.match(tailCautionOf(f, "TEAM_J", [view("TEAM_A", { flying: ["VOC-196"] })])!, /VOC-196의 STAND를 쥠/);
  assert.equal(tailCautionOf(f, "TEAM_J", [view("TEAM_A")]), null); // PARKED
  assert.equal(tailCautionOf(t("VOC-196"), "TEAM_J", [view("TEAM_A", { status: "busy" })]), null); // tail: 없음
  assert.equal(tailCautionOf(t("VOC-196", { labels: ["lane:TEAM_A"] }), "TEAM_J", [view("TEAM_A", { status: "busy" })]), null); // lane:은 바꾸지 않는다
  // 초안 payload에 실린다
  const lines = draftOps([], { kind: "TAIL", flight: "VOC-196", registration: "TEAM_J", reason: "CHARTER DESK" }, [f], iso(0), 0, { tail: { ...ctx, views: [view("TEAM_A", { status: "busy" })] } });
  assert.match(String((fold(lines)[0].payload as { caution?: string }).caution), /AIRBORNE/);
});

test("TAIL 초안: In Progress도 되고, 닫힌 FLIGHT·근거 없음은 거절, 판정은 S2 게이트에 센다", () => {
  const tickets = [t("VOC-1"), t("VOC-2", { state: "Done", stateType: "completed" })];
  const c = { tail: { ...ctx, views: [] } };
  const first = draftOps([], { kind: "TAIL", flight: "voc-1", registration: "TEAM_J", reason: "STAND" }, tickets, iso(10), 0, c);
  assert.deepEqual(fold(first)[0].payload, { registration: "TEAM_J" });
  assert.equal(fold(first)[0].flight, "VOC-1");
  // 같은 FLIGHT의 새 TAIL 초안은 앞의 것을 대신한다
  const second = draftOps(fold(first), { kind: "TAIL", flight: "VOC-1", registration: "TEAM_E", reason: "SUPERVISOR" }, tickets, iso(5), 1, c);
  assert.deepEqual(second.map((l) => `${l.op}:${l.id}`), ["supersede:S-0001", "draft:S-0002"]);
  assert.throws(() => draftOps([], { kind: "TAIL", flight: "VOC-2", registration: "TEAM_J", reason: "x" }, tickets, iso(0), 0, c), /이미 닫힘/);
  assert.throws(() => draftOps([], { kind: "TAIL", flight: "VOC-1", registration: "TEAM_J", reason: " " }, tickets, iso(0), 0, c), /근거/);
  assert.throws(() => draftOps([], { kind: "TAIL", flight: "VOC-1", registration: "TEAM_J", reason: "x" }, tickets, iso(0), 0), (e) => e instanceof ScheduleError && e.status === 503);
  const agreed = fold([...first, { op: "verdict", id: "S-0001", at: iso(1), verdict: "agree", reason: null }]);
  assert.equal(gateOf(agreed).decided, 1);
});

test("TAIL APPLIED: 발부 뒤 그 tail:이 보이면 APPLIED, 닫히면 SUPERSEDED", () => {
  const draft = { op: "draft" as const, id: "S-0001", at: iso(30), kind: "TAIL" as const, flight: "VOC-1", payload: { registration: "TEAM_J" }, reason: "x" };
  const released = [draft, { op: "approve" as const, id: "S-0001", at: iso(20) }, { op: "release" as const, id: "S-0001", at: iso(10), calls: [] }];
  assert.deepEqual(syncLines(fold(released), [t("VOC-1", { labels: ["tail:TEAM_J", "type:BUILD"] })], NOW), [{ op: "apply", id: "S-0001", at: iso(0), ref: "VOC-1" }]);
  assert.deepEqual(syncLines(fold(released), [t("VOC-1", { labels: ["tail:TEAM_A"] })], NOW), []);
  assert.equal(syncLines(fold([draft]), [t("VOC-1", { state: "Canceled", stateType: "canceled" })], NOW)[0].op, "supersede");
  // In Progress인 열린 초안은 계획 단계가 아니어도 그대로 둔다
  assert.deepEqual(syncLines(fold([draft]), [t("VOC-1")], NOW), []);
});

const sig = (over: Partial<TailSignalInput> = {}): TailSignalInput => ({
  tickets: [t("VOC-1"), t("VOC-2"), t("VOC-3"), t("VOC-4", { labels: ["tail:TEAM_E"] }), t("VOC-5", { stateType: "completed" })],
  views: [],
  departures: [],
  proposals: [],
  clearances: [],
  fleet: ctx.fleet,
  teamPattern: PATTERN,
  now: NOW,
  ...over,
});

test("TAIL 신호: STAND, DEPARTURE LOG, READBACK(DISPATCH·CLEARANCE)마다 근거가 붙는다", () => {
  const stand = tailSignalsOf(sig({ views: [{ registration: "TEAM_J", flying: ["VOC-1"], flyingSince: iso(40) }] }));
  assert.deepEqual(stand, [{ flight: "VOC-1", registration: "TEAM_J", evidence: [{ source: "STAND", at: iso(40), detail: "TEAM_J가 STAND를 쥐고 있음" }] }]);

  // DEPARTURE LOG: FLIGHT의 마지막 AIRCRAFT(HANDOFF 뒤는 이어받은 쪽), 7일 지난 줄은 보지 않음
  const dep = tailSignalsOf(
    sig({
      departures: [
        { t: iso(120), flight: "VOC-2", aircraft: "TEAM_A", stand: "/w/voc-2", via: "claim" },
        { t: iso(60), flight: "VOC-2", aircraft: "TEAM_E", stand: "/w/voc-2", via: "handoff" },
        { t: iso(8 * 24 * 60), flight: "VOC-3", aircraft: "TEAM_A", stand: "/w/voc-3", via: "claim" },
      ],
    }),
  );
  assert.deepEqual(dep, [{ flight: "VOC-2", registration: "TEAM_E", evidence: [{ source: "DEPARTURE LOG", at: iso(60), detail: "handoff /w/voc-2" }] }]);

  const rb = tailSignalsOf(
    sig({
      proposals: [
        { id: "D-0010", kind: "ASSIGN", flight: "VOC-3", aircraftName: "TEAM_A", status: "accepted", statusAt: iso(30), timeline: { accepted: iso(30) } },
        { id: "D-0011", kind: "ASSIGN", flight: "VOC-2", aircraftName: "TEAM_E", status: "recalling", statusAt: iso(30), timeline: {} },
        { id: "D-0012", kind: "ASSIGN", flight: "VOC-1", aircraftName: "TEAM_J", status: "sent", statusAt: iso(30), timeline: {} },
      ],
      clearances: [
        { id: "C-0100", flight: "VOC-1", toName: "TEAM_J", readbackAt: iso(5), cancelledAt: null },
        { id: "C-0101", flight: "VOC-2", toName: "TEAM_E", readbackAt: null, cancelledAt: null },
      ],
    }),
  );
  assert.deepEqual(
    rb.map((x) => [x.flight, x.registration, x.evidence.map((e) => e.detail).join()]),
    [
      ["VOC-1", "TEAM_J", "CLEARANCE C-0100"],
      ["VOC-3", "TEAM_A", "DISPATCH D-0010 (accepted)"],
    ],
  );
});

test("TAIL 신호: tail:이 있거나 닫힌 FLIGHT, FLEET 밖·RETIRED·teamPattern 밖 세션은 없음", () => {
  const out = tailSignalsOf(
    sig({
      views: [
        { registration: "TEAM_E", flying: ["VOC-4"], flyingSince: iso(10) }, // 이미 tail:
        { registration: "TEAM_A", flying: ["VOC-5"], flyingSince: iso(10) }, // 닫힘
        { registration: "TEAM_Z", flying: ["VOC-1"], flyingSince: iso(10) }, // RETIRED
        { registration: "TEAM_Q", flying: ["VOC-2"], flyingSince: iso(10) }, // FLEET 밖
        { registration: "OCC", flying: ["VOC-3"], flyingSince: iso(10) }, // teamPattern 밖
      ],
    }),
  );
  assert.deepEqual(out, []);
  // lane:만 붙은 FLIGHT는 tail:이 없으므로 신호가 난다(tail:로 옮길 대상)
  const lane = tailSignalsOf(sig({ tickets: [t("VOC-6", { labels: ["lane:TEAM_A"] })], views: [{ registration: "TEAM_A", flying: ["VOC-6"], flyingSince: null }] }));
  assert.equal(lane.length, 1);
});

test("TAIL 후보: 신호는 candidates.tail로만 나오고, 열린 TAIL 작업이 있는 FLIGHT는 뺀다", () => {
  const signals = [
    { flight: "VOC-1", registration: "TEAM_J", evidence: [] },
    { flight: "VOC-2", registration: "TEAM_E", evidence: [] },
  ];
  const ops = fold([{ op: "draft", id: "S-0001", at: iso(5), kind: "TAIL", flight: "VOC-2", payload: { registration: "TEAM_E" }, reason: "x" }]);
  assert.deepEqual(candidatesOf([], ops, new Map(), NOW, signals).tail.map((x) => x.flight), ["VOC-1"]);
});

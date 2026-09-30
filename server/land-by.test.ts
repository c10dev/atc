import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBrief, landTextOf } from "./controller.ts";
import { landByOf, type MccLandInfo } from "./land-by.ts";
import type { PullRequest, Snapshot } from "./model.ts";

// 누가 착륙시키나(ATC-151). MCC AIRPORT(ATCC)의 PR만 바뀌고 다른 AIRPORT(VCDO)는 옛 LAND 흐름 그대로다.
const ATC = "/home/c10/projects/atc";
const VCDO = "/home/c10/projects/vocado_nextjs";
const WT = "/home/c10/projects/worktrees";
const T0 = Date.parse("2026-09-29T07:00:00.000Z");
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();

const pr = (repo: string, number: number, over: Partial<PullRequest> = {}): PullRequest => ({
  repo, number, title: `PR ${number}`, url: `https://github.com/o/r/pull/${number}`, branch: `claude/atc-${number}`,
  head: `head${number}abcdef`, base: "main", ticketKey: `ATC-${number}`, standPath: `${WT}/atc-${number}`, draft: false,
  landing: "CLEARED", blocks: [], readyAt: iso(-10 + number), createdAt: iso(-100 + number), ...over,
});
const info = (over: Partial<MccLandInfo> = {}, tiers: Record<number, "auto" | "flagged" | "user"> = {}): MccLandInfo => ({
  repo: ATC, mode: "land+rts", holds: [], escalated: [],
  tiers: new Map(Object.entries(tiers).map(([n, tier]) => [Number(n), { head: `head${n}abcdef`, tier }])),
  ...over,
});
const by = (n: number, m: MccLandInfo | null, repo = ATC) => landByOf(pr(repo, n), m);

test("landBy: ATCC land+rts는 auto·flagged가 mcc, user가 supervisor", () => {
  const m = info({}, { 1: "auto", 2: "flagged", 3: "user" });
  assert.deepEqual([by(1, m), by(2, m), by(3, m)], ["mcc", "mcc", "supervisor"]);
  assert.equal(by(1, info({ mode: "land" }, { 1: "auto" })), "mcc");
});

test("landBy: ATCC shadow와 rts(MCC가 착륙시키지 않는 모드)는 supervisor", () => {
  assert.equal(by(1, info({ mode: "shadow" }, { 1: "auto" })), "supervisor");
  assert.equal(by(1, info({ mode: "rts" }, { 1: "auto" })), "supervisor");
});

test("landBy: ESCALATE와 HOLD가 붙은 PR은 supervisor", () => {
  const m = info({ escalated: [1], holds: [2] }, { 1: "auto", 2: "auto", 3: "auto" });
  assert.deepEqual([by(1, m), by(2, m), by(3, m)], ["supervisor", "supervisor", "mcc"]);
});

test("landBy: 등급을 모르거나(아직 안 읽음) 옛 head의 등급이면 supervisor, holder로 새지 않는다", () => {
  assert.equal(by(1, info({}, {})), "supervisor");
  const stale: MccLandInfo = info({ tiers: new Map([[1, { head: "oldhead", tier: "auto" }]]) });
  assert.equal(by(1, stale), "supervisor");
});

test("landBy: 다른 AIRPORT(VCDO)는 어떤 모드·등급이든 holder, MCC 자료가 없으면 모두 holder", () => {
  for (const mode of ["shadow", "land", "land+rts", "rts"] as const) assert.equal(by(1, info({ mode }, { 1: "user" }), VCDO), "holder", mode);
  assert.equal(by(1, null), "holder");
  assert.equal(by(1, null, VCDO), "holder");
});

test("브리핑: landText는 holder에만, landBy는 모든 항목에, repoSeq와 seq는 landBy와 상관없이 그대로", () => {
  const s = {
    at: iso(0), linear: { enabled: true, error: null, fetchedAt: iso(0) }, github: { enabled: true, error: null, fetchedAt: iso(0) },
    atfm: { mains: [], groundStops: [] },
    airports: [{ id: "1", repo: ATC, name: "atc", code: "ATCC" }, { id: "2", repo: VCDO, name: "vocado_nextjs", code: "VCDO" }],
    pulls: [pr(ATC, 1), pr(VCDO, 5), pr(ATC, 2), pr(ATC, 3), pr(ATC, 4, { landing: "APPROACH", readyAt: null, blocks: [{ code: "behind", text: "behind", en: "behind" }] })],
    sessions: [], workspaces: [], tickets: [], columns: [], claims: [], handoffs: [], alerts: [], clearances: [],
  } as unknown as Snapshot;
  const brief = (m: MccLandInfo | null) => buildBrief(s, { events: [], reset: false, cursor: "e:0" }, [], T0, undefined, null, m).landingQueue;
  const seqs = (q: ReturnType<typeof brief>) => q.map((x) => [x.pr.number, x.seq, x.repoSeq]);

  const before = brief(null); // MCC 자료 없음 = 옛 동작
  assert.ok(before.every((x) => x.landBy === "holder"));
  assert.equal(before.find((x) => x.pr.number === 1)!.landText, landTextOf(1, "ATCC", 1, "ATC1", null));

  const q = brief(info({ holds: [3] }, { 1: "auto", 2: "user", 3: "flagged", 4: "auto" }));
  const at = (n: number) => q.find((x) => x.pr.number === n)!;
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => at(n).landBy), ["mcc", "supervisor", "supervisor", "mcc", "holder"]);
  assert.deepEqual([1, 2, 3].map((n) => at(n).landText), [null, null, null]);
  assert.equal(at(5).landText, landTextOf(1, "VCDO", 5, "ATC5", null)); // VCDO는 그대로
  assert.deepEqual(seqs(q), seqs(before)); // 순서는 MCC에도 뜻이 있어 그대로
  assert.deepEqual(q.map((x) => x.goAround), before.map((x) => x.goAround)); // GO AROUND는 landBy와 무관
});

// teamsMerge(ATC-154): "팀은 여기서 머지하지 않는다"로 표시한 AIRPORT는 등급과 상관없이 supervisor, 기본값과 ATCC는 그대로
test("landBy: teamsMerge false는 등급과 상관없이 supervisor, 기본(true)은 holder 그대로, ATCC는 ATC-151 규칙 그대로", () => {
  const APP = "/home/c10/projects/atc-app";
  assert.equal(landByOf(pr(APP, 1), null, false), "supervisor");
  assert.equal(landByOf(pr(APP, 1), info({}, { 1: "auto" }), false), "supervisor"); // MCC 자료가 있어도(다른 저장소)
  assert.equal(landByOf(pr(APP, 1), null), "holder");
  assert.equal(landByOf(pr(APP, 1), null, true), "holder");
  // ATCC: teamsMerge 인자와 상관없이 ATC-151 규칙(mcc/supervisor)
  const m = info({}, { 1: "auto", 2: "user" });
  assert.deepEqual([landByOf(pr(ATC, 1), m, true), landByOf(pr(ATC, 2), m, true)], ["mcc", "supervisor"]);
  assert.equal(landByOf(pr(ATC, 1), m, false), "mcc");
});

test("브리핑: airports의 teamsMerge false인 AIRPORT만 supervisor이고 landText가 null, 다른 AIRPORT는 그대로", () => {
  const APP = "/home/c10/projects/atc-app";
  const s = {
    at: iso(0), linear: { enabled: true, error: null, fetchedAt: iso(0) }, github: { enabled: true, error: null, fetchedAt: iso(0) },
    atfm: { mains: [], groundStops: [] },
    airports: [{ id: "1", repo: APP, name: "atc-app", code: "ATAP", teamsMerge: false }, { id: "2", repo: VCDO, name: "vocado_nextjs", code: "VCDO" }],
    pulls: [pr(APP, 1), pr(VCDO, 5), pr(APP, 2)],
    sessions: [], workspaces: [], tickets: [], columns: [], claims: [], handoffs: [], alerts: [], clearances: [],
  } as unknown as Snapshot;
  const q = buildBrief(s, { events: [], reset: false, cursor: "e:0" }, [], T0).landingQueue;
  const at = (n: number) => q.find((x) => x.pr.number === n)!;
  assert.deepEqual([1, 2, 5].map((n) => at(n).landBy), ["supervisor", "supervisor", "holder"]);
  assert.deepEqual([1, 2].map((n) => at(n).landText), [null, null]);
  assert.equal(at(5).landText, landTextOf(1, "VCDO", 5, "ATC5", null));
  assert.deepEqual([1, 5, 2].map((n) => [at(n).seq, at(n).repoSeq]), [[1, 1], [2, 1], [3, 2]]); // 순서는 그대로
});

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { MainStatus } from "./atfm.ts";
import {
  type AutolandConfig,
  type AutolandState,
  DEFAULT_AUTOLAND,
  EMPTY_STATE,
  humanPreviewOf,
  type InFlight,
  latchGroundStops,
  loadAutoland,
  mergeExclusionOf,
  type MergeExclusionInput,
  parseAutoland,
  planAutoland,
  saveAutoland,
  settleOf,
  writeResultOf,
} from "./autoland.ts";
import type { LandingBlockCode, PullRequest } from "./model.ts";
import { fromThisApp } from "./origin.ts";

const VCDO = "/p/vocado_nextjs";
const ATCC = "/p/atc";
const AIRPORTS = [
  { code: "VCDO", repo: VCDO },
  { code: "ATCC", repo: ATCC },
];
const sha = (n: number) => String(n).padStart(40, "a");

const pr = (number: number, blocks: LandingBlockCode[] = [], over: Partial<PullRequest> = {}): PullRequest => ({
  repo: VCDO,
  number,
  title: `PR ${number}`,
  url: `https://github.com/chaehy5665/vocado_nextjs/pull/${number}`,
  branch: `claude/voc-${number}`,
  head: sha(number),
  base: "main",
  ticketKey: `VOC-${number}`,
  standPath: null,
  draft: false,
  landing: blocks.length ? "APPROACH" : "CLEARED",
  blocks: blocks.map((code) => ({ code, text: code })),
  readyAt: blocks.length ? null : "2026-09-28T01:00:00Z",
  createdAt: `2026-09-2${number % 10}T00:00:00Z`,
  ...over,
});
const cfg = (over: Partial<AutolandConfig> = {}): AutolandConfig => ({ ...DEFAULT_AUTOLAND, mode: "update", ...over });
const st = (over: Partial<AutolandState> = {}): AutolandState => ({ ...structuredClone(EMPTY_STATE), ...over });
const plan = (c: AutolandConfig, pulls: PullRequest[], s = st(), exclusionOf: (p: PullRequest) => string | null = () => null) =>
  planAutoland({ cfg: c, airports: AIRPORTS, pulls, st: s, exclusionOf });
const vcdo = (v: ReturnType<typeof plan>) => v.airports.find((a) => a.airport === "VCDO")!;

// ── 스위치 ──

test("switch: default off, unknown values fall back to off", () => {
  assert.equal(parseAutoland({}).mode, "off");
  assert.equal(parseAutoland({ mode: "yolo" }).mode, "off");
  assert.equal(parseAutoland(null).mode, "off");
  assert.deepEqual(parseAutoland({}).airports, ["VCDO"]);
  assert.equal(parseAutoland({ mode: "merge", mergeMethod: "force" }).mergeMethod, "squash");
});

test("switch: save keeps other keys and round-trips", () => {
  const dir = mkdtempSync(join(tmpdir(), "autoland-"));
  const file = join(dir, "autoland.json");
  writeFileSync(file, JSON.stringify({ note: "SUPERVISOR", mode: "off" }));
  saveAutoland({ ...loadAutoland(file), mode: "update" }, file);
  assert.equal(loadAutoland(file).mode, "update");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).note, "SUPERVISOR");
  rmSync(dir, { recursive: true });
});

test("switch: only requests from this screen (Origin localhost + JSON) pass — atcctl sends no Origin", () => {
  const req = (h: Record<string, string>) => ({ req: { header: (k: string) => h[k.toLowerCase()] } }) as Parameters<typeof fromThisApp>[0];
  assert.equal(fromThisApp(req({ "content-type": "application/json", origin: "http://localhost:7700" })), true);
  assert.equal(fromThisApp(req({ "content-type": "application/json" })), false); // atcctl, curl without Origin
  assert.equal(fromThisApp(req({ "content-type": "application/json", origin: "https://evil.example" })), false);
  assert.equal(fromThisApp(req({ origin: "http://localhost:7700" })), false);
});

// ── update ──

test("off: plans nothing", () => {
  const v = plan(cfg({ mode: "off" }), [pr(1, ["behind"])]);
  assert.deepEqual(v.airports, []);
  assert.deepEqual(v.pulls, {});
});

test("update: only CLEARED-but-behind PRs, first in LANDING SEQUENCE order", () => {
  const pulls = [pr(3, ["checks-failed", "behind"]), pr(4, ["behind"]), pr(5, ["behind"]), pr(6, ["no-review"])];
  const v = plan(cfg(), pulls);
  assert.equal(vcdo(v).status, "update");
  assert.equal(vcdo(v).number, 4);
  assert.equal(vcdo(v).head, sha(4));
  assert.equal(vcdo(v).text, "AUTOLAND: updating #4");
  assert.equal(v.pulls[`${VCDO}#5`].kind, "queued");
  // behind이지만 CI 실패도 있음: 후보가 아니고 까닭을 보인다
  assert.deepEqual(v.pulls[`${VCDO}#3`], { kind: "waiting", text: "AUTOLAND 대기 — CI 실패 먼저" });
  assert.equal(v.pulls[`${VCDO}#6`], undefined);
});

test("update: draft, stacked, dirty and LOS PRs are never touched", () => {
  for (const [p, why] of [
    [pr(1, ["draft", "behind"], { draft: true }), "DRAFT"],
    [pr(2, ["stacked", "behind"]), "STACKED"],
    [pr(3, ["dirty"]), "DIRTY(충돌)"],
    [pr(4, ["behind", "los"]), "LOS"],
  ] as const) {
    const v = plan(cfg(), [p]);
    assert.notEqual(vcdo(v).status, "update", `#${p.number}`);
    if (why) assert.equal(v.pulls[`${VCDO}#${p.number}`].text, `AUTOLAND 제외 — ${why}`);
  }
});

test("update: one in flight per AIRPORT", () => {
  const f: InFlight = { airport: "VCDO", repo: VCDO, slug: "chaehy5665/vocado_nextjs", number: 4, fromHead: sha(4), at: "2026-09-28T01:00:00Z" };
  const v = plan(cfg(), [pr(4, ["checks-pending"], { head: sha(40) }), pr(5, ["behind"])], st({ inflight: [f] }));
  assert.equal(vcdo(v).status, "inflight");
  assert.equal(vcdo(v).text, "AUTOLAND: updating #4 — CI 대기");
  assert.equal(v.pulls[`${VCDO}#5`].kind, "queued");
});

test("update: a CLEARED PR on the runway waits for the SUPERVISOR's merge; HOLD frees the runway", () => {
  const pulls = [pr(2), pr(5, ["behind"])];
  assert.equal(vcdo(plan(cfg(), pulls)).status, "waiting");
  assert.equal(vcdo(plan(cfg(), pulls)).number, 2);
  const held = cfg({ holds: [{ repo: VCDO, number: 2, at: "x" }] });
  assert.equal(vcdo(plan(held, pulls)).status, "update");
  assert.equal(vcdo(plan(held, pulls)).number, 5);
});

test("update: head-moved rejection skips that head; the new head is retried next cycle", () => {
  const skipped = st({ skip: [`${VCDO}#4@${sha(4)}`] });
  // 같은 head: 건너뛰고 다음 PR
  assert.equal(vcdo(plan(cfg(), [pr(4, ["behind"]), pr(5, ["behind"])], skipped)).number, 5);
  // head가 움직인 다음 주기: 새 head로 다시 후보
  assert.equal(vcdo(plan(cfg(), [pr(4, ["behind"], { head: sha(44) }), pr(5, ["behind"])], skipped)).number, 4);
});

test("update: AIRPORTs not in the switch's list are untouched (atc's own landing is out of scope)", () => {
  const v = plan(cfg(), [pr(7, ["behind"], { repo: ATCC })]);
  assert.equal(v.airports.some((a) => a.airport === "ATCC"), false);
  assert.equal(v.pulls[`${ATCC}#7`], undefined);
});

test("head-moved rejection vs other failures", () => {
  assert.equal(writeResultOf("gh: expected head sha didn’t match current head ref. (HTTP 422)").result, "rejected");
  assert.equal(writeResultOf("gh: Head branch was modified. Review and try the merge again. (HTTP 409)").result, "rejected");
  assert.equal(writeResultOf("gh: merge conflict between base and head (HTTP 422)").result, "failed");
  assert.equal(writeResultOf("").detail, "알 수 없는 오류");
});

test("settle: an updated PR stays in flight until its new head's CI finishes", () => {
  const f: InFlight = { airport: "VCDO", repo: VCDO, slug: "o/r", number: 4, fromHead: sha(4), at: "2026-09-28T01:00:00Z" };
  const t = Date.parse(f.at);
  assert.equal(settleOf(f, pr(4, ["behind"]), t + 60_000), null); // head가 아직 안 바뀜
  assert.equal(settleOf(f, pr(4, ["behind"]), t + 11 * 60_000)?.result, "timeout");
  assert.equal(settleOf(f, pr(4, ["checks-pending"], { head: sha(40) }), t + 5 * 60_000), null);
  assert.equal(settleOf(f, pr(4, [], { head: sha(40) }), t + 8 * 60_000)?.result, "cleared");
  assert.equal(settleOf(f, pr(4, ["checks-failed"], { head: sha(40) }), t + 8 * 60_000)?.result, "blocked");
  assert.equal(settleOf(f, undefined, t)?.result, "closed");
});

// ── merge ──

const DELEGATED: MergeExclusionInput = {
  held: false,
  flight: "VOC-201",
  ticketLabels: ["type:bug"],
  prLabels: [],
  files: ["src/components/player.tsx", "tests/player.test.ts"],
  title: "Pause the video when the dialog opens",
  body: "## Human Preview Gate\n\n- Human Preview applicability: `not required`\n- Human Visual Review disposition when required: `N/A — not required`",
  flightTitle: "Pause the video",
};

test("merge: a delegated PR has no exclusion", () => {
  assert.equal(mergeExclusionOf(DELEGATED), null);
});

test("merge exclusions: each one keeps the PR with the SUPERVISOR", () => {
  const cases: [Partial<MergeExclusionInput>, RegExp][] = [
    [{ held: true }, /HOLD/],
    [{ flight: null }, /FLIGHT 없음/],
    [{ ticketLabels: ["rating:SEC"] }, /rating:SEC/],
    [{ ticketLabels: ["Risk: Rights"] }, /Risk: Rights/],
    [{ prLabels: ["Risk:Perf"] }, /Risk:Perf/],
    [{ files: null }, /파일/],
    [{ files: ["supabase/migrations/20260928_x.sql"] }, /migrations/],
    [{ files: ["db/seed.sql"] }, /SQL/],
    [{ files: ["src/lib/auth/session.ts"] }, /auth/],
    [{ files: ["src/server/beta-admission.ts"] }, /admission/],
    [{ files: ["supabase/rls/songs.ts"] }, /RLS/],
    [{ files: [".env.production"] }, /비밀·키/],
    [{ body: "## Human Preview Gate\n- Human Preview applicability: `required`\n- Human Visual Review disposition when required: `pending`" }, /Human Preview/],
  ];
  for (const [over, re] of cases) assert.match(mergeExclusionOf({ ...DELEGATED, ...over }) ?? "", re, JSON.stringify(over));
});

test("Human Preview: required and not passed / passed / not required / unfilled template", () => {
  const body = (a: string, d: string) => `- Human Preview applicability: ${a}\n- Human Visual Review disposition when required: ${d}`;
  assert.deepEqual(humanPreviewOf(body("`required`", "`pending`")), { required: true, passed: false });
  assert.deepEqual(humanPreviewOf(body("`required`", "`approved`")), { required: true, passed: true });
  assert.deepEqual(humanPreviewOf(body("`required`", "`waived`")), { required: true, passed: true });
  assert.deepEqual(humanPreviewOf(body("`not required`", "`N/A — not required`")), { required: false, passed: false });
  // 채우지 않은 템플릿: 애매하면 required, 선택지 목록은 통과가 아님
  assert.deepEqual(humanPreviewOf(body("`required` / `not required`", "`pending` / `approved` / `changes requested` / `waived`")), { required: true, passed: false });
  assert.equal(humanPreviewOf("no gate here"), null);
  assert.equal(mergeExclusionOf({ ...DELEGATED, body: body("`required`", "`approved`") }), null);
});

test("merge: merges the first delegated CLEARED PR; an excluded one stays with the SUPERVISOR and holds the runway", () => {
  const m = cfg({ mode: "merge" });
  const pulls = [pr(2), pr(3), pr(5, ["behind"])];
  const v = plan(m, pulls, st(), (p) => (p.number === 2 ? "rating:SEC" : null));
  assert.equal(vcdo(v).status, "merge");
  assert.equal(vcdo(v).number, 3);
  assert.equal(v.pulls[`${VCDO}#2`].text, "SUPERVISOR 머지 — rating:SEC");
  assert.equal(v.exclusions[`${VCDO}#2`], "rating:SEC");
  // 위임된 것이 없으면: 제외된 CLEARED가 머지를 기다리며 runway를 잡는다(update는 멈춤)
  const w = plan(m, [pr(2), pr(5, ["behind"])], st(), () => "Human Preview required — 아직 passed 아님");
  assert.equal(vcdo(w).status, "waiting");
  // 그 PR을 HOLD하면 머지도 하지 않고 다음 PR을 갱신한다
  const h = plan({ ...m, holds: [{ repo: VCDO, number: 2, at: "x" }] }, [pr(2), pr(5, ["behind"])], st(), () => "SUPERVISOR HOLD");
  assert.equal(vcdo(h).status, "update");
  assert.equal(vcdo(h).number, 5);
});

test("merge: never merges the same head twice", () => {
  const v = plan(cfg({ mode: "merge" }), [pr(3)], st({ merged: [`${VCDO}#3@${sha(3)}`] }));
  assert.equal(vcdo(v).status, "waiting");
});

test("update mode never merges", () => {
  const v = plan(cfg({ mode: "update" }), [pr(3), pr(5, ["behind"])]);
  assert.equal(vcdo(v).status, "waiting");
  assert.equal(v.airports.some((a) => a.status === "merge"), false);
});

// ── GROUND STOP ──

const main = (failing: string[], s = sha(900)): MainStatus => ({ repo: VCDO, slug: "o/r", branch: "main", sha: s, state: failing.length ? "failure" : "success", failing, checks: 3, at: "x" });

test("GROUND STOP: a red post-merge Application Check on main latches", () => {
  const stops = latchGroundStops(DEFAULT_AUTOLAND, [AIRPORTS[0]], [main(["Application Check"])], st(), "t");
  assert.equal(stops.length, 1);
  assert.equal(stops[0].airport, "VCDO");
  // 다른 체크만 빨가면 걸지 않는다
  assert.equal(latchGroundStops(DEFAULT_AUTOLAND, [AIRPORTS[0]], [main(["Vercel"])], st(), "t").length, 0);
});

test("GROUND STOP: stays until the SUPERVISOR clears it, and a cleared SHA does not re-latch", () => {
  const stopped = st({ groundStops: latchGroundStops(DEFAULT_AUTOLAND, [AIRPORTS[0]], [main(["Application Check"])], st(), "t") });
  // main이 다시 초록이어도 남는다
  assert.equal(latchGroundStops(DEFAULT_AUTOLAND, [AIRPORTS[0]], [main([], sha(901))], stopped, "t").length, 1);
  // SUPERVISOR가 풀면(clearedShas) 같은 SHA로 다시 걸지 않는다. 새 SHA가 빨가면 다시 건다
  const cleared = st({ clearedShas: [sha(900)] });
  assert.equal(latchGroundStops(DEFAULT_AUTOLAND, [AIRPORTS[0]], [main(["Application Check"])], cleared, "t").length, 0);
  assert.equal(latchGroundStops(DEFAULT_AUTOLAND, [AIRPORTS[0]], [main(["Application Check"], sha(902))], cleared, "t").length, 1);
});

test("GROUND STOP stops both modes", () => {
  const stops = latchGroundStops(DEFAULT_AUTOLAND, [AIRPORTS[0]], [main(["Application Check"])], st(), "t");
  for (const mode of ["update", "merge"] as const) {
    const v = plan(cfg({ mode }), [pr(3), pr(5, ["behind"])], st({ groundStops: stops }));
    assert.equal(vcdo(v).status, "groundstop", mode);
    assert.match(vcdo(v).text, /GROUND STOP/);
  }
});

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { MainStatus } from "./atfm.ts";
import {
  type AutolandConfig,
  type AutolandState,
  checkWarningsOf,
  DEFAULT_AUTOLAND,
  EMPTY_STATE,
  getCheckWarnings,
  type InFlight,
  latchGroundStops,
  loadAutoland,
  mergeExclusionOf,
  type MergeExclusionInput,
  parseAutoland,
  planAutoland,
  saveAutoland,
  setCheckWarnings,
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
  blocks: blocks.map((code) => ({ code, text: code, en: code })),
  readyAt: blocks.length ? null : "2026-09-28T01:00:00Z",
  createdAt: `2026-09-2${number % 10}T00:00:00Z`,
  ...over,
});
const cfg = (over: Partial<AutolandConfig> = {}): AutolandConfig => ({ ...DEFAULT_AUTOLAND, mode: "update", ...over });
const st = (over: Partial<AutolandState> = {}): AutolandState => ({ ...structuredClone(EMPTY_STATE), ...over });
const plan = (c: AutolandConfig, pulls: PullRequest[], s = st(), exclusionOf: (p: PullRequest) => string | null = () => null, now = Date.parse("2026-09-28T01:01:00Z")) =>
  planAutoland({ cfg: c, airports: AIRPORTS, pulls, st: s, exclusionOf, now });
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
  body: "## UI change\n\n- UI impact: `changes rendered UI`\n- Human check class (any that apply): `none`\n- Human check: `not needed`",
  flightTitle: "Pause the video",
  head: "abc1234def5678900000000000000000000000ab",
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
    [{ body: "## UI change\n- UI impact: `changes rendered UI`\n- Human check class (any that apply): `DEVICE`\n- Human check: `pending`" }, /HUMAN CHECK DEVICE/],
    // 옛 게이트는 읽지 않는다: 새 블록이 없으면 사람 확인이 필요한지 모른다
    [{ body: "## Human Preview Gate\n- Human Preview applicability: `not required`" }, /UI change 블록 없음/],
  ];
  for (const [over, re] of cases) assert.match(mergeExclusionOf({ ...DELEGATED, ...over }) ?? "", re, JSON.stringify(over));
});

test("HUMAN CHECK(ATC-37): class PR은 이 head에 done이거나 main 병합만 한 이전 커밋에서 이어받아야 머지한다", () => {
  const withCheck = (check: string) => `## UI change\n- UI impact: \`changes rendered UI\`\n- Human check class (any that apply): \`CHOICE\`\n- Human check: ${check}`;
  const old = "0123456789abcdef0123456789abcdef01234567";
  assert.equal(mergeExclusionOf({ ...DELEGATED, body: withCheck("`done 2026-09-28 abc1234 ok`") }), null);
  assert.match(mergeExclusionOf({ ...DELEGATED, body: withCheck("`done 2026-09-28 0123456 ok`") }) ?? "", /옛 head/);
  assert.equal(mergeExclusionOf({ ...DELEGATED, body: withCheck("`done 2026-09-28 0123456 ok`"), carryFrom: [old] }), null);
  assert.match(mergeExclusionOf({ ...DELEGATED, body: withCheck("`failed 2026-09-28 abc1234 no`") }) ?? "", /HUMAN CHECK CHOICE — failed/);
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
  const w = plan(m, [pr(2), pr(5, ["behind"])], st(), () => "HUMAN CHECK CHOICE — pending");
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

// ── ATC-330: applicationCheck는 체크 런 이름이거나 그 체크를 돌리는 워크플로 이름 ──

const mainWf = (over: Partial<MainStatus>): MainStatus => ({ ...main([]), ...over });

test("GROUND STOP: a failing check run whose workflow is the configured name latches", () => {
  const cfgWf = { applicationCheck: "app-check" };
  const m = mainWf({ state: "failure", failing: ["build"], workflowsFailing: ["app-check"], names: ["build", "app-check"] });
  const stops = latchGroundStops(cfgWf, [AIRPORTS[0]], [m], st(), "t");
  assert.equal(stops.length, 1);
  assert.deepEqual(stops[0].failing, ["build", "app-check"]);
  // 대소문자는 무시한다
  assert.equal(latchGroundStops({ applicationCheck: "App-Check" }, [AIRPORTS[0]], [m], st(), "t").length, 1);
});

test("GROUND STOP: a passing workflow of that name does not latch", () => {
  const cfgWf = { applicationCheck: "app-check" };
  // 다른 워크플로의 체크만 실패
  const other = mainWf({ state: "failure", failing: ["lint"], workflowsFailing: ["lint-workflow"], names: ["lint", "lint-workflow", "build", "app-check"] });
  assert.equal(latchGroundStops(cfgWf, [AIRPORTS[0]], [other], st(), "t").length, 0);
  // 전부 초록
  assert.equal(latchGroundStops(cfgWf, [AIRPORTS[0]], [mainWf({ names: ["build", "app-check"] })], st(), "t").length, 0);
  // 부분 일치는 걸지 않는다
  const partial = mainWf({ state: "failure", failing: ["build"], workflowsFailing: ["app-check-extra"], names: ["build", "app-check-extra"] });
  assert.equal(latchGroundStops(cfgWf, [AIRPORTS[0]], [partial], st(), "t").length, 0);
});

test("GROUND STOP: the exact check-run name still latches without workflow data", () => {
  // 워크플로를 못 읽은 head(workflowsFailing·names 없음)도 예전처럼 체크 런 이름으로 건다
  assert.equal(latchGroundStops({ applicationCheck: "build" }, [AIRPORTS[0]], [main(["build"])], st(), "t").length, 1);
});

test("GROUND STOP: a SHA the SUPERVISOR cleared does not re-latch on a workflow-name match", () => {
  const cfgWf = { applicationCheck: "app-check" };
  const m = mainWf({ state: "failure", failing: ["build"], workflowsFailing: ["app-check"], names: ["build", "app-check"] });
  assert.equal(latchGroundStops(cfgWf, [AIRPORTS[0]], [m], st({ clearedShas: [sha(900)] }), "t").length, 0);
  assert.equal(latchGroundStops(cfgWf, [AIRPORTS[0]], [{ ...m, sha: sha(903) }], st({ clearedShas: [sha(900)] }), "t").length, 1);
});

test("check warning: a configured name that matches no check run or workflow on main", () => {
  const cfgWf = { applicationCheck: "app-check" };
  const none = mainWf({ names: ["build", "lint-workflow"] });
  assert.deepEqual(checkWarningsOf(cfgWf, [AIRPORTS[0]], [none]), [{ airport: "VCDO", sha: sha(900), check: "app-check" }]);
  // 체크 런 이름이든 워크플로 이름이든 맞으면 경고 없음
  assert.equal(checkWarningsOf(cfgWf, [AIRPORTS[0]], [mainWf({ names: ["build", "app-check"] })]).length, 0);
  assert.equal(checkWarningsOf({ applicationCheck: "build" }, [AIRPORTS[0]], [none]).length, 0);
  // 실패 목록에 있으면 맞은 것
  assert.equal(checkWarningsOf(cfgWf, [AIRPORTS[0]], [mainWf({ state: "failure", failing: ["app-check"], names: ["x"] })]).length, 0);
});

test("check warning: none when the names are unknown, checks are pending or absent, or no head is known", () => {
  const cfgWf = { applicationCheck: "app-check" };
  assert.equal(checkWarningsOf(cfgWf, [AIRPORTS[0]], [mainWf({})]).length, 0); // names 없음(워크플로를 못 읽음)
  assert.equal(checkWarningsOf(cfgWf, [AIRPORTS[0]], [mainWf({ state: "pending", names: ["build"] })]).length, 0);
  assert.equal(checkWarningsOf(cfgWf, [AIRPORTS[0]], [mainWf({ state: "none", names: [] })]).length, 0);
  assert.equal(checkWarningsOf(cfgWf, [AIRPORTS[0]], [mainWf({ sha: null, names: ["build"] })]).length, 0);
  assert.equal(checkWarningsOf(cfgWf, [AIRPORTS[0]], []).length, 0);
});

test("check warning store: set and read", () => {
  setCheckWarnings([{ airport: "VCDO", sha: sha(900), check: "app-check" }]);
  assert.equal(getCheckWarnings().length, 1);
  setCheckWarnings([]);
  assert.equal(getCheckWarnings().length, 0);
});

test("GROUND STOP stops both modes", () => {
  const stops = latchGroundStops(DEFAULT_AUTOLAND, [AIRPORTS[0]], [main(["Application Check"])], st(), "t");
  for (const mode of ["update", "merge"] as const) {
    const v = plan(cfg({ mode }), [pr(3), pr(5, ["behind"])], st({ groundStops: stops }));
    assert.equal(vcdo(v).status, "groundstop", mode);
    assert.match(vcdo(v).text, /GROUND STOP/);
  }
});

// ── SUPERVISOR 몫 CLEARED의 유예 시간(ATC-331) ──

const T0 = Date.parse("2026-09-28T01:00:00Z");
const MIN = 60_000;
const ready = (n: number, at: string) => pr(n, [], { readyAt: at });
const mergeCfg = () => cfg({ mode: "merge" });
const excl = (...nums: number[]) => (p: PullRequest) => (nums.includes(p.number) ? "rating:SEC" : null);

test("grace: delegated CLEARED still merges first", () => {
  const v = plan(mergeCfg(), [ready(1, "2026-09-28T01:00:00Z"), pr(2, ["behind"])], st(), excl(), T0 + 600 * MIN);
  assert.equal(vcdo(v).status, "merge");
  assert.equal(vcdo(v).number, 1);
});

test("grace: excluded CLEARED inside the window waits", () => {
  const v = plan(mergeCfg(), [ready(1, "2026-09-28T01:00:00Z"), pr(2, ["behind"])], st(), excl(1), T0 + 14 * MIN);
  assert.equal(vcdo(v).status, "waiting");
  assert.equal(vcdo(v).number, 1);
  assert.match(vcdo(v).text, /1분 안에/);
});

test("grace: excluded CLEARED past the window lets the next behind-only PR update, one in flight", () => {
  const pulls = [ready(1, "2026-09-28T01:00:00Z"), pr(2, ["behind"]), pr(3, ["behind"])];
  const v = plan(mergeCfg(), pulls, st(), excl(1), T0 + 15 * MIN);
  assert.equal(vcdo(v).status, "update");
  assert.equal(vcdo(v).number, 2);
  assert.match(v.pulls[`${VCDO}#1`]?.text ?? "", /^SUPERVISOR 머지 — rating:SEC/);
  assert.match(v.pulls[`${VCDO}#1`]?.text ?? "", /15분 지남/);
  // 갱신이 비행 중이면 그것만 기다린다
  const f: InFlight = { airport: "VCDO", repo: VCDO, slug: "o/r", number: 2, fromHead: sha(2), at: "x" };
  assert.equal(vcdo(plan(mergeCfg(), pulls, st({ inflight: [f] }), excl(1), T0 + 15 * MIN)).status, "inflight");
});

test("grace: update mode CLEARED is the SUPERVISOR's and also expires", () => {
  const pulls = [ready(1, "2026-09-28T01:00:00Z"), pr(2, ["behind"])];
  assert.equal(vcdo(plan(cfg(), pulls, st(), excl(), T0 + 5 * MIN)).status, "waiting");
  assert.equal(vcdo(plan(cfg(), pulls, st(), excl(), T0 + 20 * MIN)).status, "update");
});

test("grace: HOLD behaves as before", () => {
  const held = cfg({ holds: [{ repo: VCDO, number: 1, at: "x" }] });
  const v = plan(held, [ready(1, "2026-09-28T01:00:00Z"), pr(2, ["behind"])], st(), excl(), T0 + MIN);
  assert.equal(vcdo(v).status, "update");
  assert.equal(vcdo(v).number, 2);
});

test("grace: two excluded CLEARED PRs count from the oldest readyAt", () => {
  const pulls = [ready(1, "2026-09-28T01:00:00Z"), ready(2, "2026-09-28T01:30:00Z"), pr(3, ["behind"])];
  // 가장 오래된 #1이 지났으면 #2가 아직 창 안이어도 갱신한다
  assert.equal(vcdo(plan(mergeCfg(), pulls, st(), excl(1, 2), T0 + 20 * MIN)).status, "update");
  // 순서가 뒤섞여 들어와도 가장 오래된 것 기준
  const v = plan(mergeCfg(), [pulls[1], pulls[0], pulls[2]], st(), excl(1, 2), T0 + 10 * MIN);
  assert.equal(vcdo(v).status, "waiting");
  assert.equal(vcdo(v).number, 1);
});

test("grace: window is configurable and optional in autoland.json", () => {
  assert.equal(parseAutoland({}).supervisorGraceMinutes, undefined);
  assert.equal(parseAutoland({ supervisorGraceMinutes: 5 }).supervisorGraceMinutes, 5);
  assert.equal(parseAutoland({ supervisorGraceMinutes: "x" }).supervisorGraceMinutes, undefined);
  const v = plan(cfg({ supervisorGraceMinutes: 5 }), [ready(1, "2026-09-28T01:00:00Z"), pr(2, ["behind"])], st(), excl(), T0 + 6 * MIN);
  assert.equal(vcdo(v).status, "update");
});

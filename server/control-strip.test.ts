import assert from "node:assert/strict";
import test from "node:test";
import { ttlCache } from "./agents-cache.ts";
import { controlStripOf, controlStripSummary, lateAfterMin, loopIntervalOf, type StripSession } from "./control-strip.ts";
import type { ControlSession, SquelchLast } from "./control-view.ts";
import type { Job } from "./job-state.ts";
import { lastDecisionsOf, squelchLastOf, squelchOfName } from "./squelch-last.ts";

const NOW = Date.parse("2026-09-29T08:00:00.000Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const job = (over: Partial<Job> = {}): Job => ({ state: "working", detail: "d", needs: null, suggestedReply: null, since: ago(3), tempo: "active", ...over });
const bgLive = (j: Job | null = null) => [{ id: "b1", name: "MCC", kind: "background", status: "busy", job: j }];
const ctl = (over: Partial<ControlSession> = {}): ControlSession => ({ name: "MCC", dir: "mcc", prompt: "/loop 5m /tick", launch: "bg", blocked: null, live: bgLive(), ...over });
const snap = (over: Partial<StripSession> = {}): StripSession => ({ name: "MCC", status: "idle", lastActiveAt: ago(1), health: null, ...over });
const sq = (lastAt: string, over: Partial<SquelchLast> = {}): SquelchLast => ({ lastAt, open: false, reason: "unchanged", openedAt: ago(30), quietSince: ago(20), quietCount: 4, ...over });
const one = (c: ControlSession, s: StripSession[] = [snap()]) => controlStripOf([c], s, NOW)[0]!;

test("loopIntervalOf: 3m·10m은 분, 없으면 null", () => {
  assert.equal(loopIntervalOf("/loop 3m /tick"), 3);
  assert.equal(loopIntervalOf("/loop 10m /tick"), 10);
  assert.equal(loopIntervalOf(null), null);
  assert.equal(loopIntervalOf("/tick"), null);
  assert.equal(loopIntervalOf("/loop 1h /tick"), null);
  assert.equal(lateAfterMin(5), 11);
});

test("코드: TWR·OCC·MCC·XCHK·REV·ENG", () => {
  const names = ["TOWER", "OCC", "MCC", "CROSSCHECK", "REVIEW", "ENGINEERING"];
  const chips = controlStripOf(names.map((name) => ctl({ name, live: [] })), [], NOW);
  assert.deepEqual(chips.map((c) => c.code), ["TWR", "OCC", "MCC", "XCHK", "REV", "ENG"]);
});

test("down: 떠 있지 않음, 또는 이름이 같은 세션이 모두 죽음", () => {
  assert.equal(one(ctl({ live: [] })).state, "down");
  assert.equal(one(ctl({ live: [] })).kind, "not running");
  assert.equal(one(ctl(), [snap({ status: "dead" })]).state, "down");
  assert.equal(one(ctl(), [snap({ status: "dead" }), snap({ status: "busy" })]).state, "ok"); // 산 짝이 있다
  assert.equal(one(ctl(), []).state, "ok"); // snapshot에 없으면 down으로 단정하지 않는다
});

test("needs: job blocked, needs 글, alert 수준 health", () => {
  assert.equal(one(ctl({ live: bgLive(job({ state: "blocked", needs: "답" })) })).state, "needs");
  assert.equal(one(ctl({ live: bgLive(job({ state: "working", needs: "글" })) })).state, "needs");
  const h = { code: "STUCK", level: "alert", since: ago(5), detail: "x" } as unknown as StripSession["health"];
  assert.equal(one(ctl(), [snap({ health: h })]).state, "needs");
  const info = { code: "THROTTLE", level: "info", since: ago(5), detail: "x" } as unknown as StripSession["health"];
  assert.equal(one(ctl(), [snap({ health: info })]).state, "ok");
});

test("working: job working. ok: 그 밖", () => {
  assert.equal(one(ctl({ live: bgLive(job()) })).state, "working");
  assert.equal(one(ctl({ live: bgLive(job({ state: "done" })) })).state, "ok");
  assert.equal(one(ctl()).state, "ok");
});

test("late: 마지막 tick이 2×주기+1분보다 오래됨(5m → 11분 넘게)", () => {
  assert.equal(one(ctl({ squelch: sq(ago(11)) })).state, "ok"); // 딱 11분은 늦지 않다
  assert.equal(one(ctl({ squelch: sq(ago(12)) })).state, "late");
  assert.equal(one(ctl({ prompt: "/loop 10m /tick", squelch: sq(ago(20)) })).state, "ok");
  assert.equal(one(ctl({ prompt: "/loop 10m /tick", squelch: sq(ago(22)) })).state, "late");
  assert.equal(one(ctl({ prompt: null, squelch: sq(ago(999)) })).state, "ok"); // 주기를 모르면 늦다고 하지 않는다
  assert.equal(one(ctl({ live: bgLive(job()), squelch: sq(ago(30)) })).state, "late"); // working보다 late가 앞선다
  assert.equal(one(ctl({ live: bgLive(job({ state: "blocked" })), squelch: sq(ago(30)) })).state, "needs"); // needs가 late보다 앞선다
});

test("SQUELCH가 활동보다 앞선다: SQUELCH가 있으면 활동이 최근이어도 late, 없을 때만 활동", () => {
  const c = one(ctl({ squelch: sq(ago(30)) }), [snap({ lastActiveAt: ago(1) })]);
  assert.equal(c.state, "late");
  assert.equal(c.lastTickSource, "squelch");
  assert.equal(c.lastTickAt, ago(30));
  const a = one(ctl(), [snap({ lastActiveAt: ago(1) })]);
  assert.equal(a.lastTickSource, "activity");
  assert.equal(a.lastTickAt, ago(1));
  assert.match(a.title, /activity — SQUELCH 기록 없음/);
  const old = one(ctl(), [snap({ lastActiveAt: ago(40) })]);
  assert.equal(old.state, "late");
  assert.equal(one(ctl(), [snap({ lastActiveAt: null })]).lastTickSource, null);
});

test("툴팁: 종류·job·needs·주기·마지막 tick과 출처·QUIET 수", () => {
  const c = one(ctl({ live: bgLive(job({ state: "blocked", detail: "PR 기다림", needs: "머지 알림" })), squelch: sq(ago(2), { quietCount: 4 }) }));
  for (const re of [/MCC · BG b1/, /job blocked · PR 기다림/, /NEEDS: 머지 알림/, /loop 5m/, /last tick 0[78]:\d\dZ \(SQUELCH QUIET/, /QUIET 4 since last OPEN/]) assert.match(c.title, re);
});

test("ENGINEERING은 up·down만, 주기 없음", () => {
  const up = one({ name: "ENGINEERING", dir: null, prompt: null, launch: null, blocked: null, live: [{ kind: "interactive", name: "ENGINEERING" }] }, [snap({ name: "ENGINEERING" })]);
  assert.equal(up.state, "ok");
  assert.equal(up.intervalMin, null);
  assert.equal(up.lastTickAt, null);
  assert.equal(one({ name: "ENGINEERING", dir: null, prompt: null, launch: null, blocked: null, live: [] }).state, "down");
});

test("옛 서버 응답(job·squelch 없음)이나 null이어도 있는 것으로 그린다", () => {
  assert.deepEqual(controlStripOf(null, null, NOW), []);
  const c = controlStripOf([{ name: "TOWER", dir: "controller", prompt: "/loop 3m /tick", launch: "bg", blocked: null, live: [{ id: "x1", kind: "background" }] }], undefined, NOW)[0]!;
  assert.equal(c.state, "ok");
  assert.equal(c.lastTickAt, null);
  assert.match(c.title, /last tick 모름/);
});

test("controlStripSummary: 하나라도 down이면 down, 그 밖에 ok가 아니면 amber", () => {
  const chip = (state: "ok" | "working" | "needs" | "late" | "down") => ({ state }) as never;
  assert.deepEqual(controlStripSummary([chip("ok"), chip("working")]), { ok: 2, total: 2, tone: "ok" });
  assert.deepEqual(controlStripSummary([chip("ok"), chip("late")]), { ok: 1, total: 2, tone: "amber" });
  assert.deepEqual(controlStripSummary([chip("needs"), chip("down")]), { ok: 0, total: 2, tone: "down" });
});

test("squelch-last: 역할별 가장 늦은 판정 + 상태 파일의 OPEN·QUIET", () => {
  const log = ['{"t":"2026-09-29T07:00:00.000Z","role":"mcc","open":true,"reason":"changed","fp":"a"}', "깨진 줄", '{"t":"2026-09-29T07:30:00.000Z","role":"mcc","open":false,"reason":"unchanged","fp":"a"}', '{"t":"2026-09-29T07:10:00.000Z","role":"tower","open":true,"reason":"fail-open","fp":null}', '{"t":"x","role":"occ"}', '{"t":"2026-09-29T07:31:00.000Z","role":"nobody"}'].join("\n");
  assert.deepEqual(lastDecisionsOf(log).mcc, { lastAt: "2026-09-29T07:30:00.000Z", open: false, reason: "unchanged" });
  const all = squelchLastOf(log, { mcc: { fp: "a", openedAt: "2026-09-29T07:00:00.000Z", quietSince: "2026-09-29T07:30:00.000Z", quietCount: 3 } });
  assert.equal(all.mcc?.quietCount, 3);
  assert.equal(all.mcc?.openedAt, "2026-09-29T07:00:00.000Z");
  assert.equal(all.tower?.quietCount, 0);
  assert.equal(all.occ, undefined);
  assert.equal(squelchOfName(all, "MCC")?.open, false);
  assert.equal(squelchOfName(all, "ENGINEERING"), null);
  assert.equal(squelchOfName(all, "OCC"), null);
});

test("ttlCache: 30초 안의 두 번 읽기는 명령을 한 번만 돌린다, fresh·만료·실패는 다시", async () => {
  let t = 1_000_000;
  let runs = 0;
  let fail = false;
  const c = ttlCache(async () => {
    runs++;
    if (fail) throw new Error("boom");
    return runs;
  }, 30_000, () => t);
  assert.equal(await c.get(), 1);
  t += 29_000;
  assert.equal(await c.get(), 1);
  assert.equal(runs, 1);
  assert.equal(await c.get(true), 2); // 동작 뒤는 곧장
  t += 30_000;
  assert.equal(await c.get(), 3); // 만료
  fail = true;
  t += 31_000;
  await assert.rejects(c.get(), /boom/);
  fail = false;
  assert.equal(await c.get(), 5); // 실패는 캐시하지 않는다
  // 동시에 온 읽기는 한 번을 나눠 쓴다
  t += 31_000;
  const [a, b] = await Promise.all([c.get(), c.get()]);
  assert.equal(a, b);
  assert.equal(runs, 6);
});

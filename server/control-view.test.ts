import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTROL_POLL_MS, type ControlSession, controlPollDue, controlRowOf } from "./control-view.ts";
import type { Job } from "./job-state.ts";

const job = (state: Job["state"], over: Partial<Job> = {}): Job => ({ state, detail: "d", needs: null, suggestedReply: null, since: null, ...over });
const sess = (over: Partial<ControlSession> = {}): ControlSession => ({ name: "TOWER", dir: "controller", prompt: "start", launch: "bg", blocked: null, live: [], ...over });

test("controlRowOf: 세션이 없으면 not running과 LAUNCH", () => {
  const r = controlRowOf(sess());
  assert.equal(r.badge, "not running");
  assert.equal(r.tone, "dead");
  assert.deepEqual(r.action, { kind: "launch", disabled: false, title: null });
  assert.equal(r.dir, "controller/");
  assert.equal(r.how, "claude --bg");
});

test("controlRowOf: background 세션은 BG 배지와 STOP, job이 blocked면 NEEDS YOU, working이면 한 줄", () => {
  const blocked = controlRowOf(sess({ live: [{ kind: "background", id: "ab12", status: "busy", job: job("blocked", { needs: "승인" }) }] }));
  assert.equal(blocked.badge, "BG ab12");
  assert.equal(blocked.tone, "busy");
  assert.equal(blocked.detail, "busy");
  assert.deepEqual(blocked.action, { kind: "stop", tmux: null });
  assert.equal(blocked.needs?.needs, "승인");
  assert.equal(blocked.working, null);
  const working = controlRowOf(sess({ live: [{ kind: "background", id: "cd34", job: job("working", { detail: "diff 읽는 중" }) }] }));
  assert.equal(working.working?.detail, "diff 읽는 중");
  assert.equal(working.needs, null);
  assert.equal(controlRowOf(sess({ live: [{ kind: "background", id: "ef56", job: job("working", { detail: "" }) }] })).working, null);
});

test("controlRowOf: tmux pane 세션은 tmux 배지와 pane 이름이 든 STOP", () => {
  const r = controlRowOf(sess({ live: [{ kind: "interactive", name: "TOWER", status: "idle", tmux: "atc:1" }] }));
  assert.equal(r.badge, "tmux atc:1");
  assert.equal(r.detail, "TOWER · idle");
  assert.deepEqual(r.action, { kind: "stop", tmux: "atc:1" });
  assert.equal(r.how, "tmux에서 연 세션");
});

test("controlRowOf: 데스크톱 세션은 interactive, LAUNCH는 꺼지고 STOP은 없다", () => {
  const r = controlRowOf(sess({ live: [{ kind: "interactive", name: "OCC" }] }));
  assert.equal(r.badge, "interactive");
  assert.equal(r.tone, "other");
  assert.match(r.detail ?? "", /데스크톱 세션은 그 창에서 닫는다/);
  assert.deepEqual(r.action, { kind: "launch", disabled: true, title: null });
});

test("controlRowOf: launch가 없는 줄(ENGINEERING)은 버튼 없이 배지만, blocked 사유는 launch가 있는 줄에만", () => {
  const eng = controlRowOf(sess({ name: "ENGINEERING", dir: null, prompt: null, launch: null, blocked: "사유" }));
  assert.equal(eng.action, null);
  assert.equal(eng.launchOff, null);
  assert.equal(eng.dir, "저장소 뿌리");
  assert.equal(eng.how, null);
  const off = controlRowOf(sess({ blocked: "폴더 없음" }));
  assert.deepEqual(off.action, { kind: "launch", disabled: true, title: "폴더 없음" });
  assert.equal(off.launchOff, "폴더 없음");
});

test("controlRowOf: STALE job id는 live가 아니라 LAUNCH를 막지 않는다", () => {
  const r = controlRowOf(sess({ stale: [{ id: "s1" }, { id: "s2" }, {}] }));
  assert.deepEqual(r.stale, ["s1", "s2"]);
  assert.equal(r.badge, "not running");
  assert.deepEqual(r.action, { kind: "launch", disabled: false, title: null });
});

test("controlPollDue: 처음이거나 60초가 지났거나 동작 뒤(force)일 때만 읽는다", () => {
  const now = 1_000_000;
  assert.equal(controlPollDue(null, now), true);
  assert.equal(controlPollDue(now - 1, now), false);
  assert.equal(controlPollDue(now - CONTROL_POLL_MS + 1, now), false);
  assert.equal(controlPollDue(now - CONTROL_POLL_MS, now), true);
  assert.equal(controlPollDue(now, now, true), true);
});

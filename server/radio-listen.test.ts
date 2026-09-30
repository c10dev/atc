import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LISTEN, enqueue, loadListen, parseListen, QUEUE_CAP, saveListen, wantsToHear, wavUrlOf } from "../web/src/radio-listen.ts";

test("wantsToHear: 호출만 · 답 없는 호출만 · 전부", () => {
  const call = { open: true as const };
  const answered = {};
  const reply = { replyTo: "C-1" };
  assert.deepEqual([call, answered, reply].map((t) => wantsToHear(t, "calls")), [true, true, false]);
  assert.deepEqual([call, answered, reply].map((t) => wantsToHear(t, "unanswered")), [true, false, false]);
  assert.deepEqual([call, answered, reply].map((t) => wantsToHear(t, "all")), [true, true, true]);
});

test("enqueue: 상한을 넘으면 오래된 것부터 버리고 몇 건인지 센다", () => {
  assert.deepEqual(enqueue([1, 2], [3], 5), { queue: [1, 2, 3], skipped: 0 });
  assert.deepEqual(enqueue([1, 2, 3, 4], [5, 6, 7], 5), { queue: [3, 4, 5, 6, 7], skipped: 2 });
  assert.deepEqual(enqueue([], [1, 2, 3, 4, 5, 6, 7, 8], QUEUE_CAP).queue, [4, 5, 6, 7, 8]);
});

test("wavUrlOf: id는 인코딩, 지정한 목소리만 ?voices=", () => {
  assert.equal(wavUrlOf("C-0001#readback", {}), "/api/radio/C-0001%23readback.wav");
  assert.equal(wavUrlOf("D-1", { TOWER: "a", GROUND: "" }), `/api/radio/D-1.wav?voices=${encodeURIComponent("TOWER:a")}`);
});

test("설정: 기본은 꺼짐, 잘못된 값은 기본으로, 저장소를 못 쓰면 꺼짐", () => {
  assert.equal(DEFAULT_LISTEN.on, false);
  assert.deepEqual(parseListen(null), DEFAULT_LISTEN);
  assert.deepEqual(parseListen({ on: "yes", mode: "loud", rate: 3, voices: { TOWER: "ok", NOPE: "x", GROUND: "../evil" } }), { on: false, mode: "calls", rate: 1, voices: { TOWER: "ok" } });
  const mem = new Map<string, string>();
  const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  saveListen(st, { on: true, mode: "unanswered", rate: 1.5, voices: { COMPANY: "v" } });
  assert.deepEqual(loadListen(st), { on: true, mode: "unanswered", rate: 1.5, voices: { COMPANY: "v" } });
  assert.deepEqual(loadListen(null), DEFAULT_LISTEN);
  assert.deepEqual(loadListen({ getItem: () => { throw new Error("blocked"); } }), DEFAULT_LISTEN);
  mem.set("atc.radio.listen", "not json");
  assert.deepEqual(loadListen(st), DEFAULT_LISTEN);
  assert.doesNotThrow(() => saveListen({ setItem: () => { throw new Error("full"); } }, DEFAULT_LISTEN));
});

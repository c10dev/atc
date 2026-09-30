import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlayer, RESUME_WAIT_MS } from "../web/src/sound.ts";
import {
  type AlertPrefs,
  DEFAULT_PREFS,
  noteMissed,
  replayOnUnlock,
  soundFor,
  soundLocked,
  type SupervisorAlert,
  tabTitleOf,
} from "../web/src/supervisor-alerts.ts";

// 잠금 풀기와 놓친 소리(ATC-162). 가짜 AudioContext로 resume 경로를, 순수 함수로 놓침 판정을 본다. 실제 제스처는 브라우저에서만 확인된다.

const param = { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} };
const node = (): any =>
  new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => (k in t ? t[k] : k === "connect" ? (d: unknown) => d : k === "gain" || k === "frequency" ? param : () => {}),
    set: (t, k, v) => ((t[k] = v), true),
  });

let oscStarts = 0;
type Mode = "ok" | "reject" | "hang" | "stays-suspended";
const fakeCtor = (initial: string, mode: Mode) =>
  class {
    state = initial;
    currentTime = 0;
    destination = node();
    onstatechange: (() => void) | null = null;
    resumeCalls = 0;
    async resume() {
      if (mode === "reject") throw new Error("not allowed");
      if (mode === "hang") return new Promise<void>(() => {});
      if (mode === "ok") this.state = "running";
    }
    createOscillator = () => {
      const n = node();
      return new Proxy(n, { get: (t, k) => (k === "start" ? () => void oscStarts++ : t[k]), set: (t, k, v) => ((t[k] = v), true) });
    };
    createGain = node;
  } as unknown as typeof AudioContext;

test("play: 브라우저가 멈춘 컨텍스트(suspended)는 resume()을 먼저 해 보고, 되면 낸다", async () => {
  oscStarts = 0;
  let ctxRef: any;
  const Ctor = class extends (fakeCtor("running", "ok") as any) {
    constructor() {
      super();
      ctxRef = this;
    }
  } as unknown as typeof AudioContext;
  const player = createPlayer(() => Ctor);
  await player.unlock();
  assert.equal(player.state(), "running");
  ctxRef.state = "suspended"; // 이미 제스처를 받은 뒤 브라우저가 멈췄다(Safari는 interrupted)
  assert.equal(player.state(), "suspended");
  assert.equal(await player.play("call", 1, false), "played");
  assert.ok(oscStarts > 0);
  assert.equal(player.state(), "running");
  ctxRef.state = "interrupted";
  oscStarts = 0;
  assert.equal(await player.play("caution", 1, false), "played");
  assert.ok(oscStarts > 0);
});

test("play: resume이 거절되면 톤을 내지 않고 locked", async () => {
  oscStarts = 0;
  let ctxRef: any;
  const Ctor = class extends (fakeCtor("running", "reject") as any) {
    constructor() {
      super();
      ctxRef = this;
    }
  } as unknown as typeof AudioContext;
  const player = createPlayer(() => Ctor);
  await player.unlock();
  ctxRef.state = "suspended";
  assert.equal(await player.play("warning", 1, true), "locked");
  assert.equal(oscStarts, 0);
  assert.equal(player.playing(), null);
  assert.equal(player.state(), "suspended");
  assert.equal(await player.resume(), false);
});

test("play: resume이 제때 안 풀리면(약속이 안 끝남) 잠긴 것으로 본다", async () => {
  oscStarts = 0;
  let ctxRef: any;
  const Ctor = class extends (fakeCtor("running", "hang") as any) {
    constructor() {
      super();
      ctxRef = this;
    }
  } as unknown as typeof AudioContext;
  const player = createPlayer(() => Ctor);
  await player.unlock();
  ctxRef.state = "suspended";
  const t0 = Date.now();
  assert.equal(await player.play("call", 1, false), "locked");
  assert.ok(Date.now() - t0 >= RESUME_WAIT_MS - 50);
  assert.equal(oscStarts, 0);
});

test("resume(): AudioContext가 아직 없으면 false", async () => {
  const cold = createPlayer(() => fakeCtor("suspended", "ok"));
  assert.equal(await cold.resume(), false);
  assert.equal(await cold.play("call", 1, false), "locked"); // 컨텍스트 없이는 낼 수 없다
});

// ── 놓침 판정(순수) ──
const alert = (key: string, over: Partial<SupervisorAlert> = {}): SupervisorAlert => ({ key, group: "alert", level: "warning", cue: null, aircraft: null, flight: null, text: "t", next: "", link: "#radar", since: null, ...over });
const prefs = (over: Partial<AlertPrefs> = {}): AlertPrefs => ({ ...DEFAULT_PREFS, sound: true, ...over });
const NOON = new Date(2026, 8, 30, 12, 0).getTime();
const ctx = { lastSounded: {}, playing: null } as const;

test("잠금: 소리가 켜져 있고 running이 아닐 때(off 포함)만", () => {
  assert.equal(soundLocked({ sound: true }, "running"), false);
  assert.equal(soundLocked({ sound: true }, "suspended"), true);
  assert.equal(soundLocked({ sound: true }, "off"), true);
  assert.equal(soundLocked({ sound: false }, "suspended"), false);
});

test("잠긴 동안 soundFor가 고른 WARNING·CALL은 놓침으로 든다. CAUTION·같은 key는 아니다", () => {
  const w = alert("w1");
  const c = alert("c1", { level: "advisory", cue: "call" });
  const cau = alert("cau", { level: "caution" });
  const batch = [w, c, cau];
  const d = soundFor(batch, prefs(), NOON, ctx);
  assert.equal(d.sound, "warning");
  const missed = noteMissed([], d, batch, NOON);
  assert.deepEqual(missed.map((m) => [m.key, m.sound]), [["w1", "warning"], ["c1", "call"]]);
  // 같은 key는 한 번만, 소리가 없으면 그대로
  assert.equal(noteMissed(missed, d, batch, NOON + 1).length, 2);
  assert.deepEqual(noteMissed(missed, { sound: null, keys: [] }, batch, NOON), missed);
  // CAUTION만이면 놓침 없음
  const dc = soundFor([cau], prefs(), NOON, ctx);
  assert.equal(dc.sound, "caution");
  assert.deepEqual(noteMissed([], dc, [cau], NOON), []);
});

test("풀렸을 때 아직 있는 놓친 항목이면 한 번 울린다(되풀이 없음, 음성은 켜져 있으면 그 key)", () => {
  const missed = [{ key: "w1", sound: "warning" as const, at: NOON - 5000 }];
  const d = replayOnUnlock(missed, [{ key: "w1" }], prefs(), NOON);
  assert.deepEqual([d.sound, d.repeat, d.keys, d.voiceKey], ["warning", false, ["w1"], null]);
  const v = replayOnUnlock(missed, [{ key: "w1" }], prefs({ voice: { on: true, radio: 0.5 } }), NOON);
  assert.equal(v.voiceKey, "w1");
});

test("풀리기 전에 사라진 항목은 울리지 않는다", () => {
  const missed = [{ key: "w1", sound: "warning" as const, at: NOON - 5000 }];
  assert.equal(replayOnUnlock(missed, [{ key: "other" }], prefs(), NOON).sound, null);
  assert.equal(replayOnUnlock(missed, [], prefs(), NOON).sound, null);
});

test("놓친 것이 여럿이면 가장 높은 하나만: WARNING이 CALL보다, 같으면 더 최근", () => {
  const missed = [
    { key: "c1", sound: "call" as const, at: NOON - 3000 },
    { key: "w1", sound: "warning" as const, at: NOON - 9000 },
    { key: "w2", sound: "warning" as const, at: NOON - 2000 },
  ];
  const all = [{ key: "c1" }, { key: "w1" }, { key: "w2" }];
  assert.deepEqual(replayOnUnlock(missed, all, prefs(), NOON).keys, ["w2"]);
  assert.deepEqual(replayOnUnlock(missed, [{ key: "c1" }, { key: "w1" }], prefs(), NOON).keys, ["w1"]);
  assert.deepEqual(replayOnUnlock(missed, [{ key: "c1" }], prefs(), NOON).keys, ["c1"]);
});

test("조용한 시간이면 풀려도 울리지 않는다. 소리가 꺼졌거나 그 소리를 껐어도", () => {
  const missed = [{ key: "w1", sound: "warning" as const, at: NOON }];
  const quiet = prefs({ quiet: { on: true, from: "11:00", to: "13:00" } });
  assert.equal(replayOnUnlock(missed, [{ key: "w1" }], quiet, NOON).sound, null);
  assert.equal(replayOnUnlock(missed, [{ key: "w1" }], prefs({ sound: false }), NOON).sound, null);
  assert.equal(replayOnUnlock(missed, [{ key: "w1" }], prefs({ sounds: { ...DEFAULT_PREFS.sounds, warning: false } }), NOON).sound, null);
});

test("탭 제목: 놓친 것은 잠금이 풀릴 때까지 앞에 🔇n, 알림이 꺼졌을 때의 (n)은 그대로", () => {
  assert.equal(tabTitleOf("ATC", 0, 0), "ATC");
  assert.equal(tabTitleOf("ATC", 2, 0), "(2) ATC");
  assert.equal(tabTitleOf("ATC", 0, 1), "🔇1 ATC");
  assert.equal(tabTitleOf("ATC", 3, 2), "🔇2 (3) ATC");
});

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { createPlayer, type Player, specEnd, specOf } from "../web/src/sound.ts";

// 재생 순서(ATC-142): 톤 → 음성 한 번, 되풀이 WARNING 톤은 음성을 되풀이하지 않음, ACK는 톤과 음성을 둘 다 멈춤,
// WAV를 못 받으면 톤만. 가짜 AudioContext와 가짜 타이머로 그래프가 아니라 순서만 본다.

interface Src {
  voice: boolean; // 디코드한 음성 버퍼를 든 소스
  osc: boolean;
  started: boolean;
  stopped: boolean;
}
let srcs: Src[];
let fetches: string[];
let respond: () => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;
let player: Player;

const VOICE_BUF = { duration: 1, isVoice: true };
const param = { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} };
// 무엇을 불러도 받아 주고, connect는 이어지는 노드를 돌려주는 가짜 노드
const node = (): any =>
  new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => (k in t ? t[k] : k === "connect" ? (dest: unknown) => dest : k === "gain" || k === "frequency" ? param : () => {}),
    set: (t, k, v) => {
      t[k] = v;
      return true;
    },
  });
const source = (osc: boolean) => {
  const s: Src = { voice: false, osc, started: false, stopped: false };
  srcs.push(s);
  const n = node();
  return new Proxy(n, {
    get: (t, k) => (k === "start" ? () => (s.started = true) : k === "stop" ? () => (s.stopped = true) : t[k]),
    set: (t, k, v) => {
      if (k === "buffer") s.voice = (v as { isVoice?: boolean })?.isVoice === true;
      else t[k] = v;
      return true;
    },
  });
};

class FakeCtx {
  state = "suspended";
  currentTime = 0;
  sampleRate = 8000;
  destination = node();
  onstatechange: (() => void) | null = null;
  async resume() {
    this.state = "running";
  }
  createOscillator = () => source(true);
  createBufferSource = () => source(false);
  createGain = node;
  createBiquadFilter = node;
  createWaveShaper = node;
  createDynamicsCompressor = node;
  createBuffer = (_c: number, n: number) => ({ getChannelData: () => new Float32Array(n) });
  decodeAudioData = async () => VOICE_BUF;
}

const flush = () => new Promise<void>((r) => setImmediate(r)); // setImmediate는 가짜가 아니다
const tick = async (ms: number) => {
  for (let left = ms; left > 0; left -= 100) {
    mock.timers.tick(Math.min(100, left));
    await flush(); // 타이머 뒤의 await 이어달리기를 돌린다
  }
  await flush();
};
const voices = () => srcs.filter((s) => s.voice);
const oscs = () => srcs.filter((s) => s.osc).length;
const cue = { url: "/api/voice/alert/k.wav", radio: 0 };
const okWav = async () => ({ ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(8) });

beforeEach(async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  srcs = [];
  fetches = [];
  respond = okWav;
  (globalThis as { fetch: unknown }).fetch = async (url: string) => {
    fetches.push(url);
    return respond();
  };
  player = createPlayer(() => FakeCtx as unknown as typeof AudioContext);
  await player.unlock();
});
afterEach(() => {
  player.stop();
  mock.timers.reset();
});

const toneEndMs = (sound: "call" | "warning") => (specEnd(specOf(sound)) + 0.15) * 1000;

test("톤이 먼저, 그다음 음성 한 번, 끝나면 멈춘다", async () => {
  player.play("call", 1, false, cue);
  assert.deepEqual(fetches, [cue.url]);
  assert.equal(oscs() > 0, true);
  assert.equal(voices().length, 0); // 톤 동안은 음성이 아직
  await tick(toneEndMs("call") - 50);
  assert.equal(voices().length, 0);
  await tick(100);
  assert.equal(voices().length, 1);
  assert.equal(voices()[0].started, true);
  assert.equal(player.playing(), "call");
  await tick(5000);
  assert.equal(voices().length, 1);
  assert.equal(player.playing(), null);
});

test("되풀이하는 WARNING 톤은 음성을 되풀이하지 않는다", async () => {
  player.play("warning", 1, true, cue);
  await tick(toneEndMs("warning") + 50);
  assert.equal(voices().length, 1);
  const before = oscs();
  await tick(10_000); // 음성이 끝나고 톤이 여러 번 더 돈다
  assert.equal(voices().length, 1);
  assert.equal(fetches.length, 1);
  assert.ok(oscs() > before, "톤은 계속 되풀이");
  assert.equal(player.playing(), "warning");
});

test("ACK(stop)는 음성이 재생되는 중이어도 톤 되풀이와 음성을 둘 다 멈춘다", async () => {
  player.play("warning", 1, true, cue);
  await tick(toneEndMs("warning") + 50);
  const v = voices()[0];
  assert.equal(v.started, true);
  assert.equal(v.stopped, false); // 지금 재생 중
  player.stop();
  assert.equal(v.stopped, true);
  assert.equal(player.playing(), null);
  const n = oscs();
  await tick(20_000);
  assert.equal(oscs(), n, "톤 되풀이가 더 없다");
  assert.equal(voices().length, 1);
});

test("음성을 받기 전에 ACK하면 음성은 시작하지 않는다", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  respond = async () => {
    await gate;
    return okWav();
  };
  player.play("call", 1, false, cue);
  await tick(toneEndMs("call") + 50); // 톤은 끝났고 WAV를 기다리는 중
  player.stop();
  release();
  await tick(5000);
  assert.equal(voices().length, 0);
  assert.equal(player.playing(), null);
});

test("WAV를 못 받으면(503) 톤만: 한 번짜리는 끝나고, 되풀이는 톤이 이어진다", async () => {
  respond = async () => ({ ok: false, status: 503, json: async () => ({ error: "TTS 엔진 없음" }), arrayBuffer: async () => new ArrayBuffer(0) });
  player.play("call", 1, false, cue);
  await tick(toneEndMs("call") + 50);
  assert.equal(voices().length, 0);
  assert.equal(player.playing(), null);

  player.play("warning", 1, true, cue);
  await tick(toneEndMs("warning") + 50);
  const n = oscs();
  await tick(5000);
  assert.equal(voices().length, 0);
  assert.ok(oscs() > n);
  assert.equal(player.playing(), "warning");
});

test("fetch가 던져도(네트워크 오류) 톤만 낸다", async () => {
  (globalThis as { fetch: unknown }).fetch = async () => {
    throw new Error("offline");
  };
  player.play("call", 1, false, cue);
  await tick(toneEndMs("call") + 50);
  assert.equal(voices().length, 0);
  assert.equal(player.playing(), null);
});

// RADIO 듣기(ATC-172): 알림이 이긴다. WARNING·CALL 톤이 울리는 동안 RADIO 음성은 내지 않고, 톤이 시작하면 그친다
test("RADIO 음성은 WARNING 톤이 울리는 동안 내지 않고(alert), 받지도 않는다", async () => {
  player.play("warning", 1, true);
  const r = await player.speak({ url: "/api/radio/C-1.wav", radio: 0 }, 1, { yieldToAlert: true });
  assert.deepEqual(r, { ok: false, error: "alert" });
  assert.deepEqual(fetches, []);
  assert.equal(voices().length, 0);
});

test("RADIO 음성이 나는 중에 WARNING 톤이 시작하면 음성이 그친다", async () => {
  const done = player.speak({ url: "/api/radio/C-1.wav", radio: 0 }, 1, { yieldToAlert: true });
  await flush();
  const v = voices()[0];
  assert.equal(v.started, true);
  assert.equal(v.stopped, false);
  player.play("warning", 1, false);
  assert.equal(v.stopped, true, "알림 톤이 무전 음성을 멈춘다");
  await tick(3000);
  await done;
});

test("RADIO 음성은 받는 동안 알림이 울리면 내지 않는다", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  respond = async () => {
    await gate;
    return okWav();
  };
  const p = player.speak({ url: "/api/radio/C-1.wav", radio: 0 }, 1, { yieldToAlert: true });
  player.play("call", 1, false);
  release();
  await flush();
  assert.deepEqual(await p, { ok: false, error: "alert" });
  assert.equal(voices().length, 0);
});

test("RADIO 음성은 받는 동안 SKIP하면(cancelled) 내지 않고 끝난다", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  respond = async () => {
    await gate;
    return okWav();
  };
  let skipped = false;
  const p = player.speak({ url: "/api/radio/C-1.wav", radio: 0 }, 1, { yieldToAlert: true, cancelled: () => skipped });
  skipped = true;
  release();
  await flush();
  assert.deepEqual(await p, { ok: true });
  assert.equal(voices().length, 0);
});

test("stopSpeech는 음성만 그치고 톤은 그대로", async () => {
  player.play("caution", 1, false);
  const done = player.speak({ url: "/api/radio/C-1.wav", radio: 0 }, 1, { yieldToAlert: true });
  await flush();
  // caution은 양보 대상이 아니라 음성도 난다
  const v = voices()[0];
  assert.equal(v?.started, true);
  player.stopSpeech();
  assert.equal(v.stopped, true);
  assert.equal(player.playing(), "caution");
  await done;
});

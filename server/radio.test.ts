import assert from "node:assert/strict";
import { test } from "node:test";
import { driveCurve, planOf, playRadioVoice, RAMP_S, radioSpecOf } from "../web/src/radio.ts";

// 라디오 체인(ATC-140): 명세는 순수 함수, 재생은 가짜 AudioContext로 그래프의 모양만 본다

test("radio 1: 완전한 무전 — 클릭 15 ms, 스켈치 열림 80 ms, 하이패스 300 Hz, 로패스 3000 Hz, 꼬리 150 ms, 낮은 치익", () => {
  const s = radioSpecOf(1);
  assert.equal(s.keyClick.durS, 0.015);
  assert.equal(s.squelchOpen.durS, 0.08);
  assert.equal(s.squelchTail.durS, 0.15);
  assert.equal(s.highpassHz, 300);
  assert.equal(s.lowpassHz, 3000);
  assert.ok(s.keyClick.gain > 0 && s.squelchOpen.gain > 0 && s.squelchTail.gain > 0 && s.hiss.gain > 0 && s.hiss.gain < 0.05);
  assert.ok(s.drive > 0 && s.compressor.ratio > 1 && s.compressor.threshold < 0);
  assert.ok(s.rampS >= 0.02 && s.rampS <= 0.03 && s.rampS === RAMP_S); // ATC-87과 같은 20–30 ms 램프
});

test("radio 0: 깨끗한 음성 — 클릭·스켈치·치익 없고 필터와 압축이 열려 있다", () => {
  const s = radioSpecOf(0);
  assert.deepEqual([s.keyClick.gain, s.squelchOpen.gain, s.squelchTail.gain, s.hiss.gain, s.drive, s.gapS], [0, 0, 0, 0, 0, 0]);
  assert.equal(s.highpassHz, 20);
  assert.equal(s.lowpassHz, 20000);
  assert.equal(s.compressor.ratio, 1);
  assert.equal(s.compressor.threshold, 0);
});

test("radio는 0에서 1까지 이어진다(중간값은 중간, 범위 밖·NaN은 잘라낸다)", () => {
  const half = radioSpecOf(0.5);
  assert.equal(half.highpassHz, 160);
  assert.equal(half.lowpassHz, 11500);
  assert.ok(half.keyClick.gain > 0 && half.keyClick.gain < radioSpecOf(1).keyClick.gain);
  let prev = radioSpecOf(0);
  for (const r of [0.2, 0.4, 0.6, 0.8, 1]) {
    const s = radioSpecOf(r);
    assert.ok(s.highpassHz > prev.highpassHz && s.lowpassHz < prev.lowpassHz && s.drive > prev.drive && s.hiss.gain > prev.hiss.gain, `r=${r}`);
    prev = s;
  }
  assert.equal(radioSpecOf(5).amount, 1);
  assert.equal(radioSpecOf(-1).amount, 0);
  assert.equal(radioSpecOf(Number.NaN).amount, 0);
});

test("시간표: 클릭 → 스켈치 열림 → 음성 → 꼬리 순서, radio 0이면 음성부터", () => {
  const p = planOf(radioSpecOf(1), 2);
  assert.ok(p.clickAt! < p.squelchAt! && p.squelchAt! < p.voiceAt && p.voiceAt < p.voiceEnd && p.voiceEnd <= p.tailAt! && p.tailAt! < p.end);
  assert.ok(Math.abs(p.voiceEnd - p.voiceAt - 2) < 1e-9);
  assert.ok(p.squelchAt! >= p.clickAt! + 0.015); // 스켈치는 클릭이 끝난 뒤
  assert.ok(p.voiceAt >= p.squelchAt! + 0.08); // 음성은 스켈치가 열린 뒤
  assert.ok(p.end >= p.tailAt! + 0.15);
  const clean = planOf(radioSpecOf(0), 1);
  assert.deepEqual([clean.clickAt, clean.squelchAt, clean.tailAt], [null, null, null]);
  assert.equal(clean.voiceAt, 0.02);
  assert.equal(planOf(radioSpecOf(1), -3).voiceEnd, planOf(radioSpecOf(1), 0).voiceAt);
});

test("WaveShaper 곡선: drive 0은 곧은 선, 커질수록 가볍게 눌리되 -1..1 안에서 매끈하게 커진다", () => {
  const flat = driveCurve(0, 5);
  assert.deepEqual([...flat], [-1, -0.5, 0, 0.5, 1]);
  const c = driveCurve(4, 257);
  for (let i = 1; i < c.length; i++) assert.ok(c[i] >= c[i - 1], "줄어들지 않는다");
  assert.ok(c[0] >= -1 && c[256] <= 1);
  assert.ok(c[192] > 0.75, "약한 신호는 더 크게(압축)"); // x=0.5
  assert.equal(c[128], 0);
});

// ── 가짜 AudioContext: 만든 노드와 연결만 적는다 ──
function fakeContext() {
  const log = { types: [] as string[], connections: [] as [string, string][], sources: 0, started: [] as number[] };
  let id = 0;
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} });
  const node = (type: string, extra: Record<string, unknown> = {}) => {
    const self: Record<string, unknown> = {
      __t: `${type}#${id++}`,
      connect(to: Record<string, unknown>) {
        log.connections.push([self.__t as string, to.__t as string]);
        return to;
      },
      disconnect() {},
      ...extra,
    };
    log.types.push(type);
    return self;
  };
  const ctx = {
    currentTime: 10,
    sampleRate: 8000,
    destination: { __t: "destination" },
    createBuffer: (_c: number, n: number) => ({ getChannelData: () => new Float32Array(n), duration: n / 8000 }),
    createBufferSource: () => node("source", { start: (t: number) => log.started.push(t), stop() {} }),
    createGain: () => node("gain", { gain: param() }),
    createBiquadFilter: () => node("biquad", { type: "", frequency: { value: 0 } }),
    createWaveShaper: () => node("waveshaper", { curve: null }),
    createDynamicsCompressor: () => node("compressor", { threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 } }),
  };
  return { ctx: ctx as unknown as AudioContext, log };
}
const voice = (dur: number) => ({ duration: dur }) as unknown as AudioBuffer;

test("playRadioVoice: 음성은 하이패스 → 로패스 → WaveShaper → 컴프레서 순서로 이어지고 클릭·스켈치·꼬리·치익이 붙는다", () => {
  const { ctx, log } = fakeContext();
  const p = playRadioVoice(ctx, voice(1.5), 0.6, radioSpecOf(1));
  const chain = ["biquad", "biquad", "waveshaper", "compressor"];
  const order = log.connections.map(([, b]) => b.split("#")[0]);
  const at = order.findIndex((_, i) => chain.every((t, k) => order[i + k] === t));
  assert.ok(at >= 0, "음성 체인이 이 순서로 이어져야 한다");
  assert.equal(log.types.filter((t) => t === "waveshaper").length, 1);
  assert.equal(log.types.filter((t) => t === "compressor").length, 1);
  assert.equal(log.started.length, 1 + 3 + 1, "음성 1 + 클릭·스켈치·꼬리 3 + 치익 1");
  p.stop();
});

test("playRadioVoice: radio 0은 잡음 없이 음성만, stop은 done을 푼다", async () => {
  const { ctx, log } = fakeContext();
  const p = playRadioVoice(ctx, voice(0.5), 1, radioSpecOf(0));
  assert.equal(log.started.length, 1);
  p.stop();
  await p.done;
});

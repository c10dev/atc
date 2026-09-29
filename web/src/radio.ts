// 라디오 체인(ATC-140, docs/guide/voice.md): 서버가 만든 깨끗한 음성 WAV를 브라우저 Web Audio로 무전 소리처럼 만든다.
// 키 클릭(약 15 ms 잡음) → 스켈치 열림(약 80 ms 대역 제한 잡음) → 음성(하이패스 300 Hz → 로패스 3000 Hz → 가벼운 WaveShaper → DynamicsCompressor)
// + 음성 밑의 낮은 치익 소리 → 스켈치 꼬리(약 150 ms). 모든 가장자리는 ATC-87처럼 20–30 ms 램프.
// 매개변수는 순수 명세(radioSpecOf)라 시험한다. `radio` 하나(0–1)가 깨끗한 음성(0)부터 완전한 무전(1)까지 잇는다. 재생(playRadioVoice)만 브라우저 API를 부른다.
// 오디오 파일도 녹음도 없다: 잡음은 그 자리에서 합성한다.

export const RAMP_S = 0.025; // sound.ts와 같은 25 ms

export interface RadioSpec {
  amount: number; // 0..1
  rampS: number;
  keyClick: { durS: number; gain: number }; // 송신 키 클릭
  squelchOpen: { durS: number; gain: number; lowHz: number; highHz: number }; // 스켈치가 열리는 잡음(대역 제한)
  squelchTail: { durS: number; gain: number; lowHz: number; highHz: number }; // 끝의 스켈치 꼬리
  highpassHz: number;
  lowpassHz: number;
  drive: number; // WaveShaper 세기(0이면 곧은 선)
  compressor: { threshold: number; knee: number; ratio: number; attack: number; release: number };
  hiss: { gain: number }; // 음성 밑의 낮은 치익 소리
  gapS: number; // 클릭·스켈치와 음성 사이
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// radio 0 = 깨끗한 음성(클릭·스켈치·치익 없음, 필터·압축 없음), 1 = 완전한 무전
export function radioSpecOf(radio: number): RadioSpec {
  const a = clamp01(radio);
  return {
    amount: a,
    rampS: RAMP_S,
    keyClick: { durS: 0.015, gain: 0.5 * a },
    squelchOpen: { durS: 0.08, gain: 0.22 * a, lowHz: 500, highHz: 3500 },
    squelchTail: { durS: 0.15, gain: 0.26 * a, lowHz: 500, highHz: 3500 },
    highpassHz: lerp(20, 300, a),
    lowpassHz: lerp(20000, 3000, a),
    drive: 4 * a,
    compressor: { threshold: lerp(0, -24, a), knee: 12, ratio: lerp(1, 8, a), attack: 0.003, release: 0.25 },
    hiss: { gain: 0.025 * a },
    gapS: a > 0 ? 0.03 : 0,
  };
}

// 시간표(초): 음성 길이를 알면 어디서 무엇이 시작하는지. 0이면 클릭·스켈치 없이 음성부터
export interface RadioPlan {
  clickAt: number | null;
  squelchAt: number | null;
  voiceAt: number;
  voiceEnd: number;
  tailAt: number | null;
  end: number;
}
export function planOf(spec: RadioSpec, voiceDurS: number): RadioPlan {
  const lead = 0.02; // 시작 여유
  const clickAt = spec.keyClick.gain > 0 ? lead : null;
  const squelchAt = spec.squelchOpen.gain > 0 ? lead + spec.keyClick.durS + spec.gapS : null;
  const voiceAt = (squelchAt !== null ? squelchAt + spec.squelchOpen.durS : clickAt !== null ? clickAt + spec.keyClick.durS : lead) + spec.gapS;
  const voiceEnd = voiceAt + Math.max(0, voiceDurS);
  const tailAt = spec.squelchTail.gain > 0 ? voiceEnd : null;
  return { clickAt, squelchAt, voiceAt, voiceEnd, tailAt, end: (tailAt ?? voiceEnd) + (tailAt !== null ? spec.squelchTail.durS : 0) + 0.05 };
}

// WaveShaper 곡선: drive 0이면 곧은 선, 클수록 가볍게 눌린다(소프트 클리핑)
export function driveCurve(drive: number, n = 256): Float32Array<ArrayBuffer> {
  const k = Math.max(0, drive) * 5;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    out[i] = k === 0 ? x : ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return out;
}

// ── 재생(브라우저) ──
export interface RadioPlayback {
  stop(): void;
  done: Promise<void>; // 꼬리까지 끝나거나 stop하면 풀린다
}

// 짧은 흰 잡음 버퍼(클릭·스켈치·치익용). 그 자리에서 합성한다
function noiseBuffer(ctx: AudioContext, durS: number): AudioBuffer {
  const n = Math.max(1, Math.round(ctx.sampleRate * durS));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// 음성 하나를 무전 체인으로 재생한다. volume은 0..1(ATC-87 음량)
export function playRadioVoice(ctx: AudioContext, voice: AudioBuffer, volume: number, spec: RadioSpec): RadioPlayback {
  const t0 = ctx.currentTime;
  const plan = planOf(spec, voice.duration);
  const nodes: AudioScheduledSourceNode[] = [];
  const master = ctx.createGain();
  master.gain.value = Math.max(0.0001, volume);
  master.connect(ctx.destination);

  // 가장자리를 램프로 켜고 끄는 게인
  const shaped = (at: number, dur: number, peak: number, dest: AudioNode) => {
    const g = ctx.createGain();
    const s = t0 + at;
    const r = Math.min(spec.rampS, dur / 2);
    g.gain.setValueAtTime(0.0001, s);
    g.gain.linearRampToValueAtTime(Math.max(0.0001, peak), s + r);
    g.gain.setValueAtTime(Math.max(0.0001, peak), s + dur - r);
    g.gain.linearRampToValueAtTime(0.0001, s + dur);
    g.connect(dest);
    return g;
  };
  const burst = (at: number, dur: number, peak: number, band?: { lowHz: number; highHz: number }) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, dur + 0.02);
    let last: AudioNode = src;
    if (band) {
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = band.lowHz;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = band.highHz;
      src.connect(hp).connect(lp);
      last = lp;
    }
    last.connect(shaped(at, dur, peak, master));
    src.start(t0 + at);
    src.stop(t0 + at + dur + 0.02);
    nodes.push(src);
  };

  if (plan.clickAt !== null) burst(plan.clickAt, spec.keyClick.durS, spec.keyClick.gain);
  if (plan.squelchAt !== null) burst(plan.squelchAt, spec.squelchOpen.durS, spec.squelchOpen.gain, spec.squelchOpen);
  if (plan.tailAt !== null) burst(plan.tailAt, spec.squelchTail.durS, spec.squelchTail.gain, spec.squelchTail);

  // 음성: 하이패스 → 로패스 → WaveShaper → 컴프레서 → 램프 게인
  const src = ctx.createBufferSource();
  src.buffer = voice;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = spec.highpassHz;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = spec.lowpassHz;
  const shaper = ctx.createWaveShaper();
  shaper.curve = driveCurve(spec.drive);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = spec.compressor.threshold;
  comp.knee.value = spec.compressor.knee;
  comp.ratio.value = spec.compressor.ratio;
  comp.attack.value = spec.compressor.attack;
  comp.release.value = spec.compressor.release;
  src.connect(hp).connect(lp).connect(shaper).connect(comp).connect(shaped(plan.voiceAt, voice.duration, 1, master));
  src.start(t0 + plan.voiceAt);
  nodes.push(src);

  // 음성 밑의 낮은 치익 소리(음성 길이만큼)
  if (spec.hiss.gain > 0) burst(plan.voiceAt, voice.duration, spec.hiss.gain, { lowHz: 800, highHz: 3000 });

  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => (finish = resolve));
  const timer = setTimeout(finish, plan.end * 1000);
  return {
    done,
    stop() {
      clearTimeout(timer);
      for (const n of nodes) {
        try {
          n.stop();
        } catch {}
      }
      try {
        master.disconnect();
      } catch {}
      finish();
    },
  };
}

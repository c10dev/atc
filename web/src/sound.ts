import type { SoundName } from "./supervisor-alerts.ts";

// SUPERVISOR alerts(ATC-87)의 소리. Web Audio로 합성한다: 오디오 파일도 CDN도 없다. FAA AC 25.1322-1 부록 2를 따라 넷뿐이고,
// 서로 높이와 리듬이 다르고, 200–1500 Hz 안이며, 시작과 끝을 램프로 만든다. 녹음이나 제조사 소리는 쓰지 않는다.
// 음 명세(specOf)는 순수 함수라 테스트한다. 재생(createPlayer)만 브라우저 API를 부른다.

export interface Tone {
  at: number; // 시작(초)
  dur: number; // 길이(초)
  freqs: number[]; // 동시에 울리는 주파수
  gain: number; // 0..1, 소리 크기 전
}
export interface SoundSpec {
  tones: Tone[];
  period: number; // 되풀이할 때 한 번의 길이(초)
}

export const RAMP_S = 0.025; // 켜고 끄는 램프 25 ms
export const FREQ_MIN = 200;
export const FREQ_MAX = 1500;

// SELCAL 표의 공개 주파수(Hz)에서 고른 것: J 716.1, M 977.2, E 473.2, Q 1202.3
const SELCAL = { E: 473.2, J: 716.1, M: 977.2, Q: 1202.3 };

export function specOf(sound: SoundName): SoundSpec {
  switch (sound) {
    case "warning": {
      // 빠른 두 음 펄스 여러 개(1000·700 Hz 번갈아 8번), 쉬었다가 되풀이
      const tones: Tone[] = Array.from({ length: 8 }, (_, i) => ({ at: i * 0.12, dur: 0.08, freqs: [i % 2 ? 700 : 1000], gain: 0.9 }));
      return { tones, period: 8 * 0.12 + 0.6 };
    }
    case "caution":
      // 부드러운 두 음 차임 하나(660 → 880 Hz), 되풀이 없음
      return { tones: [{ at: 0, dur: 0.18, freqs: [660], gain: 0.6 }, { at: 0.2, dur: 0.3, freqs: [880], gain: 0.6 }], period: 0.6 };
    case "call":
      // SELCAL 같은 형태: 두 음쌍, 각 0.3 s, 사이 0.1 s
      return { tones: [{ at: 0, dur: 0.3, freqs: [SELCAL.J, SELCAL.M], gain: 0.5 }, { at: 0.4, dur: 0.3, freqs: [SELCAL.E, SELCAL.Q], gain: 0.5 }], period: 0.8 };
    case "done":
      // 낮은 음 하나(330 Hz)
      return { tones: [{ at: 0, dur: 0.45, freqs: [330], gain: 0.5 }], period: 0.6 };
  }
}

export const specEnd = (s: SoundSpec) => Math.max(...s.tones.map((t) => t.at + t.dur));

// ── 재생 ──
export type AudioState = "off" | "running" | "suspended";
export interface Player {
  unlock(): Promise<void>; // 사용자가 소리를 켜는 클릭 안에서 부른다(브라우저 자동재생 규칙)
  state(): AudioState;
  play(sound: SoundName, volume: number, repeat: boolean): void;
  stop(): void; // 지금 울리는 소리를 그친다(ACK)
  playing(): SoundName | null;
}

type Ctor = typeof AudioContext;

export function createPlayer(getCtor: () => Ctor | undefined = () => (globalThis as { AudioContext?: Ctor }).AudioContext, onChange: () => void = () => {}): Player {
  let ctx: AudioContext | null = null;
  let current: { sound: SoundName; timer: ReturnType<typeof setTimeout> | null; nodes: AudioScheduledSourceNode[] } | null = null;

  const schedule = (sound: SoundName, volume: number) => {
    const c = ctx!;
    const spec = specOf(sound);
    const t0 = c.currentTime + 0.02;
    const nodes: AudioScheduledSourceNode[] = [];
    for (const tone of spec.tones) {
      for (const f of tone.freqs) {
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = "sine";
        osc.frequency.value = f;
        const peak = Math.max(0.0001, tone.gain * volume) / tone.freqs.length;
        const s = t0 + tone.at;
        g.gain.setValueAtTime(0.0001, s);
        g.gain.linearRampToValueAtTime(peak, s + RAMP_S);
        g.gain.setValueAtTime(peak, s + tone.dur - RAMP_S);
        g.gain.linearRampToValueAtTime(0.0001, s + tone.dur);
        osc.connect(g).connect(c.destination);
        osc.start(s);
        osc.stop(s + tone.dur + 0.02);
        nodes.push(osc);
      }
    }
    return { nodes, spec };
  };

  const stop = () => {
    if (!current) return;
    if (current.timer) clearTimeout(current.timer);
    for (const n of current.nodes) {
      try {
        n.stop();
      } catch {}
    }
    current = null;
    onChange();
  };

  return {
    async unlock() {
      const C = getCtor();
      if (!C) return;
      if (!ctx) {
        ctx = new C();
        ctx.onstatechange = () => onChange(); // 브라우저가 멈추면 화면이 `소리 꺼짐`을 보인다
      }
      if (ctx.state === "suspended") await ctx.resume();
      onChange();
    },
    state: () => (!ctx ? "off" : ctx.state === "running" ? "running" : "suspended"),
    playing: () => current?.sound ?? null,
    stop,
    play(sound, volume, repeat) {
      if (!ctx || ctx.state !== "running") return;
      stop();
      const run = () => {
        const { nodes, spec } = schedule(sound, volume);
        const cur = { sound, timer: null as ReturnType<typeof setTimeout> | null, nodes };
        current = cur;
        cur.timer = setTimeout(() => {
          if (current !== cur) return;
          if (repeat) run();
          else {
            current = null;
            onChange();
          }
        }, (repeat ? spec.period : specEnd(spec) + 0.05) * 1000);
      };
      run();
      onChange();
    },
  };
}

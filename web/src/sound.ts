import { playRadioVoice, type RadioPlayback, radioSpecOf } from "./radio.ts";
import type { SoundName } from "./supervisor-alerts.ts";
import { apiGet } from "./api.ts";

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
// 음성 콜아웃(ATC-140): 톤 한 번 뒤에 서버가 만든 WAV를 무전 체인으로 한 번 들려준다(되풀이하는 톤이 음성을 되풀이하지 않는다)
export interface VoiceCue {
  url: string; // GET /api/voice/alert/<key>.wav 또는 preview
  radio: number; // 0..1
}
export type SpeakResult = { ok: true } | { ok: false; error: string };
// play의 결과(ATC-162): locked면 톤을 내지 못했다(resume이 거절됐거나 제때 풀리지 않음). 부르는 쪽이 "놓침"으로 든다
export type PlayResult = "played" | "locked";
export const RESUME_WAIT_MS = 400; // resume()이 이 안에 풀리지 않으면 잠긴 것으로 본다(제스처 없이는 약속이 안 끝나는 브라우저가 있다)
const VOICE_GAP_S = 0.15; // 톤이 끝난 뒤 음성까지
const RESUME_GAP_S = 0.5; // 음성이 끝난 뒤 되풀이 톤까지

export interface Player {
  unlock(): Promise<void>; // 사용자가 소리를 켜는 클릭 안에서 부른다(브라우저 자동재생 규칙)
  state(): AudioState;
  // running이면 곧장 내고("played"), 아니면 먼저 resume()을 해 본 뒤 내고, 그래도 안 되면 "locked"(ATC-162)
  play(sound: SoundName, volume: number, repeat: boolean, voice?: VoiceCue): Promise<PlayResult>;
  // 제스처 없이 풀어 본다(visibilitychange·focus). 풀렸으면 true. AudioContext가 아직 없으면 false(unlock이 만든다)
  resume(): Promise<boolean>;
  // 음성만(미리 듣기, RADIO 듣기). 톤 없이. opts.yieldToAlert면 WARNING·CALL 톤이 울리는 동안은 내지 않고 "alert"로 돌려준다(RADIO는 알림에 양보, ATC-172).
  // 톤이 새로 울리기 시작하면 지금 나는 음성은 그친다. rate는 재생 속도
  speak(voice: VoiceCue, volume: number, opts?: { yieldToAlert?: boolean; rate?: number; cancelled?: () => boolean }): Promise<SpeakResult>;
  stopSpeech(): void; // 음성만 그친다(톤은 그대로)
  stop(): void; // 지금 울리는 소리를 그친다(ACK)
  playing(): SoundName | null;
}

type Ctor = typeof AudioContext;

export function createPlayer(getCtor: () => Ctor | undefined = () => (globalThis as { AudioContext?: Ctor }).AudioContext, onChange: () => void = () => {}): Player {
  let ctx: AudioContext | null = null;
  let current: { sound: SoundName; timer: ReturnType<typeof setTimeout> | null; nodes: AudioScheduledSourceNode[]; voice: RadioPlayback | null } | null = null;
  let previewing: RadioPlayback | null = null;

  // 서버가 만든 WAV를 받아 디코드한다. 못 받으면(엔진 없음·목소리 없음 등) 이유를 돌려준다
  const fetchVoice = async (url: string): Promise<{ buffer: AudioBuffer } | { error: string }> => {
    try {
      const res = await apiGet(url);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        return { error: body.error ?? `음성을 받지 못함(${res.status})` };
      }
      return { buffer: await ctx!.decodeAudioData(await res.arrayBuffer()) };
    } catch (e) {
      return { error: (e as Error).message || "음성을 받지 못함" };
    }
  };

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

  // running이 아니면 resume()을 해 본다: Safari의 interrupted나, 제스처 뒤에 브라우저가 멈춘 컨텍스트. 거절돼도 제때 안 풀려도 false
  const tryResume = async (): Promise<boolean> => {
    if (!ctx) return false;
    if (ctx.state === "running") return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([ctx.resume(), new Promise<void>((r) => (timer = setTimeout(r, RESUME_WAIT_MS)))]);
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
    onChange();
    return (ctx.state as string) === "running";
  };

  const stop = () => {
    if (!current) return;
    if (current.timer) clearTimeout(current.timer);
    for (const n of current.nodes) {
      try {
        n.stop();
      } catch {}
    }
    current.voice?.stop();
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
    resume: tryResume,
    playing: () => current?.sound ?? null,
    stop,
    stopSpeech() {
      previewing?.stop();
      previewing = null;
    },
    async speak(voice, volume, opts = {}) {
      if (!ctx || ctx.state !== "running") return { ok: false, error: "소리가 꺼져 있음" };
      const loud = () => current !== null && (current.sound === "warning" || current.sound === "call");
      if (opts.yieldToAlert && loud()) return { ok: false, error: "alert" };
      previewing?.stop();
      const got = await fetchVoice(voice.url);
      if ("error" in got) return { ok: false, error: got.error };
      if (opts.yieldToAlert && loud()) return { ok: false, error: "alert" }; // 받는 동안 알림이 울렸다
      if (opts.cancelled?.()) return { ok: true }; // 받는 동안 SKIP이 눌렸다: 내지 않고 끝난 것으로
      const p = playRadioVoice(ctx, got.buffer, volume, radioSpecOf(voice.radio), opts.rate ?? 1);
      previewing = p;
      await p.done;
      if (previewing === p) previewing = null;
      return { ok: true };
    },
    play(sound, volume, repeat, voice) {
      if (ctx && ctx.state === "running") {
        start(sound, volume, repeat, voice);
        return Promise.resolve("played");
      }
      return tryResume().then((ok) => {
        if (!ok) return "locked";
        start(sound, volume, repeat, voice);
        return "played";
      });
    },
  };

  function start(sound: SoundName, volume: number, repeat: boolean, voice?: VoiceCue) {
    stop();
    previewing?.stop();
    // 음성은 톤이 울리는 동안 미리 받아 둔다. 못 받으면 톤만 낸다
    const audio = voice ? fetchVoice(voice.url) : null;
    const run = (first: boolean) => {
      const { nodes, spec } = schedule(sound, volume);
      const cur = { sound, timer: null as ReturnType<typeof setTimeout> | null, nodes, voice: null as RadioPlayback | null };
      current = cur;
      const speakNow = first && audio !== null;
      cur.timer = setTimeout(async () => {
        if (current !== cur) return;
        if (speakNow) {
          const got = await audio;
          if (current !== cur) return;
          if ("buffer" in got) {
            const p = playRadioVoice(ctx!, got.buffer, volume, radioSpecOf(voice!.radio));
            cur.voice = p;
            await p.done;
            if (current !== cur) return;
            if (repeat) {
              cur.timer = setTimeout(() => current === cur && run(false), RESUME_GAP_S * 1000);
              return;
            }
            current = null;
            onChange();
            return;
          }
        }
        if (repeat) run(false);
        else {
          current = null;
          onChange();
        }
      }, (speakNow ? specEnd(spec) + VOICE_GAP_S : repeat ? spec.period : specEnd(spec) + 0.05) * 1000);
    };
    run(true);
    onChange();
  }
}

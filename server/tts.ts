import { execFile } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// TTS 엔진 어댑터(ATC-140, docs/guide/voice.md). 문구 → WAV. 엔진은 별도 프로세스로 부르고(같이 싣지 않는다) 바꿔 끼울 수 있다:
//  - piper: execFile(셸 없음), 문구는 stdin, 5초 제한, 한 번에 하나
//  - stub: 시험용. 소리 없는 톤 WAV를 직접 만든다
//  - none: 엔진 없음
// 엔진이 없거나 목소리가 없으면 예외가 아니라 상태(RenderResult)로 알린다. 서버는 파일만 만들고 소리를 내지 않는다.

export const TTS_ENGINES = ["none", "piper", "stub"] as const;
export type TtsEngineName = (typeof TTS_ENGINES)[number];
export const RENDER_TIMEOUT_MS = 5_000;

export interface TtsConfig {
  engine: string; // ATC_TTS_ENGINE
  piper: string; // ATC_TTS_PIPER: piper 실행 파일 경로
  voices: string; // ATC_TTS_VOICES: 목소리 모델(*.onnx + *.onnx.json)이 든 폴더
  voice: string; // 고른 목소리(ATC_TTS_VOICE). 비면 첫 번째
  tmpDir: string; // piper가 WAV를 쓰는 임시 폴더(캐시 폴더)
  timeoutMs?: number;
  stubDelayMs?: number; // stub만: 이만큼 걸린다(제한 시험용)
}

export type TtsErrorCode = "no-engine" | "no-binary" | "no-voice" | "timeout" | "failed";
export type RenderResult = { ok: true; wav: Buffer } | { ok: false; code: TtsErrorCode; message: string };
export type EngineCheck = { ok: true } | { ok: false; code: TtsErrorCode; message: string };

export interface TtsEngine {
  name: TtsEngineName;
  voices(): string[];
  check(): EngineCheck;
  render(phrase: string, voice: string): Promise<RenderResult>;
}

const fail = (code: TtsErrorCode, message: string): { ok: false; code: TtsErrorCode; message: string } => ({ ok: false, code, message });

// 목소리 이름은 파일 이름(확장자 없이)이고 이 글자만. 화면이 보낸 이름을 경로로 쓰지 않는다
export const VOICE_NAME = /^[\w.-]{1,80}$/;

// ── 한 번에 하나 ──
let queue: Promise<unknown> = Promise.resolve();
const oneAtATime = <T>(job: () => Promise<T>): Promise<T> => {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
};

// ── stub: 0.6초의 사인파 WAV(22050 Hz, 16비트, 모노). 문구 길이로 높이를 조금 바꿔 서로 다르게 만든다 ──
export function stubWav(phrase: string): Buffer {
  const rate = 22050;
  const n = Math.round(rate * 0.6);
  const freq = 300 + (phrase.length % 20) * 20;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // 모노
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 6000 * Math.min(1, i / 200, (n - i) / 200)), 44 + i * 2);
  return buf;
}

const isWav = (b: Buffer) => b.length > 44 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WAVE";

function stubEngine(cfg: TtsConfig): TtsEngine {
  const voices = ["stub", "stub-two"];
  return {
    name: "stub",
    voices: () => voices,
    check: () => ({ ok: true }),
    async render(phrase, voice) {
      if (!voices.includes(voice)) return fail("no-voice", `목소리 없음: ${voice}`);
      const delay = cfg.stubDelayMs ?? 0;
      if (delay > (cfg.timeoutMs ?? RENDER_TIMEOUT_MS)) return fail("timeout", `${(cfg.timeoutMs ?? RENDER_TIMEOUT_MS) / 1000}초 안에 끝나지 않음`);
      return { ok: true, wav: stubWav(phrase) };
    },
  };
}

function noneEngine(): TtsEngine {
  return {
    name: "none",
    voices: () => [],
    check: () => fail("no-engine", "TTS 엔진 없음"),
    render: async () => fail("no-engine", "TTS 엔진 없음"),
  };
}

// 모델 폴더의 목소리: <이름>.onnx와 <이름>.onnx.json이 함께 있는 것
export function piperVoices(dir: string): string[] {
  try {
    const names = new Set(readdirSync(dir));
    return [...names].filter((f) => f.endsWith(".onnx") && names.has(`${f}.json`)).map((f) => f.slice(0, -5)).filter((n) => VOICE_NAME.test(n)).sort();
  } catch {
    return [];
  }
}

function piperEngine(cfg: TtsConfig): TtsEngine {
  const timeout = cfg.timeoutMs ?? RENDER_TIMEOUT_MS;
  const check = (): EngineCheck => {
    try {
      accessSync(cfg.piper, constants.X_OK);
      return { ok: true };
    } catch {
      return fail("no-binary", `piper 실행 파일 없음: ${cfg.piper}`);
    }
  };
  return {
    name: "piper",
    voices: () => piperVoices(cfg.voices),
    check,
    render: (phrase, voice) =>
      oneAtATime(async (): Promise<RenderResult> => {
        const bad = check();
        if (!bad.ok) return bad;
        if (!VOICE_NAME.test(voice) || !piperVoices(cfg.voices).includes(voice)) return fail("no-voice", `목소리 없음: ${voice}`);
        mkdirSync(cfg.tmpDir, { recursive: true });
        const out = join(cfg.tmpDir, `.render-${process.pid}-${Date.now()}.tmp`); // 캐시 정리는 *.wav만 본다
        try {
          const err = await new Promise<(Error & { code?: string | number; killed?: boolean; stderr?: string }) | null>((resolve) => {
            // 셸 없이 인자 배열로. 문구는 명령줄이 아니라 stdin으로 넘긴다
            const child = execFile(cfg.piper, ["-m", join(cfg.voices, `${voice}.onnx`), "-f", out], { timeout, maxBuffer: 1 << 20, encoding: "utf8" }, (e, _stdout, stderr) => {
              resolve(e ? Object.assign(e, { stderr }) : null);
            });
            child.stdin?.on("error", () => {}); // 엔진이 먼저 끝나 닫혀도 예외로 번지지 않게
            child.stdin?.end(`${phrase}\n`);
          });
          if (err) {
            if (err.code === "ENOENT" || err.code === "EACCES") return fail("no-binary", `piper 실행 파일 없음: ${cfg.piper}`);
            if (err.killed) return fail("timeout", `${timeout / 1000}초 안에 끝나지 않음`);
            return fail("failed", (err.stderr?.trim().split("\n").at(-1) || err.message).slice(0, 200));
          }
          const wav = existsSync(out) ? readFileSync(out) : Buffer.alloc(0);
          return isWav(wav) ? { ok: true, wav } : fail("failed", "piper가 WAV를 내지 않음");
        } finally {
          rmSync(out, { force: true });
        }
      }),
  };
}

export function engineOf(cfg: TtsConfig): TtsEngine {
  switch (cfg.engine) {
    case "piper":
      return piperEngine(cfg);
    case "stub":
      return stubEngine(cfg);
    default:
      return noneEngine();
  }
}

// GET /api/voice/status의 본문. 엔진이 없으면 available false와 사유
export interface VoiceStatus {
  engine: TtsEngineName;
  available: boolean;
  error: { code: TtsErrorCode; message: string } | null;
  voices: string[];
  selected: string | null; // 고른 목소리. 설정에 없거나 없어졌으면 첫 번째
}
export function statusOf(cfg: TtsConfig): VoiceStatus {
  const e = engineOf(cfg);
  const check = e.check();
  const voices = check.ok ? e.voices() : [];
  const noVoice = check.ok && !voices.length;
  return {
    engine: e.name,
    available: check.ok && !noVoice,
    error: check.ok ? (noVoice ? { code: "no-voice", message: `목소리 없음: ${cfg.voices}` } : null) : { code: check.code, message: check.message },
    voices,
    selected: voices.includes(cfg.voice) ? cfg.voice : (voices[0] ?? null),
  };
}

// 문구를 WAV로. 고른 목소리(없으면 첫 번째)로 만든다. 부작용: 외부 명령(piper) 실행. 시험은 stub
export async function renderPhrase(cfg: TtsConfig, phrase: string, voice?: string): Promise<RenderResult> {
  const e = engineOf(cfg);
  const check = e.check();
  if (!check.ok) return check;
  const st = statusOf(cfg);
  const use = voice ?? st.selected;
  if (!use) return fail("no-voice", `목소리 없음: ${cfg.voices}`);
  return e.render(phrase, use);
}

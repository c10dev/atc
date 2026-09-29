import { execFile, execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// TTS 엔진 어댑터(ATC-140, docs/guide/voice.md). 문구 → WAV. 엔진은 별도 프로세스로 부르고(같이 싣지 않는다) 바꿔 끼울 수 있다:
//  - piper·espeak·kokoro: execFile(셸 없음), 문구는 stdin, 엔진별 시간 제한, 엔진마다 한 번에 하나(ATC-143)
//    새 엔진은 인자 만들기·목소리 목록 읽기 함수 둘과 execEngine 한 줄이면 된다
//  - stub: 시험용. 소리 없는 톤 WAV를 직접 만든다
//  - none: 엔진 없음
// 엔진이 없거나 목소리가 없으면 예외가 아니라 상태(RenderResult)로 알린다. 서버는 파일만 만들고 소리를 내지 않는다.

export const TTS_ENGINES = ["none", "piper", "espeak", "kokoro", "stub"] as const;
export type TtsEngineName = (typeof TTS_ENGINES)[number];
export const RENDER_TIMEOUT_MS = 5_000;
// 엔진마다 시간 제한이 다르다. kokoro는 프로세스를 새로 띄울 때마다 torch와 모델을 읽어 6~9초 걸려서 20초(ATC-143, docs/guide/voice.md). 같은 문구는 캐시가 있어 다시 기다리지 않는다
export const ENGINE_TIMEOUT_MS: Record<string, number> = { piper: RENDER_TIMEOUT_MS, espeak: RENDER_TIMEOUT_MS, kokoro: 20_000 };

export interface TtsConfig {
  engine: string; // ATC_TTS_ENGINE
  piper: string; // ATC_TTS_PIPER: piper 실행 파일 경로
  voices: string; // ATC_TTS_VOICES: 목소리 모델(*.onnx + *.onnx.json)이 든 폴더
  espeak: string; // ATC_TTS_ESPEAK: espeak-ng 실행 파일 경로
  kokoro: string; // ATC_TTS_KOKORO: Kokoro 래퍼 명령(tts/kokoro-say.py를 venv python으로 부르는 실행 파일)
  kokoroModel: string; // ATC_TTS_KOKORO_MODEL: Kokoro 모델 폴더(config.json, kokoro-v1_0.pth, voices/*.pt)
  voice: string; // 고른 목소리(ATC_TTS_VOICE). 비면 첫 번째
  tmpDir: string; // piper가 WAV를 쓰는 임시 폴더(캐시 폴더)
  timeoutMs?: number; // 있으면 모든 엔진의 제한을 이 값으로(시험용)
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

// ── 엔진마다 한 번에 하나 ──
const queues = new Map<string, Promise<unknown>>();
const oneAtATime = <T>(engine: string, job: () => Promise<T>): Promise<T> => {
  const prev = queues.get(engine) ?? Promise.resolve();
  const run = prev.then(job, job);
  queues.set(engine, run.catch(() => {}));
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
      if (delay > timeoutOf(cfg, "stub")) return fail("timeout", `${timeoutOf(cfg, "stub") / 1000}초 안에 끝나지 않음`);
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

// ── 인자 만들기(순수). 문구는 인자에 없고 stdin으로 간다 ──
export const piperArgs = (cfg: Pick<TtsConfig, "voices">, voice: string, out: string): string[] => ["-m", join(cfg.voices, `${voice}.onnx`), "-f", out];
export const espeakArgs = (voice: string, out: string): string[] => ["-v", voice, "-w", out, "--stdin"];
export const kokoroArgs = (voice: string, out: string): string[] => ["--voice", voice, "--out", out];

// ── 목소리 목록 읽기(순수) ──
// `espeak-ng --voices=en`: 머리줄 다음 "Pty Language Age/Gender VoiceName File Other" 열. -v에 쓰는 것은 Language(en-us, en-gb …)
export function parseEspeakVoices(out: string): string[] {
  const names = out
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(/\s+/)[1] ?? "")
    .filter((n) => VOICE_NAME.test(n));
  return [...new Set(names)].sort();
}
// `kokoro-say --list-voices`: 한 줄에 하나
export function parseKokoroVoices(out: string): string[] {
  return [...new Set(out.split("\n").map((l) => l.trim()).filter((n) => VOICE_NAME.test(n)))].sort();
}

// 목록을 묻는 명령은 짧게 돌고(래퍼는 torch를 읽지 않는다) 결과를 30초 둔다: 상태를 볼 때마다 프로세스를 띄우지 않게
const LIST_TTL_MS = 30_000;
const listCache = new Map<string, { at: number; names: string[] }>();
function listByCommand(bin: string, args: string[], parse: (out: string) => string[], env?: NodeJS.ProcessEnv): string[] {
  const key = `${bin}\0${args.join("\0")}\0${env?.ATC_TTS_KOKORO_MODEL ?? ""}`;
  const hit = listCache.get(key);
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.names;
  let names: string[] = [];
  try {
    names = parse(execFileSync(bin, args, { timeout: 5_000, maxBuffer: 1 << 20, encoding: "utf8", env, stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    names = [];
  }
  listCache.set(key, { at: Date.now(), names });
  return names;
}
export const clearVoiceListCache = () => listCache.clear();

// ── 실행 파일 엔진(piper·espeak·kokoro) 공통 ──
interface ExecSpec {
  name: TtsEngineName;
  bin: string;
  timeout: number;
  tmpDir: string;
  env?: NodeJS.ProcessEnv;
  voices(): string[];
  args(voice: string, out: string): string[];
}

function execEngine(spec: ExecSpec): TtsEngine {
  const { name, bin, timeout } = spec;
  const noBin = () => fail("no-binary", `${name} 실행 파일 없음: ${bin}`);
  const check = (): EngineCheck => {
    try {
      accessSync(bin, constants.X_OK);
      return { ok: true };
    } catch {
      return noBin();
    }
  };
  return {
    name,
    voices: spec.voices,
    check,
    render: (phrase, voice) =>
      oneAtATime(name, async (): Promise<RenderResult> => {
        const bad = check();
        if (!bad.ok) return bad;
        if (!VOICE_NAME.test(voice) || !spec.voices().includes(voice)) return fail("no-voice", `목소리 없음: ${voice}`); // 이름 모양과 엔진이 아는 목록, 둘 다
        mkdirSync(spec.tmpDir, { recursive: true });
        const out = join(spec.tmpDir, `.render-${name}-${process.pid}-${Date.now()}.tmp`); // 캐시 정리는 *.wav만 본다
        try {
          const err = await new Promise<(Error & { code?: string | number; killed?: boolean; stderr?: string }) | null>((resolve) => {
            // 셸 없이 인자 배열로. 문구는 명령줄이 아니라 stdin으로 넘긴다
            const child = execFile(bin, spec.args(voice, out), { timeout, maxBuffer: 1 << 20, encoding: "utf8", env: spec.env }, (e, _stdout, stderr) => {
              resolve(e ? Object.assign(e, { stderr }) : null);
            });
            child.stdin?.on("error", () => {}); // 엔진이 먼저 끝나 닫혀도 예외로 번지지 않게
            child.stdin?.end(`${phrase}\n`);
          });
          if (err) {
            if (err.code === "ENOENT" || err.code === "EACCES") return noBin();
            if (err.killed) return fail("timeout", `${timeout / 1000}초 안에 끝나지 않음`);
            return fail("failed", (err.stderr?.trim().split("\n").at(-1) || err.message).slice(0, 200));
          }
          const wav = existsSync(out) ? readFileSync(out) : Buffer.alloc(0);
          return isWav(wav) ? { ok: true, wav } : fail("failed", `${name}가 WAV를 내지 않음`);
        } finally {
          rmSync(out, { force: true });
        }
      }),
  };
}

const timeoutOf = (cfg: TtsConfig, name: string) => cfg.timeoutMs ?? ENGINE_TIMEOUT_MS[name] ?? RENDER_TIMEOUT_MS;
const build = (cfg: TtsConfig, spec: Omit<ExecSpec, "timeout" | "tmpDir">): TtsEngine => execEngine({ ...spec, timeout: timeoutOf(cfg, spec.name), tmpDir: cfg.tmpDir });

const piperEngine = (cfg: TtsConfig) => build(cfg, { name: "piper", bin: cfg.piper, voices: () => piperVoices(cfg.voices), args: (v, out) => piperArgs(cfg, v, out) });
const espeakEngine = (cfg: TtsConfig) => build(cfg, { name: "espeak", bin: cfg.espeak, voices: () => listByCommand(cfg.espeak, ["--voices=en"], parseEspeakVoices), args: espeakArgs });
const kokoroEngine = (cfg: TtsConfig) => {
  const env = { ...process.env, ATC_TTS_KOKORO_MODEL: cfg.kokoroModel }; // 모델 경로는 .env.local에서만 온다
  return build(cfg, { name: "kokoro", bin: cfg.kokoro, env, voices: () => listByCommand(cfg.kokoro, ["--list-voices"], parseKokoroVoices, env), args: kokoroArgs });
};

export function engineOf(cfg: TtsConfig): TtsEngine {
  switch (cfg.engine) {
    case "piper":
      return piperEngine(cfg);
    case "espeak":
      return espeakEngine(cfg);
    case "kokoro":
      return kokoroEngine(cfg);
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

// GET /api/voice/status의 엔진별 표(ATC-143): 고를 수 있는 엔진마다 쓸 수 있는지와 그 엔진이 아는 목소리. stub은 지금 고른 것일 때만 나온다
export interface EngineInfo {
  engine: TtsEngineName;
  available: boolean;
  error: { code: TtsErrorCode; message: string } | null;
  voices: string[];
}
export interface VoiceStatusAll extends VoiceStatus {
  engines: EngineInfo[];
}
export function voiceStatusOf(cfg: TtsConfig): VoiceStatusAll {
  const names: TtsEngineName[] = ["piper", "espeak", "kokoro", ...(cfg.engine === "stub" ? (["stub"] as const) : [])];
  const engines = names.map((n) => {
    const s = statusOf({ ...cfg, engine: n });
    return { engine: n, available: s.available, error: s.error, voices: s.voices };
  });
  return { ...statusOf(cfg), engines };
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

import { join } from "node:path";
import type { Context, Hono } from "hono";
import { config } from "./config.ts";
import type { SupervisorAlert } from "./supervisor-alerts.ts";
import { cacheKey, getCached, putCached } from "./voice-cache.ts";
import { PREVIEW_PHRASE, phraseOf } from "./voice-phrase.ts";
import { type RenderResult, renderPhrase, statusOf, type TtsConfig, VOICE_NAME } from "./tts.ts";

// 음성 콜아웃 API(ATC-140, docs/guide/voice.md). 서버는 WAV 파일만 만들어 주고 소리를 내지 않는다(서비스에는 오디오 세션이 없다).
// 알림 데이터는 읽기만 한다. 화면은 알림의 key만 보내고 글은 보내지 않는다: 문구는 서버가 그 key의 알림에서 다시 만든다.
//   GET /api/voice/status                  엔진·설치된 목소리·고른 목소리·오류
//   GET /api/voice/alert/:key.wav          지금 있는 알림 key의 문구를 WAV로(WARNING·CALL 종류만 문구가 있다)
//   GET /api/voice/preview.wav?voice=      고정 예시 문구(목소리 고르기용)

export const ttsConfigNow = (): TtsConfig => ({
  engine: config.ttsEngine,
  piper: config.ttsPiper,
  voices: config.ttsVoices,
  voice: config.ttsVoice,
  tmpDir: join(config.stateDir, "voice-cache"),
});

const cacheDir = () => join(config.stateDir, "voice-cache");
const inflight = new Map<string, Promise<RenderResult>>();

// 캐시에서, 없으면 엔진으로 만들어 캐시에 둔다. 같은 문구를 동시에 만들지 않는다
export async function wavFor(cfg: TtsConfig, phrase: string, voice?: string): Promise<RenderResult> {
  const st = statusOf(cfg);
  if (!st.available) return { ok: false, code: st.error?.code ?? "no-engine", message: st.error?.message ?? "TTS 엔진 없음" };
  const use = voice ?? st.selected!;
  const key = cacheKey(st.engine, use, phrase);
  const hit = getCached(cacheDir(), key);
  if (hit) return { ok: true, wav: hit };
  const pending = inflight.get(key) ?? renderPhrase(cfg, phrase, use).then((r) => {
    if (r.ok) putCached(cacheDir(), key, r.wav);
    return r;
  });
  inflight.set(key, pending);
  try {
    return await pending;
  } finally {
    inflight.delete(key);
  }
}

const wav = (c: Context, bytes: Buffer) => c.body(new Uint8Array(bytes), 200, { "content-type": "audio/wav", "cache-control": "private, max-age=600" });

export function mountVoice(app: Hono, currentAlerts: () => SupervisorAlert[], cfgOf: () => TtsConfig = ttsConfigNow) {
  app.get("/api/voice/status", (c) => c.json(statusOf(cfgOf())));

  app.get("/api/voice/alert/:key", async (c) => {
    const raw = c.req.param("key");
    if (!raw.endsWith(".wav")) return c.json({ error: "주소는 <알림 key>.wav" }, 400);
    const key = raw.slice(0, -4);
    const alert = currentAlerts().find((a) => a.key === key);
    if (!alert) return c.json({ error: "지금 있는 알림이 아님" }, 404);
    const phrase = phraseOf(alert);
    if (!phrase) return c.json({ error: "이 알림은 음성이 없음(소리만)" }, 404);
    const r = await wavFor(cfgOf(), phrase);
    return r.ok ? wav(c, r.wav) : c.json({ error: r.message, code: r.code }, 503);
  });

  app.get("/api/voice/preview.wav", async (c) => {
    const cfg = cfgOf();
    const voice = c.req.query("voice");
    if (voice !== undefined && !VOICE_NAME.test(voice)) return c.json({ error: "목소리 이름이 올바르지 않음" }, 400);
    const st = statusOf(cfg);
    if (st.available && voice !== undefined && !st.voices.includes(voice)) return c.json({ error: `목소리 없음: ${voice}`, code: "no-voice" }, 404);
    const r = await wavFor(cfg, PREVIEW_PHRASE, voice);
    return r.ok ? wav(c, r.wav) : c.json({ error: r.message, code: r.code }, 503);
  });
}

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Hono } from "hono";
import { config } from "./config.ts";
import type { SupervisorAlert } from "./supervisor-alerts.ts";
import type { TtsConfig } from "./tts.ts";
import { PREVIEW_PHRASE } from "./voice-phrase.ts";
import { mountVoice } from "./voice-run.ts";

// 음성 API(ATC-140): 임시 상태 폴더, stub 엔진. 지금 있는 알림의 key만 받고, 글은 받지 않는다
const dir = mkdtempSync(join(tmpdir(), "atc-voice-"));
config.stateDir = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const alert = (key: string, over: Partial<SupervisorAlert> = {}): SupervisorAlert => ({ key, group: "alert", level: "warning", cue: null, aircraft: "TEAM_G", flight: "ATC-120", text: "충돌: 한국어 문구", next: "", link: "#strips", since: null, ...over });
const alerts = [
  alert("alert|conflict|/w/atc-120|ATC-120|s1"),
  alert("pending|humancheck|o/r#5|abc", { group: "pending", level: "advisory", cue: "call", aircraft: null, flight: "ATC-5" }),
  alert("following|ATC-9|no-pr", { group: "following", level: "caution" }), // 틀이 없는 종류
];
let cfg: TtsConfig = { engine: "stub", piper: "/none", voices: "/none", espeak: "/none", kokoro: "/none", kokoroModel: "/none", voice: "", tmpDir: join(dir, "voice-cache") };
const app = new Hono();
mountVoice(app, () => alerts, () => cfg);
const get = (path: string) => app.request(path);
const wavUrl = (key: string) => `/api/voice/alert/${encodeURIComponent(key)}.wav`;

test("GET /api/voice/status: 엔진, 설치된 목소리, 고른 목소리", async () => {
  const s = await (await get("/api/voice/status")).json();
  const { engines, ...current } = s;
  assert.deepEqual(current, { engine: "stub", available: true, error: null, voices: ["stub", "stub-two"], selected: "stub" });
  // 엔진마다 쓸 수 있는지와 사유(ATC-143). 이 시험 설정에서 piper·espeak·kokoro는 실행 파일이 없다
  assert.deepEqual(engines.map((e: { engine: string; available: boolean }) => [e.engine, e.available]), [["piper", false], ["espeak", false], ["kokoro", false], ["stub", true]]);
  assert.equal(engines[1].error.code, "no-binary");
  cfg = { ...cfg, voice: "stub-two" };
  assert.equal((await (await get("/api/voice/status")).json()).selected, "stub-two");
  cfg = { ...cfg, voice: "" };
});

test("GET /api/voice/alert/:key.wav: 지금 있는 알림의 문구를 WAV로(슬래시·#·| 가 든 key도)", async () => {
  for (const key of [alerts[0].key, alerts[1].key]) {
    const r = await get(wavUrl(key));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "audio/wav");
    const bytes = Buffer.from(await r.arrayBuffer());
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
  }
});

test("지금 있는 알림이 아닌 key, 문구 틀이 없는 종류, 주소 모양이 틀린 것은 거절한다", async () => {
  const unknown = await get(wavUrl("alert|conflict|/w/other|ATC-999|s9"));
  assert.equal(unknown.status, 404);
  assert.match((await unknown.json()).error, /지금 있는 알림이 아님/);
  const noPhrase = await get(wavUrl(alerts[2].key));
  assert.equal(noPhrase.status, 404);
  assert.match((await noPhrase.json()).error, /음성이 없음/);
  assert.equal((await get(`/api/voice/alert/${encodeURIComponent(alerts[0].key)}`)).status, 400); // .wav 없음
  // 글을 보낼 자리는 없다: 쿼리·본문으로 문구를 넘겨도 무시된다
  const withText = await get(`${wavUrl(alerts[0].key)}?phrase=hello&text=hello`);
  assert.equal(withText.status, 200);
});

test("엔진이 없으면 503과 사유(예외가 아니다), 미리 듣기는 고정 문구와 이름을 검사한다", async () => {
  cfg = { ...cfg, engine: "none" };
  const none = await get(wavUrl(alerts[0].key));
  assert.equal(none.status, 503);
  assert.deepEqual(await none.json(), { error: "TTS 엔진 없음", code: "no-engine" });
  assert.equal((await get("/api/voice/preview.wav")).status, 503);
  cfg = { ...cfg, engine: "stub" };
  const p = await get("/api/voice/preview.wav");
  assert.equal(p.status, 200);
  assert.equal(p.headers.get("content-type"), "audio/wav");
  assert.equal((await get("/api/voice/preview.wav?voice=stub-two")).status, 200);
  const missing = await get("/api/voice/preview.wav?voice=nope");
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "no-voice");
  assert.equal((await get(`/api/voice/preview.wav?voice=${encodeURIComponent("../../etc/passwd")}`)).status, 400);
  assert.ok(PREVIEW_PHRASE.length > 10);
  // 엔진을 지정한 미리 듣기(ATC-143): 모르는 이름과 none은 400, 실행 파일이 없는 엔진은 503 no-binary
  assert.equal((await get("/api/voice/preview.wav?engine=evil")).status, 400);
  assert.equal((await get("/api/voice/preview.wav?engine=none")).status, 400);
  const noBin = await get("/api/voice/preview.wav?engine=espeak");
  assert.equal(noBin.status, 503);
  assert.equal((await noBin.json()).code, "no-binary");
  assert.equal((await get("/api/voice/preview.wav?engine=stub")).status, 200);
});

test("만든 WAV는 상태 폴더의 voice-cache/에 남고 같은 문구는 다시 만들지 않는다", async () => {
  const cacheDir = join(dir, "voice-cache");
  const before = readdirSync(cacheDir).filter((f) => f.endsWith(".wav")).length;
  assert.ok(before >= 3, "위에서 만든 WAV가 캐시에 있다");
  await get(wavUrl(alerts[0].key));
  await get("/api/voice/preview.wav");
  assert.equal(readdirSync(cacheDir).filter((f) => f.endsWith(".wav")).length, before); // 같은 문구는 같은 파일
  // 엔진·목소리가 다르면 다른 파일
  cfg = { ...cfg, voice: "stub-two" };
  await get(wavUrl(alerts[0].key));
  assert.equal(readdirSync(cacheDir).filter((f) => f.endsWith(".wav")).length, before + 1);
  cfg = { ...cfg, voice: "" };
});

test("WARNING이나 CALL이 아닌 알림은 문구 틀이 있어도 만들지 않는다(CAUTION 404, 클라이언트 soundFor와 같은 규칙)", async () => {
  const stalled = alert("alert|health|STALLED|s1", { level: "caution", cue: null }); // phraseOf에 틀이 있다
  const local = new Hono();
  mountVoice(local, () => [stalled, ...alerts], () => cfg);
  const r = await local.request(wavUrl(stalled.key));
  assert.equal(r.status, 404);
  assert.match((await r.json()).error, /WARNING·CALL/);
  // 같은 틀이 WARNING 등급이면 만든다
  const warn = new Hono();
  mountVoice(warn, () => [{ ...stalled, level: "warning" }], () => cfg);
  assert.equal((await warn.request(wavUrl(stalled.key))).status, 200);
});

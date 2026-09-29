import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { clearVoiceListCache, ENGINE_TIMEOUT_MS, engineOf, espeakArgs, kokoroArgs, parseEspeakVoices, parseKokoroVoices, piperArgs, piperVoices, renderPhrase, RENDER_TIMEOUT_MS, statusOf, stubWav, type TtsConfig, voiceStatusOf } from "./tts.ts";
import { cacheKey, CACHE_MAX_BYTES, CACHE_MAX_FILES, getCached, pruneCache, putCached } from "./voice-cache.ts";

// TTS 어댑터와 음성 캐시(ATC-140). 진짜 piper는 설치하지 않는다: 시험은 stub 엔진과, piper처럼 인자를 받는 가짜 실행 파일을 쓴다.
const root = mkdtempSync(join(tmpdir(), "atc-tts-"));
after(() => rmSync(root, { recursive: true, force: true }));

const voices = join(root, "voices");
mkdirSync(voices);
for (const v of ["en_US-a", "en_US-b"]) {
  writeFileSync(join(voices, `${v}.onnx`), "model");
  writeFileSync(join(voices, `${v}.onnx.json`), "{}");
}
writeFileSync(join(voices, "orphan.onnx"), "model"); // .onnx.json이 없으면 목소리로 치지 않는다
writeFileSync(join(voices, "bad name.onnx"), "model");
writeFileSync(join(voices, "bad name.onnx.json"), "{}");

// 가짜 piper: -m·-f를 읽고, stdin과 인자를 로그에 남기고, WAV를 쓴다. FAKE_PIPER_SLEEP_MS면 그만큼 잔다
const LOG = join(root, "fake-piper.log");
const fake = join(root, "fake-piper");
writeFileSync(
  fake,
  `#!/usr/bin/env node
const fs = require("fs");
const a = process.argv.slice(2);
const out = a[a.indexOf("-f") + 1];
let text = "";
process.stdin.on("data", (d) => (text += d));
process.stdin.on("end", () => {
  fs.appendFileSync(${JSON.stringify(LOG)}, JSON.stringify({ args: a, text }) + "\\n");
  const go = () => {
    if (process.env.FAKE_PIPER_FAIL) { console.error("boom: model failed to load"); process.exit(3); }
    if (process.env.FAKE_PIPER_NOWAV) return process.exit(0);
    const wav = Buffer.alloc(44 + 200);
    wav.write("RIFF", 0); wav.writeUInt32LE(36 + 200, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(22050, 24); wav.writeUInt32LE(44100, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(200, 40);
    fs.writeFileSync(out, wav);
  };
  const ms = Number(process.env.FAKE_PIPER_SLEEP_MS || 0);
  ms ? setTimeout(go, ms) : go();
});
`,
);
chmodSync(fake, 0o755);
// 가짜 espeak-ng·kokoro-say(ATC-143): 목록 요청(--voices=en, --list-voices)에는 이름을 찍고, 아니면 -w나 --out 파일에 WAV를 쓴다. 인자와 stdin, 받은 ATC_TTS_KOKORO_MODEL을 로그에 남긴다
const LOG2 = join(root, "fake-multi.log");
const fakeMulti = join(root, "fake-multi");
writeFileSync(
  fakeMulti,
  `#!/usr/bin/env node
const fs = require("fs");
const a = process.argv.slice(2);
if (a.includes("--voices=en")) return console.log("Pty Language       Age/Gender VoiceName          File                 Other Languages\\n 5  en-gb          M  English_(Great_Britain) gmw/en  (en 2)\\n 2  en-us          M  English_(America)   gmw/en-US (en 3)\\n 5  en-gb-scotland M  English_(Scotland)   gmw/en-GB-scotland (en 4)\\n 5  en-us          M  dup                 x");
if (a.includes("--list-voices")) return console.log("af_heart\\nam_michael\\n\\nbad name\\naf_heart\\n../x");
const out = a[a.includes("-w") ? a.indexOf("-w") + 1 : a.indexOf("--out") + 1];
let text = "";
process.stdin.on("data", (d) => (text += d));
process.stdin.on("end", () => {
  fs.appendFileSync(${JSON.stringify(LOG2)}, JSON.stringify({ args: a, text, model: process.env.ATC_TTS_KOKORO_MODEL }) + "\\n");
  const go = () => {
    const wav = Buffer.alloc(44 + 200);
    wav.write("RIFF", 0); wav.writeUInt32LE(36 + 200, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(22050, 24); wav.writeUInt32LE(44100, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(200, 40);
    fs.writeFileSync(out, wav);
  };
  const ms = Number(process.env.FAKE_MULTI_SLEEP_MS || 0);
  ms ? setTimeout(go, ms) : go();
});
`,
);
chmodSync(fakeMulti, 0o755);
const cfg = (over: Partial<TtsConfig> = {}): TtsConfig => ({ engine: "piper", piper: fake, voices, espeak: fakeMulti, kokoro: fakeMulti, kokoroModel: join(root, "kokoro-model"), voice: "", tmpDir: join(root, "tmp"), timeoutMs: 3000, ...over });
const logged2 = () => (existsSync(LOG2) ? readFileSync(LOG2, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
const logged = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);

test("piperVoices: .onnx와 .onnx.json이 함께 있고 이름이 올바른 것만", () => {
  assert.deepEqual(piperVoices(voices), ["en_US-a", "en_US-b"]);
  assert.deepEqual(piperVoices(join(root, "nope")), []);
});

test("piper: 셸 없이 인자 배열로, 문구는 stdin으로, 고른 목소리 모델로 WAV를 만든다", async () => {
  const r = await renderPhrase(cfg({ voice: "en_US-b" }), "Supervisor, GOLF; rm -rf / $(whoami).");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.wav.toString("ascii", 0, 4), "RIFF");
  const [entry] = logged();
  assert.deepEqual(entry.args.slice(0, 2), ["-m", join(voices, "en_US-b.onnx")]); // -m·-f는 옛 piper 실행 파일과 새 piper-tts가 함께 받는 짧은 옵션
  assert.equal(entry.args[2], "-f");
  assert.equal(entry.text, "Supervisor, GOLF; rm -rf / $(whoami).\n"); // 문구는 그대로 stdin에(명령줄에 없다)
  assert.equal(entry.args.some((x: string) => x.includes("rm -rf")), false);
  assert.deepEqual(readdirSync(join(root, "tmp")), []); // 임시 파일은 지운다
});

test("상태: 엔진 없음, piper 실행 파일 없음, 목소리 없음은 예외가 아니라 상태", async () => {
  assert.deepEqual(statusOf(cfg({ engine: "none" })), { engine: "none", available: false, error: { code: "no-engine", message: "TTS 엔진 없음" }, voices: [], selected: null });
  assert.deepEqual(statusOf(cfg({ engine: "" })).engine, "none"); // 모르는 엔진 이름도 없음으로
  const noBin = statusOf(cfg({ piper: join(root, "missing-piper") }));
  assert.equal(noBin.available, false);
  assert.equal(noBin.error?.code, "no-binary");
  assert.match(noBin.error!.message, /missing-piper/);
  const noVoice = statusOf(cfg({ voices: join(root, "no-voices") }));
  assert.equal(noVoice.available, false);
  assert.equal(noVoice.error?.code, "no-voice");
  const ok = statusOf(cfg({ voice: "en_US-b" }));
  assert.deepEqual([ok.available, ok.error, ok.voices, ok.selected], [true, null, ["en_US-a", "en_US-b"], "en_US-b"]);
  assert.equal(statusOf(cfg({ voice: "gone" })).selected, "en_US-a"); // 없어진 목소리는 첫 번째로
  // 렌더도 예외 없이 상태로
  assert.deepEqual(await renderPhrase(cfg({ engine: "none" }), "x"), { ok: false, code: "no-engine", message: "TTS 엔진 없음" });
  const r = await renderPhrase(cfg({ piper: join(root, "missing-piper") }), "x");
  assert.equal(r.ok === false && r.code, "no-binary");
  const v = await renderPhrase(cfg(), "x", "nope");
  assert.equal(v.ok === false && v.code, "no-voice");
  const traversal = await renderPhrase(cfg(), "x", "../../etc/passwd");
  assert.equal(traversal.ok === false && traversal.code, "no-voice");
});

test("piper: 5초 제한(시험은 짧게)을 넘으면 timeout, 엔진이 실패하거나 WAV를 안 내면 failed", async () => {
  process.env.FAKE_PIPER_SLEEP_MS = "1500";
  const t0 = Date.now();
  const slow = await renderPhrase(cfg({ timeoutMs: 200 }), "x");
  assert.equal(slow.ok === false && slow.code, "timeout");
  assert.ok(Date.now() - t0 < 1400, "제한 시간에 끊어야 한다");
  delete process.env.FAKE_PIPER_SLEEP_MS;
  process.env.FAKE_PIPER_FAIL = "1";
  const boom = await renderPhrase(cfg(), "x");
  assert.equal(boom.ok === false && boom.code, "failed");
  assert.match(boom.ok === false ? boom.message : "", /boom: model failed to load/);
  delete process.env.FAKE_PIPER_FAIL;
  process.env.FAKE_PIPER_NOWAV = "1";
  const nowav = await renderPhrase(cfg(), "x");
  assert.equal(nowav.ok === false && nowav.code, "failed");
  delete process.env.FAKE_PIPER_NOWAV;
  assert.equal(RENDER_TIMEOUT_MS, 5000);
  assert.equal((await renderPhrase(cfg(), "again")).ok, true); // 실패 뒤에도 다음 렌더는 된다
});

test("piper: 한 번에 하나만 돈다(겹치지 않고 차례로)", async () => {
  process.env.FAKE_PIPER_SLEEP_MS = "150";
  const t0 = Date.now();
  const rs = await Promise.all([renderPhrase(cfg(), "one"), renderPhrase(cfg(), "two"), renderPhrase(cfg(), "three")]);
  delete process.env.FAKE_PIPER_SLEEP_MS;
  assert.deepEqual(rs.map((r) => r.ok), [true, true, true]);
  assert.ok(Date.now() - t0 >= 400, "세 번이 겹치지 않고 차례로 돌아야 한다(150ms씩)");
});

test("stub: WAV를 만들고, 없는 목소리는 no-voice, 제한을 넘는 지연은 timeout", async () => {
  const c = cfg({ engine: "stub" });
  const r = await renderPhrase(c, "Supervisor, GOLF, radio check.");
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.wav, stubWav("Supervisor, GOLF, radio check."));
  assert.deepEqual(engineOf(c).voices(), ["stub", "stub-two"]);
  const missing = await renderPhrase(c, "x", "nope");
  assert.equal(missing.ok === false && missing.code, "no-voice");
  const late = await renderPhrase({ ...c, stubDelayMs: 6000 }, "x");
  assert.equal(late.ok === false && late.code, "timeout");
  assert.equal(statusOf(c).available, true);
});

test("인자 만들기(순수): 문구는 인자에 없다", () => {
  assert.deepEqual(piperArgs({ voices: "/v" }, "en_US-a", "/o"), ["-m", "/v/en_US-a.onnx", "-f", "/o"]);
  assert.deepEqual(espeakArgs("en-us", "/o"), ["-v", "en-us", "-w", "/o", "--stdin"]);
  assert.deepEqual(kokoroArgs("af_heart", "/o"), ["--voice", "af_heart", "--out", "/o"]);
});

test("목소리 목록 읽기(순수): espeak-ng --voices=en, kokoro-say --list-voices", () => {
  const espeak = "Pty Language       Age/Gender VoiceName          File                 Other Languages\n 5  en-gb          M  English_(Great_Britain) gmw/en  (en 2)\n 2  en-us          M  English_(America)   gmw/en-US (en 3)\n 5  en-us          M  dup   x\n 5  en-029         M  English_(Caribbean) gmw/en-029\n";
  assert.deepEqual(parseEspeakVoices(espeak), ["en-029", "en-gb", "en-us"]); // 머리줄은 빼고, 중복 없이, 정렬
  assert.deepEqual(parseEspeakVoices(""), []);
  assert.deepEqual(parseEspeakVoices("Pty Language\n 5  bad/name  M  x\n"), []); // VOICE_NAME에 안 맞으면 뺀다
  assert.deepEqual(parseKokoroVoices("af_heart\nam_michael\n\nbad name\naf_heart\n../x\n"), ["af_heart", "am_michael"]);
  assert.deepEqual(parseKokoroVoices(""), []);
});

test("espeak: 셸 없이 인자 배열로, 문구는 stdin, 엔진이 아는 목소리만", async () => {
  clearVoiceListCache();
  const c = cfg({ engine: "espeak", voice: "en-gb" });
  assert.deepEqual(statusOf(c).voices, ["en-gb", "en-gb-scotland", "en-us"]);
  const r = await renderPhrase(c, "Supervisor, GOLF; $(whoami).");
  assert.equal(r.ok, true);
  const e = logged2().at(-1);
  assert.deepEqual(e.args.slice(0, 3), ["-v", "en-gb", "-w"]);
  assert.equal(e.args.at(-1), "--stdin");
  assert.equal(e.text, "Supervisor, GOLF; $(whoami).\n");
  assert.equal(e.args.some((x: string) => x.includes("whoami")), false);
  for (const bad of ["nope", "../../etc/passwd", "en-us;rm"]) {
    const v = await renderPhrase(c, "x", bad);
    assert.equal(v.ok === false && v.code, "no-voice", bad);
  }
  assert.equal(statusOf(cfg({ engine: "espeak", espeak: join(root, "no-espeak") })).error?.code, "no-binary");
});

test("kokoro: 래퍼에 --voice·--out, 모델 폴더는 환경변수(설정에서만), 목록은 --list-voices", async () => {
  clearVoiceListCache();
  const c = cfg({ engine: "kokoro", voice: "am_michael" });
  const st = statusOf(c);
  assert.deepEqual([st.available, st.voices, st.selected], [true, ["af_heart", "am_michael"], "am_michael"]);
  const r = await renderPhrase(c, "Supervisor, GOLF, standing by for approval.");
  assert.equal(r.ok, true);
  const e = logged2().at(-1);
  assert.deepEqual(e.args.slice(0, 2), ["--voice", "am_michael"]);
  assert.equal(e.args[2], "--out");
  assert.equal(e.model, join(root, "kokoro-model"));
  assert.equal(e.text, "Supervisor, GOLF, standing by for approval.\n");
  const bad = await renderPhrase(c, "x", "bf_emma"); // 이름 모양은 맞아도 래퍼 목록에 없다
  assert.equal(bad.ok === false && bad.code, "no-voice");
  assert.equal((await renderPhrase(cfg({ engine: "kokoro", kokoro: join(root, "no-kokoro") }), "x")).ok, false);
  assert.deepEqual(readdirSync(join(root, "tmp")), []);
});

test("엔진별 시간 제한: kokoro만 길다, 넘으면 timeout, 엔진마다 따로 한 번에 하나", async () => {
  assert.deepEqual([ENGINE_TIMEOUT_MS.piper, ENGINE_TIMEOUT_MS.espeak, ENGINE_TIMEOUT_MS.kokoro], [5000, 5000, 20000]);
  clearVoiceListCache();
  process.env.FAKE_MULTI_SLEEP_MS = "1500";
  const t0 = Date.now();
  const slow = await renderPhrase(cfg({ engine: "kokoro", voice: "af_heart", timeoutMs: 200 }), "x");
  assert.equal(slow.ok === false && slow.code, "timeout");
  assert.ok(Date.now() - t0 < 1400);
  process.env.FAKE_MULTI_SLEEP_MS = "150";
  const t1 = Date.now();
  const rs = await Promise.all([renderPhrase(cfg({ engine: "espeak", voice: "en-us" }), "a"), renderPhrase(cfg({ engine: "espeak", voice: "en-us" }), "b"), renderPhrase(cfg({ engine: "kokoro", voice: "af_heart" }), "c")]);
  delete process.env.FAKE_MULTI_SLEEP_MS;
  assert.deepEqual(rs.map((r) => r.ok), [true, true, true]);
  const took = Date.now() - t1;
  assert.ok(took >= 290 && took < 700, `espeak 둘은 차례로(300ms), kokoro는 그 옆에서 함께(${took}ms)`);
});

test("voiceStatusOf: 엔진마다 쓸 수 있는지와 목소리, 없는 엔진은 사유", () => {
  clearVoiceListCache();
  const s = voiceStatusOf(cfg({ engine: "espeak", voice: "en-us", kokoro: join(root, "no-kokoro"), piper: join(root, "no-piper") }));
  assert.equal(s.engine, "espeak");
  assert.deepEqual(s.engines.map((e) => [e.engine, e.available]), [["piper", false], ["espeak", true], ["kokoro", false]]);
  assert.equal(s.engines[0].error?.code, "no-binary");
  assert.deepEqual(s.engines[1].voices, ["en-gb", "en-gb-scotland", "en-us"]);
  assert.deepEqual(s.engines[2].voices, []);
  assert.deepEqual(voiceStatusOf(cfg({ engine: "stub" })).engines.map((e) => e.engine), ["piper", "espeak", "kokoro", "stub"]);
  assert.deepEqual(voiceStatusOf(cfg({ engine: "none" })).engines.map((e) => e.engine), ["piper", "espeak", "kokoro"]);
});

test("캐시 키는 엔진·목소리·문구로 정해진다", () => {
  assert.notEqual(cacheKey("espeak", "en-us", "hello"), cacheKey("kokoro", "en-us", "hello")); // 엔진이 다르면 같은 이름·문구여도 다른 키
  const k = cacheKey("piper", "en_US-a", "hello");
  assert.equal(k, cacheKey("piper", "en_US-a", "hello"));
  for (const other of [cacheKey("stub", "en_US-a", "hello"), cacheKey("piper", "en_US-b", "hello"), cacheKey("piper", "en_US-a", "hello!")]) assert.notEqual(k, other);
  assert.match(k, /^[0-9a-f]{40}$/);
});

test("캐시: 넣고 꺼내고, 200개·20 MB를 넘으면 오래된 것부터 지운다", () => {
  const dir = join(root, "cache");
  assert.equal(CACHE_MAX_FILES, 200);
  assert.equal(CACHE_MAX_BYTES, 20 * 1024 * 1024);
  assert.equal(getCached(dir, "none"), null);
  putCached(dir, "k1", Buffer.from("abc"));
  assert.deepEqual(getCached(dir, "k1"), Buffer.from("abc"));

  // 개수 상한: 5개로 줄인 상한에 10개를 넣으면 가장 오래된 5개가 빠진다
  const d2 = join(root, "cache2");
  for (let i = 0; i < 10; i++) {
    putCached(d2, `f${i}`, Buffer.from("x"), 5);
    const t = new Date(Date.now() - (10 - i) * 60_000); // i가 클수록 최근
    utimesSync(join(d2, `f${i}.wav`), t, t);
  }
  assert.deepEqual(readdirSync(d2).sort(), ["f5.wav", "f6.wav", "f7.wav", "f8.wav", "f9.wav"]);

  // 크기 상한: 10바이트 상한에 4바이트 파일 4개 → 오래된 것부터 빠져 8바이트가 남는다
  const d3 = join(root, "cache3");
  mkdirSync(d3);
  for (let i = 0; i < 4; i++) {
    writeFileSync(join(d3, `s${i}.wav`), "abcd");
    const t = new Date(Date.now() - (10 - i) * 60_000);
    utimesSync(join(d3, `s${i}.wav`), t, t);
  }
  assert.equal(pruneCache(d3, 200, 10), 2);
  assert.deepEqual(readdirSync(d3).sort(), ["s2.wav", "s3.wav"]);
  assert.equal(readdirSync(d3).reduce((s, f) => s + statSync(join(d3, f)).size, 0), 8);

  // 꺼낸 것은 쓴 시각이 갱신돼 남는다
  const d4 = join(root, "cache4");
  putCached(d4, "old", Buffer.from("o"));
  putCached(d4, "new", Buffer.from("n"));
  const past = new Date(Date.now() - 3_600_000);
  utimesSync(join(d4, "old.wav"), past, past);
  utimesSync(join(d4, "new.wav"), new Date(Date.now() - 1_800_000), new Date(Date.now() - 1_800_000));
  getCached(d4, "old");
  pruneCache(d4, 1);
  assert.deepEqual(readdirSync(d4), ["old.wav"]);
  // 임시 파일과 캐시가 아닌 파일은 세지도 지우지도 않는다
  writeFileSync(join(d4, ".render-1.tmp"), "x");
  pruneCache(d4, 0);
  assert.deepEqual(readdirSync(d4), [".render-1.tmp"]);
});

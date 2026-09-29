import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { mergeEnv, validatePatch } from "./settings.ts";

test("값 검사: 맞는 값은 환경 변수로, 틀린 값은 항목별 오류로", () => {
  const ok = validatePatch({ teamKey: " voc ", claimTtlMin: 120, handoffGraceMin: 0 });
  assert.deepEqual(ok.errors, {});
  assert.deepEqual(ok.env, {
    LINEAR_TEAM_KEY: "VOC",
    ATC_CLAIM_TTL_MIN: "120",
    ATC_HANDOFF_GRACE_MIN: "0",
  });

  const bad = validatePatch({ teamKey: "1X", landingState: 'Say "hi"', claimTtlMin: 2, handoffGraceMin: 1.5, projectsDir: "relative/dir", color: "red" });
  assert.deepEqual(Object.keys(bad.errors).sort(), ["claimTtlMin", "color", "handoffGraceMin", "landingState", "projectsDir", "teamKey"]);
  // LANDING SEQUENCE는 GitHub PR 기준이라 Linear 상태 설정(landingState)은 없어졌다
  assert.equal((bad.errors as Record<string, string>).landingState, "고칠 수 없는 항목");
  assert.deepEqual(bad.env, {});
});

test("음성 엔진(ATC-143): 새 엔진 이름은 받고, 모르는 이름은 오류, 엔진 경로는 화면에서 못 바꾼다", () => {
  for (const e of ["none", "piper", "espeak", "kokoro", "stub"]) assert.deepEqual(validatePatch({ ttsEngine: e }).env, { ATC_TTS_ENGINE: e });
  assert.ok(validatePatch({ ttsEngine: "festival" }).errors.ttsEngine);
  assert.ok(validatePatch({ ttsEngine: "espeak; rm -rf /" }).errors.ttsEngine);
  assert.deepEqual(validatePatch({ ttsVoice: "en-us" }).env, { ATC_TTS_VOICE: "en-us" });
  assert.deepEqual(validatePatch({ ttsVoice: "af_heart" }).env, { ATC_TTS_VOICE: "af_heart" });
  for (const key of ["ttsEspeak", "ttsKokoro", "ttsKokoroModel", "ttsPiper"]) {
    const r = validatePatch({ [key]: "/tmp/evil" } as never);
    assert.equal((r.errors as Record<string, string>)[key], "고칠 수 없는 항목", key);
    assert.deepEqual(r.env, {});
  }
});

test("API 키: 공백 없는 문자열이면 저장, null이면 삭제", () => {
  assert.deepEqual(validatePatch({ apiKey: " lin_api_abcdef123 " }).env, { LINEAR_API_KEY: "lin_api_abcdef123" });
  assert.deepEqual(validatePatch({ apiKey: null }).env, { LINEAR_API_KEY: null });
  assert.ok(validatePatch({ apiKey: "has space inside" }).errors.apiKey);
});

test("AIRPORT 폴더: 있는 폴더의 절대 경로만, ~는 홈으로", () => {
  assert.deepEqual(validatePatch({ projectsDir: `${tmpdir()}/` }).env, { ATC_PROJECTS_DIR: tmpdir() });
  assert.ok(validatePatch({ projectsDir: "/no/such/folder/atc" }).errors.projectsDir);
});

test(".env.local 병합: 있는 줄은 바꾸고, 없는 키는 끝에 붙이고, null은 지운다. 주석은 그대로", () => {
  const before = "# atc\nLINEAR_API_KEY=old\nexport LINEAR_TEAM_KEY=VOC\n";
  const after = mergeEnv(before, { LINEAR_TEAM_KEY: "ABC", EXAMPLE_NAME: "Two Words", LINEAR_API_KEY: null });
  assert.equal(after, '# atc\nLINEAR_TEAM_KEY=ABC\nEXAMPLE_NAME="Two Words"\n');
  assert.equal(mergeEnv("", { ATC_CLAIM_TTL_MIN: "90" }), "ATC_CLAIM_TTL_MIN=90\n");
  assert.equal(mergeEnv("A=1\n", { A: null }), "");
});

test("읽는 팀(LINEAR_TEAM_KEYS): 쉼표 목록을 대문자로, 틀린 key는 오류, 비우면 지움", async () => {
  const { validatePatch } = await import("./settings.ts");
  assert.deepEqual(validatePatch({ teamKeys: "voc, atc" }).env, { LINEAR_TEAM_KEYS: "VOC,ATC" });
  assert.deepEqual(validatePatch({ teamKeys: "" }).env, { LINEAR_TEAM_KEYS: null });
  assert.deepEqual(Object.keys(validatePatch({ teamKeys: "VOC, 1X" }).errors), ["teamKeys"]);
});

test("ttsEngine·ttsVoice 검사(ATC-142): 엔진은 none·piper·espeak·kokoro·stub만, 목소리는 VOICE_NAME, 비우면 지운다", () => {
  for (const e of ["none", "piper", "espeak", "kokoro", "stub"]) assert.deepEqual(validatePatch({ ttsEngine: e }), { env: { ATC_TTS_ENGINE: e }, errors: {} });
  for (const bad of ["festival", "", "PIPER", null, 3]) {
    const r = validatePatch({ ttsEngine: bad });
    assert.deepEqual(r.env, {});
    assert.match(r.errors.ttsEngine ?? "", /none, piper, espeak, kokoro, stub/);
  }
  assert.deepEqual(validatePatch({ ttsVoice: "en_US-lessac-medium" }).env, { ATC_TTS_VOICE: "en_US-lessac-medium" });
  for (const bad of ["../etc/passwd", "a b", "x/y", "a".repeat(81), 5]) {
    const r = validatePatch({ ttsVoice: bad });
    assert.deepEqual(r.env, {});
    assert.ok(r.errors.ttsVoice, String(bad));
  }
  assert.deepEqual(validatePatch({ ttsVoice: "" }), { env: { ATC_TTS_VOICE: null }, errors: {} });
  assert.deepEqual(validatePatch({ ttsVoice: null }), { env: { ATC_TTS_VOICE: null }, errors: {} });
  // null이면 .env.local의 줄이 지워진다
  assert.equal(mergeEnv("A=1\nATC_TTS_VOICE=x\n", { ATC_TTS_VOICE: null }), "A=1\n");
});

import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { mergeEnv, validatePatch } from "./settings.ts";

test("값 검사: 맞는 값은 환경 변수로, 틀린 값은 항목별 오류로", () => {
  const ok = validatePatch({ teamKey: " voc ", landingState: "Ready to Merge", claimTtlMin: 120, handoffGraceMin: 0 });
  assert.deepEqual(ok.errors, {});
  assert.deepEqual(ok.env, {
    LINEAR_TEAM_KEY: "VOC",
    ATC_LANDING_STATE: "Ready to Merge",
    ATC_CLAIM_TTL_MIN: "120",
    ATC_HANDOFF_GRACE_MIN: "0",
  });

  const bad = validatePatch({ teamKey: "1X", landingState: 'Say "hi"', claimTtlMin: 2, handoffGraceMin: 1.5, projectsDir: "relative/dir", color: "red" });
  assert.deepEqual(Object.keys(bad.errors).sort(), ["claimTtlMin", "color", "handoffGraceMin", "landingState", "projectsDir", "teamKey"]);
  assert.deepEqual(bad.env, {});
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
  const after = mergeEnv(before, { LINEAR_TEAM_KEY: "ABC", ATC_LANDING_STATE: "Ready to Merge", LINEAR_API_KEY: null });
  assert.equal(after, '# atc\nLINEAR_TEAM_KEY=ABC\nATC_LANDING_STATE="Ready to Merge"\n');
  assert.equal(mergeEnv("", { ATC_CLAIM_TTL_MIN: "90" }), "ATC_CLAIM_TTL_MIN=90\n");
  assert.equal(mergeEnv("A=1\n", { A: null }), "");
});

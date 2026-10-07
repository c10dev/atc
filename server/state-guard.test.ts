import "./test-hermetic.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { config } from "./config.ts";
import { record, readRecords } from "./recorder.ts";
import { isRealStateDir, realHome, STATE_GUARD_ERROR, stateDirBlock, underNodeTest } from "./state-guard.ts";

// ATC-564: 시험이 운영 상태 폴더(~/.local/state/atc)를 쓰지 못한다. 이 시험들도 그 폴더를 읽거나 만들지 않는다: 경로 문자열만 비교한다

test("underNodeTest: node --test의 자식(NODE_TEST_CONTEXT)과 --test-isolation=none(--test)을 알아본다", () => {
  assert.equal(underNodeTest({ NODE_TEST_CONTEXT: "child-v8" }, []), true);
  assert.equal(underNodeTest({}, ["--test", "--test-isolation=none"]), true);
  assert.equal(underNodeTest({}, []), false); // 운영 서버(node server/index.ts)
  assert.equal(underNodeTest(), true); // 지금 이 파일
});

test("isRealStateDir·stateDirBlock: 진짜 홈의 .local/state/atc와 그 아래만, 시험 중에만 막는다", () => {
  const home = "/home/someone";
  assert.equal(isRealStateDir("/home/someone/.local/state/atc", home), true);
  assert.equal(isRealStateDir("/home/someone/.local/state/atc/", home), true);
  assert.equal(isRealStateDir("/home/someone/.local/state/atc/flight-recorder", home), true);
  assert.equal(isRealStateDir("/home/someone/.local/state/atc-gate", home), false);
  assert.equal(isRealStateDir("/tmp/atc-hermetic-x/state", home), false);
  assert.equal(isRealStateDir("/tmp/x/home/.local/state/atc", home), false); // 임시 HOME 아래는 운영 폴더가 아니다
  assert.match(stateDirBlock("/home/someone/.local/state/atc", true, home)!, new RegExp(STATE_GUARD_ERROR));
  assert.equal(stateDirBlock("/home/someone/.local/state/atc", false, home), null);
  assert.equal(stateDirBlock("/tmp/atc-hermetic-x/state", true, home), null);
});

// config.ts를 따로 도는 node에서 import한다. HOME은 진짜 홈, ATC_STATE_DIR는 없음 → 기본값이 운영 폴더. 폴더는 열지 않고 문자열만 읽는다
const probe = (env: Record<string, string | undefined>, swallow: boolean) => {
  const url = new URL("./config.ts", import.meta.url).href;
  const body = swallow ? `try { config.stateDir; console.log("READ"); } catch { console.log("SWALLOWED"); }` : `console.log("READ", config.stateDir.length > 0);`;
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...env })) if (v !== undefined) childEnv[k] = v;
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete childEnv[k];
  return spawnSync(process.execPath, ["--input-type=module", "-e", `import { config } from ${JSON.stringify(url)}; ${body}`], { env: childEnv, encoding: "utf8" });
};

test("config.stateDir: 시험 중에 운영 폴더를 가리키면 던지고, 오류를 삼켜도 프로세스는 1로 끝난다", () => {
  const thrown = probe({ HOME: realHome(), ATC_STATE_DIR: undefined, ATC_AIRPORTS_FILE: undefined, NODE_TEST_CONTEXT: "child-v8" }, false);
  assert.notEqual(thrown.status, 0);
  assert.match(thrown.stderr, new RegExp(STATE_GUARD_ERROR));
  const swallowed = probe({ HOME: realHome(), ATC_STATE_DIR: undefined, ATC_AIRPORTS_FILE: undefined, NODE_TEST_CONTEXT: "child-v8" }, true);
  assert.match(swallowed.stdout, /SWALLOWED/);
  assert.equal(swallowed.status, 1);
});

test("config.stateDir: 임시 폴더면 그대로 읽히고, 시험 밖(운영)에서는 막지 않는다", () => {
  const tmp = probe({ HOME: realHome(), ATC_STATE_DIR: join(tmpdir(), "atc-guard-probe"), NODE_TEST_CONTEXT: "child-v8" }, false);
  assert.equal(tmp.status, 0, tmp.stderr);
  const prod = probe({ HOME: realHome(), ATC_STATE_DIR: undefined, NODE_TEST_CONTEXT: undefined }, false);
  assert.equal(prod.status, 0, prod.stderr);
  assert.match(prod.stdout, /READ true/);
});

test("config.airportsFile: 따로 정하지 않으면 지금의 stateDir를 따르고, 운영 폴더 아래면 막힌다", () => {
  const prev = config.stateDir;
  const prevExit = process.exitCode;
  const dir = mkdtempSync(join(tmpdir(), "atc-guard-airports-"));
  try {
    config.stateDir = dir;
    assert.equal(config.airportsFile, join(dir, "airports.json"));
    config.stateDir = join(realHome(), ".local/state/atc");
    assert.throws(() => config.stateDir, new RegExp(STATE_GUARD_ERROR));
    assert.throws(() => config.airportsFile, new RegExp(STATE_GUARD_ERROR));
  } finally {
    config.stateDir = prev;
    process.exitCode = prevExit; // 위에서 일부러 막음을 울렸다
    rmSync(dir, { recursive: true, force: true });
  }
});

// update-run.test.ts가 2026-10-06에 운영 FLIGHT RECORDER에 쓴 원인: 폴더를 import 때 고정했다
const dirA = mkdtempSync(join(tmpdir(), "atc-recorder-a-"));
const dirB = mkdtempSync(join(tmpdir(), "atc-recorder-b-"));
after(() => {
  rmSync(dirA, { recursive: true, force: true });
  rmSync(dirB, { recursive: true, force: true });
});
test("recorder: import 뒤에 config.stateDir를 바꾸면 부를 때의 폴더에 쓰고 읽는다", () => {
  const prev = config.stateDir;
  try {
    const t = new Date().toISOString();
    config.stateDir = dirA;
    record({ t, kind: "mcc-auto", op: "refused", pr: 1, head: "a".repeat(40), why: "A" });
    config.stateDir = dirB;
    record({ t, kind: "mcc-auto", op: "refused", pr: 2, head: "b".repeat(40), why: "B" });
    const day = `${t.slice(0, 10)}.jsonl`;
    assert.deepEqual(readdirSync(join(dirA, "flight-recorder")), [day]);
    assert.match(readFileSync(join(dirA, "flight-recorder", day), "utf8"), /"why":"A"/);
    assert.doesNotMatch(readFileSync(join(dirA, "flight-recorder", day), "utf8"), /"why":"B"/);
    assert.ok(existsSync(join(dirB, "flight-recorder", day)));
    assert.deepEqual(readRecords(Date.parse(t) - 1000).map((l) => (l.kind === "mcc-auto" && l.op === "refused" ? l.pr : null)), [2]); // 기본 폴더도 지금의 stateDir
  } finally {
    config.stateDir = prev;
  }
});

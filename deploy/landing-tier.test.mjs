import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { posix } from "node:path";
import { READ_ONLY, SIDE_EFFECT, SIDE_EFFECT_HELPERS, tierOf } from "./landing-tier.mjs";

test("서버·화면·문서만 바꾸면 auto", () => {
  assert.equal(tierOf(["server/routes.ts", "web/src/views/RouteMap.tsx", "docs/routes.md", "CHANGELOG.md", "README.ko.md"]).tier, "auto");
});

test("관제 세션 매뉴얼·CLI는 flagged", () => {
  assert.equal(tierOf(["server/proposals.ts", "occ/CLAUDE.md"]).tier, "flagged");
  assert.equal(tierOf(["controller/atcctl.mjs"]).tier, "flagged");
  assert.equal(tierOf(["crosscheck/CLAUDE.md"]).tier, "flagged");
  assert.equal(tierOf(["review/CLAUDE.md"]).tier, "flagged");
  assert.equal(tierOf(["review/read-guard.mjs"]).tier, "user");
  assert.equal(tierOf(["mcc/CLAUDE.md"]).tier, "flagged");
  assert.equal(tierOf(["mcc/read-guard.mjs"]).tier, "user");
  assert.equal(tierOf(["mcc/.claude/settings.json"]).tier, "user");
  assert.equal(tierOf(["occ/.claude/skills/tick/SKILL.md"]).tier, "flagged");
});

test("guard 테스트만 바꾸면 flagged, guard 코드는 user", () => {
  assert.equal(tierOf(["controller/guard.test.mjs"]).tier, "flagged");
  assert.equal(tierOf(["controller/guard.mjs"]).tier, "user");
  assert.equal(tierOf(["occ/send-guard.mjs"]).tier, "user");
  assert.equal(tierOf(["occ/mcp-guard.mjs"]).tier, "user");
  assert.equal(tierOf(["crosscheck/read-guard.mjs"]).tier, "user");
});

test("설정·지침·CI·의존성·hook·배포는 user", () => {
  for (const f of [
    "occ/.claude/settings.json",
    ".claude/skills/atc-task/SKILL.md",
    ".claude/settings.json",
    "CLAUDE.md",
    "CLAUDE.en.md",
    ".github/workflows/ci.yml",
    "package.json",
    "package-lock.json",
    "hooks/claim.mjs",
    "deploy/atc.service",
    "deploy/landing-tier.mjs",
  ]) assert.equal(tierOf([f]).tier, "user", f);
  assert.equal(tierOf(["deploy/README.md", "deploy/README.ko.md"]).tier, "auto");
});

test("rulebook/(에이전트 절차 plugin, ATC-286)은 user, 이름만 든 경로는 그대로", () => {
  for (const f of ["rulebook/.claude-plugin/plugin.json", "rulebook/skills/qrh-04-go-around/SKILL.md", "rulebook/skills/x/SKILL.md", "rulebook/README.md"]) {
    const r = tierOf([f]);
    assert.equal(r.tier, "user", f);
    assert.equal(r.reasons[0].why, "규정집(에이전트 절차, plugin)");
  }
  assert.equal(tierOf(["server/proposals.ts", "rulebook/skills/x/SKILL.md"]).tier, "user");
  // 폴더가 맨 위가 아니거나 이름만 같으면 지금과 같다
  assert.equal(tierOf(["docs/rulebook.md"]).tier, "auto");
  assert.equal(tierOf(["docs/rulebook/index.md"]).tier, "auto");
  assert.equal(tierOf(["web/src/rulebook/x.ts"]).tier, "auto");
  assert.equal(tierOf(["rulebook.md"]).tier, "auto");
});

test("DUTY L1(D7a): claude/duty-* 브랜치의 PR도 바뀐 파일 경로로만 등급이 정해진다(문서는 auto, 자기 권한 파일은 user)", () => {
  assert.equal(tierOf(["docs/charter-desk.md", "docs/charter-desk.ko.md", "changelog.d/x.md"]).tier, "auto", "DUTY의 설계 문서 PR은 MCC가 착륙시킨다");
  assert.equal(tierOf(["docs/charter-desk.md", "duty/settings.json"]).tier, "user");
  assert.equal(tierOf(["docs/x.md", "CLAUDE.md"]).tier, "user");
  assert.equal(tierOf(["server/duty-l1-run.ts"]).tier, "flagged", "git worktree·Linear 쓰기 요청");
  assert.equal(tierOf(["server/sources/linear-write.ts"]).tier, "flagged");
  assert.equal(tierOf(["server/duty-stand.ts", "server/duty-linear.ts"]).tier, "auto", "순수 판정만");
  assert.equal(tierOf(["duty/guard-l1.test.mjs"]).tier, "flagged", "guard 테스트만 바꾸면 flagged");
});

test("DUTY(L0): duty/ 매뉴얼·CLI는 flagged, guard와 settings.json은 user", () => {
  assert.equal(tierOf(["duty/CLAUDE.md"]).tier, "flagged");
  assert.equal(tierOf(["duty/CLAUDE.en.md"]).tier, "flagged");
  assert.equal(tierOf(["duty/spawn.mjs"]).tier, "flagged");
  assert.equal(tierOf(["duty/guard.test.mjs"]).tier, "flagged", "guard 테스트만 바꾸면 flagged");
  assert.equal(tierOf(["duty/settings.test.mjs"]).tier, "flagged");
  assert.equal(tierOf(["duty/guard.mjs"]).tier, "user");
  assert.equal(tierOf(["duty/settings.json"]).tier, "user");
  assert.equal(tierOf(["duty/.claude/settings.json"]).tier, "user");
  assert.equal(tierOf(["duty/CLAUDE.md", "duty/guard.mjs"]).tier, "user");
  // D2가 띄우는 server/duty-run.ts는 미리 올려 둔다(등급 파일을 건드리지 않고 flagged로 들어오게)
  const r = tierOf(["server/duty-run.ts"]);
  assert.equal(r.tier, "flagged");
  assert.equal(r.reasons[0].why, "외부 부작용");
  assert.equal(tierOf(["server/duty-brief.ts", "server/duty-drafts.ts", "server/duty-api.ts"]).tier, "auto", "브리프·초안 서버 코드는 읽기와 추가 기록뿐");
});

test("폴더 CLAUDE.md는 루트가 아니라 flagged", () => {
  assert.equal(tierOf(["occ/CLAUDE.en.md"]).tier, "flagged");
});

test("외부 부작용 서버 파일은 flagged, 읽기 전용은 auto", () => {
  for (const [f] of SIDE_EFFECT) {
    const r = tierOf([f]);
    assert.equal(r.tier, "flagged", f);
    assert.equal(r.reasons[0].why, "외부 부작용", f);
  }
  for (const [f] of READ_ONLY) assert.equal(tierOf([f]).tier, "auto", f);
  assert.equal(tierOf(["server/autoland-run.test.ts", "server/autoland.ts"]).tier, "auto");
  assert.equal(tierOf(["server/mcc-run.ts", "controller/guard.mjs"]).tier, "user");
});

test("목록은 실제 파일이고 두 목록에 겹치지 않는다", () => {
  const side = SIDE_EFFECT.map(([f]) => f);
  const read = READ_ONLY.map(([f]) => f);
  for (const f of [...side, ...read]) assert.ok(existsSync(f), `${f} 없음 — deploy/landing-tier.mjs 목록에서 지우거나 옮길 것`);
  assert.equal(new Set([...side, ...read]).size, side.length + read.length, "같은 파일이 SIDE_EFFECT와 READ_ONLY(또는 한 목록에 두 번)에 있음");
});

// 명령을 돌리거나 GET 아닌 fetch를 하는 server 파일이 등급 없이 auto로 들어오지 못하게 한다
function serverSources(dir = "server") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) return serverSources(p);
    return /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [p] : [];
  });
}

test("명령·비GET fetch를 쓰는 server 파일은 모두 등급 목록에 있다", () => {
  const listed = new Set([...SIDE_EFFECT, ...READ_ONLY].map(([f]) => f));
  const missing = serverSources().filter((f) => {
    const src = readFileSync(f, "utf8");
    const runsCommands = /from\s+["'](node:)?child_process["']/.test(src);
    const writesOut = /method:\s*["'](POST|PUT|PATCH|DELETE)["']/i.test(src);
    return (runsCommands || writesOut) && !listed.has(f);
  });
  assert.deepEqual(
    missing,
    [],
    `deploy/landing-tier.mjs의 SIDE_EFFECT(머지·코멘트·쓰기·세션 시작·정지·메시지 전송이 있으면) 또는 READ_ONLY(읽기만 하면)에 올릴 것: ${missing.join(", ")}`,
  );
});

// 부작용 helper를 부르는 파일(ATC-114): 명령을 직접 돌리지 않아도 시점을 정하므로 등급 목록에 있어야 한다.
// import 문만 본다(이름 있는 import·export from, 통째 import, 동적 import). 정의한 파일을 가리키는 것만 센다.
const IMPORT_RE = /\b(?:import|export)\s+(?:type\s+)?(?:(\*\s+as\s+\w+)|\{([^}]*)\})\s*from\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
const nameOf = (s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();

export function helperImports(src, file) {
  const found = new Set();
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[3] ?? m[4];
    if (!spec?.startsWith(".")) continue;
    const target = posix.normalize(posix.join(posix.dirname(file), spec));
    const all = m[1] !== undefined || m[4] !== undefined; // 통째·동적 import는 그 파일의 helper를 모두 셈
    const names = all ? null : m[2].split(",").map(nameOf);
    for (const [name, from] of SIDE_EFFECT_HELPERS) if (target === from && (all || names.includes(name))) found.add(name);
  }
  return [...found];
}

test("helper 목록의 이름은 정의한 파일이 실제로 export한다", () => {
  for (const [name, from] of SIDE_EFFECT_HELPERS) {
    assert.ok(existsSync(from), `${from} 없음 — SIDE_EFFECT_HELPERS에서 고칠 것`);
    const src = readFileSync(from, "utf8");
    assert.match(src, new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${name}\\b`), `${from}가 ${name}을 export하지 않음 — deploy/landing-tier.mjs SIDE_EFFECT_HELPERS를 고칠 것`);
    assert.ok(SIDE_EFFECT.some(([f]) => f === from), `${from}는 SIDE_EFFECT에 있어야 함`);
  }
});

test("import 스캔: 이름·통째·동적 import와 다른 파일의 같은 이름", () => {
  const f = "server/x.ts";
  assert.deepEqual(helperImports('import { startRtsUnit, gh } from "./mcc-run.ts";', f), ["startRtsUnit"]);
  assert.deepEqual(helperImports('import {\n  type AgentRow,\n  launchAircraft as launch,\n  liveRowsOf,\n} from "./session-control.ts";', f), ["launchAircraft"]);
  assert.deepEqual(helperImports('export { stopControl } from "./session-control.ts";', f), ["stopControl"]);
  assert.deepEqual(helperImports('import * as sc from "./session-control.ts";', f).sort(), ["launchAircraft", "launchControl", "launchForCard", "stopAircraft", "stopControl"]);
  assert.deepEqual(helperImports('const m = await import("./autoland-run.ts");', f), ["runAutoland"]);
  assert.deepEqual(helperImports('import { setMccMode } from "./mcc-run.ts";', f), []);
  assert.deepEqual(helperImports('import { startRtsUnit } from "./other.ts";', f), []);
  assert.deepEqual(helperImports('import { runAutoland } from "../autoland-run.ts";', "server/sources/y.ts"), ["runAutoland"]);
  assert.deepEqual(helperImports('import { startRtsUnit } from "node:fs";', f), []);
});

test("부작용 helper를 import하는 server 파일은 모두 등급 목록에 있다", () => {
  const listed = new Set([...SIDE_EFFECT, ...READ_ONLY].map(([f]) => f));
  const missing = serverSources()
    .map((f) => [f, helperImports(readFileSync(f, "utf8"), f)])
    .filter(([f, names]) => names.length > 0 && !listed.has(f));
  assert.deepEqual(
    missing,
    [],
    `deploy/landing-tier.mjs의 SIDE_EFFECT(그 helper로 시점을 정하면) 또는 READ_ONLY(읽기만 하면)에 올릴 것:\n${missing.map(([f, names]) => `  ${f} — ${names.join(", ")} import`).join("\n")}`,
  );
});

test("가장 높은 등급을 쓰고 이유를 남긴다", () => {
  const r = tierOf(["server/a.ts", "occ/CLAUDE.md", "controller/guard.mjs", ""]);
  assert.equal(r.tier, "user");
  assert.deepEqual(r.reasons.map((x) => x.tier), ["flagged", "user"]);
});

// 주기 서버 일과 스위치 선언(ATC-393): 서비스 이름(provideService/serviceOf)으로 부르는 부작용은 import 스캔이 못 본다. 그래서 폴더째 flagged다.
// server/jobs/의 파일은 모두(새 파일도) 최소 flagged: 자동 RTS·자동 승인·LAUNCH·재시작 타이머를 auto로 바꾸는 PR이 없다
test("server/jobs/와 server/switches/의 모든 파일은 flagged 이상이고, 이유는 폴더나 외부 부작용이다", () => {
  for (const dir of ["server/jobs", "server/switches"]) {
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    assert.ok(files.length > 0, dir);
    for (const f of files) {
      const r = tierOf([`${dir}/${f}`]);
      assert.equal(r.tier, "flagged", `${dir}/${f}`);
      assert.match(r.reasons[0].why, dir.endsWith("jobs") ? /주기 서버 일|외부 부작용/ : /스위치 선언/); // 목록에 오른 파일은 더 구체적인 이유(외부 부작용)
    }
  }
  assert.equal(tierOf(["server/jobs/brand-new-timer.ts"]).tier, "flagged"); // 아직 없는 파일도
});

test("서비스로 부르는 일의 부작용: launchForCard는 helper 목록에 있고, ctx.service를 쓰는 일 파일도 flagged", () => {
  assert.ok(SIDE_EFFECT_HELPERS.some(([name, file]) => name === "launchForCard" && file === "server/session-control.ts"));
  for (const f of readdirSync("server/jobs").filter((x) => x.endsWith(".ts"))) {
    const text = readFileSync(`server/jobs/${f}`, "utf8");
    if (/ctx\.service[(<]/.test(text) || /launchForCard/.test(text)) assert.equal(tierOf([`server/jobs/${f}`]).tier, "flagged", f);
  }
});

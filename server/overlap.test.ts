import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_OVERLAP, type Holder, isHeavy, matches, overlapConfigOf, overlapDetail, overlapHoldWhy, overlapsOf, overlapValueOf, pathsOfBody, predictedOf, sameTeamOnlyNote, soleTeamOf } from "./overlap.ts";

const holder = (flight: string, paths: string[], over: Partial<Holder> = {}, where = "STAND"): Holder => ({
  flight, team: "TEAM_A", airport: "ATCC", wake: "M", files: new Map(paths.map((p) => [p, where])), ...over,
});

test("같은 팀 예외(ATC-136): 겹치는 FLIGHT를 쥔 팀이 하나뿐이고 정해져 있을 때만 그 팀, HOLD 사유에 팀이 붙는다", () => {
  const ov = (team: string | null) => ({ holder: holder("VOC-1", ["a.ts"], { team }), hits: [], weight: 1 }) as never;
  assert.equal(soleTeamOf([ov("TEAM_A"), ov("TEAM_A")]), "TEAM_A");
  assert.equal(soleTeamOf([ov("TEAM_A"), ov("TEAM_B")]), null);
  assert.equal(soleTeamOf([ov(null)]), null);
  assert.equal(soleTeamOf([]), null);
  assert.equal(overlapHoldWhy(["VOC-1", "VOC-2"]), "파일 겹침 — VOC-1, VOC-2가 머지될 때까지");
  assert.equal(overlapHoldWhy(["VOC-1"], { name: "TEAM_A", why: "AIRBORNE" }), "파일 겹침 — VOC-1가 머지될 때까지 (겹침은 TEAM_A뿐인데 TEAM_A가 지금 못 받음: AIRBORNE)");
  assert.equal(sameTeamOnlyNote("TEAM_A"), "겹침은 TEAM_A뿐 — TEAM_A에만 제안");
});

test("본문에서 백틱 경로와 glob을 읽고, 펜스 코드·명령·URL·낱말은 건너뛴다", () => {
  const body = [
    "`server/fuel-*.ts`와 `docs/dispatch.md`를 고친다. `web/src/{a,b}.tsx`도.",
    "`npm test` `and/or` `1/2` `https://x.dev/a.ts` `../up.ts` `dispatch.ts:120`",
    "```",
    "`server/in-fence.ts`",
    "```",
    "`server/sources`",
  ].join("\n");
  assert.deepEqual(pathsOfBody(body), ["server/fuel-*.ts", "docs/dispatch.md", "web/src/a.tsx", "web/src/b.tsx", "dispatch.ts", "server/sources"]);
  assert.deepEqual(pathsOfBody(null), []);
});

test("예측 경로는 출처를 단다: 본문, 연결된 FLIGHT 본문", () => {
  const bodies = new Map<string, string | null>([["ATC-1", "`a/x.ts`"], ["ATC-2", "`a/x.ts` `b/y.ts`"], ["ATC-3", null]]);
  assert.deepEqual(predictedOf("ATC-1", ["ATC-2", "ATC-3", "ATC-1"], bodies), [
    { pattern: "a/x.ts", from: "본문" },
    { pattern: "b/y.ts", from: "ATC-2 본문" },
  ]);
});

test("matches: 같은 경로, glob, 디렉터리", () => {
  assert.ok(matches("server/a.ts", "server/a.ts"));
  assert.ok(matches("server/fuel-*.ts", "server/fuel-cost.ts"));
  assert.ok(!matches("server/fuel-*.ts", "server/sources/fuel-x.ts"));
  assert.ok(matches("server/**/*.ts", "server/sources/x.ts"));
  assert.ok(matches("server/sources", "server/sources/github.ts"));
  assert.ok(matches("web/src/", "web/src/a/b.tsx"));
  assert.ok(!matches("server/a.ts", "server/a.tsx"));
});

test("워크트리 diff·열린 PR 파일과 겹침: 자기 FLIGHT와 다른 AIRPORT는 뺀다", () => {
  const pred = [{ pattern: "server/fuel-*.ts", from: "본문" }, { pattern: "docs/x.md", from: "ATC-9 본문" }];
  const hs = [
    holder("ATC-5", ["server/fuel-cost.ts", "web/a.tsx"], {}, "STAND"),
    holder("ATC-6", ["docs/x.md"], { team: null }, "PR #12"),
    holder("ATC-71", ["server/fuel-run.ts"]),
    holder("VOC-1", ["server/fuel-run.ts"], { airport: "VCDO" }),
  ];
  const o = overlapsOf("ATC-71", "M", "ATCC", pred, hs);
  assert.deepEqual(o.map((x) => [x.holder.flight, x.hits.map((h) => h.path)]), [["ATC-5", ["server/fuel-cost.ts"]], ["ATC-6", ["docs/x.md"]]]);
  assert.equal(o[1].hits[0].where, "PR #12");
  assert.match(overlapDetail(o), /ATC-5\(TEAM_A\)가 고치는 server\/fuel-cost\.ts/);
  assert.match(overlapDetail(o), /ATC-6가 고치는 docs\/x\.md \(ATC-9 본문 → PR #12\)/);
  assert.equal(overlapDetail([]), "없음");
});

test("WAKE 가중: 큰 FLIGHT가 양쪽에 낄수록 무겁다, 파일 수는 3에서 멈춘다", () => {
  const pred = [{ pattern: "a/*.ts", from: "본문" }];
  const files = ["a/1.ts", "a/2.ts", "a/3.ts", "a/4.ts"];
  const v = (mine: "L" | "M" | "H", theirs: "L" | "M" | "H", paths = files) => overlapValueOf(overlapsOf("X-1", mine, "ATCC", pred, [holder("X-2", paths, { wake: theirs })]));
  assert.equal(v("M", "M"), 3);
  assert.equal(v("H", "M"), 6);
  assert.equal(v("H", "H"), 12);
  assert.equal(v("L", "L"), 0.75);
  assert.equal(v("M", "M", ["a/1.ts"]), 1);
});

test("무거운 겹침: holdFiles 이상이고 L·L만은 아니다", () => {
  const pred = [{ pattern: "a/*.ts", from: "본문" }];
  const one = overlapsOf("X-1", "M", "ATCC", pred, [holder("X-2", ["a/1.ts"])]);
  const two = overlapsOf("X-1", "M", "ATCC", pred, [holder("X-2", ["a/1.ts", "a/2.ts"])]);
  const light = overlapsOf("X-1", "L", "ATCC", pred, [holder("X-2", ["a/1.ts", "a/2.ts"], { wake: "L" })]);
  assert.ok(!isHeavy(one[0], DEFAULT_OVERLAP));
  assert.ok(isHeavy(two[0], DEFAULT_OVERLAP));
  assert.ok(!isHeavy(light[0], DEFAULT_OVERLAP));
});

test("overlap 설정: hold는 true일 때만 켠다, 잘못된 holdFiles는 기본으로", () => {
  assert.deepEqual(overlapConfigOf(undefined), { hold: false, holdFiles: 2 });
  assert.deepEqual(overlapConfigOf({ hold: "yes", holdFiles: 0 }), { hold: false, holdFiles: 2 });
  assert.deepEqual(overlapConfigOf({ hold: true, holdFiles: 5 }), { hold: true, holdFiles: 5 });
});

test("git status 줄에서 경로: 이름 바꿈은 새 이름, 따옴표는 벗긴다", async () => {
  const { statusPaths } = await import("./overlap-run.ts");
  assert.deepEqual(statusPaths(" M server/a.ts\n?? new file.ts\nR  old.ts -> server/new.ts\n"), ["server/a.ts", "new file.ts", "server/new.ts"]);
});

test("STAND의 바뀐 파일: merge-base 뒤 커밋과 커밋 안 한 변경·새 파일, 읽기 전용", async () => {
  const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { standFiles } = await import("./overlap-run.ts");
  const dir = mkdtempSync(join(tmpdir(), "atc-overlap-"));
  const g = (...a: string[]) => execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { stdio: "pipe" });
  g("init", "-q", "-b", "main");
  mkdirSync(join(dir, "server"));
  writeFileSync(join(dir, "server/a.ts"), "1");
  writeFileSync(join(dir, "server/b.ts"), "1");
  g("add", "-A");
  g("commit", "-qm", "base");
  g("checkout", "-qb", "work");
  writeFileSync(join(dir, "server/a.ts"), "2");
  g("commit", "-qam", "edit a");
  writeFileSync(join(dir, "server/b.ts"), "2"); // 커밋 안 함
  writeFileSync(join(dir, "server/new.ts"), "1"); // 새 파일
  assert.deepEqual((await standFiles(dir, "main"))?.sort(), ["server/a.ts", "server/b.ts", "server/new.ts"]);
  assert.equal(await standFiles(join(dir, "nope"), "main"), null);
});

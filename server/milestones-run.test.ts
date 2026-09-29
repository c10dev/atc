import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { config } from "./config.ts";

// OOOI 실행부(ATC-123): 임시 상태 폴더와 임시 git 저장소만 쓴다. 기록 폴더는 모듈을 읽을 때 정해지므로 상태 폴더를 먼저 바꾼 뒤 불러온다
const dir = mkdtempSync(join(tmpdir(), "milestones-"));
config.stateDir = join(dir, "state");
mkdirSync(config.stateDir, { recursive: true });
after(() => rmSync(dir, { recursive: true, force: true }));
const { milestonesNow, runMilestones } = await import("./milestones-run.ts");

const repo = join(dir, "atc");
const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-C", repo, ...args], { encoding: "utf8" }).trim();
mkdirSync(repo);
git("init", "-q", "-b", "main");
writeFileSync(join(repo, "a"), "1");
git("add", "a");
git("commit", "-q", "-m", "base");
git("checkout", "-q", "-b", "claude/atc-9");
writeFileSync(join(repo, "b"), "2");
git("add", "b");
git("commit", "-q", "-m", "work");
git("checkout", "-q", "main");
git("merge", "--no-ff", "-q", "-m", "Merge pull request #10 from o/claude/atc-9", "claude/atc-9");
const mergeSha = git("rev-parse", "HEAD");
writeFileSync(join(repo, "c"), "3");
git("add", "c");
git("commit", "-q", "-m", "later");
const later = git("rev-parse", "HEAD");
git("checkout", "-q", "-b", "side", "HEAD~2"); // 머지 커밋을 품지 않는 대상
writeFileSync(join(repo, "d"), "4");
git("add", "d");
git("commit", "-q", "-m", "side");
const side = git("rev-parse", "HEAD");
git("checkout", "-q", "main");

const T = (hhmm: string) => `2026-09-29T${hhmm}:00.000Z`;
const jsonl = (file: string, lines: unknown[]) => writeFileSync(join(config.stateDir, file), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
jsonl("departures.jsonl", [{ t: T("03:12"), flight: "ATC-9", aircraft: "TEAM_K", stand: "/w/atc-9", branch: "claude/atc-9", repo, via: "stand" }]);
jsonl("logbook.jsonl", [
  {
    op: "arrived",
    t: T("04:03"),
    key: "o/atc#10",
    aircraft: "TEAM_K",
    flight: "ATC-9",
    class: null,
    airport: "ATCC",
    pr: { repo: "o/atc", number: 10, url: "https://github.com/o/atc/pull/10", title: "t" },
    stands: [],
    departedAt: T("03:12"),
    departedFrom: "departure",
    arrivedAt: T("04:02"),
    blockMin: 28,
    landingWaitMin: 22,
    codexFindings: 0,
    changesRequested: false,
    reverted: false,
    los: 0,
  },
]);
// 거절된 RTS, 머지 커밋을 품지 않은 성공, 머지 커밋을 품은 성공
jsonl("rts.jsonl", [
  { at: T("04:03"), from: null, to: mergeSha, result: "refused" },
  { at: T("04:05"), from: null, to: side, result: "ok" },
  { at: T("04:07"), from: null, to: later, result: "ok" },
]);
writeFileSync(join(config.stateDir, "mcc.json"), JSON.stringify({ mode: "shadow", airport: "ATCC" }));

const snap = (over: Record<string, unknown> = {}) => ({ airports: [{ code: "ATCC", repo }], pulls: [], ...over }) as never;
const recorded = () => {
  const d = join(config.stateDir, "flight-recorder");
  return readdirSync(d).flatMap((f) => readFileSync(join(d, f), "utf8").trim().split("\n").map((l) => JSON.parse(l))).filter((r) => r.kind === "milestone");
};

test("git으로 머지 커밋을 찾아 그것을 품은 첫 성공 RTS를 IN으로 센다", () => {
  const m = milestonesNow(snap(), Date.parse(T("06:00"))).get("ATC-9")!;
  assert.deepEqual([m.out, m.off, m.on, m.in], [T("03:12"), T("03:40"), T("04:02"), T("04:07")]);
});

test("AIRPORT를 모르면(저장소 없음) IN만 없다", () => {
  const m = milestonesNow(snap({ airports: [] }), Date.parse(T("06:00"))).get("ATC-9")!;
  assert.deepEqual([m.out, m.off, m.on, m.in], [T("03:12"), T("03:40"), T("04:02"), null]);
});

test("FLIGHT RECORDER: 이정표마다 한 번만 적고, 다시 돌려도(재시작 뒤 포함) 되풀이하지 않는다", async () => {
  const now = Date.parse(T("06:00"));
  runMilestones(snap(), now);
  const first = recorded();
  assert.deepEqual(first.map((r) => r.milestone).sort(), ["in", "off", "on", "out"]);
  assert.deepEqual(first.find((r) => r.milestone === "on"), { t: T("04:02"), kind: "milestone", milestone: "on", flight: "ATC-9", at: T("04:02"), seenAt: new Date(now).toISOString() });
  runMilestones(snap(), now + 120_000);
  assert.equal(recorded().length, 4);
  // 서버를 다시 띄운 것처럼 메모리를 비우고 다시 불러도 기록을 읽어 이미 적은 것은 건너뛴다
  const again = await import(`./milestones-run.ts?restart=${Date.now()}`);
  again.runMilestones(snap(), now + 240_000);
  assert.equal(recorded().length, 4);
});

test("30일보다 오래된 이정표는 적지 않는다", () => {
  const before = recorded().length;
  runMilestones(snap(), Date.parse(T("06:00")) + 40 * 86_400_000 + 600_000);
  assert.equal(recorded().length, before);
});

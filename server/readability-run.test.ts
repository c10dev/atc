import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Transmission } from "./radio.ts";
import { dayLineOf, type Deps, gitMarkers, type Marker, parseDays, parseMarkers, readabilityView, readControlReplies, readDayLines, repliesOfTranscript, runReadability, START_DAY } from "./readability-run.ts";
import type { TranscriptReply } from "./readability.ts";

const SEP = "\x1f";
const END = "\x1e";
const envelope = (from: string, body: string) => `<cross-session-message from="uds:/run/x.sock" from-name="${from}" from-mode="prompting">\n${body}\n</cross-session-message>`;
const userLine = (timestamp: string, content: string) => JSON.stringify({ type: "user", timestamp, message: { role: "user", content } });

test("parseMarkers: 머지 시각(UTC)·PR 번호·ATC 키, 같은 머지는 한 번, 시각순", () => {
  const out =
    ["f97bba6f5c4e", "2026-09-30T15:47:04+09:00", "Merge pull request #253 from chaehy5665/worktree-atc-174-en-block-text", "TOWER relays English landing-block texts (ATC-174)"].join(SEP) + END +
    ["f9ef48785", "2026-09-30T15:49:21+09:00", "Merge pull request #252 from chaehy5665/worktree-atc-169-occ-restart-safety", ""].join(SEP) + END +
    ["f97bba6f5c4e", "2026-09-30T15:47:04+09:00", "Merge pull request #253 from x/y", ""].join(SEP);
  assert.deepEqual(parseMarkers(out), [
    { at: "2026-09-30T06:47:04.000Z", pr: 253, key: "ATC-174", sha: "f97bba6" },
    { at: "2026-09-30T06:49:21.000Z", pr: 252, key: "ATC-169", sha: "f9ef487" },
  ]);
  assert.deepEqual(parseMarkers(""), []);
});

test("gitMarkers: origin/main이 없으면 HEAD, 경로 검색과 문구 낱말 검색을 둘 다 하고, git 실패는 던진다", () => {
  const calls: string[][] = [];
  const git = (args: string[]) => {
    calls.push(args);
    if (args[0] === "rev-parse" && args[3] === "origin/main") throw new Error("no ref");
    return "";
  };
  assert.deepEqual(gitMarkers(Date.parse("2026-09-30T00:00:00Z"), Date.parse("2026-10-01T00:00:00Z"), "/x", git), []);
  const logs = calls.filter((c) => c[0] === "log");
  assert.equal(logs.length, 2);
  assert.ok(logs.every((c) => c[1] === "HEAD" && c.includes("--first-parent") && c.includes("--merges")));
  assert.ok(logs[0]!.includes("server/response.ts") && logs[0]!.includes("controller/CLAUDE.md") && logs[0]!.includes(".claude/skills/atc-task"));
  assert.ok(logs[1]!.includes("-m") && logs[1]!.some((a) => a.startsWith("-G")) && logs[1]!.includes("server/proposals.ts"));
  assert.throws(() => gitMarkers(0, 1, "/x", () => { throw new Error("git down"); }));
});

test("repliesOfTranscript: user 줄의 봉투만, 팀에서 온 것만, 같은 시각·보낸이·길이는 한 번", () => {
  const good = userLine("2026-09-29T10:00:00.000Z", envelope("TEAM_G", "READBACK C-0001"));
  const text = [
    good,
    good, // 재개한 세션이 복사한 같은 메시지
    JSON.stringify({ type: "queue-operation", timestamp: "2026-09-29T09:59:59.000Z", content: envelope("TEAM_G", "READBACK C-0001") }),
    JSON.stringify({ type: "attachment", timestamp: "2026-09-29T09:59:58.000Z", attachment: envelope("TEAM_G", "READBACK C-0001") }),
    userLine("2026-09-29T10:01:00.000Z", envelope("OCC", "not a team")), // 팀 이름이 아님
    userLine("2026-09-29T10:02:00.000Z", "plain prompt about cross-session-message"),
    "not json cross-session-message",
    userLine("2026-09-29T10:03:00.000Z", envelope("TEAM_H", `UNABLE C-0002 — no\nsecond line`)),
  ].join("\n");
  const r = repliesOfTranscript(text, "TOWER");
  assert.deepEqual(r.map((x) => [x.at, x.from, x.first, x.lines, x.to]), [
    ["2026-09-29T10:00:00.000Z", "TEAM_G", "READBACK C-0001", 1, "TOWER"],
    ["2026-09-29T10:03:00.000Z", "TEAM_H", "UNABLE C-0002 — no", 2, "TOWER"],
  ]);
  assert.equal(r[0]!.length, envelope("TEAM_G", "READBACK C-0001").length);
});

test("readControlReplies: TOWER·OCC 폴더의 대화 기록을 읽기만 하고, 본문은 첫 줄과 길이만 남는다", () => {
  const root = mkdtempSync(join(tmpdir(), "atc-readability-"));
  try {
    const repo = "/srv/atc";
    mkdirSync(join(root, "-srv-atc-controller"), { recursive: true });
    mkdirSync(join(root, "-srv-atc-occ"), { recursive: true });
    mkdirSync(join(root, "-srv-atc-mcc"), { recursive: true });
    const secret = "SECRET-BODY-LINE";
    const tower = join(root, "-srv-atc-controller", "s1.jsonl");
    const towerText = userLine("2026-09-29T10:00:00.000Z", envelope("TEAM_G", `READBACK C-0001\n${secret}`)) + "\n";
    writeFileSync(tower, towerText);
    writeFileSync(join(root, "-srv-atc-occ", "s2.jsonl"), userLine("2026-09-29T11:00:00.000Z", envelope("TEAM_H", "READBACK D-0001")) + "\n");
    writeFileSync(join(root, "-srv-atc-mcc", "s3.jsonl"), userLine("2026-09-29T12:00:00.000Z", envelope("TEAM_H", "READBACK D-0002")) + "\n"); // MCC는 읽지 않는다
    const r = readControlReplies(0, [root], repo);
    assert.deepEqual(r.map((x) => [x.to, x.from, x.first]), [["TOWER", "TEAM_G", "READBACK C-0001"], ["OCC", "TEAM_H", "READBACK D-0001"]]);
    assert.equal(JSON.stringify(r).includes(secret), false);
    assert.equal(readFileSync(tower, "utf8"), towerText); // 대화 기록은 그대로다
    // since 뒤에 바뀌지 않은 파일은 읽지 않는다
    assert.deepEqual(readControlReplies(Date.now() + 60_000, [root], repo), []);
    assert.deepEqual(readControlReplies(0, [join(root, "missing")], repo), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const call = (id: string, at: string): Transmission => ({ id, at, freq: "TOWER", from: "TOWER", to: "GOLF (TEAM_G)", aircraft: "TEAM_G", kind: "INFO", head: "h", body: "x".repeat(50), open: true });
const rb = (id: string, at: string): Transmission => ({ id: `${id}#readback`, at, freq: "TOWER", from: "GOLF (TEAM_G)", to: "TOWER", aircraft: "TEAM_G", kind: "READBACK", head: "h", replyTo: id });

test("dayLineOf: 표지 시각에서 구간을 나누고, 답은 첫 줄·길이만 담는다", () => {
  const day = "2026-09-30";
  const replies: TranscriptReply[] = [{ at: "2026-09-30T06:48:00.000Z", from: "TEAM_G", to: "TOWER", first: "READBACK C-2", length: 400, lines: 4 }];
  const txs = [call("C-1", "2026-09-30T06:00:00.000Z"), rb("C-1", "2026-09-30T06:01:00.000Z"), call("C-2", "2026-09-30T06:47:30.000Z"), rb("C-2", "2026-09-30T06:48:00.000Z"), call("C-3", "2026-09-30T07:00:00.000Z")];
  const markers: Marker[] = [
    { at: "2026-09-30T06:47:04.000Z", pr: 253, key: "ATC-174", sha: "f97bba6" },
    { at: "2026-09-30T06:49:21.000Z", pr: 252, key: "ATC-169", sha: "f9ef487" },
    { at: "2026-09-29T23:00:00.000Z", pr: 1, key: null, sha: "0000000" }, // 다른 날
  ];
  const line = dayLineOf(day, { transmissions: txs, events: [], replies }, markers, "2026-10-01T00:00:00.000Z");
  assert.deepEqual(line.segments.map((s) => [s.from.slice(11, 19), s.to.slice(11, 19), s.afterPr, s.total.calls]), [
    ["00:00:00", "06:47:04", null, 1],
    ["06:47:04", "06:49:21", 253, 1],
    ["06:49:21", "00:00:00", 252, 1],
  ]);
  assert.equal(line.metrics.total.calls, 3);
  assert.deepEqual(line.markers.map((m) => m.pr), [253, 252]);
  assert.deepEqual(line.replies, [{ at: "2026-09-30T06:48:00.000Z", from: "TEAM_G", id: "C-2", first: "READBACK C-2", len: 400 }]);
  assert.equal(line.repliesTotal, 1);
  // 표지가 없는 날은 구간이 없다
  assert.deepEqual(dayLineOf(day, { transmissions: txs, events: [], replies }, [], "t").segments, []);
});

test("dayLineOf: 하루 답 기록은 상한이 있고 전체 수는 따로 센다", () => {
  const replies: TranscriptReply[] = Array.from({ length: 700 }, (_, i) => ({ at: `2026-09-29T10:${String(i % 60).padStart(2, "0")}:00.000Z`, from: "TEAM_G", to: "TOWER" as const, first: "x".repeat(200), length: 999, lines: 1 }));
  const line = dayLineOf("2026-09-29", { transmissions: [], events: [], replies }, [], "t");
  assert.equal(line.replies.length, 500);
  assert.equal(line.repliesTotal, 700);
  assert.ok(JSON.stringify(line).length < 300_000);
});

const deps = (dir: string, nowIso: string, over: Partial<Deps> = {}): Deps => ({
  now: () => Date.parse(nowIso),
  load: () => ({ transmissions: [call("C-1", "2026-09-27T10:00:00.000Z"), rb("C-1", "2026-09-27T10:02:00.000Z")], events: [], replies: [] }),
  markers: () => [],
  file: () => join(dir, "readability.jsonl"),
  ...over,
});

test("runReadability: START_DAY부터 어제까지 빠진 날을 채우고, 다시 돌려도 같은 날을 두 번 쓰지 않는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-readability-"));
  try {
    assert.equal(START_DAY, "2026-09-26");
    const d = deps(dir, "2026-09-30T12:00:00.000Z");
    const first = runReadability(d);
    assert.deepEqual(first.written, ["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29"]); // 오늘(09-30)은 아직 쓰지 않는다
    assert.deepEqual(readDayLines(d.file()).map((l) => l.day), first.written);
    assert.equal(readDayLines(d.file()).find((l) => l.day === "2026-09-27")!.metrics.total.calls, 1);
    // 재시작·RTS: 다시 돌려도 아무것도 더하지 않는다
    assert.deepEqual(runReadability(d).written, []);
    assert.equal(readFileSync(d.file(), "utf8").trim().split("\n").length, 4);
    // 날이 바뀌면 그날 하나만 더한다
    assert.deepEqual(runReadability(deps(dir, "2026-10-01T00:05:00.000Z")).written, ["2026-09-30"]);
    assert.deepEqual(runReadability(deps(dir, "2026-10-01T09:00:00.000Z")).written, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runReadability: 파일에 이미 있는 날은 건너뛰고, git(표지)이 실패한 날은 쓰지 않고 다음에 다시 한다", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-readability-"));
  try {
    const d = deps(dir, "2026-09-28T01:00:00.000Z", { markers: () => { throw new Error("git down"); } });
    const r = runReadability(d);
    assert.deepEqual(r, { written: [], skipped: ["2026-09-26", "2026-09-27"] });
    assert.deepEqual(readDayLines(d.file()), []);
    const ok = runReadability(deps(dir, "2026-09-28T02:00:00.000Z"));
    assert.deepEqual(ok.written, ["2026-09-26", "2026-09-27"]);
    // 한 줄이 깨져 있어도 나머지를 읽는다
    writeFileSync(d.file(), readFileSync(d.file(), "utf8") + "{broken\n");
    assert.equal(readDayLines(d.file()).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readabilityView: 저장된 최근 N일 + 오늘의 부분 지표", () => {
  const dir = mkdtempSync(join(tmpdir(), "atc-readability-"));
  try {
    const d = deps(dir, "2026-09-28T12:00:00.000Z", {
      load: () => ({ transmissions: [call("C-9", "2026-09-28T10:00:00.000Z"), rb("C-9", "2026-09-28T10:01:00.000Z")], events: [], replies: [] }),
      markers: () => [{ at: "2026-09-28T09:00:00.000Z", pr: 7, key: "ATC-7", sha: "abcdef0" }],
    });
    runReadability(d);
    const v = readabilityView(1, d);
    assert.deepEqual(v.days.map((l) => l.day), ["2026-09-27"]);
    assert.equal(v.today.day, "2026-09-28");
    assert.equal(v.today.partial, true);
    assert.equal(v.today.metrics.total.calls, 1);
    assert.equal(v.today.window.to, "2026-09-28T12:00:00.001Z");
    assert.deepEqual(v.today.markers.map((m) => m.pr), [7]);
    assert.equal(readabilityView(30, d).days.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseDays: 기본 7, 1~60의 정수만", () => {
  assert.deepEqual(parseDays(undefined), { ok: true, days: 7 });
  assert.deepEqual(parseDays("30"), { ok: true, days: 30 });
  for (const bad of ["0", "61", "x", "1.5", "-2"]) assert.equal(parseDays(bad).ok, false, bad);
});

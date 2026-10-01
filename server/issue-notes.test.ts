import assert from "node:assert/strict";
import { test } from "node:test";
import { notesConfigOf } from "./dispatch.ts";
import { DEFAULT_NOTES, flightPlanNotesOf, isSupervisorComment } from "./issue-notes.ts";
import { formatAssignment } from "./briefs.ts";

const c = (name: string | null, body: string, at: string) => ({ body, createdAt: at, user: name ? { displayName: name } : null });

test("flightPlanNotesOf: 봇·연동 댓글만 있으면 블록이 없다", () => {
  const comments = [c(null, "PR #1 opened", "2026-10-01T01:00:00Z"), c("linear", "auto", "2026-10-01T01:00:00Z"), c("GitHub", "linked", "2026-10-01T01:00:00Z"), c("chaehy5665", "<!-- linear-linkback -->", "2026-10-01T01:00:00Z")];
  assert.deepEqual(flightPlanNotesOf(comments), []);
  assert.deepEqual(flightPlanNotesOf([]), []);
  assert.deepEqual(flightPlanNotesOf(null), []);
});

test("flightPlanNotesOf: SUPERVISOR 댓글은 쓴 그대로, 가장 새것이 맨 뒤", () => {
  const out = flightPlanNotesOf([c("chaehy5665", "second", "2026-10-01T03:00:00Z"), c("chaehy5665", "first\nline two", "2026-10-01T02:00:00Z"), c(null, "bot", "2026-10-01T04:00:00Z")]);
  assert.equal(out[0], "NOTES FROM THE ISSUE (comments by the SUPERVISOR, newest last):");
  assert.deepEqual(out.slice(1), ["> first\n> line two", "> second"]);
});

test("flightPlanNotesOf: 3개·2,000자를 넘으면 오래된 쪽을 빼고 more in the issue를 단다", () => {
  const five = [1, 2, 3, 4, 5].map((n) => c("chaehy5665", `note ${n}`, `2026-10-01T0${n}:00:00Z`));
  const out = flightPlanNotesOf(five, DEFAULT_NOTES, "https://linear.app/x/issue/ATC-1");
  assert.deepEqual(out.slice(1, 4), ["> note 3", "> note 4", "> note 5"]);
  assert.equal(out.at(-1), "(more in the issue: https://linear.app/x/issue/ATC-1)");
  const long = flightPlanNotesOf([c("a", "x".repeat(1500), "2026-10-01T01:00:00Z"), c("a", "y".repeat(1500), "2026-10-01T02:00:00Z")]);
  assert.equal(long.filter((l) => l.startsWith("> ")).length, 1); // 합이 2,000자를 넘으면 오래된 것을 뺀다
  assert.ok(long.at(-1)!.startsWith("(more in the issue"));
  const huge = flightPlanNotesOf([c("a", "z".repeat(5000), "2026-10-01T01:00:00Z")]);
  assert.ok(huge[1].length <= 2000 + 3 && huge[1].endsWith("…"));
});

test("isSupervisorComment: users를 정하면 그 사용자만", () => {
  const cfg = { ...DEFAULT_NOTES, users: ["chaehy5665"] };
  assert.equal(isSupervisorComment(c("chaehy5665", "hi", "t"), cfg), true);
  assert.equal(isSupervisorComment(c("someone", "hi", "t"), cfg), false);
});

test("notesConfigOf: 잘못된 값은 기본으로", () => {
  assert.deepEqual(notesConfigOf(undefined), DEFAULT_NOTES);
  assert.deepEqual(notesConfigOf({ users: ["a", 3, " "], maxComments: 0, maxChars: "x" }), { users: ["a"], maxComments: 3, maxChars: 2000 });
});

test("formatAssignment: notes는 지시서 뒤, 재량 줄 앞에 들어간다", () => {
  const text = formatAssignment({ key: "ATC-1", title: "t", url: "u" }, null, "TEAM_X", ["NOTES FROM THE ISSUE (x):", "> a"]);
  const i = text.indexOf("NOTES FROM THE ISSUE");
  assert.ok(i > 0 && text.indexOf("PILOT'S DISCRETION") > i);
  assert.ok(!formatAssignment({ key: "ATC-1", title: "t", url: "u" }, null, null).includes("NOTES FROM THE ISSUE"));
});

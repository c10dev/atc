import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { externalGateOf } from "./landing.ts";
import { capText, DIFF_MAX, mountLandingReview } from "./landing-review.ts";
import { diffFromFiles, diffTooLarge, fetchReviewSource } from "./sources/github.ts";

// 너무 큰 diff(ATC-449): gh pr diff가 거절해도 files API로 자료를 만든다. 주입한 gh만 쓴다(네트워크 없음)
const HEAD = "a".repeat(40);
const TOO_LARGE = Object.assign(new Error("Command failed: gh pr diff"), { stderr: "could not find pull request diff: HTTP 406: Sorry, the diff exceeded the maximum number of lines (20000) (https://api.github.com/repos/o/r/pulls/9)\n" });
const VIEW = JSON.stringify({ title: "Big", body: "b", headRefOid: HEAD, files: [{ path: "src/a.ts" }], labels: [{ name: "x" }] });
const row = (f: object) => JSON.stringify(f);
const fakeGh = (calls: string[][]) => async (args: string[]) => {
  calls.push(args);
  if (args[0] === "pr" && args[1] === "view") return VIEW;
  if (args[0] === "pr" && args[1] === "diff") throw TOO_LARGE;
  if (args[0] === "api")
    return [row({ filename: "src/a.ts", status: "modified", patch: "@@ -1 +1 @@\n-a\n+b" }), row({ filename: "old.env", status: "removed" }), row({ filename: "src/new.ts", status: "renamed", previous_filename: "keys/secret.pem", patch: null })].join("\n") + "\n";
  throw new Error(`unexpected ${args.join(" ")}`);
};

test("diffTooLarge: 리뷰 자료를 거절한 문구만 잡고 다른 오류는 아니다", () => {
  assert.ok(diffTooLarge(TOO_LARGE));
  assert.ok(diffTooLarge(Object.assign(new Error("x"), { stderr: "diff_too_large" })));
  assert.ok(!diffTooLarge(Object.assign(new Error("x"), { stderr: "HTTP 502: Bad Gateway" })));
  assert.ok(!diffTooLarge(new Error("gh: command not found")));
});

test("fetchReviewSource: diff가 너무 크면 files API로 자료를 만들고, 지워진 파일은 이름만, 이름은 옛 이름까지 모두", async () => {
  const calls: string[][] = [];
  const src = await fetchReviewSource("o/r", 9, fakeGh(calls));
  assert.equal(src.diffSource, "files-api");
  assert.deepEqual(src.removedFiles, ["old.env"]);
  assert.deepEqual([...src.files].sort(), ["keys/secret.pem", "old.env", "src/a.ts", "src/new.ts"]);
  assert.match(src.diff, /diff --git a\/src\/a\.ts b\/src\/a\.ts\n--- a\/src\/a\.ts\n\+\+\+ b\/src\/a\.ts\n@@ -1 \+1 @@/);
  assert.match(src.diff, /diff --git a\/old\.env b\/old\.env\n\(removed — no patch\)/);
  assert.match(src.diff, /diff --git a\/keys\/secret\.pem b\/src\/new\.ts\n\(no patch/);
  assert.ok(calls.some((a) => a[0] === "api" && a.includes("--paginate") && a.some((x) => x.includes("repos/o/r/pulls/9/files"))));
  // 게이트는 모든 이름을 본다: 지워진 .env와 이름을 바꾼 키 파일이 있으면 제외
  const gate = externalGateOf({ flight: "ATC-9", ticketLabels: [], prLabels: src.labels, files: src.files, texts: [src.title, src.body] });
  assert.ok(gate.hard, "비밀·키 경로가 게이트에 보인다");
  // 자르기는 capText(DIFF_MAX)가 맡는다
  assert.equal(capText("x\n".repeat(DIFF_MAX), DIFF_MAX).truncated, true);
});

test("fetchReviewSource: 작은 diff는 pr diff 그대로(pr-diff), 다른 gh 실패는 그대로 던진다", async () => {
  const ok = await fetchReviewSource("o/r", 9, async (a) => (a[1] === "view" ? VIEW : "diff --git a/src/a.ts b/src/a.ts\n"));
  assert.deepEqual([ok.diffSource, ok.removedFiles, ok.files], ["pr-diff", [], ["src/a.ts"]]);
  const bad = Object.assign(new Error("boom"), { stderr: "HTTP 502: Bad Gateway\nmore" });
  await assert.rejects(
    fetchReviewSource("o/r", 9, async (a) => {
      if (a[1] === "view") return VIEW;
      throw bad;
    }),
    (e) => e === bad,
  );
});

test("diffFromFiles: 파일마다 머리와 patch, 이름 바꾼 파일은 옛 이름 머리", () => {
  const r = diffFromFiles([{ filename: "b.ts", status: "renamed", previous_filename: "a.ts", patch: "@@" }]);
  assert.match(r.diff, /^diff --git a\/a\.ts b\/b\.ts\n--- a\/a\.ts\n\+\+\+ b\/b\.ts\n@@\n/);
  assert.deepEqual(r.names, ["b.ts", "a.ts"]);
});

test("GET /api/landing/review: 읽기 실패는 500이 아니라 502와 stderr 첫 줄", async () => {
  const p = { number: 9, url: "https://github.com/o/r/pull/9", head: HEAD, draft: false, ticketKey: "ATC-9", extReview: { status: "waiting" } };
  const app = new Hono();
  mountLandingReview(
    app,
    async () => ({ pulls: [p], airports: [], tickets: [] }) as never,
    async () => {
      throw Object.assign(new Error("Command failed"), { stderr: "HTTP 502: Bad Gateway\nsecond line" });
    },
  );
  const res = await app.request("/api/landing/review/r/9");
  assert.equal(res.status, 502);
  assert.match(((await res.json()) as { error: string }).error, /HTTP 502: Bad Gateway$/);
});

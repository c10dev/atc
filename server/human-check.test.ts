import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  checkRequestOf,
  checkValueOf,
  cleanNote,
  commentOf,
  HumanCheckError,
  humanCheckExclusionOf,
  humanCheckStatusOf,
  imagesOf,
  insideDir,
  parseCheckLine,
  pickRunup,
  runupViewOf,
  setHumanCheckLine,
  uiChangeOf,
  waitsOnHuman,
} from "./human-check.ts";

const REAL_406 = readFileSync(new URL("./fixtures/ui-change-406.md", import.meta.url), "utf8");
const HEAD = "abc1234def5678900000000000000000000000ab";
const OLD = "0123456789abcdef0123456789abcdef01234567";
const refused = (fn: () => unknown, status: number, re: RegExp) =>
  assert.throws(fn, (e: unknown) => e instanceof HumanCheckError && e.status === status && re.test(e.message));

// 합성 본문: 템플릿과 같은 칸 이름, 값만 바꾼다
const body = (o: { impact?: string; cls?: string; evidence?: string; preview?: string; steps?: string; check?: string; extra?: string } = {}) =>
  [
    "## Summary",
    "- something",
    "",
    "## UI change",
    "",
    `- UI impact: ${o.impact ?? "`changes rendered UI`"}`,
    `- Human check class (any that apply): ${o.cls ?? "`ACCOUNT`"}`,
    `- Evidence pack: ${o.evidence ?? "https://github.com/o/app/pull/12#issuecomment-345"}`,
    `- Preview (ACCOUNT or DEVICE only): ${o.preview ?? "https://app-git-x-o.vercel.app/settings"}`,
    `- Human steps (ACCOUNT or DEVICE only): ${o.steps ?? "\n  1. Sign in with Google\n  2. Open settings: the email shows"}`,
    `- Human check: ${o.check ?? "`pending`"}`,
    ...(o.extra ? [o.extra] : []),
    "",
    "## Contracts Preserved / Changed",
    "- Human check: not a field of the block",
  ].join("\n");

const TEMPLATE = [
  "## UI change",
  "",
  "- UI impact: `none` / `changes rendered UI`",
  "- Human check class (any that apply): `CHOICE` (new screen, visual direction) / `ACCOUNT` (signed-in, OAuth) / `DEVICE` (touch, rotation) / `none`",
  "- Evidence pack: link to the PR comment with before/after screenshots and agent QA result",
  "- Preview (ACCOUNT or DEVICE only): exact URL for the current head",
  "- Human steps (ACCOUNT or DEVICE only): 1–3 steps with the expected result",
  "- Human check: `not needed` / `pending` / `done <date> <head sha> <what was seen>`",
].join("\n");

test("실제 본문(vocado #406): class none, not needed — 대기열에 들지 않고 머지를 막지 않는다", () => {
  const ui = uiChangeOf(REAL_406)!;
  assert.equal(ui.impact, "none");
  assert.deepEqual(ui.classes, []);
  assert.equal(ui.classUnfilled, false);
  assert.equal(ui.evidence, null);
  assert.equal(ui.preview, null);
  assert.equal(ui.steps, null);
  assert.equal(ui.check.state, "not-needed");
  assert.equal(ui.checkLines, 1);
  const s = humanCheckStatusOf(ui, HEAD)!;
  assert.equal(s.required, false);
  assert.equal(waitsOnHuman(s), false);
  assert.equal(humanCheckExclusionOf(ui, s), null);
});

test("블록 읽기: class·증거 댓글·Preview·여러 줄 단계·다음 ## 뒤의 같은 이름 줄은 무시", () => {
  const ui = uiChangeOf(body())!;
  assert.equal(ui.impact, "changes");
  assert.deepEqual(ui.classes, ["ACCOUNT"]);
  assert.deepEqual(ui.evidenceComment, { slug: "o/app", number: 12, id: 345 });
  assert.equal(ui.preview, "https://app-git-x-o.vercel.app/settings");
  assert.equal(ui.steps, "1. Sign in with Google\n2. Open settings: the email shows");
  assert.equal(ui.check.state, "pending");
  assert.equal(ui.checkLines, 1);
  assert.deepEqual(uiChangeOf(body({ cls: "`CHOICE`, `DEVICE`" }))!.classes, ["CHOICE", "DEVICE"]);
  assert.deepEqual(uiChangeOf(body({ cls: "`device` / `choice`" }))!.classes, ["CHOICE", "DEVICE"]);
  // class가 있으면 none이 같이 적혀도 class로(애매하면 사람 확인 쪽)
  assert.deepEqual(uiChangeOf(body({ cls: "`none`, `CHOICE`" }))!.classes, ["CHOICE"]);
  assert.equal(uiChangeOf("## Summary\nno block"), null);
  assert.equal(uiChangeOf(null), null);
});

test("템플릿 그대로면 채우지 않은 것", () => {
  const ui = uiChangeOf(TEMPLATE)!;
  assert.equal(ui.impact, "unfilled");
  assert.equal(ui.classUnfilled, true);
  assert.deepEqual(ui.classes, []);
  assert.equal(ui.preview, null);
  assert.equal(ui.steps, null);
  assert.equal(ui.check.state, "unfilled");
  assert.equal(humanCheckExclusionOf(ui, humanCheckStatusOf(ui, HEAD)), "UI change class를 채우지 않음");
});

test("Human check 줄: done·failed는 날짜·SHA·메모, 나머지는 상태만", () => {
  assert.deepEqual(parseCheckLine("`done 2026-09-28 abc1234 login and logout work`"), { state: "done", date: "2026-09-28", sha: "abc1234", note: "login and logout work" });
  assert.deepEqual(parseCheckLine("`failed 2026-09-28 ABC1234DEF safe area cut`"), { state: "failed", date: "2026-09-28", sha: "abc1234def", note: "safe area cut" });
  assert.equal(parseCheckLine("`not needed`").state, "not-needed");
  assert.equal(parseCheckLine("pending").state, "pending");
  assert.equal(parseCheckLine("done yesterday").state, "unfilled");
  assert.equal(parseCheckLine("").state, "unfilled");
});

test("head에 묶인다: 이 head면 done, main 병합만 한 이전 커밋이면 이어받고, 다른 옛 head면 stale", () => {
  const done = (sha: string) => uiChangeOf(body({ check: `\`done 2026-09-28 ${sha.slice(0, 7)} ok\`` }));
  assert.deepEqual(humanCheckStatusOf(done(HEAD), HEAD), { required: true, classes: ["ACCOUNT"], state: "done", sha: "abc1234", carriedFrom: null });
  const carried = humanCheckStatusOf(done(OLD), HEAD, [OLD])!;
  assert.equal(carried.state, "done");
  assert.equal(carried.carriedFrom, OLD);
  assert.equal(waitsOnHuman(carried), false);
  const stale = humanCheckStatusOf(done(OLD), HEAD, [])!;
  assert.equal(stale.state, "stale");
  assert.equal(waitsOnHuman(stale), true);
  // failed도 이어받지만 대기열에 남는다
  const failed = humanCheckStatusOf(uiChangeOf(body({ check: `\`failed 2026-09-28 ${HEAD.slice(0, 7)} broken\`` })), HEAD)!;
  assert.equal(failed.state, "failed");
  assert.equal(waitsOnHuman(failed), true);
  assert.equal(humanCheckStatusOf(null, HEAD), null);
});

test("대기열: class가 있고 done이 아닌 PR만. class none·UI 영향 없음은 들지 않는다", () => {
  assert.equal(waitsOnHuman(humanCheckStatusOf(uiChangeOf(body()), HEAD)), true);
  assert.equal(waitsOnHuman(humanCheckStatusOf(uiChangeOf(body({ cls: "`none`", check: "`not needed`" })), HEAD)), false);
  assert.equal(waitsOnHuman(humanCheckStatusOf(uiChangeOf(body({ impact: "`none`", cls: "`CHOICE`" })), HEAD)), false);
  // class가 있는데 not needed로 적혀도 사람 확인을 기다린다
  assert.equal(waitsOnHuman(humanCheckStatusOf(uiChangeOf(body({ cls: "`DEVICE`", check: "`not needed`" })), HEAD)), true);
});

test("AUTOLAND merge 제외: class PR은 done까지, class 없는 UI PR은 막지 않음, 블록이 없으면 모름", () => {
  const ex = (b: string, carry: string[] = []) => {
    const ui = uiChangeOf(b);
    return humanCheckExclusionOf(ui, humanCheckStatusOf(ui, HEAD, carry));
  };
  assert.equal(ex(body()), "HUMAN CHECK ACCOUNT — pending");
  assert.equal(ex(body({ cls: "`CHOICE`, `DEVICE`", check: `\`done 2026-09-28 ${OLD.slice(0, 7)} ok\`` })), "HUMAN CHECK CHOICE·DEVICE — 옛 head에 기록됨");
  assert.equal(ex(body({ check: `\`done 2026-09-28 ${OLD.slice(0, 7)} ok\`` }), [OLD]), null);
  assert.equal(ex(body({ check: `\`done 2026-09-28 ${HEAD.slice(0, 7)} ok\`` })), null);
  assert.equal(ex(body({ cls: "`none`", check: "`not needed`" })), null);
  assert.equal(ex("## Summary\nHuman Preview applicability: `required`"), "UI change 블록 없음 — HUMAN CHECK 필요 여부를 모름");
});

test("Human check 줄 하나만 고쳐 쓴다(다른 줄·다른 절은 그대로). 블록이 없거나 줄이 둘이면 거절", () => {
  const before = body();
  const after = setHumanCheckLine(before, checkValueOf("pass", "2026-09-28", HEAD, "email shows"));
  const a = before.split("\n");
  const b = after.split("\n");
  assert.equal(a.length, b.length);
  const changed = a.map((l, i) => (l === b[i] ? null : i)).filter((i) => i !== null);
  assert.deepEqual(changed, [a.indexOf("- Human check: `pending`")]);
  assert.equal(b[changed[0]!], "- Human check: `done 2026-09-28 abc1234 email shows`");
  assert.equal(b.at(-1), "- Human check: not a field of the block");
  assert.equal(uiChangeOf(after)!.check.state, "done");
  // CRLF는 CRLF로
  assert.match(setHumanCheckLine(before.replace(/\n/g, "\r\n"), "`pending`"), /\r\n## Contracts/);
  refused(() => setHumanCheckLine("## Summary", "x"), 409, /블록이 없음/);
  refused(() => setHumanCheckLine(body({ extra: "- Human check: `pending`" }), "x"), 409, /2개/);
  // 실제 본문도 그 줄만 바뀐다
  const real = setHumanCheckLine(REAL_406, "`pending`");
  assert.equal(real.split("\n").filter((l, i) => l !== REAL_406.split("\n")[i]).length, 1);
});

test("PASS·FAIL 요청: 화면이 본 head가 지금 head여야, class PR이어야, FAIL은 메모가 있어야", () => {
  const pr = { head: HEAD, body: body(), draft: false };
  const ok = checkRequestOf({ result: "pass", note: "", head: HEAD.slice(0, 7) }, pr);
  assert.equal(ok.result, "pass");
  assert.equal(ok.note, "checked in atc");
  refused(() => checkRequestOf({ result: "maybe", note: "", head: HEAD }, pr), 400, /pass \| fail/);
  refused(() => checkRequestOf({ result: "pass", note: "", head: OLD }, pr), 409, /head가 바뀜/);
  refused(() => checkRequestOf({ result: "pass", note: "", head: "; rm -rf" }, pr), 400, /SHA/);
  refused(() => checkRequestOf({ result: "fail", note: "  ", head: HEAD }, pr), 400, /메모/);
  refused(() => checkRequestOf({ result: "pass", note: "", head: HEAD }, { ...pr, body: REAL_406 }), 409, /class가 아님/);
  refused(() => checkRequestOf({ result: "pass", note: "", head: HEAD }, { ...pr, body: "## Summary" }), 409, /블록이 없음/);
  refused(() => checkRequestOf({ result: "pass", note: "", head: HEAD }, { ...pr, body: body({ extra: "- Human check: `pending`" }) }), 409, /2개/);
});

test("메모는 한 줄·백틱 없이·200자, 댓글은 결과·head·class·메모", () => {
  assert.equal(cleanNote("a`b`\nc\t d"), "ab c d");
  assert.equal(cleanNote("x".repeat(300)).length, 200);
  assert.equal(cleanNote(42), "");
  assert.equal(checkValueOf("fail", "2026-09-28", HEAD, "cut off"), "`failed 2026-09-28 abc1234 cut off`");
  const c = commentOf("fail", HEAD, ["ACCOUNT", "DEVICE"], "cut off", "2026-09-28");
  assert.match(c, /^\*\*HUMAN CHECK: FAIL\*\* · head `abc1234` · ACCOUNT, DEVICE · 2026-09-28/);
  assert.match(c, /> cut off/);
});

test("증거: 댓글 HTML의 https 이미지만, 중복 없이", () => {
  const html = '<p><img src="https://private-user-images.githubusercontent.com/1/a.png?jwt=x&amp;y=1" alt="a"> <img alt="b" src="https://x/b.png"><img src="http://insecure/c.png"><img src="https://x/b.png"></p>';
  assert.deepEqual(imagesOf(html), ["https://private-user-images.githubusercontent.com/1/a.png?jwt=x&y=1", "https://x/b.png"]);
  assert.deepEqual(imagesOf(null), []);
});

test("RUN-UP 보고서: 이 head의 가장 새 것, 바뀐 컷의 after만, 보고서 폴더 밖 경로는 거절", () => {
  const report = (sha: string) => ({ head: { sha }, summary: { screens: 3, changedScreens: 2, cuts: 18, changedCuts: 2 }, warnings: [{ type: "unexpected-change", path: "/blog" }], cuts: [
    { path: "/", state: "default", width: 390, colorScheme: "light", browser: "chromium", status: "changed", images: { after: "cuts/1/after.png" } },
    { path: "/", status: "unchanged", images: {} },
    { path: "/blog", status: "changed", images: { after: "cuts/2/after.png" } },
  ] });
  const found = [
    { run: `1111111-${HEAD.slice(0, 7)}`, mtime: 1, report: report(HEAD) },
    { run: `2222222-${HEAD.slice(0, 7)}`, mtime: 2, report: report(HEAD) },
    { run: `3333333-${OLD.slice(0, 7)}`, mtime: 3, report: report(OLD) },
    { run: `4444444-${HEAD.slice(0, 7)}`, mtime: 4, report: report(OLD) }, // 이름만 맞음
  ];
  assert.equal(pickRunup(found, HEAD)?.run, `2222222-${HEAD.slice(0, 7)}`);
  assert.equal(pickRunup(found, "f".repeat(40)), null);
  const v = runupViewOf("r", report(HEAD));
  assert.deepEqual([v.changedScreens, v.screens, v.changedCuts, v.cuts], [2, 3, 2, 18]);
  assert.deepEqual(v.unexpected, ["/blog"]);
  assert.deepEqual(v.thumbs, [{ image: "cuts/1/after.png", label: "/ · default · 390px · light · chromium" }, { image: "cuts/2/after.png", label: "/blog" }]);
  assert.equal(insideDir("/r/.runup/x", "cuts/1/after.png"), "/r/.runup/x/cuts/1/after.png");
  assert.equal(insideDir("/r/.runup/x", "../../../etc/passwd"), null);
  assert.equal(insideDir("/r/.runup/x", "/etc/passwd"), null);
  assert.equal(insideDir("/r/.runup/x", ""), null);
});

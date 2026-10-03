import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatItem } from "./duty-chat.ts";
import { blocksOf, choicesOf, foldTools, leadOf, matchesQuery, nextStick, scrollTopAfterResize, shiftsOf, stuckToBottom, toolLabel } from "./duty-view.ts";

test("blocksOf splits paragraph, list, table, code and heading", () => {
  const src = ["# Title", "", "first line", "second line", "", "- a", "- b", "", "| x | y |", "|---|---|", "| 1 | 2 |", "", "```ts", "const a = 1;", "", "const b = 2;", "```", "", "tail"].join("\n");
  const blocks = blocksOf(src);
  assert.deepEqual(blocks.map((b) => b.kind), ["heading", "paragraph", "list", "table", "code", "paragraph"]);
  assert.equal(blocks[4].text, "```ts\nconst a = 1;\n\nconst b = 2;\n```");
});

test("blocksOf keeps a list across a blank line and runs an unclosed fence to the end", () => {
  assert.equal(blocksOf("- a\n\n- b\n  more").length, 1);
  const open = blocksOf("```\nnever closed\n\nstill code");
  assert.equal(open.length, 1);
  assert.equal(open[0].kind, "code");
  assert.deepEqual(blocksOf(""), []);
});

test("leadOf does not split a short answer", () => {
  assert.deepEqual(leadOf("one\ntwo\nthree"), { lead: "one\ntwo\nthree", rest: "" });
  assert.deepEqual(leadOf("short"), { lead: "short", rest: "" });
});

test("leadOf takes the first paragraph and folds the rest", () => {
  const r = leadOf("conclusion line\n\n- detail 1\n- detail 2\n- detail 3");
  assert.equal(r.lead, "conclusion line");
  assert.equal(r.rest, "- detail 1\n- detail 2\n- detail 3");
});

test("leadOf cuts a long first paragraph at 3 lines but never inside a list, table or code block", () => {
  const p = leadOf("a\nb\nc\nd\ne\n\nnext");
  assert.equal(p.lead, "a\nb\nc");
  assert.equal(p.rest, "d\ne\n\nnext");
  const list = leadOf("- 1\n- 2\n- 3\n- 4\n- 5\n\nafter");
  assert.equal(list.lead, "- 1\n- 2\n- 3\n- 4\n- 5");
  assert.equal(list.rest, "after");
  const code = leadOf("```\nx\ny\nz\n```\n\nafter text");
  assert.equal(code.lead, "```\nx\ny\nz\n```");
  assert.equal(code.rest, "after text");
  const table = leadOf("| a |\n|---|\n| 1 |\n| 2 |\n\nafter");
  assert.equal(table.lead.split("\n").length, 4);
  assert.equal(table.rest, "after");
});

test("leadOf keeps a heading with the block after it", () => {
  const r = leadOf("## Why\n\nbecause of this and that\n\nmore\n\neven more");
  assert.ok(r.lead.startsWith("## Why\n\nbecause"));
});

test("choicesOf pulls out a choices block and strips list marks", () => {
  const r = choicesOf("Which one?\n\n```choices\n- 승인\n2. 보류\n  거절  \n\n```\n");
  assert.equal(r.text, "Which one?");
  assert.deepEqual(r.choices, ["승인", "보류", "거절"]);
});

test("choicesOf leaves other code blocks and answers without choices alone", () => {
  const r = choicesOf("see\n\n```ts\nconst x = 1;\n```");
  assert.deepEqual(r.choices, []);
  assert.equal(r.text, "see\n\n```ts\nconst x = 1;\n```");
  assert.deepEqual(choicesOf("plain").choices, []);
});

test("choicesOf caps the count and the length of choices", () => {
  const many = Array.from({ length: 12 }, (_, i) => `- c${i}`).join("\n");
  assert.equal(choicesOf(`\`\`\`choices\n${many}\n\`\`\``).choices.length, 8);
  assert.equal(choicesOf(`\`\`\`choices\n${"x".repeat(500)}\n\`\`\``).choices[0].length, 200);
});

const tool = (id: string, error = false): ChatItem => ({ id, kind: "tool", name: `t${id}`, summary: "", error, t: "2026-10-03T00:00:00Z" });
const text = (id: string): ChatItem => ({ id, kind: "text", text: id, t: "2026-10-03T00:00:00Z" });

test("foldTools folds each turn of tool lines into one row and counts refusals", () => {
  const rows = foldTools([text("a"), tool("1"), tool("2", true), tool("3"), text("b"), tool("4")], false);
  assert.deepEqual(rows.map((r) => r.kind), ["item", "tools", "item", "tools"]);
  const first = rows[1];
  assert.ok(first.kind === "tools");
  assert.equal(toolLabel(first), "도구 3 · 거절 1");
  assert.equal(first.running, null);
  const last = rows[3];
  assert.ok(last.kind === "tools");
  assert.equal(toolLabel(last), "도구 1");
});

test("foldTools marks the running tool only in the trailing group while thinking", () => {
  const rows = foldTools([tool("1"), text("a"), tool("2"), tool("3")], true);
  const groups = rows.filter((r) => r.kind === "tools");
  assert.equal(groups[0].kind === "tools" && groups[0].running, null);
  assert.equal(groups[1].kind === "tools" && groups[1].running, "t3");
});

test("shiftsOf lists dividers with their message counts", () => {
  const items: ChatItem[] = [
    { id: "u0", kind: "user", text: "old", t: "x" },
    { id: "s1", kind: "shift", t: "2026-10-03T01:00:00Z" },
    { id: "u1", kind: "user", text: "q", t: "x" },
    text("a1"),
    tool("9"),
    { id: "s2", kind: "shift", t: "2026-10-03T02:00:00Z" },
    text("a2"),
  ];
  assert.deepEqual(shiftsOf(items), [
    { id: "s1", t: "2026-10-03T01:00:00Z", count: 2 },
    { id: "s2", t: "2026-10-03T02:00:00Z", count: 1 },
  ]);
});

test("matchesQuery filters loaded lines case-insensitively", () => {
  assert.equal(matchesQuery(text("Hello World"), "hello"), true);
  assert.equal(matchesQuery(text("Hello"), "xyz"), false);
  assert.equal(matchesQuery(tool("1"), "t1"), false);
  assert.equal(matchesQuery(text("a"), "  "), true);
});

test("the log stays stuck to the bottom through a viewport resize", () => {
  // 맨 아래를 보던 로그: 높이가 줄면 브라우저가 scrollTop을 잘라 스크롤 이벤트가 나지만 붙은 상태는 그대로다
  const before = { scrollHeight: 2000, scrollTop: 1500, clientHeight: 500 };
  assert.equal(stuckToBottom(before), true);
  const shrunk = { scrollHeight: 2000, scrollTop: 1500, clientHeight: 300 }; // 이제 200px 위에 있다
  assert.equal(stuckToBottom(shrunk), false);
  assert.equal(nextStick(true, shrunk, true), true); // 크기 변화 중의 스크롤은 상태를 바꾸지 않는다
  assert.equal(scrollTopAfterResize(true, shrunk), 1700); // 다시 맨 아래로
  const grown = { scrollHeight: 2000, scrollTop: 1500, clientHeight: 800 };
  assert.equal(scrollTopAfterResize(true, grown), 1200);
});

test("a log the reader scrolled up is not pulled down by a resize, and scrolling back re-sticks", () => {
  const up = { scrollHeight: 2000, scrollTop: 400, clientHeight: 500 };
  assert.equal(nextStick(true, up, false), false);
  assert.equal(scrollTopAfterResize(false, up), null);
  assert.equal(nextStick(false, { scrollHeight: 2000, scrollTop: 1490, clientHeight: 500 }, false), true);
  assert.equal(scrollTopAfterResize(true, { scrollHeight: 300, clientHeight: 500 }), 0);
});

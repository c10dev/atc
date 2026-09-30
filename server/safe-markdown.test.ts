import assert from "node:assert/strict";
import test from "node:test";
import { renderSafeMarkdown } from "./safe-markdown.ts";

test("원시 HTML은 태그로 살아나지 않는다", () => {
  const html = renderSafeMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\ntext <b onclick="x">b</b>');
  assert.ok(!/<script|<img|<b /i.test(html), html);
  assert.ok(html.includes("&lt;script&gt;"));
});

test("링크: http(s)만 새 탭·noreferrer, 그 밖의 주소는 글자만 남는다", () => {
  const ok = renderSafeMarkdown("[a](https://example.com/x?y=1&z=2)");
  assert.match(ok, /<a href="https:\/\/example\.com\/x\?y=1&amp;z=2" target="_blank" rel="noreferrer">a<\/a>/);
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "vbscript:x", "//evil.com", "/relative"]) {
    const html = renderSafeMarkdown(`[a](${bad})`);
    assert.ok(!html.includes("<a"), html);
    assert.ok(!/href/.test(html), html);
  }
});

test("이미지는 링크 글자로만, 따옴표는 이스케이프한다", () => {
  const html = renderSafeMarkdown('![x" onerror="y](https://e.com/a.png)');
  assert.ok(!html.includes("<img"), html);
  assert.ok(!html.includes('onerror="'), html);
  assert.ok(!/<img|<a|href/.test(renderSafeMarkdown("![a](javascript:1)")), "javascript 이미지");
});

test("코드 블록 안의 HTML도 이스케이프된다", () => {
  const html = renderSafeMarkdown("```\n<script>x</script>\n```");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
});

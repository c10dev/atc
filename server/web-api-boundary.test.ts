import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// ATC-346: 화면은 서버를 web/src/api.ts로만 부른다. 다른 파일에 fetch 호출이 생기면 여기서 막는다
const WEB = join(import.meta.dirname, "..", "web", "src");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

test("web/src has no fetch( outside api.ts", () => {
  const bad = sources(WEB)
    .filter((p) => !p.endsWith(join("src", "api.ts")))
    .filter((p) => /(?<![\w.])fetch\(/.test(readFileSync(p, "utf8").replace(/^\s*\/\/.*$/gm, "")));
  assert.deepEqual(bad, []);
});

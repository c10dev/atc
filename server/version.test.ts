import assert from "node:assert/strict";
import { test } from "node:test";
import { entryScript, isChunkLoadError, showNewVersion } from "./version.ts";

const OLD = "/assets/index-DZervX0u.js";
const NEW = "/assets/index-CuqNYoi2.js";

test("진입 스크립트: vite 빌드의 index.html에서 경로를 읽는다", () => {
  const html = `<!doctype html>
<html lang="ko">
  <head>
    <link href="https://fonts.googleapis.com/css2?family=B612" rel="stylesheet" />
    <script type="module" crossorigin src="/assets/index-DZervX0u.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-BQYOI-W-.css">
  </head>
  <body><div id="root"></div></body>
</html>`;
  assert.equal(entryScript(html), OLD);
});

test("진입 스크립트: 없으면 null", () => {
  assert.equal(entryScript(""), null);
  assert.equal(entryScript("<html><body><div id=root></div></body></html>"), null);
  // module이 아니거나 src가 없는 스크립트는 진입이 아니다
  assert.equal(entryScript(`<script src="/legacy.js"></script><script type="module">import "./x.js"</script>`), null);
  // 주석 안의 태그는 무시
  assert.equal(entryScript(`<!-- <script type="module" src="/assets/old.js"></script> -->`), null);
});

test("진입 스크립트: 속성 순서·따옴표·대소문자가 달라도 같은 경로", () => {
  assert.equal(entryScript(`<SCRIPT SRC='/assets/index-DZervX0u.js' Type="Module"></SCRIPT>`), OLD);
  assert.equal(entryScript(`<script crossorigin type=module src=/assets/index-DZervX0u.js></script>`), OLD);
  assert.equal(entryScript(`<script\n  type="module"\n  src = "/assets/index-DZervX0u.js"\n></script>`), OLD);
  // data-src 같은 비슷한 속성은 src가 아니다
  assert.equal(entryScript(`<script type="module" data-src="/assets/a.js" src="/assets/index-DZervX0u.js"></script>`), OLD);
  // 상대 경로, 절대 주소, 쿼리는 경로만 남긴다(화면의 import.meta.url 경로와 비교하므로)
  assert.equal(entryScript(`<script type="module" src="./assets/index-DZervX0u.js"></script>`), OLD);
  assert.equal(entryScript(`<script type="module" src="http://localhost:7700/assets/index-DZervX0u.js?v=1"></script>`), OLD);
  // 여럿이면 첫 module 스크립트
  assert.equal(entryScript(`<script type="module" src="${OLD}"></script><script type="module" src="${NEW}"></script>`), OLD);
});

test("새 버전 알림: 서버 번들이 다를 때만", () => {
  assert.equal(showNewVersion(OLD, OLD, null), false);
  assert.equal(showNewVersion(OLD, NEW, null), true);
});

test("새 버전 알림: 개발 화면이거나 서버가 빌드를 모르면 띄우지 않는다", () => {
  assert.equal(showNewVersion("/src/main.tsx", NEW, null), false);
  assert.equal(showNewVersion(OLD, null, null), false);
  assert.equal(showNewVersion(OLD, undefined, null), false);
});

test("새 버전 알림: 닫은 번들은 다시 띄우지 않고, 그 다음 번들은 띄운다", () => {
  assert.equal(showNewVersion(OLD, NEW, NEW), false);
  assert.equal(showNewVersion(OLD, "/assets/index-third.js", NEW), true);
  // 닫은 뒤 서버가 원래 번들로 돌아가면(되돌림 배포) 알릴 것이 없다
  assert.equal(showNewVersion(OLD, OLD, NEW), false);
});

test("청크를 못 불러온 오류: 브라우저마다 다른 문구를 알아보고, 다른 오류는 아니다", () => {
  for (const m of [
    "Failed to fetch dynamically imported module: http://127.0.0.1:7700/assets/Docs-yNT5vvwm.js",
    "error loading dynamically imported module: http://127.0.0.1:7700/assets/Fleet-CA9mCL4L.js",
    "Importing a module script failed.",
    "Unable to preload CSS for /assets/Fleet-NzDF3V66.css",
  ]) assert.equal(isChunkLoadError(new TypeError(m)), true, m);
  assert.equal(isChunkLoadError("Failed to fetch dynamically imported module: x"), true);
  assert.equal(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')")), false);
  assert.equal(isChunkLoadError(new TypeError("Failed to fetch")), false); // API fetch 실패는 청크 오류가 아니다
  assert.equal(isChunkLoadError(null), false);
});

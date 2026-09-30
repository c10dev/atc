import assert from "node:assert/strict";
import { test } from "node:test";
import { hostOf } from "../web/src/host.ts";

// ATC-178: 창 종류 판별(순수). ANNUNCIATOR 창의 user-agent는 끝에 `ANNUNCIATOR/<version>`이 붙는다(atc-app N7)
const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const CHROME = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

test("hostOf: ANNUNCIATOR/<version> 접미사가 있으면 annunciator", () => {
  assert.equal(hostOf(`${SAFARI} ANNUNCIATOR/0.2.0`), "annunciator");
  assert.equal(hostOf(`${SAFARI} ANNUNCIATOR/1.10.3-beta`), "annunciator");
  assert.equal(hostOf("ANNUNCIATOR/0.2.0"), "annunciator");
});

test("hostOf: 보통 브라우저 user-agent, 비었거나 모르는 값은 browser", () => {
  assert.equal(hostOf(SAFARI), "browser");
  assert.equal(hostOf(CHROME), "browser");
  assert.equal(hostOf(""), "browser");
  assert.equal(hostOf(null), "browser");
  assert.equal(hostOf(undefined), "browser");
});

test("hostOf: 버전이 없거나 이름에 섞인 글자는 앱이 아니다", () => {
  assert.equal(hostOf(`${SAFARI} ANNUNCIATOR`), "browser");
  assert.equal(hostOf(`${SAFARI} ANNUNCIATOR/`), "browser");
  assert.equal(hostOf(`${SAFARI} NOTANNUNCIATOR/0.2.0`), "browser");
  assert.equal(hostOf(`${SAFARI} annunciator/0.2.0`), "browser"); // 대소문자는 앱이 붙인 그대로
});

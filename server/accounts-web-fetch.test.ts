import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fromThisApp } from "./origin.ts";

// ATC-238: 설정 창의 SHARE MEMORY가 Content-Type 없이 POST해 fromThisApp에 늘 막혔다. 화면 쪽 요청이 JSON 머리를 싣는지 지킨다
test("SettingsAccounts: /api/accounts/memory POST는 Content-Type: application/json을 싣는다", () => {
  const src = readFileSync(new URL("../web/src/SettingsAccounts.tsx", import.meta.url), "utf8");
  const call = src.match(/fetch\("\/api\/accounts\/memory",\s*\{[^}]*method: "POST"[^)]*\)/)?.[0];
  assert.ok(call, "memory POST fetch를 찾지 못함");
  assert.match(call, /"Content-Type":\s*"application\/json"/);
});

test("fromThisApp은 그대로 엄격하다(JSON 머리 없으면 거부)", () => {
  const req = (h: Record<string, string>) => ({ req: { header: (k: string) => h[k.toLowerCase()] } }) as Parameters<typeof fromThisApp>[0];
  assert.equal(fromThisApp(req({ origin: "http://localhost:7700" })), false);
  assert.equal(fromThisApp(req({ "content-type": "application/json", origin: "http://localhost:7700" })), true);
});

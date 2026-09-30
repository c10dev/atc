import type { Hono } from "hono";
import { folderHealthOf, forgetAuthStatus } from "./account-health.ts";
import { AccountsError, accountFolders, loadAccounts, validateAccounts } from "./accounts.ts";
import { saveAccounts } from "./fleet.ts";
import { fromThisApp } from "./origin.ts";

// 설정 창 AGENTS 탭의 ACCOUNTS 블록(ATC-146). 읽기는 등록부와 폴더 health, 쓰기는 SUPERVISOR만(다른 설정 저장과 같은 Origin 검사)
export function mountAccounts(app: Hono) {
  app.get("/api/accounts", async (c) => c.json({ registry: loadAccounts(), folders: await folderHealthOf(accountFolders()) }));
  app.put("/api/accounts", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const body = (await c.req.json().catch(() => null)) as { accounts?: unknown } | null;
    if (!body || typeof body !== "object" || Array.isArray(body) || !("accounts" in body)) return c.json({ error: "{ accounts: { 라벨: { configDir } } } 형태가 아님" }, 400);
    try {
      saveAccounts(validateAccounts(body.accounts));
    } catch (e) {
      if (e instanceof AccountsError) return c.json({ error: e.message }, 400);
      throw e;
    }
    forgetAuthStatus();
    console.log(`[atc] accounts updated: ${Object.keys(loadAccounts()).join(", ") || "(none)"}`);
    return c.json({ registry: loadAccounts(), folders: await folderHealthOf(accountFolders()) });
  });
}

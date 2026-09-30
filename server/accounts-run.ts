import type { Hono } from "hono";
import { addAccount, addPreviewOf } from "./account-add.ts";
import { folderHealthOf, forgetAuthStatus } from "./account-health.ts";
import { cancelLogin, loginView, startLogin, submitCode } from "./account-login.ts";
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

  // ADD ACCOUNT(ATC-186): 폴더 만들기·settings.json 복사·등록. 미리보기는 env 키 이름만 보낸다
  app.get("/api/accounts/add", (c) => c.json(addPreviewOf()));
  app.post("/api/accounts/add", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "{ label, configDir?, homeLabel?, dropEnv? } 형태가 아님" }, 400);
    let result;
    try {
      result = addAccount({ label: body.label as string, configDir: body.configDir as string | undefined, homeLabel: body.homeLabel as string | undefined, dropEnv: body.dropEnv as string[] | undefined });
    } catch (e) {
      if (e instanceof AccountsError) return c.json({ error: e.message }, 400);
      throw e;
    }
    forgetAuthStatus();
    console.log(`[atc] account added: ${result.label} → ${result.dir} (folder ${result.folder}, settings ${result.settings}${result.homeRegistered ? `, ~/.claude as ${result.homeRegistered}` : ""})`);
    return c.json({ result, registry: loadAccounts(), folders: await folderHealthOf(accountFolders()) });
  });

  // LOGIN(ATC-187): 등록된 폴더에서 claude auth login을 돌리고 코드를 넘긴다. 코드와 프로세스 출력은 남기지 않는다
  app.get("/api/accounts/:label/login", (c) => c.json({ login: loginView(c.req.param("label")) }));
  app.post("/api/accounts/:label/login", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    try {
      return c.json({ login: await startLogin(c.req.param("label")) });
    } catch (e) {
      if (e instanceof AccountsError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });
  app.post("/api/accounts/:label/login/code", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const body = (await c.req.json().catch(() => null)) as { code?: unknown } | null;
    try {
      const login = await submitCode(c.req.param("label"), body?.code);
      return c.json({ login, registry: loadAccounts(), folders: await folderHealthOf(accountFolders()) });
    } catch (e) {
      if (e instanceof AccountsError) return c.json({ error: e.message }, 400);
      throw e;
    }
  });
  app.delete("/api/accounts/:label/login", (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    return c.json({ cancelled: cancelLogin(c.req.param("label")) });
  });
}

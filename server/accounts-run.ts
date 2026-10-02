import type { Hono } from "hono";
import { memoryView, shareMemory } from "./account-memory.ts";
import { addAccount, addPreviewOf } from "./account-add.ts";
import { folderHealthOf, forgetAuthStatus } from "./account-health.ts";
import { planUsageViewsOf } from "./account-usage.ts";
import { lastUsageRead, refreshUsage } from "./account-usage-run.ts";
import { cancelLogin, loginView, startLogin, submitCode } from "./account-login.ts";
import { AccountsError, accountFolders, loadAccounts, validateAccounts } from "./accounts.ts";
import { loadDispatchConfig } from "./dispatch.ts";
import { saveAccounts } from "./fleet.ts";
import { fuelConfigOf } from "./fuel-remaining.ts";
import type { Snapshot } from "./model.ts";
import { fromThisApp } from "./origin.ts";

// 설정 창 AGENTS 탭의 ACCOUNTS 블록(ATC-146). 읽기는 등록부와 폴더 health, 쓰기는 SUPERVISOR만(다른 설정 저장과 같은 Origin 검사)
export function mountAccounts(app: Hono, getSnapshot: () => Promise<Snapshot>) {
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

  // SHARE MEMORY(ATC-191): 폴더별 memory 상태(파일 이름만)와, 등록된 폴더의 memory를 ~/.claude 것으로 잇기
  app.get("/api/accounts/memory", (c) => c.json({ memory: memoryView() }));
  app.post("/api/accounts/memory", (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const { result, view } = shareMemory();
    console.log(`[atc] memory shared: linked ${result.linked}, kept ${result.kept}, conflicts ${result.conflicts}${result.errors.length ? `, errors ${result.errors.length}` : ""}`);
    return c.json({ result, memory: view });
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

  // PLAN · USAGE(ATC-348): 폴더마다 쓴 몫·남은 몫. statusline(스냅샷의 FUEL REMAINING)과 마지막 /usage(메모리) 가운데 새것, 수준은 FUEL 임계값으로 서버가 정한다
  const usageViews = async () => {
    const s = await getSnapshot();
    const folders = accountFolders();
    return planUsageViewsOf(folders, s.fuelAccounts ?? [], new Map(folders.flatMap((f) => (lastUsageRead(f.dir) ? [[f.dir, lastUsageRead(f.dir)!]] : []))), fuelConfigOf(loadDispatchConfig().fuel), Date.now());
  };
  app.get("/api/accounts/usage", async (c) => c.json({ usage: await usageViews() }));
  // REFRESH: 그 폴더에서 `claude -p "/usage"`(모델 호출 없음). 한 번에 하나, 최근 값은 다시 읽지 않는다. SUPERVISOR만
  app.post("/api/accounts/:label/usage", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const label = c.req.param("label");
    const folder = accountFolders().find((f) => f.label === label);
    if (!folder) return c.json({ error: `모르는 ACCOUNT: ${label}` }, 404);
    const { read, cached } = await refreshUsage(folder.dir);
    if (!cached) console.log(`[atc] usage read: ${label} ${read.windows.length ? `${read.windows.length} windows` : `unknown (${read.reason})`}`);
    return c.json({ cached, usage: await usageViews() });
  });
}

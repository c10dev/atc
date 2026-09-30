import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type AccountFolder, accountFolders } from "./accounts.ts";
import { config } from "./config.ts";
import { cleanEnv } from "./clean-env.ts";

// 폴더 health(ATC-146, docs/accounts.md): 등록된 폴더마다 로그인했는지, settings.json에 atc의 statusline과 hook이 걸려 있는지.
// 없는 조각은 경고일 뿐 막지 않는다. `claude auth status --json`에서는 loggedIn과 authMethod만 남기고 나머지(email·조직·요금제 …)는 저장도 전송도 하지 않는다.
// `.credentials.json`은 읽지 않는다.

export interface AuthStatus {
  loggedIn: boolean | null; // null: 확인하지 못함(claude가 없거나 시간 초과·깨진 출력)
  authMethod: string | null;
}

const METHOD = /^[\w.+-]{1,40}$/;
// 순수: auth status 출력 → 허용한 두 칸만. 다른 필드는 그대로 버린다
export function authFieldsOf(text: string): AuthStatus {
  try {
    const d = JSON.parse(text) as Record<string, unknown> | null;
    if (!d || typeof d !== "object" || typeof d.loggedIn !== "boolean") return { loggedIn: null, authMethod: null };
    return { loggedIn: d.loggedIn, authMethod: typeof d.authMethod === "string" && METHOD.test(d.authMethod) ? d.authMethod : null };
  } catch {
    return { loggedIn: null, authMethod: null };
  }
}

export interface SettingsPieces {
  statusline: boolean; // hooks/fuel-statusline.mjs가 걸려 있다
  claimHook: boolean;
  healthHook: boolean;
}
// 순수: settings.json 본문 → atc 조각이 걸려 있는지(글자 검색, 기존 claim hook 검사와 같은 방식)
export function settingsPiecesOf(text: string | null): SettingsPieces {
  const t = text ?? "";
  return { statusline: t.includes("fuel-statusline.mjs"), claimHook: t.includes("claim.mjs"), healthHook: t.includes("health.mjs") };
}
export function readSettingsPieces(dir: string): SettingsPieces {
  try {
    return settingsPiecesOf(readFileSync(join(dir, "settings.json"), "utf8"));
  } catch {
    return settingsPiecesOf(null);
  }
}

// 순수: 없는 조각 → 경고 글. 로그인 안 됨도 경고
export function warningsOf(label: string, auth: AuthStatus, p: SettingsPieces): string[] {
  const out: string[] = [];
  if (auth.loggedIn === false) out.push(`not logged in on ${label}`);
  if (!p.statusline) out.push(`FUEL blind on ${label} (no atc statusline)`);
  if (!p.healthHook) out.push(`health blind on ${label} (no health.mjs hook)`);
  if (!p.claimHook) out.push(`claims blind on ${label} (no claim.mjs hook)`);
  return out;
}

export interface FolderHealth extends AuthStatus, SettingsPieces {
  label: string;
  dir: string;
  registered: boolean;
  warnings: string[];
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; auth: AuthStatus }>();
type Runner = (dir: string) => Promise<string>;
const runAuthStatus: Runner = (dir) =>
  new Promise((resolve) =>
    execFile(config.claudeBin, ["auth", "status", "--json"], { env: { ...cleanEnv(), CLAUDE_CONFIG_DIR: dir }, timeout: 10_000, maxBuffer: 1 << 20 }, (_err, stdout) => resolve(String(stdout ?? ""))),
  );

export async function authStatusOf(dir: string, now = Date.now(), run: Runner = runAuthStatus): Promise<AuthStatus> {
  const hit = cache.get(dir);
  if (hit && now - hit.at < TTL_MS) return hit.auth;
  const auth = authFieldsOf(await run(dir)); // 저장하는 것은 걸러진 두 칸뿐
  cache.set(dir, { at: now, auth });
  return auth;
}
export const forgetAuthStatus = () => cache.clear();

export async function folderHealthOf(folders: readonly AccountFolder[] = accountFolders(), now = Date.now(), run?: Runner): Promise<FolderHealth[]> {
  return Promise.all(
    folders.map(async (f) => {
      const auth = await authStatusOf(f.dir, now, run);
      const pieces = readSettingsPieces(f.dir);
      return { label: f.label, dir: f.dir, registered: f.registered, ...auth, ...pieces, warnings: warningsOf(f.label, auth, pieces) };
    }),
  );
}

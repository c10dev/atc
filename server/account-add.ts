import { chmodSync, copyFileSync, lstatSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type SettingsPieces, settingsPiecesOf } from "./account-health.ts";
import { shareMemory } from "./account-memory.ts";
import { AccountsError, type AccountsRegistry, checkConfigDir, loadAccounts, validateAccounts } from "./accounts.ts";
import { config } from "./config.ts";
import { ACCOUNT_RE } from "./crew.ts";
import { loadFleet, saveAccounts } from "./fleet.ts";

// ADD ACCOUNT(ATC-186, docs/accounts.md 4절): 설정 창에서 ACCOUNT 폴더를 만들고 ~/.claude/settings.json을 복사하고 등록한다.
// 읽고 쓰는 것은 settings.json뿐이다. `.credentials.json`·`.claude.json`·토큰·email은 열지 않는다. env는 키 이름만 화면에 보낸다.
// 로그인과 온보딩은 SUPERVISOR가 터미널에서 한다(2단계는 측정 뒤).

// 이 키 중 하나라도 있는 settings.json은 그 폴더의 설정이라 덮어쓰지 않는다
const OWN_KEYS = ["hooks", "statusLine", "env", "permissions", "apiKeyHelper"];

const objOf = (text: string | null): Record<string, unknown> | null => {
  if (text == null) return null;
  try {
    const d = JSON.parse(text) as unknown;
    return d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

// 순수: settings.json 본문 → env 키 이름(값은 버린다)
export function envKeysOf(text: string | null): string[] {
  const env = objOf(text)?.env;
  return env && typeof env === "object" && !Array.isArray(env) ? Object.keys(env).sort() : [];
}

// 순수: 대상 폴더의 settings.json을 바꿔 써도 되는가. 없으면 된다. 읽을 수 없는 JSON이나 자기 hook·env·권한이 있으면 안 된다
export function replaceableSettings(text: string | null): boolean {
  if (text == null) return true;
  const o = objOf(text);
  return o !== null && !OWN_KEYS.some((k) => k in o);
}

// 순수: ~/.claude/settings.json → 새 폴더에 쓸 본문. dropEnv에 든 env 키는 뺀다(값은 그대로 옮기고 화면에는 보이지 않는다)
export function settingsCopyOf(source: string, dropEnv: readonly string[] = []): string {
  const o = objOf(source);
  if (!o) throw new AccountsError("~/.claude/settings.json이 JSON 객체가 아님");
  const out = { ...o };
  const env = o.env;
  if (env && typeof env === "object" && !Array.isArray(env)) {
    const kept = Object.fromEntries(Object.entries(env).filter(([k]) => !dropEnv.includes(k)));
    if (Object.keys(kept).length) out.env = kept;
    else delete out.env;
  }
  return JSON.stringify(out, null, 2) + "\n";
}

// 순수: ~/.claude에 붙일 라벨 제안 = FLEET 프로필과 관제 세션에서 가장 많이 쓴 ACCOUNT 라벨(같으면 이름순 앞)
export function suggestHomeLabel(fleet: { aircraft?: Record<string, { account?: unknown }>; control?: Record<string, { account?: unknown }> }): string | null {
  const n = new Map<string, number>();
  for (const p of [...Object.values(fleet.aircraft ?? {}), ...Object.values(fleet.control ?? {})]) {
    const a = p?.account;
    if (typeof a === "string" && ACCOUNT_RE.test(a)) n.set(a, (n.get(a) ?? 0) + 1);
  }
  return [...n].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? null;
}

export const defaultDirOf = (label: string, home = config.home) => join(home, `.claude-${label}`);

export interface AddRequest {
  label: string;
  configDir?: string; // 비우면 ~/.claude-<label>
  homeLabel?: string; // ~/.claude가 등록되지 않았을 때 함께 등록할 라벨
  dropEnv?: string[];
}
export interface AddPlan {
  label: string;
  dir: string;
  registry: AccountsRegistry; // 저장할 등록부
  homeRegistered: string | null; // 이번에 ~/.claude를 이 라벨로 함께 등록한다
}

// 순수: 요청 + 지금 등록부 → 새 등록부. 이미 있는 라벨·폴더, ~/.claude 자체, ~/.claude 라벨이 없거나 겹치면 던진다
export function addPlanOf(req: AddRequest, registry: AccountsRegistry, claudeDir = config.claudeDir, home = config.home): AddPlan {
  const label = typeof req.label === "string" ? req.label.trim() : "";
  if (!ACCOUNT_RE.test(label)) throw new AccountsError("ACCOUNT 라벨은 소문자·숫자·-, 24자까지 (예: acct-1)");
  if (registry[label]) throw new AccountsError(`${label}은 이미 등록됨`);
  const raw = typeof req.configDir === "string" && req.configDir.trim() ? req.configDir.trim() : defaultDirOf(label, home);
  const dir = checkConfigDir(raw, home);
  if (dir === claudeDir) throw new AccountsError("~/.claude는 새 ACCOUNT가 아님 — 아래 등록 칸에서 라벨만 붙인다");
  const taken = Object.entries(registry).find(([, e]) => e.configDir === dir);
  if (taken) throw new AccountsError(`${dir}는 이미 ${taken[0]}로 등록됨`);
  const next: AccountsRegistry = { ...registry };
  let homeRegistered: string | null = null;
  if (!Object.values(registry).some((e) => e.configDir === claudeDir)) {
    // 등록부가 생기면 모든 폴더가 관찰한 라벨을 쓴다. ~/.claude가 빠지면 그 세션이 전부 "default (home acct-2)"가 된다
    const h = typeof req.homeLabel === "string" ? req.homeLabel.trim() : "";
    if (!ACCOUNT_RE.test(h)) throw new AccountsError("~/.claude의 ACCOUNT 라벨도 함께 정해야 함 (FLEET 프로필이 쓰는 라벨, 예: acct-2)");
    if (h === label) throw new AccountsError(`~/.claude와 새 폴더에 같은 라벨 ${label}을 붙일 수 없음`);
    if (registry[h]) throw new AccountsError(`${h}은 이미 다른 폴더로 등록됨`);
    next[h] = { configDir: claudeDir };
    homeRegistered = h;
  }
  next[label] = { configDir: dir };
  return { label, dir, registry: validateAccounts(next, home), homeRegistered };
}

// ── 입출력 ──

const readText = (file: string): string | null => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

export interface AddPreview {
  home: string;
  claudeDir: string;
  homeLabel: string | null; // ~/.claude가 등록된 라벨. null이면 함께 등록해야 한다
  suggestHomeLabel: string | null;
  envKeys: string[]; // ~/.claude/settings.json의 env 키 이름(값은 보내지 않는다)
  source: SettingsPieces; // 복사할 settings.json에 atc statusline·hook이 있는가
}
export function addPreviewOf(): AddPreview {
  const registry = loadAccounts();
  const src = readText(join(config.claudeDir, "settings.json"));
  return {
    home: config.home,
    claudeDir: config.claudeDir,
    homeLabel: Object.entries(registry).find(([, e]) => e.configDir === config.claudeDir)?.[0] ?? null,
    suggestHomeLabel: suggestHomeLabel(loadFleet()),
    envKeys: envKeysOf(src),
    source: settingsPiecesOf(src),
  };
}

export interface AddResult {
  label: string;
  dir: string;
  folder: "created" | "existed";
  settings: "copied" | "replaced" | "kept";
  backup: string | null; // 바꿔 쓰기 전에 남긴 옛 settings.json
  homeRegistered: string | null;
  memory: { linked: number; kept: number; conflicts: number; errors: string[] } | null; // ATC-191: memory 링크 결과(실패해도 등록은 유지)
  loginCommand: string; // SUPERVISOR가 터미널에서 칠 것
}

// 폴더 만들기 → settings.json 복사 → 등록. 등록은 파일이 다 된 뒤에 한다
export function addAccount(req: AddRequest, now = new Date()): AddResult {
  const plan = addPlanOf(req, loadAccounts());
  const src = readText(join(config.claudeDir, "settings.json"));
  if (src == null) throw new AccountsError("~/.claude/settings.json을 읽지 못함");
  const dropEnv = Array.isArray(req.dropEnv) ? req.dropEnv.filter((k): k is string => typeof k === "string") : [];
  const body = settingsCopyOf(src, dropEnv);

  let folder: AddResult["folder"] = "existed";
  try {
    if (!statSync(plan.dir).isDirectory()) throw new AccountsError(`${plan.dir}가 폴더가 아님`);
  } catch (e) {
    if (e instanceof AccountsError) throw e;
    mkdirSync(plan.dir, { mode: 0o700 });
    folder = "created";
  }

  const file = join(plan.dir, "settings.json");
  let link = false;
  try {
    link = lstatSync(file).isSymbolicLink();
  } catch {}
  const cur = link ? null : readText(file);
  let settings: AddResult["settings"] = "kept";
  let backup: string | null = null;
  if (!link && replaceableSettings(cur)) {
    if (cur != null) {
      backup = `${file}.atc-bak-${now.toISOString().replace(/[:.]/g, "-")}`;
      copyFileSync(file, backup);
      chmodSync(backup, 0o600);
    }
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, body, { mode: 0o600 });
    renameSync(tmp, file);
    settings = cur == null ? "copied" : "replaced";
  }

  saveAccounts(plan.registry);
  // ATC-191: 새 폴더의 memory를 ~/.claude 것으로 잇는다. 실패해도 폴더와 등록은 그대로 두고 화면의 SHARE MEMORY로 다시 한다
  let memory: AddResult["memory"] = null;
  try {
    memory = shareMemory(plan.label).result;
  } catch {}
  return {
    label: plan.label,
    dir: plan.dir,
    folder,
    settings,
    backup,
    homeRegistered: plan.homeRegistered,
    memory,
    loginCommand: `CLAUDE_CONFIG_DIR=${plan.dir} claude auth login --claudeai`,
  };
}

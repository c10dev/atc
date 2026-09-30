import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join, normalize, sep } from "node:path";
import { config } from "./config.ts";
import { ACCOUNT_RE } from "./crew.ts";

// ACCOUNT 등록부(ATC-146, docs/accounts.md): fleet.json 최상위 `accounts` = { "<라벨>": { "configDir": "<절대 경로>" } }.
// 라벨과 Claude Code 설정 폴더(CLAUDE_CONFIG_DIR)만 적는다. email·토큰·요금제 이름은 저장하지 않는다. `.credentials.json`은 읽지 않는다.
// ~/.claude는 등록하지 않아도 읽는다: 등록부에서 그 폴더에 붙인 라벨, 없으면 DEFAULT_FOLDER_LABEL.

export const DEFAULT_FOLDER_LABEL = "default";
export type AccountsRegistry = Record<string, { configDir: string; maxLaunched?: number }>;
export interface AccountFolder {
  label: string;
  dir: string;
  registered: boolean; // 등록부에 적힌 폴더(~/.claude를 등록하지 않았으면 false)
  maxLaunched?: number; // ACCOUNT별 백그라운드 세션 상한(ATC-147). 없으면 기계 전체 상한(ATC_MAX_LAUNCHED)만
}

export class AccountsError extends Error {}

const realOf = (p: string): string | null => {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
};
const under = (p: string, root: string) => p.startsWith(root.endsWith(sep) ? root : root + sep);

// 폴더 하나 검사: 절대 경로, `..`·`.`·겹친 `/` 없음, $HOME 아래, 이름이 .claude로 시작, 이미 있는 폴더면 symlink를 따라간 실제 위치도 $HOME 아래
export function checkConfigDir(dir: unknown, home = config.home): string {
  if (typeof dir !== "string" || !dir || dir.includes("\0")) throw new AccountsError("configDir는 절대 경로 문자열");
  if (!isAbsolute(dir)) throw new AccountsError(`configDir는 절대 경로여야 함: ${dir}`);
  const clean = normalize(dir).replace(/(.)\/+$/, "$1");
  if (clean !== dir.replace(/(.)\/+$/, "$1")) throw new AccountsError(`configDir에 ..·. 나 겹친 /를 쓰지 않는다: ${dir}`);
  if (!under(clean, home)) throw new AccountsError(`configDir는 $HOME 아래여야 함: ${dir}`);
  if (!basename(clean).startsWith(".claude")) throw new AccountsError(`configDir의 폴더 이름은 .claude로 시작해야 함: ${dir}`);
  const real = realOf(clean);
  if (real) {
    const realHome = realOf(home) ?? home;
    if (!under(real, realHome)) throw new AccountsError(`configDir가 symlink로 $HOME 밖을 가리킴: ${dir}`);
  }
  return clean;
}

// 등록부 검사(설정 저장과 읽기가 같이 쓴다). 모르는 키·잘못된 라벨·폴더가 겹치는 항목은 던진다
export function validateAccounts(raw: unknown, home = config.home): AccountsRegistry {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new AccountsError("accounts는 { 라벨: { configDir } } 객체");
  const out: AccountsRegistry = {};
  const seen = new Map<string, string>();
  for (const [label, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!ACCOUNT_RE.test(label)) throw new AccountsError(`ACCOUNT 라벨은 소문자·숫자·-, 24자까지: ${label}`);
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new AccountsError(`${label}: { configDir } 객체여야 함`);
    const extra = Object.keys(entry).filter((k) => k !== "configDir" && k !== "maxLaunched");
    if (extra.length) throw new AccountsError(`${label}: 모르는 키 ${extra.join(", ")} — configDir와 maxLaunched만 받는다 (email·토큰은 저장하지 않는다)`);
    const dir = checkConfigDir((entry as { configDir?: unknown }).configDir, home);
    const cap = (entry as { maxLaunched?: unknown }).maxLaunched;
    if (cap !== undefined && cap !== null && !(Number.isInteger(cap) && (cap as number) >= 1 && (cap as number) <= 100)) throw new AccountsError(`${label}: maxLaunched는 1–100의 정수(없으면 상한 없음)`);
    const other = seen.get(dir);
    if (other) throw new AccountsError(`${label}: ${other}와 같은 폴더`);
    seen.set(dir, label);
    out[label] = { configDir: dir, ...(typeof cap === "number" ? { maxLaunched: cap } : {}) };
  }
  return out;
}

// 폴더 목록: 등록부의 폴더(라벨 순서 그대로) + 등록되지 않은 기본 폴더(~/.claude). 기본 폴더가 맨 앞이 아니라 뒤에 온다 — 등록부가 우선
export function foldersOf(registry: AccountsRegistry, defaultDir = config.claudeDir): AccountFolder[] {
  const out: AccountFolder[] = Object.entries(registry).map(([label, e]) => ({ label, dir: e.configDir, registered: true, ...(e.maxLaunched ? { maxLaunched: e.maxLaunched } : {}) }));
  if (!out.some((f) => f.dir === defaultDir)) out.push({ label: DEFAULT_FOLDER_LABEL, dir: defaultDir, registered: false });
  return out;
}

// fleet.json에서 등록부만 읽는다(fleet.ts를 끌어오지 않는다 — 읽기 쪽 모듈이 서로 물지 않게). 깨졌거나 잘못된 항목은 그 항목만 버린다
const TTL_MS = 5_000;
let memo: { file: string; at: number; mtime: number; registry: AccountsRegistry } | null = null;
export function loadAccounts(file = join(config.stateDir, "fleet.json"), home = config.home, now = Date.now()): AccountsRegistry {
  let mtime = 0;
  try {
    mtime = statSync(file).mtimeMs;
  } catch {
    return {};
  }
  if (memo && memo.file === file && memo.mtime === mtime && now - memo.at < TTL_MS) return memo.registry;
  let registry: AccountsRegistry = {};
  try {
    const raw = (JSON.parse(readFileSync(file, "utf8")) as { accounts?: unknown }).accounts;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [label, entry] of Object.entries(raw)) {
        try {
          Object.assign(registry, validateAccounts({ [label]: entry }, home));
        } catch {} // 읽을 때 걸러진 항목은 폴더로 읽지 않는다(설정 저장 때 이미 막혔을 것)
      }
      const dup = new Set<string>();
      registry = Object.fromEntries(Object.entries(registry).filter(([, e]) => !dup.has(e.configDir) && (dup.add(e.configDir), true)));
    }
  } catch {}
  memo = { file, at: now, mtime, registry };
  return registry;
}

// 모든 reader가 쓰는 폴더 목록. 시험은 folders를 직접 넘긴다
export function accountFolders(): AccountFolder[] {
  return foldersOf(loadAccounts(), config.claudeDir);
}

// 등록부가 비어 있으면(폴더가 ~/.claude 하나뿐) 관찰한 ACCOUNT를 세션에 붙이지 않는다 — 라벨을 모르는 폴더를 "default"로 부르면 기존 AIRCRAFT 라벨과 어긋난다
export const observedLabelsOn = (folders: readonly AccountFolder[]) => folders.some((f) => f.registered);

export function folderOfAccount(label: string | undefined | null, folders: readonly AccountFolder[] = accountFolders()): AccountFolder | undefined {
  return label ? folders.find((f) => f.label === label) : undefined;
}

export const existingFolders = (folders: readonly AccountFolder[] = accountFolders()) => folders.filter((f) => existsSync(f.dir));

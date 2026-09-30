import { lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync, rmdirSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { AccountFolder } from "./accounts.ts";
import { accountFolders } from "./accounts.ts";
import { loadRegistry } from "./airports.ts";
import { config } from "./config.ts";

// SHARE MEMORY(ATC-191, docs/accounts.md "Memory as built"): Claude Code의 auto-memory는 `<설정 폴더>/projects/<cwd 키>/memory/`에 있어서
// ACCOUNT 폴더마다 따로다. 모든 폴더의 그 디렉터리를 ~/.claude의 것으로 가리키는 symlink로 바꾼다.
// 디렉터리 이름과 파일 이름만 본다. memory 파일의 내용은 열지 않고, `.credentials.json`·`.claude.json`도 열지 않는다.

// Claude Code가 cwd에서 폴더 이름을 만드는 방식: 영문·숫자가 아닌 글자는 모두 "-"
export const projectKeyOf = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, "-");

export const memoryDirOf = (configDir: string, key: string) => join(configDir, "projects", key, "memory");

// 한 폴더·키의 memory 자리 상태. 파일 이름만 담는다
export type MemState = { kind: "absent" } | { kind: "empty" } | { kind: "files"; names: string[] } | { kind: "link"; target: string } | { kind: "other" };

export type MemAction =
  | { op: "link"; label: string; dir: string; key: string; path: string; target: string; replaceEmpty: boolean }
  | { op: "keep"; label: string; dir: string; key: string; why: "linked" | "other-link" }
  | { op: "conflict"; label: string; dir: string; key: string; path: string; names: string[] }; // names: 파일 이름만(내용 아님)

export interface MemoryPlan {
  actions: MemAction[];
  status: Record<string, "shared" | "separate" | "conflict">; // 폴더 dir → 상태
}

// 순수: 등록된 폴더들과 memory 자리 상태 → 할 일. source(~/.claude)의 memory가 원본이고 나머지가 링크가 된다
// - 없거나 빈 디렉터리 → 링크(빈 디렉터리는 바꿔 놓는다). 이미 원본을 가리키면 둔다. 다른 곳을 가리키는 링크도 둔다
// - 파일이 든 디렉터리, 디렉터리가 아닌 것 → 충돌: 절대 덮지 않고 파일 이름만 보고한다
export function memoryPlanOf(folders: readonly Pick<AccountFolder, "label" | "dir">[], sourceDir: string, keys: readonly string[], stateOf: (dir: string, key: string) => MemState): MemoryPlan {
  const actions: MemAction[] = [];
  const status: MemoryPlan["status"] = {};
  const uniqKeys = [...new Set(keys)].sort();
  for (const f of folders) {
    if (f.dir === sourceDir) {
      status[f.dir] = "shared";
      continue;
    }
    let conflict = false;
    let pending = false;
    for (const key of uniqKeys) {
      const path = memoryDirOf(f.dir, key);
      const target = memoryDirOf(sourceDir, key);
      const st = stateOf(f.dir, key);
      const base = { label: f.label, dir: f.dir, key };
      if (st.kind === "link") {
        actions.push({ ...base, op: "keep", why: st.target === target ? "linked" : "other-link" });
        if (st.target !== target) pending = true;
      } else if (st.kind === "files" || st.kind === "other") {
        actions.push({ ...base, op: "conflict", path, names: st.kind === "files" ? st.names : [] });
        conflict = true;
      } else {
        actions.push({ ...base, op: "link", path, target, replaceEmpty: st.kind === "empty" });
        pending = true;
      }
    }
    status[f.dir] = conflict ? "conflict" : pending ? "separate" : "shared";
  }
  return { actions, status };
}

// ── 입출력 ──

// 이름만 읽는다. 링크는 lstat으로 본다(따라가지 않는다)
export function memStateOf(dir: string, key: string): MemState {
  const p = memoryDirOf(dir, key);
  try {
    const st = lstatSync(p);
    if (st.isSymbolicLink()) return { kind: "link", target: resolve(dirname(p), readlinkSync(p)) };
    if (!st.isDirectory()) return { kind: "other" };
    const names = readdirSync(p).sort();
    return names.length ? { kind: "files", names } : { kind: "empty" };
  } catch {
    return { kind: "absent" };
  }
}

// atc 체크아웃과 닫히지 않은 AIRPORT의 경로 → 프로젝트 키
export function projectKeys(checkout = resolve(import.meta.dirname, ".."), airportPaths: readonly string[] = loadRegistry().entries.filter((e) => !e.closed).map((e) => e.path)): string[] {
  const out = new Set<string>();
  for (const p of [checkout, ...airportPaths]) {
    if (typeof p !== "string" || !p) continue;
    out.add(projectKeyOf(p));
    try {
      out.add(projectKeyOf(realpathSync(p))); // symlink 경로면 Claude Code가 보는 쪽도
    } catch {}
  }
  return [...out];
}

export interface MemoryFolderView {
  label: string;
  dir: string;
  status: "shared" | "separate" | "conflict";
  conflicts: { key: string; names: string[] }[]; // 파일 이름만
}
export function memoryView(folders: readonly AccountFolder[] = accountFolders(), sourceDir = config.claudeDir, keys = projectKeys()): MemoryFolderView[] {
  const plan = memoryPlanOf(folders, sourceDir, keys, memStateOf);
  return folders.map((f) => ({
    label: f.label,
    dir: f.dir,
    status: plan.status[f.dir] ?? "separate",
    conflicts: plan.actions.flatMap((a) => (a.op === "conflict" && a.dir === f.dir ? [{ key: a.key, names: a.names }] : [])),
  }));
}

export interface ShareResult {
  linked: number;
  kept: number;
  conflicts: number;
  errors: string[]; // 고정 문장. 경로와 폴더 라벨만
}

// 계획을 적용한다. 링크 직전에 상태를 다시 보고, 빈 디렉터리는 rmdir로만 지운다(파일이 있으면 rmdir이 실패하니 잃을 것이 없다)
export function applyMemoryPlan(plan: MemoryPlan, stateOf = memStateOf): ShareResult {
  const res: ShareResult = { linked: 0, kept: 0, conflicts: 0, errors: [] };
  for (const a of plan.actions) {
    if (a.op === "keep") res.kept++;
    else if (a.op === "conflict") res.conflicts++;
    else {
      try {
        const now = stateOf(a.dir, a.key);
        if (now.kind === "files" || now.kind === "other" || now.kind === "link") {
          res.conflicts += now.kind === "link" ? 0 : 1;
          res.kept += now.kind === "link" ? 1 : 0;
          continue;
        }
        mkdirSync(a.target, { recursive: true, mode: 0o700 }); // 원본 자리가 없으면 만든다: 이후 새 memory도 함께 쓴다
        if (now.kind === "empty") rmdirSync(a.path);
        else mkdirSync(dirname(a.path), { recursive: true, mode: 0o700 });
        symlinkSync(a.target, a.path, "dir");
        res.linked++;
      } catch {
        res.errors.push(`${a.label}: ${a.key} 링크 실패`);
      }
    }
  }
  return res;
}

// 폴더 하나(ADD ACCOUNT가 방금 만든 것) 또는 등록된 전부에 memory 링크를 건다
export function shareMemory(only?: string): { result: ShareResult; view: MemoryFolderView[] } {
  const folders = accountFolders().filter((f) => !only || f.label === only);
  const plan = memoryPlanOf(folders, config.claudeDir, projectKeys(), memStateOf);
  const result = applyMemoryPlan(plan);
  return { result, view: memoryView() };
}

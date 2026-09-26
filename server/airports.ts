import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { config } from "./config.ts";
import type { Context, Hono } from "hono";
import type { Airport, AirportStatus } from "./model.ts";

// 저장소 = AIRPORT. 등록부(~/.local/state/atc/airports.json)가 AIRPORT 목록의 기준이다.
// - projectsDir 아래 git 저장소는 자동으로 개설되고, 그 밖의 저장소는 API로 개설한다.
// - AIRPORT는 저장소의 첫 커밋 해시로 알아본다. 폴더를 옮기거나 이름을 바꿔도 같은 AIRPORT·같은 코드로 이어진다.
// - 폐쇄한 AIRPORT는 화면에서 빠지지만 등록부에는 남는다.

const run = promisify(execFile);
const CODE = /^[A-Z]{4}$/;

export interface AirportEntry {
  id: string; // 보통 root와 같고, 같은 저장소의 다른 클론이면 "root~경로해시"
  root: string; // 첫 커밋 해시
  code: string;
  name: string;
  path: string;
  closed: boolean;
  addedAt: string;
}

export interface Candidate {
  path: string;
  root: string;
  discovered: boolean; // projectsDir 아래에서 자동으로 찾음
}

// URL에 넣기 안전한 클론 id
export const cloneId = (root: string, path: string) =>
  `${root}~${createHash("sha1").update(path).digest("hex").slice(0, 8)}`;

// 첫 글자 + 이어지는 자음, 모자라면 나머지 글자, 그래도 모자라면 X. 겹치면 마지막 글자를 바꾼다.
export function deriveCode(name: string, taken: Set<string>): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "") || "X";
  const base = (letters[0] + letters.slice(1).replace(/[AEIOU]/g, "") + letters.slice(1)).slice(0, 4).padEnd(4, "X");
  if (!taken.has(base)) return base;
  for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const alt = base.slice(0, 3) + c;
    if (!taken.has(alt)) return alt;
  }
  return base;
}

// 찾은 저장소들을 등록부와 맞춘다. 순수 함수: 새 등록부와 바뀜 여부, 등록 항목 id → 찾은 저장소를 돌려준다.
// 1) 같은 경로 → 그대로
// 2) 등록된 경로가 사라졌고 같은 첫 커밋의 저장소가 나타남 → 옮겨진 것, 경로 갱신
//    (후보가 여럿이면 폴더 이름이 같은 쪽)
// 3) 같은 첫 커밋의 다른 클론 → "root~경로해시"로 따로  4) 처음 보는 저장소 → 개설(자동 발견된 것만)
export function reconcile(
  entries: AirportEntry[],
  candidates: Candidate[],
  pathExists: (p: string) => boolean,
  now = new Date().toISOString(),
): { entries: AirportEntry[]; changed: boolean; matched: Map<string, Candidate> } {
  const out = entries.map((e) => ({ ...e }));
  const matched = new Map<string, Candidate>();
  const taken = new Set(out.map((e) => e.code));
  let changed = false;

  let pending: Candidate[] = [];
  for (const c of [...candidates].sort((a, b) => a.path.localeCompare(b.path))) {
    const e = out.find((x) => x.path === c.path && x.root === c.root && !matched.has(x.id));
    if (e) matched.set(e.id, c);
    else pending.push(c);
  }

  for (const e of out) {
    if (matched.has(e.id) || pathExists(e.path)) continue;
    const same = pending.filter((c) => c.root === e.root);
    const pick = same.length === 1 ? same[0] : same.find((c) => basename(c.path) === basename(e.path));
    if (!pick) continue;
    e.path = pick.path;
    matched.set(e.id, pick);
    pending = pending.filter((c) => c !== pick);
    changed = true;
  }

  for (const c of pending) {
    const id = out.some((e) => e.id === c.root) ? cloneId(c.root, c.path) : c.root;
    const existing = out.find((e) => e.id === id);
    if (existing) {
      if (!matched.has(id)) matched.set(id, c);
      continue;
    }
    if (!c.discovered) continue;
    const name = basename(c.path);
    const code = deriveCode(name, taken);
    taken.add(code);
    out.push({ id, root: c.root, code, name, path: c.path, closed: false, addedAt: now });
    matched.set(id, c);
    changed = true;
  }
  return { entries: out, changed, matched };
}

// ── 파일·git ───────────────────────────────────────────

export function loadRegistry(): { entries: AirportEntry[]; exists: boolean } {
  try {
    const data = JSON.parse(readFileSync(config.airportsFile, "utf8"));
    return { entries: Array.isArray(data.airports) ? data.airports : [], exists: true };
  } catch {
    return { entries: [], exists: false };
  }
}

function saveRegistry(entries: AirportEntry[]) {
  mkdirSync(dirname(config.airportsFile), { recursive: true });
  const tmp = `${config.airportsFile}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ airports: entries }, null, 2) + "\n");
  renameSync(tmp, config.airportsFile);
}

const isRepo = (p: string) => {
  try {
    return statSync(join(p, ".git")).isDirectory();
  } catch {
    return false;
  }
};

function discoverRepos(): string[] {
  try {
    return readdirSync(config.projectsDir)
      .map((name) => join(config.projectsDir, name))
      .filter(isRepo);
  } catch {
    return [];
  }
}

const idCache = new Map<string, string>();

// 첫 커밋(루트 커밋) 해시. 커밋이 없는 저장소는 경로로 대신한다(이때는 옮기면 새 AIRPORT가 된다).
async function rootId(path: string): Promise<string> {
  const cached = idCache.get(path);
  if (cached) return cached;
  try {
    const { stdout } = await run("git", ["-C", path, "rev-list", "--max-parents=0", "HEAD"], { timeout: 10_000 });
    const id = stdout.split("\n").filter(Boolean).sort()[0];
    if (id) {
      idCache.set(path, id);
      return id;
    }
  } catch {}
  return `path:${path}`;
}

async function candidatesFor(paths: { path: string; discovered: boolean }[]): Promise<Candidate[]> {
  return Promise.all(paths.map(async (p) => ({ ...p, root: await rootId(p.path) })));
}

function statusesOf(entries: AirportEntry[], matched: Map<string, Candidate>): AirportStatus[] {
  return entries
    .map((e) => {
      const m = matched.get(e.id);
      return {
        id: e.id,
        code: e.code,
        name: e.name,
        repo: m?.path ?? e.path,
        closed: e.closed,
        status: e.closed ? ("closed" as const) : m ? ("open" as const) : ("missing" as const),
        discovered: m?.discovered ?? false,
        addedAt: e.addedAt,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

// 스냅샷마다 부른다. git 호출(비동기)을 먼저 끝내고, 등록부 읽기→맞추기→쓰기는 await 없이 한 번에 한다.
// (그 사이에 API가 등록부를 고쳐도 덮어쓰지 않게)
export async function resolveAirports(): Promise<{ open: Airport[]; all: AirportStatus[] }> {
  const discovered = new Set(discoverRepos());
  const registered = loadRegistry().entries.map((e) => e.path).filter((p) => !discovered.has(p) && isRepo(p));
  const candidates = await candidatesFor([
    ...[...discovered].map((path) => ({ path, discovered: true })),
    ...registered.map((path) => ({ path, discovered: false })),
  ]);

  const { entries, exists } = loadRegistry();
  const result = reconcile(entries, candidates, existsSync);
  if (result.changed || !exists) saveRegistry(result.entries);

  const all = statusesOf(result.entries, result.matched);
  const open = all.filter((a) => a.status === "open").map(({ id, code, name, repo }) => ({ id, code, name, repo }));
  return { open, all };
}

// ── API에서 쓰는 변경 ───────────────────────────────────

export class AirportError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function checkCode(code: string, entries: AirportEntry[], selfId?: string) {
  if (!CODE.test(code)) throw new AirportError(`AIRPORT 코드는 대문자 4자여야 함: "${code}"`);
  const other = entries.find((e) => e.code === code && e.id !== selfId);
  if (other) throw new AirportError(`"${code}"는 이미 ${other.name} AIRPORT가 씀`, 409);
}

// 워크트리나 하위 폴더를 줘도 본 체크아웃을 찾는다.
async function mainCheckout(input: string): Promise<string> {
  const path = resolve(input.replace(/^~(?=\/|$)/, config.home));
  if (!isAbsolute(input) && !input.startsWith("~")) throw new AirportError("절대 경로가 필요함");
  if (!path.startsWith(config.home + "/")) throw new AirportError("홈 폴더 아래 경로만 개설할 수 있음");
  try {
    const { stdout } = await run("git", ["-C", path, "rev-parse", "--path-format=absolute", "--git-common-dir"], { timeout: 10_000 });
    const common = stdout.trim();
    if (basename(common) !== ".git") throw new AirportError("bare 저장소는 AIRPORT로 쓸 수 없음");
    return dirname(common);
  } catch (e) {
    if (e instanceof AirportError) throw e;
    throw new AirportError(`git 저장소가 아님: ${path}`);
  }
}

export async function openAirport(input: { path: string; code?: string; name?: string }): Promise<AirportEntry> {
  if (typeof input.path !== "string" || !input.path.trim()) throw new AirportError("path가 필요함");
  const path = await mainCheckout(input.path.trim());
  const root = await rootId(path);
  const { entries } = loadRegistry();
  const existing = entries.find((e) => e.path === path || (e.root === root && !existsSync(e.path)));
  if (existing && !existing.closed && existing.path === path) throw new AirportError(`이미 개설된 AIRPORT: ${existing.code}`, 409);
  if (existing) {
    existing.path = path;
    existing.closed = false;
    if (input.code) {
      checkCode(input.code.toUpperCase(), entries, existing.id);
      existing.code = input.code.toUpperCase();
    }
    saveRegistry(entries);
    return existing;
  }
  const name = input.name?.trim() || basename(path);
  const taken = new Set(entries.map((e) => e.code));
  const code = input.code ? input.code.toUpperCase() : deriveCode(name, taken);
  checkCode(code, entries);
  const id = entries.some((e) => e.id === root) ? cloneId(root, path) : root;
  const entry = { id, root, code, name, path, closed: false, addedAt: new Date().toISOString() };
  saveRegistry([...entries, entry]);
  return entry;
}

export function updateAirport(id: string, patch: { code?: string; name?: string; closed?: boolean }): AirportEntry {
  const { entries } = loadRegistry();
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw new AirportError("그런 AIRPORT가 없음", 404);
  if (patch.code !== undefined) {
    const code = String(patch.code).toUpperCase();
    checkCode(code, entries, id);
    entry.code = code;
  }
  if (patch.name !== undefined) {
    if (!String(patch.name).trim()) throw new AirportError("이름이 비었음");
    entry.name = String(patch.name).trim();
  }
  if (patch.closed !== undefined) entry.closed = Boolean(patch.closed);
  saveRegistry(entries);
  return entry;
}

// 등록부에서 지우기. projectsDir 아래 저장소는 지워도 다시 자동 개설되므로 폐쇄를 쓰게 한다.
export function removeAirport(id: string) {
  const { entries } = loadRegistry();
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw new AirportError("그런 AIRPORT가 없음", 404);
  if (discoverRepos().includes(entry.path)) throw new AirportError("자동으로 찾는 저장소는 지울 수 없음 — 폐쇄를 쓰세요", 409);
  saveRegistry(entries.filter((e) => e.id !== id));
}

export function mountAirports(app: Hono) {
  const handle = async (c: Context, fn: () => unknown | Promise<unknown>) => {
    try {
      return c.json({ ok: true, result: await fn() });
    } catch (e) {
      if (e instanceof AirportError) return c.json({ error: e.message }, e.status as 400);
      throw e;
    }
  };
  app.get("/api/airports", async (c) => c.json({ airports: (await resolveAirports()).all }));
  app.post("/api/airports", async (c) => handle(c, async () => openAirport(await c.req.json().catch(() => ({})))));
  app.patch("/api/airports/:id", async (c) =>
    handle(c, async () => updateAirport(c.req.param("id"), await c.req.json().catch(() => ({})))),
  );
  app.delete("/api/airports/:id", async (c) => handle(c, () => removeAirport(c.req.param("id"))));
}

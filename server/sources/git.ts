import { execFile, execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { config } from "../config.ts";
import { keyInName, keyInTitle, keyPatternOf } from "../linear-keys.ts";
import type { Workspace } from "../model.ts";

const run = promisify(execFile);

// 이 모듈이 띄운 자식 프로세스 수(테스트와 측정용). 서버 CPU의 대부분이 큰 부모 프로세스의 fork였다(ATC-525)
let spawns = 0;
export const gitSpawns = () => spawns;

async function git(cwd: string, args: string[]): Promise<string> {
  spawns++;
  const { stdout } = await run("git", ["-C", cwd, ...args], { timeout: 10_000, maxBuffer: 4 << 20 });
  return stdout;
}

// 읽기만 하는 명령 한 줄(동기, OOOI의 머지 커밋·포함 확인, ATC-123). 실패하면 던지고 e.status가 종료 코드다
export function gitReadSync(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
}

// TEAM 키는 설정 창에서 바뀔 수 있어서, 바뀌면 다시 만든다. 읽는 팀 key 모두(voc-123, atc-12)
let ticketPattern: RegExp | null = null;
export function resetTicketPattern() {
  ticketPattern = null;
}

export function ticketKeyFromBranch(branch: string | null): string | null {
  ticketPattern ??= keyPatternOf(config.linearTeamKeys);
  return keyInName(branch, config.linearTeamKeys, ticketPattern);
}

// PR 제목 끝의 "(VOC-170)". 브랜치에 voc-<n>이 없는 PR의 FLIGHT를 찾을 때 쓴다.
export function ticketKeyFromTitle(title: string | null, teamKeys: string | string[] = config.linearTeamKeys): string | null {
  return keyInTitle(title, typeof teamKeys === "string" ? [teamKeys] : teamKeys);
}


// ── 워크트리와 그 상태(readWorkspaces) ──
// 서버 CPU의 대부분은 큰 부모 프로세스가 git을 fork하는 값이었다(ATC-525). 그래서 git을 덜 띄운다:
// - 목록, HEAD, 마지막 커밋, pushed, unpushed는 모두 ref·HEAD 파일에서 나온다. stat으로 만든 저장소 서명이 같으면 지난 결과를 쓰고, 바뀌면 그 틱에 다시 읽는다.
// - dirty(git status)는 작업 트리 편집을 알릴 싼 신호가 없어 지금처럼 30초마다 읽되, 워크트리마다가 아니라 셸 하나가 여러 워크트리를 돈다.

interface ListEntry {
  path: string;
  branch: string | null;
  head: string; // 전체 sha. 커밋이 없으면 0만
  skip: boolean; // prunable·bare
}

export function parseWorktreeList(out: string): ListEntry[] {
  const result: ListEntry[] = [];
  for (const block of out.trim().split("\n\n")) {
    const fields = new Map<string, string>();
    for (const line of block.split("\n")) {
      const i = line.indexOf(" ");
      fields.set(i < 0 ? line : line.slice(0, i), i < 0 ? "" : line.slice(i + 1));
    }
    const path = fields.get("worktree");
    if (!path) continue;
    result.push({ path, branch: fields.get("branch")?.replace(/^refs\/heads\//, "") ?? null, head: fields.get("HEAD") ?? "", skip: fields.has("prunable") || fields.has("bare") });
  }
  return result;
}

function workspacesOf(repo: string, entries: readonly ListEntry[]): { w: Workspace; head: string }[] {
  return entries
    .filter((e) => !e.skip && existsSync(e.path))
    .map((e) => ({
      head: e.head,
      w: {
        path: e.path,
        name: e.path === repo ? basename(repo) : basename(e.path),
        repo,
        isMain: e.path === repo,
        branch: e.branch,
        head: e.head.slice(0, 8),
        dirty: null,
        lastCommitAt: null,
        ticketKey: ticketKeyFromBranch(e.branch),
      },
    }));
}

const stamp = (p: string): string => {
  const s = statSync(p, { bigint: true, throwIfNoEntry: false });
  return s ? `${s.ino}.${s.size}.${s.mtimeNs}` : "-";
};

// 작업 트리 경로의 git 디렉터리와 공통 디렉터리(연결된 워크트리는 .git 파일이 가리키는 곳과 그 commondir)
export function gitDirsOf(path: string): { gitdir: string; common: string } | null {
  const dotgit = join(path, ".git");
  const st = statSync(dotgit, { throwIfNoEntry: false });
  if (!st) return null;
  let gitdir = dotgit;
  if (!st.isDirectory()) {
    const m = /^gitdir: (.+)$/m.exec(readFileSync(dotgit, "utf8"));
    if (!m) return null;
    gitdir = resolve(path, m[1].trim());
  }
  let common = gitdir;
  try {
    common = resolve(gitdir, readFileSync(join(gitdir, "commondir"), "utf8").trim());
  } catch {
    // commondir가 없으면 gitdir이 공통 디렉터리다
  }
  return { gitdir, common };
}

// 저장소 하나의 ref·HEAD·워크트리 서명(stat만, git 없음). 같으면 worktree list·log·for-each-ref·rev-list의 답도 같다.
// 못 만들면(reftable, .git을 못 읽음) null이고, 그 저장소는 예전처럼 매번 목록을 읽는다
export const NO_GIT = "no-git";
export function repoSignature(repo: string): string | null {
  try {
    if (!existsSync(join(repo, ".git"))) return NO_GIT; // 저장소가 아닌 AIRPORT 경로: git init으로 .git이 생기면 서명이 바뀐다
    const dirs = gitDirsOf(repo);
    if (!dirs) return null;
    const { gitdir, common } = dirs;
    if (existsSync(join(common, "reftable"))) return null;
    const parts = [gitdir, stamp(join(gitdir, "HEAD")), stamp(join(gitdir, "logs/HEAD")), stamp(join(common, "HEAD")), stamp(join(common, "logs/HEAD")), stamp(join(common, "packed-refs"))];
    // loose ref는 lock 파일을 rename해 바꾸므로 그 ref가 든 디렉터리의 mtime이 바뀐다(remote ref도 같다)
    const walk = (dir: string, rel: string) => {
      const s = statSync(dir, { bigint: true, throwIfNoEntry: false });
      parts.push(`${rel}:${s ? s.mtimeNs : "-"}`);
      if (s) for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) walk(join(dir, e.name), `${rel}/${e.name}`);
    };
    walk(join(common, "refs"), "refs");
    // 연결된 워크트리: 더하고 지우면 worktrees/의 mtime, 브랜치를 바꾸거나 커밋하면 그 HEAD·logs/HEAD, 작업 트리가 없어지면 prunable
    const wts = join(common, "worktrees");
    parts.push(stamp(wts));
    for (const e of existsSync(wts) ? readdirSync(wts, { withFileTypes: true }) : []) {
      if (!e.isDirectory()) continue;
      const d = join(wts, e.name);
      let target = "";
      try {
        target = readFileSync(join(d, "gitdir"), "utf8").trim();
      } catch {
        // gitdir 파일이 없으면 git도 prunable로 본다
      }
      parts.push(`${e.name}:${stamp(join(d, "HEAD"))}:${stamp(join(d, "logs/HEAD"))}:${target}:${target && existsSync(target) ? 1 : 0}`);
    }
    return parts.join("\n");
  } catch {
    return null;
  }
}

interface RepoRefs {
  commitAt: Map<string, string>; // head sha → 커밋 시각(%cI)
  origin: [string, string][]; // refs/remotes/origin/* (이름, sha), 이름순
  unpushed: Map<string, number> | null; // head sha → 어느 원격에도 없는 커밋 수. rev-list가 실패하면 null
}

const isCommitSha = (h: string) => /^[0-9a-f]{40,64}$/.test(h) && !/^0+$/.test(h);

// `rev-list --parents <heads> --not --remotes`의 답에서 head마다 `rev-list --count <head> --not --remotes`를 센다.
// 원격에서 닿는 커밋의 조상은 모두 원격에서 닿으므로, head에서 이 집합 안으로만 부모를 따라가면 그 head만의 답과 같다
export function unpushedCounts(revList: string, heads: readonly string[]): Map<string, number> {
  const parents = new Map<string, string[]>();
  for (const line of revList.split("\n")) {
    if (!line) continue;
    const [c, ...ps] = line.split(" ");
    parents.set(c, ps);
  }
  const out = new Map<string, number>();
  for (const h of heads) {
    if (out.has(h)) continue;
    const seen = new Set<string>();
    const stack = parents.has(h) ? [h] : [];
    while (stack.length) {
      const c = stack.pop()!;
      if (seen.has(c)) continue;
      seen.add(c);
      for (const p of parents.get(c) ?? []) if (parents.has(p) && !seen.has(p)) stack.push(p);
    }
    out.set(h, seen.size);
  }
  return out;
}

// `for-each-ref refs/remotes/origin/<branch>`와 같은 답: 그 이름이거나 그 아래(…/<branch>/x)인 ref의 sha를 줄로 이은 것이 head와 같은가
export function pushedOf(origin: readonly [string, string][], branch: string | null, head: string): boolean | null {
  if (!branch) return null;
  const ref = `refs/remotes/origin/${branch}`;
  return origin.filter(([n]) => n === ref || n.startsWith(`${ref}/`)).map(([, s]) => s).join("\n") === head;
}

// 저장소의 모든 head를 git 세 번에 읽는다(예전: 워크트리마다 log·for-each-ref·rev-list)
async function readRefs(repo: string, heads: readonly string[]): Promise<RepoRefs> {
  const shas = [...new Set(heads.filter(isCommitSha))];
  const [origin, log, rev] = await Promise.all([
    git(repo, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/remotes/origin"]),
    shas.length ? git(repo, ["log", "--no-walk=unsorted", "--format=%H %cI", ...shas]) : Promise.resolve(""),
    shas.length ? git(repo, ["rev-list", "--parents", ...shas, "--not", "--remotes"]).catch(() => null) : Promise.resolve(""),
  ]);
  const commitAt = new Map<string, string>();
  for (const line of log.split("\n")) {
    const [sha, at] = line.trim().split(" ");
    if (sha && at) commitAt.set(sha, at);
  }
  return {
    commitAt,
    origin: origin.split("\n").flatMap((l) => {
      const i = l.indexOf(" ");
      return i < 0 ? [] : [[l.slice(0, i), l.slice(i + 1).trim()] as [string, string]];
    }),
    unpushed: rev === null ? null : unpushedCounts(rev, shas),
  };
}

interface RepoView {
  sig: string | null; // 이 목록·ref를 읽기 직전의 서명. null이면 다음 틱에 다시 읽는다(서명을 못 만드는 저장소)
  at: number;
  entries: ListEntry[];
  refs: RepoRefs | null; // 못 읽었으면 null
  refsAt: number;
}

const DETAIL_TTL_MS = 30_000;
const REPO_RECHECK_MS = 5 * 60_000; // 서명이 놓친 변화가 있어도 목록·ref는 이보다 오래 묵지 않는다
const repoViews = new Map<string, RepoView>();
const inflight = new Map<string, Promise<RepoView>>();

async function repoView(repo: string, now: number): Promise<RepoView> {
  const sig = repoSignature(repo); // git보다 먼저 잰다: 읽는 사이에 바뀌면 다음 틱에 다시 읽는다
  const c = repoViews.get(repo);
  // ref를 못 읽었으면(refs null) 30초 뒤에 다시 해 본다: 실패가 이어져도 매 틱 git 넷을 띄우지 않는다
  if (c && sig !== null && c.sig === sig && now - c.at < REPO_RECHECK_MS && (c.refs || now - c.refsAt < DETAIL_TTL_MS)) return c;
  let p = inflight.get(repo);
  if (!p) {
    p = (async () => {
      // 저장소가 아니면 git은 늘 실패한다. 빈 목록으로 기억해 두고 매 틱 띄우지 않는다
      const entries = parseWorktreeList(await git(repo, ["worktree", "list", "--porcelain"]).catch((e) => (sig === NO_GIT ? "" : Promise.reject(e))));
      // 서명을 못 만드는 저장소: 목록은 매 틱, ref는 head가 그대로면 30초마다(예전과 같은 신선도)
      const keep = sig === null && c?.refs && now - c.refsAt < DETAIL_TTL_MS && entries.every((e) => !isCommitSha(e.head) || c.refs!.commitAt.has(e.head));
      const refs = keep ? c.refs : entries.length ? await readRefs(repo, entries.map((e) => e.head)).catch(() => null) : { commitAt: new Map(), origin: [], unpushed: new Map() };
      // 5분 다시 읽기가 모든 저장소에서 한 틱에 몰리지 않게 시작을 1분 안에서 흩는다
      const v: RepoView = { sig, at: now - Math.random() * 60_000, entries, refs, refsAt: keep ? c.refsAt : now };
      repoViews.set(repo, v);
      return v;
    })()
      .catch((e) => {
        repoViews.delete(repo);
        throw e;
      })
      .finally(() => inflight.delete(repo));
    inflight.set(repo, p);
  }
  return p;
}

// git status를 셸 하나로 여러 워크트리에 돌린다. 워크트리마다 끝에 NUL과 종료 코드 한 줄(porcelain 출력에는 NUL이 없다).
// 하나가 멈춰도 나머지가 밀리지 않게 워크트리마다 예전처럼 10초에서 끊는다(timeout이 없는 곳은 셸 전체 시간 한도만)
const STATUS_SCRIPT = 't=; command -v timeout >/dev/null 2>&1 && t="timeout 10"; for d; do $t git -C "$d" status --porcelain; printf "\\0%s\\n" "$?"; done';

// 워크트리마다 변경 파일 수. git status가 실패했으면 null, 셸이 거기까지 못 갔으면 undefined
export function parseStatusBatch(out: string, n: number): (number | null | undefined)[] {
  const parts = out.split("\0");
  const result: (number | null | undefined)[] = [];
  for (let i = 0; i < n; i++) {
    const next = parts[i + 1];
    if (next === undefined) {
      result.push(undefined);
      continue;
    }
    const body = i === 0 ? parts[0] : parts[i].slice(parts[i].indexOf("\n") + 1);
    const nl = next.indexOf("\n");
    result.push((nl < 0 ? next : next.slice(0, nl)) === "0" ? body.split("\n").filter(Boolean).length : null);
  }
  return result;
}

async function readStatuses(paths: string[]): Promise<(number | null)[]> {
  spawns++;
  let out = "";
  try {
    out = (await run("sh", ["-c", STATUS_SCRIPT, "sh", ...paths], { timeout: 10_000 * paths.length, maxBuffer: (4 << 20) * paths.length })).stdout;
  } catch (e) {
    const s = (e as { stdout?: unknown }).stdout; // 시간이 넘거나 셸이 죽어도 끝난 워크트리 것은 쓴다
    out = typeof s === "string" ? s : "";
  }
  return parseStatusBatch(out, paths.length).map((x) => x ?? null);
}

const STATUS_SHELLS = 6; // 예전처럼 동시에 여섯
const statuses = new Map<string, { dirty: number | null; checkedAt: number }>(); // dirty null = git status 실패
let refreshing: Promise<void> | null = null;

async function refreshStatuses(paths: string[], now: number) {
  const size = Math.ceil(paths.length / STATUS_SHELLS);
  const chunks: string[][] = [];
  for (let i = 0; i < paths.length; i += size) chunks.push(paths.slice(i, i + size));
  await Promise.all(
    chunks.map(async (chunk) => {
      const dirty = await readStatuses(chunk);
      chunk.forEach((p, i) => statuses.set(p, { dirty: dirty[i], checkedAt: now }));
    }),
  );
}

// 지금 도는 백그라운드 status 읽기(테스트가 기다린다)
export const workspaceRefresh = (): Promise<void> => refreshing ?? Promise.resolve();

export function resetWorkspaceCache() {
  repoViews.clear();
  inflight.clear();
  statuses.clear();
  refreshing = null;
}

type Detail = Pick<Workspace, "dirty" | "lastCommitAt" | "pushed" | "unpushed">;
const FAILED: Detail = { dirty: 0, lastCommitAt: null, pushed: null, unpushed: null }; // 예전에 git 하나라도 실패하면 쓰던 값

function detailOf(dirty: number | null, branch: string | null, head: string, refs: RepoRefs | null): Detail {
  const at = refs?.commitAt.get(head);
  if (dirty === null || !refs || !at) return FAILED;
  return { dirty, lastCommitAt: at, pushed: pushedOf(refs.origin, branch, head), unpushed: refs.unpushed ? (refs.unpushed.get(head) ?? 0) : null };
}

// 운항 중인 AIRPORT(저장소)들의 워크트리. 목록과 ref에서 나오는 값은 저장소 서명이 바뀐 틱에, dirty는 30초마다 백그라운드로 갱신한다.
export async function readWorkspaces(repos: string[], now = Date.now()): Promise<Workspace[]> {
  const views = await Promise.all(repos.map((r) => repoView(r, now).catch(() => null)));
  const rows = views.flatMap((v, i) => (v ? workspacesOf(repos[i], v.entries).map((x) => ({ ...x, refs: v.refs })) : []));
  const listed = new Set(rows.map((r) => r.w.path));
  for (const p of statuses.keys()) if (!listed.has(p)) statuses.delete(p); // 없어진 STAND는 잊는다: 같은 경로에 다시 생기면 새로 읽는다
  const stale = [...new Set(rows.filter((r) => (statuses.get(r.w.path)?.checkedAt ?? 0) < now - DETAIL_TTL_MS).map((r) => r.w.path))];
  if (stale.length && !refreshing) refreshing = refreshStatuses(stale, now).finally(() => (refreshing = null));
  for (const { w, head, refs } of rows) {
    const st = statuses.get(w.path);
    if (st) Object.assign(w, detailOf(st.dirty, w.branch, head, refs));
  }
  return rows.map((r) => r.w);
}

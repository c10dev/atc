import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { promisify } from "node:util";
import { config } from "../config.ts";
import { keyInName, keyInTitle, keyPatternOf } from "../linear-keys.ts";
import type { Workspace } from "../model.ts";

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
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

async function listWorktrees(repo: string): Promise<Workspace[]> {
  const out = await git(repo, ["worktree", "list", "--porcelain"]);
  const result: Workspace[] = [];
  for (const block of out.trim().split("\n\n")) {
    const fields = new Map<string, string>();
    for (const line of block.split("\n")) {
      const i = line.indexOf(" ");
      fields.set(i < 0 ? line : line.slice(0, i), i < 0 ? "" : line.slice(i + 1));
    }
    const path = fields.get("worktree");
    if (!path || fields.has("prunable") || fields.has("bare") || !existsSync(path)) continue;
    const branch = fields.get("branch")?.replace(/^refs\/heads\//, "") ?? null;
    result.push({
      path,
      name: path === repo ? basename(repo) : basename(path),
      repo,
      isMain: path === repo,
      branch,
      head: (fields.get("HEAD") ?? "").slice(0, 8),
      dirty: null,
      lastCommitAt: null,
      ticketKey: ticketKeyFromBranch(branch),
    });
  }
  return result;
}

interface Detail {
  dirty: number;
  lastCommitAt: string | null;
  pushed: boolean | null;
  unpushed: number | null; // 어느 원격에도 없는 커밋 수(ATC-543). 모르면 null
  checkedAt: number;
}

const details = new Map<string, Detail>();
const DETAIL_TTL_MS = 30_000;

async function refreshDetail(ws: Workspace) {
  try {
    const [status, log, remote, ahead] = await Promise.all([
      git(ws.path, ["status", "--porcelain"]),
      git(ws.path, ["log", "-1", "--format=%H %cI"]),
      // origin/<branch> 추적 ref(push가 갱신한다). 없으면 빈 글
      ws.branch ? git(ws.path, ["for-each-ref", "--format=%(objectname)", `refs/remotes/origin/${ws.branch}`]) : Promise.resolve(null),
      git(ws.path, ["rev-list", "--count", "HEAD", "--not", "--remotes"]).catch(() => null),
    ]);
    const [sha, at] = log.trim().split(" ");
    details.set(ws.path, {
      dirty: status.split("\n").filter(Boolean).length,
      lastCommitAt: at || null,
      pushed: remote === null || !sha ? null : remote.trim() === sha,
      unpushed: ahead === null || !/^\d+$/.test(ahead.trim()) ? null : Number(ahead.trim()),
      checkedAt: Date.now(),
    });
  } catch {
    details.set(ws.path, { dirty: 0, lastCommitAt: null, pushed: null, unpushed: null, checkedAt: Date.now() });
  }
}

let refreshing = false;

// 운항 중인 AIRPORT(저장소)들의 워크트리. 목록은 매번, dirty/커밋 시각은 30초마다 백그라운드로 갱신한다.
export async function readWorkspaces(repos: string[]): Promise<Workspace[]> {
  const lists = await Promise.all(repos.map((r) => listWorktrees(r).catch(() => [])));
  const all = lists.flat();
  const stale = all.filter((w) => (details.get(w.path)?.checkedAt ?? 0) < Date.now() - DETAIL_TTL_MS);
  if (stale.length && !refreshing) {
    refreshing = true;
    (async () => {
      for (let i = 0; i < stale.length; i += 6) await Promise.all(stale.slice(i, i + 6).map(refreshDetail));
    })().finally(() => (refreshing = false));
  }
  for (const w of all) {
    const d = details.get(w.path);
    if (d) Object.assign(w, { dirty: d.dirty, lastCommitAt: d.lastCommitAt, pushed: d.pushed, unpushed: d.unpushed });
  }
  return all;
}

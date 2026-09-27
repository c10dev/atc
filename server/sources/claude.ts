import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";
import { toolPaths } from "../../hooks/paths.mjs";
import type { Claim, Session, Workspace } from "../model.ts";

interface SessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  procStart?: string;
  name?: string;
  status?: string;
}

// pid 재사용을 피하려고 /proc/<pid>/stat의 starttime(22번째 필드)까지 맞춘다.
function isAlive(pid: number, procStart?: string): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    if (!procStart) return true;
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] === procStart;
  } catch {
    return false;
  }
}

// 세션 폴더(~/.claude/projects/<cwd>/<sessionId>/). 대화 기록은 그 옆 <sessionId>.jsonl, 서브에이전트는 안의 subagents/
export function sessionDir(cwd: string, sessionId: string): string {
  return join(config.claudeDir, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), sessionId);
}

function transcriptPath(s: SessionFile): string {
  return `${sessionDir(s.cwd, s.sessionId)}.jsonl`;
}

function mtime(path: string): Date | null {
  try {
    return statSync(path).mtime;
  } catch {
    return null;
  }
}

export function readClaudeSessions(): { sessions: Session[]; files: SessionFile[] } {
  const dir = join(config.claudeDir, "sessions");
  const files: SessionFile[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      files.push(JSON.parse(readFileSync(join(dir, f), "utf8")));
    } catch {}
  }
  const sessions = files.map((s): Session => {
    const alive = isAlive(s.pid, s.procStart);
    return {
      id: s.sessionId,
      agent: "claude",
      name: s.name || s.sessionId.slice(0, 8),
      status: !alive ? "dead" : s.status === "busy" ? "busy" : "idle",
      pid: s.pid,
      cwd: s.cwd,
      startedAt: new Date(s.startedAt).toISOString(),
      lastActiveAt: mtime(transcriptPath(s))?.toISOString() ?? null,
      repo: null,
      workspacePath: null,
    };
  });
  return { sessions, files };
}

export function readHookClaims(): Claim[] {
  const root = join(config.stateDir, "claims");
  const claims: Claim[] = [];
  let sessionDirs: string[] = [];
  try {
    sessionDirs = readdirSync(root);
  } catch {
    return claims;
  }
  for (const sessionId of sessionDirs) {
    let entries: string[] = [];
    try {
      entries = readdirSync(join(root, sessionId));
    } catch {
      continue;
    }
    for (const f of entries) {
      const file = join(root, sessionId, f);
      try {
        const body = JSON.parse(readFileSync(file, "utf8"));
        claims.push({
          sessionId,
          workspacePath: body.workspace,
          since: body.since,
          lastAt: statSync(file).mtime.toISOString(),
          source: "hook",
          state: "active",
          handedOffTo: null,
          tool: body.tool ?? null,
        });
      } catch {}
    }
  }
  return claims;
}

const TAIL_BYTES = 1 << 20;
const inferCache = new Map<string, { key: string; claim: Claim | null }>();

function readTail(path: string, size: number): string {
  const fd = openSync(path, "r");
  try {
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const text = buf.toString("utf8");
    // 잘린 첫 줄은 버린다
    return len < size ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    closeSync(fd);
  }
}

// 경로를 가장 깊이 포함하는 linked worktree
function workspaceOf(path: string, deepestFirst: Workspace[]): Workspace | undefined {
  const ws = deepestFirst.find((w) => path === w.path || path.startsWith(w.path + "/"));
  return ws && !ws.isMain ? ws : undefined;
}

interface Touch {
  workspacePath: string;
  at: number;
}

// 대화 기록 JSONL에서 도구 호출(tool_use)만 읽어 hook과 같은 규칙(toolPaths)으로 워크트리 접촉을 뽑는다.
// 도구 결과(ls 출력, JSON 등)나 메시지 본문에 경로가 나온 것은 세지 않는다.
export function touchesFromTranscript(text: string, workspaces: Workspace[]): Touch[] {
  const deepestFirst = [...workspaces].sort((a, b) => b.path.length - a.path.length);
  const touches: Touch[] = [];
  for (const line of text.split("\n")) {
    if (!line.includes('"tool_use"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "assistant" || !Array.isArray(entry.message?.content)) continue;
    const at = Date.parse(entry.timestamp);
    if (Number.isNaN(at)) continue;
    for (const block of entry.message.content) {
      if (block?.type !== "tool_use") continue;
      for (const p of toolPaths(block.name, block.input, entry.cwd)) {
        const ws = workspaceOf(p, deepestFirst);
        if (ws) touches.push({ workspacePath: ws.path, at });
      }
    }
  }
  return touches;
}

// 본 대화 기록과, 점유 TTL 안에 갱신된 서브에이전트 기록
function transcriptFiles(s: SessionFile): { path: string; size: number; mtimeMs: number }[] {
  const main = transcriptPath(s);
  const candidates = [main];
  const subDir = join(main.replace(/\.jsonl$/, ""), "subagents");
  try {
    for (const f of readdirSync(subDir)) if (f.endsWith(".jsonl")) candidates.push(join(subDir, f));
  } catch {}
  const files = [];
  for (const path of candidates) {
    try {
      const st = statSync(path);
      if (path === main || Date.now() - st.mtimeMs < config.claimTtlMs) files.push({ path, size: st.size, mtimeMs: st.mtimeMs });
    } catch {}
  }
  return files;
}

// hook 기록이 없는 세션용: 가장 최근에 작업하러 들어간 워크트리 하나를 ESTIMATED TRACK으로 돌려준다.
export function inferTranscriptClaim(s: SessionFile, workspaces: Workspace[]): Claim | null {
  const files = transcriptFiles(s);
  if (!files.length) return null;
  const key = files.map((f) => `${f.path}:${f.size}:${f.mtimeMs}`).join("|");
  const cached = inferCache.get(s.sessionId);
  if (cached?.key === key) return cached.claim;

  const touches = files.flatMap((f) => touchesFromTranscript(readTail(f.path, f.size), workspaces));
  const latest = touches.reduce<Touch | null>((a, b) => (!a || b.at > a.at ? b : a), null);
  const claim: Claim | null = latest && {
    sessionId: s.sessionId,
    workspacePath: latest.workspacePath,
    since: new Date(
      Math.min(...touches.filter((t) => t.workspacePath === latest.workspacePath).map((t) => t.at)),
    ).toISOString(),
    lastAt: new Date(latest.at).toISOString(),
    source: "transcript",
    state: "active",
    handedOffTo: null,
    tool: null,
  };
  inferCache.set(s.sessionId, { key, claim });
  return claim;
}

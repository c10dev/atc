import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";
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

function transcriptPath(s: SessionFile): string {
  return join(config.claudeDir, "projects", s.cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${s.sessionId}.jsonl`);
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
    return buf.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

// hook 기록이 없는 세션용: 대화 기록 끝부분에서 가장 마지막에 언급된 워크트리를 고른다.
export function inferTranscriptClaim(s: SessionFile, workspaces: Workspace[]): Claim | null {
  const path = transcriptPath(s);
  let st;
  try {
    st = statSync(path);
  } catch {
    return null;
  }
  const key = `${st.size}:${st.mtimeMs}`;
  const cached = inferCache.get(s.sessionId);
  if (cached?.key === key) return cached.claim;

  const tail = readTail(path, st.size);
  let best: { ws: Workspace; at: number } | null = null;
  for (const ws of workspaces) {
    if (ws.isMain) continue;
    // 접미사를 붙여 vocado-yt-occlusion-a 가 -a2 에 걸리지 않게 한다.
    const at = Math.max(tail.lastIndexOf(ws.path + "/"), tail.lastIndexOf(ws.path + '"'));
    if (at >= 0 && (!best || at > best.at)) best = { ws, at };
  }
  const claim: Claim | null = best && {
    sessionId: s.sessionId,
    workspacePath: best.ws.path,
    since: new Date(s.startedAt).toISOString(),
    lastAt: st.mtime.toISOString(),
    source: "transcript",
    tool: null,
  };
  inferCache.set(s.sessionId, { key, claim });
  return claim;
}

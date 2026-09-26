import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";
import type { Claim, Session, Workspace } from "../model.ts";

const BUSY_MS = 90_000;

function readFirstLine(path: string): string {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(64 << 10);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const text = buf.subarray(0, n).toString("utf8");
    const nl = text.indexOf("\n");
    return nl < 0 ? text : text.slice(0, nl);
  } finally {
    closeSync(fd);
  }
}

function threadNames(): Map<string, string> {
  const names = new Map<string, string>();
  try {
    for (const line of readFileSync(join(config.codexDir, "session_index.jsonl"), "utf8").split("\n")) {
      if (!line) continue;
      try {
        const e = JSON.parse(line);
        if (e.id && e.thread_name) names.set(e.id, e.thread_name);
      } catch {}
    }
  } catch {}
  return names;
}

// 오늘과 어제 폴더만 본다. 점유 TTL 안에 기록이 갱신된 rollout을 살아 있는 세션으로 취급한다.
function recentRollouts(): string[] {
  const out: string[] = [];
  for (const offset of [0, 1]) {
    const d = new Date(Date.now() - offset * 86_400_000);
    const dir = join(
      config.codexDir,
      "sessions",
      String(d.getFullYear()),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0"),
    );
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) if (f.endsWith(".jsonl")) out.push(join(dir, f));
  }
  return out;
}

export function readCodex(workspaces: Workspace[]): { sessions: Session[]; claims: Claim[] } {
  const sessions: Session[] = [];
  const claims: Claim[] = [];
  const now = Date.now();
  const names = threadNames();
  for (const file of recentRollouts()) {
    const st = statSync(file);
    if (now - st.mtimeMs > config.claimTtlMs) continue;
    let meta;
    try {
      meta = JSON.parse(readFirstLine(file)).payload;
    } catch {
      continue;
    }
    if (!meta?.id || !meta.cwd) continue;
    sessions.push({
      id: meta.id,
      agent: "codex",
      name: names.get(meta.id) ?? meta.cwd.split("/").pop(),
      status: now - st.mtimeMs < BUSY_MS ? "busy" : "idle",
      pid: null,
      cwd: meta.cwd,
      startedAt: meta.timestamp,
      lastActiveAt: st.mtime.toISOString(),
    });
    const ws = workspaces.find((w) => !w.isMain && (meta.cwd === w.path || meta.cwd.startsWith(w.path + "/")));
    if (ws) {
      claims.push({
        sessionId: meta.id,
        workspacePath: ws.path,
        since: meta.timestamp,
        lastAt: st.mtime.toISOString(),
        source: "cwd",
        state: "active",
        handedOffTo: null,
        tool: null,
      });
    }
  }
  return { sessions, claims };
}

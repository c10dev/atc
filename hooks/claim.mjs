#!/usr/bin/env node
// Claude Code PostToolUse hook. 도구가 건드린 경로가 git linked worktree 안이면
// ~/.local/state/atc/claims/<sessionId>/<encoded worktree>.json 을 만들거나 mtime을 갱신한다.
// 실패해도 세션을 방해하지 않도록 항상 exit 0.
import { lstatSync, mkdirSync, writeFileSync, utimesSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

const STATE_DIR = process.env.ATC_STATE_DIR || join(homedir(), ".local/state/atc");
const MAX_PATHS = 12;

function worktreeRoot(p) {
  let dir = resolve(p);
  while (dir !== "/" && dir !== homedir()) {
    try {
      const st = lstatSync(join(dir, ".git"));
      // linked worktree는 .git이 파일, 본 체크아웃은 디렉터리
      return st.isFile() ? dir : null;
    } catch {}
    dir = dirname(dir);
  }
  return null;
}

function candidatePaths(input) {
  const ti = input.tool_input || {};
  const out = [];
  for (const k of ["file_path", "notebook_path"]) if (typeof ti[k] === "string") out.push(ti[k]);
  if (input.tool_name === "Bash" && typeof ti.command === "string") {
    for (const m of ti.command.matchAll(/(?:^|[\s'"=:(])(\/[^\s'"`;|&<>()]+)/g)) out.push(m[1]);
  }
  if (typeof input.cwd === "string") out.push(input.cwd);
  return out.filter((p) => p.startsWith("/home/")).slice(0, MAX_PATHS);
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const sessionId = input.session_id;
  if (!sessionId || !/^[\w-]+$/.test(sessionId)) process.exit(0);

  const roots = new Set();
  for (const p of candidatePaths(input)) {
    const root = worktreeRoot(p);
    if (root) roots.add(root);
  }
  if (roots.size === 0) process.exit(0);

  const dir = join(STATE_DIR, "claims", sessionId);
  mkdirSync(dir, { recursive: true });
  const now = new Date();
  for (const root of roots) {
    const file = join(dir, encodeURIComponent(root) + ".json");
    const body = {
      sessionId,
      workspace: root,
      since: now.toISOString(),
      tool: input.tool_name ?? null,
      agentId: input.agent_id ?? null,
      agentType: input.agent_type ?? null,
    };
    try {
      writeFileSync(file, JSON.stringify(body) + "\n", { flag: "wx" });
    } catch (e) {
      if (e.code === "EEXIST") utimesSync(file, now, now);
    }
  }
} catch {}
process.exit(0);

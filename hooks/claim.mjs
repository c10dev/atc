#!/usr/bin/env node
// Claude Code PostToolUse hook. 도구가 건드린 경로가 git linked worktree 안이면
// ~/.local/state/atc/claims/<sessionId>/<encoded worktree>.json 을 만들거나 mtime을 갱신한다.
// 실패해도 세션을 방해하지 않도록 항상 exit 0.
import { lstatSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { toolPaths } from "./paths.mjs";

const STATE_DIR = process.env.ATC_STATE_DIR || join(homedir(), ".local/state/atc");
const TTL_MS = Number(process.env.ATC_CLAIM_TTL_MIN || 180) * 60_000;

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
  return toolPaths(input.tool_name, input.tool_input, input.cwd);
}

// 내가 마지막으로 건드린 뒤에 다른 세션이 같은 워크트리를 새로 잡았는가.
// 그렇다면 지금은 되찾는 것이므로 since를 새로 시작해야 HANDOFF·충돌 판정이 맞다.
function takenOverSince(claimsRoot, sessionId, fname, sinceMs) {
  for (const other of readdirSync(claimsRoot)) {
    if (other === sessionId) continue;
    try {
      if (Date.parse(JSON.parse(readFileSync(join(claimsRoot, other, fname), "utf8")).since) > sinceMs) return true;
    } catch {}
  }
  return false;
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

  const claimsRoot = join(STATE_DIR, "claims");
  const dir = join(claimsRoot, sessionId);
  mkdirSync(dir, { recursive: true });
  const now = new Date();
  for (const root of roots) {
    const fname = encodeURIComponent(root) + ".json";
    const file = join(dir, fname);
    const body = {
      sessionId,
      workspace: root,
      since: now.toISOString(),
      tool: input.tool_name ?? null,
      agentId: input.agent_id ?? null,
      agentType: input.agent_type ?? null,
    };
    const json = JSON.stringify(body) + "\n";
    try {
      writeFileSync(file, json, { flag: "wx" });
    } catch (e) {
      if (e.code !== "EEXIST") continue;
      const lastMs = statSync(file).mtimeMs;
      if (now - lastMs > TTL_MS || takenOverSince(claimsRoot, sessionId, fname, lastMs)) writeFileSync(file, json);
      else utimesSync(file, now, now);
    }
  }
} catch {}
process.exit(0);

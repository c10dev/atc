#!/usr/bin/env node
// Claude Code PostToolUse hook. 도구가 건드린 경로가 git linked worktree 안이면
// ~/.local/state/atc/claims/<sessionId>/<encoded worktree>.json 을 만들거나 mtime을 갱신한다.
// 실패해도 세션을 방해하지 않도록 항상 exit 0.
import { lstatSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { workTargets } from "./shell.mjs";

const STATE_DIR = process.env.ATC_STATE_DIR || join(homedir(), ".local/state/atc");
const MAX_PATHS = 12;
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

// Bash는 경로를 언급만 해도(ls, cat, grep, echo, heredoc) 잡히지 않도록
// 명령 위치의 `cd <dir>`와 `git -C <dir>` 대상만 본다(shell.mjs).
function bashTargets(command, cwd) {
  return workTargets(command).map((arg) =>
    resolve(
      typeof cwd === "string" ? cwd : "/",
      arg.replace(/^~(?=\/|$)/, homedir()).replace(/^\$\{?HOME\}?(?=\/|$)/, homedir()),
    ),
  );
}

function candidatePaths(input) {
  const ti = input.tool_input || {};
  const out = [];
  for (const k of ["file_path", "notebook_path"]) if (typeof ti[k] === "string") out.push(ti[k]);
  if (input.tool_name === "Bash" && typeof ti.command === "string") out.push(...bashTargets(ti.command, input.cwd));
  if (typeof input.cwd === "string") out.push(input.cwd);
  return out.filter((p) => p.startsWith("/home/")).slice(0, MAX_PATHS);
}

// 내가 마지막으로 건드린 뒤에 다른 세션이 같은 워크트리를 새로 잡았는가.
// 그렇다면 지금은 되찾는 것이므로 since를 새로 시작해야 이양·충돌 판정이 맞다.
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

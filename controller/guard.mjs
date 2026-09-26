#!/usr/bin/env node
// 관제사 세션의 PreToolUse hook (Bash). 관제사는 조종하지 않는다:
// atc CLI(node atcctl.mjs …)와 jq 외의 명령, 파일로 쓰는 리다이렉션을 막는다. 막으면 exit 2.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { simpleCommands } from "../hooks/shell.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ATCCTL = join(HERE, "atcctl.mjs");

// 따옴표 밖의 > < 는 파일 리다이렉션(또는 heredoc)이라 허용하지 않는다.
function hasRedirect(command) {
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === "\\" && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === "\\") i++;
    else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === ">" || ch === "<") return true;
  }
  return false;
}

export function check(command, cwd = HERE) {
  if (typeof command !== "string" || !command.trim()) return "빈 명령";
  if (hasRedirect(command)) return "리다이렉션(>, <, heredoc)은 쓸 수 없음";
  for (const words of simpleCommands(command)) {
    const [cmd, script] = words;
    if (cmd === "jq") continue;
    if (cmd === "node" && script && resolve(cwd, script) === ATCCTL) continue;
    return `허용되지 않은 명령: ${words.slice(0, 3).join(" ")}`;
  }
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {}
  const reason = check(input.tool_input?.command, input.cwd || HERE);
  if (reason) {
    console.error(`관제사는 조종하지 않습니다 — ${reason}. atc CLI(node atcctl.mjs …)와 jq만 쓸 수 있습니다.`);
    process.exit(2);
  }
}

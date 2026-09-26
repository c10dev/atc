#!/usr/bin/env node
// TOWER·OCC 세션의 PreToolUse hook (Bash). 관제 세션은 조종하지 않는다:
// atc CLI(node atcctl.mjs …)와 jq 외의 명령, 파일로 쓰는 리다이렉션을 막는다. 막으면 exit 2.
// `--gh-read`로 부르면(OCC) 팀 보고 확인용 읽기 전용 gh(`gh pr view|checks|diff|list`)도 허용한다.
// `--crosscheck`로 부르면(CROSSCHECK) atc CLI 중 읽기와 crosscheck 명령만 허용한다(쓰는 dispatch·schedule 명령은 막음).
// `--crosscheck --gh-read`면 gh는 PR 사실 확인용 `gh pr view|checks|list`만(코드를 읽지 않으므로 diff는 뺀다).
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

// 읽기만 하는 gh 하위 명령. `gh api`는 POST도 되므로 넣지 않는다.
const GH_READ = new Set(["view", "checks", "diff", "list"]);
const CROSSCHECK_GH_READ = new Set(["view", "checks", "list"]);

// 작은따옴표 밖의 명령 치환·변수 확장($(…), `…`, ${…}, $VAR)은 쉘이 실행 전에 풀어 버린다.
// 큰따옴표 안에서도 풀리므로("$(touch x)"), 인자 모양만 보는 검사로는 막을 수 없어 통째로 막는다.
// 작은따옴표 안과 \$처럼 이스케이프한 것은 글자 그대로라 괜찮다.
function hasExpansion(command) {
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      continue;
    }
    if (ch === "\\") {
      i++;
      continue;
    }
    if (quote === '"' && ch === '"') quote = null;
    else if (!quote && (ch === "'" || ch === '"')) quote = ch;
    else if (ch === "`") return true;
    else if (ch === "$" && /[A-Za-z_{(0-9@*#?!$-]/.test(command[i + 1] ?? "")) return true;
  }
  return false;
}

// CROSSCHECK 세션이 쓸 수 있는 atcctl 하위 명령(앞 두 단어)
const CROSSCHECK_CMDS = new Set([
  "manual check", "manual ack",
  "crosscheck brief",
  "dispatch brief", "dispatch flight", "dispatch crosscheck",
  "schedule brief", "schedule crosscheck",
]);

export function check(command, cwd = HERE, { ghRead = false, crosscheck = false } = {}) {
  if (typeof command !== "string" || !command.trim()) return "빈 명령";
  if (hasRedirect(command)) return "리다이렉션(>, <, heredoc)은 쓸 수 없음";
  if (hasExpansion(command)) return "명령 치환·변수 확장($(…), `…`, ${…}, $VAR)은 쓸 수 없음 — 문구는 작은따옴표로 감싼다";
  for (const words of simpleCommands(command)) {
    const [cmd, script] = words;
    if (cmd === "jq") continue;
    const ghAllowed = crosscheck ? CROSSCHECK_GH_READ : GH_READ;
    if (ghRead && cmd === "gh" && words[1] === "pr" && ghAllowed.has(words[2]) && !words.includes("--web")) continue;
    if (cmd === "node" && script && resolve(cwd, script) === ATCCTL) {
      if (crosscheck && !CROSSCHECK_CMDS.has(words.slice(2, 4).join(" "))) return `CROSSCHECK가 쓸 수 없는 atc 명령: ${words.slice(2, 4).join(" ") || "(없음)"}`;
      continue;
    }
    return `허용되지 않은 명령: ${words.slice(0, 3).join(" ")}`;
  }
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {}
  const ghRead = process.argv.includes("--gh-read");
  const crosscheck = process.argv.includes("--crosscheck");
  const reason = check(input.tool_input?.command, input.cwd || HERE, { ghRead, crosscheck });
  if (reason) {
    const allowed = crosscheck
      ? `atc CLI의 읽기(manual·brief·flight)와 crosscheck 명령, jq${ghRead ? ", 읽기 전용 gh pr view·checks·list" : ""}`
      : ghRead ? "atc CLI(node atcctl.mjs …), jq, 읽기 전용 gh pr view·checks·diff·list" : "atc CLI(node atcctl.mjs …)와 jq";
    console.error(`관제 세션(TOWER·OCC·CROSSCHECK)은 조종하지 않습니다 — ${reason}. ${allowed}만 쓸 수 있습니다.`);
    process.exit(2);
  }
}

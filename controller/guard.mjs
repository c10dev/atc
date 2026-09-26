#!/usr/bin/env node
// TOWER·OCC 세션의 PreToolUse hook (Bash). 관제 세션은 조종하지 않는다:
// atc CLI(node atcctl.mjs …)와 jq 외의 명령, 파일로 쓰는 리다이렉션을 막는다. 막으면 exit 2.
// `--gh-read`로 부르면(OCC) 팀 보고 확인용 읽기 전용 gh(`gh pr view|checks|diff|list`)도 허용한다.
// `--crosscheck`로 부르면(CROSSCHECK) atc CLI 중 읽기와 crosscheck 명령만 허용한다(쓰는 dispatch·schedule 명령은 막음).
// `--crosscheck --gh-read`면 gh는 PR 사실 확인용 `gh pr view|checks|list`만(코드를 읽지 않으므로 diff는 뺀다).
// `--crosscheck`에서 mark를 다는 명령(dispatch|schedule crosscheck)은 그 세션의 실제 모델을 확인한다:
// hook 입력의 transcript_path(세션 자신의 기록)에서 마지막 assistant 메시지의 model을 읽어 허용 목록에 맞을 때만
// 통과시키고, 그 이름을 ATC_CROSSCHECK_MODEL로 붙여(updatedInput) mark에 실제 모델이 남게 한다.
import { closeSync, openSync, readSync, fstatSync, readFileSync } from "node:fs";
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

// CROSSCHECK로 쓸 수 있는 모델: Muse Spark 1.3(기본), GPT-5.6 Terra(대체). 두 경로에서 기록되는 이름:
// ocx claude → claude-ocx-opencode-go--muse-spark-1.3-contributor, ClaudeRipple(Desktop) → muse-spark-1.3-contributor
export const CROSSCHECK_MODELS = /muse-spark|gpt-5\.6-terra/i;
const MODEL_NAME = /^[A-Za-z0-9._:@\/\[\]-]{1,120}$/; // 명령에 붙여도 안전한 글자만
const TAIL_BYTES = 4 * 1024 * 1024;

// 기록 JSONL에서 마지막 assistant 메시지의 model(오류 때 끼는 "<synthetic>"은 건너뛴다). 없으면 null.
export function lastModelOf(text) {
  const lines = String(text).split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"assistant"')) continue;
    try {
      const o = JSON.parse(lines[i]);
      const m = o?.type === "assistant" ? o.message?.model : null;
      if (typeof m === "string" && m && m !== "<synthetic>") return m;
    } catch {}
  }
  return null;
}

// 기록 파일의 끝부분(최대 4MB)만 읽는다. 읽을 수 없으면 null.
export function readTranscriptTail(path) {
  if (typeof path !== "string" || !path) return null;
  let fd;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const isMarkCommand = (words, cwd) =>
  words[0] === "node" && words[1] && resolve(cwd, words[1]) === ATCCTL && (words[2] === "dispatch" || words[2] === "schedule") && words[3] === "crosscheck";

const SWITCH_MODEL = "앱에서 모델을 Muse(muse-spark-1.3-contributor)로 바꾸거나, 터미널에서 ocx claude로 여세요";

// mark 명령의 실제 모델 확인. 통과면 { command: 모델을 붙인 명령 }, 막으면 { reason }. mark 명령이 아니면 { command } 그대로.
export function checkMarkModel(command, cwd, transcript) {
  const cmds = simpleCommands(command);
  if (!cmds.some((w) => isMarkCommand(w, cwd))) return { command };
  if (cmds.length !== 1) return { reason: "crosscheck 명령은 파이프·이어 쓰기 없이 단독으로 쓴다" };
  const sep = cmds[0].indexOf("--");
  const head = sep < 0 ? cmds[0] : cmds[0].slice(0, sep);
  if (head.some((w) => w === "--model" || w.startsWith("--model="))) return { reason: "모델 이름은 세션이 적지 않는다(guard가 실제 모델을 붙인다)" };
  if (transcript == null) return { reason: `세션 기록(transcript)을 읽지 못해 실제 모델을 확인할 수 없음 — ${SWITCH_MODEL}` };
  const model = lastModelOf(transcript);
  if (!model) return { reason: `세션 기록에 모델이 없어 확인할 수 없음 — ${SWITCH_MODEL}` };
  if (!CROSSCHECK_MODELS.test(model) || !MODEL_NAME.test(model)) return { reason: `이 세션의 실제 모델(${model})은 CROSSCHECK로 쓸 수 없음 — ${SWITCH_MODEL}` };
  return { command: `ATC_CROSSCHECK_MODEL='${model}' ${command.trimStart()}`, model };
}

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
  const cwd = input.cwd || HERE;
  let reason = check(input.tool_input?.command, cwd, { ghRead, crosscheck });
  let marked = null;
  if (!reason && crosscheck) {
    const cmds = simpleCommands(input.tool_input.command);
    if (cmds.some((w) => isMarkCommand(w, cwd))) {
      marked = checkMarkModel(input.tool_input.command, cwd, readTranscriptTail(input.transcript_path));
      if (marked.reason) {
        console.error(`CROSSCHECK mark 차단 — ${marked.reason}.`);
        process.exit(2);
      }
    }
  }
  if (marked?.model) {
    // 실제 모델을 붙인 명령으로 바꿔 실행한다(mark의 model은 이 값)
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: { ...input.tool_input, command: marked.command } } }));
    process.exit(0);
  }
  if (reason) {
    const allowed = crosscheck
      ? `atc CLI의 읽기(manual·brief·flight)와 crosscheck 명령, jq${ghRead ? ", 읽기 전용 gh pr view·checks·list" : ""}`
      : ghRead ? "atc CLI(node atcctl.mjs …), jq, 읽기 전용 gh pr view·checks·diff·list" : "atc CLI(node atcctl.mjs …)와 jq";
    console.error(`관제 세션(TOWER·OCC·CROSSCHECK)은 조종하지 않습니다 — ${reason}. ${allowed}만 쓸 수 있습니다.`);
    process.exit(2);
  }
}

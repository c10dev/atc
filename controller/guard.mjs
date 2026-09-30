#!/usr/bin/env node
// TOWER·OCC 세션의 PreToolUse hook (Bash). 관제 세션은 조종하지 않는다:
// atc CLI(node atcctl.mjs …)와 jq 외의 명령, 파일로 쓰는 리다이렉션을 막는다. 막으면 exit 2.
// `--gh-read`로 부르면(OCC) 팀 보고 확인용 읽기 전용 gh(`gh pr view|checks|diff|list`)도 허용한다.
// `--crosscheck`로 부르면(CROSSCHECK) atc CLI 중 읽기와 crosscheck 명령만 허용한다(쓰는 dispatch·schedule 명령은 막음).
// `--crosscheck --gh-read`면 gh는 PR 사실 확인용 `gh pr view|checks|list`만(코드를 읽지 않으므로 diff는 뺀다).
// `--review`로 부르면(REVIEW, 착륙 리뷰 세션 — ATC-27) atc CLI 중 manual과 landing queue·landing review만 허용한다(gh 없음).
// `--mcc`로 부르면(MCC, atc 자신의 PR 착륙 — docs/mcc.md) atc CLI 중 manual과 mcc 명령만 허용한다. `--mcc --gh-read`면 읽기 전용 gh pr view|checks|diff|list도.
// `--occ`로 부르면(OCC) `schedule charter-seen`(DUTY의 CHARTER REQUEST를 봤다고 기록, ATC-233)도 허용한다. 다른 모드(TOWER 포함)에서는 막는다(MCC 쓰기와 같은 방식).
// MCC 쓰기(mcc inspect·escalate·land·rts)는 MCC 세션에서만 된다: 다른 모드에서는 막고, MCC에서는 실제 모델(Claude)을 확인해 ATC_MCC_MODEL로 붙인다.
// `--crosscheck`에서 mark를 다는 명령(dispatch|schedule crosscheck)과 `--review`에서 착륙 리뷰를 남기는 명령
// (landing review … --verdict)은 그 세션의 실제 모델을 확인한다:
// hook 입력의 transcript_path(세션 자신의 기록)에서 마지막 assistant 메시지의 model을 읽어 그 모드의 허용 목록에 맞을 때만
// 통과시키고, 그 이름을 ATC_CROSSCHECK_MODEL(REVIEW는 ATC_REVIEW_MODEL)로 붙여(updatedInput) 기록에 실제 모델이 남게 한다.
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
// REVIEW 세션(착륙 리뷰, Claude Sonnet)이 쓸 수 있는 atcctl 하위 명령. 착륙 리뷰는 CROSSCHECK에서 옮겨 왔다(ATC-27)
const REVIEW_CMDS = new Set(["manual check", "manual ack", "landing queue", "landing review"]);
// MCC 세션이 쓸 수 있는 atcctl 하위 명령(docs/mcc.md). 쓰기 넷은 MCC 세션에서만
const MCC_WRITES = new Set(["inspect", "escalate", "land", "rts"]);
const MCC_CMDS = new Set(["manual check", "manual ack", "mcc queue", "mcc packet", ...[...MCC_WRITES].map((w) => `mcc ${w}`)]);

// CROSSCHECK로 쓸 수 있는 모델: Claude Opus(SUPERVISOR 결정 2026-09-29). OCC(Sonnet)와 다른 모델이 다시 본다.
// ocx로 돌리던 Muse·GPT-5.6 Terra는 끊었다(claude-ocx-… 이름은 막힌다)
export const CROSSCHECK_MODELS = /^claude-opus-/i;
// REVIEW로 쓸 수 있는 모델: Claude Sonnet(SUPERVISOR 결정 2026-09-29, 전에는 ocx의 DeepSeek V4.1 Flash, ATC-27).
// 팀 CAPTAIN(Opus)과 다른 모델이 리뷰한다
export const REVIEW_MODELS = /^claude-sonnet-/i;
// MCC로 쓸 수 있는 모델: Claude(SUPERVISOR 결정 2026-09-28). 서버 server/mcc.ts MCC_MODELS와 같다. ocx로 돌린 다른 모델(claude-ocx-…)은 아니다
export const MCC_MODELS = /^claude-(opus|sonnet|fable|haiku)\b/i;
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

// --verdict가 -- 앞에 있으면 기록(쓰기)
const writesReview = (words) => {
  const sep = words.indexOf("--");
  return (sep < 0 ? words : words.slice(0, sep)).some((w) => w === "--verdict" || w.startsWith("--verdict="));
};
// 모드별 기록 명령(실제 모델을 확인할 명령): CROSSCHECK는 mark, REVIEW는 착륙 리뷰 기록
const isMarkCommand = (words, cwd, mode = "crosscheck") =>
  words[0] === "node" &&
  words[1] &&
  resolve(cwd, words[1]) === ATCCTL &&
  (mode === "review"
    ? words[2] === "landing" && words[3] === "review" && writesReview(words)
    : mode === "mcc"
      ? words[2] === "mcc" && MCC_WRITES.has(words[3])
      : (words[2] === "dispatch" || words[2] === "schedule") && words[3] === "crosscheck");

const MODES = {
  crosscheck: { models: CROSSCHECK_MODELS, env: "ATC_CROSSCHECK_MODEL", who: "CROSSCHECK", what: "crosscheck 명령", switchTo: "crosscheck/ 폴더에서 Claude Opus로 여세요(설정 창 AGENTS → CONTROL의 LAUNCH)" },
  review: { models: REVIEW_MODELS, env: "ATC_REVIEW_MODEL", who: "착륙 리뷰(REVIEW)", what: "landing review 기록", switchTo: "review/ 폴더에서 Claude Sonnet으로 여세요(설정 창 AGENTS → CONTROL의 LAUNCH)" },
  mcc: { models: MCC_MODELS, env: "ATC_MCC_MODEL", who: "MCC", what: "mcc 쓰기", switchTo: "mcc/ 폴더에서 Claude 모델로 여세요(mcc/README.md의 명령)" },
};

// 기록 명령의 실제 모델 확인. 통과면 { command: 모델을 붙인 명령 }, 막으면 { reason }. 기록 명령이 아니면 { command } 그대로.
export function checkMarkModel(command, cwd, transcript, mode = "crosscheck") {
  const { models, env, who, what, switchTo: SWITCH_MODEL } = MODES[mode];
  const cmds = simpleCommands(command);
  if (!cmds.some((w) => isMarkCommand(w, cwd, mode))) return { command };
  if (cmds.length !== 1) return { reason: `${what}은 파이프·이어 쓰기 없이 단독으로 쓴다` };
  const sep = cmds[0].indexOf("--");
  const head = sep < 0 ? cmds[0] : cmds[0].slice(0, sep);
  if (head.some((w) => w === "--model" || w.startsWith("--model="))) return { reason: "모델 이름은 세션이 적지 않는다(guard가 실제 모델을 붙인다)" };
  if (transcript == null) return { reason: `세션 기록(transcript)을 읽지 못해 실제 모델을 확인할 수 없음 — ${SWITCH_MODEL}` };
  const model = lastModelOf(transcript);
  if (!model) return { reason: `세션 기록에 모델이 없어 확인할 수 없음 — ${SWITCH_MODEL}` };
  if (!models.test(model) || !MODEL_NAME.test(model)) return { reason: `이 세션의 실제 모델(${model})은 ${who}로 쓸 수 없음 — ${SWITCH_MODEL}` };
  return { command: `${env}='${model}' ${command.trimStart()}`, model };
}

// jq는 앞 명령의 출력(stdin)만 다듬는다. 파일·환경·모듈을 읽는 길을 모두 막는다:
// 파일 인자, -f·--rawfile·--slurpfile·-L·--args 같은 옵션(허용 목록 밖은 모두 막음),
// 필터 안의 env·$ENV(환경 변수)와 import·include(`{search: "/dir"}`로 아무 .json·.jq 파일이나 읽는다).
const JQ_SHORT = new Set("rcesnRjaSCM");
const JQ_LONG = new Set([
  "--raw-output", "--raw-output0", "--compact-output", "--exit-status", "--slurp", "--null-input", "--raw-input",
  "--join-output", "--ascii-output", "--sort-keys", "--color-output", "--monochrome-output", "--tab", "--seq",
  "--stream", "--stream-errors", "--unbuffered",
]);
const JQ_VALUES = { "--indent": 1, "--arg": 2, "--argjson": 2 }; // 뒤에 받는 값 개수
const JQ_FILTER_BANNED = /(^|[^\w$])(env|import|include|modulemeta|get_search_list)\b|\$ENV\b|\$__prog/;

// jq 한 명령(단어 배열)의 문제. 괜찮으면 null
export function checkJq(words) {
  const positional = [];
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (w === "--") {
      positional.push(...words.slice(i + 1));
      break;
    }
    if (w in JQ_VALUES) {
      if (i + JQ_VALUES[w] >= words.length) return `jq ${w} 뒤에 값이 모자람`;
      i += JQ_VALUES[w];
    } else if (w.startsWith("--")) {
      if (!JQ_LONG.has(w)) return `jq 옵션 ${w}는 쓸 수 없음`;
    } else if (w.startsWith("-") && w.length > 1) {
      const bad = [...w.slice(1)].find((ch) => !JQ_SHORT.has(ch));
      if (bad) return `jq 옵션 -${bad}는 쓸 수 없음`;
    } else positional.push(w);
  }
  if (positional.length > 1) return "jq에 파일을 주지 않는다 — 앞 명령의 출력(| jq '<필터>')만 읽는다";
  if (positional.length && JQ_FILTER_BANNED.test(positional[0])) return "jq 필터에서 env·$ENV·import·include는 쓸 수 없음";
  return null;
}

// gh의 --jq(-q)는 내장 jq(gojq)라 env·$ENV로 세션의 환경 변수를 읽는다. 같은 필터 검사를 한다.
// -q가 다른 짧은 옵션과 붙은 꼴(-cq)은 값 위치가 헷갈리므로 막는다.
export function checkGhJq(words) {
  for (let i = 3; i < words.length; i++) {
    const w = words[i];
    if (w === "--") break;
    let filter = null;
    if (w === "-q" || w === "--jq") filter = words[i + 1] ?? "";
    else if (w.startsWith("--jq=")) filter = w.slice(5);
    else if (/^-q./.test(w)) filter = w.slice(2);
    else if (/^-[^-]*q/.test(w)) return `gh 옵션 ${w}: -q는 따로 쓴다`;
    if (filter !== null && JQ_FILTER_BANNED.test(filter)) return "gh --jq 필터에서 env·$ENV·import·include는 쓸 수 없음";
  }
  return null;
}

export function check(command, cwd = HERE, { ghRead = false, crosscheck = false, review = false, mcc = false, occ = false } = {}) {
  if (typeof command !== "string" || !command.trim()) return "빈 명령";
  if (hasRedirect(command)) return "리다이렉션(>, <, heredoc)은 쓸 수 없음";
  if (hasExpansion(command)) return "명령 치환·변수 확장($(…), `…`, ${…}, $VAR)은 쓸 수 없음 — 문구는 작은따옴표로 감싼다";
  for (const [index, words] of simpleCommands(command).entries()) {
    const [cmd, script] = words;
    if (cmd === "jq") {
      // jq는 `node atcctl.mjs … | jq …`처럼 뒤에만 붙는다
      if (index === 0) return "jq는 명령 맨 앞에 쓰지 않는다 — `node … atcctl.mjs … | jq '<필터>'`처럼 뒤에 붙인다";
      const bad = checkJq(words);
      if (bad) return bad;
      continue;
    }
    const ghAllowed = crosscheck ? CROSSCHECK_GH_READ : GH_READ;
    if (ghRead && !review && cmd === "gh" && words[1] === "pr" && ghAllowed.has(words[2]) && !words.includes("--web")) {
      const bad = checkGhJq(words);
      if (bad) return bad;
      continue;
    }
    if (cmd === "node" && script && resolve(cwd, script) === ATCCTL) {
      if (review && !REVIEW_CMDS.has(words.slice(2, 4).join(" "))) return `착륙 리뷰 세션(REVIEW)이 쓸 수 없는 atc 명령: ${words.slice(2, 4).join(" ") || "(없음)"}`;
      if (mcc && !MCC_CMDS.has(words.slice(2, 4).join(" "))) return `MCC가 쓸 수 없는 atc 명령: ${words.slice(2, 4).join(" ") || "(없음)"}`;
      if (!occ && words[2] === "schedule" && words[3] === "charter-seen") return "schedule charter-seen은 OCC 세션(occ/ 폴더)만 쓴다";
      if (!mcc && words[2] === "mcc" && MCC_WRITES.has(words[3])) return `mcc ${words[3]}는 MCC 세션(mcc/ 폴더)만 쓴다`;
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
  const review = process.argv.includes("--review");
  const mcc = process.argv.includes("--mcc");
  const occ = process.argv.includes("--occ");
  const cwd = input.cwd || HERE;
  let reason = check(input.tool_input?.command, cwd, { ghRead, crosscheck, review, mcc, occ });
  let marked = null;
  const mode = review ? "review" : crosscheck ? "crosscheck" : mcc ? "mcc" : null;
  if (!reason && mode) {
    const cmds = simpleCommands(input.tool_input.command);
    if (cmds.some((w) => isMarkCommand(w, cwd, mode))) {
      marked = checkMarkModel(input.tool_input.command, cwd, readTranscriptTail(input.transcript_path), mode);
      if (marked.reason) {
        console.error(`${review ? "착륙 리뷰 기록" : mcc ? "MCC 쓰기" : "CROSSCHECK mark"} 차단 — ${marked.reason}.`);
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
    const allowed = mcc
      ? `atc CLI의 manual·mcc 명령과 jq${ghRead ? ", 읽기 전용 gh pr view·checks·diff·list" : ""}`
      : review
      ? "atc CLI의 manual·landing queue·landing review와 jq"
      : crosscheck
      ? `atc CLI의 읽기(manual·brief·flight)와 crosscheck 명령, jq${ghRead ? ", 읽기 전용 gh pr view·checks·list" : ""}`
      : ghRead ? "atc CLI(node atcctl.mjs …), jq, 읽기 전용 gh pr view·checks·diff·list" : "atc CLI(node atcctl.mjs …)와 jq";
    console.error(`관제 세션(TOWER·OCC·CROSSCHECK·REVIEW·MCC)은 조종하지 않습니다 — ${reason}. ${allowed}만 쓸 수 있습니다.`);
    process.exit(2);
  }
}

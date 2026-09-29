#!/usr/bin/env node
// MCC INSPECTOR 하위 에이전트의 PreToolUse hook (Bash, ATC-135). 읽기만 하는 두 명령만 통과시킨다:
//   atcctl mcc packet <PR>, gh pr diff <PR> --repo <atc 저장소> [--name-only]
// mcc inspect·land·rts·escalate와 나머지 전부를 막는다. 막으면 exit 2, hook 입력을 못 읽어도 막는다(fail-closed).
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { check } from "../controller/guard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = "chaehy5665/atc";
const ALLOWED = [/^node \.\.\/controller\/atcctl\.mjs mcc packet [1-9]\d*$/,new RegExp(String.raw`^gh pr diff [1-9]\d* --repo ${REPO}(?: --name-only)?$`)];

// 막을 이유, 통과면 null. MCC의 Bash guard(--mcc --gh-read)도 함께 통과해야 한다
export function checkInspector(command, cwd = HERE) {
  if (typeof command !== "string" || !command.trim()) return "명령이 없음";
  const base = check(command, cwd, { mcc: true, ghRead: true });
  if (base) return base;
  if (!ALLOWED.some((re) => re.test(command.trim()))) return "INSPECTOR는 mcc packet <PR>과 gh pr diff <PR> --repo …만 쓴다";
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {}
  const reason = input.tool_name === "Bash" ? checkInspector(input.tool_input?.command, input.cwd || HERE) : "hook 입력을 읽지 못함";
  if (reason) {
    console.error(`INSPECTOR 차단 — ${reason}. 기록·착륙·RTS·ESCALATE는 MCC 본 세션이 합니다.`);
    process.exit(2);
  }
}

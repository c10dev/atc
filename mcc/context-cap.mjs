#!/usr/bin/env node
// MCC 세션의 UserPromptSubmit hook (ATC-135). 세션 컨텍스트가 CAP을 넘으면 그 사실을 프롬프트에 붙여, MCC가 MCC LOG에 SUPERVISOR에게 STOP·LAUNCH를 청하게 한다.
// 컨텍스트 = 마지막 요청의 input + cache read + cache write. statusline 기록(fuel/)과 같은 값이지만 MCC는 상태 폴더를 읽지 못하므로 대화 기록에서 읽는다.
// 안내만 하고 막지 않는다(항상 exit 0). 스스로 재시작하지 않는다.
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const CAP = 150_000;
const TAIL = 512 * 1024;

// 순수: 대화 기록 줄들에서 마지막 요청의 컨텍스트 토큰, 없으면 null
export function contextTokensOf(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    let j;
    try {
      j = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (j?.type !== "assistant" || j.isSidechain === true) continue;
    const u = j.message?.usage;
    if (!u || typeof u !== "object") continue;
    const n = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    if (n > 0) return n;
  }
  return null;
}

// 순수: 붙일 안내, 아니면 null
export function capNotice(tokens, cap = CAP) {
  if (tokens === null || tokens <= cap) return null;
  const k = Math.round(tokens / 1000);
  return `[MCC CONTEXT CAP] 이 세션의 컨텍스트가 ${k}k 토큰으로 ${cap / 1000}k를 넘었다. 이번 바퀴를 마치고, MCC LOG에 "컨텍스트 ${k}k — SUPERVISOR는 이 세션을 STOP하고 LAUNCH해 주세요"를 적는다. 스스로 다시 시작하지 않고 바퀴는 계속 돈다.`;
}

function tailLines(path) {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, TAIL);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString("utf8").split("\n");
    return size > len ? lines.slice(1) : lines; // 잘린 첫 줄은 버린다
  } finally {
    closeSync(fd);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let raw = "";
    for await (const c of process.stdin) raw += c;
    const path = JSON.parse(raw)?.transcript_path;
    if (typeof path === "string" && path) {
      const notice = capNotice(contextTokensOf(tailLines(path)));
      if (notice) console.log(notice);
    }
  } catch {}
  process.exit(0);
}

#!/usr/bin/env node
// MCC 세션의 UserPromptSubmit hook (ATC-135). 세션 컨텍스트가 CAP을 넘으면 그 사실을 프롬프트에 붙인다. 어떻게 할지는 `mcc queue`의 recycle.mode가 정한다(ATC-166):
// on이면 atc가 안전한 순간에 이 세션을 스스로 STOP·LAUNCH하고, 아니면 MCC LOG에 CAP 초과만 적는다.
// 컨텍스트 = 마지막 요청의 input + cache read + cache write. statusline 기록(fuel/)과 같은 값이지만 MCC는 상태 폴더를 읽지 못하므로 대화 기록에서 읽는다.
// 안내만 하고 막지 않는다(항상 exit 0). 스스로 재시작하지 않는다.
// 안내는 한 세션에 한 번 붙이고, 그 뒤로는 지난 안내보다 STEP 더 커졌을 때만 다시 붙인다. 지난 안내는 대화 기록의 hook 출력 줄에서 읽는다(상태 파일 없음).
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const CAP = 150_000;
export const STEP = 50_000;
const TAIL = 512 * 1024;
const NOTICE_TAIL = 32 * 1024 * 1024; // 지난 안내를 찾는 범위. 50k 토큰은 대화 기록 약 0.4–0.6MB라 TAIL로는 모자란다
const NOTICE_RE = /^\[MCC CONTEXT CAP\] 이 세션의 컨텍스트가 (\d+)k 토큰으로/;

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

// 순수: 대화 기록 줄들에서 이 hook이 마지막으로 붙인 안내의 토큰(안내의 k × 1000), 없으면 null
export function lastNoticeTokensOf(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes("[MCC CONTEXT CAP]")) continue;
    let j;
    try {
      j = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (j?.type !== "attachment") continue; // 매뉴얼·프롬프트에 든 같은 글자는 안내가 아니다
    for (const text of [j.attachment?.stdout, j.attachment?.content]) {
      const m = typeof text === "string" ? NOTICE_RE.exec(text) : null;
      if (m) return Number(m[1]) * 1000;
    }
  }
  return null;
}

// 순수: 붙일 안내, 아니면 null. last는 이 세션의 지난 안내 토큰(없으면 null)
export function capNotice(tokens, last = null, cap = CAP) {
  if (tokens === null || tokens <= cap) return null;
  if (last !== null && tokens < last + STEP) return null;
  const k = Math.round(tokens / 1000);
  return `[MCC CONTEXT CAP] 이 세션의 컨텍스트가 ${k}k 토큰으로 ${cap / 1000}k를 넘었다. 이번 바퀴를 마치고 mcc queue의 recycle.mode를 본다. on이면 atc가 안전한 순간에 이 세션을 다시 시작하니 아무것도 하지 않는다. off·shadow면 MCC LOG에 "컨텍스트 ${k}k — CAP 초과"만 적는다. 어느 쪽이든 스스로 다시 시작하지 않고 바퀴는 계속 돈다.`;
}

function tailLines(path, max) {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, max);
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
      const tokens = contextTokensOf(tailLines(path, TAIL));
      // CAP을 넘었을 때만 더 넓게 읽어 지난 안내를 찾는다
      const notice = tokens !== null && tokens > CAP ? capNotice(tokens, lastNoticeTokensOf(tailLines(path, NOTICE_TAIL))) : null;
      if (notice) console.log(notice);
    }
  } catch {}
  process.exit(0);
}

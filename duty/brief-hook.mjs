#!/usr/bin/env node
// DUTY의 UserPromptSubmit hook(ATC-231, docs/duty.md 3.3). 턴이 시작할 때 `atcctl duty brief`와 같은 자료(GET /api/duty/brief)를 찍어 그 턴에 붙인다(D0: -p에서 hook의 stdout은 모델에 간다).
// fail-open: 서버가 내려갔거나 느리면(5초) "brief unavailable: <이유>" 한 줄을 찍고 0으로 끝낸다. 턴은 그대로 돈다. 이것은 guard가 아니다: PreToolUse guard는 fail-closed 그대로다.
// 이 글은 stream-json에서 hook 이벤트로만 오고 서랍·duty.jsonl에는 들어가지 않는다(파서가 hook 줄을 무시한다).
import { pathToFileURL } from "node:url";
import { atcBase } from "../controller/squelch.mjs";

export const TIMEOUT_MS = 5000;

// 찍을 글 한 덩어리. 절대 던지지 않는다
export async function briefHookText({ fetchImpl = fetch, base = atcBase(), timeoutMs = TIMEOUT_MS } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${base}/api/duty/brief`, { signal: ctl.signal });
    if (res.status !== 200) return `brief unavailable: HTTP ${res.status}`;
    const j = await res.json();
    if (!j || typeof j.text !== "string" || !j.text.trim()) return "brief unavailable: empty brief";
    return j.text;
  } catch (e) {
    const why = ctl.signal.aborted ? `no answer in ${Math.round(timeoutMs / 1000)}s` : String(e?.cause?.code ?? e?.message ?? e);
    return `brief unavailable: ${why}`;
  } finally {
    clearTimeout(timer);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.stdin.resume(); // hook 입력(JSON)은 읽지 않는다. 닫히게 비운다
    process.stdin.on("data", () => {});
    console.log(await briefHookText());
  } catch (e) {
    console.log(`brief unavailable: ${String(e?.message ?? e)}`);
  }
  process.exit(0);
}

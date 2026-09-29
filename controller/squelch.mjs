#!/usr/bin/env node
// SQUELCH hook(docs/squelch.md 5장): 관제 세션의 `UserPromptSubmit` hook. `/loop`가 넣은 평범한 `/tick`이 모델에 닿기 전에 atc에 물어,
// 서버가 명시적으로 `open: false`(QUIET)라고 답할 때만 그 프롬프트를 버린다. 그 밖의 모든 경우(다른 프롬프트, 오류, 시간 초과)는 통과시킨다.
//
// 이 파일은 guard가 아니다(fail-closed의 반대다). 이름에 guard를 넣지 않았고, 절대 `exit 2`나 `|| exit 2`로 부르지 않는다(설계 원칙 2).
// 출력은 숫자·역할·시각만 담는다. 차단 사유는 창과 `claude logs`에 블록마다 찍히므로 짧게 둔다.
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ROLES = ["tower", "mcc", "occ", "crosscheck", "review"];
export const TIMEOUT_MS = 3000; // hook timeout 5초 안

// atcctl과 같은 곳에서 읽는다
export const atcBase = () => process.env.ATC_URL || "http://127.0.0.1:7700";

// 평범한 `/tick`만 건다. 앞뒤 공백은 봐 주고, 인자가 붙은 `/tick now`나 `/loop …`, 팀 메시지는 건드리지 않는다
export const isPlainTick = (prompt) => typeof prompt === "string" && prompt.trim() === "/tick";

const hhmm = (iso) => {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString().slice(11, 16) : null;
};
const count = (n) => (Number.isInteger(n) && n >= 0 ? n : 0);

// "QUIET since 03:03 (4)" — 시각(UTC)과 그동안 버린 tick 수만
export const quietText = (r) => `QUIET${hhmm(r?.quietSince) ? ` since ${hhmm(r.quietSince)}` : ""} (${count(r?.quietCount)})`;

// 서버 답이 명시적 QUIET(`open === false`)일 때만 true. undefined·null·"false"·0 같은 것은 모두 통과
export const isQuiet = (r) => Boolean(r) && typeof r === "object" && r.open === false;

// hook이 차단할 때 찍는 JSON 한 줄
export const blockOutput = (r) => JSON.stringify({ decision: "block", reason: `SQUELCH ${quietText(r).replace(/ since (\d\d:\d\d)/, " since $1Z")}` });

// POST /api/squelch/<role>. 성공한 200의 JSON만 돌려주고, 그 밖에는 던진다(부르는 쪽이 통과로 바꾼다)
export async function askSquelch(role, { fetchImpl = fetch, base = atcBase(), timeoutMs = TIMEOUT_MS } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${base}/api/squelch/${encodeURIComponent(role)}`, { method: "POST", signal: ctl.signal });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || typeof data !== "object") throw new Error("bad response");
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// hook 한 번. 차단할 때만 JSON 문자열을, 아니면 null(출력 없음)을 돌려준다. 던지지 않는다
export async function hookDecision(stdin, role, deps = {}) {
  try {
    if (!ROLES.includes(role)) return null;
    const input = JSON.parse(stdin);
    if (!isPlainTick(input?.prompt)) return null;
    const r = await askSquelch(role, deps);
    return isQuiet(r) ? blockOutput(r) : null;
  } catch {
    return null;
  }
}

// `atcctl squelch <role>`의 출력. QUIET이면 `QUIET since HH:MM (n)`, 아니면 `OPEN <reason>`. 서버 오류는 hook과 같이 OPEN fail-open
export async function squelchLine(role, deps = {}) {
  try {
    const r = await askSquelch(role, deps);
    if (isQuiet(r)) return quietText(r);
    const reason = typeof r.reason === "string" && /^[\w:-]{1,40}$/.test(r.reason) ? r.reason : "open";
    const err = typeof r.error === "string" && r.error ? ` (${r.error.slice(0, 120)})` : "";
    return `OPEN ${reason}${err}`;
  } catch (e) {
    return `OPEN fail-open (${String(e?.name === "AbortError" ? "timeout" : (e?.message ?? e)).slice(0, 120)})`;
  }
}

async function main() {
  try {
    let stdin = "";
    try {
      stdin = readFileSync(0, "utf8");
    } catch {}
    const out = await hookDecision(stdin, process.argv[2] ?? "");
    if (out) return process.stdout.write(`${out}\n`, () => process.exit(0)); // 파이프로 다 나간 뒤 끝낸다
  } catch {}
  process.exit(0);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

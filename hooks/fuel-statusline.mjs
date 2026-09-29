#!/usr/bin/env node
// Claude Code statusLine 명령(ATC-55, docs/fuel.md 6): 입력의 rate_limits를 fuel/<sessionId>.jsonl에 한 줄로 남기고,
// 상태 줄에 짧은 글(FUEL 5h 82% · 7d 40%)을 출력한다. 숫자와 모델 id만 둔다 — 계정 정보·본문·경로는 두지 않는다.
//   입력(Claude Code 2.1.283·2.1.284): rate_limits.{five_hour,seven_day,spend_limit} = {used_percentage: 0–100, resets_at: epoch 초},
//     context_window.context_window_size(200000·1000000), model.id
//   기록(ATC-85): {t, sessionId, rate_limits?, context_window_size?, model?}. 입력에 있는 값만 담고, 셋 중 하나도 없으면 줄이 없다.
//   앞 기록과 담긴 값이 모두 같으면 덧붙이지 않는다(rate_limits가 없는 기록도 남긴다). 옛 줄(rate_limits만)도 읽는다.
// 실패는 조용히 삼키고 항상 exit 0(세션을 막지 않는다). --quiet면 아무것도 출력하지 않는다.
import { appendFileSync, closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SESSION_RE = /^[\w-]{1,128}$/;
export const WINDOWS = ["five_hour", "seven_day", "spend_limit"];
const SHORT = { five_hour: "5h", seven_day: "7d", spend_limit: "spend" };

const stateDir = () => process.env.ATC_STATE_DIR || join(homedir(), ".local/state/atc");
export const fuelFile = (dir, sessionId) => join(dir, "fuel", `${sessionId}.jsonl`);

// 창 하나: 유한한 숫자만(백분율 0–100, reset은 양의 epoch 초). 아니면 null
function windowOf(w) {
  const pct = w?.used_percentage;
  const reset = w?.resets_at;
  if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  if (typeof reset !== "number" || !Number.isFinite(reset) || reset <= 0) return null;
  return { used_percentage: Math.round(pct * 10) / 10, resets_at: Math.round(reset) };
}

// rate_limits → 숫자만 남긴 것. 창이 하나도 없으면 null (순수)
export function limitsOf(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  for (const k of WINDOWS) {
    const w = windowOf(raw[k]);
    if (w) out[k] = w;
  }
  return Object.keys(out).length ? out : null;
}

// context_window_size: 양의 정수(창 크기, 토큰). 아니면 null
const sizeOf = (n) => (Number.isInteger(n) && n >= 1000 && n <= 10_000_000 ? n : null);

// model.id: claude-opus-5-5, claude-sonnet-5-5[1m] 같은 id 글자만. 아니면 null
const MODEL_RE = /^[A-Za-z0-9][\w.:/-]{0,79}(\[[0-9]{1,4}[km]\])?$/i;
const modelOf = (v) => (typeof v === "string" && MODEL_RE.test(v) ? v : null);

// 담을 값(rate_limits·context_window_size·model 중 있는 것)만 모은다. 하나도 없으면 null (순수)
const valuesOf = (rate_limits, context_window_size, model) =>
  rate_limits || context_window_size || model
    ? { ...(rate_limits ? { rate_limits } : {}), ...(context_window_size ? { context_window_size } : {}), ...(model ? { model } : {}) }
    : null;

// statusline 입력 하나 → 기록 한 줄. 남길 것이 없으면 null (순수)
export function recordOf(input, now = Date.now()) {
  const sessionId = input?.session_id;
  if (typeof sessionId !== "string" || !SESSION_RE.test(sessionId)) return null;
  const v = valuesOf(limitsOf(input.rate_limits), sizeOf(input.context_window?.context_window_size), modelOf(input.model?.id));
  return v ? { t: new Date(now).toISOString(), sessionId, ...v } : null;
}

// 기록 한 줄을 읽는다. 모양이 틀리면 null (순수). 서버도 이것으로 읽는다
export function parseRecord(line) {
  let r;
  try {
    r = JSON.parse(line);
  } catch {
    return null;
  }
  if (!r || typeof r !== "object" || typeof r.t !== "string" || !Number.isFinite(Date.parse(r.t))) return null;
  if (typeof r.sessionId !== "string" || !SESSION_RE.test(r.sessionId)) return null;
  const v = valuesOf(limitsOf(r.rate_limits), sizeOf(r.context_window_size), modelOf(r.model));
  return v ? { t: r.t, sessionId: r.sessionId, ...v } : null;
}

// 파일 끝의 마지막 기록 (순수)
export function lastRecord(text) {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    const r = parseRecord(lines[i]);
    if (r) return r;
  }
  return null;
}

// 파일 끝에서 key 값이 있는 마지막 기록 (순수). FUEL REMAINING은 rate_limits, 창 크기는 context_window_size가 있는 줄
export function lastRecordWith(text, key) {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    const r = parseRecord(lines[i]);
    if (r && r[key] !== undefined) return r;
  }
  return null;
}

export const sameLimits = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 새 기록이 앞 기록과 다른가: 새 기록에 담긴 값 중 앞 기록에 없거나 다른 것이 하나라도 있으면 (순수)
export const changed = (prev, rec) => !prev || ["rate_limits", "context_window_size", "model"].some((k) => rec[k] !== undefined && !sameLimits(prev[k], rec[k]));

// 상태 줄 글: FUEL 5h 82% · 7d 40%. rate_limits가 없으면 빈 글 (순수)
export const lineOf = (rec) => (rec.rate_limits ? `FUEL ${WINDOWS.filter((k) => rec.rate_limits[k]).map((k) => `${SHORT[k]} ${Math.round(rec.rate_limits[k].used_percentage)}%`).join(" · ")}` : "");

// 파일 끝 8KB만 읽는다
export function readTail(path, bytes = 8192) {
  let fd;
  try {
    fd = openSync(path, "r");
  } catch {
    return "";
  }
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const text = buf.toString("utf8");
    return len < size ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    closeSync(fd);
  }
}

// stdin 입력 하나를 처리한다. 담은 값이 바뀌었을 때만 한 줄을 덧붙이고, 출력할 글을 돌려준다
export function run(input, { dir = stateDir(), now = Date.now() } = {}) {
  const rec = recordOf(input, now);
  if (!rec) return { line: "", written: false };
  const file = fuelFile(dir, rec.sessionId);
  const prev = lastRecord(readTail(file));
  const written = changed(prev, rec);
  if (written) {
    mkdirSync(join(dir, "fuel"), { recursive: true });
    appendFileSync(file, JSON.stringify(rec) + "\n");
  }
  return { line: lineOf(rec), written };
}

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  try {
    const { line } = run(JSON.parse(readFileSync(0, "utf8")));
    if (line && !process.argv.includes("--quiet")) process.stdout.write(line + "\n");
  } catch {}
  process.exit(0);
}

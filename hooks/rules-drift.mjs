#!/usr/bin/env node
// Claude Code hook(ATC-42). 규칙 파일(기본 CLAUDE.md·AGENTS.md)이 세션 시작 뒤 바뀌면, 돌고 있는 세션에 다음 턴에 diff를 준다.
//   start (SessionStart)                  세션의 기준 해시를 적는다. resume이면 기록을 그대로 둔다
//   check (UserPromptSubmit·PostToolUse)  바뀌었으면 hookSpecificOutput.additionalContext로 diff를 주고 확인 해시를 갱신한다
// 옵션: --root <저장소>(기본 $CLAUDE_PROJECT_DIR, 없으면 cwd) --ref <git ref>(주면 그 ref의 파일을 본다, 예: origin/main.
//       ref에 없는 파일은 작업 트리에서 읽는다 — vocado CLAUDE.md는 git에서 빠져 있다)
//       --files CLAUDE.md,AGENTS.md
// 감시 파일 말고는 읽지 않는다(대화 기록 transcript_path도 읽지 않는다). 네트워크 없음.
// 오류가 나면 아무것도 출력하지 않고 exit 0 — 도구 호출·프롬프트를 막지 않는다.
// 상태: ~/.local/state/atc/rules-ack/<sessionId>.json, diff용 내용은 rules-ack/blobs/<sha256>
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_FILES = ["CLAUDE.md", "AGENTS.md"];
export const MAX_DIFF_LINES = 150; // 넘으면 자르고 파일을 다시 읽으라고 한다
const MAX_DIFF_CELLS = 4_000_000; // 줄 수 곱이 이보다 크면 diff를 만들지 않는다(느려짐)
const CONTEXT = 3;
export const CHECK_EVERY_MS = 30_000; // PostToolUse는 이 간격 안에서는 다시 보지 않는다(빠르게)
export const STALE_MS = 7 * 86_400_000; // 이만큼 확인이 없던 세션 기록은 지운다
const SESSION_RE = /^[\w-]{1,128}$/;

const stateDir = () => join(process.env.ATC_STATE_DIR || join(homedir(), ".local/state/atc"), "rules-ack");

// ---- 인자 ----
export function parseArgs(argv) {
  const out = { mode: argv[0], root: null, ref: null, files: DEFAULT_FILES };
  for (let i = 1; i < argv.length; i++) {
    const v = argv[i + 1];
    if (argv[i] === "--root" && v) (out.root = v), i++;
    else if (argv[i] === "--ref" && v) (out.ref = v), i++;
    else if (argv[i] === "--files" && v) (out.files = v.split(",").map((f) => f.trim()).filter(Boolean)), i++;
  }
  // 저장소 밖 경로나 절대 경로는 감시하지 않는다
  out.files = out.files.filter((f) => !isAbsolute(f) && !normalize(f).startsWith(".."));
  return out;
}

// ---- 읽기 ----
export const sha = (text) => (text === null ? null : createHash("sha256").update(text).digest("hex"));

// 감시 파일의 지금 내용. 없으면 null(없는 것도 한 상태로 본다).
// ref가 있으면 그 ref의 파일, ref에 없으면(git에서 빠진 파일) 작업 트리의 파일
export function readSource(root, ref, file) {
  if (ref) {
    try {
      return execFileSync("git", ["-C", root, "show", `${ref}:${file}`], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] });
    } catch {}
  }
  try {
    return readFileSync(join(root, file), "utf8");
  } catch {
    return null;
  }
}

// ---- diff (의존성 없는 줄 단위 LCS, unified) ----
export function unifiedDiff(oldText, newText, file, max = MAX_DIFF_LINES) {
  const a = oldText === null ? [] : oldText.replace(/\n$/, "").split("\n");
  const b = newText === null ? [] : newText.replace(/\n$/, "").split("\n");
  if (a.length * b.length > MAX_DIFF_CELLS) return { text: null, truncated: true };
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const ops = []; // [kind, text, aLine, bLine]
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) ops.push([" ", a[i], i++, j++]);
    else if (i < n && (j === m || lcs[i + 1][j] >= lcs[i][j + 1])) ops.push(["-", a[i], i++, j]); // git처럼 지운 줄을 먼저
    else ops.push(["+", b[j], i, j++]);
  }
  const hunks = [];
  for (let k = 0; k < ops.length; k++) {
    if (ops[k][0] === " ") continue;
    let start = Math.max(0, k - CONTEXT);
    let end = k;
    // 바뀐 줄끼리 문맥 2배 안이면 한 hunk로
    for (let x = k; x < ops.length; x++) {
      if (ops[x][0] !== " ") end = x;
      else if (x - end > CONTEXT * 2) break;
    }
    end = Math.min(ops.length - 1, end + CONTEXT);
    if (hunks.length && start <= hunks[hunks.length - 1].end + 1) hunks[hunks.length - 1].end = end;
    else hunks.push({ start, end });
    k = end;
  }
  const lines = [`--- a/${file}`, `+++ b/${file}`];
  for (const h of hunks) {
    const seg = ops.slice(h.start, h.end + 1);
    const aStart = seg[0][2] + 1;
    const bStart = seg[0][3] + 1;
    const aLen = seg.filter((o) => o[0] !== "+").length;
    const bLen = seg.filter((o) => o[0] !== "-").length;
    lines.push(`@@ -${aLen ? aStart : aStart - 1},${aLen} +${bLen ? bStart : bStart - 1},${bLen} @@`);
    for (const o of seg) lines.push(`${o[0]}${o[1]}`);
  }
  if (lines.length > max) return { text: lines.slice(0, max).join("\n"), truncated: true };
  return { text: lines.join("\n"), truncated: false };
}

// ---- 바뀐 것 알림 문구 ----
// changes: [{file, before, after}] (내용, before가 null이면 모름·없던 파일)
export function contextOf(changes, root, max = MAX_DIFF_LINES) {
  const out = [`[atc rules-drift] 이 세션이 시작된 뒤 규칙 파일이 바뀌었다: ${changes.map((c) => c.file).join(", ")}. 아래 바뀐 부분을 지금부터 따른다.`];
  let budget = max;
  for (const c of changes) {
    const path = join(root, c.file);
    if (c.after === null) {
      out.push(`- ${c.file}: 파일이 없어졌다(${path}).`);
      continue;
    }
    if (c.before === undefined) {
      out.push(`- ${c.file}: 이전 내용을 몰라 diff가 없다. ${path}를 Read로 다시 읽는다.`);
      continue;
    }
    const d = budget > 2 ? unifiedDiff(c.before, c.after, c.file, budget) : { text: null, truncated: true };
    if (d.text) {
      out.push(d.text);
      budget -= d.text.split("\n").length;
    }
    if (d.truncated) out.push(`- ${c.file}: diff가 길어 ${d.text ? "잘랐다" : "싣지 않았다"}. ${path}를 Read로 다시 읽는다.`);
  }
  return out.join("\n");
}

// ---- 상태 ----
const recordPath = (dir, sessionId) => join(dir, `${sessionId}.json`);
const blobPath = (dir, h) => join(dir, "blobs", h);

export function readRecord(dir, sessionId) {
  try {
    const r = JSON.parse(readFileSync(recordPath(dir, sessionId), "utf8"));
    return r && typeof r === "object" && r.acked && typeof r.acked === "object" ? r : null;
  } catch {
    return null; // 없거나 깨짐 → 새로 시작
  }
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

function saveBlob(dir, text) {
  if (text === null) return;
  const h = sha(text);
  const p = blobPath(dir, h);
  try {
    statSync(p);
  } catch {
    mkdirSync(join(dir, "blobs"), { recursive: true });
    writeAtomic(p, text);
  }
}

function readBlob(dir, h) {
  if (!h) return null;
  try {
    return readFileSync(blobPath(dir, h), "utf8");
  } catch {
    return undefined; // 이전 내용을 모름
  }
}

function writeRecord(dir, rec) {
  mkdirSync(dir, { recursive: true });
  writeAtomic(recordPath(dir, rec.sessionId), JSON.stringify(rec) + "\n");
}

// 오래된 세션 기록과, 어느 기록도 가리키지 않는 내용을 지운다
export function cleanup(dir, now = Date.now()) {
  const keep = new Set();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (now - Date.parse(r.checkedAt) > STALE_MS) rmSync(join(dir, f), { force: true });
      else for (const h of Object.values(r.acked ?? {})) if (h) keep.add(h);
    } catch {
      rmSync(join(dir, f), { force: true });
    }
  }
  try {
    for (const h of readdirSync(join(dir, "blobs"))) if (!keep.has(h) && !h.endsWith(".tmp")) rmSync(join(dir, "blobs", h), { force: true });
  } catch {}
}

// ---- 한 번 실행: 출력할 문자열(없으면 null) ----
export function run(args, input, { dir = stateDir(), now = Date.now(), env = process.env } = {}) {
  const sessionId = input?.session_id;
  if (!sessionId || !SESSION_RE.test(sessionId)) return null;
  const root = args.root || env.CLAUDE_PROJECT_DIR || input.cwd;
  if (!root || !args.files.length) return null;
  const at = new Date(now).toISOString();
  const current = Object.fromEntries(args.files.map((f) => [f, readSource(root, args.ref, f)]));
  const baseline = () => ({ v: 1, sessionId, root, ref: args.ref, files: args.files, startedAt: at, checkedAt: at, acked: Object.fromEntries(args.files.map((f) => [f, sha(current[f])])) });

  if (args.mode === "start") {
    const prev = readRecord(dir, sessionId);
    // resume은 같은 대화를 잇는다 — 이미 받은 규칙 기준을 그대로 둔다. startup·clear·compact는 규칙을 새로 읽는다
    if (!(input.source === "resume" && prev)) {
      for (const f of args.files) saveBlob(dir, current[f]);
      writeRecord(dir, baseline());
    }
    cleanup(dir, now);
    return null;
  }
  if (args.mode !== "check") return null;

  const rec = readRecord(dir, sessionId);
  if (!rec || rec.root !== root || (rec.ref ?? null) !== (args.ref ?? null)) {
    // start 없이 처음 본 세션(도중에 hook을 넣음), 설정이 바뀐 세션: 지금을 기준으로 시작하고 말하지 않는다
    for (const f of args.files) saveBlob(dir, current[f]);
    writeRecord(dir, baseline());
    return null;
  }
  if (input.hook_event_name === "PostToolUse" && now - Date.parse(rec.checkedAt) < CHECK_EVERY_MS) return null;
  const changes = args.files
    .filter((f) => f in rec.acked && rec.acked[f] !== sha(current[f]))
    .map((f) => ({ file: f, before: readBlob(dir, rec.acked[f]), after: current[f] }));
  const acked = { ...rec.acked };
  for (const f of args.files) {
    if (!(f in acked)) {
      acked[f] = sha(current[f]); // 목록에 새로 든 파일은 지금부터(다음 diff를 위해 내용도 둔다)
      saveBlob(dir, current[f]);
    }
    for (const c of changes) if (c.file === f) acked[f] = sha(current[f]);
  }
  for (const c of changes) saveBlob(dir, c.after);
  writeRecord(dir, { ...rec, files: args.files, checkedAt: at, acked, ...(changes.length ? { changedAt: at } : {}) });
  if (!changes.length) return null;
  return JSON.stringify({ hookSpecificOutput: { hookEventName: input.hook_event_name || "UserPromptSubmit", additionalContext: contextOf(changes, root) } });
}

// ---- 서버(FLEET 카드)가 쓰는 상태 판정 ----
// 세션 기록마다 지금 내용과 확인한 해시를 비교한다. behind면 바뀐 파일 목록
export function statusOf(rec, read = readSource) {
  const behind = [];
  for (const f of rec.files ?? Object.keys(rec.acked ?? {})) {
    const now = sha(read(rec.root, rec.ref ?? null, f));
    if ((rec.acked ?? {})[f] !== now) behind.push(f);
  }
  return { current: behind.length === 0, behind };
}

export function readRecords(dir = stateDir()) {
  const out = [];
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
        if (r && r.sessionId && r.root && r.acked) out.push(r);
      } catch {}
    }
  } catch {}
  return out;
}

const isMain = (() => {
  try {
    return process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const input = JSON.parse(readFileSync(0, "utf8"));
    const out = run(args, input);
    if (out) process.stdout.write(out);
  } catch {}
  process.exit(0);
}

#!/usr/bin/env node
// MCC RETURN TO SERVICE(docs/mcc.md 6장). atc-rts.service(oneshot)가 atc 서비스 밖에서 돌린다:
// 서비스가 자기 자신을 재시작하면 그 일을 끝까지 볼 수 없으므로. 서버는 `systemctl --user start --no-block atc-rts`만 한다.
// 순서: 잠금 → 본 체크아웃 확인(main, 깨끗함, fast-forward만) → 대상 = origin/main, CI check 통과 →
// 의존성·유닛이 바뀌면 거절(사용자 몫) → ff merge·재시작 → 상태 확인 → 실패면 ROLLBACK(직전 커밋으로 reset·재시작).
// 재시작 뒤 세션 점검(ATC-102): 재시작 전 살아 있던 background 세션이 그대로고, daemon이 서비스 밖이고, /api/control/sessions가 답해야 한다.
// 시도마다 rts.jsonl에 한 줄(추가만). 서버는 마지막 줄로 진행 중·ROLLBACK 뒤 멈춤을 안다.
// 의존성 없음. 순수 계산은 export해 테스트하고, 입출력은 직접 실행할 때만 한다.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, openSync, closeSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 이 범위가 바꾸면 RTS가 하지 않는 것: npm ci가 필요한 의존성, daemon-reload가 필요한 유닛
const NEEDS_USER = [
  [/^package(-lock)?\.json$/, "의존성(npm ci 필요)"],
  [/^deploy\/[^/]+\.(service|timer)$/, "systemd 유닛(daemon-reload 필요)"],
];

// RTS를 할지. 입력은 모두 읽어 온 사실. { action: "go" | "noop" | "refuse", reason }
// service: 도는 서비스가 알리는 커밋(/api/version head, 모르면 null). 체크아웃은 대상인데 서비스가 아니면(지난 재시작 실패) 재시작만 한다
export function planRts({ branch, dirty, head, service, target, ancestor, ci, files }) {
  if (branch !== "main") return { action: "refuse", reason: `본 체크아웃이 main이 아님(${branch})` };
  if (dirty) return { action: "refuse", reason: "본 체크아웃에 커밋하지 않은 변경이 있음" };
  if (!target) return { action: "refuse", reason: "origin/main을 읽지 못함" };
  if (head === target && service === target) return { action: "noop", reason: "서비스가 이미 origin/main" };
  if (head === target) return { action: "go", reason: `재시작만 — 서비스가 ${service ? service.slice(0, 7) : "모르는 커밋"}` };
  if (!ancestor) return { action: "refuse", reason: "fast-forward가 아님(본 체크아웃이 origin/main에서 갈라짐)" };
  if (ci !== "ok") return { action: "refuse", reason: `origin/main CI check ${ci === "none" ? "없음" : ci === "pending" ? "진행 중" : "실패"}` };
  const user = [];
  for (const f of files) for (const [re, why] of NEEDS_USER) if (re.test(f)) user.push(`${f}(${why})`);
  if (user.length) return { action: "refuse", reason: `사용자가 배포: ${user.join(", ")}` };
  return { action: "go", reason: `${head.slice(0, 7)} → ${target.slice(0, 7)}` };
}

// 새 서비스가 떴나: /api/version의 head가 대상이고, 재시작 뒤에 시작했다
export const healthyVersion = (v, target, since) =>
  Boolean(v && typeof v.head === "string" && v.head === target && typeof v.startedAt === "string" && Date.parse(v.startedAt) >= since);

// check run 목록(최근 것부터 볼 필요 없이 마지막 시작 것) → ok | pending | failed | none
export function ciOf(runs) {
  const sorted = [...runs].sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""));
  const r = sorted[0];
  if (!r) return "none";
  if (r.status !== "completed") return "pending";
  return ["success", "neutral", "skipped"].includes(r.conclusion) ? "ok" : "failed";
}

// ── 세션 점검(ATC-102) ──
// 배포가 이 기계의 백그라운드 세션(관제·팀)을 함께 죽이면 안 된다. 재시작 전 살아 있는 세션을 적어 두고, 뒤에 그대로인지 본다.
// 읽기만 한다: 세션을 멈추거나 다시 띄우거나 메시지를 보내지 않는다. ROLLBACK도 죽은 세션은 살리지 않는다

// `claude agents --json` 줄 → 살아 있는 background 세션 { id, name, kind, pid }. pid·status 없는 줄(유령, ATC-93)은 뺀다
export function snapshotOf(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && r.kind === "background" && typeof r.id === "string" && (r.pid != null || r.status != null))
    .map((r) => ({ id: r.id, name: r.name ?? null, kind: r.kind, pid: r.pid ?? null }));
}

// 재시작 전(before)과 뒤(after) 스냅샷 → 사라진 세션. 같은 id가 살아 있으면 산 것(pid가 바뀌어도 job이 돌면 산 것)
export const diedOf = (before, after) => before.filter((b) => !after.some((a) => a.id === b.id)).map(({ id, name }) => ({ id, name }));

// 재시작 뒤 세 점검. after: 뒤 스냅샷(못 읽으면 null), control: /api/control/sessions 응답(못 받으면 null)
// → { ok, failures: [{ check, sessions?, note? }], detail }. 세션 비교는 before가 null(재시작 전에 못 읽음)이면 건너뛴다
export function checkSessions({ before, after, control }) {
  const failures = [];
  if (before && before.length) {
    if (!after) failures.push({ check: "sessions", sessions: before.map(({ id, name }) => ({ id, name })), note: "claude agents를 읽지 못함" });
    else {
      const died = diedOf(before, after);
      if (died.length) failures.push({ check: "sessions", sessions: died });
    }
  }
  if (!control) failures.push({ check: "control-sessions", note: "/api/control/sessions가 답하지 않음" });
  else if (control.daemonInService === true) failures.push({ check: "daemon-in-service", note: "Claude daemon이 atc.service cgroup 안에 있음" });
  const detail = failures
    .map((f) => (f.sessions ? `${f.check}: ${f.sessions.map((s) => s.name ?? s.id).join(", ")} 죽음${f.note ? ` (${f.note})` : ""}` : `${f.check}: ${f.note}`))
    .join("; ");
  return { ok: failures.length === 0, failures, detail };
}

// ── 실행(직접 부를 때만) ──
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const STATE = process.env.ATC_STATE_DIR || join(homedir(), ".local/state/atc");
const PORT = process.env.ATC_PORT || "7700";
const LOG = join(STATE, "rts.jsonl");
const LOCK = join(STATE, "rts.lock");
const HEALTH_MS = 90_000;
const SESSIONS_MS = 30_000; // 버전 확인 뒤 세션 점검에 더 주는 시간
const CLAUDE = process.env.ATC_CLAUDE_BIN || join(homedir(), ".local/bin/claude");

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: REPO, encoding: "utf8", timeout: 120_000, ...opts }).trim();
const git = (...args) => sh("git", args);
const log = (line) => {
  mkdirSync(STATE, { recursive: true });
  appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`);
  console.log(`[rts] ${line.result}${line.detail ? ` — ${line.detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function health(target, since) {
  const end = Date.now() + HEALTH_MS;
  while (Date.now() < end) {
    await sleep(3000);
    try {
      const v = await (await fetch(`http://127.0.0.1:${PORT}/api/version`, { signal: AbortSignal.timeout(5000) })).json();
      if (!healthyVersion(v, target, since)) continue;
      const snap = await fetch(`http://127.0.0.1:${PORT}/api/snapshot`, { signal: AbortSignal.timeout(20_000) });
      if (snap.ok) return true;
    } catch {}
  }
  return false;
}

// 살아 있는 background 세션(읽기만). 못 읽으면 null
function liveSessions() {
  try {
    return snapshotOf(JSON.parse(sh(CLAUDE, ["agents", "--json"], { timeout: 30_000 })));
  } catch {
    return null;
  }
}

async function controlSessions() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/control/sessions`, { signal: AbortSignal.timeout(10_000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

// 버전 확인 뒤 세션 점검: 통과하거나 SESSIONS_MS가 지날 때까지 다시 본다. 마지막 결과를 돌려준다
async function sessionsHealth(before) {
  const end = Date.now() + SESSIONS_MS;
  for (;;) {
    const r = checkSessions({ before, after: before ? liveSessions() : null, control: await controlSessions() });
    if (r.ok || Date.now() >= end) return r;
    await sleep(3000);
  }
}

function slugOf() {
  const url = git("remote", "get-url", "origin");
  return /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(url)?.[1] ?? null;
}

async function main() {
  mkdirSync(STATE, { recursive: true });
  // 잠금: 10분 넘은 잠금은 죽은 것으로 본다
  try {
    if (Date.now() - statSync(LOCK).mtimeMs > 10 * 60_000) rmSync(LOCK);
  } catch {}
  let fd;
  try {
    fd = openSync(LOCK, "wx");
  } catch {
    console.log("[rts] 다른 RTS가 도는 중 — 끝");
    return;
  }
  let from = null;
  let target = null;
  try {
    const branch = git("rev-parse", "--abbrev-ref", "HEAD");
    const dirty = git("status", "--porcelain", "--untracked-files=no") !== "";
    from = git("rev-parse", "HEAD");
    git("fetch", "-q", "origin");
    target = git("rev-parse", "origin/main");
    let ancestor = false;
    try {
      git("merge-base", "--is-ancestor", from, target);
      ancestor = true;
    } catch {}
    const slug = slugOf();
    const runs = slug ? JSON.parse(sh("gh", ["api", `repos/${slug}/commits/${target}/check-runs?check_name=check&per_page=20`, "--jq", ".check_runs"])) : [];
    const files = ancestor ? git("diff", "--name-only", from, target).split("\n").filter(Boolean) : [];
    let service = null;
    try {
      service = (await (await fetch(`http://127.0.0.1:${PORT}/api/version`, { signal: AbortSignal.timeout(5000) })).json()).head ?? null;
    } catch {}
    const plan = planRts({ branch, dirty, head: from, service, target, ancestor, ci: ciOf(runs), files });
    if (plan.action === "noop") return console.log(`[rts] ${plan.reason}`);
    if (plan.action === "refuse") return log({ from, to: target, result: "refused", detail: plan.reason });

    log({ from, to: target, result: "running", detail: plan.reason });
    const before = liveSessions(); // 재시작 전 스냅샷(못 읽으면 null: 세션 비교만 건너뛴다)
    const started = Date.now();
    if (from !== target) git("merge", "--ff-only", "-q", target);
    sh("systemctl", ["--user", "restart", "atc"]);
    let why = `상태 확인 실패(${HEALTH_MS / 1000}초)`;
    let sessions;
    if (await health(target, started)) {
      const s = await sessionsHealth(before);
      if (s.ok) return log({ from, to: target, result: "ok", detail: `${Math.round((Date.now() - started) / 1000)}초${before ? ` · 세션 ${before.length}개 그대로` : " · 재시작 전 세션 목록을 읽지 못해 세션 비교는 건너뜀"}` });
      why = `세션 점검 실패 — ${s.detail}`;
      sessions = s.failures.flatMap((f) => f.sessions ?? []);
    }

    // ROLLBACK: 트리가 깨끗했고 fast-forward였으니 직전 커밋으로 돌려도 잃는 것이 없다
    git("reset", "--hard", "-q", from);
    const back = Date.now();
    sh("systemctl", ["--user", "restart", "atc"]);
    const ok = await health(from, back);
    log({ from, to: target, result: "rollback", detail: `${why} — ${from.slice(0, 7)}로 되돌림${ok ? "" : ", 되돌린 서비스도 상태 확인 실패"}${sessions?.length ? " (죽은 세션은 되살리지 않음: SUPERVISOR가 다시 띄운다)" : ""}`, ...(sessions?.length ? { sessions } : {}) });
  } catch (e) {
    log({ from, to: target ?? "unknown", result: "failed", detail: String(e?.stderr || e?.message || e).split("\n")[0] });
  } finally {
    closeSync(fd);
    rmSync(LOCK, { force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();

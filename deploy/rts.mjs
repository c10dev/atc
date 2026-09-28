#!/usr/bin/env node
// MCC RETURN TO SERVICE(docs/mcc.md 6장). atc-rts.service(oneshot)가 atc 서비스 밖에서 돌린다:
// 서비스가 자기 자신을 재시작하면 그 일을 끝까지 볼 수 없으므로. 서버는 `systemctl --user start --no-block atc-rts`만 한다.
// 순서: 잠금 → 본 체크아웃 확인(main, 깨끗함, fast-forward만) → 대상 = origin/main, CI check 통과 →
// 의존성·유닛이 바뀌면 거절(사용자 몫) → ff merge·재시작 → 상태 확인 → 실패면 ROLLBACK(직전 커밋으로 reset·재시작).
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

// ── 실행(직접 부를 때만) ──
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const STATE = process.env.ATC_STATE_DIR || join(homedir(), ".local/state/atc");
const PORT = process.env.ATC_PORT || "7700";
const LOG = join(STATE, "rts.jsonl");
const LOCK = join(STATE, "rts.lock");
const HEALTH_MS = 90_000;

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
    const started = Date.now();
    if (from !== target) git("merge", "--ff-only", "-q", target);
    sh("systemctl", ["--user", "restart", "atc"]);
    if (await health(target, started)) return log({ from, to: target, result: "ok", detail: `${Math.round((Date.now() - started) / 1000)}초` });

    // ROLLBACK: 트리가 깨끗했고 fast-forward였으니 직전 커밋으로 돌려도 잃는 것이 없다
    git("reset", "--hard", "-q", from);
    const back = Date.now();
    sh("systemctl", ["--user", "restart", "atc"]);
    const ok = await health(from, back);
    log({ from, to: target, result: "rollback", detail: `상태 확인 실패(${HEALTH_MS / 1000}초) — ${from.slice(0, 7)}로 되돌림${ok ? "" : ", 되돌린 서비스도 상태 확인 실패"}` });
  } catch (e) {
    log({ from, to: target ?? "unknown", result: "failed", detail: String(e?.stderr || e?.message || e).split("\n")[0] });
  } finally {
    closeSync(fd);
    rmSync(LOCK, { force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();

#!/usr/bin/env node
// SELF-LANDING lander(docs/self-landing.md). atc 저장소의 PR을 맡는 범위·제외·로컬 확인으로 판단하고 기록한다.
// atc 서버 밖에서 systemd 타이머(atc-lander)가 5분마다 돌린다. deploy/는 user 등급이라 자동 착륙이 이 규칙을 바꿀 수 없다.
// 1·2단계는 그림자: 머지·배포는 하지 않고 would-merge·would-skip과, 그 PR이 실제로 어떻게 끝났는지만 적는다.
// 위는 순수 함수(테스트: lander.test.mjs), 아래 main()은 이 파일을 직접 실행할 때만 돈다.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tierOf } from "./landing-tier.mjs";

// 등급과 상관없이 맡지 않는 경로: 머지·스위치·세션 조종을 정하는 코드(docs/self-landing.md 4장)
export const EXCLUDED_PATHS = [
  [/^server\/landing[^/]*\.ts$/, "착륙 판단"],
  [/^server\/autoland[^/]*\.ts$/, "AUTOLAND"],
  [/^server\/origin\.ts$/, "화면 Origin 검사"],
  [/^server\/settings\.ts$/, "설정·스위치"],
  [/^server\/fleet-plan[^/]*\.ts$/, "FLEET PLAN 승인"],
  [/^server\/session-control\.ts$/, "세션 조종"],
  [/^server\/self-landing\.ts$/, "SELF-LANDING 화면"],
];
export const MAX_LINES = 1500;
export const OPT_OUT = /^\s*SELF-LANDING:\s*no\b/im;
export const GATE = { decided: 20, agreement: 0.9 };

// 운영 상태 형식을 바꾸는 diff의 흔적: 상태 폴더 아래 파일 이름, 추가만 하는 기록의 줄 타입(…Op, RecordLine)
export function stateFormatHints(diff) {
  const hints = new Set();
  let file = "";
  for (const line of String(diff ?? "").split("\n")) {
    const f = /^\+\+\+ b\/(.+)$/.exec(line);
    if (f) {
      file = f[1];
      continue;
    }
    if (!/^[+-](?![+-])/.test(line) || !file.startsWith("server/") || /\.test\.ts$/.test(file)) continue;
    if (/stateDir\s*,\s*["'`][^"'`]+\.(jsonl?|json)["'`]/.test(line)) hints.add(`${file}: 상태 파일 경로`);
    if (/\b(type|interface)\s+(\w*Op|RecordLine)\b/.test(line)) hints.add(`${file}: 기록 줄 타입`);
  }
  return [...hints];
}

// 이 head의 착륙 리뷰가 통과인가(landing-reviews.jsonl, P0·P1 없음). server/landing.ts reviewPasses와 같은 규칙
export function reviewOf(reviews, repo, number, head) {
  const r = reviews.filter((x) => x.repo === repo && x.number === number && x.head === head).at(-1) ?? null;
  return r ? { ok: r.verdict === "pass" && !r.p0 && !r.p1, verdict: r.verdict, family: r.family ?? null } : { ok: false, verdict: null, family: null };
}

// 맡는 범위와 제외(docs/self-landing.md 4장). 사유가 없고 리뷰가 통과하면 로컬 확인으로 넘어간다
export function delegationOf(pr, ctx) {
  const reasons = [];
  const add = (code, text) => reasons.push({ code, text });
  if (pr.base !== "main") add("base", `base가 main이 아님(${pr.base})`);
  if (pr.crossRepo) add("fork", "fork에서 온 PR");
  if (pr.author !== ctx.owner) add("author", `소유자 계정이 연 PR이 아님(${pr.author})`);
  if (pr.draft) add("draft", "Draft");
  if (pr.labels.some((l) => l.toLowerCase() === "hold")) add("hold", "hold 라벨");
  const tier = tierOf(pr.files);
  if (tier.tier !== "auto") add("tier", `등급 ${tier.tier}(${[...new Set(tier.reasons.map((r) => r.why))].join(", ")})`);
  const excluded = [...new Set(pr.files.flatMap((f) => EXCLUDED_PATHS.filter(([re]) => re.test(f)).map(([, why]) => why)))];
  if (excluded.length) add("excluded", `제외 경로: ${excluded.join(", ")}`);
  const hints = stateFormatHints(ctx.diff);
  if (hints.length) add("state", `운영 상태 형식: ${hints.join("; ")}`);
  if (OPT_OUT.test(pr.body ?? "")) add("opt-out", "본문의 SELF-LANDING: no");
  if (pr.additions + pr.deletions > MAX_LINES) add("size", `바뀐 줄 ${pr.additions + pr.deletions} > ${MAX_LINES}`);
  const check = pr.checks.find((c) => c.name === "check");
  if (!check || check.conclusion !== "SUCCESS") add("ci", `CI check ${check ? (check.conclusion || check.status || "진행 중") : "없음"}`);
  if (pr.mergeable === "CONFLICTING") add("conflict", "main과 충돌");
  const review = ctx.review ?? { ok: false, verdict: null };
  return { tier: tier.tier, reasons, review };
}

// 판정: 사유가 없고, 리뷰가 통과하고, 로컬 확인이 모두 됐으면 would-merge.
// readyExceptReview: 리뷰만 빠진 것(리뷰 출처가 생기기 전의 그림자 데이터)
export function verdictOf(d, checks) {
  const checksOk = Boolean(checks && checks.merge && checks.test && checks.tsc && checks.build);
  const reasons = [...d.reasons];
  if (!d.review.ok) reasons.push({ code: "review", text: d.review.verdict ? `head 리뷰 ${d.review.verdict}(P0·P1 있음)` : "head에 착륙 리뷰 없음" });
  if (checks && !checksOk) {
    const failed = ["merge", "test", "tsc", "build"].filter((k) => !checks[k]);
    reasons.push({ code: "local", text: `로컬 확인 실패: ${failed.join(", ")}${checks.note ? ` — ${checks.note}` : ""}` });
  }
  const readyExceptReview = !d.reasons.length && checksOk;
  return { verdict: !reasons.length && checksOk ? "would-merge" : "would-skip", reasons, readyExceptReview };
}

// 끝난 PR: 마지막으로 판정한 head 그대로 머지됐나
export function outcomeOf(state, mergedHead, evaluatedHead) {
  if (state === "MERGED") return mergedHead === evaluatedHead ? "merged-as-is" : "merged-changed";
  if (state === "CLOSED") return "closed";
  return null;
}

// 기록(self-landing.jsonl)을 PR마다 접는다: 마지막 판정과 결과
export function foldLander(lines) {
  const byPr = new Map();
  for (const l of lines) {
    if (l.op === "evaluate") {
      const x = byPr.get(l.pr) ?? { pr: l.pr, last: null, outcome: null };
      if (!x.outcome) x.last = l;
      byPr.set(l.pr, x);
    } else if (l.op === "outcome") {
      const x = byPr.get(l.pr);
      if (x && !x.outcome) x.outcome = l;
    }
  }
  return [...byPr.values()];
}

// 그림자 게이트(결정 5): 끝난 PR 20건에서 lander의 판정이 실제와 맞은 비율 90% 이상, structure가 거절한 PR에 would-merge 0건.
// 맞음: would-merge ↔ 판정한 head 그대로 머지, would-skip ↔ 닫힘·바뀐 뒤 머지·사람 등급(tier user·flagged 머지).
// 리뷰만 빠진 would-skip이 그대로 머지됐으면 readyExceptReview로 따로 센다(리뷰 출처가 생기기 전)
export function landerGateOf(lines) {
  const done = foldLander(lines).filter((x) => x.last && x.outcome);
  let agreed = 0;
  let refused = 0;
  let reviewOnly = 0;
  for (const x of done) {
    const merge = x.last.verdict === "would-merge";
    const asIs = x.outcome.outcome === "merged-as-is";
    const human = x.last.tier !== "auto";
    if (merge && !asIs) refused++;
    if (merge ? asIs : !asIs || human) agreed++;
    else if (!merge && x.last.readyExceptReview) reviewOnly++;
  }
  const agreement = done.length ? agreed / done.length : null;
  return { decided: done.length, agreed, agreement, refused, reviewOnly, target: GATE, ready: done.length >= GATE.decided && agreement !== null && agreement >= GATE.agreement && refused === 0 };
}

// ── 입출력(직접 실행할 때만) ──

const MAIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE = process.env.ATC_STATE_DIR || join(homedir(), ".local", "state", "atc");
const REPO = process.env.ATC_LANDER_REPO || "chaehy5665/atc";
const WORKTREES = process.env.ATC_LANDER_WORKTREES || resolve(MAIN, "..", "worktrees");
const STATE_FILE = join(STATE, "self-landing.json");
const LOG_FILE = join(STATE, "self-landing.jsonl");
const KEEP = 500;

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"], ...opts });
const tryRun = (cmd, args, opts) => {
  try {
    return { ok: true, out: run(cmd, args, opts) };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}`.slice(-2000) };
  }
};

function loadState() {
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    return { mode: ["off", "shadow", "merge"].includes(s.mode) ? s.mode : "shadow", groundStop: s.groundStop ?? null, seen: Array.isArray(s.seen) ? s.seen : [] };
  } catch {
    return { mode: "shadow", groundStop: null, seen: [] };
  }
}
function saveState(s) {
  mkdirSync(STATE, { recursive: true });
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...s, seen: s.seen.slice(-KEEP) }, null, 2) + "\n");
  renameSync(tmp, STATE_FILE);
}
function readLines(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
}
function append(line) {
  mkdirSync(STATE, { recursive: true });
  appendFileSync(LOG_FILE, JSON.stringify({ t: new Date().toISOString(), ...line }) + "\n");
}

// origin/main에 PR head를 합친 분리 worktree에서 테스트·tsc·빌드(원칙 2: strict가 꺼져 있어 head만으로는 모자람)
function localChecks(number, head) {
  const wt = join(WORKTREES, `atc-lander-${number}`);
  const git = (args, cwd = MAIN) => tryRun("git", ["-C", cwd, ...args]);
  const cleanup = () => {
    git(["worktree", "remove", "--force", wt]);
    git(["worktree", "prune"]);
  };
  cleanup();
  const out = { merge: false, test: false, tsc: false, build: false, note: null };
  try {
    if (!git(["fetch", "-q", "origin", "main", `+refs/pull/${number}/head:refs/atc-lander/${number}`]).ok) return { ...out, note: "fetch 실패" };
    if (!git(["worktree", "add", "-q", "--detach", wt, "origin/main"]).ok) return { ...out, note: "worktree 실패" };
    const m = git(["-c", "user.name=atc-lander", "-c", "user.email=atc-lander@localhost", "merge", "--no-edit", "-q", head], wt);
    if (!m.ok) return { ...out, note: "main과 합치기 실패(충돌)" };
    out.merge = true;
    tryRun("cp", ["-al", join(MAIN, "node_modules"), join(wt, "node_modules")]);
    const t = tryRun("npm", ["test"], { cwd: wt });
    out.test = t.ok && /ℹ fail 0\b/.test(t.out);
    out.tsc = tryRun("npx", ["tsc", "--noEmit", "-p", "."], { cwd: wt }).ok;
    out.build = tryRun("npx", ["vite", "build"], { cwd: wt }).ok;
    return out;
  } finally {
    cleanup();
    git(["update-ref", "-d", `refs/atc-lander/${number}`]);
  }
}

const FIELDS = "number,headRefOid,baseRefName,isDraft,isCrossRepository,author,labels,body,additions,deletions,files,statusCheckRollup,mergeable,title";
const prOf = (p) => ({
  number: p.number,
  head: p.headRefOid,
  base: p.baseRefName,
  draft: p.isDraft,
  crossRepo: p.isCrossRepository,
  author: p.author?.login ?? "",
  labels: (p.labels ?? []).map((l) => l.name),
  body: p.body ?? "",
  additions: p.additions ?? 0,
  deletions: p.deletions ?? 0,
  files: (p.files ?? []).map((f) => f.path),
  checks: (p.statusCheckRollup ?? []).map((c) => ({ name: c.name ?? c.context, conclusion: c.conclusion ?? c.state ?? null, status: c.status ?? null })),
  mergeable: p.mergeable,
});

function main() {
  const st = loadState();
  if (st.mode === "off") return console.log("[atc-lander] off");
  if (st.groundStop) return console.log(`[atc-lander] GROUND STOP — ${st.groundStop.reason ?? ""}`);
  if (st.mode === "merge") console.log("[atc-lander] merge 모드는 아직 없음 — 그림자로 돈다");
  const owner = REPO.split("/")[0];
  const open = JSON.parse(run("gh", ["pr", "list", "--repo", REPO, "--state", "open", "--limit", "50", "--json", FIELDS])).map(prOf);
  const reviews = readLines(join(STATE, "landing-reviews.jsonl"));
  const seen = new Set(st.seen);
  for (const pr of open.sort((a, b) => a.number - b.number)) {
    const key = `${pr.number}@${pr.head}`;
    if (seen.has(key)) continue;
    const diff = tryRun("gh", ["pr", "diff", String(pr.number), "--repo", REPO]).out;
    const d = delegationOf(pr, { owner, diff, review: reviewOf(reviews, REPO, pr.number, pr.head) });
    // 로컬 확인은 비싸서, 리뷰 말고는 걸린 것이 없을 때만 한다
    const checks = d.reasons.length ? null : localChecks(pr.number, pr.head);
    const v = verdictOf(d, checks);
    append({ op: "evaluate", pr: pr.number, head: pr.head, title: pr.title, tier: d.tier, verdict: v.verdict, readyExceptReview: v.readyExceptReview, reasons: v.reasons, checks, review: d.review });
    console.log(`[atc-lander] #${pr.number} ${pr.head.slice(0, 7)} ${v.verdict}${v.reasons.length ? ` — ${v.reasons.map((r) => r.text).join("; ")}` : ""}`);
    seen.add(key);
    st.seen.push(key);
  }
  // 판정했던 PR이 끝났으면 결과를 적는다(그림자 게이트의 짝)
  const openNumbers = new Set(open.map((p) => p.number));
  for (const x of foldLander(readLines(LOG_FILE))) {
    if (x.outcome || !x.last || openNumbers.has(x.pr)) continue;
    const r = tryRun("gh", ["pr", "view", String(x.pr), "--repo", REPO, "--json", "state,headRefOid,mergedAt,mergedBy"]);
    if (!r.ok) continue;
    const p = JSON.parse(r.out);
    const outcome = outcomeOf(p.state, p.headRefOid, x.last.head);
    if (!outcome) continue;
    append({ op: "outcome", pr: x.pr, outcome, head: p.headRefOid, mergedAt: p.mergedAt ?? null, mergedBy: p.mergedBy?.login ?? null });
    console.log(`[atc-lander] #${x.pr} ${outcome}`);
  }
  saveState(st);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

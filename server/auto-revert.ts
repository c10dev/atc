import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";

// 자동 되돌림 줄(ATC-351, docs/autonomy.md C4·WO-10). atc의 lander(MCC·AUTOLAND)가 머지해서 main이 빨개지면 그 머지의 revert PR을 연다.
// 이 파일은 설정·기록 읽기 쓰기와 순수 결정(revertDecisionOf). GitHub에 쓰는 일과 lane 낮추기는 auto-revert-run.ts.
// 스위치 autoRevert(off·on, 기본 on)는 설정 창(fromThisApp)에서만 바꾼다 — atcctl 명령이 없다(K3). shadow는 없다: 처음부터 켜져 있고(ATC-394), 끄는 것은 SUPERVISOR 몫이다.
// 되돌리기 전에 실패한 체크를 같은 main head에서 한 번 다시 돌린다(flake 방어). 다시 빨갛고 PR 자신의 head가 초록이었을 때만 되돌린다.

export type AutoRevertMode = "off" | "on";
export const AUTO_REVERT_MODES: readonly AutoRevertMode[] = ["off", "on"];

export interface AutoRevertConfig {
  mode: AutoRevertMode;
}
export const DEFAULT_AUTO_REVERT: AutoRevertConfig = { mode: "on" };

const CONFIG_FILE = () => join(config.stateDir, "auto-revert.json");
export const RECORD_FILE = () => join(config.stateDir, "auto-revert.jsonl");

// 기본 on(ATC-394). 꺼지는 것은 파일에 정확히 "off"가 적혔을 때뿐이다(예전 shadow 값과 모르는 값은 기본). 파일이 없어도 on이다
export function parseAutoRevert(raw: unknown): AutoRevertConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { mode: r.mode === "off" ? "off" : DEFAULT_AUTO_REVERT.mode };
}

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};
export const loadAutoRevert = (file = CONFIG_FILE()) => parseAutoRevert(readJson(file));
export function saveAutoRevert(next: AutoRevertConfig, file = CONFIG_FILE()) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  renameSync(tmp, file);
}

// ── 기록(auto-revert.jsonl, 추가만) ──
// red: 새 빨간 main head를 처음 본 때(실패한 체크를 다시 돌려도 빨갛다고 확인한 뒤). own은 우리 revert PR의 머지라는 뜻이라 breaker가 세지 않는다
// rerun: 실패한 체크를 같은 head에서 한 번 다시 돌리기 시작했다(runs). flake: 다시 돌리니 초록이었다(flake를 잡음, 되돌리지 않고 breaker도 세지 않는다)
// misfire: 되돌린 PR이 24시간 안에 그대로 다시 머지됐다(kind: revert-of-revert · same-files)
// revert-opened/-failed: revert PR을 열었다/못 열었다. revert-landed: 그 PR이 머지됐음을 처음 봤다
// hold: K1·K3·사람의 머지·되돌림의 되돌림처럼 자동으로 하지 않고 알린 것. stop: breaker가 lane을 낮췄다. mode: 스위치를 바꿨다(breaker 래치를 푼다)
// fix: 되돌린 PR의 FLIGHT 담당에게 FIX를 냈다(relay), duty: DUTY에게 알렸다
export interface AutoRevertLine {
  at: string;
  op: "red" | "rerun" | "flake" | "misfire" | "revert-opened" | "revert-failed" | "revert-landed" | "hold" | "stop" | "mode" | "fix" | "duty";
  airport?: string;
  head?: string; // 빨간 main head
  commit?: string; // 되돌릴 머지 커밋
  pr?: number; // 되돌릴 PR(원래 PR)
  by?: "mcc" | "autoland";
  revertPr?: number; // 연 revert PR
  check?: string; // 실패한 체크
  own?: boolean;
  runs?: { id: number; attempt: number }[]; // rerun: 다시 돌리기 전의 GitHub Actions run id와 시도 번호
  by2?: number; // misfire: 그대로 다시 머지한 PR 번호
  kind?: "revert-of-revert" | "same-files"; // misfire
  detail?: string;
}

export function readAutoRevertLines(file = RECORD_FILE()): AutoRevertLine[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: AutoRevertLine[] = [];
  for (const l of text.split("\n")) {
    if (!l) continue;
    try {
      out.push(JSON.parse(l) as AutoRevertLine);
    } catch {}
  }
  return out;
}
export function appendAutoRevertLine(l: Omit<AutoRevertLine, "at"> & { at?: string }, file = RECORD_FILE()) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...l }) + "\n");
}

// ── 순수 결정 ──
export const WINDOW_MS = 60 * 60_000; // 두 번째 빨간 head를 세는 시간
export const SCAN_DEPTH = 15; // 빨간 head에서 거슬러 올라가 보는 커밋 수

// main의 한 커밋. 부르는 쪽이 채운다(newest first, [0]이 빨간 head)
export interface RevertCommit {
  sha: string;
  pr: number | null; // 이 커밋이 PR의 머지 커밋이면 그 PR 번호
  by: "mcc" | "autoland" | null; // 그 머지를 atc의 lander가 했다는 기록이 있을 때만(없으면 사람이나 모름)
  revert: boolean; // 우리가 연 revert PR의 머지
  green: boolean; // 이 커밋에서 main이 초록이었다고 읽었다(여기서 거슬러 오르기를 멈춘다)
  files: string[] | null; // PR의 바뀐 파일(못 읽었으면 null)
}

export interface RevertInput {
  airport: string;
  head: { sha: string; state: "success" | "failure" | "pending" | "none"; failing: string[] };
  commits: RevertCommit[];
  inflight: boolean; // 이 AIRPORT에 열린 revert PR이 있다
  lines: readonly AutoRevertLine[];
  now: number;
  migrationOf: (files: readonly string[]) => string | null; // K1: 마이그레이션·SQL 경로가 있으면 그 경로
  userTierOf: (files: readonly string[]) => string | null; // K3: user 등급이면 이유
}

export type RevertDecision =
  | { act: "none"; why: string }
  | { act: "revert"; commit: string; pr: number; by: "mcc" | "autoland"; check: string }
  | { act: "hold"; why: string; pr?: number }
  | { act: "stop"; why: string };

const short = (s: string) => s.slice(0, 7);

// breaker 래치: 이 AIRPORT의 마지막 stop 뒤에 SUPERVISOR의 mode 줄이 없으면 멈춘 채다(올리는 것은 SUPERVISOR의 스위치)
export function stoppedOf(lines: readonly AutoRevertLine[], airport: string): AutoRevertLine | null {
  let stop: AutoRevertLine | null = null;
  for (const l of lines) {
    if (l.op === "stop" && l.airport === airport) stop = l;
    else if (l.op === "mode") stop = null;
  }
  return stop;
}

// 1시간 안에 처음 본 빨간 head(우리 revert의 머지는 빼고, 같은 sha는 하나로)
export function redHeadsOf(lines: readonly AutoRevertLine[], airport: string, now: number): string[] {
  const out = new Set<string>();
  for (const l of lines) {
    if (l.op !== "red" || l.airport !== airport || l.own || !l.head) continue;
    if (now - Date.parse(l.at) <= WINDOW_MS) out.add(l.head);
  }
  return [...out];
}

export function revertDecisionOf(x: RevertInput): RevertDecision {
  if (x.head.state !== "failure") return { act: "none", why: "main이 빨갛지 않음" };
  if (stoppedOf(x.lines, x.airport)) return { act: "none", why: "breaker가 멈춤 — SUPERVISOR가 스위치를 다시 고를 때까지" };
  if (x.inflight) return { act: "none", why: "이 AIRPORT에 revert PR이 이미 열려 있음" };
  const check = x.head.failing.join(", ") || "(체크 이름을 모름)";

  // 우리 revert 머지가 head일 때는 같은 사고의 이어짐이라 빨간 head로 세지 않는다. 그 밖의 새 빨간 head가 1시간 안에 둘이면 breaker
  const own = x.commits[0]?.revert === true;
  const reds = redHeadsOf(x.lines, x.airport, x.now);
  if (!own && !reds.includes(x.head.sha)) reds.push(x.head.sha);
  if (!own && reds.length >= 2) return { act: "stop", why: `1시간 안에 빨간 main head ${reds.length}개(${reds.map(short).join(", ")})` };

  // 마지막 초록 head 뒤의 커밋만 본다. 그 안에 사람의 머지나 모르는 커밋이 있으면 누가 깼는지 모른다 → 하지 않고 알린다
  const range: RevertCommit[] = [];
  for (const c of x.commits.slice(0, SCAN_DEPTH)) {
    if (c.green) break;
    range.push(c);
  }
  if (!range.length) return { act: "none", why: "범위에 되돌릴 커밋이 없음" };
  const foreign = range.find((c) => !c.revert && c.by === null);
  if (foreign) return { act: "hold", why: `lander가 아닌 커밋 ${short(foreign.sha)}${foreign.pr ? ` (PR #${foreign.pr})` : ""}이 마지막 초록 뒤에 있음 — 사람의 머지는 자동으로 되돌리지 않음` };

  const done = new Set(x.lines.filter((l) => l.op === "revert-opened" && l.pr != null).map((l) => l.pr as number));
  const candidates = range.filter((c) => !c.revert && c.by !== null && c.pr != null && !done.has(c.pr));
  const c = candidates[0]; // 가장 새 머지부터
  if (!c || c.pr == null || c.by === null) return { act: "hold", why: "되돌릴 lander 머지가 남지 않음(모두 이미 되돌렸거나 revert)" };
  if (c.files === null) return { act: "hold", pr: c.pr, why: `PR #${c.pr}의 바뀐 파일을 읽지 못함` };
  const mig = x.migrationOf(c.files);
  if (mig) return { act: "hold", pr: c.pr, why: `PR #${c.pr}가 마이그레이션·SQL 경로를 고침(K1): ${mig}` };
  const k3 = x.userTierOf(c.files);
  if (k3) return { act: "hold", pr: c.pr, why: `PR #${c.pr}가 user 등급 경로를 고침(K3): ${k3}` };
  return { act: "revert", commit: c.sha, pr: c.pr, by: c.by, check };
}

// lane 한 단계 낮추기(순수): AUTOLAND merge → update, MCC land → shadow(RTS는 그대로: land+rts → rts). 이미 낮으면 null
export const lowerAutoland = (mode: string): "update" | null => (mode === "merge" ? "update" : null);
export const lowerMcc = (mode: string): "shadow" | "rts" | null => (mode === "land" ? "shadow" : mode === "land+rts" ? "rts" : null);

// revert PR 머지를 봤을 때 AUTOLAND GROUND STOP을 스스로 푸는 조건(순수): on이고, 그 stop의 빨간 sha에 우리가 revert PR을 열었고,
// 지금 main head가 다른 SHA로 초록이다. 사람이 건 stop이나 다른 사고의 stop은 건드리지 않는다
export function clearableStops<S extends { airport: string; repo: string; sha: string }>(
  mode: AutoRevertMode,
  stops: readonly S[],
  mains: readonly { repo: string; sha: string | null; state: string }[],
  lines: readonly AutoRevertLine[],
): S[] {
  if (mode !== "on") return [];
  return stops.filter((g) => {
    const m = mains.find((x) => x.repo === g.repo);
    if (!m?.sha || m.sha === g.sha || m.state !== "success") return false;
    return lines.some((l) => l.op === "revert-opened" && l.airport === g.airport && l.head === g.sha);
  });
}

// 커밋 메시지 첫 줄에서 PR 번호("Merge pull request #12 …" 또는 squash의 "title (#12)"). 못 읽으면 null(rebase 머지 등)
export function prOfSubject(subject: string): number | null {
  const m = /^Merge pull request #(\d+)\b/.exec(subject) ?? /\(#(\d+)\)\s*$/.exec(subject);
  return m ? Number(m[1]) : null;
}

// revert PR의 제목·본문(영어). 제목에 ATC key를 넣지 않는다 — 제목의 key는 이슈를 닫는다(원래 이슈는 이미 끝났다)
export function revertTitleOf(pr: number): string {
  return `Revert PR #${pr}: main went red (auto-revert)`;
}
export function revertBodyOf(x: { pr: number; prUrl: string; commit: string; head: string; check: string; by: "mcc" | "autoland" }): string {
  return [
    `Automatic revert of ${x.prUrl} (merge ${short(x.commit)}), opened by atc's auto-revert lane (ATC-351).`,
    "",
    `- main head ${short(x.head)} is red; failing check: ${x.check}`,
    `- the original merge was made by atc's lander (${x.by === "mcc" ? "MCC" : "AUTOLAND"})`,
    "- this PR goes through the same review and CI as any PR and lands when green; the next green head clears the stop",
    "",
    "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
  ].join("\n");
}

// 되돌린 PR의 담당에게 가는 FIX 글(영어, 세션끼리 주고받는 글)
export function fixTextOf(x: { pr: number; prUrl: string; flight: string; check: string; head: string; revertPr: number | null }): string {
  return [
    `Your PR #${x.pr} (${x.flight}) was merged by atc's lander and main then went red at ${short(x.head)}; failing check: ${x.check}.`,
    `atc ${x.revertPr ? `opened revert PR #${x.revertPr}` : "will revert it"} (${x.prUrl}). Find the cause, fix it in a new PR and re-land; do not re-merge the original change as it was.`,
  ].join(" ");
}

// 기록을 화면·브리프에 보일 한 줄로(DUTY brief, 영어)
export function dutyLineOf(l: AutoRevertLine): string | null {
  const where = `${l.airport ?? "?"} head ${l.head ? short(l.head) : "?"}`;
  switch (l.op) {
    case "revert-opened":
      return `AUTO-REVERT opened #${l.revertPr} reverting PR #${l.pr} (${where}, failing: ${l.check ?? "?"})`;
    case "revert-failed":
      return `AUTO-REVERT could not open a revert of PR #${l.pr} (${where}): ${l.detail ?? "error"}`;
    case "revert-landed":
      return `AUTO-REVERT #${l.revertPr} landed (${l.airport ?? "?"})`;
    case "hold":
      return `AUTO-REVERT HOLD ${where}: ${l.detail ?? ""}`;
    case "flake":
      return `AUTO-REVERT flake caught ${where}: ${l.check ?? "?"} was red, then green on re-run; nothing reverted`;
    case "misfire":
      return `AUTO-REVERT misfire: reverted PR #${l.pr} was merged back unchanged within 24 h as PR #${l.by2} (${l.kind})`;
    case "stop":
      return `AUTO-REVERT STOP ${l.airport ?? "?"}: ${l.detail ?? ""} — lane lowered; the SUPERVISOR raises it again`;
    default:
      return null;
  }
}

// 이 PR이 우리가 연 revert PR인가: 이 AIRPORT의 revert-opened 기록에 있고 브랜치가 GitHub의 revert 이름(`revert-<번호>-…`)이다.
// 스위치가 on일 때만 쓴다. GROUND STOP과 FLIGHT 없음 예외가 이 PR에만 적용된다
export const isRevertPr = (lines: readonly AutoRevertLine[], airport: string, number: number, branch: string): boolean =>
  /^revert-\d+-/.test(branch) && lines.some((l) => l.op === "revert-opened" && l.airport === airport && l.revertPr === number);

// ── flake 방어(ATC-394) ──
// 되돌리기 전에 실패한 체크를 같은 main head에서 한 번 다시 돌린다. 다시 초록이면 flake를 잡은 것이라 되돌리지 않고 breaker도 세지 않는다.
// 다시 빨갛고 되돌릴 PR 자신의 head가 초록이었을 때만 되돌린다. 다시 돌릴 수 없는 체크(Actions run이 아님)는 확인할 수 없으니 되돌리지 않고 알린다.
export const RERUN_WAIT_MS = 45 * 60_000;
export interface RunState {
  id: number;
  attempt: number;
  status: string; // queued | in_progress | completed
  conclusion: string | null;
}
export type RerunVerdict = "wait" | "green" | "red" | "timeout";
// 순수: 다시 돌린 run들의 지금 상태로 판정. 시도 번호가 올라가지 않은 run은 아직 다시 돌기 전(옛 결과)이라 기다린다
export function rerunVerdictOf(started: readonly { id: number; attempt: number }[], now: readonly RunState[], startedAt: string, nowMs: number): RerunVerdict {
  const waited = nowMs - Date.parse(startedAt) > RERUN_WAIT_MS;
  const fresh = started.map((s) => now.find((r) => r.id === s.id && r.attempt > s.attempt));
  if (fresh.some((r) => !r || r.status !== "completed")) return waited ? "timeout" : "wait";
  return fresh.every((r) => r!.conclusion === "success") ? "green" : "red";
}

// 이 head의 flake 방어 상태: started(rerun 줄) · flake(초록이라 끝) 
export function rerunOf(lines: readonly AutoRevertLine[], airport: string, head: string): { started: AutoRevertLine | null; flake: boolean } {
  const mine = lines.filter((l) => l.airport === airport && l.head === head);
  return { started: mine.filter((l) => l.op === "rerun").at(-1) ?? null, flake: mine.some((l) => l.op === "flake") };
}

// ── 되돌린 PR이 그대로 다시 머지됨(misfire) ──
export const MISFIRE_WINDOW_MS = 24 * 3_600_000;
export interface MergedPr {
  number: number;
  branch: string;
  mergedAt: string;
}
type FileSha = { filename: string; sha: string };
const sameFiles = (a: readonly FileSha[], b: readonly FileSha[]) => a.length > 0 && a.length === b.length && a.every((f) => b.some((g) => g.filename === f.filename && g.sha === f.sha));
// 순수: revert가 머지된 뒤(revertedAt) 24시간 안에 머지된 PR 가운데 되돌린 것을 그대로 되살린 것. 하나면 그것
//   revert-of-revert: GitHub이 revert PR을 되돌릴 때 붙이는 브랜치 이름 revert-<revert PR 번호>-…
//   same-files: 파일 이름과 바뀐 뒤의 blob sha가 원래 PR과 모두 같다(파일을 읽을 수 있을 때만)
export function mergedBackOf(
  orig: { files: readonly FileSha[] | null },
  revertPr: number,
  revertedAt: string,
  merged: readonly (MergedPr & { files?: readonly FileSha[] | null })[],
): { pr: number; kind: "revert-of-revert" | "same-files" } | null {
  const from = Date.parse(revertedAt);
  for (const m of merged) {
    const t = Date.parse(m.mergedAt);
    if (t < from || t - from > MISFIRE_WINDOW_MS) continue;
    if (new RegExp(`^revert-${revertPr}-`).test(m.branch)) return { pr: m.number, kind: "revert-of-revert" };
    if (orig.files && m.files && sameFiles(orig.files, m.files)) return { pr: m.number, kind: "same-files" };
  }
  return null;
}

// ── 날짜별 수(설정 창과 GET /api/auto-revert) ──
export interface RevertDay {
  day: string; // UTC 날짜
  reverts: number; // revert PR을 연 수
  flakes: number; // 빨갛다가 다시 돌리니 초록: flake를 잡은 수
  misfires: number; // 되돌린 PR이 24시간 안에 그대로 다시 머지된 수
  holds: number;
  stops: number;
}
export function revertDaysOf(lines: readonly AutoRevertLine[], days: number, now: number): RevertDay[] {
  const out = new Map<string, RevertDay>();
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
    out.set(day, { day, reverts: 0, flakes: 0, misfires: 0, holds: 0, stops: 0 });
  }
  for (const l of lines) {
    const d = out.get(l.at.slice(0, 10));
    if (!d) continue;
    if (l.op === "revert-opened") d.reverts++;
    else if (l.op === "flake") d.flakes++;
    else if (l.op === "misfire") d.misfires++;
    else if (l.op === "hold") d.holds++;
    else if (l.op === "stop") d.stops++;
  }
  return [...out.values()];
}

// ── flake 방어의 단계(순수, ATC-394) ──
// cycle이 I/O 사이에서 어느 길로 갈지를 정한다. 시험은 이 함수들로 한다.
export const DECIDED_OPS: readonly AutoRevertLine["op"][] = ["revert-opened", "revert-failed", "hold", "stop", "flake"];
export type GuardPhase = "decided" | "confirmed" | "rerunning" | "fresh";
// decided: 이 head로 이미 결정을 냈다(flake를 잡은 head도). confirmed: 다시 돌려도 빨갛다고 확인해 red 줄이 있다. rerunning: 다시 돌리는 중. fresh: 아직 아무것도 안 했다
export function guardPhaseOf(lines: readonly AutoRevertLine[], airport: string, head: string): GuardPhase {
  const mine = lines.filter((l) => l.airport === airport && l.head === head);
  if (mine.some((l) => DECIDED_OPS.includes(l.op))) return "decided";
  if (mine.some((l) => l.op === "red")) return "confirmed";
  return mine.some((l) => l.op === "rerun") ? "rerunning" : "fresh";
}
// 다시 돌린 결과(rerunVerdictOf)에 따른 다음 걸음: wait는 다음 주기, flake는 flake 줄을 쓰고 끝, hold는 되돌리지 않고 알림, confirmed는 빨간 것으로 이어 간다
export type PollStep = "wait" | "flake" | "hold" | "confirmed";
export const pollStepOf = (v: RerunVerdict): PollStep => (v === "wait" ? "wait" : v === "green" ? "flake" : v === "timeout" ? "hold" : "confirmed");
// 결정(revertDecisionOf) 뒤: revert와 breaker 멈춤은 빨강이 확인된 뒤에만. 확인 전이면 먼저 다시 돌린다. hold·none은 다시 돌리지 않는다
export const needsRerun = (phase: GuardPhase, act: RevertDecision["act"]): boolean => phase !== "confirmed" && (act === "revert" || act === "stop");
// red 줄은 확인된 빨강에만 쓴다(flake는 breaker에 세지 않는다)
export const writeRed = (phase: GuardPhase, alreadyWritten: boolean): boolean => phase === "confirmed" && !alreadyWritten;

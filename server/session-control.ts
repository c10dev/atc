import { execFile } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context, Hono } from "hono";
import { config } from "./config.ts";
import { type AccountFolder, accountFolders, folderOfAccount, observedLabelsOn } from "./accounts.ts";
import { authStatusOf } from "./account-health.ts";
import { cleanEnv, cleanPath } from "./clean-env.ts";
import { loadDispatchConfig } from "./dispatch.ts";
import { crewBriefing, FleetError, fleetView, loadFleet, saveControlAccount, saveLaunchAccount, saveLaunchModel } from "./fleet.ts";
import { launchModelOf, launchModelPatchOf, launchModelSettingOf, MODEL_CHOICES } from "./launch-model.ts";
import { launchSplitWarning } from "./account-reach.ts";
import { effectiveLaunchAccount, launchSettingOf, launchSettingPatchOf } from "./launch-account.ts";
import { fleetKeyOf } from "./registration.ts";
import { accountsLabeled, CONTROL_NAMES, controlAccountOf, type FleetFile } from "./crew.ts";
import type { Snapshot } from "./model.ts";
import { fromThisApp } from "./origin.ts";
import { record } from "./recorder.ts";
import { regKey, sameReg } from "./registration.ts";
import type { K3Launch } from "./k3-allow.ts";
import { attachDirOf, isBackground, manualStepsOf, permissionModeOf, type SessionOrigin } from "./session-origin.ts";
import { sessionProcOf } from "./session-proc.ts";
import { readJob, settleJob } from "./job-state.ts";
import { ttlCache } from "./agents-cache.ts";
import { readSquelchLast, squelchOfName } from "./squelch-last.ts";
import { capHoldersOf, capHoldersText, type OtherBackground, otherBackgroundOf } from "./other-background.ts";
import { launchWithFlightPromptOf } from "./fresh-start.ts";

// 세션 조종(docs/fleet.md 8.5). atc가 `claude --bg`로 AIRCRAFT 세션을 띄우고 `claude stop`으로 멈춘다.
// SUPERVISOR가 FLEET 탭에서 누를 때만 한다(Origin 검사). 관제 세션의 atcctl은 부를 수 없다.

import { DEFAULT_PERMISSION_MODE, MAX_LAUNCHED, PERMISSION_MODES, type PermissionMode } from "./launch-limits.ts";
export { DEFAULT_PERMISSION_MODE, MAX_LAUNCHED, PERMISSION_MODES };
export type { PermissionMode };

// `claude agents --json`의 한 줄
export interface AgentRow {
  id?: string; // 백그라운드 세션의 짧은 id
  sessionId: string;
  name?: string;
  kind: string; // "background" | "interactive"
  status?: string;
  cwd: string;
  startedAt?: number; // ms
  pid?: number;
  // atc가 붙인다(ATC-93): Claude Code가 멈춘 job을 아직 목록에 둔 줄(STALE). 살아 있는 세션으로 세지 않는다
  stale?: boolean;
  // atc가 붙인다(ATC-147): 이 줄을 읽은 폴더의 ACCOUNT 라벨. 등록부가 없으면 없다(폴더가 ~/.claude 하나)
  account?: string;
  // atc가 붙인다(ATC-301): 기본이 아닌 폴더에서 읽은 줄이면 그 폴더. claude attach가 CLAUDE_CONFIG_DIR로 붙인다
  attachDir?: string;
}

// ── STALE(ATC-93) ──
// 2026-09-29: done 상태에서 STOP한 TOWER job(3bf04645)이 claude agents에 pid·status 없이 "working"으로 계속 남아 LAUNCH를 막고
// 상한에 셌다(Claude Code 2.1.284). 막 띄운 job도 0.4초쯤 pid·status 없이 보이므로, job 파일의 state가 끝난 값이고
// 시작한 지 2분이 넘었을 때만 STALE이다. 살아 있는 job도 한 턴을 마치면 state가 done이라 state만으로는 가르지 않는다
// ATC-213: blocked도 같다. 사람을 기다리다 idle로 끝난(약 60분) job은 프로세스가 없는데 state.json이 blocked인 채 pid·status 없는 줄로 남는다
// (2026-09-30 TEAM_F 40bb5e74, TEAM_K 77803763). 살아 있는 blocked job은 pid와 status(idle)가 있으므로 이 검사에 오지 않는다
export const STALE_JOB_STATES: ReadonlySet<string> = new Set(["done", "stopped", "failed", "blocked"]);
export const STALE_MIN_AGE_MS = 2 * 60_000;
export function isStaleRow(row: Pick<AgentRow, "kind" | "pid" | "status" | "startedAt">, jobState: string | null, now: number): boolean {
  if (row.kind !== "background" || row.pid != null || row.status != null) return false;
  if (!jobState || !STALE_JOB_STATES.has(jobState)) return false;
  return typeof row.startedAt === "number" && now - row.startedAt >= STALE_MIN_AGE_MS;
}
export const liveRowsOf = <T extends Pick<AgentRow, "stale">>(rows: readonly T[]): T[] => rows.filter((r) => !r.stale);
export const STALE_NOTE = "Claude Code가 멈춘 job을 아직 목록에 둠 — 무시해도 된다";

export class ControlError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface LaunchInput {
  registration: string;
  retired: boolean;
  repo: string | null; // base AIRPORT의 본 체크아웃
  briefing: string;
  permissionMode?: unknown;
  model?: unknown;
  settings?: string; // `--settings`로 줄 JSON(ATC-372): 서버가 발권 기록에서 만든 K3 FLIGHT의 autoMode.allow뿐. 요청 본문에서는 받지 않는다
}

export interface LaunchPlan {
  registration: string;
  cwd: string;
  permissionMode: PermissionMode;
  model: string | null;
  args: string[];
  // ATC-147: 띄울 ACCOUNT의 라벨과 CLAUDE_CONFIG_DIR로 줄 폴더(~/.claude나 등록부가 없으면 null = 환경을 바꾸지 않음)
  account: string | null;
  configDir: string | null;
}
const configDirOf = (account: AccountFolder | null | undefined) => (account && account.dir !== config.claudeDir ? account.dir : null);

const sameName = (row: AgentRow, reg: string) => sameReg(row.name, reg); // `Team G` 세션도 TEAM_G(ATC-67)

// 띄울 수 있는지 보고 claude 인자를 만든다(순수)
export function launchPlanOf(input: LaunchInput, rows: AgentRow[], max = MAX_LAUNCHED, account: AccountFolder | null = null, idleOf: (row: AgentRow) => number | null = () => null, registry: readonly string[] = []): LaunchPlan {
  const reg = regKey(input.registration); // 새 세션은 정식 REGISTRATION으로 띄운다(ATC-67)
  rows = liveRowsOf(rows); // STALE 줄은 이미 떠 있는 세션도, 상한도 아니다(ATC-93)
  if (input.retired) throw new ControlError(`${reg}는 RETIRED — 먼저 복귀시킨다`, 409);
  if (!input.repo) throw new ControlError(`${reg}의 base AIRPORT 저장소를 모름 — 프로필에서 base를 정한다`, 409);
  const live = rows.find((r) => sameName(r, reg));
  if (live) throw new ControlError(`${reg} 세션이 이미 떠 있음(${live.kind === "background" ? `bg ${live.id}` : "interactive"})`, 409);
  const launched = rows.filter((r) => r.kind === "background").length;
  if (launched >= max) throw new ControlError(`백그라운드 세션 ${launched}개 — 상한 ${max}(ATC_MAX_LAUNCHED) · ${capHoldersText(capHoldersOf(rows, registry, idleOf))}`, 409);
  // ACCOUNT별 상한(ATC-147, 등록부 maxLaunched): 그 ACCOUNT 폴더에서 읽은 백그라운드 세션 수
  if (account?.maxLaunched) {
    const n = rows.filter((r) => r.kind === "background" && r.account === account.label).length;
    if (n >= account.maxLaunched) throw new ControlError(`ACCOUNT ${account.label}의 백그라운드 세션 ${n}개 — 상한 ${account.maxLaunched}(등록부 maxLaunched)`, 409);
  }
  const mode = input.permissionMode ?? DEFAULT_PERMISSION_MODE;
  if (!PERMISSION_MODES.includes(mode as PermissionMode)) throw new ControlError(`permission mode는 ${PERMISSION_MODES.join(" | ")}`, 400);
  const model = typeof input.model === "string" && input.model.trim() ? input.model.trim() : null;
  if (model && !/^[\w.:[\]-]+$/.test(model)) throw new ControlError(`모델 이름이 이상함: ${model}`, 400);
  const args = ["--bg", "-n", reg, "--permission-mode", mode as string, ...(model ? ["--model", model] : []), ...(input.settings ? ["--settings", input.settings] : []), input.briefing];
  return { registration: reg, cwd: input.repo, permissionMode: mode as PermissionMode, model, args, account: account?.label ?? null, configDir: configDirOf(account) };
}

// ── 어느 ACCOUNT에서 띄우나(ATC-147, 순수) ──
// 등록부가 없으면 null(전과 같다: ~/.claude, 환경 변경 없음). 이름을 대면 그 ACCOUNT, 없으면 LAUNCH ACCOUNT(ATC-239, 그 종류의 설정. 등록부에 없으면 무시),
// 없으면 fallback(카드 승인이 넘기는 마지막 LAUNCH의 ACCOUNT. 등록부에 없으면 무시), 없으면 home(AIRCRAFT 프로필·관제 세션 라벨).
// home 라벨이 등록부에 없으면 ~/.claude로 간다. 로그인이 안 됐거나 FUEL hold 수준인 ACCOUNT는 사유와 함께 거절한다(loggedIn null=모름은 막지 않는다)
export interface AccountStatus {
  loggedIn: boolean | null;
  hold: string | null; // FUEL hold 수준이면 그 글("FUEL 사용 97% until 21:00Z")
}
export function launchAccountOf(input: { requested?: unknown; preferred?: string | null; fallback?: string | null; home?: string | null; folders: readonly AccountFolder[]; status: (label: string) => AccountStatus | null }): AccountFolder | null {
  const { folders } = input;
  const asked = input.requested === undefined || input.requested === null || input.requested === "" ? null : input.requested;
  if (!observedLabelsOn(folders)) {
    if (asked !== null) throw new ControlError("ACCOUNT 등록부가 비어 있음 — 설정 창 AGENTS 탭의 ACCOUNTS에서 먼저 등록한다", 409);
    return null;
  }
  const label = asked === null ? null : typeof asked === "string" ? asked.trim().toLowerCase() : "";
  if (label !== null && !/^[a-z0-9][a-z0-9-]{0,23}$/.test(label)) throw new ControlError("ACCOUNT는 등록부의 라벨(소문자·숫자·-)", 400);
  const home = (input.home ?? "").trim().toLowerCase();
  const dflt = folders.find((f) => f.dir === config.claudeDir);
  const pref = input.preferred ? folders.find((f) => f.label === input.preferred) : undefined; // 이름을 대지 않은 LAUNCH의 기본(ATC-239). 이름을 댄 요청이 늘 이긴다
  const back = input.fallback ? folders.find((f) => f.label === input.fallback) : undefined; // LAUNCH ACCOUNT보다 뒤, home보다 앞
  const folder = label !== null ? folders.find((f) => f.label === label) : (pref ?? back ?? folders.find((f) => f.label === home) ?? dflt);
  if (!folder) throw new ControlError(`등록되지 않은 ACCOUNT: ${label} (등록: ${folders.map((f) => f.label).join(", ")})`, 404);
  const st = input.status(folder.label);
  if (st?.loggedIn === false) throw new ControlError(`ACCOUNT ${folder.label}는 로그인되어 있지 않음 — SUPERVISOR가 그 폴더에서 claude auth login을 한다`, 409);
  if (st?.hold) throw new ControlError(`ACCOUNT ${folder.label}는 FUEL hold 수준: ${st.hold}`, 409);
  return folder;
}

// ── 관제 세션(docs/fleet.md 8.5.1) ──
// TOWER·OCC·MCC·CROSSCHECK·REVIEW는 atc 저장소의 관제 폴더에서 `claude --bg`로 띄운다. 폴더의 .claude/settings.json(모델·허용 목록·
// fail-closed guard)이 그대로 걸린다. 첫 메시지는 그 폴더의 주기 명령. 권한 모드는 auto로 고정한다(백그라운드 세션은 권한 창에 답할 수 없고,
// 막는 일은 guard가 한다). CROSSCHECK·REVIEW를 tmux의 `ocx claude`로 띄우던 길(ATC-66)은 2026-09-29에 끊었다(둘 다 Claude로 돈다).
// tmux pane에서 손으로 연 세션도 알아보고 STOP한다(그 pane만 닫음).
// ENGINEERING은 저장소 뿌리에서 여는 작업 세션이라 이름으로만 알아보고 띄우지 않는다(배지만)
export interface ControlSpec {
  name: string;
  dir: string | null; // atc 저장소 안의 폴더. null이면 이름으로만 안다
  prompt: string | null; // 첫 메시지
  flags: string[];
  launch: "bg" | null;
}
export const CONTROL_SESSIONS: readonly ControlSpec[] = [
  { name: "TOWER", dir: "controller", prompt: "/loop 3m /tick", flags: [], launch: "bg" },
  { name: "OCC", dir: "occ", prompt: "/loop 10m /tick", flags: [], launch: "bg" },
  { name: "MCC", dir: "mcc", prompt: "/loop 5m /tick", flags: ["--strict-mcp-config"], launch: "bg" },
  { name: "CROSSCHECK", dir: "crosscheck", prompt: "/loop 10m /tick", flags: ["--strict-mcp-config"], launch: "bg" },
  { name: "REVIEW", dir: "review", prompt: "/loop 10m /tick", flags: ["--strict-mcp-config"], launch: "bg" },
  { name: "ENGINEERING", dir: null, prompt: null, flags: [], launch: null },
];
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const realDir = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
export const controlDirOf = (spec: ControlSpec, root = REPO_ROOT) => (spec.dir ? realDir(join(root, spec.dir)) : null);
export const controlSpecOf = (name: string) => CONTROL_SESSIONS.find((s) => s.name === name.toUpperCase()) ?? null;

// 이 관제 세션으로 보는 세션: 이름이 같거나(대소문자 무시), 그 폴더에서 연 세션(tmux로 이름 없이 띄운 것도). 폴더가 없으면 이름으로만
// STALE 줄은 빼고(ATC-93) 따로 controlStaleOf로 보인다
const ofControl = (spec: ControlSpec, r: AgentRow, dir: string | null) => sameName(r, spec.name) || (dir !== null && realDir(r.cwd) === dir);
export function controlRowsOf(spec: ControlSpec, rows: AgentRow[], dir: string | null): AgentRow[] {
  return rows.filter((r) => !r.stale && ofControl(spec, r, dir));
}
export function controlStaleOf(spec: ControlSpec, rows: AgentRow[], dir: string | null): AgentRow[] {
  return rows.filter((r) => r.stale && ofControl(spec, r, dir));
}
const staleOnly = (who: string, stale: AgentRow[]) => new ControlError(`${who}는 STALE ${stale.map((r) => r.id).join(", ")}만 있음 — ${STALE_NOTE}. 다시 멈출 것이 없다`, 409);
// 관제 폴더에서 연 세션인가(팀 세션 상한에서 뺀다)
export const isControlRow = (row: AgentRow, dirs: readonly string[]) => CONTROL_SESSIONS.some((s) => sameName(row, s.name)) || dirs.includes(realDir(row.cwd));

// 같은 관제 세션이 어떤 종류로든 떠 있으면 거절(두 벌이 같은 일을 하지 않게)
function refuseLive(spec: ControlSpec, rows: AgentRow[], dir: string | null) {
  const live = controlRowsOf(spec, rows, dir)[0];
  if (live) throw new ControlError(`${spec.name} 세션이 이미 떠 있음(${live.kind === "background" ? `bg ${live.id}` : `interactive ${live.name ?? ""}`.trim()})`, 409);
}

// LAUNCH할 수 있는지 보고 claude 인자를 만든다(순수)
export function controlLaunchPlanOf(spec: ControlSpec, rows: AgentRow[], dir: string, account: AccountFolder | null = null): { cwd: string; args: string[]; account?: string; configDir?: string } {
  refuseLive(spec, rows, dir);
  // ACCOUNT를 안 주면(등록부 없음) 전과 같은 모양 그대로
  return { cwd: dir, args: ["--bg", "-n", spec.name, "--permission-mode", "auto", ...spec.flags, spec.prompt ?? ""], ...(account ? { account: account.label, ...(configDirOf(account) ? { configDir: configDirOf(account)! } : {}) } : {}) };
}

// LAUNCH를 막는 이유(순수). ENGINEERING은 배지만
export function launchBlockOf(spec: ControlSpec): string | null {
  return spec.launch === null ? "배지만 — 저장소 뿌리에서 연다" : null;
}

// PATH에서 실행 파일을 찾는다(없으면 null)
export function findBin(name: string, dirs: readonly string[], exists: (p: string) => boolean = isExecutable): string | null {
  for (const d of dirs) if (d && exists(join(d, name))) return join(d, name);
  return null;
}
function isExecutable(p: string) {
  try {
    accessSync(p, constants.X_OK);
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
// tmux pane 하나(`tmux list-panes -a`)
export interface TmuxPane {
  session: string;
  pane: string; // "%4"
  pid: number; // pane의 첫 프로세스
}
// 이 pid가 도는 tmux pane(순수): pid 자신이나 조상이 pane의 첫 프로세스면 그 pane. parentOf는 부모 pid(모르면 null)
export function tmuxPaneOf(pid: number | undefined, panes: readonly TmuxPane[], parentOf: (pid: number) => number | null): TmuxPane | null {
  for (let cur: number | null | undefined = pid, i = 0; cur && cur > 1 && i < 20; cur = parentOf(cur), i++) {
    const hit = panes.find((p) => p.pid === cur);
    if (hit) return hit;
  }
  return null;
}

// STOP할 대상(순수): 백그라운드 세션이면 `claude stop`, tmux pane에서 도는 세션이면 그 pane만 닫는다.
// 데스크톱(Claude 앱) 세션은 atc가 닫지 않는다 — 그 창에서 닫는다
export type StopTarget = { how: "background"; row: AgentRow } | { how: "tmux"; row: AgentRow; pane: TmuxPane };
export function controlStopTargetOf(spec: ControlSpec, rows: AgentRow[], dir: string | null, paneOf: (row: AgentRow) => TmuxPane | null = () => null): StopTarget {
  const mine = controlRowsOf(spec, rows, dir);
  if (!mine.length) {
    const stale = controlStaleOf(spec, rows, dir);
    if (stale.length) throw staleOnly(spec.name, stale);
    throw new ControlError(`${spec.name} 세션이 떠 있지 않음`, 404);
  }
  const bg = mine.find((r) => r.kind === "background" && r.id);
  if (bg) return { how: "background", row: bg };
  for (const row of mine) {
    const pane = paneOf(row);
    if (pane) return { how: "tmux", row, pane };
  }
  throw new ControlError(`${spec.name}는 데스크톱 세션 — 그 창에서 닫는다`, 409);
}

// /proc/<pid>/stat의 부모 pid. 이름에 공백·괄호가 있어도 마지막 ')' 뒤로 읽는다
export function parentPidOf(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    return Number.isInteger(ppid) && ppid > 0 ? ppid : null;
  } catch {
    return null;
  }
}

// tmux pane 목록. tmux가 없거나 서버가 없으면 빈 목록
export function tmuxPanes(bin = tmuxBin() ?? "tmux"): Promise<TmuxPane[]> {
  return new Promise((resolve) => {
    execFile(bin, ["list-panes", "-a", "-F", "#{session_name}\t#{pane_id}\t#{pane_pid}"], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve([]);
      resolve(
        stdout
          .split("\n")
          .filter(Boolean)
          .map((l) => l.split("\t"))
          .map(([session, pane, pid]) => ({ session, pane, pid: Number(pid) }))
          .filter((p) => /^%\d+$/.test(p.pane) && Number.isInteger(p.pid)),
      );
    });
  });
}

// `claude agents --json` 한 줄의 출처(ATC-76): background면 그대로, 아니면 pid의 명령줄(읽기만, pid마다 캐시)
export const rowOriginOf = (row: Pick<AgentRow, "kind" | "pid">): SessionOrigin => sessionProcOf(row.pid ?? null, row.kind).origin;

// 멈출 백그라운드 세션(순수, originOf는 주입). 출처가 background가 아니면 atc가 멈추지 않고, 그 출처의 손 절차를 사유로 돌려준다
export function stopTargetOf(registration: string, rows: AgentRow[], originOf: (row: AgentRow) => SessionOrigin = (r) => (r.kind === "background" ? "background" : "unknown")): AgentRow {
  const reg = regKey(registration);
  const row = rows.find((r) => !r.stale && sameName(r, reg));
  if (!row) {
    const stale = rows.filter((r) => r.stale && sameName(r, reg));
    if (stale.length) throw staleOnly(reg, stale);
    throw new ControlError(`${reg} 세션이 떠 있지 않음`, 404);
  }
  const origin = originOf(row);
  if (!isBackground(origin) || !row.id) throw new ControlError(manualStepsOf(origin, reg, "stop"), 409);
  return row;
}

// `claude --bg`의 출력: "backgrounded · efbbe208 · TEAM_K"
export function jobIdOf(out: string): string | null {
  return /backgrounded\s*·\s*([0-9a-f]{6,})\s*·/.exec(out)?.[1] ?? null;
}

// 깨끗한 환경은 clean-env.ts(ATC-147: ACCOUNT의 폴더면 CLAUDE_CONFIG_DIR 하나만 더한다)
export { cleanEnv };
// tmux pane에서 연 관제 세션을 알아보고 닫을 때 쓰는 tmux. 서버의 PATH와 깨끗한 PATH에서 찾는다
export function tmuxBin(): string | null {
  return findBin("tmux", [...(process.env.PATH ?? "").split(":"), ...cleanPath()]);
}

// LAUNCH는 atc 서비스 밖의 systemd scope에서 claude를 부른다. `claude --bg`는 처음 부를 때 이 기계의 백그라운드 세션을 모두 맡는
// daemon(`claude daemon run`)을 띄우는데, atc 안에서 띄우면 daemon이 atc.service cgroup에 들어가 atc를 재시작할 때마다(배포·RTS)
// 모든 백그라운드 세션이 함께 죽는다(2026-09-28 OCC a578bf15). ATC_BG_SCOPE=off면 예전처럼 바로 부른다
// OOMPolicy=continue: scope 안의 프로세스 하나가 OOM으로 죽어도 scope(daemon과 모든 세션)는 두고 그 프로세스만 죽는다.
// 기본값 stop이면 세션 하나의 테스트가 부푼 것만으로 백그라운드 세션이 모두 끝난다(2026-09-30 08:54Z, 12개)
const SYSTEMD_RUN = "/usr/bin/systemd-run";
export function launchCommandOf(bin: string, args: string[], scope: string | null, unit: string): { cmd: string; args: string[] } {
  return scope ? { cmd: scope, args: ["--user", "--scope", "--collect", "--quiet", "-p", "OOMPolicy=continue", `--unit=${unit}`, "--", bin, ...args] } : { cmd: bin, args };
}
const scopeBin = () => (process.env.ATC_BG_SCOPE !== "off" && existsSync(SYSTEMD_RUN) ? SYSTEMD_RUN : null);

function claude(args: string[], cwd?: string, { scope = false, configDir = null as string | null } = {}): Promise<{ ok: boolean; out: string }> {
  const { cmd, args: argv } = launchCommandOf(config.claudeBin, args, scope ? scopeBin() : null, `atc-claude-${Date.now()}`);
  return new Promise((resolve) => {
    execFile(cmd, argv, { cwd, env: cleanEnv(configDir), timeout: 60_000, maxBuffer: 4 << 20 }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: `${stdout}${stderr}`.trim() }),
    );
  });
}

// 백그라운드 세션 daemon이 atc 서비스 cgroup 안에 있나(순수: cgroup 줄들). 있으면 atc를 재시작할 때 모든 백그라운드 세션이 죽는다
export const inServiceCgroup = (cgroups: readonly string[], unit = "atc.service") => cgroups.some((c) => c.split("/").includes(unit));
// 도는 `claude daemon run`들의 cgroup
export function daemonCgroups(): string[] {
  const out: string[] = [];
  let pids: string[] = [];
  try {
    pids = readdirSync("/proc").filter((p) => /^\d+$/.test(p));
  } catch {
    return out;
  }
  for (const pid of pids) {
    try {
      const argv = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
      if (!argv.some((a) => /(^|\/)claude$/.test(a)) || argv[1] !== "daemon" || argv[2] !== "run") continue;
      out.push(readFileSync(`/proc/${pid}/cgroup`, "utf8").trim());
    } catch {}
  }
  return out;
}

// 그 폴더의 백그라운드 daemon이 떠 있나(ATC-147). daemon.status.json의 supervisorPid가 살아 있고 daemon 명령줄이면 참.
// 안 떠 있는 폴더에서 `claude agents`를 부르면 daemon을 atc.service 안에서 새로 띄울 수 있어서(scope 밖) 부르지 않는다. 읽기만
export function daemonUpIn(dir: string): boolean {
  try {
    const pid = (JSON.parse(readFileSync(join(dir, "daemon.status.json"), "utf8")) as { supervisorPid?: unknown }).supervisorPid;
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 1) return false;
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").includes("daemon");
  } catch {
    return false;
  }
}

// 등록된 모든 폴더의 `claude agents --json`(ATC-147). 폴더마다 자기 CLAUDE_CONFIG_DIR로 부르고 줄에 ACCOUNT를 붙여 합친다.
// ~/.claude는 늘 부른다(전과 같다: 실패하면 던진다). 다른 폴더는 daemon이 떠 있을 때만 부르고, 못 읽으면 failed에 라벨만 남긴다
export async function agentRowsOf(folders: readonly AccountFolder[] = accountFolders()): Promise<{ rows: AgentRow[]; failed: string[] }> {
  const labeled = observedLabelsOn(folders);
  const rows: AgentRow[] = [];
  const failed: string[] = [];
  const now = Date.now();
  for (const f of folders) {
    const isDefault = f.dir === config.claudeDir;
    if (!isDefault && !daemonUpIn(f.dir)) continue;
    const r = await claude(["agents", "--json"], undefined, { configDir: f.dir });
    let list: AgentRow[] | null = null;
    if (r.ok) {
      try {
        list = JSON.parse(r.out) as AgentRow[];
      } catch {}
    }
    if (!list) {
      if (isDefault) throw new ControlError(r.ok ? "claude agents 출력을 읽지 못함" : `claude agents 실패: ${r.out.slice(0, 300)}`, 502);
      failed.push(f.label);
      continue;
    }
    // STALE 표시(ATC-93): pid·status 없는 background 줄만 그 job 파일의 state 한 칸을 읽는다(쓰지 않는다)
    for (const row of list) {
      if (row.kind === "background" && row.pid == null && row.status == null && row.id) row.stale = isStaleRow(row, jobStateOf(row.id, [join(f.dir, "jobs")]), now);
      if (labeled) row.account = f.label;
      const attachDir = row.kind === "background" ? attachDirOf(f.dir, config.claudeDir, config.home) : undefined;
      if (attachDir) row.attachDir = attachDir;
    }
    rows.push(...list);
  }
  return { rows, failed };
}

export async function agentRows(): Promise<AgentRow[]> {
  return (await agentRowsOf()).rows;
}

// 한 줄이 있는 폴더(stop·respawn은 그 세션의 폴더로 부른다). 라벨이 없으면 ~/.claude
export const configDirOfRow = (row: Pick<AgentRow, "account">, folders: readonly AccountFolder[] = accountFolders()) => configDirOf(folderOfAccount(row.account, folders));

// ~/.claude/jobs/<id>/state.json의 state. 없거나 못 읽으면 null(STALE로 보지 않는다)
// dirs: 볼 jobs/ 폴더들(기본은 등록된 모든 폴더, ATC-146). 처음 읽은 state를 돌려준다
export function jobStateOf(id: string, dirs: readonly string[] = accountFolders().map((f) => join(f.dir, "jobs"))): string | null {
  if (!/^[0-9a-f]{6,}$/.test(id)) return null;
  for (const dir of dirs) {
    try {
      const state = (JSON.parse(readFileSync(join(dir, id, "state.json"), "utf8")) as { state?: unknown }).state;
      if (typeof state === "string") return state;
    } catch {}
  }
  return null;
}

// GET /api/control/sessions만 쓴다(헤더 CONTROL 띠와 FLEET가 함께, ATC-127). LAUNCH·STOP의 판단은 늘 agentRows()로 새로 읽는다
const cachedAgentRows = ttlCache(agentRows);

// 등록된 ACCOUNT마다 로그인 여부와 FUEL hold 글(ATC-147). FUEL은 스냅샷의 ACCOUNT별 값, 로그인은 claude auth status(loggedIn만, 60초 캐시)
export async function accountStatusesOf(fuelAccounts: Snapshot["fuelAccounts"], folders: readonly AccountFolder[] = accountFolders(), now = Date.now()): Promise<Map<string, AccountStatus>> {
  const out = new Map<string, AccountStatus>();
  if (!observedLabelsOn(folders)) return out;
  await Promise.all(
    folders.map(async (f) => {
      const auth = await authStatusOf(f.dir);
      const fuel = (fuelAccounts ?? []).find((x) => x.account === f.label);
      const hold = fuel?.level === "hold" ? `FUEL 사용 ${Math.round(fuel.top.pct)}% until ${new Date(fuel.top.resetsAt).toISOString().slice(11, 16)}Z` : null;
      out.set(f.label, { loggedIn: auth.loggedIn, hold });
    }),
  );
  return out;
}

// LAUNCH 전에 그 ACCOUNT로 띄울 수 있는지만 본다(ATC-148): 로그인·FUEL hold·미등록. 거절 사유(없으면 null).
// ACCOUNT CHANGE는 STOP 다음에 LAUNCH를 하므로, 새 ACCOUNT가 거절할 것을 알고도 옛 세션을 멈추는 일이 없게 STOP 전에 부른다
export async function launchAccountRefusal(account: string, fuelAccounts: Snapshot["fuelAccounts"], folders: readonly AccountFolder[] = accountFolders()): Promise<string | null> {
  try {
    const statuses = await accountStatusesOf(fuelAccounts, folders);
    launchAccountOf({ requested: account, folders, status: (l) => statuses.get(l) ?? null });
    return null;
  } catch (e) {
    if (e instanceof ControlError) return e.message;
    throw e;
  }
}

export interface ControlResult {
  ok: boolean;
  status: number; // 실패면 HTTP 상태
  jobId?: string;
  tmux?: string; // tmux에서 멈춘 관제 세션의 tmux 세션 이름
  cwd?: string;
  permissionMode?: PermissionMode;
  model?: string | null;
  modelFrom?: string; // 모델을 어디서 골랐나(launch-model.ts ModelFrom, ATC-279)
  account?: string | null; // 띄운 ACCOUNT 라벨(등록부가 없으면 없다)
  error?: string;
}

// LAUNCH: FLEET 카드 버튼과 FLEET PLAN 승인(8.7), DISPATCH launch 카드 승인(ATC-129)이 같이 쓴다. 결과는 FLIGHT RECORDER에 by와 함께 남는다.
// proposal: launch 카드로 띄웠으면 그 제안 id(기록에 남는다)
export async function launchAircraft(s: Snapshot, registration: string, options: { permissionMode?: unknown; model?: unknown; lastModel?: string | null; account?: unknown; lastAccount?: string | null; promptOf?: (briefing: string) => string; flight?: string }, by: string, proposal?: string, k3Of?: (repo: string) => K3Launch | null): Promise<ControlResult> {
  // k3Of(ATC-372)는 옵션이 아니라 따로 받는다: 옵션은 LAUNCH 라우트의 본문이 펼쳐져 들어오므로, 본문이 allow 항목을 실을 수 없어야 한다. repo는 base 저장소(STAND가 생길 곳)
  const reg = regKey(registration);
  const cfg = loadDispatchConfig();
  const a = fleetView(s, loadFleet(), cfg.teamPattern).find((x) => x.registration === reg);
  if (!a) return { ok: false, status: 404, error: `FLEET에 없음: ${reg}` };
  const repo = s.airports.find((x) => x.code === a.base)?.repo ?? null;
  const k3 = repo ? (k3Of?.(repo) ?? null) : null;
  const t = new Date().toISOString();
  try {
    // 관제 세션은 팀 세션 상한(ATC_MAX_LAUNCHED)에 세지 않는다
    const dirs = CONTROL_SESSIONS.map((c) => controlDirOf(c)).filter((d): d is string => d !== null);
    const folders = accountFolders();
    const read = await agentRowsOf(folders);
    const rows = read.rows.filter((r) => !isControlRow(r, dirs));
    // ACCOUNT(ATC-147): 이름을 댔으면 그것, 아니면 AIRCRAFT의 home. 로그인 안 됨·FUEL hold는 사유와 함께 거절
    const home = loadFleet().aircraft[fleetKeyOf(Object.keys(loadFleet().aircraft), reg, cfg.teamPattern) ?? ""]?.account ?? null;
    const statuses = await accountStatusesOf(s.fuelAccounts, folders);
    const account = launchAccountOf({ requested: options.account, preferred: loadFleet().launchAccount?.aircraft ?? null, fallback: options.lastAccount ?? null, home, folders, status: (l) => statuses.get(l) ?? null });
    if (account && read.failed.includes(account.label)) throw new ControlError(`ACCOUNT ${account.label}의 세션 목록을 읽지 못함 — 이미 떠 있는지 몰라 띄우지 않는다`, 502);
    // 모델(ATC-279): 양식에 적은 것 > AIRCRAFT > AIRPORT > 기본 > 마지막 LAUNCH(lastModel) > 없음. 모든 AIRCRAFT LAUNCH 길이 여기를 지난다
    const picked = launchModelOf({ registration: reg, airport: a.base ?? null, explicit: typeof options.model === "string" ? options.model : null, last: options.lastModel ?? null, setting: loadFleet().launchModel });
    const plan = launchPlanOf({ registration: reg, retired: !!a.retired, repo, briefing: ((b) => (options.promptOf ? options.promptOf(b) : b))(crewBriefing(a, repo, cfg.mode, true)), permissionMode: options.permissionMode, model: picked.model, ...(k3 ? { settings: k3.settings } : {}) }, rows, MAX_LAUNCHED, account, (row) => idleMinOfRow(row, s.sessions), Object.keys(loadFleet().aircraft));
    const r = await claude(plan.args, plan.cwd, { scope: true, configDir: plan.configDir });
    const jobId = jobIdOf(r.out);
    const ok = r.ok && !!jobId;
    const error = ok ? undefined : /not trusted/i.test(r.out) ? `${plan.cwd}를 신뢰하지 않음 — 그 폴더에서 claude를 한 번 열어 trust를 수락한다` : r.out.slice(0, 300) || "claude --bg 실패";
    record({ t, kind: "fleet", op: "launch", aircraft: reg, by, ok, jobId: jobId ?? undefined, cwd: plan.cwd, permissionMode: plan.permissionMode, model: plan.model ?? undefined, modelFrom: plan.model ? picked.from : "none", ...(plan.account ? { account: plan.account } : {}), error, ...(proposal ? { proposal } : {}), ...(options.flight || k3 ? { flight: k3?.flight ?? options.flight } : {}), ...(k3 ? { k3: { release: k3.release, stand: k3.stand, entries: k3.entries } } : {}) });
    return ok ? { ok, status: 200, jobId: jobId!, cwd: plan.cwd, permissionMode: plan.permissionMode, model: plan.model, modelFrom: plan.model ? picked.from : "none", account: plan.account } : { ok, status: 502, error };
  } catch (e) {
    // 띄우기 전에 거절된 것(상한, 이미 떠 있음, RETIRED …)도 launch 카드로 온 것이면 남긴다
    if (e instanceof ControlError) {
      if (proposal) record({ t, kind: "fleet", op: "launch", aircraft: reg, by, ok: false, error: e.message, proposal });
      return { ok: false, status: e.status, error: e.message };
    }
    throw e;
  }
}

// STOP: 백그라운드 세션만 멈춘다
export async function stopAircraft(registration: string, by: string): Promise<ControlResult> {
  const reg = regKey(registration);
  const t = new Date().toISOString();
  try {
    const row = stopTargetOf(reg, await agentRows(), rowOriginOf);
    const r = await claude(["stop", row.id as string], undefined, { configDir: configDirOfRow(row) }); // 그 세션의 폴더(ATC-147)
    const error = r.ok ? undefined : r.out.slice(0, 300) || "claude stop 실패";
    record({ t, kind: "fleet", op: "stop", aircraft: reg, by, ok: r.ok, jobId: row.id, cwd: row.cwd, ...(row.account ? { account: row.account } : {}), error });
    return r.ok ? { ok: true, status: 200, jobId: row.id } : { ok: false, status: 502, error };
  } catch (e) {
    if (e instanceof ControlError) return { ok: false, status: e.status, error: e.message };
    throw e;
  }
}

export async function launchControl(name: string, by: string, requestedAccount?: unknown, fuelAccounts?: Snapshot["fuelAccounts"]): Promise<ControlResult> {
  const spec = controlSpecOf(name);
  if (!spec) return { ok: false, status: 404, error: `관제 세션이 아님: ${name} (${CONTROL_SESSIONS.map((c) => c.name).join(", ")})` };
  const dir = controlDirOf(spec);
  if (spec.launch === null || dir === null) return { ok: false, status: 409, error: `${spec.name}: ${launchBlockOf(spec)}` };
  const t = new Date().toISOString();
  try {
    const folders = accountFolders();
    const read = await agentRowsOf(folders);
    const statuses = await accountStatusesOf(fuelAccounts, folders);
    const account = launchAccountOf({ requested: requestedAccount, preferred: loadFleet().launchAccount?.control ?? null, home: loadFleet().control?.[spec.name as keyof NonNullable<FleetFile["control"]>]?.account ?? null, folders, status: (l) => statuses.get(l) ?? null });
    if (account && read.failed.includes(account.label)) throw new ControlError(`ACCOUNT ${account.label}의 세션 목록을 읽지 못함 — 이미 떠 있는지 몰라 띄우지 않는다`, 502);
    const plan = controlLaunchPlanOf(spec, read.rows, dir, account);
    const r = await claude(plan.args, plan.cwd, { scope: true, configDir: plan.configDir ?? null });
    const jobId = jobIdOf(r.out);
    const ok = r.ok && !!jobId;
    const error = ok ? undefined : /not trusted/i.test(r.out) ? `${plan.cwd}를 신뢰하지 않음 — 그 폴더에서 claude를 한 번 열어 trust를 수락한다` : r.out.slice(0, 300) || "claude --bg 실패";
    record({ t, kind: "control", op: "launch", session: spec.name, by, ok, jobId: jobId ?? undefined, cwd: plan.cwd, permissionMode: permissionModeOf(plan.args) ?? undefined, ...(plan.account ? { account: plan.account } : {}), error });
    return ok ? { ok, status: 200, jobId: jobId!, cwd: plan.cwd, permissionMode: "auto", account: plan.account ?? null } : { ok, status: 502, error };
  } catch (e) {
    if (e instanceof ControlError) return { ok: false, status: e.status, error: e.message };
    throw e;
  }
}

export async function stopControl(name: string, by: string): Promise<ControlResult> {
  const spec = controlSpecOf(name);
  if (!spec) return { ok: false, status: 404, error: `관제 세션이 아님: ${name}` };
  if (spec.launch === null) return { ok: false, status: 409, error: `${spec.name}: 배지만 — 그 창에서 닫는다` };
  const t = new Date().toISOString();
  try {
    const tmux = tmuxBin() ?? "tmux";
    const panes = await tmuxPanes(tmux);
    const target = controlStopTargetOf(spec, await agentRows(), controlDirOf(spec), (row) => tmuxPaneOf(row.pid, panes, parentPidOf));
    if (target.how === "tmux") {
      // 그 pane만 닫는다(tmux 세션의 다른 창은 그대로). 대화 기록은 남아 claude --resume으로 다시 연다
      const r = await new Promise<{ ok: boolean; out: string }>((resolve) =>
        execFile(tmux, ["kill-pane", "-t", target.pane.pane], { timeout: 5000 }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}`.trim() })),
      );
      const error = r.ok ? undefined : r.out.slice(0, 300) || "tmux kill-pane 실패";
      record({ t, kind: "control", op: "stop", session: spec.name, by, ok: r.ok, tmux: `${target.pane.session} ${target.pane.pane}`, cwd: target.row.cwd, error });
      return r.ok ? { ok: true, status: 200, tmux: target.pane.session } : { ok: false, status: 502, error };
    }
    const row = target.row;
    const r = await claude(["stop", row.id as string], undefined, { configDir: configDirOfRow(row) }); // 그 세션의 폴더(ATC-147)
    const error = r.ok ? undefined : r.out.slice(0, 300) || "claude stop 실패";
    record({ t, kind: "control", op: "stop", session: spec.name, by, ok: r.ok, jobId: row.id, cwd: row.cwd, ...(row.account ? { account: row.account } : {}), error });
    return r.ok ? { ok: true, status: 200, jobId: row.id } : { ok: false, status: 502, error };
  } catch (e) {
    if (e instanceof ControlError) return { ok: false, status: e.status, error: e.message };
    throw e;
  }
}

// ── 그 밖의 백그라운드 세션(ATC-184) ──
// 대화 기록이 마지막으로 바뀐 때(스냅샷 세션의 lastActiveAt). 스냅샷에 없으면 null이고 job의 updatedAt으로 물러난다
const lastActiveOfRow = (row: Pick<AgentRow, "sessionId">, sessions: Snapshot["sessions"]): string | null => sessions.find((x) => x.id === row.sessionId)?.lastActiveAt ?? null;
export function idleMinOfRow(row: Pick<AgentRow, "sessionId" | "id">, sessions: Snapshot["sessions"], now = Date.now()): number | null {
  const at = lastActiveOfRow(row, sessions) ?? readJob(row.id)?.writtenAt ?? null;
  return at && Number.isFinite(Date.parse(at)) ? Math.max(0, Math.floor((now - Date.parse(at)) / 60_000)) : null;
}
export function othersOf(rows: AgentRow[], sessions: Snapshot["sessions"], now = Date.now()): OtherBackground[] {
  const dirs = CONTROL_SESSIONS.map((c) => controlDirOf(c)).filter((d): d is string => d !== null);
  return otherBackgroundOf(rows, Object.keys(loadFleet().aircraft), CONTROL_SESSIONS.map((c) => c.name), {
    teamPattern: loadDispatchConfig().teamPattern,
    controlDirs: dirs,
    resolve: realDir,
    projectsRoot: config.projectsDir,
    jobOf: (id) => settleJob(readJob(id)) ?? null,
    lastActiveOf: (row) => lastActiveOfRow(row as AgentRow, sessions),
    now,
  });
}

// STOP: 그 밖의 백그라운드 세션 하나. SUPERVISOR가 누를 때만 하고, 지금 "그 밖"으로 읽히는 id만 멈춘다(AIRCRAFT·관제 세션은 여기로 멈추지 않는다)
export async function stopOther(id: string, by: string, sessions: Snapshot["sessions"]): Promise<ControlResult> {
  const t = new Date().toISOString();
  try {
    if (!/^[0-9a-f]{6,}$/.test(id)) throw new ControlError("세션 id가 올바르지 않음", 400);
    const rows = await agentRows();
    const target = othersOf(rows, sessions).find((o) => o.id === id);
    if (!target) throw new ControlError(`그 밖의 백그라운드 세션이 아님: ${id} — 이미 끝났거나 AIRCRAFT·관제 세션이다`, 404);
    const row = rows.find((r) => r.id === id)!;
    const r = await claude(["stop", id], undefined, { configDir: configDirOfRow(row) }); // 그 세션의 폴더(ATC-147)
    const error = r.ok ? undefined : r.out.slice(0, 300) || "claude stop 실패";
    record({ t, kind: "other", op: "stop", session: target.name, by, ok: r.ok, jobId: id, cwd: row.cwd, ...(row.account ? { account: row.account } : {}), error });
    return r.ok ? { ok: true, status: 200, jobId: id } : { ok: false, status: 502, error };
  } catch (e) {
    if (e instanceof ControlError) return { ok: false, status: e.status, error: e.message };
    throw e;
  }
}

export function mountSessionControl(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  // 관제 세션(8.5.1): 설정 창 AGENTS 탭의 CONTROL 블록이 쓴다
  app.get("/api/control/sessions", async (c) => {
    try {
      const [rows, panes, snap] = await Promise.all([cachedAgentRows.get(c.req.query("fresh") === "1"), tmuxPanes(tmuxBin() ?? "tmux"), getSnapshot().catch(() => null)]);
      const squelch = readSquelchLast();
      const sessionsNow = snap?.sessions ?? [];
      return c.json({
        // 백그라운드 세션 daemon이 atc 서비스 안에 있으면 atc 재시작(배포·RTS) 때 모든 백그라운드 세션이 죽는다
        daemonInService: inServiceCgroup(daemonCgroups()),
        sessions: CONTROL_SESSIONS.map((spec) => ({
          name: spec.name,
          dir: spec.dir,
          prompt: spec.prompt,
          // bg: claude --bg, null: 배지만. blocked는 LAUNCH를 끈 이유
          launch: spec.launch,
          squelch: squelchOfName(squelch, spec.name),
          blocked: launchBlockOf(spec),
          live: controlRowsOf(spec, rows, controlDirOf(spec)).map(({ id, name, kind, status, pid }) => ({ id, name, kind, status, job: kind === "background" ? settleJob(readJob(id)) ?? null : null, tmux: kind === "background" ? undefined : tmuxPaneOf(pid, panes, parentPidOf)?.session })),
          // STALE(ATC-93): 멈췄는데 Claude Code가 아직 목록에 둔 job. live에 들지 않고 LAUNCH를 막지 않는다
          stale: controlStaleOf(spec, rows, controlDirOf(spec)).map(({ id, name }) => ({ id, name })),
        })),
        // ACCOUNT(ATC-60): 관제 세션마다 SUPERVISOR가 단 라벨(없으면 null). FUEL이 이 ACCOUNT에 센다
        accounts: controlAccountsView(loadFleet()),
        // 그 밖의 백그라운드 세션(ATC-184): AIRCRAFT도 관제 세션도 아닌데 ATC_MAX_LAUNCHED 자리를 쥔 것. STALE은 없다
        others: othersOf(rows, sessionsNow),
        max: MAX_LAUNCHED,
      });
    } catch (e) {
      if (e instanceof ControlError) return c.json({ error: e.message }, e.status as 502);
      throw e;
    }
  });
  // 관제 세션의 ACCOUNT 라벨(ATC-60). 세션 목록(claude agents)을 못 읽어도 라벨은 보이고 고칠 수 있게 따로 둔다
  app.get("/api/control/accounts", (c) => c.json(controlAccountsView(loadFleet())));
  // SUPERVISOR만: 이 화면 Origin이 있어야 받는다. null이나 ""면 지운다
  app.put("/api/control/:name/account", async (c: Context) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as { account?: unknown };
    try {
      const account = saveControlAccount(c.req.param("name") ?? "", body.account ?? null);
      console.log(`[atc] control account: ${(c.req.param("name") ?? "").toUpperCase()}=${account ?? "(none)"}`);
      return c.json({ ok: true, accounts: controlAccountsView(loadFleet()) });
    } catch (e) {
      if (e instanceof FleetError) return c.json({ error: e.message }, e.status as 400);
      throw e;
    }
  });
  app.post("/api/control/:name/launch", async (c: Context) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as { account?: unknown };
    const r = await launchControl(c.req.param("name") ?? "", "SUPERVISOR", body?.account, (await getSnapshot()).fuelAccounts);
    if (!r.ok) return c.json({ error: r.error }, r.status as 400);
    return c.json({ ok: true, jobId: r.jobId, tmux: r.tmux, cwd: r.cwd, account: r.account });
  });
  app.post("/api/control/:name/stop", async (c: Context) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const r = await stopControl(c.req.param("name") ?? "", "SUPERVISOR");
    if (!r.ok) return c.json({ error: r.error }, r.status as 400);
    return c.json({ ok: true, jobId: r.jobId, tmux: r.tmux });
  });

  // 그 밖의 백그라운드 세션 STOP(ATC-184): CONTROL STOP과 같은 Origin 검사. SUPERVISOR가 누를 때만 한다
  app.post("/api/control/others/:id/stop", async (c: Context) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const r = await stopOther(c.req.param("id") ?? "", "SUPERVISOR", (await getSnapshot()).sessions);
    if (!r.ok) return c.json({ error: r.error }, r.status as 400);
    return c.json({ ok: true, jobId: r.jobId });
  });

  // AIRCRAFT 이름과 같은 세션(데스크톱·터미널·백그라운드). FLEET 카드의 LAUNCH·STOP 버튼이 쓴다
  app.get("/api/fleet/sessions", async (c) => {
    try {
      const team = new RegExp(loadDispatchConfig().teamPattern, "i");
      const rows = (await agentRows()).filter((r) => team.test(r.name ?? ""));
      // stale: 멈췄는데 Claude Code가 아직 목록에 둔 job(ATC-93). 화면은 BG 대신 STALE로 보이고 LAUNCH를 막지 않는다
      // 자리를 쥔 쪽(ATC-184): 관제 세션과 STALE을 뺀 살아 있는 백그라운드 세션을 AIRCRAFT와 그 밖으로 나눈 글
      const dirs = CONTROL_SESSIONS.map((x) => controlDirOf(x)).filter((d): d is string => d !== null);
      const snap = await getSnapshot().catch(() => null);
      const counted = (await agentRows()).filter((r) => !isControlRow(r, dirs));
      const holders = capHoldersOf(counted, Object.keys(loadFleet().aircraft), (row) => idleMinOfRow(row as AgentRow, snap?.sessions ?? []), loadDispatchConfig().teamPattern);
      return c.json({ max: MAX_LAUNCHED, holders: capHoldersText(holders), launched: holders.aircraft + holders.other.length, permissionModes: PERMISSION_MODES, sessions: rows.map(({ id, sessionId, name, kind, status, cwd, stale, account }) => ({ id, sessionId, name, kind, status, cwd, ...(stale ? { stale } : {}), ...(account ? { account } : {}) })) });
    } catch (e) {
      if (e instanceof ControlError) return c.json({ error: e.message }, e.status as 502);
      throw e;
    }
  });

  // LAUNCH의 ACCOUNT 고르개(ATC-147): 등록된 ACCOUNT마다 띄울 수 있는지와 거절 사유. 등록부가 비면 빈 목록(고르개가 없다)
  app.get("/api/fleet/launch-accounts", async (c) => {
    const folders = accountFolders();
    const statuses = await accountStatusesOf((await getSnapshot()).fuelAccounts, folders);
    const dispatch = (await agentRowsOf(folders).catch(() => ({ rows: [] as AgentRow[], failed: [] as string[] }))).rows;
    const reg = observedLabelsOn(folders) ? folders.map((f) => f.label) : [];
    const setting = launchSettingOf(loadFleet().launchAccount);
    const eff = { aircraft: effectiveLaunchAccount(setting, "aircraft", reg), control: effectiveLaunchAccount(setting, "control", reg) };
    return c.json({
      // LAUNCH ACCOUNT(ATC-239): 지금 설정(등록부에 없는 라벨은 null)과 경고
      launchAccount: { aircraft: eff.aircraft.label, control: eff.control.label },
      launchAccountWarnings: [eff.aircraft.warning, eff.control.warning, launchSplitWarning({ aircraft: eff.aircraft.label, control: eff.control.label })].filter((w): w is string => w !== null),
      accounts: observedLabelsOn(folders)
        ? folders.map((f) => {
            const st = statuses.get(f.label);
            const n = dispatch.filter((r) => r.kind === "background" && !r.stale && r.account === f.label).length;
            const refused = st?.loggedIn === false ? "로그인되어 있지 않음" : st?.hold ? `FUEL hold 수준: ${st.hold}` : f.maxLaunched && n >= f.maxLaunched ? `ACCOUNT 상한 ${f.maxLaunched} 찼음` : null;
            return { label: f.label, loggedIn: st?.loggedIn ?? null, refused, maxLaunched: f.maxLaunched ?? null, running: n };
          })
        : [],
    });
  });

  // LAUNCH ACCOUNT를 바꾼다(ATC-239). SUPERVISOR만: 이 화면 Origin과 JSON Content-Type이 있어야 받는다(fromThisApp).
  // 본문에 적힌 칸만 바꾼다. 라벨은 등록부에 있어야 하고, null·""은 "각 home"으로 되돌린다. 돌고 있는 세션은 옮기지 않는다
  app.put("/api/fleet/launch-account", async (c: Context) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const folders = accountFolders();
    const reg = observedLabelsOn(folders) ? folders.map((f) => f.label) : [];
    const r = launchSettingPatchOf(launchSettingOf(loadFleet().launchAccount), await c.req.json().catch(() => null), reg);
    if (!r.ok) return c.json({ error: r.error }, r.status);
    saveLaunchAccount(r.next);
    console.log(`[atc] launch account: aircraft=${r.next.aircraft ?? "(각 home)"} control=${r.next.control ?? "(각 home)"}`);
    const split = launchSplitWarning(r.next); // ATC-251: 갈라진 설정은 저장되지만 경고한다
    return c.json({ ok: true, launchAccount: { aircraft: r.next.aircraft ?? null, control: r.next.control ?? null }, launchAccountWarnings: split ? [split] : [] });
  });

  // LAUNCH MODEL(ATC-279): 지금 설정과 고를 수 있는 AIRPORT·AIRCRAFT(설정 창 표). 읽기만
  app.get("/api/fleet/launch-model", async (c: Context) => {
    const s = await getSnapshot();
    const fleet = loadFleet();
    return c.json({ launchModel: launchModelSettingOf(fleet.launchModel), choices: MODEL_CHOICES, airports: s.airports.map((a) => a.code), aircraft: Object.keys(fleet.aircraft).sort() });
  });

  // LAUNCH MODEL을 바꾼다(ATC-279). SUPERVISOR만: 이 화면 Origin과 JSON Content-Type이 있어야 받는다(fromThisApp).
  // 본문에 적힌 칸만 바꾼다. null·""은 지운다("폴더 기본"). 바뀐 칸마다 FLIGHT RECORDER에 한 줄(from·to·by). 돌고 있는 세션은 옮기지 않는다
  app.put("/api/fleet/launch-model", async (c: Context) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const s = await getSnapshot();
    const fleet = loadFleet();
    const r = launchModelPatchOf(launchModelSettingOf(fleet.launchModel), await c.req.json().catch(() => null), { airports: s.airports.map((a) => a.code), aircraft: Object.keys(fleet.aircraft) });
    if (!r.ok) return c.json({ error: r.error }, r.status);
    saveLaunchModel(r.next);
    const t = new Date().toISOString();
    for (const ch of r.changes) record({ t, kind: "launch-model", by: "SUPERVISOR", scope: ch.scope, ...(ch.key ? { key: ch.key } : {}), from: ch.from, to: ch.to });
    console.log(`[atc] launch model: default=${r.next.default ?? "(폴더 기본)"} airports=${Object.keys(r.next.airports ?? {}).length} aircraft=${Object.keys(r.next.aircraft ?? {}).length}`);
    return c.json({ ok: true, launchModel: r.next });
  });

  app.post("/api/fleet/:registration/launch", async (c: Context) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const reg = regKey(c.req.param("registration"));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    // LAUNCH with a FLIGHT(ATC-73): 첫 프롬프트 = CREW BRIEFING + DIRECT 지시서(/api/dispatch/flight/<FLIGHT>/brief?to=<REG>)
    let withFlight: { promptOf: (briefing: string) => string; flight: string } | undefined;
    if (body.flight !== undefined && body.flight !== null && body.flight !== "") {
      const flight = typeof body.flight === "string" ? body.flight.trim().toUpperCase() : "";
      if (!/^[A-Z][A-Z0-9]*-\d+$/.test(flight)) return c.json({ error: "FLIGHT는 이슈 키(예: ATC-73)" }, 400);
      try {
        const { directBriefOf } = await import("./proposals.ts");
        const brief = await directBriefOf(flight, reg);
        withFlight = { promptOf: (b) => launchWithFlightPromptOf(b, brief), flight };
      } catch (e) {
        return c.json({ error: `${flight}의 지시서를 읽지 못함 — ${String((e as Error).message ?? e)}. 띄우지 않았다` }, 502);
      }
    }
    const { promptOf: _p, flight: _f, settings: _s, k3: _k, ...opts } = body; // 본문의 promptOf·flight·settings·k3는 옵션으로 넘기지 않는다(함수와 allow 항목은 서버만 만든다)
    const r = await launchAircraft(await getSnapshot(), reg, { ...opts, ...(withFlight ?? {}) }, "SUPERVISOR");
    if (!r.ok) return c.json({ error: r.error }, r.status as 400);
    return c.json({ ok: true, registration: reg, jobId: r.jobId, cwd: r.cwd, permissionMode: r.permissionMode, model: r.model, modelFrom: r.modelFrom, account: r.account });
  });

  app.post("/api/fleet/:registration/stop", async (c: Context) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const reg = regKey(c.req.param("registration"));
    const r = await stopAircraft(reg, "SUPERVISOR");
    if (!r.ok) return c.json({ error: r.error }, r.status as 400);
    return c.json({ ok: true, registration: reg, jobId: r.jobId });
  });
}

// 관제 세션마다 라벨(없으면 null)과 실제로 셀 ACCOUNT(라벨이 하나도 없으면 null, 라벨이 없으면 default)
export function controlAccountsView(fleet: Pick<FleetFile, "aircraft" | "control">) {
  return {
    labeled: accountsLabeled(fleet),
    rows: CONTROL_NAMES.map((name) => ({ name, label: fleet.control?.[name]?.account ?? null, account: controlAccountOf(fleet, name) })),
  };
}

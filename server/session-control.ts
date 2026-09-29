import { execFile } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context, Hono } from "hono";
import { config } from "./config.ts";
import { loadDispatchConfig } from "./dispatch.ts";
import { crewBriefing, FleetError, fleetView, loadFleet, saveControlAccount } from "./fleet.ts";
import { accountsLabeled, CONTROL_NAMES, controlAccountOf, type FleetFile } from "./crew.ts";
import type { Snapshot } from "./model.ts";
import { fromThisApp } from "./origin.ts";
import { record } from "./recorder.ts";
import { regKey, sameReg } from "./registration.ts";

// 세션 조종(docs/fleet.md 8.5). atc가 `claude --bg`로 AIRCRAFT 세션을 띄우고 `claude stop`으로 멈춘다.
// SUPERVISOR가 FLEET 탭에서 누를 때만 한다(Origin 검사). 관제 세션의 atcctl은 부를 수 없다.

// bypassPermissions는 두지 않는다: 띄운 세션이 권한 확인 없이 도는 길을 atc가 열지 않는다
export const PERMISSION_MODES = ["auto", "acceptEdits", "default"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];
export const DEFAULT_PERMISSION_MODE: PermissionMode = "auto";

// 동시에 살아 있는 atc가 띄운 세션 수 상한(비용). ATC_MAX_LAUNCHED로 바꾼다
export const MAX_LAUNCHED = Number(process.env.ATC_MAX_LAUNCHED) || 6;

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
}

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
}

export interface LaunchPlan {
  registration: string;
  cwd: string;
  permissionMode: PermissionMode;
  model: string | null;
  args: string[];
}

const sameName = (row: AgentRow, reg: string) => sameReg(row.name, reg); // `Team G` 세션도 TEAM_G(ATC-67)

// 띄울 수 있는지 보고 claude 인자를 만든다(순수)
export function launchPlanOf(input: LaunchInput, rows: AgentRow[], max = MAX_LAUNCHED): LaunchPlan {
  const reg = regKey(input.registration); // 새 세션은 정식 REGISTRATION으로 띄운다(ATC-67)
  if (input.retired) throw new ControlError(`${reg}는 RETIRED — 먼저 복귀시킨다`, 409);
  if (!input.repo) throw new ControlError(`${reg}의 base AIRPORT 저장소를 모름 — 프로필에서 base를 정한다`, 409);
  const live = rows.find((r) => sameName(r, reg));
  if (live) throw new ControlError(`${reg} 세션이 이미 떠 있음(${live.kind === "background" ? `bg ${live.id}` : "interactive"})`, 409);
  const launched = rows.filter((r) => r.kind === "background").length;
  if (launched >= max) throw new ControlError(`백그라운드 세션 ${launched}개 — 상한 ${max}(ATC_MAX_LAUNCHED)`, 409);
  const mode = input.permissionMode ?? DEFAULT_PERMISSION_MODE;
  if (!PERMISSION_MODES.includes(mode as PermissionMode)) throw new ControlError(`permission mode는 ${PERMISSION_MODES.join(" | ")}`, 400);
  const model = typeof input.model === "string" && input.model.trim() ? input.model.trim() : null;
  if (model && !/^[\w.:[\]-]+$/.test(model)) throw new ControlError(`모델 이름이 이상함: ${model}`, 400);
  const args = ["--bg", "-n", reg, "--permission-mode", mode as string, ...(model ? ["--model", model] : []), input.briefing];
  return { registration: reg, cwd: input.repo, permissionMode: mode as PermissionMode, model, args };
}

// ── 관제 세션(docs/fleet.md 8.5.1) ──
// TOWER·OCC·MCC는 atc 저장소의 관제 폴더에서 `claude --bg`로 띄운다. 폴더의 .claude/settings.json(모델·허용 목록·fail-closed guard)이 그대로 걸린다.
// 첫 메시지는 그 폴더의 주기 명령. 권한 모드는 auto로 고정한다(백그라운드 세션은 권한 창에 답할 수 없고, 막는 일은 guard가 한다).
// REVIEW·CROSSCHECK는 ocx로 다른 계열 모델에 돌려서 `claude --bg`로 띄울 수 없다 — tmux 세션에서 `ocx claude`로 띄운다(ATC-66).
// ENGINEERING은 저장소 뿌리에서 여는 작업 세션이라 이름으로만 알아보고 띄우지 않는다(배지만)
export interface ControlSpec {
  name: string;
  dir: string | null; // atc 저장소 안의 폴더. null이면 이름으로만 안다
  prompt: string | null; // 첫 메시지
  flags: string[];
  launch: "bg" | "tmux" | null;
  tmux?: string; // launch가 tmux면 tmux 세션 이름
}
export const CONTROL_SESSIONS: readonly ControlSpec[] = [
  { name: "TOWER", dir: "controller", prompt: "/loop 3m /tick", flags: [], launch: "bg" },
  { name: "OCC", dir: "occ", prompt: "/loop 10m /tick", flags: [], launch: "bg" },
  { name: "MCC", dir: "mcc", prompt: "/loop 5m /tick", flags: ["--strict-mcp-config"], launch: "bg" },
  { name: "CROSSCHECK", dir: "crosscheck", prompt: "/loop 10m /tick", flags: ["--strict-mcp-config"], launch: "tmux", tmux: "atc-crosscheck" },
  { name: "REVIEW", dir: "review", prompt: "/loop 10m /tick", flags: ["--strict-mcp-config"], launch: "tmux", tmux: "atc-review" },
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
export function controlRowsOf(spec: ControlSpec, rows: AgentRow[], dir: string | null): AgentRow[] {
  return rows.filter((r) => sameName(r, spec.name) || (dir !== null && realDir(r.cwd) === dir));
}
// 관제 폴더에서 연 세션인가(팀 세션 상한에서 뺀다)
export const isControlRow = (row: AgentRow, dirs: readonly string[]) => CONTROL_SESSIONS.some((s) => sameName(row, s.name)) || dirs.includes(realDir(row.cwd));

// 같은 관제 세션이 어떤 종류로든 떠 있으면 거절(두 벌이 같은 일을 하지 않게)
function refuseLive(spec: ControlSpec, rows: AgentRow[], dir: string | null) {
  const live = controlRowsOf(spec, rows, dir)[0];
  if (live) throw new ControlError(`${spec.name} 세션이 이미 떠 있음(${live.kind === "background" ? `bg ${live.id}` : `interactive ${live.name ?? ""}`.trim()})`, 409);
}

// LAUNCH할 수 있는지 보고 claude 인자를 만든다(순수)
export function controlLaunchPlanOf(spec: ControlSpec, rows: AgentRow[], dir: string): { cwd: string; args: string[] } {
  refuseLive(spec, rows, dir);
  return { cwd: dir, args: ["--bg", "-n", spec.name, "--permission-mode", "auto", ...spec.flags, spec.prompt ?? ""] };
}

// REVIEW·CROSSCHECK의 명령(review/README.md, docs/occ.md CROSSCHECK). 고정 문구이고 요청에서 오는 것은 없다.
// env -u ANTHROPIC_BASE_URL: export한 값이 ocx가 정하는 프록시 URL을 덮는다. NO_PROXY: ClaudeRipple HTTPS_PROXY가 로컬 프록시 요청을 가로챈다
export const OCX_ENV = "env -u ANTHROPIC_BASE_URL NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost";
export const ocxCommandOf = (spec: ControlSpec) => `${OCX_ENV} ocx claude ${[...spec.flags, "-n", spec.name].join(" ")} '${spec.prompt}'`;

// tmux LAUNCH를 막는 이유(순수). tmux나 ocx를 서버가 못 찾으면 LAUNCH만 끄고 배지는 그대로 본다
export function launchBlockOf(spec: ControlSpec, bins: { tmux: string | null; ocx: string | null }): string | null {
  if (spec.launch === null) return "배지만 — 저장소 뿌리에서 연다";
  if (spec.launch !== "tmux") return null;
  const missing = (["tmux", "ocx"] as const).filter((b) => !bins[b]);
  return missing.length ? `${missing.join("·")}를 찾지 못함 — atc 서버의 PATH에 없다` : null;
}

// tmux LAUNCH(순수): `tmux new-session -d -s <세션> -c <폴더> -e PATH=… '<명령>'`. 그 폴더의 세션이나 같은 이름의 tmux 세션이 있으면 거절
export function tmuxLaunchPlanOf(spec: ControlSpec, rows: AgentRow[], dir: string, tmuxSessions: readonly string[], path: string): { cwd: string; session: string; command: string; args: string[] } {
  if (spec.launch !== "tmux" || !spec.tmux || !spec.prompt) throw new ControlError(`${spec.name}는 tmux로 띄우지 않음`, 409);
  refuseLive(spec, rows, dir);
  if (tmuxSessions.includes(spec.tmux)) throw new ControlError(`tmux 세션 ${spec.tmux}가 이미 있음 — 그 안의 세션을 확인하거나 tmux kill-session -t ${spec.tmux}`, 409);
  const command = ocxCommandOf(spec);
  return { cwd: dir, session: spec.tmux, command, args: ["new-session", "-d", "-s", spec.tmux, "-c", dir, "-e", `PATH=${path}`, command] };
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
  if (!mine.length) throw new ControlError(`${spec.name} 세션이 떠 있지 않음`, 404);
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
export function tmuxPanes(bin = controlBins().tmux ?? "tmux"): Promise<TmuxPane[]> {
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

// 멈출 백그라운드 세션(순수). 데스크톱·터미널 세션은 atc가 멈추지 않는다
export function stopTargetOf(registration: string, rows: AgentRow[]): AgentRow {
  const reg = regKey(registration);
  const row = rows.find((r) => sameName(r, reg));
  if (!row) throw new ControlError(`${reg} 세션이 떠 있지 않음`, 404);
  if (row.kind !== "background" || !row.id) throw new ControlError(`${reg}는 데스크톱·터미널 세션 — 그 창에서 닫는다`, 409);
  return row;
}

// `claude --bg`의 출력: "backgrounded · efbbe208 · TEAM_K"
export function jobIdOf(out: string): string | null {
  return /backgrounded\s*·\s*([0-9a-f]{6,})\s*·/.exec(out)?.[1] ?? null;
}

// 세션에 atc의 비밀(.env.local)을 물려주지 않는다
const cleanPath = () => [dirname(config.claudeBin), dirname(process.execPath), "/usr/local/bin", "/usr/bin", "/bin"];
function cleanEnv(): NodeJS.ProcessEnv {
  const keep = ["HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "SHELL", "TERM", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "DBUS_SESSION_BUS_ADDRESS"];
  const env: NodeJS.ProcessEnv = {};
  for (const k of keep) if (process.env[k]) env[k] = process.env[k];
  env.PATH = cleanPath().join(":");
  return env;
}
// REVIEW·CROSSCHECK LAUNCH에 쓰는 tmux·ocx. 서버의 PATH와 깨끗한 PATH에서 찾는다
export function controlBins(): { tmux: string | null; ocx: string | null } {
  const dirs = [...(process.env.PATH ?? "").split(":"), ...cleanPath()];
  return { tmux: findBin("tmux", dirs), ocx: findBin("ocx", dirs) };
}

// LAUNCH는 atc 서비스 밖의 systemd scope에서 claude를 부른다. `claude --bg`는 처음 부를 때 이 기계의 백그라운드 세션을 모두 맡는
// daemon(`claude daemon run`)을 띄우는데, atc 안에서 띄우면 daemon이 atc.service cgroup에 들어가 atc를 재시작할 때마다(배포·RTS)
// 모든 백그라운드 세션이 함께 죽는다(2026-09-28 OCC a578bf15). ATC_BG_SCOPE=off면 예전처럼 바로 부른다
const SYSTEMD_RUN = "/usr/bin/systemd-run";
export function launchCommandOf(bin: string, args: string[], scope: string | null, unit: string): { cmd: string; args: string[] } {
  return scope ? { cmd: scope, args: ["--user", "--scope", "--collect", "--quiet", `--unit=${unit}`, "--", bin, ...args] } : { cmd: bin, args };
}
const scopeBin = () => (process.env.ATC_BG_SCOPE !== "off" && existsSync(SYSTEMD_RUN) ? SYSTEMD_RUN : null);

function claude(args: string[], cwd?: string, { scope = false } = {}): Promise<{ ok: boolean; out: string }> {
  const { cmd, args: argv } = launchCommandOf(config.claudeBin, args, scope ? scopeBin() : null, `atc-claude-${Date.now()}`);
  return new Promise((resolve) => {
    execFile(cmd, argv, { cwd, env: cleanEnv(), timeout: 60_000, maxBuffer: 4 << 20 }, (err, stdout, stderr) =>
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

export async function agentRows(): Promise<AgentRow[]> {
  const r = await claude(["agents", "--json"]);
  if (!r.ok) throw new ControlError(`claude agents 실패: ${r.out.slice(0, 300)}`, 502);
  try {
    return JSON.parse(r.out) as AgentRow[];
  } catch {
    throw new ControlError("claude agents 출력을 읽지 못함", 502);
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
  error?: string;
}

// LAUNCH: FLEET 카드 버튼과 FLEET PLAN 승인(8.7)이 같이 쓴다. 결과는 FLIGHT RECORDER에 by와 함께 남는다
export async function launchAircraft(s: Snapshot, registration: string, options: { permissionMode?: unknown; model?: unknown }, by: string): Promise<ControlResult> {
  const reg = regKey(registration);
  const cfg = loadDispatchConfig();
  const a = fleetView(s, loadFleet(), cfg.teamPattern).find((x) => x.registration === reg);
  if (!a) return { ok: false, status: 404, error: `FLEET에 없음: ${reg}` };
  const repo = s.airports.find((x) => x.code === a.base)?.repo ?? null;
  const t = new Date().toISOString();
  try {
    // 관제 세션은 팀 세션 상한(ATC_MAX_LAUNCHED)에 세지 않는다
    const dirs = CONTROL_SESSIONS.map((c) => controlDirOf(c)).filter((d): d is string => d !== null);
    const rows = (await agentRows()).filter((r) => !isControlRow(r, dirs));
    const plan = launchPlanOf({ registration: reg, retired: !!a.retired, repo, briefing: crewBriefing(a, repo, cfg.mode), permissionMode: options.permissionMode, model: options.model }, rows);
    const r = await claude(plan.args, plan.cwd, { scope: true });
    const jobId = jobIdOf(r.out);
    const ok = r.ok && !!jobId;
    const error = ok ? undefined : /not trusted/i.test(r.out) ? `${plan.cwd}를 신뢰하지 않음 — 그 폴더에서 claude를 한 번 열어 trust를 수락한다` : r.out.slice(0, 300) || "claude --bg 실패";
    record({ t, kind: "fleet", op: "launch", aircraft: reg, by, ok, jobId: jobId ?? undefined, cwd: plan.cwd, permissionMode: plan.permissionMode, model: plan.model ?? undefined, error });
    return ok ? { ok, status: 200, jobId: jobId!, cwd: plan.cwd, permissionMode: plan.permissionMode, model: plan.model } : { ok, status: 502, error };
  } catch (e) {
    if (e instanceof ControlError) return { ok: false, status: e.status, error: e.message };
    throw e;
  }
}

// STOP: 백그라운드 세션만 멈춘다
export async function stopAircraft(registration: string, by: string): Promise<ControlResult> {
  const reg = regKey(registration);
  const t = new Date().toISOString();
  try {
    const row = stopTargetOf(reg, await agentRows());
    const r = await claude(["stop", row.id as string]);
    const error = r.ok ? undefined : r.out.slice(0, 300) || "claude stop 실패";
    record({ t, kind: "fleet", op: "stop", aircraft: reg, by, ok: r.ok, jobId: row.id, cwd: row.cwd, error });
    return r.ok ? { ok: true, status: 200, jobId: row.id } : { ok: false, status: 502, error };
  } catch (e) {
    if (e instanceof ControlError) return { ok: false, status: e.status, error: e.message };
    throw e;
  }
}

export async function launchControl(name: string, by: string): Promise<ControlResult> {
  const spec = controlSpecOf(name);
  if (!spec) return { ok: false, status: 404, error: `관제 세션이 아님: ${name} (${CONTROL_SESSIONS.map((c) => c.name).join(", ")})` };
  const dir = controlDirOf(spec);
  if (spec.launch === null || dir === null) return { ok: false, status: 409, error: `${spec.name}: ${launchBlockOf(spec, controlBins())}` };
  if (spec.launch === "tmux") return launchTmuxControl(spec, dir, by);
  const t = new Date().toISOString();
  try {
    const plan = controlLaunchPlanOf(spec, await agentRows(), dir);
    const r = await claude(plan.args, plan.cwd, { scope: true });
    const jobId = jobIdOf(r.out);
    const ok = r.ok && !!jobId;
    const error = ok ? undefined : /not trusted/i.test(r.out) ? `${plan.cwd}를 신뢰하지 않음 — 그 폴더에서 claude를 한 번 열어 trust를 수락한다` : r.out.slice(0, 300) || "claude --bg 실패";
    record({ t, kind: "control", op: "launch", session: spec.name, by, ok, jobId: jobId ?? undefined, cwd: plan.cwd, error });
    return ok ? { ok, status: 200, jobId: jobId!, cwd: plan.cwd, permissionMode: "auto" } : { ok, status: 502, error };
  } catch (e) {
    if (e instanceof ControlError) return { ok: false, status: e.status, error: e.message };
    throw e;
  }
}

// REVIEW·CROSSCHECK: tmux 세션에서 `ocx claude`로(ATC-66). tmux 서버가 없으면 이 호출이 띄우므로 systemd scope에서, 깨끗한 환경으로 부른다
async function launchTmuxControl(spec: ControlSpec, dir: string, by: string): Promise<ControlResult> {
  const bins = controlBins();
  const blocked = launchBlockOf(spec, bins);
  if (blocked) return { ok: false, status: 409, error: `${spec.name}: ${blocked}` };
  const t = new Date().toISOString();
  try {
    const [rows, panes] = await Promise.all([agentRows(), tmuxPanes(bins.tmux!)]);
    const path = [...new Set([dirname(bins.ocx!), ...cleanPath()])].join(":");
    const plan = tmuxLaunchPlanOf(spec, rows, dir, [...new Set(panes.map((p) => p.session))], path);
    const { cmd, args } = launchCommandOf(bins.tmux!, plan.args, scopeBin(), `atc-tmux-${Date.now()}`);
    const r = await new Promise<{ ok: boolean; out: string }>((resolve) =>
      execFile(cmd, args, { cwd: dir, env: cleanEnv(), timeout: 15_000 }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}`.trim() })),
    );
    const error = r.ok ? undefined : r.out.slice(0, 300) || "tmux new-session 실패";
    record({ t, kind: "control", op: "launch", session: spec.name, by, ok: r.ok, tmux: plan.session, cwd: plan.cwd, error });
    return r.ok ? { ok: true, status: 200, tmux: plan.session, cwd: plan.cwd } : { ok: false, status: 502, error };
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
    const tmuxBin = controlBins().tmux ?? "tmux";
    const panes = await tmuxPanes(tmuxBin);
    const target = controlStopTargetOf(spec, await agentRows(), controlDirOf(spec), (row) => tmuxPaneOf(row.pid, panes, parentPidOf));
    if (target.how === "tmux") {
      // 그 pane만 닫는다(tmux 세션의 다른 창은 그대로). 대화 기록은 남아 claude --resume으로 다시 연다
      const r = await new Promise<{ ok: boolean; out: string }>((resolve) =>
        execFile(tmuxBin, ["kill-pane", "-t", target.pane.pane], { timeout: 5000 }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}`.trim() })),
      );
      const error = r.ok ? undefined : r.out.slice(0, 300) || "tmux kill-pane 실패";
      record({ t, kind: "control", op: "stop", session: spec.name, by, ok: r.ok, tmux: `${target.pane.session} ${target.pane.pane}`, cwd: target.row.cwd, error });
      return r.ok ? { ok: true, status: 200, tmux: target.pane.session } : { ok: false, status: 502, error };
    }
    const row = target.row;
    const r = await claude(["stop", row.id as string]);
    const error = r.ok ? undefined : r.out.slice(0, 300) || "claude stop 실패";
    record({ t, kind: "control", op: "stop", session: spec.name, by, ok: r.ok, jobId: row.id, cwd: row.cwd, error });
    return r.ok ? { ok: true, status: 200, jobId: row.id } : { ok: false, status: 502, error };
  } catch (e) {
    if (e instanceof ControlError) return { ok: false, status: e.status, error: e.message };
    throw e;
  }
}

export function mountSessionControl(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  // 관제 세션(8.5.1): 설정 창 AGENTS 탭의 CONTROL 블록이 쓴다
  app.get("/api/control/sessions", async (c) => {
    try {
      const bins = controlBins();
      const [rows, panes] = await Promise.all([agentRows(), tmuxPanes(bins.tmux ?? "tmux")]);
      return c.json({
        // 백그라운드 세션 daemon이 atc 서비스 안에 있으면 atc 재시작(배포·RTS) 때 모든 백그라운드 세션이 죽는다
        daemonInService: inServiceCgroup(daemonCgroups()),
        sessions: CONTROL_SESSIONS.map((spec) => ({
          name: spec.name,
          dir: spec.dir,
          prompt: spec.prompt,
          // bg: claude --bg, tmux: tmux 세션에서 ocx claude, null: 배지만. blocked는 LAUNCH를 끈 이유
          launch: spec.launch,
          tmux: spec.tmux,
          command: spec.launch === "tmux" ? ocxCommandOf(spec) : undefined,
          blocked: launchBlockOf(spec, bins),
          live: controlRowsOf(spec, rows, controlDirOf(spec)).map(({ id, name, kind, status, pid }) => ({ id, name, kind, status, tmux: kind === "background" ? undefined : tmuxPaneOf(pid, panes, parentPidOf)?.session })),
        })),
        // ACCOUNT(ATC-60): 관제 세션마다 SUPERVISOR가 단 라벨(없으면 null). FUEL이 이 ACCOUNT에 센다
        accounts: controlAccountsView(loadFleet()),
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
    const r = await launchControl(c.req.param("name") ?? "", "SUPERVISOR");
    if (!r.ok) return c.json({ error: r.error }, r.status as 400);
    return c.json({ ok: true, jobId: r.jobId, tmux: r.tmux, cwd: r.cwd });
  });
  app.post("/api/control/:name/stop", async (c: Context) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const r = await stopControl(c.req.param("name") ?? "", "SUPERVISOR");
    if (!r.ok) return c.json({ error: r.error }, r.status as 400);
    return c.json({ ok: true, jobId: r.jobId, tmux: r.tmux });
  });

  // AIRCRAFT 이름과 같은 세션(데스크톱·터미널·백그라운드). FLEET 카드의 LAUNCH·STOP 버튼이 쓴다
  app.get("/api/fleet/sessions", async (c) => {
    try {
      const team = new RegExp(loadDispatchConfig().teamPattern, "i");
      const rows = (await agentRows()).filter((r) => team.test(r.name ?? ""));
      return c.json({ max: MAX_LAUNCHED, permissionModes: PERMISSION_MODES, sessions: rows.map(({ id, sessionId, name, kind, status, cwd }) => ({ id, sessionId, name, kind, status, cwd })) });
    } catch (e) {
      if (e instanceof ControlError) return c.json({ error: e.message }, e.status as 502);
      throw e;
    }
  });

  app.post("/api/fleet/:registration/launch", async (c: Context) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const reg = regKey(c.req.param("registration"));
    const body = await c.req.json().catch(() => ({}));
    const r = await launchAircraft(await getSnapshot(), reg, body, "SUPERVISOR");
    if (!r.ok) return c.json({ error: r.error }, r.status as 400);
    return c.json({ ok: true, registration: reg, jobId: r.jobId, cwd: r.cwd, permissionMode: r.permissionMode, model: r.model });
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

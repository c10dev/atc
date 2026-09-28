import { execFile } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context, Hono } from "hono";
import { config } from "./config.ts";
import { loadDispatchConfig } from "./dispatch.ts";
import { crewBriefing, fleetView, loadFleet } from "./fleet.ts";
import type { Snapshot } from "./model.ts";
import { fromThisApp } from "./origin.ts";
import { record } from "./recorder.ts";

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

const sameName = (row: AgentRow, reg: string) => (row.name ?? "").toUpperCase() === reg.toUpperCase();

// 띄울 수 있는지 보고 claude 인자를 만든다(순수)
export function launchPlanOf(input: LaunchInput, rows: AgentRow[], max = MAX_LAUNCHED): LaunchPlan {
  const reg = input.registration.toUpperCase();
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
// atc 저장소의 관제 폴더에서 `claude --bg`로 띄운다. 폴더의 .claude/settings.json(모델·허용 목록·fail-closed guard)이 그대로 걸린다.
// 첫 메시지는 그 폴더의 주기 명령. 권한 모드는 auto로 고정한다(백그라운드 세션은 권한 창에 답할 수 없고, 막는 일은 guard가 한다).
// REVIEW·CROSSCHECK는 ocx로 다른 계열 모델에 돌려서 `claude --bg`로 띄울 수 없다 — 지금처럼 tmux로 띄운다.
export interface ControlSpec {
  name: string;
  dir: string; // atc 저장소 안의 폴더
  prompt: string; // 첫 메시지
  flags: string[];
}
export const CONTROL_SESSIONS: readonly ControlSpec[] = [
  { name: "TOWER", dir: "controller", prompt: "/loop 3m /tick", flags: [] },
  { name: "OCC", dir: "occ", prompt: "/loop 10m /tick", flags: [] },
  { name: "MCC", dir: "mcc", prompt: "/loop 5m /tick", flags: ["--strict-mcp-config"] },
];
export const MANUAL_CONTROL = ["REVIEW", "CROSSCHECK"] as const;
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const realDir = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
export const controlDirOf = (spec: ControlSpec, root = REPO_ROOT) => realDir(join(root, spec.dir));
export const controlSpecOf = (name: string) => CONTROL_SESSIONS.find((s) => s.name === name.toUpperCase()) ?? null;

// 이 관제 세션으로 보는 세션: 이름이 같거나(대소문자 무시), 그 폴더에서 연 세션(tmux로 이름 없이 띄운 것도)
export function controlRowsOf(spec: ControlSpec, rows: AgentRow[], dir: string): AgentRow[] {
  return rows.filter((r) => sameName(r, spec.name) || realDir(r.cwd) === dir);
}
// 관제 폴더에서 연 세션인가(팀 세션 상한에서 뺀다)
export const isControlRow = (row: AgentRow, dirs: readonly string[]) => CONTROL_SESSIONS.some((s) => sameName(row, s.name)) || dirs.includes(realDir(row.cwd));

// LAUNCH할 수 있는지 보고 claude 인자를 만든다(순수). 같은 관제 세션이 어떤 종류로든 떠 있으면 거절(두 벌이 같은 일을 하지 않게)
export function controlLaunchPlanOf(spec: ControlSpec, rows: AgentRow[], dir: string): { cwd: string; args: string[] } {
  const live = controlRowsOf(spec, rows, dir)[0];
  if (live) throw new ControlError(`${spec.name} 세션이 이미 떠 있음(${live.kind === "background" ? `bg ${live.id}` : `interactive ${live.name ?? ""}`.trim()})`, 409);
  return { cwd: dir, args: ["--bg", "-n", spec.name, "--permission-mode", "auto", ...spec.flags, spec.prompt] };
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
export function controlStopTargetOf(spec: ControlSpec, rows: AgentRow[], dir: string, paneOf: (row: AgentRow) => TmuxPane | null = () => null): StopTarget {
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
export function tmuxPanes(): Promise<TmuxPane[]> {
  return new Promise((resolve) => {
    execFile("tmux", ["list-panes", "-a", "-F", "#{session_name}\t#{pane_id}\t#{pane_pid}"], { timeout: 5000 }, (err, stdout) => {
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
  const reg = registration.toUpperCase();
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
function cleanEnv(): NodeJS.ProcessEnv {
  const keep = ["HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "SHELL", "TERM", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "DBUS_SESSION_BUS_ADDRESS"];
  const env: NodeJS.ProcessEnv = {};
  for (const k of keep) if (process.env[k]) env[k] = process.env[k];
  env.PATH = [dirname(config.claudeBin), dirname(process.execPath), "/usr/local/bin", "/usr/bin", "/bin"].join(":");
  return env;
}

function claude(args: string[], cwd?: string): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(config.claudeBin, args, { cwd, env: cleanEnv(), timeout: 60_000, maxBuffer: 4 << 20 }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: `${stdout}${stderr}`.trim() }),
    );
  });
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
  const reg = registration.toUpperCase();
  const cfg = loadDispatchConfig();
  const a = fleetView(s, loadFleet(), cfg.teamPattern).find((x) => x.registration === reg);
  if (!a) return { ok: false, status: 404, error: `FLEET에 없음: ${reg}` };
  const repo = s.airports.find((x) => x.code === a.base)?.repo ?? null;
  const t = new Date().toISOString();
  try {
    // 관제 세션은 팀 세션 상한(ATC_MAX_LAUNCHED)에 세지 않는다
    const dirs = CONTROL_SESSIONS.map((c) => controlDirOf(c));
    const rows = (await agentRows()).filter((r) => !isControlRow(r, dirs));
    const plan = launchPlanOf({ registration: reg, retired: !!a.retired, repo, briefing: crewBriefing(a, repo, cfg.mode), permissionMode: options.permissionMode, model: options.model }, rows);
    const r = await claude(plan.args, plan.cwd);
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
  const reg = registration.toUpperCase();
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
  if (!spec) return { ok: false, status: 404, error: `atc가 띄우는 관제 세션이 아님: ${name} (${CONTROL_SESSIONS.map((c) => c.name).join(", ")}; ${MANUAL_CONTROL.join("·")}는 tmux로)` };
  const t = new Date().toISOString();
  try {
    const plan = controlLaunchPlanOf(spec, await agentRows(), controlDirOf(spec));
    const r = await claude(plan.args, plan.cwd);
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

export async function stopControl(name: string, by: string): Promise<ControlResult> {
  const spec = controlSpecOf(name);
  if (!spec) return { ok: false, status: 404, error: `atc가 띄우는 관제 세션이 아님: ${name}` };
  const t = new Date().toISOString();
  try {
    const panes = await tmuxPanes();
    const target = controlStopTargetOf(spec, await agentRows(), controlDirOf(spec), (row) => tmuxPaneOf(row.pid, panes, parentPidOf));
    if (target.how === "tmux") {
      // 그 pane만 닫는다(tmux 세션의 다른 창은 그대로). 대화 기록은 남아 claude --resume으로 다시 연다
      const r = await new Promise<{ ok: boolean; out: string }>((resolve) =>
        execFile("tmux", ["kill-pane", "-t", target.pane.pane], { timeout: 5000 }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}`.trim() })),
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
      const [rows, panes] = await Promise.all([agentRows(), tmuxPanes()]);
      return c.json({
        manual: MANUAL_CONTROL,
        sessions: CONTROL_SESSIONS.map((spec) => ({
          name: spec.name,
          dir: spec.dir,
          prompt: spec.prompt,
          live: controlRowsOf(spec, rows, controlDirOf(spec)).map(({ id, name, kind, status, pid }) => ({ id, name, kind, status, tmux: kind === "background" ? undefined : tmuxPaneOf(pid, panes, parentPidOf)?.session })),
        })),
      });
    } catch (e) {
      if (e instanceof ControlError) return c.json({ error: e.message }, e.status as 502);
      throw e;
    }
  });
  app.post("/api/control/:name/launch", async (c: Context) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const r = await launchControl(c.req.param("name") ?? "", "SUPERVISOR");
    if (!r.ok) return c.json({ error: r.error }, r.status as 400);
    return c.json({ ok: true, jobId: r.jobId, cwd: r.cwd });
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
    const reg = (c.req.param("registration") ?? "").toUpperCase();
    const body = await c.req.json().catch(() => ({}));
    const r = await launchAircraft(await getSnapshot(), reg, body, "SUPERVISOR");
    if (!r.ok) return c.json({ error: r.error }, r.status as 400);
    return c.json({ ok: true, registration: reg, jobId: r.jobId, cwd: r.cwd, permissionMode: r.permissionMode, model: r.model });
  });

  app.post("/api/fleet/:registration/stop", async (c: Context) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const reg = (c.req.param("registration") ?? "").toUpperCase();
    const r = await stopAircraft(reg, "SUPERVISOR");
    if (!r.ok) return c.json({ error: r.error }, r.status as 400);
    return c.json({ ok: true, registration: reg, jobId: r.jobId });
  });
}

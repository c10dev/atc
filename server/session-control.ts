import { execFile } from "node:child_process";
import { dirname } from "node:path";
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

export function mountSessionControl(app: Hono, getSnapshot: () => Promise<Snapshot>) {
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
    const s = await getSnapshot();
    const cfg = loadDispatchConfig();
    const a = fleetView(s, loadFleet(), cfg.teamPattern).find((x) => x.registration === reg);
    if (!a) return c.json({ error: `FLEET에 없음: ${reg}` }, 404);
    const repo = s.airports.find((x) => x.code === a.base)?.repo ?? null;
    const t = new Date().toISOString();
    try {
      const plan = launchPlanOf({ registration: reg, retired: !!a.retired, repo, briefing: crewBriefing(a, repo, cfg.mode), permissionMode: body.permissionMode, model: body.model }, await agentRows());
      const r = await claude(plan.args, plan.cwd);
      const jobId = jobIdOf(r.out);
      const ok = r.ok && !!jobId;
      const error = ok ? undefined : /not trusted/i.test(r.out) ? `${plan.cwd}를 신뢰하지 않음 — 그 폴더에서 claude를 한 번 열어 trust를 수락한다` : r.out.slice(0, 300) || "claude --bg 실패";
      record({ t, kind: "fleet", op: "launch", aircraft: reg, by: "SUPERVISOR", ok, jobId: jobId ?? undefined, cwd: plan.cwd, permissionMode: plan.permissionMode, model: plan.model ?? undefined, error });
      if (!ok) return c.json({ error }, 502);
      return c.json({ ok: true, registration: reg, jobId, cwd: plan.cwd, permissionMode: plan.permissionMode, model: plan.model });
    } catch (e) {
      if (e instanceof ControlError) return c.json({ error: e.message }, e.status as 400);
      throw e;
    }
  });

  app.post("/api/fleet/:registration/stop", async (c: Context) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const reg = (c.req.param("registration") ?? "").toUpperCase();
    const t = new Date().toISOString();
    try {
      const row = stopTargetOf(reg, await agentRows());
      const r = await claude(["stop", row.id as string]);
      const error = r.ok ? undefined : r.out.slice(0, 300) || "claude stop 실패";
      record({ t, kind: "fleet", op: "stop", aircraft: reg, by: "SUPERVISOR", ok: r.ok, jobId: row.id, cwd: row.cwd, error });
      if (!r.ok) return c.json({ error }, 502);
      return c.json({ ok: true, registration: reg, jobId: row.id });
    } catch (e) {
      if (e instanceof ControlError) return c.json({ error: e.message }, e.status as 400);
      throw e;
    }
  });
}

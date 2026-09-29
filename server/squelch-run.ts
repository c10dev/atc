import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { DEFAULT_HEARTBEAT_MIN, decide, fingerprint, type Inputs, isRole, type Mode, MODES, naturalReason, project, type Role, ROLES } from "./squelch.ts";

// SQUELCH I/O와 API(docs/squelch.md 5장). 이 이슈(S1)에서는 아무 hook도 부르지 않고, 기본 모드는 shadow라 어떤 tick도 버리지 않는다.

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
// 역할이 도는 폴더(atcctl manual check가 세션의 cwd로 보는 곳)
export const ROLE_DIRS: Record<Role, string> = { tower: "controller", mcc: "mcc", occ: "occ", crosscheck: "crosscheck", review: "review" };

export interface RoleState {
  fp: string | null;
  openedAt: string | null;
  quietSince: string | null;
  quietCount: number;
}
export interface SquelchConfig {
  mode: Mode;
  heartbeatMin: Record<Role, number>;
}
export interface SquelchFile {
  config: SquelchConfig;
  roles: Partial<Record<Role, RoleState>>;
}

const stateFile = () => join(config.stateDir, "squelch.json");
const logFile = () => join(config.stateDir, "squelch.jsonl");

export function defaultConfig(): SquelchConfig {
  return { mode: "shadow", heartbeatMin: Object.fromEntries(ROLES.map((r) => [r, DEFAULT_HEARTBEAT_MIN])) as Record<Role, number> };
}

// 없거나 깨진 파일, 모르는 값은 기본값으로 읽는다(모드는 shadow로 — 모르면 버리지 않는다)
export function readState(): SquelchFile {
  const out: SquelchFile = { config: defaultConfig(), roles: {} };
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(stateFile(), "utf8"));
  } catch {
    return out;
  }
  if (MODES.includes(raw?.config?.mode)) out.config.mode = raw.config.mode;
  for (const r of ROLES) {
    const m = raw?.config?.heartbeatMin?.[r];
    if (typeof m === "number" && Number.isFinite(m) && m > 0) out.config.heartbeatMin[r] = m;
    const s = raw?.roles?.[r];
    if (s && typeof s === "object") {
      out.roles[r] = {
        fp: typeof s.fp === "string" ? s.fp : null,
        openedAt: typeof s.openedAt === "string" ? s.openedAt : null,
        quietSince: typeof s.quietSince === "string" ? s.quietSince : null,
        quietCount: Number.isInteger(s.quietCount) && s.quietCount > 0 ? s.quietCount : 0,
      };
    }
  }
  return out;
}

// 임시 파일에 쓴 뒤 바꿔 놓는다(중간에 죽어도 반쯤 쓴 파일이 남지 않는다)
export function writeState(file: SquelchFile) {
  mkdirSync(config.stateDir, { recursive: true });
  const tmp = `${stateFile()}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(file, null, 1)}\n`);
  renameSync(tmp, stateFile());
}

function appendLog(line: { t: string; role: string; open: boolean; reason: string; fp: string | null }) {
  mkdirSync(config.stateDir, { recursive: true });
  appendFileSync(logFile(), `${JSON.stringify(line)}\n`);
}

export type Fetcher = (path: string) => Promise<unknown>;

// 그 역할의 /tick이 읽는 브리핑을 가져온다. 서버 안에서 같은 핸들러를 부르므로 atcctl과 같은 값이다(네트워크를 타지 않는다)
export async function gatherInputs(role: Role, get: Fetcher): Promise<Inputs> {
  switch (role) {
    case "tower":
      return { brief: await get("/api/controller/brief?consumer=controller") };
    case "mcc":
      return { queue: await get("/api/mcc/queue") };
    case "occ": {
      const [dispatch, crewChange, schedule, following] = await Promise.all([get("/api/dispatch/brief"), get("/api/fleet/crew-changes/brief"), get("/api/schedule/brief"), get("/api/following")]);
      return { dispatch, crewChange, schedule, following };
    }
    case "crosscheck": {
      const [dispatch, schedule] = await Promise.all([get("/api/dispatch/brief"), get("/api/schedule/brief")]);
      return { dispatch, schedule };
    }
    case "review":
      return { reviews: await get("/api/landing/reviews") };
  }
}

// `atcctl manual check`와 같은 비교: 그 폴더의 규정 해시가 마지막 ack와 다른가. 읽기만 한다
async function manualChangedOf(role: Role): Promise<boolean> {
  const dir = join(REPO_ROOT, ROLE_DIRS[role]);
  const mod = (await import(new URL("../controller/atcctl.mjs", import.meta.url).href)) as { manualHash: (dir: string) => string };
  const now = mod.manualHash(dir);
  let last = "";
  try {
    last = readFileSync(join(config.stateDir, "manuals", `${dir.replace(/[^A-Za-z0-9._-]+/g, "_")}.sha`), "utf8").trim();
  } catch {}
  return last !== now;
}

export interface Outcome {
  open: boolean;
  reason: string;
  quietSince: string | null;
  quietCount: number;
}

// 한 번의 판정. 상태는 "on이었다면"의 흐름을 따른다: 열려야 했던 통과만 마지막 통과로 적고, QUIET이면 세기만 올린다
export async function squelchRun(role: Role, get: Fetcher, now = Date.now(), manual: (r: Role) => Promise<boolean> = manualChangedOf): Promise<Outcome> {
  const file = readState();
  const fp = fingerprint(project(role, await gatherInputs(role, get)));
  const s = file.roles[role];
  const last = s?.fp && s.openedAt ? { fp: s.fp, openedAt: s.openedAt } : null;
  const input = { fp, last, now, heartbeatMin: file.config.heartbeatMin[role], manualChanged: await manual(role) };
  const d = decide({ ...input, mode: file.config.mode });
  const iso = new Date(now).toISOString();
  let next: RoleState;
  if (file.config.mode === "off") next = s ?? { fp: null, openedAt: null, quietSince: null, quietCount: 0 };
  else if (naturalReason(input)) next = { fp, openedAt: iso, quietSince: null, quietCount: 0 };
  else next = { fp: s!.fp, openedAt: s!.openedAt, quietSince: s!.quietSince ?? iso, quietCount: (s!.quietCount ?? 0) + 1 };
  file.roles[role] = next;
  writeState(file);
  appendLog({ t: iso, role, open: d.open, reason: d.reason, fp });
  return { open: d.open, reason: d.reason, quietSince: next.quietSince, quietCount: next.quietCount };
}

export interface SquelchDeps {
  get?: Fetcher; // 시험용: 브리핑 가져오기
  manual?: (role: Role) => Promise<boolean>; // 시험용: manual check
}
export function mountSquelch(app: Hono, deps: SquelchDeps = {}) {
  const get: Fetcher =
    deps.get ??
    (async (path) => {
      const r = await app.request(path);
      if (!r.ok) throw new Error(`${path} → ${r.status}`);
      return r.json();
    });

  // 모드·하트비트와 역할별 마지막 통과(S5 화면이 읽는다)
  app.get("/api/squelch", (c) => c.json(readState()));

  // 절대 막지 않는다: 어떤 오류든 200 fail-open. 모르는 역할만 404
  app.post("/api/squelch/:role", async (c) => {
    const role = c.req.param("role") ?? "";
    if (!isRole(role)) return c.json({ error: `알 수 없는 역할 ${role} — ${ROLES.join("|")}` }, 404);
    try {
      return c.json(await squelchRun(role, get, Date.now(), deps.manual));
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      try {
        appendLog({ t: new Date().toISOString(), role, open: true, reason: "fail-open", fp: null });
      } catch {}
      return c.json({ open: true, reason: "fail-open", error, quietSince: null, quietCount: 0 });
    }
  });
}

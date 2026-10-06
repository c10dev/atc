import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import {
  changedFields,
  DEFAULT_FINGERPRINT,
  DEFAULT_HEARTBEAT_MIN,
  DEFAULT_MODE,
  decide,
  type Fingerprint,
  FINGERPRINTS,
  fingerprint,
  type Inputs,
  isRole,
  type Mode,
  modeOf,
  MODES,
  naturalReason,
  project,
  projectV2,
  type Role,
  ROLES,
  SAFE_FINGERPRINT,
  SAFE_MODE,
} from "./squelch.ts";
import { type Migrated, MIGRATION_ID, upgradeOnce } from "./squelch-switch.ts";

// SQUELCH I/O와 API(docs/squelch.md 5장). 이 이슈(S1)에서는 아무 hook도 부르지 않고, 기본 모드는 shadow라 어떤 tick도 버리지 않는다.
// ATC-297: v2 지문(squelch.ts)이 v1 옆에서 그림자로 돈다. 역할마다 config.fingerprint가 v2일 때만 v2가 판정을 정한다(기본 v1).
// v2가 실패하면 v1로 판정하고, v1이 실패하면 열린다(아래 catch).

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
// 역할이 도는 폴더(atcctl manual check가 세션의 cwd로 보는 곳)
export const ROLE_DIRS: Record<Role, string> = { tower: "controller", mcc: "mcc", occ: "occ", crosscheck: "crosscheck", review: "review" };

// 지난 열린 통과: 지문과 시각, 그리고 그때의 투영(필드 경로만 비교하려고. 값은 로그에 쓰지 않는다)
export interface Pass {
  fp: string | null;
  openedAt: string | null;
  proj?: unknown;
}
export interface RoleState extends Pass {
  quietSince: string | null;
  quietCount: number;
  v2?: Pass; // v2 지문의 지난 열린 통과(그림자 또는 판정)
}
export interface SquelchConfig {
  mode: Mode; // 전체 모드. 역할에 모드가 없으면 이것(ATC-552)
  roles: Partial<Record<Role, { mode: Mode }>>; // 역할마다 고른 모드(ATC-552). 없으면 전체 모드
  heartbeatMin: Record<Role, number>;
  fingerprint: Record<Role, Fingerprint>; // 역할마다 판정에 쓸 지문. 기본 v1
}
export interface SquelchFile {
  config: SquelchConfig;
  roles: Partial<Record<Role, RoleState>>;
  migrated?: Migrated; // 한 번 올린 기록(ATC-553). 있으면 다시 올리지 않는다
}

const stateFile = () => join(config.stateDir, "squelch.json");
const logFile = () => join(config.stateDir, "squelch.jsonl");

// 코드 기본값(ATC-553): 파일이 없거나 값이 없는 역할은 on·v2
export function defaultConfig(): SquelchConfig {
  return {
    mode: DEFAULT_MODE,
    roles: {},
    heartbeatMin: Object.fromEntries(ROLES.map((r) => [r, DEFAULT_HEARTBEAT_MIN])) as Record<Role, number>,
    fingerprint: Object.fromEntries(ROLES.map((r) => [r, DEFAULT_FINGERPRINT])) as Record<Role, Fingerprint>,
  };
}
// 읽을 수 없을 때의 값(fail-open): 늘 열고(shadow) 후보 지문(v2)을 켜지 않는다
function safeConfig(): SquelchConfig {
  const c = defaultConfig();
  c.mode = SAFE_MODE;
  for (const r of ROLES) c.fingerprint[r] = SAFE_FINGERPRINT;
  return c;
}

const passOf = (s: any): Pass | undefined =>
  s && typeof s === "object" ? { fp: typeof s.fp === "string" ? s.fp : null, openedAt: typeof s.openedAt === "string" ? s.openedAt : null, ...(s.proj !== undefined ? { proj: s.proj } : {}) } : undefined;

// 파일이 없으면 기본값(on·v2), 파싱할 수 없으면 shadow·v1(tick은 늘 돈다). 파일 안에서 값이 없는 칸은 기본값, 있는데 모르는 값은 shadow·v1
export type Source = "missing" | "ok" | "unreadable";
export function readStateWith(): { file: SquelchFile; source: Source; raw?: any } {
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(stateFile(), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return { file: { config: defaultConfig(), roles: {} }, source: "missing" };
    return { file: { config: safeConfig(), roles: {} }, source: "unreadable" };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { file: { config: safeConfig(), roles: {} }, source: "unreadable" };
  const out: SquelchFile = { config: defaultConfig(), roles: {} };
  const c = raw.config;
  if (c?.mode !== undefined) out.config.mode = MODES.includes(c.mode) ? c.mode : SAFE_MODE;
  for (const r of ROLES) {
    const rm = c?.roles?.[r]?.mode;
    if (rm !== undefined) out.config.roles[r] = { mode: MODES.includes(rm) ? rm : SAFE_MODE };
    const m = c?.heartbeatMin?.[r];
    if (typeof m === "number" && Number.isFinite(m) && m > 0) out.config.heartbeatMin[r] = m;
    const f = c?.fingerprint?.[r];
    if (f !== undefined) out.config.fingerprint[r] = FINGERPRINTS.includes(f) ? f : SAFE_FINGERPRINT;
    const s = raw?.roles?.[r];
    if (s && typeof s === "object") {
      const v2 = passOf(s.v2);
      out.roles[r] = {
        ...passOf(s)!,
        quietSince: typeof s.quietSince === "string" ? s.quietSince : null,
        quietCount: Number.isInteger(s.quietCount) && s.quietCount > 0 ? s.quietCount : 0,
        ...(v2 ? { v2 } : {}),
      };
    }
  }
  const mg = raw.migrated;
  if (mg && typeof mg === "object" && mg.id === MIGRATION_ID && typeof mg.at === "string") out.migrated = { id: MIGRATION_ID, at: mg.at, from: mg.from ?? null };
  return { file: out, source: "ok", raw };
}
export const readState = (): SquelchFile => readStateWith().file;

// 서버가 시작할 때 한 번(ATC-553): 파일이 없거나 읽을 수 있는데 아직 올린 기록이 없으면 모든 역할을 on·v2로 쓰고 기록을 남긴다.
// 읽을 수 없는 파일은 건드리지 않는다(덮어쓰면 SUPERVISOR의 값을 잃는다). 기록이 있으면 아무것도 하지 않는다 — 그 뒤로는 스위치만 값을 바꾼다
export function migrateOnce(now = Date.now()): "migrated" | "already" | "unreadable" {
  const { file, source, raw } = readStateWith();
  if (source === "unreadable") return "unreadable";
  if (file.migrated) return "already";
  const rc = raw?.config;
  const from: Migrated["from"] =
    source === "missing"
      ? null
      : {
          mode: rc?.mode,
          roles: Object.fromEntries(ROLES.flatMap((r) => (rc?.roles?.[r]?.mode !== undefined ? [[r, { mode: rc.roles[r].mode }]] : []))),
          fingerprint: Object.fromEntries(ROLES.flatMap((r) => (rc?.fingerprint?.[r] !== undefined ? [[r, rc.fingerprint[r]]] : []))),
        };
  const up = upgradeOnce(file.config, now, from);
  writeState({ ...file, config: up.config, migrated: up.migrated });
  return "migrated";
}

// 임시 파일에 쓴 뒤 바꿔 놓는다(중간에 죽어도 반쯤 쓴 파일이 남지 않는다)
export function writeState(file: SquelchFile) {
  mkdirSync(config.stateDir, { recursive: true });
  const tmp = `${stateFile()}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(file, null, 1)}\n`);
  renameSync(tmp, stateFile());
}

// 판정 한 줄. fields·fields2는 바뀐 필드 경로만(값 없음). would는 v2가 on이었다면 어땠을지(open | quiet)
export interface LogLine {
  t: string;
  role: string;
  open: boolean;
  reason: string;
  fp: string | null;
  fingerprint?: Fingerprint;
  mode?: Mode; // 이 판정을 정한 모드(ATC-553: 켜진 뒤에 버린 tick을 가르는 데 쓴다)
  fp2?: string;
  would?: "open" | "quiet";
  would1?: "open" | "quiet"; // 판정이 v2일 때 v1이 어땠을지(틀린 skip 점검용, ATC-553)
  reason2?: string;
  fields?: string[];
  fields2?: string[];
}
function appendLog(line: LogLine) {
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

// 한 번의 판정. 상태는 "on이었다면"의 흐름을 따른다: 열려야 했던 통과만 마지막 통과로 적고, QUIET이면 세기만 올린다.
// v1 흐름과 v2 흐름은 따로 흐른다. 판정은 역할의 config.fingerprint(기본 v1)가 정하고, 다른 쪽은 would로만 적는다
export async function squelchRun(role: Role, get: Fetcher, now = Date.now(), manual: (r: Role) => Promise<boolean> = manualChangedOf): Promise<Outcome> {
  const file = readState();
  const inputs = await gatherInputs(role, get);
  const proj1 = project(role, inputs);
  const fp = fingerprint(proj1);
  // v2는 후보다: 계산이 실패하면 없는 것으로 보고 v1로 판정한다
  let proj2: unknown = null;
  let fp2: string | null = null;
  try {
    proj2 = projectV2(role, inputs);
    fp2 = fingerprint(proj2);
  } catch {}
  const s = file.roles[role];
  const manualChanged = await manual(role);
  const heartbeatMin = file.config.heartbeatMin[role];
  const last1 = s?.fp && s.openedAt ? { fp: s.fp, openedAt: s.openedAt } : null;
  const last2 = s?.v2?.fp && s.v2.openedAt ? { fp: s.v2.fp, openedAt: s.v2.openedAt } : null;
  const nat1 = naturalReason({ fp, last: last1, now, heartbeatMin, manualChanged });
  const nat2 = fp2 === null ? undefined : naturalReason({ fp: fp2, last: last2, now, heartbeatMin, manualChanged });
  const live: Fingerprint = file.config.fingerprint[role] === "v2" && fp2 !== null ? "v2" : "v1";
  const liveNat = live === "v2" ? (nat2 ?? null) : nat1;
  const mode = modeOf(file.config, role);
  const d = decide({ fp: live === "v2" ? fp2! : fp, last: live === "v2" ? last2 : last1, now, heartbeatMin, manualChanged, mode });
  const iso = new Date(now).toISOString();
  let next: RoleState;
  if (mode === "off") next = s ?? { fp: null, openedAt: null, quietSince: null, quietCount: 0 };
  else {
    next = {
      ...(nat1 ? { fp, openedAt: iso, proj: proj1 } : { fp: s!.fp, openedAt: s!.openedAt, ...(s!.proj !== undefined ? { proj: s!.proj } : {}) }),
      ...(liveNat ? { quietSince: null, quietCount: 0 } : { quietSince: s!.quietSince ?? iso, quietCount: (s!.quietCount ?? 0) + 1 }),
    };
    if (fp2 !== null && nat2) next.v2 = { fp: fp2, openedAt: iso, proj: proj2 };
    else if (s?.v2) next.v2 = s.v2;
  }
  // 판정 사이에 SUPERVISOR가 설정을 바꿨을 수 있다: 설정은 지금 파일 것을 두고 이 역할의 상태만 얹는다(ATC-552)
  const cur = readState();
  cur.roles[role] = next;
  writeState(cur);
  const line: LogLine = { t: iso, role, open: d.open, reason: d.reason, fp, fingerprint: live, mode };
  if (live === "v2") line.would1 = nat1 ? "open" : "quiet";
  if (fp2 !== null) {
    line.fp2 = fp2;
    line.would = nat2 ? "open" : "quiet";
    line.reason2 = nat2 ?? "quiet";
  }
  // 신호로 열린 통과는 무엇이 바뀌었는지(필드 경로만)
  if (nat1 === "signal" && s?.proj !== undefined) line.fields = changedFields(s.proj, proj1);
  if (nat2 === "signal" && s?.v2?.proj !== undefined) line.fields2 = changedFields(s.v2.proj, proj2);
  appendLog(line);
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

  // 모드·하트비트와 역할별 마지막 통과(S5 화면이 읽는다). 지난 통과의 투영(proj)은 크고 값이 들어 있어 내보내지 않는다
  app.get("/api/squelch", (c) => {
    const f = readState();
    const roles = Object.fromEntries(
      Object.entries(f.roles).map(([r, s]) => {
        const { proj: _p, v2, ...rest } = s!;
        return [r, { ...rest, ...(v2 ? { v2: { fp: v2.fp, openedAt: v2.openedAt } } : {}) }];
      }),
    );
    return c.json({ config: f.config, roles });
  });

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

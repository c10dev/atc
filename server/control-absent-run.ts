import { mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Hono } from "hono";
import { accountFolders, folderOfAccount } from "./accounts.ts";
import { config } from "./config.ts";
import {
  type AbsentCounts,
  type AbsentEscalation,
  type AbsentLine,
  absentCountsOf,
  absentMinutesByDay,
  absentProofOf,
  type AbsentSettings,
  type OnOff,
  parseAbsentSettings,
  type ProofFacts,
  type ProofResult,
  STARTUP_SETTLE_MS,
  stepOf,
} from "./control-absent.ts";
import { bootAtOf, procAlive, readRoster } from "./job-liveness-io.ts";
import { fromThisApp } from "./origin.ts";
import type { Snapshot } from "./model.ts";
import { readRecords, type RecordLine, record } from "./recorder.ts";
import { CONTROL_DOWN_GRACE_MS, type ControlOp } from "./supervisor-alerts.ts";

// CONTROL ABSENT(ATC-532)의 읽기·기록·LAUNCH. 판단은 control-absent.ts(순수). 1분마다 jobs/control-absent.ts가 controlAbsentPass를 부른다.
// 결정(없음의 시작·끝, 다시 띄움, 알림, 확인, 오탐 표시)은 새 상태 파일 없이 FLIGHT RECORDER(`control absent`)에 남고, 서버를 다시 켜면 거기서 열린 없음을 되살린다.
// 설정은 control-absent.json(원자적 JSON)이고 설정 창(server/switches/control-absent-*.ts)에서만 바꾼다 — atcctl 명령은 없다.
// session-control.ts·supervisor-alerts-run.ts를 가져오지 않는다(순환): LAUNCH·세션 목록·마지막 동작은 부르는 쪽(jobs/control-absent.ts)이 넘긴다.

const MIN = 60_000;
const DAY = 86_400_000;
const LOOKBACK_MS = 30 * DAY;
const RESTORE_MS = 14 * DAY;
const FILE = () => join(config.stateDir, "control-absent.json");

// ── 설정 ──
export function loadAbsentSettings(file = FILE()): AbsentSettings {
  try {
    return parseAbsentSettings(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return parseAbsentSettings(null);
  }
}
type SettingKey = "relaunch" | "escalate" | "quietPass" | "limitMin";
// 한 칸만 바꾼다. 바뀐 것만 FLIGHT RECORDER에 남긴다. 임시 파일을 넘기면(시험) 운영 기록에 쓰지 않는다
export function saveAbsentSetting<K extends SettingKey>(key: K, v: AbsentSettings[K], by = "SUPERVISOR", file = FILE()) {
  const cur = loadAbsentSettings(file);
  if (cur[key] === v) return;
  const next = { ...cur, [key]: v };
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  renameSync(tmp, file);
  if (file === FILE()) record({ t: new Date().toISOString(), kind: "policy", op: "control-absent-mode", by, key, from: String(cur[key]), to: String(v) });
}

// ── 증거 읽기(/proc, daemon roster, job state.json) ──
// cwd가 그 폴더(또는 그 아래)인 프로세스. 읽을 수 없는 프로세스는 건너뛴다. 이 서버 자신은 뺀다
export function cwdPidsOf(dir: string, proc = "/proc"): number[] {
  const want = resolve(dir);
  const out: number[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(proc);
  } catch {
    return out;
  }
  for (const n of names) {
    if (!/^\d+$/.test(n) || Number(n) === process.pid) continue;
    try {
      const cwd = readlinkSync(join(proc, n, "cwd"));
      if (cwd === want || cwd.startsWith(want + "/")) out.push(Number(n));
    } catch {}
  }
  return out;
}

// ── 마지막으로 성공한 관제 LAUNCH(역할마다 job id·시각·ACCOUNT). 처음 한 번 14일을 읽고 그 뒤로는 겹쳐 읽는다 ──
export interface LastJob {
  id: string;
  launchedAt: number;
  account: string | null;
}
const lastJobs = new Map<string, LastJob & { t: string }>();
let jobsReadFrom = 0;
export function lastJobsNow(now: number, read: (sinceMs: number) => RecordLine[] = readRecords): ReadonlyMap<string, LastJob> {
  const from = jobsReadFrom || now - RESTORE_MS;
  jobsReadFrom = now - 5 * MIN; // launchControl은 t를 먼저 정하고 claude 호출 뒤에 줄을 붙인다(supervisor-alerts-run.ts CONTROL_READ_OVERLAP_MS와 같은 까닭)
  for (const r of read(from)) {
    if (r.kind !== "control" || r.op !== "launch" || !r.ok || !r.jobId) continue;
    const prev = lastJobs.get(r.session);
    if (!prev || prev.t <= r.t) lastJobs.set(r.session, { t: r.t, id: r.jobId, launchedAt: Date.parse(r.t), account: r.account ?? null });
  }
  return lastJobs;
}

// 실제 증거(살아 있는 줄은 부르는 쪽이 넘긴다)
export function realProofFacts(dir: string | null, job: LastJob | null, jobState: (id: string) => string | null): Omit<ProofFacts, "liveRows" | "lastJob"> {
  const configDir = folderOfAccount(job?.account ?? null, accountFolders())?.dir ?? config.claudeDir;
  const roster = readRoster(configDir);
  const w = job && roster ? roster.workers.get(job.id) : undefined;
  return {
    cwdPids: dir ? cwdPidsOf(dir) : [],
    jobState: job ? jobState(job.id) : null,
    workerLive: roster ? Boolean(w && procAlive(w.pid, w.procStart)) : null,
    bootAt: bootAtOf(),
  };
}

// ── 한 주기 ──
export interface AbsentDeps {
  now: () => number;
  roles: readonly { name: string; dir: string | null }[]; // 띄우는 관제 세션(은퇴·배지만은 뺀다)
  present: (s: Snapshot) => ReadonlySet<string>; // 스냅샷에 살아 있는 관제 세션(supervisor alerts와 같은 판정)
  liveRows: () => Promise<((name: string) => string[]) | null>; // claude agents의 살아 있는(STALE 아닌) 줄. 못 읽으면 null
  lastOps: (now: number) => ReadonlyMap<string, ControlOp>; // 역할마다 마지막 control launch·stop·recycle
  lastJobs: (now: number) => ReadonlyMap<string, LastJob>;
  facts: (dir: string | null, job: LastJob | null) => Omit<ProofFacts, "liveRows" | "lastJob">;
  launch: (name: string) => Promise<{ ok: boolean; jobId?: string; error?: string }>; // launchControl(그 역할의 깨움 스위치가 첫 프롬프트를 정한다)
  recycling: () => string | null; // CONTROL RECYCLE·WAKE 옮기기가 STOP → LAUNCH 사이에 있는 세션
  production: () => boolean; // 운영 서버(writerModeOf === "production")만 띄운다
  auto: () => Readonly<Record<string, boolean>>; // control-recycle.json auto
  settings: () => AbsentSettings;
}

interface Episode {
  since: number;
  startup: boolean;
  lastJobId: string | null;
  attempted: string | null;
  escalation: { n: number; at: number; line: string } | null;
  view: AbsentEscalation | null;
  acked: boolean;
}
const episodes = new Map<string, Episode>();
const lastRelaunch = new Map<string, number>();
let firstPassAt: number | null = null;
let busy = false;

// 시험이 기억을 비운다
export const resetControlAbsent = () => {
  episodes.clear();
  lastRelaunch.clear();
  lastJobs.clear();
  jobsReadFrom = 0;
  firstPassAt = null;
  busy = false;
};

const absentLines = (sinceMs: number): AbsentLine[] => readRecords(sinceMs).flatMap((r) => (r.kind === "control" && r.op === "absent" ? [r] : []));
const note = (l: Omit<AbsentLine, "kind" | "op">) => record({ kind: "control", op: "absent", ...l });

// 서버를 켠 뒤 처음: 열린 없음(start 뒤에 end가 없는 것)을 되살린다. 서버가 다시 뜬 것이므로 다시 띄우기를 한 번 더 해 볼 수 있다(attempted 비움, startup)
function restore(now: number) {
  const lines = absentLines(now - RESTORE_MS).sort((a, b) => a.t.localeCompare(b.t));
  for (const l of lines) {
    if (l.event === "relaunch" && l.ok) lastRelaunch.set(l.session, Date.parse(l.t));
    if (l.event === "start") episodes.set(l.session, { since: Date.parse(l.t), startup: true, lastJobId: l.lastJobId ?? null, attempted: null, escalation: null, view: null, acked: false });
    const ep = episodes.get(l.session);
    if (!ep) continue;
    if (l.event === "end") episodes.delete(l.session);
    else if (l.event === "escalate") ep.escalation = { n: l.n ?? 1, at: Date.parse(l.t), line: l.t };
    else if (l.event === "ack" || l.event === "false") ep.acked = true;
  }
}

export interface AbsentPassResult {
  relaunched: string[];
  escalated: string[];
  ended: string[];
  skipped: string | null;
}

export async function controlAbsentPass(s: Snapshot, d: AbsentDeps): Promise<AbsentPassResult> {
  const out: AbsentPassResult = { relaunched: [], escalated: [], ended: [], skipped: null };
  if (busy) return { ...out, skipped: "busy" };
  busy = true;
  try {
    const now = d.now();
    if (firstPassAt === null) {
      firstPassAt = now;
      restore(now);
    }
    const settings = d.settings();
    const present = d.present(s);
    const rowsOf = await d.liveRows().catch(() => null);
    const ops = d.lastOps(now);
    const jobs = d.lastJobs(now);
    const auto = d.auto();
    const iso = new Date(now).toISOString();
    for (const role of d.roles) {
      const name = role.name;
      const rows = rowsOf ? rowsOf(name) : [];
      const op = ops.get(name);
      const deliberate = op?.op === "stop" && op.by === "SUPERVISOR"; // SUPERVISOR의 STOP(성공 여부와 상관없이 그의 뜻)
      let ep = episodes.get(name);
      if (present.has(name) || rows.length || deliberate) {
        if (ep) {
          note({ t: iso, event: "end", session: name, by: "atc", minutes: Math.round((now - ep.since) / MIN), why: deliberate && !present.has(name) && !rows.length ? "SUPERVISOR STOP" : "세션이 다시 보임" });
          episodes.delete(name);
          out.ended.push(name);
        }
        continue;
      }
      if (op && now - Date.parse(op.t) < CONTROL_DOWN_GRACE_MS) continue; // 막 뜨거나 멈춘 세션은 행이 나타나기까지 기다린다
      if (d.recycling() === name) continue; // RECYCLE·WAKE 옮기기의 STOP → LAUNCH 사이
      const job = jobs.get(name) ?? null;
      if (!ep) {
        ep = { since: now, startup: now - firstPassAt <= STARTUP_SETTLE_MS, lastJobId: job?.id ?? null, attempted: null, escalation: null, view: null, acked: false };
        episodes.set(name, ep);
        note({ t: iso, event: "start", session: name, by: "atc", ...(ep.lastJobId ? { lastJobId: ep.lastJobId } : {}), ...(ep.startup ? { startup: true as const } : {}) });
      }
      if (job) ep.lastJobId = job.id;
      const input = {
        absentSince: ep.since,
        startup: ep.startup,
        firstPassAt,
        now,
        settings,
        auto: auto[name] ?? false,
        production: d.production(),
        proof: (): ProofResult => (rowsOf ? absentProofOf({ ...d.facts(role.dir, job), liveRows: rows, lastJob: job }) : { proof: "unknown", why: "claude agents를 읽지 못함" }),
        attempted: ep.attempted,
        lastRelaunchAt: lastRelaunch.get(name) ?? null,
        escalation: ep.escalation,
        acked: ep.acked,
      };
      let step = stepOf(input, name);
      if (step.do === "relaunch") {
        const r = await d.launch(name).catch((e: unknown) => ({ ok: false, error: String((e as Error)?.message ?? e) }) as { ok: boolean; jobId?: string; error?: string });
        note({ t: new Date(d.now()).toISOString(), event: "relaunch", session: name, by: "atc", ok: r.ok, ...(r.jobId ? { jobId: r.jobId } : {}), ...(ep.lastJobId ? { lastJobId: ep.lastJobId } : {}), proof: step.proof.why, ...(r.ok ? {} : { why: r.error ?? "LAUNCH 실패" }), ...(ep.startup ? { startup: true as const } : {}) });
        ep.attempted = r.ok ? `${new Date(now).toISOString().slice(11, 16)}Z에 다시 띄웠지만(job ${r.jobId ?? "?"}) 세션이 보이지 않음` : `다시 띄우기 거절·실패: ${r.error ?? "LAUNCH 실패"}`;
        if (r.ok) {
          lastRelaunch.set(name, now);
          out.relaunched.push(name);
          continue;
        }
        step = stepOf({ ...input, attempted: ep.attempted }, name);
      }
      if (step.do === "escalate") {
        const minutes = Math.round((now - ep.since) / MIN);
        ep.escalation = { n: step.n, at: now, line: iso };
        ep.view = { session: name, n: step.n, since: new Date(ep.since).toISOString(), at: iso, minutes, lastJobId: ep.lastJobId, why: step.why, passQuiet: settings.quietPass === "on" };
        note({ t: iso, event: "escalate", session: name, by: "atc", n: step.n, minutes, why: step.why, ...(ep.lastJobId ? { lastJobId: ep.lastJobId } : {}), ...(ep.startup ? { startup: true as const } : {}) });
        out.escalated.push(name);
      } else if (ep.view) ep.view = { ...ep.view, minutes: Math.round((now - ep.since) / MIN), passQuiet: settings.quietPass === "on" };
    }
    // 이제 띄우지 않는 역할(목록에서 빠짐)의 열린 없음은 닫는다
    for (const [name, ep] of [...episodes]) {
      if (d.roles.some((r) => r.name === name)) continue;
      note({ t: iso, event: "end", session: name, by: "atc", minutes: Math.round((now - ep.since) / MIN), why: "더 띄우지 않는 역할" });
      episodes.delete(name);
    }
    return out;
  } finally {
    busy = false;
  }
}

// 지금 열린 알림(SUPERVISOR alerts의 control|absent). 알림 스위치가 꺼졌거나 SUPERVISOR가 확인한 것은 없다
export function absentEscalationsNow(settings: AbsentSettings = loadAbsentSettings()): AbsentEscalation[] {
  if (settings.escalate === "off") return [];
  return [...episodes.values()]
    .filter((e) => e.view && !e.acked)
    .map((e) => ({ ...e.view!, passQuiet: settings.quietPass === "on" }))
    .sort((a, b) => a.session.localeCompare(b.session));
}

// SUPERVISOR가 확인함: 그 없음의 알림을 걷고 되풀이하지 않는다(목록의 control|down WARNING은 그대로)
export function ackAbsent(session: string, by = "SUPERVISOR", now = Date.now()): boolean {
  const ep = episodes.get(session);
  if (!ep || !ep.escalation || ep.acked) return false;
  ep.acked = true;
  note({ t: new Date(now).toISOString(), event: "ack", session, by, of: ep.escalation.line });
  return true;
}
// SUPERVISOR가 틀린 알림으로 표시(오작동 수). 그 없음이 아직 열려 있으면 확인과 같이 걷는다. 한 주기의 알림 줄은 t가 같으므로 세션까지 맞춘다
export function markAbsentFalse(t: string, session: string, by = "SUPERVISOR", now = Date.now()): boolean {
  const l = absentLines(now - LOOKBACK_MS).find((x) => x.t === t && x.session === session && x.event === "escalate");
  if (!l) return false;
  note({ t: new Date(now).toISOString(), event: "false", session: l.session, by, of: t });
  const ep = episodes.get(l.session);
  if (ep && ep.escalation && Date.parse(l.t) >= ep.since) ep.acked = true;
  return true;
}

// 설정 창·GET이 읽는 자료
export interface AbsentData {
  settings: AbsentSettings;
  last7d: AbsentCounts;
  last30d: AbsentCounts;
  open: { session: string; since: string; minutes: number; lastJobId: string | null; escalated: number; acked: boolean; why: string | null; at: string | null }[];
  recent: (AbsentLine & { marked: boolean })[]; // 최근 결정 줄(다시 띄움·알림), 새것 먼저
  days: { day: string; minutes: Record<string, number> }[]; // 날마다 역할별 없던 분(최근 7일)
}
export function absentData(now = Date.now()): AbsentData {
  const lines = absentLines(now - LOOKBACK_MS);
  const others = readRecords(now - LOOKBACK_MS).filter((r) => r.kind === "control" && r.op === "stop-check") as unknown as { t: string; kind: string; op?: string; event?: string; session?: string }[];
  const marked = new Set(lines.filter((l) => l.event === "false").map((l) => `${l.session}|${l.of}`));
  return {
    settings: loadAbsentSettings(),
    last7d: absentCountsOf(lines, others, now - 7 * DAY, now + 1),
    last30d: absentCountsOf(lines, others, now - LOOKBACK_MS, now + 1),
    open: [...episodes.entries()]
      .map(([session, e]) => ({ session, since: new Date(e.since).toISOString(), minutes: Math.round((now - e.since) / MIN), lastJobId: e.lastJobId, escalated: e.escalation?.n ?? 0, acked: e.acked, why: e.view?.why ?? e.attempted, at: e.escalation?.line ?? null }))
      .sort((a, b) => a.session.localeCompare(b.session)),
    recent: lines
      .filter((l) => l.event === "relaunch" || (l.event === "escalate" && (l.n ?? 1) === 1))
      .sort((a, b) => b.t.localeCompare(a.t))
      .slice(0, 5)
      .map((l) => ({ ...l, marked: marked.has(`${l.session}|${l.t}`) })),
    days: absentMinutesByDay(lines, now, 7),
  };
}

// GET /api/control-absent: 설정·수·열린 없음·최근 결정·날마다 없던 분(읽기만). ACK와 오탐 표시는 SUPERVISOR 자격이 필요한 POST(supervisorGate)이고 이 화면에서만
export function mountControlAbsent(app: Hono) {
  app.get("/api/control-absent", (c) => c.json(absentData()));
  app.post("/api/control-absent/ack", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const body = (await c.req.json().catch(() => null)) as { session?: unknown } | null;
    if (typeof body?.session !== "string" || !ackAbsent(body.session.toUpperCase())) return c.json({ error: "열린 알림이 없음" }, 404);
    return c.json({ ok: true });
  });
  app.post("/api/control-absent/false", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const body = (await c.req.json().catch(() => null)) as { t?: unknown; session?: unknown } | null;
    if (typeof body?.t !== "string" || typeof body.session !== "string" || !markAbsentFalse(body.t, body.session.toUpperCase())) return c.json({ error: "그런 알림 줄이 없음" }, 404);
    return c.json({ ok: true });
  });
}

export type { OnOff };

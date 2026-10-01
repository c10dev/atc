import { appendFileSync, closeSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { projectDirName } from "./control-recycle-run.ts";
import { projectsRoots } from "./fuel-run.ts";
import { readRecords } from "./recorder.ts";
import { parseDays } from "./readability-run.ts";
import { ROLE_DIRS } from "./squelch-run.ts";
import { type Counts, emptyScan, matchNamed, type Named, openedRate, OPEN_WINDOW_MS, scanLine, type SessionCalls, type Usage, usageOf } from "./skill-calls.ts";

// SKILL-CALL READER(ATC-289): 하루에 한 번 어제의 Skill·sub-agent 호출 수와 qrh.named → opened를 skill-usage.jsonl에 한 줄로 더한다(추가만).
// 대화 기록은 읽기만 하고 줄 단위로 흘려 읽는다. 남기는 것은 세션·이름·시각뿐이다.

export const START_DAY = "2026-10-01";
const DAY_MS = 86_400_000;
export const SKILL_USAGE_FILE = () => join(config.stateDir, "skill-usage.jsonl");
const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
// 일 제한: 파일 수, 파일 하나의 크기, 한 줄의 크기. 넘는 것은 건너뛰고 skipped로 센다
export const MAX_FILES = 3000;
export const MAX_FILE_BYTES = 256 * 1024 * 1024;
export const MAX_LINE_BYTES = 32 * 1024 * 1024;

// 파일을 1 MB씩 읽어 줄마다 cb를 부른다. 한 줄이 MAX_LINE_BYTES를 넘으면 그 줄은 버린다
export function forEachLine(path: string, cb: (line: string) => void): void {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    let rest: Buffer[] = [];
    let restLen = 0;
    let dropping = false;
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      let start = 0;
      for (let i = 0; i < n; i++) {
        if (buf[i] !== 0x0a) continue;
        if (!dropping) {
          rest.push(Buffer.from(buf.subarray(start, i)));
          cb(Buffer.concat(rest).toString("utf8"));
        }
        rest = [];
        restLen = 0;
        dropping = false;
        start = i + 1;
      }
      if (start < n && !dropping) {
        restLen += n - start;
        if (restLen > MAX_LINE_BYTES) {
          dropping = true;
          rest = [];
          restLen = 0;
        } else rest.push(Buffer.from(buf.subarray(start, n)));
      }
    }
    if (!dropping && restLen > 0) cb(Buffer.concat(rest).toString("utf8"));
  } finally {
    closeSync(fd);
  }
}

interface FileCache {
  size: number;
  mtimeMs: number;
  s: SessionCalls;
}
const fileCache = new Map<string, FileCache>();

export interface ReadStats {
  files: number;
  skipped: number; // 크기·개수 제한으로 건너뜀
}
// 계정 폴더마다 projects/<폴더>/<sessionId>.jsonl(맨 위 파일만. 하위 폴더의 sub-agent 기록은 부모 기록의 Agent 호출로 센다).
// sinceMs 뒤에 바뀐 파일만 읽고, 파일마다 크기·mtime으로 캐시한다
export function readSessionCalls(sinceMs: number, roots: readonly string[] = projectsRoots(), repoRoot = REPO_ROOT, stats?: ReadStats): SessionCalls[] {
  const roleOfDir = new Map(Object.entries(ROLE_DIRS).map(([role, d]) => [projectDirName(join(repoRoot, d)), role]));
  const out: SessionCalls[] = [];
  let files = 0;
  for (const root of roots) {
    let dirs: string[] = [];
    try {
      dirs = readdirSync(root);
    } catch {
      continue;
    }
    for (const d of dirs) {
      let names: string[] = [];
      try {
        names = readdirSync(join(root, d)).filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const f of names) {
        const path = join(root, d, f);
        try {
          const st = statSync(path);
          if (!st.isFile() || st.mtimeMs < sinceMs) continue;
          if (files >= MAX_FILES || st.size > MAX_FILE_BYTES) {
            if (stats) stats.skipped++;
            continue;
          }
          files++;
          let hit = fileCache.get(path);
          if (!hit || hit.size !== st.size || hit.mtimeMs !== st.mtimeMs) {
            const scan = emptyScan();
            forEachLine(path, (l) => scanLine(l, scan));
            hit = { size: st.size, mtimeMs: st.mtimeMs, s: { session: f.slice(0, -".jsonl".length), reg: scan.reg, role: roleOfDir.get(d) ?? null, calls: scan.calls, turns: scan.turns } };
            fileCache.set(path, hit);
          }
          out.push(hit.s);
        } catch {}
      }
    }
  }
  if (stats) stats.files += files;
  return out;
}

// FLIGHT RECORDER의 qrh.named 줄(ATC-288). 그 줄이 아직 없으면 빈 목록
export function readNamed(sinceMs: number): Named[] {
  const out: Named[] = [];
  for (const r of readRecords(sinceMs) as unknown as { t?: string; kind?: string; op?: string; id?: string; session?: string; aircraft?: string; subject?: string }[]) {
    if (r.kind !== "qrh" || r.op !== "named" || typeof r.id !== "string" || typeof r.t !== "string") continue;
    out.push({ t: r.t, id: r.id, session: r.session, aircraft: r.aircraft, subject: r.subject });
  }
  return out;
}

// ── 하루 한 줄 ──
export interface DayLine {
  v: 1;
  day: string;
  computedAt: string;
  window: { from: string; to: string };
  skills: Usage["skills"];
  agents: Usage["agents"];
  bySession: Usage["bySession"];
  sessions: number;
  qrh: Counts & { openedRate: number | null };
}
export interface Inputs {
  sessions: readonly SessionCalls[];
  named: readonly Named[];
}
export interface Deps {
  now: () => number;
  load: (sinceMs: number) => Inputs;
  file: () => string;
}
export const realDeps = (): Deps => ({
  now: Date.now,
  load: (sinceMs) => ({ sessions: readSessionCalls(sinceMs), named: readNamed(sinceMs) }),
  file: SKILL_USAGE_FILE,
});

const dayStartMs = (day: string) => Date.parse(`${day}T00:00:00.000Z`);
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function windowUsage(from: string, to: string, inputs: Inputs) {
  const u = usageOf(inputs.sessions, from, to);
  const counts = matchNamed(inputs.named.filter((n) => n.t >= from && n.t < to), inputs.sessions);
  return { ...u, qrh: { ...counts, openedRate: openedRate(counts) } };
}
export function dayLineOf(day: string, inputs: Inputs, computedAt: string): DayLine {
  const from = new Date(dayStartMs(day)).toISOString();
  const to = new Date(dayStartMs(day) + DAY_MS).toISOString();
  return { v: 1, day, computedAt, window: { from, to }, ...windowUsage(from, to, inputs) };
}

export function readDayLines(file: string): DayLine[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: DayLine[] = [];
  for (const l of text.split("\n")) {
    if (!l) continue;
    try {
      const o = JSON.parse(l) as DayLine;
      if (typeof o.day === "string") out.push(o);
    } catch {}
  }
  return out;
}

let running = false;
// 빠진 날(START_DAY부터 어제까지, UTC)을 오래된 것부터 채운다. 실패한 날은 쓰지 않고 다음에 다시 한다.
// 하루가 끝나고 OPEN_WINDOW_MS가 지난 뒤에야 쓴다(그날 마지막 qrh.named의 판정 창이 닫히도록)
export function runSkillUsage(deps: Deps = realDeps()): { written: string[]; skipped: string[] } {
  const written: string[] = [];
  const skipped: string[] = [];
  if (running) return { written, skipped };
  running = true;
  try {
    const now = deps.now();
    const have = new Set(readDayLines(deps.file()).map((l) => l.day));
    const missing: string[] = [];
    for (let ms = dayStartMs(START_DAY); ms + DAY_MS + OPEN_WINDOW_MS <= now; ms += DAY_MS) if (!have.has(isoDay(ms))) missing.push(isoDay(ms));
    if (!missing.length) return { written, skipped };
    const inputs = deps.load(dayStartMs(missing[0]!));
    for (const day of missing) {
      try {
        const line = dayLineOf(day, inputs, new Date(deps.now()).toISOString());
        if (readDayLines(deps.file()).some((l) => l.day === day)) continue; // 다른 실행이 먼저 씀
        mkdirSync(dirname(deps.file()), { recursive: true });
        appendFileSync(deps.file(), JSON.stringify(line) + "\n");
        written.push(day);
      } catch {
        skipped.push(day);
      }
    }
    return { written, skipped };
  } finally {
    running = false;
  }
}

// GET /api/skills/usage?days=N: 저장된 줄(최근 N일) + 오늘의 부분 집계(요청 때 계산)
export function skillUsageView(days: number, deps: Deps = realDeps()) {
  const now = deps.now();
  const today = isoDay(now);
  const stored = readDayLines(deps.file())
    .filter((l) => l.day < today)
    .slice(-days);
  const from = dayStartMs(today);
  const inputs = deps.load(from);
  const window = { from: new Date(from).toISOString(), to: new Date(now + 1).toISOString() };
  return { at: new Date(now).toISOString(), days: stored, today: { day: today, partial: true, window, ...windowUsage(window.from, window.to, inputs) } };
}

export function mountSkillUsage(app: Hono, deps: Deps = realDeps()) {
  app.get("/api/skills/usage", (c) => {
    const p = parseDays(c.req.query("days"));
    if (!p.ok) return c.json({ error: p.error }, 400);
    return c.json(skillUsageView(p.days, deps));
  });
}

// 시작 40초 뒤에 한 번(빠진 날 채우기), 그 뒤 한 시간에 한 번. 채울 날이 없으면 파일 하나 읽고 끝난다
export function startSkillUsage(deps: Deps = realDeps()) {
  const tick = () => {
    try {
      const r = runSkillUsage(deps);
      if (r.written.length) console.log(`[atc] skill-usage: ${r.written.join(", ")}`);
    } catch (e) {
      console.warn(`[atc] skill-usage: ${e instanceof Error ? e.message : e}`);
    }
  };
  setTimeout(tick, 40_000).unref();
  setInterval(tick, 3_600_000).unref();
}

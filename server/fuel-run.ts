import { closeSync, type Dirent, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { readDepartures } from "./departures.ts";
import { type AgentMeta, type Compaction, dedupeFuel, type FuelRecord, parseFuelLines, summarizeFuel } from "./fuel.ts";
import { arrivedSpan, type Attribution, attributeFuel, enRouteSpans } from "./fuel-flights.ts";
import type { LogEntry } from "./logbook.ts";
import type { Snapshot } from "./model.ts";
import { readHookClaims } from "./sources/claude.ts";

// FUEL 읽기(ATC-50, docs/fuel.md 4): ~/.claude/projects의 대화 기록을 파일마다 지난번 바이트 뒤부터만 읽는다(talkEventsFile과 같은 방식).
// 본 대화 기록 <sessionId>.jsonl은 CAPTAIN, <sessionId>/subagents/**/agent-*.jsonl은 CREW. 읽기만 하고 아무것도 쓰지 않는다.

const DAY_MS = 86_400_000;
export const FUEL_DEFAULT_DAYS = 7;
export const FUEL_MAX_DAYS = 30;
const CHUNK = 4 * 1024 * 1024;

interface FuelFile {
  path: string;
  session: string;
  crew: boolean;
  agent: string | null;
  mtime: number;
}
interface FileState {
  ino: number;
  size: number; // 읽은 데까지(마지막 줄바꿈 뒤)
  records: Map<string, FuelRecord>; // 파일 안에서 먼저 중복을 없앤 기록
  compactions: Compaction[];
  unknown: number;
  name: string | null;
  meta: AgentMeta | null;
}
const cache = new Map<string, FileState>();

// agent-*.meta.json에서 agentType·spawnDepth만(description 같은 나머지는 버린다)
export function parseAgentMeta(text: string): AgentMeta | null {
  try {
    const d = JSON.parse(text);
    return {
      agentType: typeof d?.agentType === "string" ? d.agentType : null,
      spawnDepth: typeof d?.spawnDepth === "number" ? d.spawnDepth : null,
    };
  } catch {
    return null;
  }
}

function dirents(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
function mtimeOf(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

// 기간 안에 바뀐 기록 파일. subagents 아래는 workflows/wf_*/ 같은 하위 폴더까지 본다
export function fuelFiles(since: number, root = join(config.claudeDir, "projects")): FuelFile[] {
  const out: FuelFile[] = [];
  const crewIn = (dir: string, session: string, depth: number) => {
    for (const e of dirents(dir)) {
      const p = join(dir, e.name);
      if (e.isDirectory() && depth < 3) crewIn(p, session, depth + 1);
      else if (e.isFile() && e.name.startsWith("agent-") && e.name.endsWith(".jsonl")) {
        const m = mtimeOf(p);
        if (m !== null && m >= since) out.push({ path: p, session, crew: true, agent: e.name.slice(6, -6), mtime: m });
      }
    }
  };
  for (const proj of dirents(root)) {
    if (!proj.isDirectory()) continue;
    const pdir = join(root, proj.name);
    for (const e of dirents(pdir)) {
      const p = join(pdir, e.name);
      if (e.isFile() && e.name.endsWith(".jsonl")) {
        const m = mtimeOf(p);
        if (m !== null && m >= since) out.push({ path: p, session: e.name.slice(0, -6), crew: false, agent: null, mtime: m });
      } else if (e.isDirectory()) crewIn(join(p, "subagents"), e.name, 0);
    }
  }
  return out.sort((a, b) => a.mtime - b.mtime || a.path.localeCompare(b.path));
}

// 한 파일을 지난번 크기 뒤부터 읽는다. 줄었거나 다른 파일로 바뀌었으면 처음부터. 쓰다 만 끝줄은 다음에 읽는다
export function readFuelFile(f: FuelFile): { state: FileState; bytes: number } {
  let st: { size: number; ino: number };
  try {
    st = statSync(f.path);
  } catch {
    cache.delete(f.path);
    return { state: emptyState(0), bytes: 0 };
  }
  let s = cache.get(f.path);
  if (!s || st.ino !== s.ino || st.size < s.size) s = emptyState(st.ino);
  if (f.crew && !s.meta) {
    try {
      s.meta = parseAgentMeta(readFileSync(f.path.replace(/\.jsonl$/, ".meta.json"), "utf8"));
    } catch {}
  }
  cache.set(f.path, s);
  if (st.size === s.size) return { state: s, bytes: 0 };
  const start = s.size;
  const fd = openSync(f.path, "r");
  try {
    const buf = Buffer.alloc(CHUNK);
    let pos = s.size;
    while (pos < st.size) {
      const n = readSync(fd, buf, 0, Math.min(CHUNK, st.size - pos), pos);
      if (n <= 0) break;
      const cut = buf.lastIndexOf(0x0a, n - 1);
      if (cut >= 0) {
        take(s, f, buf.toString("utf8", 0, cut));
        pos += cut + 1;
        continue;
      }
      if (n < CHUNK) break; // 끝줄이 아직 쓰이는 중
      // 4MB를 넘는 한 줄: 다음 줄바꿈까지 건너뛴다. 사용량 줄이었을 수 있으면 모르는 줄로 센다
      const usage = buf.includes('"usage"');
      let skip = pos + n;
      let found = -1;
      while (skip < st.size && found < 0) {
        const m = readSync(fd, buf, 0, Math.min(CHUNK, st.size - skip), skip);
        if (m <= 0) break;
        const nl = buf.indexOf(0x0a);
        if (nl >= 0 && nl < m) found = skip + nl;
        else skip += m;
      }
      if (found < 0) break;
      if (usage) s.unknown++;
      pos = found + 1;
    }
    s.size = pos;
    return { state: s, bytes: pos - start };
  } finally {
    closeSync(fd);
  }
}

function emptyState(ino: number): FileState {
  return { ino, size: 0, records: new Map(), compactions: [], unknown: 0, name: null, meta: null };
}

function take(s: FileState, f: FuelFile, text: string) {
  const p = parseFuelLines(text, { session: f.session, crew: f.crew, agent: f.agent });
  dedupeFuel(p.records, s.records);
  s.compactions.push(...p.compactions);
  s.unknown += p.unknown;
  if (p.name) s.name = p.name;
}

export interface FuelScan {
  records: Map<string, FuelRecord>; // 전역 중복 제거를 마친 기록(기간 앞 기록이 섞여 있을 수 있다)
  compactions: Compaction[];
  unknownBySession: Map<string, number>;
  names: Map<string, string>; // session → 이름. 스냅샷의 Claude 세션, 없으면 기록의 agent-name 줄
  live: Set<string>;
  agents: Map<string, AgentMeta>;
  files: number;
  bytes: number;
}

// since 뒤에 바뀐 기록 파일을 읽는다(파일마다 지난번 바이트 뒤부터). GET /api/fuel과 LOGBOOK(FUEL F4)이 같이 쓴다
export function scanFuel(since: number, sessions: Snapshot["sessions"]): FuelScan {
  const files = fuelFiles(since);
  const seen = new Set(files.map((f) => f.path));
  // 더 긴 기간으로 한 번 읽은 파일은 캐시에 남기고, 없어진 파일만 지운다
  for (const p of cache.keys()) if (!seen.has(p) && mtimeOf(p) === null) cache.delete(p);
  let bytes = 0;
  const all = new Map<string, FuelRecord>();
  const compactions: Compaction[] = [];
  const unknownBySession = new Map<string, number>();
  const names = new Map<string, string>();
  const agents = new Map<string, AgentMeta>();
  for (const f of files) {
    const r = readFuelFile(f);
    bytes += r.bytes;
    dedupeFuel(r.state.records.values(), all);
    compactions.push(...r.state.compactions);
    if (r.state.unknown) unknownBySession.set(f.session, (unknownBySession.get(f.session) ?? 0) + r.state.unknown);
    if (!f.crew && r.state.name) names.set(f.session, r.state.name);
    if (f.agent && r.state.meta) agents.set(f.agent, r.state.meta);
  }
  const live = new Set<string>();
  for (const s of sessions) {
    if (s.agent !== "claude") continue;
    if (s.status !== "dead") live.add(s.id);
    if (s.name && s.name !== s.id.slice(0, 8)) names.set(s.id, s.name);
  }
  return { records: all, compactions, unknownBySession, names, live, agents, files: files.length, bytes };
}

export type FlightContext = Pick<Snapshot, "workspaces" | "airports" | "claims">;

// 기간 안 기록을 FLIGHT 구간으로 자른다(FUEL F4). 구간은 기간 안에 도착한 LOGBOOK FLIGHT와 지금 있는 STAND의 EN ROUTE FLIGHT
export function attributeWindow(scan: FuelScan, s: FlightContext, entries: LogEntry[], since: number, now: number): Attribution {
  const departures = readDepartures();
  const repoOf = new Map(s.airports.map((a) => [a.code, a.repo]));
  const open = new Set(s.workspaces.filter((w) => !w.isMain).map((w) => w.path));
  const spans = [
    ...entries.filter((e) => Date.parse(e.arrivedAt) >= since).map((e) => arrivedSpan(e, departures, (e.airport && repoOf.get(e.airport)) || null)),
    ...enRouteSpans(departures, entries, open, now),
  ];
  const records = [...scan.records.values()].filter((r) => Date.parse(r.t) >= since && Date.parse(r.t) <= now);
  return attributeFuel({
    records,
    spans,
    aircraftOf: (id) => scan.names.get(id)?.toUpperCase() ?? null,
    claims: [...readHookClaims(), ...s.claims],
  });
}

// GET /api/fuel의 본문. AIRCRAFT마다 ARRIVED FLIGHT·EN ROUTE·UNATTRIBUTED 몫을 붙인다
export function readFuel(days: number, s: FlightContext & Pick<Snapshot, "sessions">, entries: LogEntry[], now = Date.now()) {
  const t0 = performance.now();
  const since = now - days * DAY_MS;
  const scan = scanFuel(since, s.sessions);
  const summary = summarizeFuel({ ...scan, records: scan.records.values(), now, days });
  const att = attributeWindow(scan, s, entries, since, now);
  return {
    at: new Date(now).toISOString(),
    ...summary,
    aircraft: summary.aircraft.map((a) => ({ ...a, attribution: att.aircraft.get(a.aircraft) ?? null })),
    attribution: { totals: att.totals, flights: att.flights },
    scan: { files: scan.files, bytesRead: scan.bytes, ms: Math.round(performance.now() - t0) },
  };
}

export function fuelDays(q: string | undefined): number {
  const n = Number(q);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, FUEL_MAX_DAYS) : FUEL_DEFAULT_DAYS;
}

// loadEntries는 접은 LOGBOOK(logbook.ts가 이 파일을 부르므로 index.ts가 넘긴다)
export function mountFuel(app: Hono, getSnapshot: () => Promise<Snapshot>, loadEntries: () => LogEntry[]) {
  // 읽기 전용. 세션·AIRCRAFT별 FUEL BURN(다섯 가지, CAPTAIN·CREW, CACHE HIT)과 FLIGHT 몫·UNATTRIBUTED. 비용은 F5, 화면은 F8
  app.get("/api/fuel", async (c) => {
    const s = await getSnapshot();
    return c.json(readFuel(fuelDays(c.req.query("days")), s, loadEntries()));
  });
}

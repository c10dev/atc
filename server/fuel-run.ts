import { closeSync, type Dirent, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import { allClearances } from "./clearances.ts";
import { config } from "./config.ts";
import { allCrewChanges } from "./crew-change.ts";
import { readDepartures } from "./departures.ts";
import { rememberAgentModels } from "./agent-models.ts";
import type { CrewMember } from "./crew.ts";
import { loadFleet } from "./fleet.ts";
import { agentModels, type CrewWarning, crewWarnings } from "./fuel-crew.ts";
import { type PriceTable, priceFlightFuel } from "./fuel-cost.ts";
import { readPrices } from "./fuel-prices.ts";
import { type Baseline, controlSendsOf, findLeaks, type LeakEvent, sessionChangeLeaks } from "./fuel-leaks.ts";
import { type AgentMeta, type Compaction, dedupeFuel, type FuelRecord, type ModelCommand, parseFuelLines, summarizeFuel } from "./fuel.ts";
import { type ContextSize, contextSizeOf, contextView, sessionContexts, type StatusWindow } from "./fuel-context.ts";
import { arrivedSpan, type Attribution, attributeFuel, type ClaimSpan, enRouteSpans, flightOf, fuelForEntry } from "./fuel-flights.ts";
import type { LogEntry, LogLine } from "./logbook.ts";
import type { Snapshot } from "./model.ts";
import { allProposals } from "./proposals.ts";
import { readHookClaims } from "./sources/claude.ts";
import { type FuelLimitsRecord, lastRecordWith, readTail } from "../hooks/fuel-statusline.mjs";
import { fleetKeyOf, regKey } from "./registration.ts";

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
  modelCommands: ModelCommand[];
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
  return { ino, size: 0, records: new Map(), compactions: [], modelCommands: [], unknown: 0, name: null, meta: null };
}

function take(s: FileState, f: FuelFile, text: string) {
  const p = parseFuelLines(text, { session: f.session, crew: f.crew, agent: f.agent });
  dedupeFuel(p.records, s.records);
  s.compactions.push(...p.compactions);
  s.modelCommands.push(...p.modelCommands);
  s.unknown += p.unknown;
  if (p.name) s.name = p.name;
}

export interface FuelScan {
  records: Map<string, FuelRecord>; // 전역 중복 제거를 마친 기록(기간 앞 기록이 섞여 있을 수 있다)
  compactions: Compaction[];
  modelCommands: ModelCommand[];
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
  const modelCommands: ModelCommand[] = [];
  const unknownBySession = new Map<string, number>();
  const names = new Map<string, string>();
  const agents = new Map<string, AgentMeta>();
  for (const f of files) {
    const r = readFuelFile(f);
    bytes += r.bytes;
    dedupeFuel(r.state.records.values(), all);
    compactions.push(...r.state.compactions);
    modelCommands.push(...r.state.modelCommands);
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
  rememberAgentModels(agentModels(all.values())); // OBSERVED CREW의 COMPLEMENT DRIFT(ATC-57)
  return { records: all, compactions, modelCommands, unknownBySession, names, live, agents, files: files.length, bytes };
}

export type FlightContext = Pick<Snapshot, "workspaces" | "airports" | "claims">;

export interface WindowAnalysis {
  att: Attribution;
  leaks: LeakEvent[]; // F3·F7 규칙과 SESSION CHANGE(기간 앞 요청과 비교한 것까지)
  warnings: CrewWarning[];
  baselines: Record<string, Baseline>; // SESSION CHANGE의 AIRPORT별 새 세션 기준선
}

// AIRCRAFT(세션 이름) → FLEET의 COMPLEMENT. FLEET에 없는 이름이면 null(COMPLEMENT DRIFT를 판단하지 않는다)
function complements(names: Map<string, string>): (session: string) => CrewMember[] | null {
  let fleet: ReturnType<typeof loadFleet> | null = null;
  try {
    fleet = loadFleet();
  } catch {}
  return (session) => {
    const name = names.get(session);
    const key = name && fleet ? fleetKeyOf(Object.keys(fleet.aircraft), name) : null; // `Team G`도 TEAM_G 항목(ATC-67)
    const profile = key && fleet?.aircraft[key];
    return profile ? (profile.complement ?? fleet!.defaults.complement) : null;
  };
}

// 기간 안 기록을 FLIGHT 구간으로 자르고(FUEL F4), LEAK(F3·F7)과 CREW 경고(F7)를 같은 구간으로 나눈다.
// 구간은 기간 안에 도착한 LOGBOOK FLIGHT와 지금 있는 STAND의 EN ROUTE FLIGHT
// 값(units·cost)은 FUEL COST 가격표에서(F5). LOGBOOK과 GET /api/fuel이 같은 표를 쓴다
export function analyzeWindow(
  scan: FuelScan,
  s: FlightContext,
  entries: LogEntry[],
  since: number,
  now: number,
  prices: PriceTable | null = readPrices().table,
): WindowAnalysis {
  const departures = readDepartures();
  const repoOf = new Map(s.airports.map((a) => [a.code, a.repo]));
  const codeOf = new Map(s.airports.map((a) => [a.repo, a.code]));
  const open = new Set(s.workspaces.filter((w) => !w.isMain).map((w) => w.path));
  const spans = [
    ...entries.filter((e) => Date.parse(e.arrivedAt) >= since).map((e) => arrivedSpan(e, departures, (e.airport && repoOf.get(e.airport)) || null)),
    ...enRouteSpans(departures, entries, open, now, (repo) => codeOf.get(repo) ?? null),
  ];
  const claims = [...readHookClaims(), ...s.claims];
  const byClaimant = new Map<string, ClaimSpan[]>();
  for (const c of claims) byClaimant.set(c.sessionId, [...(byClaimant.get(c.sessionId) ?? []), c]);
  const aircraftOf = (id: string) => (scan.names.get(id) ? regKey(scan.names.get(id)) : null);
  const change = sessionChangeLeaks(scan.records.values(), (r) => {
    const f = flightOf(r, spans, aircraftOf, (id) => byClaimant.get(id) ?? []);
    return f && { key: f.key, airport: f.airport ?? null };
  }, prices);
  const leaks = [...findLeaks(scan.records.values(), scan.compactions, controlSends(), scan.names, prices), ...change.events];
  const warnings = crewWarnings({ records: scan.records.values(), agents: scan.agents, complementOf: complements(scan.names) });
  const inWindow = (t: string) => Date.parse(t) >= since && Date.parse(t) <= now;
  const att = attributeFuel({
    records: [...scan.records.values()].filter((r) => inWindow(r.t)),
    spans,
    aircraftOf,
    claims,
    leaks: leaks.filter((e) => inWindow(e.t)),
    warnings: warnings.filter((w) => inWindow(w.t)),
  });
  return { att, leaks, warnings, baselines: change.baselines };
}

// GET /api/fuel의 본문. AIRCRAFT마다 ARRIVED FLIGHT·EN ROUTE·UNATTRIBUTED 몫을 붙인다
export function readFuel(days: number, s: FlightContext & Pick<Snapshot, "sessions">, entries: LogEntry[], now = Date.now()) {
  const t0 = performance.now();
  const since = now - days * DAY_MS;
  const scan = scanFuel(since, s.sessions);
  const prices = readPrices();
  const { att, leaks, warnings, baselines } = analyzeWindow(scan, s, entries, since, now, prices.table);
  const summary = summarizeFuel({ ...scan, records: scan.records.values(), leaks, warnings, prices: prices.table, now, days });
  // CONTEXT SIZE(ATC-69): 세션마다, AIRCRAFT는 그 이름의 세션 중 가장 최근 것
  const context = contextSizesOf(scan, loadContextWindows());
  const latest = (ids: string[]) => ids.map((id) => context.get(id)).filter((c): c is ContextSize => Boolean(c)).sort((x, y) => y.at.localeCompare(x.at))[0] ?? null;
  return {
    at: new Date(now).toISOString(),
    ...summary,
    sessions: summary.sessions.map((x) => ({ ...x, context: contextView(context.get(x.session) ?? null) })),
    aircraft: summary.aircraft.map((a) => ({ ...a, attribution: att.aircraft.get(a.aircraft) ?? null, context: contextView(latest(a.sessions)) })),
    // FLIGHT마다 모델별 토큰에 지금 가격표로 값을 매긴다(ATC-59)
    attribution: { totals: att.totals, flights: att.flights.map((f) => ({ ...f, fuelCost: priceFlightFuel(f.fuel, prices.table) })) },
    sessionBaselines: baselines,
    prices: { source: prices.table.source, files: prices.files, errors: prices.errors, models: Object.keys(prices.table.models).sort() },
    scan: { files: scan.files, bytesRead: scan.bytes, ms: Math.round(performance.now() - t0) },
  };
}

// 가격표 읽기는 fuel-prices.ts로 옮겼다(fleet·DISPATCH가 순환 없이 쓰도록). 옛 import를 위해 다시 내보낸다
export { DEFAULT_PRICES_FILE, readPrices } from "./fuel-prices.ts";

// atc가 보낸 CLEARANCE·FLIGHT PLAN·RECALL·CREW CHANGE의 시각과 받는 세션. 기록이 없거나 깨졌으면 그 종류만 빈다
function controlSends() {
  const safe = <T>(read: () => T[]): T[] => {
    try {
      return read();
    } catch {
      return [];
    }
  };
  return controlSendsOf({ clearances: safe(allClearances), proposals: safe(allProposals), crewChanges: safe(allCrewChanges) });
}

// FUEL F4: 새 arrived 줄에 그 FLIGHT 구간의 FUEL BURN과 LEAK·CREW 경고를 붙인다(logbook.ts run이 부른다). 이미 쓴 줄은 고치지 않는다(추가만).
// 대화 기록은 FUEL_LOGBOOK_DAYS만 읽고, 그보다 먼저 출발한 FLIGHT에는 붙이지 않는다(fuelForEntry). entries는 이번 줄까지 접은 LOGBOOK
export const FUEL_LOGBOOK_DAYS = 14;
export function addLogbookFuel(lines: LogLine[], entries: LogEntry[], s: Snapshot, now = Date.now()) {
  const since = now - FUEL_LOGBOOK_DAYS * DAY_MS;
  const arrivals = lines.flatMap((l) => (l.op === "arrived" && l.departedFrom !== "pr" && Date.parse(l.departedAt) >= since ? [l] : []));
  if (!arrivals.length) return;
  // 도착한 FLIGHT 모두(이번 줄 포함)와 EN ROUTE FLIGHT로 자른다. 앞 FLIGHT의 착륙 대기와 겹친 다음 FLIGHT 몫을 가려내려고
  const scan = scanFuel(since, s.sessions);
  const { att } = analyzeWindow(scan, s, entries, since, now);
  for (const l of arrivals) {
    const fuel = fuelForEntry(l, att, since);
    if (fuel) l.fuel = fuel;
  }
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

// FUEL REMAINING(ATC-55): 상태 폴더의 fuel/<sessionId>.jsonl마다 끝의 마지막 기록(statusline hook이 적음). 파일 이름과 sessionId가 다르면 버린다
export function readFuelRecords(dir = join(config.stateDir, "fuel")): FuelLimitsRecord[] {
  return fuelFilesIn(dir).flatMap((f) => {
    const r = lastRecordWith(readTail(join(dir, f)), "rate_limits"); // 창 크기만 있는 줄(ATC-85)은 FUEL REMAINING이 아니다
    return r && `${r.sessionId}.jsonl` === f ? [r] : [];
  });
}

function fuelFilesIn(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
}

// 세션이 스스로 알린 창 크기(ATC-85): fuel/<sessionId>.jsonl에서 context_window_size가 있는 마지막 기록(CLI 세션의 statusline)
export function readStatusWindows(dir = join(config.stateDir, "fuel")): Map<string, StatusWindow> {
  const out = new Map<string, StatusWindow>();
  for (const f of fuelFilesIn(dir)) {
    const r = lastRecordWith(readTail(join(dir, f)), "context_window_size");
    if (r && r.context_window_size && `${r.sessionId}.jsonl` === f) out.set(r.sessionId, { t: r.t, window: r.context_window_size, model: r.model ?? null });
  }
  return out;
}

// ── CONTEXT SIZE(ATC-69, docs/fuel.md 5): 세션마다 지금 대화 크기. 같은 scanFuel 기록으로 센다(대화 기록을 따로 읽지 않는다) ──

// 창 크기 덮어쓰기: fleet-plan.json의 contextWindows({모델: 토큰}). 없거나 틀리면 빈 표
export function loadContextWindows(file = join(config.stateDir, "fleet-plan.json")): Record<string, number> {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"))?.contextWindows;
    if (!raw || typeof raw !== "object") return {};
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v > 0)) as Record<string, number>;
  } catch {
    return {};
  }
}

export function contextSizesOf(
  scan: Pick<FuelScan, "records" | "compactions"> & Partial<Pick<FuelScan, "modelCommands">>,
  windows: Record<string, number>,
  statusline: Map<string, StatusWindow> = new Map(),
): Map<string, ContextSize> {
  const out = new Map<string, ContextSize>();
  for (const [id, c] of sessionContexts(scan.records.values(), scan.compactions, { commands: scan.modelCommands, statusline })) out.set(id, contextSizeOf(c, windows));
  return out;
}


// FLEET(/api/fleet)과 FLEET PLAN 주기가 쓴다. 최근 FUEL_DEFAULT_DAYS에 바뀐 기록 파일만, CONTEXT_MS 동안 같은 값
const CONTEXT_MS = 60_000;
let lastContext: { at: number; value: Map<string, ContextSize> } | null = null;
export function contextSizes(sessions: Snapshot["sessions"], now = Date.now()): Map<string, ContextSize> {
  if (lastContext && now - lastContext.at < CONTEXT_MS) return lastContext.value;
  let value = new Map<string, ContextSize>();
  try {
    value = contextSizesOf(scanFuel(now - FUEL_DEFAULT_DAYS * DAY_MS, sessions), loadContextWindows(), readStatusWindows());
  } catch (e) {
    console.error("[atc] context size failed:", e);
  }
  lastContext = { at: now, value };
  return value;
}

// REGISTRATION → 그 이름의 살아 있는 세션의 CONTEXT SIZE. 세션이 여럿이면 가장 최근 것
export function aircraftContexts(sessions: Snapshot["sessions"], teamPattern: string, now = Date.now()): Map<string, ContextSize> {
  const team = new RegExp(teamPattern, "i");
  const sizes = contextSizes(sessions, now);
  const out = new Map<string, ContextSize>();
  for (const x of sessions) {
    if (x.agent !== "claude" || x.status === "dead" || !team.test(x.name)) continue;
    const c = sizes.get(x.id);
    const reg = regKey(x.name, teamPattern); // `Team G`도 TEAM_G(ATC-67)
    if (c && (!out.has(reg) || c.at > out.get(reg)!.at)) out.set(reg, c);
  }
  return out;
}

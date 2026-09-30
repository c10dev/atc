import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Context, Hono } from "hono";
import { type TalkEvent } from "./briefs.ts";
import { sessionDirsOf } from "./crew-observed.ts";
import { classOf } from "./crew.ts";
import { appendDepartures, readDepartures } from "./departures.ts";
import { airportOfTicket, checkTargetOf, loadDispatchConfig } from "./dispatch.ts";
import { appendLogbook, hasPr, type LogbookFuel, type LogEntry, loadLogbook, readLogbook, foldLogbook } from "./logbook.ts";
import type { Snapshot, Ticket } from "./model.ts";
import { allProposals, isInFlight, type Proposal, standFreeTicket } from "./proposals.ts";
import { sessionEventsOf } from "./sources/claude.ts";
import { registrationOf } from "./registration.ts";
import { slugOf } from "./sources/github.ts";
import { assertGithubOn, GithubOffError } from "./github-switch.ts";
import {
  type ArrivalSuggestion,
  checkSuggestionOf,
  directDepartureOf,
  docsOnlyOf,
  type GhWrite,
  type MergedPr,
  readbackDeparturesOf,
  type StandFreeConfirm,
  StandFreeError,
  type StandFreeFlight,
  standFreeKey,
  standFreeLine,
  surveySuggestionOf,
  timelinessOf,
} from "./standfree.ts";

// STAND 없는 FLIGHT의 ARRIVED 후보(ATC-72) 입출력. 5분마다: 직접 배정의 READBACK을 DEPARTURE LOG에 착수로 적고,
// ARRIVED를 기다리는 SURVEY·CHECK마다 그 팀 세션 기록과 GitHub(읽기 전용 gh)로 후보를 찾는다.
// ARRIVED는 OCC가 확인해 적을 때만(dispatch arrived). 그때 LOGBOOK에 PR 없는 arrived 줄을 쓴다. GitHub·Linear에는 쓰지 않는다

const MIN = 60_000;
const DAY = 86_400_000;
export const STANDFREE_MS = 5 * MIN;
const WINDOW_DAYS = 14; // 이만큼 지난 착수는 후보를 찾지 않는다
const GH_TTL_MS = 5 * MIN;

const run = promisify(execFile);
const gh = async (args: string[]) => {
  assertGithubOn();
  return (await run("gh", args, { timeout: 30_000, maxBuffer: 16 << 20 })).stdout;
};
const tsv = (out: string) => out.split("\n").filter(Boolean).map((l) => l.split("\t"));

const state = { suggestions: [] as ArrivalSuggestion[], ranAt: null as string | null, error: null as string | null };
let lastRun = 0;
let inflight: Promise<void> | null = null;
export const standFreeCandidates = () => state.suggestions;
// 일이 끝난 뒤 24시간 안에 ARRIVED한 비율(gate3.standFree 옆)
export const standFreeTimeliness = (now = Date.now()) => timelinessOf(loadLogbook(), state.suggestions, now);

// ── GitHub 읽기(짧게 캐시) ──
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, read: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < GH_TTL_MS) return hit.value as T;
  const value = await read();
  cache.set(key, { at: Date.now(), value });
  return value;
}
// PR·이슈 하나의 리뷰와 댓글. 이슈면 리뷰 읽기가 404라 댓글만
async function writesOn(slug: string, number: number): Promise<GhWrite[]> {
  return cached(`w:${slug}#${number}`, async () => {
    const out: GhWrite[] = [];
    try {
      for (const [url, author, at, st] of tsv(await gh(["api", "--paginate", `repos/${slug}/pulls/${number}/reviews?per_page=100`, "--jq", '.[] | [.html_url, (.user.login // ""), (.submitted_at // ""), .state] | @tsv'])))
        if (at) out.push({ kind: "review", slug, number, url, author: author || null, at, state: st });
    } catch {}
    for (const [url, author, at] of tsv(await gh(["api", "--paginate", `repos/${slug}/issues/${number}/comments?per_page=100`, "--jq", '.[] | [.html_url, (.user.login // ""), .created_at] | @tsv'])))
      out.push({ kind: "comment", slug, number, url, author: author || null, at });
    return out;
  });
}
const filesOf = (slug: string, number: number) =>
  cached(`f:${slug}#${number}`, async () => (await gh(["api", "--paginate", `repos/${slug}/pulls/${number}/files?per_page=100`, "--jq", ".[].filename"])).split("\n").filter(Boolean));
const slugCache = new Map<string, string | null>();
async function repoSlug(repo: string | null): Promise<string | null> {
  if (!repo) return null;
  if (!slugCache.has(repo)) slugCache.set(repo, await slugOf(repo).catch(() => null));
  return slugCache.get(repo)!;
}

// ── 한 바퀴 ──
const typeOf = (t: Ticket | undefined): "CHECK" | "SURVEY" | null => {
  const type = t ? classOf(t.labels).type : null;
  return type === "CHECK" || type === "SURVEY" ? type : null;
};

async function once(s: Snapshot) {
  const now = Date.now();
  const cfg = loadDispatchConfig();
  const byKey = new Map(s.tickets.map((t) => [t.key, t]));
  const repoOf = (flight: string) => {
    const t = byKey.get(flight);
    const code = t ? airportOfTicket(t, cfg) : null;
    return s.airports.find((a) => a.code === code)?.repo ?? null;
  };
  const events = new Map<string, TalkEvent[]>();
  const eventsOf = (reg: string) => {
    if (!events.has(reg)) events.set(reg, (sessionDirsOf(reg, s.sessions, now, WINDOW_DAYS)?.flatMap(sessionEventsOf) ?? []).sort((a, b) => a.t.localeCompare(b.t)));
    return events.get(reg)!;
  };
  const errors: string[] = [];
  const proposals = allProposals();
  const entries = loadLogbook();

  // 1) 직접 배정의 READBACK → DEPARTURE LOG 착수
  // REGISTRATION은 정식 표기(ATC-67): Team G·team-g도 TEAM_G
  const regOf = (name: string | null | undefined) => registrationOf(name, cfg.teamPattern);
  const teams = [...new Set(s.sessions.flatMap((x) => regOf(x.name) ?? []))];
  const dispatched = new Set(proposals.filter((p) => p.kind === "ASSIGN" && p.timeline.sent && regOf(p.aircraftName)).map((p) => `${p.flight}|${regOf(p.aircraftName)}`));
  const existing = readDepartures();
  const fresh = readbackDeparturesOf({
    events: new Map(teams.map((r) => [r, eventsOf(r)])),
    standFree: (k) => standFreeTicket(byKey.get(k)),
    repoOf,
    existing,
    entries,
    dispatched,
    since: new Date(now - WINDOW_DAYS * DAY).toISOString(),
  });
  appendDepartures(fresh);
  if (fresh.length) console.log(`[atc] DEPARTURE LOG +${fresh.length} (STAND 없는 READBACK)`);

  // 2) ARRIVED를 기다리는 STAND 없는 FLIGHT: DISPATCH로 떠 있는 것과 직접 배정의 착수(아직 ARRIVED 줄이 없는 마지막 착수)
  const flights: StandFreeFlight[] = [];
  const inFlight = proposals.filter((p) => isInFlight(p) && p.departedVia === "readback" && p.timeline.departed);
  for (const p of inFlight) {
    const type = typeOf(byKey.get(p.flight));
    if (type) flights.push({ flight: p.flight, type, aircraft: regOf(p.aircraftName), departedAt: p.timeline.departed!, proposal: p.id, slug: await repoSlug(repoOf(p.flight)) });
  }
  const since = new Date(now - WINDOW_DAYS * DAY).toISOString();
  const last = new Map<string, (typeof existing)[number]>();
  for (const d of [...existing, ...fresh]) if (d.via === "readback" && d.flight && d.aircraft && d.t >= since) last.set(`${d.flight}|${d.aircraft}`, d);
  const done = new Set(entries.map((e) => e.key));
  for (const d of last.values()) {
    const type = typeOf(byKey.get(d.flight!));
    if (!type || done.has(standFreeKey(d.flight!, d.t)) || inFlight.some((p) => p.flight === d.flight)) continue;
    flights.push({ flight: d.flight!, type, aircraft: d.aircraft, departedAt: d.t, proposal: null, slug: await repoSlug(d.repo) });
  }

  // 3) 후보
  const out: ArrivalSuggestion[] = [];
  for (const f of flights) {
    if (!f.aircraft) continue;
    try {
      const ev = eventsOf(f.aircraft);
      if (f.type === "CHECK") {
        const t = byKey.get(f.flight)!;
        const target = checkTargetOf(t);
        const prs = new Map<string, { slug: string; number: number }>();
        if (f.slug) for (const n of target.prs) prs.set(`${f.slug}#${n}`, { slug: f.slug, number: n });
        for (const p of s.pulls) {
          const slug = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\//.exec(p.url)?.[1];
          if (slug && p.ticketKey && target.flights.includes(p.ticketKey)) prs.set(`${slug}#${p.number}`, { slug, number: p.number });
        }
        for (const e of entries) if (e.pr && e.flight && target.flights.includes(e.flight)) prs.set(`${e.pr.repo}#${e.pr.number}`, { slug: e.pr.repo, number: e.pr.number });
        const targets = [...prs.values()];
        // 그 팀이 대상 PR에 글을 남긴 것이 있을 때만 GitHub를 읽는다
        const touched = targets.filter((x) => ev.some((e) => e.dir === "post" && e.post?.number === x.number && e.t >= f.departedAt));
        const writes = (await Promise.all(touched.map((x) => writesOn(x.slug, x.number)))).flat();
        const sgg = checkSuggestionOf(f, targets, ev, writes);
        if (sgg) out.push(sgg);
      } else {
        const posts = ev.filter((e) => e.dir === "post" && e.post?.number && e.keys.includes(f.flight) && e.t >= f.departedAt);
        const writes = (await Promise.all([...new Set(posts.map((e) => `${e.post!.repo ?? f.slug}#${e.post!.number}`))].filter((k) => !k.startsWith("null#")).map((k) => {
          const [slug, n] = k.split("#");
          return writesOn(slug, Number(n));
        }))).flat();
        const merged: MergedPr[] = [];
        for (const e of entries) {
          if (!hasPr(e) || e.aircraft !== f.aircraft || e.arrivedAt < f.departedAt) continue;
          if (e.flight !== f.flight && !new RegExp(`(^|[^A-Za-z0-9])${f.flight}(?!\\d)`, "i").test(e.pr.title)) continue;
          let docsOnly: boolean | null = null;
          try {
            docsOnly = docsOnlyOf(await filesOf(e.pr.repo, e.pr.number));
          } catch {}
          merged.push({ key: e.key, flight: e.flight, aircraft: e.aircraft, arrivedAt: e.arrivedAt, slug: e.pr.repo, number: e.pr.number, url: e.pr.url, title: e.pr.title, docsOnly });
        }
        const sgg = surveySuggestionOf(f, ev, writes, merged);
        if (sgg) out.push(sgg);
      }
    } catch (e) {
      const err = e as Error & { stderr?: string };
      if (e instanceof GithubOffError) continue; // GitHub off는 오류가 아니다(ATC-161)
      errors.push(`${f.flight}: ${(err.stderr?.trim() || err.message).split("\n")[0]}`);
    }
  }
  state.suggestions = out;
  state.ranAt = new Date(now).toISOString();
  state.error = errors.length ? errors.join(" · ") : null;
}

// 5분마다(스냅숏을 막지 않는다). GitHub을 못 쓰면 후보는 세션 기록만으로 찾을 수 있는 Linear 댓글뿐이다
export function runStandFree(s: Snapshot) {
  if (inflight || Date.now() - lastRun < STANDFREE_MS) return;
  lastRun = Date.now();
  inflight = once(s)
    .catch((e) => void (state.error = String((e as Error).message ?? e)))
    .finally(() => (inflight = null));
}

// ── 확인 → LOGBOOK ──
// 같은 FLIGHT·AIRCRAFT가 착수 뒤 PR로 이미 LOGBOOK에 있으면(SURVEY 결과가 머지된 문서 PR) 한 번만 센다: 줄을 쓰지 않는다
function writeArrival(c: StandFreeConfirm, s: Snapshot, addFuel: LogbookFuel | null): { line: LogEntry | null; skipped: string | null } {
  const old = readLogbook();
  const entries = foldLogbook(old);
  const key = standFreeKey(c.flight, c.departedAt);
  if (entries.some((e) => e.key === key)) return { line: null, skipped: "이미 LOGBOOK에 있음" };
  const viaPr = entries.find((e) => e.pr && e.flight === c.flight && e.aircraft === c.aircraft && e.arrivedAt >= c.departedAt);
  if (viaPr) return { line: null, skipped: `PR ${viaPr.key}로 이미 LOGBOOK에 있음(한 번만 센다)` };
  const line = standFreeLine(c, new Date().toISOString());
  try {
    addFuel?.([line], foldLogbook([...old, line]), s);
  } catch {} // FUEL 없이 쓴다
  appendLogbook([line]);
  console.log(`[atc] LOGBOOK +1 STAND 없는 ARRIVED ${c.flight} ${c.aircraft} (${line.standFree!.arrivedVia})`);
  const { op: _op, t: _t, ...entry } = line;
  return { line: entry, skipped: null };
}

const suggestionFor = (flight: string, aircraft: string) => state.suggestions.find((x) => x.flight === flight && x.aircraft === aircraft) ?? null;

// DISPATCH D-xxxx의 ARRIVED(proposals.ts가 부른다)
export function proposalArrived(p: Proposal, s: Snapshot, addFuel: LogbookFuel | null) {
  const cfg = loadDispatchConfig();
  const aircraft = registrationOf(p.aircraftName, cfg.teamPattern);
  if (p.status !== "arrived" || !aircraft || !p.timeline.departed) return null;
  const t = s.tickets.find((x) => x.key === p.flight);
  const suggestion = suggestionFor(p.flight, aircraft);
  // 확인된 후보는 다음 바퀴를 기다리지 않고 목록에서 뺀다
  state.suggestions = state.suggestions.filter((x) => x.proposal !== p.id);
  return writeArrival(
    {
      flight: p.flight,
      aircraft,
      cls: t ? classOf(t.labels) : null,
      airport: t ? airportOfTicket(t, cfg) : null,
      departedAt: p.timeline.departed,
      departedFrom: "readback",
      arrivedAt: p.timeline.arrived ?? p.statusAt,
      note: p.arrivedNote ?? "",
      proposal: p.id,
      suggestion,
    },
    s,
    addFuel,
  );
}

export function mountStandFree(app: Hono, getSnapshot: () => Promise<Snapshot>, addFuel: LogbookFuel | null) {
  app.get("/api/standfree", (c) => c.json({ candidates: state.suggestions, timeliness: standFreeTimeliness(), ranAt: state.ranAt, error: state.error }));
  // 직접 배정(D-xxxx 없음)의 STAND 없는 FLIGHT: OCC가 확인한 ARRIVED. 착수는 DEPARTURE LOG의 readback 줄.
  // dispatch arrived와 같이 atcctl(OCC)과 화면이 부른다
  app.post("/api/dispatch/standfree/:flight/arrived", async (c: Context) => {
    const flight = (c.req.param("flight") ?? "").toUpperCase();
    const body = (await c.req.json().catch(() => ({}))) as { aircraft?: unknown; note?: unknown };
    const aircraft = registrationOf(typeof body.aircraft === "string" ? body.aircraft : null, loadDispatchConfig().teamPattern) ?? "";
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!aircraft) return c.json({ error: "aircraft(TEAM_X)가 필요함" }, 400);
    if (!note) return c.json({ error: "arrived에는 결과 링크나 한 줄(note)이 필요함" }, 400);
    if (note.length > 500) return c.json({ error: "보고는 500자 이내" }, 400);
    const s = await getSnapshot();
    const t = s.tickets.find((x) => x.key === flight);
    try {
      const cfg = loadDispatchConfig();
      const dep = directDepartureOf({ flight, aircraft, standFree: t ? standFreeTicket(t) : null, inFlight: allProposals().filter(isInFlight), departures: readDepartures(), entries: loadLogbook() });
      const r = writeArrival(
        { flight, aircraft, cls: classOf(t!.labels), airport: airportOfTicket(t!, cfg), departedAt: dep.t, departedFrom: "departure", arrivedAt: new Date().toISOString(), note, proposal: null, suggestion: suggestionFor(flight, aircraft) },
        s,
        addFuel,
      );
      if (!r.line) return c.json({ error: r.skipped }, 409);
      state.suggestions = state.suggestions.filter((x) => !(x.flight === flight && x.aircraft === aircraft));
      return c.json({ ok: true, entry: r.line });
    } catch (e) {
      if (e instanceof StandFreeError) return c.json({ error: e.message }, e.status as 400);
      throw e;
    }
  });
}

import type { Context, Hono } from "hono";
import { foldReports, readReports } from "./arrival-report.ts";
import { loadRegistry } from "./airports.ts";
import { enforcedStops, groundStopWhy } from "./atfm.ts";
import { allClearances } from "./clearances.ts";
import { loadDispatchConfig } from "./dispatch.ts";
import { FLEET_PLAN_DEFAULTS } from "./fleet-plan.ts";
import { goneFromAgents } from "./fleet-plan-run.ts";
import { fleetView, loadFleet } from "./fleet.ts";
import { type FreshStartVerdict, freshStartVerdictOf, runFreshStart } from "./fresh-start.ts";
import {
  type AutoFreshDecision,
  autoFreshStartOf,
  autoFreshWaitText,
  type FreshStartAutoLine,
  flownInSessionOf,
  freshStartMisfiresOf,
  freshStartModeAt,
  type MisfireRow,
} from "./fresh-start-auto.ts";
import { clearFreshStartBusy, freshStartBusy, markFreshStartBusy } from "./fresh-start-busy.ts";
import { loadFreshStartSwitch } from "./fresh-start-switch.ts";
import { tokenSum } from "./fuel.ts";
import { aircraftContexts } from "./fuel-run.ts";
import { loadLogbook } from "./logbook.ts";
import type { Snapshot } from "./model.ts";
import { fromThisApp } from "./origin.ts";
import { allProposals, append, flightPlanMessageOf, type Proposal, readOps, regOfProposal } from "./proposals.ts";
import { readRecords, record } from "./recorder.ts";
import { regKey } from "./registration.ts";
import { agentRows, launchAircraft, liveRowsOf, rowOriginOf, stopAircraft } from "./session-control.ts";

// FRESH START(ATC-73): 승인된 ASSIGN을 받을 AIRCRAFT가 기준을 넘은 대화를 쥐고 있으면, SUPERVISOR가 한 번 눌러
// 그 백그라운드 세션을 STOP하고 CREW BRIEFING + FLIGHT PLAN을 첫 프롬프트로 새로 LAUNCH한다(docs/dispatch.md, docs/fleet.md 8.6).
// 버튼은 화면 Origin이 있어야 한다(LAUNCH와 같다).
// 자동 FRESH START(ATC-560): AIRPORT 스위치(fresh-start.json)가 always·over면, OCC가 그 카드를 release하려 할 때 그 세션이 이미 FLIGHT를 날았으면
// 같은 STOP·LAUNCH를 서버가 한다(by auto). 판정은 fresh-start.ts·fresh-start-auto.ts(순수), 여기는 입출력

const DAY = 86_400_000;

// 승인됐지만 아직 보내지 않은 ASSIGN(launch 카드가 아닌 것)
export const freshStartCandidate = (p: Proposal) => p.kind === "ASSIGN" && p.status === "approved" && !p.launch;

async function verdictOf(p: Proposal, s: Snapshot, rows: Awaited<ReturnType<typeof agentRows>>, now: number): Promise<FreshStartVerdict> {
  if (freshStartBusy(p.id)) return { ok: false, why: "FRESH START 도는 중" };
  const cfg = loadDispatchConfig();
  const reg = regOfProposal(p, cfg.teamPattern) ?? "";
  const a = fleetView(s, loadFleet(), cfg.teamPattern, loadLogbook(), now).find((x) => x.registration === reg);
  if (!a) return { ok: false, why: `FLEET에 없음: ${reg}` };
  const row = liveRowsOf(rows).find((r) => regKey(r.name, cfg.teamPattern) === reg);
  const arrived = new Set(loadLogbook().filter((e) => e.aircraft === reg && e.flight).map((e) => e.flight as string));
  return freshStartVerdictOf(
    { registration: reg, origin: row ? rowOriginOf(row) : null, retired: !!a.retired, aog: !!a.aog, status: a.status, flying: a.flying, arrived, context: aircraftContexts(s.sessions, cfg.teamPattern, now).get(reg) ?? null },
    FLEET_PLAN_DEFAULTS,
  );
}

// STOP → LAUNCH → send 기록. 버튼과 자동이 같은 길을 쓴다(by만 다르다). 옵션은 그 AIRCRAFT의 마지막 atc LAUNCH와 같게(REFRESH와 같다)
async function runFor(p: Proposal, s: Snapshot, reg: string, by: "SUPERVISOR" | "auto") {
  const now = Date.now();
  const message = await flightPlanMessageOf(p, s);
  let last: { permissionMode?: string; model?: string; account?: string } = {};
  for (const r of readRecords(now - 30 * DAY)) if (r.kind === "fleet" && r.op === "launch" && r.ok && regKey(r.aircraft) === reg) last = { permissionMode: r.permissionMode, model: r.model, account: r.account };
  return runFreshStart(p.id, message, {
    stop: () => stopAircraft(reg, by),
    gone: () => goneFromAgents(reg),
    launch: (promptOf) => launchAircraft(s, reg, { permissionMode: last.permissionMode, lastModel: last.model ?? null, lastAccount: last.account ?? null, promptOf }, by, p.id),
    append,
    note: (line) => record({ t: new Date().toISOString(), kind: "dispatch", op: "fresh-start", id: p.id, via: "fresh-start", flight: p.flight, aircraft: reg, by, ...line }),
    now: () => new Date().toISOString(),
  });
}

// ── 자동 FRESH START(ATC-560) ──
// 그 카드의 판정 입력. 세션 사실은 스냅샷(s.sessions의 origin·startedAt)에서 읽는다: release마다 `claude agents`를 부르지 않는다
export function autoFactsOf(p: Proposal, s: Snapshot, now = Date.now()) {
  const cfg = loadDispatchConfig();
  const tp = cfg.teamPattern;
  const reg = regOfProposal(p, tp) ?? "";
  const team = new RegExp(tp, "i");
  const live = s.sessions.filter((x) => x.status !== "dead" && team.test(x.name) && regKey(x.name, tp) === reg).sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))[0];
  const origin = live ? (live.origin ?? (live.kind === "background" ? "background" : "unknown")) : null;
  const logbook = loadLogbook();
  const a = fleetView(s, loadFleet(), tp, logbook, now).find((x) => x.registration === reg);
  const nameOf = new Map(s.sessions.map((x) => [x.id, regKey(x.name, tp)]));
  const holders = new Map(s.claims.filter((c) => c.state === "active").map((c) => [c.workspacePath, nameOf.get(c.sessionId)]));
  const openPr = s.pulls.some((x) => x.standPath && holders.get(x.standPath) === reg);
  const fuel = a?.fuel ?? (a?.account ? ((s.fuelAccounts ?? []).find((f) => f.account === a.account) ?? null) : null);
  const ctx = aircraftContexts(s.sessions, tp, now).get(reg) ?? null;
  const startedAt = live?.startedAt ?? null;
  const start = startedAt ? Date.parse(startedAt) : NaN;
  const flown = Number.isFinite(start)
    ? flownInSessionOf({
        startedAt: startedAt!,
        currentId: p.id,
        proposals: allProposals()
          .filter((x) => x.kind === "ASSIGN" && regOfProposal(x, tp) === reg)
          .map((x) => ({ id: x.id, flight: x.flight, status: x.status, sentAt: x.timeline.sent ?? null })),
        launches: readRecords(start - DAY).flatMap((r) => (r.kind === "fleet" && r.op === "launch" && r.ok && regKey(r.aircraft, tp) === reg ? [{ t: r.t, flight: r.flight }] : [])),
        departures: logbook.filter((e) => e.aircraft === reg).map((e) => ({ flight: e.flight ?? null, departedAt: e.departedAt })),
      })
    : [];
  const mode = freshStartModeAt(loadFreshStartSwitch(), p.airport);
  return {
    reg,
    startedAt,
    facts: {
      registration: reg,
      mode,
      launch: Boolean(p.launch),
      groundStop: Boolean(p.airport && enforcedStops(s.atfm?.groundStops ?? []).get(p.airport)),
      origin,
      flown,
      retired: Boolean(a?.retired),
      aog: Boolean(a?.aog),
      status: a?.status ?? "absent",
      restarting: Boolean(a?.restarting),
      nordo: !live && s.sessions.some((x) => x.status === "dead" && team.test(x.name) && regKey(x.name, tp) === reg),
      openPr,
      flying: a?.flying ?? [],
      arrived: new Set(logbook.filter((e) => e.aircraft === reg && e.flight).map((e) => e.flight as string)),
      limit: a?.health?.code === "LIMIT",
      fuelHold: fuel?.level === "hold",
      context: ctx ? { contextTokens: ctx.contextTokens, base: ctx.base } : null,
    },
  };
}

// 한 카드는 한 번만 판정한다(skip이든 restart든). 서버가 다시 떠도 FLIGHT RECORDER 줄로 안다
const decided = new Set<string>();
function decidedBefore(p: Proposal): boolean {
  if (decided.has(p.id)) return true;
  const since = Date.parse(p.timeline.approved ?? p.statusAt) - 60_000;
  const seen = readRecords(Number.isFinite(since) ? since : Date.now() - DAY).some((r) => r.kind === "dispatch" && r.op === "fresh-start-auto" && r.id === p.id);
  if (seen) decided.add(p.id);
  return seen;
}

function lineOf(p: Proposal, reg: string, startedAt: string | null, f: ReturnType<typeof autoFactsOf>["facts"], d: Exclude<AutoFreshDecision, { act: "none" }>): FreshStartAutoLine {
  return {
    t: new Date().toISOString(), kind: "dispatch", op: "fresh-start-auto", id: p.id, flight: p.flight, aircraft: reg, by: "auto", airport: p.airport,
    mode: f.mode, decision: d.act, ...(d.act === "skip" ? { code: d.code } : {}), why: d.why,
    contextTokens: f.context?.contextTokens ?? null, base: f.context?.base ?? null, threshold: d.threshold, flown: [...f.flown], sessionStartedAt: startedAt,
  };
}

// OCC의 release 앞에서 부른다(proposals.ts). 기다리게 할 문구를 돌려주면 release는 409로 그것을 말하고 보내지 않는다. null이면 전처럼 보낸다.
// restart면 판정 줄을 남기고 STOP·LAUNCH를 뒤에서 시작한다(release는 기다리지 않는다). 실패해도 카드는 approved로 남고 다시 판정하지 않는다:
// STOP 실패면 세션이 그대로라 다음 release가 전처럼 보내고, LAUNCH 실패면 세션 없는 승인 카드의 길(ATC-388)이 이어받는다
export function autoFreshStartGate(getSnapshot: () => Promise<Snapshot>) {
  return async (p: Proposal, s: Snapshot): Promise<string | null> => {
    if (p.kind !== "ASSIGN" || p.launch) return null;
    const name = p.aircraftName ?? regOfProposal(p, loadDispatchConfig().teamPattern) ?? "AIRCRAFT";
    if (freshStartBusy(p.id)) return autoFreshWaitText(name);
    if (p.status !== "approved" || decidedBefore(p)) return null;
    const { reg, startedAt, facts } = autoFactsOf(p, s);
    const d = autoFreshStartOf(facts);
    if (d.act === "none") return null;
    // FreshStartAutoLine은 dispatch 줄에 입력 칸을 더한 것이다(recorder.ts의 union은 그대로 받는다)
    const line: FreshStartAutoLine = lineOf(p, reg, startedAt, facts, d);
    record(line);
    decided.add(p.id);
    if (d.act === "skip") return null;
    markFreshStartBusy(p.id, reg);
    void (async () => {
      try {
        const r = await runFor(p, await getSnapshot().catch(() => s), reg, "auto");
        if (!r.ok) console.warn(`[atc] auto FRESH START ${p.id} ${reg}: ${r.stage} 실패 — ${r.error}`);
      } catch (e) {
        console.error(`[atc] auto FRESH START ${p.id} ${reg} failed:`, e);
        record({ t: new Date().toISOString(), kind: "dispatch", op: "fresh-start", id: p.id, via: "fresh-start", flight: p.flight, aircraft: reg, by: "auto", stage: "launch", ok: false, error: e instanceof Error ? e.message : String(e) });
      } finally {
        clearFreshStartBusy(p.id);
      }
    })();
    return autoFreshWaitText(name);
  };
}

// ── 오작동 수(ATC-560): AIRPORT마다 최근 7일(설정 창의 FRESH START 블록) ──
export const MISFIRE_DAYS = 7;
export function freshStartMisfiresNow(now = Date.now()): MisfireRow[] {
  const since = now - MISFIRE_DAYS * DAY;
  const tp = loadDispatchConfig().teamPattern;
  const records = readRecords(since);
  const autoLines = records.filter((r) => r.kind === "dispatch" && r.op === "fresh-start-auto") as unknown as FreshStartAutoLine[];
  const restartIds = new Set(autoLines.filter((l) => l.decision === "restart").map((l) => l.id));
  const failures = records.flatMap((r) => (r.kind === "dispatch" && r.op === "fresh-start" && r.by === "auto" && r.ok === false && r.stage ? [{ t: r.t, id: r.id, stage: r.stage }] : []));
  const sent = allProposals().filter((p) => p.kind === "ASSIGN" && p.timeline.sent && Date.parse(p.timeline.sent) >= since);
  const reports = foldReports(readReports());
  const asked = new Set(readOps().filter((o) => o.op === "await-supervisor").map((o) => o.id));
  const logbook = loadLogbook();
  const clearances = allClearances().filter((c) => (c.type === "FIX" || c.type === "GO AROUND") && !c.cancelledAt && c.flight);
  const blocked = new Set<string>();
  const tokens = new Map<string, number>();
  const rework = new Set<string>();
  for (const p of sent) {
    const at = Date.parse(p.timeline.sent!);
    const rep = reports.get(p.flight);
    if (asked.has(p.id) || (rep && rep.blocked !== "none" && (rep.proposal === p.id || (!rep.proposal && Date.parse(rep.at) >= at)))) blocked.add(p.id);
    const e = logbook.find((x) => x.flight === p.flight && x.fuel && Date.parse(x.arrivedAt) >= at);
    if (e?.fuel) tokens.set(p.id, tokenSum(e.fuel.captain) + tokenSum(e.fuel.crew));
    if (clearances.some((c) => c.flight === p.flight && Date.parse(c.at) >= at)) rework.add(p.id);
  }
  const sw = loadFreshStartSwitch();
  const airports = loadRegistry().entries.filter((e) => !e.closed).map((e) => e.code.toUpperCase());
  return freshStartMisfiresOf({
    proposals: sent.map((p) => ({ id: p.id, flight: p.flight, airport: p.airport, aircraft: regOfProposal(p, tp) ?? "", sentAt: p.timeline.sent!, restarted: p.sentVia === "fresh-start" && restartIds.has(p.id) })),
    autoLines,
    failures,
    blocked,
    tokens,
    rework,
    airports,
    modes: Object.fromEntries(airports.map((a) => [a, freshStartModeAt(sw, a)])),
    days: MISFIRE_DAYS,
  });
}

export function mountFreshStart(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  // 카드가 FRESH START를 보일지: 승인된(approved) ASSIGN마다 판정(읽기만)
  app.get("/api/dispatch/fresh-start", async (c) => {
    const now = Date.now();
    const open = allProposals().filter(freshStartCandidate);
    if (!open.length) return c.json({ verdicts: {} });
    const [s, rows] = await Promise.all([getSnapshot(), agentRows().catch(() => [])]);
    const verdicts: Record<string, FreshStartVerdict> = {};
    for (const p of open) verdicts[p.id] = await verdictOf(p, s, rows, now);
    return c.json({ verdicts });
  });

  app.post("/api/dispatch/proposals/:id/fresh-start", async (c: Context) => {
    if (!fromThisApp(c)) return c.json({ error: "FRESH START는 SUPERVISOR가 화면에서 한다" }, 403);
    if (loadDispatchConfig().mode !== "approval") return c.json({ error: "FLIGHT PLAN은 approval 모드(2b)에서만 보낸다" }, 409);
    const id = c.req.param("id") ?? "";
    const p = allProposals().find((x) => x.id === id);
    if (!p) return c.json({ error: `없는 제안: ${id}` }, 404);
    if (!freshStartCandidate(p)) return c.json({ error: `FRESH START는 승인된(approved) ASSIGN에만 — 지금 ${p.status}${p.launch ? ", LAUNCH 카드" : ""}` }, 409);
    if (freshStartBusy(id)) return c.json({ error: "FRESH START가 이미 도는 중(자동, ATC-560) — 끝나면 카드가 sent가 된다" }, 409);
    const now = Date.now();
    const [s, rows] = await Promise.all([getSnapshot(), agentRows()]);
    const stop = p.airport ? enforcedStops(s.atfm?.groundStops ?? []).get(p.airport) : undefined;
    if (stop) return c.json({ error: `${groundStopWhy(stop)} — 풀릴 때까지 보내지 않는다` }, 409);
    const v = await verdictOf(p, s, rows, now);
    if (!v.ok) return c.json({ error: v.why }, 409);
    const reg = regOfProposal(p, loadDispatchConfig().teamPattern) ?? "";
    markFreshStartBusy(id, reg);
    try {
      const r = await runFor(p, s, reg, "SUPERVISOR");
      if (!r.ok) return c.json({ error: r.error, stage: r.stage, proposal: allProposals().find((x) => x.id === id) }, r.status);
      return c.json({ ok: true, jobId: r.jobId, proposal: allProposals().find((x) => x.id === id) });
    } finally {
      clearFreshStartBusy(id);
    }
  });
}

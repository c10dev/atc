import type { Context, Hono } from "hono";
import { enforcedStops, groundStopWhy } from "./atfm.ts";
import { loadDispatchConfig } from "./dispatch.ts";
import { FLEET_PLAN_DEFAULTS } from "./fleet-plan.ts";
import { goneFromAgents } from "./fleet-plan-run.ts";
import { fleetView, loadFleet } from "./fleet.ts";
import { type FreshStartVerdict, freshStartVerdictOf, runFreshStart } from "./fresh-start.ts";
import { aircraftContexts } from "./fuel-run.ts";
import { loadLogbook } from "./logbook.ts";
import type { Snapshot } from "./model.ts";
import { fromThisApp } from "./origin.ts";
import { allProposals, append, flightPlanMessageOf, type Proposal, regOfProposal } from "./proposals.ts";
import { readRecords, record } from "./recorder.ts";
import { regKey } from "./registration.ts";
import { agentRows, launchAircraft, liveRowsOf, rowOriginOf, stopAircraft } from "./session-control.ts";

// FRESH START(ATC-73): 승인된 ASSIGN을 받을 AIRCRAFT가 기준을 넘은 대화를 쥐고 있으면, SUPERVISOR가 한 번 눌러
// 그 백그라운드 세션을 STOP하고 CREW BRIEFING + FLIGHT PLAN을 첫 프롬프트로 새로 LAUNCH한다(docs/dispatch.md, docs/fleet.md 8.6).
// 화면 Origin이 있어야 한다(LAUNCH와 같다). 자동으로는 하지 않는다. 판정은 fresh-start.ts(순수), 여기는 입출력

const DAY = 86_400_000;

// 승인됐지만 아직 보내지 않은 ASSIGN(launch 카드가 아닌 것)
export const freshStartCandidate = (p: Proposal) => p.kind === "ASSIGN" && p.status === "approved" && !p.launch;

async function verdictOf(p: Proposal, s: Snapshot, rows: Awaited<ReturnType<typeof agentRows>>, now: number): Promise<FreshStartVerdict> {
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
    const now = Date.now();
    const [s, rows] = await Promise.all([getSnapshot(), agentRows()]);
    const stop = p.airport ? enforcedStops(s.atfm?.groundStops ?? []).get(p.airport) : undefined;
    if (stop) return c.json({ error: `${groundStopWhy(stop)} — 풀릴 때까지 보내지 않는다` }, 409);
    const v = await verdictOf(p, s, rows, now);
    if (!v.ok) return c.json({ error: v.why }, 409);
    const reg = regOfProposal(p, loadDispatchConfig().teamPattern) ?? "";
    const message = await flightPlanMessageOf(p, s);
    // 옵션은 그 AIRCRAFT의 마지막 atc LAUNCH와 같게(REFRESH와 같다). ACCOUNT는 LAUNCH ACCOUNT, 없으면 마지막
    let last: { permissionMode?: string; model?: string; account?: string } = {};
    for (const r of readRecords(now - 30 * DAY)) if (r.kind === "fleet" && r.op === "launch" && r.ok && regKey(r.aircraft) === reg) last = { permissionMode: r.permissionMode, model: r.model, account: r.account };
    const r = await runFreshStart(id, message, {
      stop: () => stopAircraft(reg, "SUPERVISOR"),
      gone: () => goneFromAgents(reg),
      launch: (promptOf) => launchAircraft(s, reg, { permissionMode: last.permissionMode, lastModel: last.model ?? null, lastAccount: last.account ?? null, promptOf }, "SUPERVISOR", id),
      append,
      note: (line) => record({ t: new Date().toISOString(), kind: "dispatch", op: "fresh-start", id, via: "fresh-start", flight: p.flight, aircraft: reg, by: "SUPERVISOR", ...line }),
      now: () => new Date().toISOString(),
    });
    if (!r.ok) return c.json({ error: r.error, stage: r.stage, proposal: allProposals().find((x) => x.id === id) }, r.status);
    return c.json({ ok: true, jobId: r.jobId, proposal: allProposals().find((x) => x.id === id) });
  });
}

import { readReports } from "./arrival-report.ts";
import { loadRegistry } from "./airports.ts";
import { tokenSum } from "./fuel.ts";
import { loadLogbook } from "./logbook.ts";
import { allProposals, readOps } from "./proposals.ts";
import { crewCallOfMessage, SOLO_MISFIRE_DAYS, type SoloLanded, type SoloMisfireRow, soloMisfiresOf, soloModeAt, type SoloSent } from "./solo-default.ts";
import { loadSoloSwitch } from "./solo-default-switch.ts";

// SOLO 기본(ATC-559)의 오작동 수: 제안 기록(보낸 FLIGHT PLAN 문구·UNABLE·SUPERVISOR 질문), 도착 보고(BLOCKED), LOGBOOK(block time·fuel·measured crew)을 읽는다.
// 판정은 solo-default.ts(순수). 설정 창의 SOLO 블록이 AIRPORT마다 그린다(읽기만)
const DAY = 86_400_000;

export function soloMisfiresNow(now = Date.now()): SoloMisfireRow[] {
  const sw = loadSoloSwitch();
  const since = now - SOLO_MISFIRE_DAYS * DAY;
  const proposals = allProposals().filter((p) => p.kind === "ASSIGN" && p.timeline.sent && Date.parse(p.timeline.sent) >= since);
  const ops = readOps();
  const reports = readReports();
  const sent: SoloSent[] = proposals.map((p) => {
    const at = Date.parse(p.timeline.sent!);
    const asked = [
      ...ops.flatMap((o) => ((o.op === "await-supervisor" || o.op === "decline") && o.id === p.id ? [o.reason] : [])),
      ...reports.flatMap((r) => (r.flight === p.flight && r.blocked !== "none" && (r.proposal === p.id || (!r.proposal && Date.parse(r.at) >= at)) ? [r.blocked] : [])),
    ];
    return { id: p.id, flight: p.flight, airport: p.airport, sentAt: p.timeline.sent!, call: crewCallOfMessage(p.message), asked };
  });
  // 기준(배포 앞 7일)과 최근 7일만 쓴다
  const anchor = sw.migrated?.at ?? null;
  const from = Math.min(since, anchor ? Date.parse(anchor) - SOLO_MISFIRE_DAYS * DAY : since);
  const landed: SoloLanded[] = loadLogbook()
    .filter((e) => Date.parse(e.arrivedAt) >= from)
    .map((e) => ({
      flight: e.flight,
      airport: e.airport,
      wake: e.class?.wake ?? null,
      departedAt: e.departedAt,
      arrivedAt: e.arrivedAt,
      blockMin: e.blockMin,
      tokens: e.fuel ? tokenSum(e.fuel.captain) + tokenSum(e.fuel.crew) : null,
      crew: e.measured?.crew ?? null,
    }));
  const airports = loadRegistry().entries.filter((e) => !e.closed).map((e) => e.code.toUpperCase());
  return soloMisfiresOf({ sent, landed, airports, modes: Object.fromEntries(airports.map((a) => [a, soloModeAt(sw, a)])), anchor, now });
}

import type { Context, Hono } from "hono";
import { classOf, canHoldSec, type CrewMember, RATINGS, type Rating } from "./crew.ts";
import { noteCrewChange } from "./crew-change.ts";
import { loadDispatchConfig } from "./dispatch.ts";
import { type AircraftView, applyPatch, FleetError, fleetView, loadFleet, saveAircraft } from "./fleet.ts";
import { type LogEntry, loadLogbook } from "./logbook.ts";
import type { Snapshot } from "./model.ts";
import { record } from "./recorder.ts";
import { fleetKeyOf, regKey } from "./registration.ts";
import { type ClassifyPayload, loadScheduleOps, type ScheduleOp } from "./schedule.ts";

// CHECKRIDE: AIRCRAFT × TYPE RATING마다 LOGBOOK에서 근거를 모아 부여·재검토를 추천한다(docs/fleet.md 8.2).
// 추천만 한다. rating은 SUPERVISOR가 부여·회수를 누를 때만 바뀐다.

const DAY = 86_400_000;
// 처음 제안값. 운용해 보며 조정한다.
export const CHECKRIDE = {
  grantDays: 30, // 부여 근거를 보는 기간
  grantMin: 3, // 부여 추천에 필요한 ARRIVED FLIGHT 수
  reviewDays: 14, // 재검토를 보는 기간
  maxRounds: 3, // Codex 지적 라운드 평균이 이 이상이면 부여 추천 안 함 / 재검토
  reviewMinFlights: 2, // 지적 라운드로 재검토하려면 이만큼의 FLIGHT가 있어야 한다
};

export type RatingSource = "label" | "schedule";
export interface FlightRating {
  ratings: Rating[];
  source: RatingSource;
  scheduleId?: string; // SCHEDULE이면 그 CLASSIFY 초안
}

export interface Evidence {
  key: string; // LOGBOOK key
  flight: string;
  pr: LogEntry["pr"];
  arrivedAt: string;
  source: RatingSource;
  scheduleId?: string;
  reverted: boolean;
  codexFindings: number;
}

export type CheckrideStatus = "GRANT" | "REVIEW" | "BLOCKED" | "BUILDING" | "HOLDS";

interface Tally {
  days: number;
  flights: number;
  reverted: number;
  avgRounds: number | null;
}

export interface CheckrideRow {
  registration: string;
  callsign: string;
  rating: Rating;
  holds: boolean;
  status: CheckrideStatus;
  reason: string;
  grant: Tally; // 최근 grantDays
  review: Tally; // 최근 reviewDays
  evidence: Evidence[]; // 최근 grantDays, 최신순
}

// SUPERVISOR가 받아들인 CLASSIFY(shadow agree, approval approve → agreed·approved·released·applied)
const accepted = (s: ScheduleOp) => s.kind === "CLASSIFY" && s.decision?.verdict === "agree" && s.flight;

// FLIGHT에 필요했던 TYPE RATING: 1) Linear 라벨(지금 티켓, 없으면 LOGBOOK의 class) 2) 받아들인 CLASSIFY 초안 3) 없음
export function flightRating(e: Pick<LogEntry, "flight" | "class">, labelsOf: (flight: string) => string[] | null, schedule: ScheduleOp[]): FlightRating | null {
  if (!e.flight) return null;
  const labels = labelsOf(e.flight);
  const fromLabels = labels ? classOf(labels).ratings : (e.class?.ratings ?? []);
  if (fromLabels.length) return { ratings: fromLabels, source: "label" };
  const op = schedule
    .filter((s) => accepted(s) && s.flight === e.flight && (s.payload as ClassifyPayload).ratings?.length)
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  return op ? { ratings: (op.payload as ClassifyPayload).ratings!, source: "schedule", scheduleId: op.id } : null;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
function tally(ev: Evidence[], days: number): Tally {
  return {
    days,
    flights: ev.length,
    reverted: ev.filter((e) => e.reverted).length,
    avgRounds: ev.length ? round1(ev.reduce((a, e) => a + e.codexFindings, 0) / ev.length) : null,
  };
}

// 한 AIRCRAFT·한 rating의 판정
export function judge(rating: Rating, holds: boolean, complement: CrewMember[], evidence: Evidence[], now: number): Omit<CheckrideRow, "registration" | "callsign"> {
  const within = (d: number) => evidence.filter((e) => Date.parse(e.arrivedAt) >= now - d * DAY && Date.parse(e.arrivedAt) <= now);
  const grantEv = within(CHECKRIDE.grantDays);
  const g = tally(grantEv, CHECKRIDE.grantDays);
  const r = tally(within(CHECKRIDE.reviewDays), CHECKRIDE.reviewDays);
  const rounds = (t: Tally) => (t.avgRounds === null ? "—" : String(t.avgRounds));
  const summary = `${rating} 근거 ${g.flights}/${CHECKRIDE.grantMin} FLIGHT, 되돌림 ${g.reverted}, Codex 지적 라운드 평균 ${rounds(g)}`;
  const base = { rating, holds, grant: g, review: r, evidence: grantEv };

  if (holds) {
    if (r.reverted) return { ...base, status: "REVIEW", reason: `${CHECKRIDE.reviewDays}일 안에 ${rating} FLIGHT 되돌림 ${r.reverted}건 → 재검토 추천` };
    if (r.flights >= CHECKRIDE.reviewMinFlights && r.avgRounds! >= CHECKRIDE.maxRounds) {
      return { ...base, status: "REVIEW", reason: `${CHECKRIDE.reviewDays}일 ${rating} FLIGHT ${r.flights}건의 Codex 지적 라운드 평균 ${r.avgRounds} (기준 ${CHECKRIDE.maxRounds} 미만) → 재검토 추천` };
    }
    return { ...base, status: "HOLDS", reason: `보유 · ${CHECKRIDE.grantDays}일 ${rating} FLIGHT ${g.flights}건, 되돌림 ${g.reverted}, Codex 지적 라운드 평균 ${rounds(g)}` };
  }
  if (g.flights < CHECKRIDE.grantMin) return { ...base, status: "BUILDING", reason: summary };
  if (g.reverted) return { ...base, status: "BUILDING", reason: `${summary} — 되돌림이 있어 부여 추천 안 함` };
  if (g.avgRounds! >= CHECKRIDE.maxRounds) return { ...base, status: "BUILDING", reason: `${summary} — 기준 ${CHECKRIDE.maxRounds} 미만이어야 부여 추천` };
  if (rating === "SEC" && !canHoldSec(complement)) {
    return { ...base, status: "BLOCKED", reason: `${summary} — SEC를 맡을 CREW가 없어 부여 추천 안 함(flash-helper만으로는 안 됨)` };
  }
  return { ...base, status: "GRANT", reason: `${summary} → 부여 추천` };
}

export function checkrideRows(
  aircraft: Pick<AircraftView, "registration" | "callsign" | "ratings" | "complement" | "retired">[],
  entries: LogEntry[],
  labelsOf: (flight: string) => string[] | null,
  schedule: ScheduleOp[],
  now: number,
): CheckrideRow[] {
  const rated = entries
    .filter((e) => e.aircraft)
    .map((e) => ({ e, fr: flightRating(e, labelsOf, schedule) }))
    .filter((x): x is { e: LogEntry; fr: FlightRating } => x.fr !== null)
    .sort((a, b) => b.e.arrivedAt.localeCompare(a.e.arrivedAt));
  const rows: CheckrideRow[] = [];
  for (const a of aircraft) {
    if (a.retired) continue;
    for (const rating of RATINGS) {
      const evidence: Evidence[] = rated
        .filter(({ e, fr }) => regKey(e.aircraft) === regKey(a.registration) && fr.ratings.includes(rating)) // 옛 LOGBOOK 표기도(ATC-67)
        .map(({ e, fr }) => ({
          key: e.key,
          flight: e.flight!,
          pr: e.pr,
          arrivedAt: e.arrivedAt,
          source: fr.source,
          ...(fr.scheduleId ? { scheduleId: fr.scheduleId } : {}),
          reverted: e.reverted,
          codexFindings: e.codexFindings,
        }));
      rows.push({ registration: a.registration, callsign: a.callsign, ...judge(rating, a.ratings.includes(rating), a.complement, evidence, now) });
    }
  }
  return rows;
}

// 부여·회수 뒤의 rating 목록(RATINGS 순서)
export function nextRatings(current: Rating[], rating: Rating, action: "grant" | "revoke"): Rating[] {
  const set = new Set(current);
  if (action === "grant") set.add(rating);
  else set.delete(rating);
  return RATINGS.filter((r) => set.has(r));
}

function rowsNow(s: Snapshot, now = Date.now()) {
  const labels = new Map(s.tickets.map((t) => [t.key, t.labels]));
  const aircraft = fleetView(s, loadFleet(), loadDispatchConfig().teamPattern);
  return checkrideRows(aircraft, loadLogbook(), (k) => labels.get(k) ?? null, loadScheduleOps(), now);
}

export function mountCheckride(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  app.get("/api/fleet/checkride", async (c) => c.json({ criteria: CHECKRIDE, rows: rowsNow(await getSnapshot()) }));

  // SUPERVISOR가 누른 부여·회수. FLEET 편집과 같은 길(applyPatch → fleet.json)로 바꾸고 FLIGHT RECORDER에 근거를 남긴다.
  app.post("/api/fleet/:registration/checkride", async (c: Context) => {
    const reg = regKey(c.req.param("registration"), loadDispatchConfig().teamPattern);
    const body = await c.req.json().catch(() => ({}));
    const rating = body.rating as Rating;
    const action = body.action;
    if (!RATINGS.includes(rating)) return c.json({ error: `모르는 TYPE RATING: ${body.rating}` }, 400);
    if (action !== "grant" && action !== "revoke") return c.json({ error: "action은 grant 또는 revoke" }, 400);
    const s = await getSnapshot();
    const row = rowsNow(s).find((x) => x.registration === reg && x.rating === rating);
    if (!row) return c.json({ error: `FLEET에 없음: ${reg}` }, 404);
    if (action === "grant" && row.holds) return c.json({ error: `${reg}는 이미 ${rating}를 가짐` }, 409);
    if (action === "revoke" && !row.holds) return c.json({ error: `${reg}에 ${rating}가 없음` }, 409);
    const fleet = loadFleet();
    const key = fleetKeyOf(Object.keys(fleet.aircraft), reg) ?? reg;
    const current = fleet.aircraft[key] ?? {};
    try {
      const next = applyPatch(current, { ratings: nextRatings(current.ratings ?? fleet.defaults.ratings, rating, action) }, fleet.defaults);
      saveAircraft(key, next);
      // 대기 중인 CREW CHANGE가 있으면 TYPE RATING 줄을 새 rating으로 다시 쓴다(없으면 아무것도 안 함)
      noteCrewChange(reg, current, next, fleet.defaults, s.sessions);
    } catch (e) {
      if (e instanceof FleetError) return c.json({ error: e.message }, e.status as 400);
      throw e;
    }
    const at = new Date().toISOString();
    record({
      t: at,
      kind: "checkride",
      op: action,
      aircraft: reg,
      rating,
      by: "SUPERVISOR",
      recommended: row.status === (action === "grant" ? "GRANT" : "REVIEW"),
      status: row.status,
      reason: row.reason,
      evidence: row.evidence.map((e) => `${e.key} ${e.flight} ${e.source}${e.scheduleId ? `:${e.scheduleId}` : ""}`),
    });
    return c.json({ ok: true, row: rowsNow(s).find((x) => x.registration === reg && x.rating === rating) });
  });
}

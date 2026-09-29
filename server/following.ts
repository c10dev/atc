import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { classOf, type Wake } from "./crew.ts";
import { type Departure, readDepartures } from "./departures.ts";
import { tailsOf } from "./dispatch.ts";
import { hasPr, type LogEntry, type PrEntry, loadLogbook, WAKE_EXPECT_MIN } from "./logbook.ts";
import type { Stranded } from "./landing.ts";
import { type Health, healthLabel } from "./health.ts";
import { type FuelRemaining, fuelUsedText, membersText } from "./fuel-remaining.ts";
import type { Clearance, PullRequest, Snapshot, Ticket, Workspace } from "./model.ts";
import { allProposals, type Proposal, standFreeTicket } from "./proposals.ts";
import { type LaunchFail, launchFailsOf } from "./dispatch-launch.ts";
import { regKey } from "./registration.ts";
import { needsDecision } from "./judges/report.ts";
import { loadReportThreshold } from "./judges/store.ts";

// FLIGHT FOLLOWING(운항 추적, docs/occ.md 8장). 배정된 FLIGHT의 진행을 기존 기록으로 따라가고,
// 늦거나(지연) Linear와 어긋나면(불일치) OCC가 SUPERVISOR에게 보고한다. 팀에 묻지는 않는다.
// 단계: READBACK(제안 timeline) → DEPARTED(제안 timeline, 착수 기록 departures.jsonl) → PR 열림(snapshot.pulls,
// LOGBOOK) → CLEARED(landing readyAt) → ARRIVED(LOGBOOK). 계산은 순수 함수, 반복 보고를 막는 기록만 파일에 둔다.
// STAND 없는 FLIGHT(SURVEY·CHECK, READBACK이 곧 DEPARTED)는 PR·CLEARED를 건너뛴다: READBACK → DEPARTED → ARRIVED이고,
// ARRIVED는 CAPTAIN 보고(제안의 arrived, OCC가 dispatch arrived로 기록)에서 온다. tail: FLIGHT면 Linear 완료로 본다.

const MIN = 60_000;
const DAY = 86_400_000;
export const DELAY_FACTOR = 1.5; // WAKE 기대치의 1.5배
export const LANDING_INFO_MS = 60 * MIN; // CLEARED 뒤 착륙 대기(정보)
export const KEEP_ARRIVED_MS = DAY; // ARRIVED하고 Linear도 끝난 FLIGHT는 하루 보이고 빠진다

export const STAGES = ["readback", "departed", "prOpened", "cleared", "arrived"] as const;
export type Stage = (typeof STAGES)[number];

export interface FollowIssue {
  code: "no-departure" | "no-pr" | "pr-not-cleared" | "landing-wait" | "no-arrival" | "review-no-pr" | "done-not-merged" | "merged-not-done" | "stranded" | "health" | "fuel" | "report" | "unable" | "launch";
  kind: "delay" | "mismatch";
  severity: "warn" | "info"; // info: 보여 주기만(착륙 대기는 SUPERVISOR 몫, 머지 뒤 Done 아님은 CLOSE 초안 몫)
  text: string;
  since: string; // 이 상태가 된 시각(기준 시각 + 허용 시간)
}

export interface FollowItem {
  flight: string;
  title: string | null;
  url: string | null;
  state: string | null; // Linear 상태 이름
  aircraft: string | null;
  source: "dispatch" | "tail"; // DISPATCH 제안 또는 tail: 라벨(사람이 직접 배정)
  standFree: boolean; // STAND 없는 FLIGHT: 단계는 READBACK → DEPARTED → ARRIVED(PR·CLEARED 없음)
  arrival: { note: string; url: string | null } | null; // STAND 없는 FLIGHT의 ARRIVED 보고
  proposal: { id: string; status: Proposal["status"] } | null;
  wake: Wake;
  expectMin: number;
  stages: Record<Stage, string | null>;
  stage: Stage | null; // 지금까지 닿은 마지막 단계
  stageAt: string | null;
  stand: string | null; // 지금 있는 STAND(워크트리) 경로
  pr: { repo: string; number: number; url: string; merged: boolean } | null;
  issues: (FollowIssue & { key: string })[];
}

export interface FollowInput {
  proposals: Proposal[];
  tickets: Ticket[];
  workspaces: Pick<Workspace, "path" | "ticketKey">[];
  pulls: PullRequest[];
  logbook: LogEntry[];
  departures: Departure[];
  now: number;
  stranded?: Stranded[]; // 기본 브랜치에 닿지 않은 머지(ATC-29)
  health?: Map<string, Health>; // REGISTRATION(대문자) → 그 AIRCRAFT의 health(ATC-45)
  fuel?: Record<string, FuelRemaining>; // REGISTRATION(대문자) → 그 ACCOUNT의 FUEL REMAINING(ATC-55)
  reports?: Map<string, { id: string; at: string; p: number }>; // REGISTRATION → 마지막 턴에 CAPTAIN이 결정을 청한 것으로 판정된 것(ATC-89, 문턱을 넘은 것만)
  unables?: Unable[]; // CAPTAIN이 UNABLE로 닫은 CLEARANCE·FLIGHT PLAN(ATC-122)
  launchFails?: LaunchFail[]; // launch 카드 승인 때 LAUNCH가 실패했거나 새 세션이 뜨지 않음(ATC-129)
}

// CAPTAIN의 UNABLE(ATC-122): FLIGHT가 있는 CLEARANCE와 FLIGHT PLAN(decline). FLIGHT가 없는 CREW CHANGE는 OCC 브리핑(crew-change brief의 unable)에 있다
export interface Unable {
  flight: string;
  id: string; // C-xxxx 또는 D-xxxx
  aircraft: string | null;
  reason: string;
  at: string;
}
export const UNABLE_KEEP_MS = DAY; // 하루 보이고 빠진다

// 스냅샷의 CLEARANCE와 제안에서 최근 UNABLE(순수)
export function unablesOf(clearances: Pick<Clearance, "id" | "flight" | "toName" | "unableAt" | "unableReason">[], proposals: Pick<Proposal, "id" | "flight" | "kind" | "status" | "statusAt" | "reason" | "aircraftName">[], now: number): Unable[] {
  const out: Unable[] = [];
  for (const c of clearances)
    if (c.flight && c.unableAt && now - Date.parse(c.unableAt) < UNABLE_KEEP_MS)
      out.push({ flight: c.flight, id: c.id, aircraft: c.toName, reason: c.unableReason ?? "", at: c.unableAt });
  for (const p of proposals)
    if (p.kind === "ASSIGN" && p.status === "declined" && now - Date.parse(p.statusAt) < UNABLE_KEEP_MS)
      out.push({ flight: p.flight, id: p.id, aircraft: p.aircraftName, reason: p.reason ?? "", at: p.statusAt });
  return out;
}

const iso = (ms: number) => new Date(ms).toISOString();
const hours = (ms: number) => {
  const h = ms / 3_600_000;
  return h >= 1 ? `${Math.round(h * 10) / 10}시간` : `${Math.round(ms / MIN)}분`;
};
const isReview = (t: Ticket | undefined) => Boolean(t && /review/i.test(t.state));
const isDone = (t: Ticket | undefined) => t?.stateType === "completed";
const isClosed = (t: Ticket | undefined) => Boolean(t && (t.stateType === "completed" || t.stateType === "canceled" || t.stateType === "duplicate"));

// 따라갈 FLIGHT: accepted·departed·recalling인 ASSIGN(STAND 없는 FLIGHT는 arrived도 하루 보인다),
// 그리고 2b 전이라도 tail:이 붙은 In Progress FLIGHT
export function targetsOf(inp: Pick<FollowInput, "proposals" | "tickets">): { flight: string; proposal: Proposal | null; aircraft: string | null }[] {
  const out = new Map<string, { flight: string; proposal: Proposal | null; aircraft: string | null }>();
  const live = inp.proposals
    .filter((p) => p.kind === "ASSIGN" && (p.status === "accepted" || p.status === "departed" || p.status === "recalling" || p.status === "arrived"))
    .sort((a, b) => a.statusAt.localeCompare(b.statusAt));
  for (const p of live) out.set(p.flight, { flight: p.flight, proposal: p, aircraft: p.aircraftName });
  for (const t of inp.tickets) {
    if (out.has(t.key) || t.stateType !== "started") continue;
    const tails = [...tailsOf(t)];
    if (tails.length) out.set(t.key, { flight: t.key, proposal: null, aircraft: tails[0] });
  }
  return [...out.values()];
}

// FLIGHT 하나의 단계·지연·불일치(순수)
export function followOne(target: { flight: string; proposal: Proposal | null; aircraft: string | null }, inp: FollowInput): FollowItem {
  const { flight, proposal } = target;
  const t = inp.tickets.find((x) => x.key === flight);
  const cls = classOf(t?.labels ?? []);
  const expectMin = WAKE_EXPECT_MIN[cls.wake] ?? WAKE_EXPECT_MIN.H!;
  const allow = expectMin * MIN * DELAY_FACTOR;

  const dep = inp.departures.filter((d) => d.flight === flight).map((d) => d.t).sort()[0] ?? null;
  const stand = inp.workspaces.find((w) => w.ticketKey === flight)?.path ?? null;
  const open = inp.pulls.filter((p) => p.ticketKey === flight).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const merged = inp.logbook
    .filter((e): e is PrEntry => hasPr(e) && e.landingWaitMin !== null)
    .filter((e) => e.flight === flight && !e.reverted)
    .sort((a, b) => b.arrivedAt.localeCompare(a.arrivedAt))[0];
  const mergedOpenedAt = merged ? iso(Date.parse(merged.arrivedAt) - merged.landingWaitMin * MIN) : null;
  // STAND 없는 FLIGHT: 제안이 READBACK으로 DEPARTED했거나, (tail: FLIGHT처럼 제안이 없으면) FLIGHT TYPE이 SURVEY·CHECK
  const standFree = proposal ? proposal.departedVia === "readback" || (!proposal.timeline.departed && standFreeTicket(t)) : standFreeTicket(t);

  const stages: Record<Stage, string | null> = standFree
    ? {
        readback: proposal?.timeline.accepted ?? null,
        departed: proposal?.timeline.departed ?? dep ?? (proposal ? null : (t?.startedAt ?? null)),
        prOpened: null,
        cleared: null,
        arrived: proposal ? (proposal.timeline.arrived ?? null) : isDone(t) ? (t!.updatedAt ?? null) : null,
      }
    : {
        readback: proposal?.timeline.accepted ?? null,
        departed: proposal?.timeline.departed ?? dep,
        prOpened: open?.createdAt ?? mergedOpenedAt,
        cleared: open?.landing === "CLEARED" ? open.readyAt : null,
        arrived: merged?.arrivedAt ?? null,
      };
  const reached = STAGES.filter((s) => stages[s]);
  const stage = reached.at(-1) ?? null;

  const issues: FollowIssue[] = [];
  const late = (from: string | null, ms: number) => (from && inp.now - Date.parse(from) > ms ? iso(Date.parse(from) + ms) : null);
  if (standFree) {
    // PR이 없는 일이라 PR·착륙·Linear-PR 불일치는 보지 않는다. DEPARTED 뒤 1.5배가 지나도 ARRIVED 보고가 없으면 지연
    const noArrival = !stages.arrived && proposal?.status !== "recalling" ? late(stages.departed, allow) : null;
    if (noArrival) issues.push({ code: "no-arrival", kind: "delay", severity: "warn", text: `DEPARTED 뒤 ${hours(inp.now - Date.parse(stages.departed!))} 동안 ARRIVED 보고 없음(STAND 없는 ${cls.type}) — WAKE ${cls.wake} 기대 ${expectMin}분의 ${DELAY_FACTOR}배를 넘음`, since: noArrival });
  } else if (!stages.arrived && proposal?.status !== "recalling") {
    const noDep = !stages.departed && !stand ? late(stages.readback, allow) : null;
    if (noDep) issues.push({ code: "no-departure", kind: "delay", severity: "warn", text: `READBACK 뒤 ${hours(inp.now - Date.parse(stages.readback!))} 동안 착수(STAND) 없음 — WAKE ${cls.wake} 기대 ${expectMin}분의 ${DELAY_FACTOR}배를 넘음`, since: noDep });
    const startedAt = stages.departed ?? (stand ? stages.readback : null);
    const noPr = !stages.prOpened ? late(startedAt, allow) : null;
    if (noPr) issues.push({ code: "no-pr", kind: "delay", severity: "warn", text: `STAND는 있는데 ${hours(inp.now - Date.parse(startedAt!))} 동안 PR 없음 — WAKE ${cls.wake} 기대 ${expectMin}분의 ${DELAY_FACTOR}배를 넘음`, since: noPr });
    const notCleared = open && !stages.cleared ? late(stages.prOpened, allow) : null;
    if (notCleared) issues.push({ code: "pr-not-cleared", kind: "delay", severity: "warn", text: `PR #${open!.number}이 ${hours(inp.now - Date.parse(stages.prOpened!))} 동안 CLEARED TO LAND가 안 됨: ${open!.blocks.map((b) => b.text).join(" · ") || "막힘 없음"}`, since: notCleared });
    const waiting = late(stages.cleared, LANDING_INFO_MS);
    if (waiting) issues.push({ code: "landing-wait", kind: "delay", severity: "info", text: `PR #${open!.number}이 CLEARED 뒤 ${hours(inp.now - Date.parse(stages.cleared!))} 동안 착륙하지 않음(착륙 대기는 SUPERVISOR 몫)`, since: waiting });
  }
  if (!standFree && isReview(t) && !open && !merged) issues.push({ code: "review-no-pr", kind: "mismatch", severity: "warn", text: `Linear는 ${t!.state}인데 PR이 없음`, since: t!.updatedAt ?? iso(inp.now) });
  if (!standFree && isDone(t) && !merged) issues.push({ code: "done-not-merged", kind: "mismatch", severity: "warn", text: `Linear는 ${t!.state}인데 ${open ? `PR #${open.number}이 머지되지 않음` : "머지된 PR이 없음"}`, since: t!.updatedAt ?? iso(inp.now) });
  if (!standFree && merged && t && !isClosed(t)) issues.push({ code: "merged-not-done", kind: "mismatch", severity: "info", text: `PR #${merged.pr.number}은 머지됐는데 Linear는 ${t.state} — CLOSE 초안 대상`, since: merged.arrivedAt });

  return {
    flight,
    title: t?.title ?? null,
    url: t?.url ?? null,
    state: t?.state ?? null,
    aircraft: target.aircraft,
    source: proposal ? "dispatch" : "tail",
    standFree,
    arrival: proposal?.arrivedNote ? { note: proposal.arrivedNote, url: proposal.arrivedUrl ?? null } : null,
    proposal: proposal ? { id: proposal.id, status: proposal.status } : null,
    wake: cls.wake,
    expectMin,
    stages,
    stage,
    stageAt: stage ? stages[stage] : null,
    stand,
    pr: open ? { repo: open.repo, number: open.number, url: open.url, merged: false } : merged ? { repo: merged.pr.repo, number: merged.pr.number, url: merged.pr.url, merged: true } : null,
    issues: issues.map((i) => ({ ...i, key: `${flight}|${i.code}` })),
  };
}

// 전체(순수). ARRIVED하고 Linear도 끝난 지 하루가 지난 FLIGHT는 뺀다(STAND 없는 FLIGHT는 ARRIVED 보고 뒤 하루).
// STRANDED(ATC-29)인 FLIGHT는 따라가는 대상이 아니어도(이미 Done이어도) 넣고, 경보가 풀릴 때까지 빼지 않는다
export function followingOf(inp: FollowInput): FollowItem[] {
  const targets = targetsOf(inp);
  for (const x of inp.stranded ?? []) if (!targets.some((t) => t.flight === x.flight)) targets.push({ flight: x.flight, proposal: null, aircraft: null });
  for (const x of inp.unables ?? []) if (!targets.some((t) => t.flight === x.flight)) targets.push({ flight: x.flight, proposal: null, aircraft: x.aircraft });
  for (const x of inp.launchFails ?? []) if (!targets.some((t) => t.flight === x.flight)) targets.push({ flight: x.flight, proposal: null, aircraft: x.aircraft });
  return targets
    .map((t) => {
      const f = followOne(t, inp);
      // AIRCRAFT health(ATC-45): 그 FLIGHT를 쥔 AIRCRAFT가 멈췄거나 기다리고 있다. key에 코드를 넣어 코드가 바뀌면 새로 보고한다
      const h = f.aircraft ? inp.health?.get(regKey(f.aircraft)) : undefined;
      if (h && !f.stages.arrived) {
        f.issues.push({
          code: "health",
          kind: "delay",
          severity: h.level === "alert" ? "warn" : "info",
          text: `${f.aircraft} ${healthLabel(h, inp.now)} — ${h.detail}. ${h.next}`,
          since: h.since,
          key: `${t.flight}|health|${h.code}`,
        });
      }
      // FUEL REMAINING(ATC-55): 그 FLIGHT를 쥔 AIRCRAFT의 ACCOUNT가 INFO 임계값을 넘었다. key에 ACCOUNT·창·reset을 넣어 창마다 한 번 보고한다
      const fuel = f.aircraft ? inp.fuel?.[regKey(f.aircraft)] : undefined;
      if (fuel && fuel.level !== "ok" && !f.stages.arrived) {
        f.issues.push({
          code: "fuel",
          kind: "delay",
          severity: "info",
          text: `${f.aircraft} ${fuelUsedText(fuel, inp.now)}${fuel.account ? ` (account ${fuel.account})` : ""} — 한도에 가까움. 같은 ACCOUNT: ${membersText(fuel)}`,
          since: fuel.at,
          key: `${t.flight}|fuel|${fuel.group}|${fuel.top.name}|${fuel.top.resetsAt}`,
        });
      }
      // REPORT(ATC-89): 그 FLIGHT를 쥔 AIRCRAFT의 CAPTAIN이 마지막 턴에 SUPERVISOR의 결정을 청했다(Jev 판정, 그림자). key에 판정한 턴을 넣어 턴마다 한 번
      const rep = f.aircraft ? inp.reports?.get(regKey(f.aircraft)) : undefined;
      if (rep && !f.stages.arrived) {
        f.issues.push({
          code: "report",
          kind: "delay",
          severity: "info",
          text: `${f.aircraft}의 CAPTAIN이 마지막 보고에서 SUPERVISOR의 결정을 청한 것으로 판정됨(Jev ${Math.round(rep.p * 100)}%, 그림자) — 그 세션의 마지막 메시지를 읽어 본다`,
          since: rep.at,
          key: `${t.flight}|report|${rep.id}`,
        });
      }
      for (const x of (inp.stranded ?? []).filter((y) => y.flight === t.flight)) {
        const done = isDone(inp.tickets.find((y) => y.key === t.flight));
        f.issues.push({
          code: "stranded",
          kind: "mismatch",
          severity: "warn",
          text: `STRANDED — PR #${x.number}이 ${x.base}에 머지돼 기본 브랜치에 닿지 않음${done ? " (Linear는 Done이지만 변경은 main에 없음)" : ""}`,
          since: x.mergedAt,
          key: `${t.flight}|stranded|${x.number}`,
        });
      }
      // UNABLE(ATC-122): CAPTAIN이 못 한다고 답했다. OCC가 SUPERVISOR에게 보고한다(다시 보내지 않는다)
      for (const x of (inp.unables ?? []).filter((y) => y.flight === t.flight)) {
        f.issues.push({
          code: "unable",
          kind: "delay",
          severity: "warn",
          text: `${x.aircraft ?? "CAPTAIN"} UNABLE ${x.id} — ${x.reason || "사유 없음"}`,
          since: x.at,
          key: `${t.flight}|unable|${x.id}`,
        });
      }
      // LAUNCH 실패(ATC-129): 승인한 launch 카드의 세션이 뜨지 않아 FLIGHT PLAN을 보내지 않았다. SUPERVISOR가 FLEET에서 보거나 다시 승인한다
      for (const x of (inp.launchFails ?? []).filter((y) => y.flight === t.flight)) {
        f.issues.push({
          code: "launch",
          kind: "delay",
          severity: "warn",
          text: `${x.aircraft ?? "AIRCRAFT"} ${x.id} — ${x.reason}. FLIGHT PLAN은 보내지 않았다`,
          since: x.at,
          key: `${t.flight}|launch|${x.id}`,
        });
      }
      return f;
    })
    .filter((f) => {
      if (f.issues.some((i) => i.code === "stranded" || i.code === "unable" || i.code === "launch")) return true;
      if (!f.stages.arrived || inp.now - Date.parse(f.stages.arrived) <= KEEP_ARRIVED_MS) return true;
      return !(f.standFree || isClosed(inp.tickets.find((t) => t.key === f.flight)));
    });
}

// ── 반복 보고 막기: OCC가 보고한 문제의 key를 적어 둔다. 풀린 문제는 지워서 다시 생기면 새로 보고한다 ──

const STATE_FILE = () => join(config.stateDir, "following-state.json");
export interface Reported {
  reported: Record<string, string>; // issue key → 보고한 시각
}
export function loadReported(file = STATE_FILE()): Reported {
  try {
    const r = JSON.parse(readFileSync(file, "utf8"));
    return { reported: r.reported && typeof r.reported === "object" ? r.reported : {} };
  } catch {
    return { reported: {} };
  }
}
function saveReported(r: Reported, file = STATE_FILE()) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(r, null, 2) + "\n");
  renameSync(tmp, file);
}

// 지금 문제 중 아직 보고하지 않은 것(순수)
export const freshKeys = (items: FollowItem[], r: Reported) => items.flatMap((f) => f.issues.map((i) => i.key)).filter((k) => !(k in r.reported));

// 보고했다고 적는다(순수): 지금 있는 문제만 남기고(풀린 것은 지움), ack한 key를 더한다
export function ackReported(items: FollowItem[], r: Reported, keys: string[], now: string): Reported {
  const current = new Set(items.flatMap((f) => f.issues.map((i) => i.key)));
  const next: Record<string, string> = {};
  for (const [k, at] of Object.entries(r.reported)) if (current.has(k)) next[k] = at;
  for (const k of keys) if (current.has(k)) next[k] ??= now;
  return { reported: next };
}

// ── API ──

export function followingNow(s: Snapshot, now = Date.now()): FollowItem[] {
  const health = new Map(s.sessions.filter((x) => x.status !== "dead" && x.health).map((x) => [regKey(x.name), x.health!]));
  const min = loadReportThreshold();
  const reports = new Map(s.sessions.filter((x) => x.status === "idle" && x.report && needsDecision(x.report, min)).map((x) => [regKey(x.name), { id: x.report!.id, at: x.report!.turnAt, p: x.report!.decisionP }]));
  const proposals = allProposals();
  return followingOf({ proposals, tickets: s.tickets, workspaces: s.workspaces, pulls: s.pulls, logbook: loadLogbook(), departures: readDepartures(), now, stranded: s.stranded ?? [], health, fuel: s.fuel ?? {}, reports, unables: unablesOf(s.clearances ?? [], proposals, now), launchFails: launchFailsOf(proposals, now) });
}

export function mountFollowing(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  // 읽기만 한다. fresh는 아직 OCC가 보고하지 않은 문제
  app.get("/api/following", async (c) => {
    const s = await getSnapshot();
    const now = Date.now();
    const items = followingNow(s, now);
    const r = loadReported();
    const fresh = new Set(freshKeys(items, r));
    return c.json({
      at: iso(now),
      linear: s.linear.fetchedAt,
      github: s.github.fetchedAt,
      items: items.map((f) => ({ ...f, issues: f.issues.map((i) => ({ ...i, fresh: fresh.has(i.key), reportedAt: r.reported[i.key] ?? null })) })),
      fresh: [...fresh],
    });
  });

  // OCC가 보고한 문제를 적는다. keys가 없으면 지금 fresh 전부
  app.post("/api/following/ack", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const s = await getSnapshot();
    const now = Date.now();
    const items = followingNow(s, now);
    const r = loadReported();
    const keys = Array.isArray(body.keys) ? body.keys.map(String) : freshKeys(items, r);
    const next = ackReported(items, r, keys, iso(now));
    saveReported(next);
    return c.json({ acked: keys.filter((k: string) => k in next.reported), reported: Object.keys(next.reported).length });
  });
}

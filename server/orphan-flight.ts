import type { Departure } from "./departures.ts";
import { tailsOf } from "./dispatch-launch.ts";
import type { Claim, Session, Ticket, Workspace } from "./model.ts";
import type { Proposal } from "./proposals.ts";
import { registrationOf } from "./registration.ts";

// ORPHAN FLIGHT(ATC-516, docs/fleet.md): 출발한 FLIGHT의 AIRCRAFT 세션이 죽었는데(예: 사용 한도로 끊김) 같은 REGISTRATION의 새 세션이 그 FLIGHT를 쥐지 않은 채 살아 있다.
// 이 파일은 순수 함수만 둔다(읽고 쓰는 것은 orphan-flight-run.ts). 판정은 STAND 점유(claim)가 아니라 출발 기록에서 한다: 점유는 ATC_CLAIM_TTL_MIN(기본 180분)이 지나면 이미 없다.
// SUPERVISOR 전용 스위치(기본 on)가 감지·알림·HOME 줄·DISPATCH 셈을 함께 끈다. off는 지금과 같다.

const MIN = 60_000;
export const DEFAULT_ORPHAN_GRACE_MIN = 15;
export const ORPHAN_ALERT_MISFIRE_MIN = 15; // 알림이 이 안에 사라지고 RELAY도 머지도 없으면 소음(MISFIRE)

export type OrphanSwitch = "off" | "on";
export const ORPHAN_SWITCHES: readonly OrphanSwitch[] = ["off", "on"];
// 파일에 없거나 모르는 값이면 on(live first). 끄는 것은 SUPERVISOR가 쓴 off뿐이다
export const parseOrphanSwitch = (v: unknown): OrphanSwitch => (v === "off" ? "off" : "on");

export interface OrphanInput {
  now: number;
  teamPattern?: string;
  sessions: readonly (Pick<Session, "id" | "name" | "status" | "startedAt" | "lastActiveAt"> & Partial<Pick<Session, "keptFlights">>)[];
  tickets: readonly Pick<Ticket, "key" | "stateType" | "labels">[];
  proposals: readonly Pick<Proposal, "id" | "kind" | "flight" | "aircraft" | "aircraftName" | "registration" | "status" | "timeline" | "departedStand" | "at">[];
  departures: readonly Pick<Departure, "t" | "flight" | "stand">[];
  workspaces: readonly Pick<Workspace, "path" | "ticketKey">[];
  claims: readonly Pick<Claim, "sessionId" | "workspacePath" | "state">[]; // 살아 있는 점유(만료된 것은 스냅샷에 없다)
  landed: { has(flight: string): boolean }; // 머지된 PR이 있는 FLIGHT
  owned: ReadonlySet<string>; // 다른 길이 이미 주인인 REGISTRATION: RESTARTING, ABSENT(RESUME 카드·LIMIT 끊김)
}

export interface OrphanFlight {
  flight: string;
  registration: string;
  proposal: string; // D-xxxx
  since: string; // 앞 세션이 멈춘 시각(ISO)
  stand: string | null; // 출발·릴리스 기록과 워크스페이스 연결에서 찾은 STAND 경로. 못 찾으면 null
}

const FLYING = new Set(["accepted", "departed"]); // READBACK했고 출발했다. arrived·recalled·closed 등은 끝났다

export function orphansOf(inp: OrphanInput): OrphanFlight[] {
  const regOf = (name: string | null | undefined) => registrationOf(name, inp.teamPattern);
  const live = inp.sessions.filter((s) => s.status !== "dead");
  const out: OrphanFlight[] = [];
  const latest = new Map<string, OrphanInput["proposals"][number]>();
  for (const p of inp.proposals) {
    if (p.kind !== "ASSIGN" || !FLYING.has(p.status)) continue;
    const prev = latest.get(p.flight);
    if (!prev || p.at > prev.at) latest.set(p.flight, p);
  }
  for (const [flight, p] of latest) {
    const t = inp.tickets.find((x) => x.key === flight);
    if (!t || t.stateType !== "started" || inp.landed.has(flight)) continue; // 시작됐고 머지된 PR이 없고 취소되지 않았다
    const reg = p.registration ?? regOf(p.aircraftName);
    if (!reg || inp.owned.has(reg)) continue; // RESTARTING·RESUME 길이 이미 주인이다
    const old = inp.sessions.find((s) => s.id === p.aircraft);
    if (old && old.status !== "dead") continue; // 출발 때 세션이 아직 살아 있다
    const mine = live.filter((s) => regOf(s.name) === reg);
    const standPaths = new Set(inp.workspaces.filter((w) => w.ticketKey === flight).map((w) => w.path));
    const held =
      tailsOf(t, inp.now).has(reg) || // tail: 라벨(DISPATCH도 이미 셈에 넣는다)
      mine.some((s) => s.keptFlights?.includes(flight)) ||
      inp.claims.some((c) => c.state === "active" && standPaths.has(c.workspacePath) && mine.some((s) => s.id === c.sessionId)); // 그 STAND의 점유
    if (held) continue;
    const dep = [...inp.departures].filter((d) => d.flight === flight && d.stand).sort((a, b) => b.t.localeCompare(a.t))[0];
    const since = old?.lastActiveAt ?? p.timeline.departed ?? p.timeline.accepted ?? dep?.t ?? p.at;
    out.push({ flight, registration: reg, proposal: p.id, since, stand: dep?.stand ?? p.departedStand ?? null });
  }
  return out.sort((a, b) => a.since.localeCompare(b.since) || a.flight.localeCompare(b.flight));
}

// 알림과 HOME 줄은 앞 세션이 멈춘 뒤 grace가 지나야 나온다. DISPATCH 셈은 기다리지 않는다
export const orphanDue = (o: Pick<OrphanFlight, "since">, now: number, graceMin = DEFAULT_ORPHAN_GRACE_MIN): boolean => now - Date.parse(o.since) >= Math.max(1, graceMin) * MIN;

// STAND가 지금 담은 것(orphan-flight-run.ts가 git에서 읽는다)
export interface OrphanStandFacts {
  commit: string | null; // 푸시된 마지막 커밋(WIP 포함)
  uncommitted: number | null; // 커밋 안 된 변경 수
  deletions: number | null; // 그중 삭제
}
export const NO_STAND_FACTS: OrphanStandFacts = { commit: null, uncommitted: null, deletions: null };

export interface OrphanView extends OrphanFlight {
  facts: OrphanStandFacts;
  text: string; // 영어 RESUME 글(RELAY 초안)
  line: string; // 한국어 한 줄(HOME·ALERT)
}

export function ageTextOf(ms: number): string {
  const m = Math.max(0, Math.round(ms / MIN));
  return m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

// RESUME 글(영어, RELAY 입력 검사를 통과해야 한다): FLIGHT, STAND, 푸시된 WIP 커밋, 변경 수, 새 STAND로 옮기지 말라는 지시
export function resumeTextOf(o: OrphanFlight, f: OrphanStandFacts): string {
  const parts = [`Resume ${o.flight}. The earlier ${o.registration} session that flew it stopped at ${o.since}, and no live session holds ${o.flight} now.`];
  parts.push(o.stand ? `Continue in the same STAND: ${o.stand}` : `The STAND for ${o.flight} is unknown; find its worktree (git worktree list) before you take anything new.`);
  if (f.commit) parts.push(`The last pushed WIP commit there is ${f.commit}.`);
  if (f.uncommitted) {
    const del = f.deletions ? ` (${f.deletions} of them deletions)` : "";
    parts.push(`That STAND has ${f.uncommitted} uncommitted changes${del}. Do not move to a new STAND and do not take another FLIGHT while it has uncommitted changes; check git status, then continue ${o.flight} there.`);
  } else {
    parts.push(`Continue ${o.flight} there before you take another FLIGHT.`);
  }
  return parts.join(" ");
}

// 한국어 한 줄: FLIGHT, REGISTRATION, 얼마나 비었나, STAND가 담은 것
export function orphanLineOf(o: OrphanFlight, f: OrphanStandFacts, now: number): string {
  const stand = o.stand ? o.stand.replace(/\/+$/, "").split("/").pop() : null;
  const has = !o.stand
    ? "STAND 모름"
    : `STAND ${stand}: ${[f.commit ? `마지막 푸시 ${f.commit}` : "푸시한 커밋 없음", f.uncommitted === null ? "변경 수 모름" : `변경 ${f.uncommitted}${f.deletions ? `(삭제 ${f.deletions})` : ""}`].join(", ")}`;
  return `${o.flight} · ${o.registration} · ${ageTextOf(now - Date.parse(o.since))} 주인 없음 · ${has}`;
}

export const orphanViewOf = (o: OrphanFlight, f: OrphanStandFacts, now: number): OrphanView => ({ ...o, facts: f, text: resumeTextOf(o, f), line: orphanLineOf(o, f, now) });

// DISPATCH 셈: REGISTRATION → 그 REGISTRATION이 쥔 것으로 세는 FLIGHT들(grace를 기다리지 않는다)
export function orphanFlightsByReg(os: readonly Pick<OrphanFlight, "flight" | "registration">[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const o of os) m.set(o.registration, [...(m.get(o.registration) ?? []), o.flight]);
  return m;
}

// ── 에피소드 기록(orphan-flight-events.jsonl, 추가만) ──
export type OrphanEnd = "held" | "merged" | "canceled" | "switch" | "gone";
export interface OrphanEventLine {
  at: string;
  op: "open" | "alert" | "hold" | "close";
  flight: string;
  registration: string;
  since?: string; // open
  endedBy?: OrphanEnd; // close
  relay?: boolean; // close: 에피소드 동안 이 REGISTRATION에 그 FLIGHT의 RELAY가 갔나
  misfire?: ("alert" | "hold")[]; // close: 소음으로 센 이유
}

export interface OrphanEpisode {
  open: OrphanEventLine;
  alertAt: string | null;
  holdAt: string | null;
}
export function openEpisodesOf(lines: readonly OrphanEventLine[]): Map<string, OrphanEpisode> {
  const m = new Map<string, OrphanEpisode>();
  for (const l of lines) {
    const e = m.get(l.flight);
    if (l.op === "open") m.set(l.flight, { open: l, alertAt: null, holdAt: null });
    else if (l.op === "close") m.delete(l.flight);
    else if (e) {
      if (l.op === "alert") e.alertAt = l.at;
      else e.holdAt = l.at;
    }
  }
  return m;
}

export interface OrphanStepCtx {
  now: number;
  graceMin: number;
  sw: OrphanSwitch;
  // 에피소드가 끝났을 때 왜: 머지·취소·다시 쥠(held)·그 밖(gone)
  endOf: (flight: string) => Exclude<OrphanEnd, "switch">;
  relaySince: (flight: string, registration: string, sinceMs: number) => boolean;
}

// 이번 순간의 orphan 목록에서 덧붙일 줄. 열기·알림이 나올 때(grace)·닫기(MISFIRE 표시 포함)
export function orphanStep(open: ReadonlyMap<string, OrphanEpisode>, orphans: readonly OrphanFlight[], c: OrphanStepCtx): OrphanEventLine[] {
  const out: OrphanEventLine[] = [];
  const at = new Date(c.now).toISOString();
  const nowSet = new Map(orphans.map((o) => [o.flight, o]));
  for (const o of orphans) {
    const e = open.get(o.flight);
    if (!e) out.push({ at, op: "open", flight: o.flight, registration: o.registration, since: o.since });
    else if (!e.alertAt && orphanDue(o, c.now, c.graceMin)) out.push({ at, op: "alert", flight: o.flight, registration: o.registration });
    // 같은 순간에 처음 열렸고 이미 grace가 지났으면(서버가 늦게 봤다) 다음 순간에 알림이 나온다
  }
  for (const [flight, e] of open) {
    if (nowSet.has(flight)) continue;
    const endedBy: OrphanEnd = c.sw === "off" ? "switch" : c.endOf(flight);
    const sinceMs = Date.parse(e.open.since ?? e.open.at);
    const relay = c.relaySince(flight, e.open.registration, sinceMs);
    const misfire: ("alert" | "hold")[] = [];
    if (endedBy === "held") {
      if (e.alertAt && c.now - Date.parse(e.alertAt) < ORPHAN_ALERT_MISFIRE_MIN * MIN && !relay) misfire.push("alert");
      if (e.holdAt && c.now - sinceMs <= Math.max(1, c.graceMin) * MIN) misfire.push("hold");
    }
    out.push({ at, op: "close", flight, registration: e.open.registration, endedBy, relay, misfire });
  }
  return out;
}

export interface OrphanCounter {
  episodes: number;
  closed: number;
  misfires: { alert: number; hold: number; total: number };
  open: string[]; // 지금 열린 FLIGHT
}
export function orphanCounterOf(lines: readonly OrphanEventLine[], now: number, days = 7): OrphanCounter {
  const since = now - days * 86_400_000;
  const win = lines.filter((l) => Date.parse(l.at) >= since);
  const closed = win.filter((l) => l.op === "close");
  const alert = closed.filter((l) => l.misfire?.includes("alert")).length;
  const hold = closed.filter((l) => l.misfire?.includes("hold")).length;
  return { episodes: win.filter((l) => l.op === "open").length, closed: closed.length, misfires: { alert, hold, total: alert + hold }, open: [...openEpisodesOf(lines).keys()].sort() };
}

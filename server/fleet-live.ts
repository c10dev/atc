import { canceledKeysOf } from "./canceled-flight.ts";
import type { AccountHold, Health } from "./health.ts";
import { accountHoldOf, accountHolds } from "./health.ts";
import type { Job } from "./job-state.ts";
import type { Activity } from "./activity.ts";
import type { Snapshot } from "./model.ts";
import { registrationNamesOf, regKey } from "./registration.ts";
import type { Restarting } from "./restarting.ts";
import type { SessionOrigin } from "./session-origin.ts";
import type { AircraftFlight, AircraftView, FlightDetail } from "./fleet.ts";

// FLEET의 빠르게 바뀌는 값(ATC-100): 스냅샷(SSE)만으로 셈하는 순수 함수. 서버(fleetView)와 화면(Fleet.tsx)이 같이 쓴다.
// 느린 부분(등록부·TARGETS·실적·FUEL·RATING·ROUTE·CONTEXT·REPORT)은 GET /api/fleet이 준다. node:fs 등을 끌어오지 않는다.

export type LiveSnapshot = Pick<Snapshot, "sessions" | "claims" | "workspaces"> & Partial<Pick<Snapshot, "tickets" | "pulls" | "restarting">>;

export interface AircraftLive {
  status: AircraftView["status"];
  flying: string[];
  flights: AircraftFlight[];
  flyingSince: string | null;
  lastActiveAt: string | null;
  origin: SessionOrigin | null;
  permissionMode: string | null;
  background: AircraftView["background"];
  restarting: Restarting | null;
  health: Health | null;
  job: Job | null;
  activity: Activity | null; // ACTIVITY(ATC-97). 스냅샷 속도로 바뀐다
  accountHold: AccountHold | null;
  sessionName: string | null;
  sessionConflict: string[] | null;
}

export function flightDetailOf(s: Pick<Snapshot, "workspaces"> & Partial<Pick<Snapshot, "pulls">>, key: string): FlightDetail {
  const ws = s.workspaces.find((w) => w.ticketKey === key && !w.isMain) ?? s.workspaces.find((w) => w.ticketKey === key);
  const pr = s.pulls?.find((p) => p.ticketKey === key);
  return {
    commit: ws && ws.head ? { sha: ws.head.slice(0, 7), at: ws.lastCommitAt } : null,
    pushed: ws?.pushed ?? null,
    pr: pr ? { number: pr.number, url: pr.url, draft: pr.draft } : null,
  };
}

// REGISTRATION마다 라이브 값. accountOf: 세션 이름 또는 REGISTRATION → ACCOUNT 라벨(같은 ACCOUNT의 LIMIT 붙들림에 쓴다)
export function liveViewOf(
  s: LiveSnapshot,
  registrations: readonly string[],
  teamPattern: string,
  accountOf: (name: string) => string | null,
  now: number,
): Map<string, AircraftLive> {
  const team = new RegExp(teamPattern, "i");
  const wsTicket = new Map(s.workspaces.map((w) => [w.path, w.ticketKey]));
  const live = s.sessions.filter((x) => team.test(x.name) && x.status !== "dead");
  // 세션 이름은 `Team G`, `team_g`처럼 달라도 한 REGISTRATION으로 읽는다(ATC-67)
  const regOf = (name: string) => regKey(name, teamPattern);
  const liveNames = registrationNamesOf(live.map((x) => x.name), teamPattern);
  const holds = accountHolds(live.map((x) => ({ name: x.name, account: accountOf(x.name), health: x.health })), now);
  const title = (key: string) => s.tickets?.find((t) => t.key === key)?.title ?? null;
  const canceled = canceledKeysOf(s.tickets);
  const cx = (key: string) => (canceled.has(key) ? { canceled: true as const } : {});
  const out = new Map<string, AircraftLive>();
  for (const reg of registrations) {
    const session = live.find((x) => regOf(x.name) === reg);
    const seen = liveNames.get(reg);
    const held = session ? s.claims.filter((c) => c.sessionId === session.id && c.state === "active") : [];
    const flying = [...new Set(held.map((c) => wsTicket.get(c.workspacePath)).filter(Boolean) as string[])];
    out.set(reg, {
      status: session ? session.status : "absent",
      flying,
      flights: [
        ...flying.map((key) => ({ key, title: title(key), ...cx(key), detail: flightDetailOf(s, key) })),
        ...(session?.keptFlights ?? []).filter((k) => !flying.includes(k)).map((key) => ({ key, title: title(key), kept: true as const, ...cx(key), detail: flightDetailOf(s, key) })),
      ],
      flyingSince: held.map((c) => c.since).sort()[0] ?? null,
      lastActiveAt: session?.lastActiveAt ?? null,
      origin: session ? (session.origin ?? "unknown") : null,
      permissionMode: session?.permissionMode ?? null,
      // 살아 있는 세션이 background일 때만(ATC-98). 스냅샷만으로 셈한다 — claude agents를 더 부르지 않는다. 죽은 세션·STALE job은 세션이 없어 null
      background: session && (session.kind === "background" || session.origin === "background") ? { jobId: session.jobId ?? null, ...(session.attachDir ? { attachDir: session.attachDir } : {}) } : null,
      restarting: session ? null : (s.restarting?.find((r) => r.registration === reg) ?? null),
      health: session?.health ?? null,
      job: session?.job ?? null,
      activity: session?.activity ?? null,
      accountHold: session ? accountHoldOf(holds, accountOf(reg), reg) : null,
      sessionName: seen?.rename ?? null,
      sessionConflict: seen?.conflict ? seen.names : null,
    });
  }
  return out;
}

// 느린 목록에 라이브 값을 덮어쓴다. 스냅샷에 없는 AIRCRAFT는 NOT IN SERVICE(absent)가 된다. 느린 값(TARGETS·실적·FUEL 등)은 그대로 둔다
export function mergeLive(slow: readonly AircraftView[], s: LiveSnapshot, teamPattern: string, now: number): AircraftView[] {
  const accounts = new Map(slow.map((a) => [a.registration, a.observedAccount ?? a.account ?? null]));
  const live = liveViewOf(s, slow.map((a) => a.registration), teamPattern, (name) => accounts.get(regKey(name, teamPattern)) ?? null, now);
  return slow.map((a) => ({ ...a, ...live.get(a.registration)! }));
}

import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { callsign } from "./callsign.ts";
import { config } from "./config.ts";
import { type Snapshot, type Ticket, parentKeysOf } from "./model.ts";

// 2단계 DISPATCH: 어떤 FLIGHT를 어떤 AIRCRAFT에 보낼지 계산한다(순수 함수 planDispatch).
// 제안을 기록하고 보이는 것은 proposals.ts, 설계는 docs/dispatch.md.

export interface DispatchConfig {
  mode: "shadow" | "approval";
  // Linear 프로젝트 이름 → AIRPORT 코드. null이면 배정 제외. 목록에 없는 프로젝트도 제외.
  projectAirports: Record<string, string | null>;
  slots: {
    perTeam: number;
    airborne: Record<string, number>; // AIRPORT별 동시 AIRBORNE 한도
    defaultAirborne: number;
    openProposals: number; // 결정 안 된 ASSIGN 제안 최대 수
    openReleases: number;
  };
  weights: { priority: number; wait: number; unblock: number; affinity: number; conflict: number };
  releaseDays: number; // STAND 없이 이만큼 ENROUTE면 RELEASE 제안
  releaseStates: string[]; // RELEASE 대상 상태 이름
  excludeLabels: string[];
  teamPattern: string; // 배정 대상 세션 이름
}

export const DEFAULT_DISPATCH_CONFIG: DispatchConfig = {
  mode: "shadow",
  projectAirports: {
    "Beta Readiness": "VCDO",
    "Song Experience": "VCDO",
    "Vocado Pre-seed IR & Pitch Deck": null,
    "Vocado Visual System (SEED)": null,
  },
  slots: { perTeam: 1, airborne: { VCDO: 4 }, defaultAirborne: 2, openProposals: 5, openReleases: 5 },
  weights: { priority: 3, wait: 0.5, unblock: 2, affinity: 1, conflict: -2 },
  releaseDays: 3,
  releaseStates: ["In Progress"],
  excludeLabels: ["symphony-pilot"],
  teamPattern: "^TEAM[\\s_-]?[A-Z]$",
};

const CONFIG_FILE = join(config.stateDir, "dispatch.json");

// mode만 바꿔 저장한다. 사용자가 적어 둔 다른 설정은 그대로 둔다.
export function saveDispatchMode(mode: DispatchConfig["mode"], file = CONFIG_FILE) {
  let user: Record<string, unknown> = {};
  try {
    user = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...user, mode }, null, 2) + "\n");
  renameSync(tmp, file);
}

export function loadDispatchConfig(file = CONFIG_FILE): DispatchConfig {
  try {
    const user = JSON.parse(readFileSync(file, "utf8"));
    const d = DEFAULT_DISPATCH_CONFIG;
    return {
      ...d,
      ...user,
      projectAirports: { ...d.projectAirports, ...user.projectAirports },
      slots: { ...d.slots, ...user.slots, airborne: { ...d.slots.airborne, ...user.slots?.airborne } },
      weights: { ...d.weights, ...user.weights },
    };
  } catch {
    return DEFAULT_DISPATCH_CONFIG;
  }
}

export interface Factor {
  id: "priority" | "wait" | "unblock" | "affinity" | "conflict";
  label: string;
  value: number;
  weight: number;
  points: number;
  detail: string;
}

export interface AssignPlan {
  kind: "ASSIGN";
  flight: string;
  aircraft: string; // sessionId
  aircraftName: string;
  airport: string;
  score: number;
  factors: Factor[];
}

export interface ReleasePlan {
  kind: "RELEASE";
  flight: string;
  airport: string | null;
  days: number;
  score: number;
  factors: Factor[];
}

export interface AircraftState {
  id: string;
  name: string;
  callsign: string;
  airport: string | null;
  available: boolean;
  reason: string;
  reserved: string | null; // 이 AIRCRAFT로 진행 중인 제안 id(approved·sent·accepted)
}

// 진행 중인 제안이 잡고 있는 AIRCRAFT·FLIGHT → 제안 id. 새 계획에서 뺀다.
export interface Reserved {
  aircraft: Map<string, string>;
  flights: Map<string, string>;
  // FLIGHT key → HOLD 표시("D-0007 — 선행 FLIGHT 대기"). HELD는 AIRCRAFT를 잡지 않으므로 aircraft에는 없다.
  held?: Map<string, string>;
}
const NO_RESERVED: Reserved = { aircraft: new Map(), flights: new Map(), held: new Map() };

export interface Plan {
  at: string;
  assign: AssignPlan[];
  release: ReleasePlan[];
  hold: { flight: string; blockedBy: string[] }[];
  excluded: { flight: string; reason: string }[];
  aircraft: AircraftState[];
  slots: { airport: string; airborne: number; planned: number; limit: number }[];
}

const DAY = 86_400_000;
export const DONE_STATES = new Set(["completed", "canceled", "duplicate"]);
const PRIORITY_VALUE: Record<number, number> = { 0: 1.5, 1: 4, 2: 3, 3: 2, 4: 1 };
export const PRIORITY_NAME: Record<number, string> = { 0: "없음", 1: "Urgent", 2: "High", 3: "Medium", 4: "Low" };
const round1 = (x: number) => Math.round(x * 10) / 10;

// 과거 운항 이력: 세션 id → 그 세션이 STAND를 점유했던 FLIGHT key들
export type FlightHistory = Map<string, string[]>;

export function planDispatch(
  s: Snapshot,
  history: FlightHistory,
  cfg: DispatchConfig,
  now = Date.now(),
  reserved: Reserved = NO_RESERVED,
): Plan {
  const team = new RegExp(cfg.teamPattern, "i");
  const byKey = new Map(s.tickets.map((t) => [t.key, t]));
  const codeOf = (repo: string | null) => (repo ? (s.airports.find((a) => a.repo === repo)?.code ?? null) : null);
  const openAirports = new Set(s.airports.map((a) => a.code));
  const active = s.claims.filter((c) => c.state === "active");
  const wsTicket = new Map(s.workspaces.map((w) => [w.path, w.ticketKey]));
  const flightsWithStand = new Set(s.workspaces.map((w) => w.ticketKey).filter(Boolean) as string[]);
  const isDone = (key: string) => DONE_STATES.has(byKey.get(key)?.stateType ?? "");
  // 상위 이슈(하위 이슈를 묶는 컨테이너)는 그 자체로 작업 대상이 아니다.
  const parents = parentKeysOf(s.tickets);
  const childrenOf = (t: Ticket) => new Set([...t.children, ...s.tickets.filter((x) => x.parent === t.key).map((x) => x.key)]).size;
  const parentWhy = (t: Ticket) => `상위 이슈 — 하위 ${childrenOf(t)}건을 묶음`;

  // ── AIRCRAFT ──
  // 배정 가능: TEAM 세션, 대기(idle), 끝나지 않은 FLIGHT의 STAND를 쥐고 있지 않음(TEAM당 1)
  const aircraft: AircraftState[] = s.sessions
    .filter((x) => team.test(x.name) && x.status !== "dead")
    .map((x) => {
      const base = { id: x.id, name: x.name, callsign: callsign(x), airport: codeOf(x.repo), reserved: reserved.aircraft.get(x.id) ?? null };
      if (x.status === "busy") return { ...base, available: false, reason: "AIRBORNE" };
      const held = active.filter((c) => c.sessionId === x.id).map((c) => wsTicket.get(c.workspacePath));
      const open = held.filter((k) => !k || !isDone(k));
      if (open.length >= cfg.slots.perTeam) {
        return { ...base, available: false, reason: `HOLDING — ${open.map((k) => k ?? "티켓 없는 STAND").join(", ")} 진행 중` };
      }
      if (!base.airport) return { ...base, available: false, reason: "소속 AIRPORT 없음" };
      return { ...base, available: true, reason: held.length ? "HOLDING, 남은 FLIGHT 없음" : "PARKED" };
    });

  // ── FLIGHT ──
  const excluded: Plan["excluded"] = [];
  const hold: Plan["hold"] = [];
  const eligible: (Ticket & { airport: string })[] = [];
  for (const t of s.tickets) {
    if (t.stateType !== "unstarted") continue;
    if (parents.has(t.key)) {
      excluded.push({ flight: t.key, reason: parentWhy(t) });
      continue;
    }
    const label = t.labels.find((l) => cfg.excludeLabels.includes(l));
    if (label) {
      excluded.push({ flight: t.key, reason: `라벨 ${label} (다른 운항사)` });
      continue;
    }
    const airport = t.project ? cfg.projectAirports[t.project] : undefined;
    if (!airport) {
      excluded.push({ flight: t.key, reason: t.project ? `배정 제외 프로젝트: ${t.project}` : "프로젝트 없음" });
      continue;
    }
    if (!openAirports.has(airport)) {
      excluded.push({ flight: t.key, reason: `${airport} AIRPORT가 운항 중이 아님` });
      continue;
    }
    if (flightsWithStand.has(t.key)) {
      excluded.push({ flight: t.key, reason: "이미 STAND가 있음" });
      continue;
    }
    const held = reserved.flights.get(t.key);
    if (held) {
      const parked = reserved.held?.get(t.key);
      excluded.push({ flight: t.key, reason: parked ? `HOLD ${parked}` : `진행 중인 제안 ${held}` });
      continue;
    }
    // 우선순위가 비어 있으면 사람이 아직 언제 할지 정하지 않은 것이다
    if (!t.priority) {
      excluded.push({ flight: t.key, reason: "우선순위 없음 — 사람이 정할 때까지 배정하지 않음" });
      continue;
    }
    // 목록에 없는 선행 FLIGHT는 45일 창 밖(대개 끝난 것)이라 막지 않는 것으로 본다
    const blockers = t.blockedBy.filter((k) => byKey.has(k) && !isDone(k));
    if (blockers.length) {
      hold.push({ flight: t.key, blockedBy: blockers });
      continue;
    }
    eligible.push({ ...t, airport });
  }

  // ── 점수 ──
  const airborneFlights = new Set(
    active.filter((c) => s.sessions.find((x) => x.id === c.sessionId)?.status !== "dead").map((c) => wsTicket.get(c.workspacePath)).filter(Boolean) as string[],
  );
  const w = cfg.weights;
  const score = (t: Ticket, ac: AircraftState): { score: number; factors: Factor[] } => {
    const pv = PRIORITY_VALUE[t.priority] ?? 1.5;
    const waitDays = t.createdAt ? Math.min(14, Math.max(0, (now - Date.parse(t.createdAt)) / DAY)) : 0;
    const unblocks = t.blocks.filter((k) => byKey.get(k)?.stateType === "unstarted" || byKey.get(k)?.stateType === "backlog");
    const linked = new Set([...t.related, ...t.blocks, ...t.blockedBy]);
    const flown = (history.get(ac.id) ?? []).filter((k) => k !== t.key);
    const affinity = flown.filter((k) => linked.has(k) || (t.project && byKey.get(k)?.project === t.project));
    const conflicts = [...linked].filter((k) => airborneFlights.has(k));
    const f = (id: Factor["id"], label: string, value: number, weight: number, detail: string): Factor => ({
      id, label, value: round1(value), weight, points: round1(value * weight), detail,
    });
    const factors = [
      f("priority", "우선순위", pv, w.priority, PRIORITY_NAME[t.priority] ?? "없음"),
      f("wait", "대기 일수", waitDays, w.wait, `${round1(waitDays)}일`),
      f("unblock", "풀어 주는 FLIGHT", unblocks.length, w.unblock, unblocks.join(", ") || "없음"),
      f("affinity", "팀 적합도", affinity.length, w.affinity, affinity.join(", ") || "이력 없음"),
      f("conflict", "충돌 위험", conflicts.length, w.conflict, conflicts.length ? `AIRBORNE과 연결: ${conflicts.join(", ")}` : "없음"),
    ];
    return { score: round1(factors.reduce((a, x) => a + x.points, 0)), factors };
  };

  // ── 배정: 점수 높은 짝부터, AIRPORT 슬롯 안에서 ──
  const airborneAt = new Map<string, number>();
  for (const x of s.sessions) {
    const code = codeOf(x.repo);
    if (x.status === "busy" && team.test(x.name) && code) airborneAt.set(code, (airborneAt.get(code) ?? 0) + 1);
  }
  const limitOf = (code: string) => cfg.slots.airborne[code] ?? cfg.slots.defaultAirborne;
  const pairs = eligible
    .flatMap((t) => aircraft.filter((ac) => ac.available && !ac.reserved && ac.airport === t.airport).map((ac) => ({ t, ac, ...score(t, ac) })))
    .sort((a, b) => b.score - a.score || a.t.key.localeCompare(b.t.key) || a.ac.name.localeCompare(b.ac.name));
  const planned = new Map<string, number>();
  const usedFlights = new Set<string>();
  const usedAircraft = new Set<string>();
  const assign: AssignPlan[] = [];
  for (const p of pairs) {
    if (usedFlights.has(p.t.key) || usedAircraft.has(p.ac.id)) continue;
    const load = (airborneAt.get(p.t.airport) ?? 0) + (planned.get(p.t.airport) ?? 0);
    if (load >= limitOf(p.t.airport)) continue;
    usedFlights.add(p.t.key);
    usedAircraft.add(p.ac.id);
    planned.set(p.t.airport, (planned.get(p.t.airport) ?? 0) + 1);
    assign.push({ kind: "ASSIGN", flight: p.t.key, aircraft: p.ac.id, aircraftName: p.ac.name, airport: p.t.airport, score: p.score, factors: p.factors });
  }

  // ── RELEASE: STAND 없이 오래 ENROUTE ──
  // 코드 작업(AIRPORT에 매핑된 프로젝트)만 본다. 발표 자료처럼 STAND가 원래 없는 일은 방치가 아니다.
  // 컨테이너(상위 이슈)는 RELEASE 대상이 아니지만, 왜 빠졌는지 화면에서 보이게 남긴다.
  for (const t of s.tickets) {
    if (!parents.has(t.key) || t.stateType !== "started" || !cfg.releaseStates.includes(t.state)) continue;
    if (flightsWithStand.has(t.key) || !(t.project && cfg.projectAirports[t.project])) continue;
    excluded.push({ flight: t.key, reason: parentWhy(t) });
  }
  const release: ReleasePlan[] = s.tickets
    .filter((t) => t.stateType === "started" && cfg.releaseStates.includes(t.state) && !flightsWithStand.has(t.key))
    .filter((t) => !parents.has(t.key))
    .filter((t) => Boolean(t.project && cfg.projectAirports[t.project]))
    .map((t) => ({ t, days: (now - Date.parse(t.startedAt ?? t.updatedAt ?? new Date(now).toISOString())) / DAY }))
    .filter((x) => x.days >= cfg.releaseDays)
    .sort((a, b) => b.days - a.days)
    .map(({ t, days }) => ({
      kind: "RELEASE" as const,
      flight: t.key,
      airport: cfg.projectAirports[t.project!] ?? null,
      days: round1(days),
      score: round1(days),
      factors: [
        { id: "wait" as const, label: "STAND 없이 ENROUTE", value: round1(days), weight: 1, points: round1(days), detail: `${round1(days)}일 (기준 ${cfg.releaseDays}일)` },
      ],
    }));

  const slots = [...new Set([...openAirports].filter((c) => Object.values(cfg.projectAirports).includes(c)))].map((code) => ({
    airport: code,
    airborne: airborneAt.get(code) ?? 0,
    planned: planned.get(code) ?? 0,
    limit: limitOf(code),
  }));

  return { at: new Date(now).toISOString(), assign, release, hold, excluded, aircraft, slots };
}

// 청구 기록(~/.local/state/atc/claims)으로 세션별 과거 FLIGHT를 모은다. TTL과 상관없이 전부 본다.
export function readFlightHistory(teamKey = config.linearTeamKey, dir = join(config.stateDir, "claims")): FlightHistory {
  const re = new RegExp(`(?:^|[/_-])${teamKey.toLowerCase()}-?(\\d+)(?:$|[/_-])`, "i");
  const out: FlightHistory = new Map();
  let sessions: string[] = [];
  try {
    sessions = readdirSync(dir);
  } catch {
    return out;
  }
  for (const id of sessions) {
    const keys = new Set<string>();
    try {
      for (const f of readdirSync(join(dir, id))) {
        const m = basename(decodeURIComponent(f.replace(/\.json$/, ""))).match(re);
        if (m) keys.add(`${teamKey}-${Number(m[1])}`);
      }
    } catch {}
    if (keys.size) out.set(id, [...keys].sort());
  }
  return out;
}


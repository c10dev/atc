import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { callsign } from "./callsign.ts";
import { config } from "./config.ts";
import { accountOf, type Classification, canFly, classOf, DEFAULT_FLEET, type FleetFile, type FlightType, needsStand, profileOf, type Rating, WAKE_SLOTS } from "./crew.ts";
import { accountHoldDetail, accountHoldLabel, accountHoldOf, accountHolds, healthLabel } from "./health.ts";
import { DEFAULT_FUEL, type FuelConfig, fuelConfigOf, fuelHoldReason, fuelHolds } from "./fuel-remaining.ts";
import { keyInName, keyPatternOf, teamOfKey } from "./linear-keys.ts";
import type { LogEntry } from "./logbook.ts";
import { type Claim, type PullRequest, type Session, type Snapshot, type Ticket, type Workspace, parentKeysOf } from "./model.ts";
import { REASON_CODES } from "./reasons.ts";

// 2단계 DISPATCH: 어떤 FLIGHT를 어떤 AIRCRAFT에 보낼지 계산한다(순수 함수 planDispatch).
// 제안을 기록하고 보이는 것은 proposals.ts, 설계는 docs/dispatch.md.

export interface DispatchConfig {
  mode: "shadow" | "approval";
  // Linear 프로젝트 이름 → AIRPORT 코드. null이면 배정 제외. 목록에 없는 프로젝트는 팀의 기본 AIRPORT로, 그것도 없으면 제외.
  projectAirports: Record<string, string | null>;
  // Linear 팀 key → 기본 AIRPORT(프로젝트 매핑에 없는 이슈). 예: ATC → ATCC
  teamAirports: Record<string, string | null>;
  // DISPATCH·SCHEDULE 후보가 되는 Linear 팀. 비었으면 주 팀(LINEAR_TEAM_KEY)만. 나머지 팀은 보여 주기만(RADAR·FIDS·NETWORK)
  candidateTeams: string[];
  slots: {
    perTeam: number;
    airborne: Record<string, number>; // AIRPORT별 동시 AIRBORNE 한도
    defaultAirborne: number;
    openProposals: number; // 결정 안 된 ASSIGN 제안 최대 수
    openReleases: number;
  };
  weights: { priority: number; wait: number; unblock: number; affinity: number; conflict: number; route: number; waypoint: number };
  releaseDays: number; // STAND 없이 이만큼 ENROUTE면 RELEASE 제안
  releaseStates: string[]; // RELEASE 대상 상태 이름
  excludeLabels: string[];
  teamPattern: string; // 배정 대상 세션 이름
  // 외부 착륙 리뷰(ATC-30). security: 보안 규칙(라벨·경로·키워드)에만 걸린 PR을 DeepSeek REVIEW에 보낼까.
  // "exclude"(기본): 보내지 않음. "deepseek": 보냄(SUPERVISOR 결정 2026-09-27). 비밀·키 경로와 FLIGHT 없는 PR은 어느 쪽이든 보내지 않는다
  externalReview: { security: ExternalReviewSecurity };
  // FUEL REMAINING(ATC-55): INFO·HOLD 임계값(쓴 몫 %)과 DISPATCH HOLD 스위치(D3, 기본 꺼짐). SUPERVISOR만 설정 창에서 켠다
  fuel: FuelConfig;
}
export type ExternalReviewSecurity = "exclude" | "deepseek";
export const EXTERNAL_REVIEW_SECURITY: readonly ExternalReviewSecurity[] = ["exclude", "deepseek"];

export const DEFAULT_DISPATCH_CONFIG: DispatchConfig = {
  mode: "shadow",
  projectAirports: {
    "Beta Readiness": "VCDO",
    "Song Experience": "VCDO",
    "Vocado Pre-seed IR & Pitch Deck": null,
    "Vocado Visual System (SEED)": null,
  },
  teamAirports: { ATC: "ATCC" },
  candidateTeams: [],
  slots: { perTeam: 1, airborne: { VCDO: 4 }, defaultAirborne: 2, openProposals: 5, openReleases: 5 },
  weights: { priority: 3, wait: 0.5, unblock: 2, affinity: 1, conflict: -2, route: 1, waypoint: 1 },
  releaseDays: 3,
  releaseStates: ["In Progress"],
  excludeLabels: ["symphony-pilot"],
  teamPattern: "^TEAM[\\s_-]?[A-Z]$",
  externalReview: { security: "exclude" },
  fuel: DEFAULT_FUEL,
};

const CONFIG_FILE = join(config.stateDir, "dispatch.json");

// externalReview.security만 바꿔 저장한다(설정 창, ATC-30). 다른 설정은 그대로 둔다
export function saveExternalReviewSecurity(security: ExternalReviewSecurity, file = CONFIG_FILE) {
  let user: Record<string, unknown> = {};
  try {
    user = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const prev = (user.externalReview ?? {}) as Record<string, unknown>;
  writeFileSync(tmp, JSON.stringify({ ...user, externalReview: { ...prev, security } }, null, 2) + "\n");
  renameSync(tmp, file);
}

// fuel.hold만 바꿔 저장한다(설정 창, ATC-55). 임계값과 다른 설정은 그대로 둔다
export function saveFuelHold(hold: boolean, file = CONFIG_FILE) {
  let user: Record<string, unknown> = {};
  try {
    user = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const prev = (user.fuel ?? {}) as Record<string, unknown>;
  writeFileSync(tmp, JSON.stringify({ ...user, fuel: { ...prev, hold } }, null, 2) + "\n");
  renameSync(tmp, file);
}

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
      teamAirports: { ...d.teamAirports, ...user.teamAirports },
      candidateTeams: Array.isArray(user.candidateTeams) ? user.candidateTeams.map((k: unknown) => String(k).toUpperCase()) : d.candidateTeams,
      slots: { ...d.slots, ...user.slots, airborne: { ...d.slots.airborne, ...user.slots?.airborne } },
      weights: { ...d.weights, ...user.weights },
      // 모르는 값은 기본("exclude")으로 — 보안 PR을 잘못 내보내지 않게
      externalReview: { security: user.externalReview?.security === "deepseek" ? "deepseek" : "exclude" },
      // 모르는 값은 기본으로 — HOLD는 true일 때만 켠다
      fuel: fuelConfigOf(user.fuel),
    };
  } catch {
    return DEFAULT_DISPATCH_CONFIG;
  }
}

// DISPATCH·SCHEDULE 후보 팀(설정이 비었으면 주 팀만)
export function candidateTeamsOf(cfg: Pick<DispatchConfig, "candidateTeams">, primary = config.linearTeamKey): Set<string> {
  return new Set(cfg.candidateTeams.length ? cfg.candidateTeams : [primary]);
}
export const isCandidateTicket = (t: Pick<Ticket, "key">, teams: Set<string>) => teams.has(teamOfKey(t.key));

// FLIGHT의 AIRPORT: 프로젝트 매핑이 먼저(null이면 제외), 매핑에 없는 프로젝트·프로젝트 없음은 팀의 기본 AIRPORT
export function airportOfTicket(t: Pick<Ticket, "key" | "project">, cfg: Pick<DispatchConfig, "projectAirports" | "teamAirports">): string | null {
  if (t.project && t.project in cfg.projectAirports) return cfg.projectAirports[t.project];
  return cfg.teamAirports[teamOfKey(t.key)] ?? null;
}

export interface Factor {
  // standFree·independence는 0점짜리 표시(점수를 바꾸지 않고 왜 이 짝인지 보여 준다)
  id: "priority" | "wait" | "unblock" | "affinity" | "conflict" | "route" | "waypoint" | "standFree" | "independence";
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
  reserved: string | null; // 이 AIRCRAFT로 진행 중인 STAND가 필요한 제안 id(approved·sent·accepted)
  // STAND 없는 FLIGHT(SURVEY·CHECK)를 받을 수 있는 상태: HOLDING이나 PARKED(AIRBORNE·AOG·RETIRED 아님)
  resting?: boolean;
  reservedLight?: string | null; // 이 AIRCRAFT로 진행 중인 STAND 없는 제안 id
}

// 진행 중인 제안이 잡고 있는 AIRCRAFT·FLIGHT → 제안 id. 새 계획에서 뺀다.
export interface Reserved {
  aircraft: Map<string, string>;
  flights: Map<string, string>;
  // FLIGHT key → HOLD 표시("D-0007 — 선행 FLIGHT 대기"). HELD는 AIRCRAFT를 잡지 않으므로 aircraft에는 없다.
  held?: Map<string, string>;
  // AIRCRAFT → 진행 중인 ASSIGN의 FLIGHT들. aircraft는 한 대에 제안 하나만 담아서,
  // STAND 있는 FLIGHT와 없는 FLIGHT를 함께 쥔 AIRCRAFT를 가르려면 이것이 필요하다.
  aircraftFlights?: Map<string, string[]>;
  // "FLIGHT|AIRCRAFT id" → 24시간 안에 제안됐다 닫힌 짝(거절·SUPERSEDED·EXPIRED·RECALLED …)과 다시 가능해지는 시각.
  // syncOps가 이 짝을 다시 제안하지 않으므로 계획에서도 빼야 AIRCRAFT가 다음으로 좋은 FLIGHT를 받는다.
  recentPairs?: Map<string, { id: string; until: string }>;
  // FLIGHT key → FLIGHT 자체의 문제로 거절된 제안(사유 칩이 FLIGHT_HOLD_CODES 중 하나). 모든 AIRCRAFT에서 뺀다.
  // decidedAt 뒤에 Linear 이슈가 바뀌거나(updatedAt) until(판정 + 24시간)이 지나면 풀린다 — 이슈 쪽은 planner가 본다
  recentFlights?: Map<string, { id: string; decidedAt: string; until: string; codes: string[] }>;
  // FLIGHT key → 최근 ARRIVED한 STAND 없는 FLIGHT의 제안 id. LOGBOOK에 남지 않아 여기서 뺀다(Linear가 아직 Todo여도)
  arrived?: Map<string, string>;
}
const NO_RESERVED: Reserved = { aircraft: new Map(), flights: new Map(), held: new Map() };

// 이 AIRCRAFT가 지금 그 FLIGHT를 받을 수 있는 상태인가(예약은 따로 본다).
// STAND가 필요한 FLIGHT는 배정 가능(available)일 때만, STAND 없는 FLIGHT(SURVEY·CHECK)는 HOLDING이어도 된다.
// planner와 syncOps(승인된 제안이 아직 유효한가)가 같은 규칙을 쓴다.
export function canTakeNow(ac: Pick<AircraftState, "available" | "resting">, t: Pick<Ticket, "labels"> | undefined): boolean {
  if (ac.available) return true;
  return Boolean(ac.resting && t && !needsStand(classOf(t.labels).type));
}

export interface Plan {
  at: string;
  assign: AssignPlan[];
  release: ReleasePlan[];
  hold: { flight: string; blockedBy: string[] }[];
  excluded: { flight: string; reason: string }[];
  // 24시간 규칙으로 후보에서 뺀 짝(FLIGHT·AIRCRAFT·제안 id·다시 가능한 시각)
  blockedPairs?: { flight: string; aircraft: string; aircraftName: string; proposal: string; until: string }[];
  aircraft: AircraftState[];
  slots: { airport: string; airborne: number; planned: number; limit: number }[];
  // 받을 AIRCRAFT가 없어 남은 FLIGHT(FLEET PLAN 수요, docs/fleet.md 8.6). AIRPORT 슬롯이 차서 남은 것은 넣지 않는다
  unserved?: Unserved[];
}

// no-aircraft: 자격 있는 AIRCRAFT가 모두 바쁘거나 다른 FLIGHT를 받음, unqualified: 살아 있는 AIRCRAFT 중 자격을 가진 것이 없음,
// no-tail: tail로 정한 팀의 세션이 없음. labeled: 분류 라벨이 있어 ratings·type이 라벨에서 왔나
export interface Unserved {
  flight: string;
  airport: string;
  type: FlightType;
  ratings: Rating[];
  labeled: boolean;
  why: "no-aircraft" | "unqualified" | "no-tail";
  tails: string[];
}

const DAY = 86_400_000;
export const DONE_STATES = new Set(["completed", "canceled", "duplicate"]);

// ASSIGN 후보에서 빠지는 이유. planner와 syncOps(SUPERSEDED 사유)가 같은 문구를 쓰도록 한 곳에 둔다.
// 갈라지면 화면의 SUPERSEDED 사유가 실제 이유와 달라진다.
export const NO_PRIORITY_WHY = "우선순위 없음 — 사람이 정할 때까지 배정하지 않음";
export const hasStandWhy = () => "이미 STAND가 있음";
export const stateChangedWhy = (state: string) => `FLIGHT 상태가 바뀜(${state})`;
export const noProjectWhy = (project: string | null) => (project ? `배정 제외 프로젝트: ${project}` : "프로젝트 없음");
export const excludedLabelWhy = (label: string) => `라벨 ${label} (다른 운항사)`;
// Linear에서 다른 사람이나 agent(Codex 등)가 맡은 FLIGHT. 같은 일을 TEAM에 또 주지 않는다
export const takenWhy = (by: string) => `Linear 담당 ${by} — atc 밖에서 맡음`;
// 판정 대기 중인 제안이 다른 배정으로 바뀔 때의 사유 첫머리. 이 사유로 닫힌 짝은 판정받지 못한 것이라 24시간 규칙에서 뺀다
export const BETTER_WHY = "더 나은 배정으로 바뀜";
// 로컬 시각 "MM-DD HH:MM"
const localStamp = (iso: string) => {
  const d = new Date(iso);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
};
export const pairBlockedWhy = (id: string, until: string) => `24시간 안에 제안된 짝(${id}) — ${localStamp(until)}부터 다시`;
// 거절 사유가 FLIGHT 자체의 문제인 칩. 이 중 하나라도 있으면 그 짝이 아니라 FLIGHT 전체를 보류한다.
// wrong-aircraft(그 AIRCRAFT만의 문제)와 other, 칩 없음은 짝만 24시간 막는다.
export const FLIGHT_HOLD_CODES = ["already-done", "parent-issue", "waiting-on-prior", "needs-human", "no-priority", "out-of-repo"] as const;
const chipLabel = (code: string) => REASON_CODES.find((r) => r.code === code)?.label ?? code;
export const flightHeldWhy = (id: string, codes: string[], until: string) =>
  `FLIGHT 보류 — ${codes.map(chipLabel).join(" · ")} (${id} 판정) — 이슈가 바뀌거나 ${localStamp(until)}부터 다시`;
export const landedWhy = (pr: string) => `이미 완료됨 — PR ${pr} 머지됨(LOGBOOK)`;
export const openPrWhy = (n: number) => `열린 PR #${n} 있음`;
export const arrivedWhy = (id: string) => `이미 완료됨 — ${id} ARRIVED(CAPTAIN 보고)`;

// LOGBOOK에서 ARRIVED한 FLIGHT → 머지된 PR("repo#N", 저장소 이름만). 되돌린 PR은 빼서 다시 후보가 된다.
export type Landed = Map<string, string>;
export function landedOf(entries: Pick<LogEntry, "flight" | "reverted" | "pr">[]): Landed {
  const out: Landed = new Map();
  for (const e of entries) {
    if (!e.flight || e.reverted || out.has(e.flight)) continue;
    out.set(e.flight, `${e.pr.repo.split("/").pop()}#${e.pr.number}`);
  }
  return out;
}

// 이미 끝났거나 누가 작업 중인 FLIGHT: LOGBOOK ARRIVED(Linear가 아직 Todo여도), 또는 그 FLIGHT의 열린 PR(Draft 포함).
// planner와 syncOps가 같은 문구를 쓴다.
export function workedWhy(flight: string, landed: Landed, pulls: Pick<PullRequest, "ticketKey" | "number">[]): string | null {
  const pr = landed.get(flight);
  if (pr) return landedWhy(pr);
  const open = pulls.find((p) => p.ticketKey === flight);
  return open ? openPrWhy(open.number) : null;
}

// 거절 사유 칩(reasons.ts)마다 지금 planner가 그 사유를 스스로 거르나. 거절 사유 집계(reasonStats)에 붙인다.
// auto: 규칙으로 거름, partial: 일부만 거름, manual: 사람만 안다.
// scope: 이 칩으로 거절하면 무엇을 막나(flight: FLIGHT 전체를 24시간·이슈가 바뀔 때까지, pair: 그 짝만 24시간).
const HELD = " · 거절하면 FLIGHT 전체 보류(24시간, 이슈가 바뀌면 그 전에 풀림)";
export const REASON_FILTERS: Record<string, { auto: "auto" | "partial" | "manual"; how: string; scope: "flight" | "pair" }> = {
  "already-done": { auto: "auto", how: "LOGBOOK ARRIVED·열린 PR 규칙, STAND 없는 FLIGHT의 ARRIVED 보고, Linear Done 상태" + HELD, scope: "flight" },
  "parent-issue": { auto: "auto", how: "상위 이슈 규칙(Linear children·parent)" + HELD, scope: "flight" },
  "waiting-on-prior": { auto: "partial", how: "Linear blockedBy는 HOLD, 다른 PR 머지 대기는 OCC HOLD" + HELD, scope: "flight" },
  "needs-human": { auto: "partial", how: "본문의 \"사용자가 정한다\"류 문구는 OCC HOLD" + HELD, scope: "flight" },
  "no-priority": { auto: "auto", how: "우선순위 없음 규칙" + HELD, scope: "flight" },
  "out-of-repo": { auto: "partial", how: "프로젝트 → AIRPORT 매핑(프로젝트 단위만)" + HELD, scope: "flight" },
  "wrong-aircraft": { auto: "partial", how: "TYPE RATING·CREW·tail 규칙 · 거절하면 그 짝만 24시간", scope: "pair" },
  other: { auto: "manual", how: "— · 거절하면 그 짝만 24시간", scope: "pair" },
};

// TAIL ASSIGNMENT(`tail:TEAM_X` 라벨, docs/fleet.md): 사람(또는 OCC)이 그 FLIGHT를 맡을 AIRCRAFT를 정해 둔 것.
// 있으면 그 팀에만 제안한다. 두 배정자(사람의 직접 배정과 DISPATCH)가 같은 FLIGHT를 다른 팀에 주는 일을 막는다.
// `lane:`은 옛 이름이라 2026-10-10(KST) 전까지 같이 읽고, 제외 사유에 바꾸라고 적는다.
// 그날부터는 읽지 않는다: `lane:`만 붙은 FLIGHT는 아무 팀에도 주지 않고 제외 사유로 알린다(oldLaneOnly).
export const LANE_CUTOFF = Date.parse("2026-10-10T00:00:00+09:00");
const TAIL_LABEL = /^(tail|lane):\s*(\S+)$/i;
const TAIL_ONLY = /^(tail):\s*(\S+)$/i;
export function tailsOf(t: Pick<Ticket, "labels">, now = Date.now()): Set<string> {
  const re = now < LANE_CUTOFF ? TAIL_LABEL : TAIL_ONLY;
  return new Set(t.labels.map((l) => re.exec(l.trim())?.[2]?.toUpperCase()).filter(Boolean) as string[]);
}
const usesOldLane = (t: Pick<Ticket, "labels">) => t.labels.some((l) => /^lane:/i.test(l.trim()));
// 끊긴 뒤 남은 `lane:` 라벨(tail:이 없을 때만): 제외 사유 문구, 없으면 null
export function oldLaneOnly(t: Pick<Ticket, "labels">, now: number): string | null {
  if (now < LANE_CUTOFF || tailsOf(t, now).size) return null;
  const lanes = t.labels.map((l) => /^lane:\s*(\S+)$/i.exec(l.trim())?.[1]?.toUpperCase()).filter(Boolean);
  return lanes.length ? `옛 lane:${lanes.join(", lane:")} 라벨은 2026-10-10부터 읽지 않음 — tail:${lanes.join(", tail:")}로 바꿀 것` : null;
}
const PRIORITY_VALUE: Record<number, number> = { 0: 1.5, 1: 4, 2: 3, 3: 2, 4: 1 };
export const PRIORITY_NAME: Record<number, string> = { 0: "없음", 1: "Urgent", 2: "High", 3: "Medium", 4: "Low" };
const round1 = (x: number) => Math.round(x * 10) / 10;
// 점수에 들어가지 않는 표시(weight 0). 왜 이 짝인지 카드에 보이게 한다.
const mark = (id: Factor["id"], label: string, value: number, detail: string): Factor => ({ id, label, value, weight: 0, points: 0, detail });

// 과거 운항 이력: 세션 id → 그 세션이 STAND를 점유했던 FLIGHT key들
export type FlightHistory = Map<string, string[]>;

// ── CHECK 독립성(docs/fleet.md 4.1): CHECK는 그것이 검토하는 것을 만든 AIRCRAFT에 주지 않는다 ──

// CHECK가 검토하는 대상: Linear 관계(blockedBy·related·blocks·parent)의 FLIGHT, 제목에 적힌 FLIGHT key와 PR 번호.
// 본문은 스냅샷에 없어 읽지 않는다.
export interface CheckTarget {
  flights: string[];
  prs: number[];
}
export function checkTargetOf(t: Pick<Ticket, "key" | "title" | "blockedBy" | "related" | "blocks" | "parent">): CheckTarget {
  const prefix = t.key.split("-")[0].replace(/[^A-Za-z0-9]/g, "");
  const inTitle = prefix ? [...t.title.matchAll(new RegExp(`\\b${prefix}-(\\d+)\\b`, "gi"))].map((m) => `${prefix.toUpperCase()}-${Number(m[1])}`) : [];
  const flights = new Set([...t.blockedBy, ...t.related, ...t.blocks, ...(t.parent ? [t.parent] : []), ...inTitle]);
  flights.delete(t.key);
  const prs = new Set([...t.title.matchAll(/(?:\bPR\s*#?\s*|#|\/pull\/)(\d+)\b/gi)].map((m) => Number(m[1])));
  return { flights: [...flights].sort(), prs: [...prs].sort((a, b) => a - b) };
}

export interface BuilderSources {
  logbook: Pick<LogEntry, "flight" | "aircraft" | "airport" | "pr">[];
  pulls: Pick<PullRequest, "number" | "repo" | "ticketKey" | "standPath">[];
  claims: Pick<Claim, "sessionId" | "workspacePath">[]; // 넘겨준(handed-off) 점유도 만든 팀의 근거다
  workspaces: Pick<Workspace, "path" | "ticketKey">[];
  sessions: Pick<Session, "id" | "name">[];
  history: FlightHistory; // 청구 기록(세션 → FLIGHT)
  team: RegExp; // TEAM 세션 이름
}

// 대상을 만든 AIRCRAFT(REGISTRATION 대문자) → 근거. LOGBOOK(ARRIVED한 FLIGHT·PR), 열린 PR의 STAND를 점유한 세션,
// 그 FLIGHT의 STAND(워크트리)를 점유한 세션, 청구 기록. PR 번호는 CHECK의 AIRPORT 저장소 안에서만 맞춘다.
export function checkBuildersOf(target: CheckTarget, airport: { code: string; repo: string | null }, src: BuilderSources): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (name: string | null | undefined, why: string) => {
    if (!name || !src.team.test(name)) return;
    const reg = name.toUpperCase();
    const list = out.get(reg) ?? [];
    if (!list.includes(why)) list.push(why);
    out.set(reg, list);
  };
  const nameOf = new Map(src.sessions.map((x) => [x.id, x.name]));
  const standHolders = (path: string | null, why: string) => {
    if (!path) return;
    for (const c of src.claims) if (c.workspacePath === path) add(nameOf.get(c.sessionId), why);
  };
  const flights = new Set(target.flights);
  for (const n of target.prs) {
    for (const e of src.logbook) if (e.pr.number === n && e.airport === airport.code) add(e.aircraft, `PR #${n} LOGBOOK`);
    for (const p of src.pulls) {
      if (p.number !== n || p.repo !== airport.repo) continue;
      standHolders(p.standPath, `PR #${n} STAND`);
      if (p.ticketKey) flights.add(p.ticketKey);
    }
  }
  for (const f of flights) {
    for (const e of src.logbook) if (e.flight === f) add(e.aircraft, `${f} LOGBOOK`);
    for (const p of src.pulls) if (p.ticketKey === f) standHolders(p.standPath, `${f} PR #${p.number} STAND`);
    for (const w of src.workspaces) if (w.ticketKey === f) standHolders(w.path, `${f} STAND`);
    for (const [id, keys] of src.history) if (keys.includes(f)) add(nameOf.get(id), `${f} 청구 기록`);
  }
  return out;
}

export interface Independence {
  target: CheckTarget;
  builders: Map<string, string[]>;
}
// CHECK 짝에 붙는 0점 표시. 만든 팀을 모르면 막지 않고, 확인하지 못했다고 적는다.
export function independenceDetail(ind: Independence): string {
  const t = ind.target;
  const what = [...t.flights, ...t.prs.map((n) => `PR #${n}`)].join(", ");
  if (!what) return "확인 못 함 — 검토 대상을 찾지 못함(관계·제목에 FLIGHT·PR 없음)";
  if (!ind.builders.size) return `확인 못 함 — ${what}을 만든 AIRCRAFT를 모름`;
  const by = [...ind.builders].map(([n, why]) => `${n}(${why.join(", ")})`).join(", ");
  return `대상 ${what} — 만든 ${by} 제외`;
}

export function planDispatch(
  s: Snapshot,
  history: FlightHistory,
  cfg: DispatchConfig,
  now = Date.now(),
  reserved: Reserved = NO_RESERVED,
  fleet: FleetFile = DEFAULT_FLEET,
  landed: Landed = new Map(),
  logbook: BuilderSources["logbook"] = [], // CHECK 독립성: 검토 대상을 만든 AIRCRAFT
  activeWaypoint: Map<string, string> = new Map(), // FLIGHT key → 지금 구간 WAYPOINT(routes.ts activeWaypointsOf, 8단계)
): Plan {
  const team = new RegExp(cfg.teamPattern, "i");
  const byKey = new Map(s.tickets.map((t) => [t.key, t]));
  const codeOf = (repo: string | null) => (repo ? (s.airports.find((a) => a.repo === repo)?.code ?? null) : null);
  const openAirports = new Set(s.airports.map((a) => a.code));
  const candidates = candidateTeamsOf(cfg);
  const active = s.claims.filter((c) => c.state === "active");
  const wsTicket = new Map(s.workspaces.map((w) => [w.path, w.ticketKey]));
  const flightsWithStand = new Set(s.workspaces.map((w) => w.ticketKey).filter(Boolean) as string[]);
  const isDone = (key: string) => DONE_STATES.has(byKey.get(key)?.stateType ?? "");
  // 상위 이슈(하위 이슈를 묶는 컨테이너)는 그 자체로 작업 대상이 아니다.
  const parents = parentKeysOf(s.tickets);
  const childrenOf = (t: Ticket) => new Set([...t.children, ...s.tickets.filter((x) => x.parent === t.key).map((x) => x.key)]).size;
  const parentWhy = (t: Ticket) => `상위 이슈 — 하위 ${childrenOf(t)}건을 묶음`;

  // ── AIRCRAFT ──
  // 진행 중인 제안을 STAND가 필요한 것과 없는 것(SURVEY·CHECK)으로 가른다. 모르는 FLIGHT는 STAND가 필요한 쪽으로 본다.
  const standFree = (k: string) => Boolean(byKey.get(k)) && !needsStand(classOf(byKey.get(k)!.labels).type);
  const inFlightOf = (id: string): string[] => {
    const listed = reserved.aircraftFlights?.get(id);
    if (listed) return listed;
    const pid = reserved.aircraft.get(id);
    return pid ? [...reserved.flights].filter(([, v]) => v === pid).map(([k]) => k) : [];
  };
  const reservationsOf = (id: string) => {
    const flights = inFlightOf(id);
    const light = flights.find(standFree);
    const stand = flights.find((k) => !standFree(k));
    return {
      reserved: stand ? (reserved.flights.get(stand) ?? reserved.aircraft.get(id) ?? null) : flights.length ? null : (reserved.aircraft.get(id) ?? null),
      reservedLight: light ? (reserved.flights.get(light) ?? null) : null,
    };
  };
  // 배정 가능: TEAM 세션, 대기(idle), 끝나지 않은 FLIGHT의 STAND를 쥐고 있지 않음(TEAM당 1)
  // resting: STAND 없는 FLIGHT는 받을 수 있는 상태(HOLDING이나 PARKED). AIRBORNE·AOG·RETIRED는 아니다.
  // ACCOUNT HOLD(ATC-51): 한 AIRCRAFT의 LIMIT이 같은 ACCOUNT의 AIRCRAFT 모두를 reset까지 붙든다
  const teamSessions = s.sessions.filter((x) => team.test(x.name) && x.status !== "dead");
  const holds = accountHolds(teamSessions.map((x) => ({ name: x.name, account: accountOf(fleet, x.name), health: x.health })), now);
  const aircraft: AircraftState[] = teamSessions
    .map((x) => {
      const base = { id: x.id, name: x.name, callsign: callsign(x), airport: codeOf(x.repo), ...reservationsOf(x.id), resting: false };
      // FLEET에서 퇴역시키거나 AOG(잠시 운항 중지)로 둔 AIRCRAFT는 배정하지 않는다
      const status = profileOf(fleet, x.name);
      if (status.retired) return { ...base, available: false, reason: "RETIRED" };
      if (status.aog) return { ...base, available: false, reason: `AOG — ${status.aog.reason}${status.aog.until ? ` (~${status.aog.until})` : ""}` };
      // AIRCRAFT health(ATC-45): 사용 한도·모델·맥락·경로 문제나 HUNG이면 풀릴 때까지 배정하지 않는다
      if (x.health?.holds) return { ...base, available: false, reason: `${healthLabel(x.health, now)} — ${x.health.detail}` };
      const acct = accountHoldOf(holds, accountOf(fleet, x.name), x.name);
      if (acct) return { ...base, available: false, reason: `${accountHoldLabel(acct, now)} — ${accountHoldDetail(acct)}` };
      // FUEL HOLD(ATC-55, D3): SUPERVISOR 스위치가 켜져 있고 그 ACCOUNT가 holdPct 이상 썼으면 reset까지 배정하지 않는다
      const fuel = s.fuel?.[x.name.toUpperCase()];
      if (fuel && fuelHolds(fuel, cfg.fuel ?? DEFAULT_FUEL)) return { ...base, available: false, reason: fuelHoldReason(fuel, now) };
      if (x.status === "busy") return { ...base, available: false, reason: "AIRBORNE" };
      const held = active.filter((c) => c.sessionId === x.id).map((c) => wsTicket.get(c.workspacePath));
      const open = held.filter((k) => !k || !isDone(k));
      if (open.length >= cfg.slots.perTeam) {
        return { ...base, resting: true, available: false, reason: `HOLDING — ${open.map((k) => k ?? "AD HOC STAND").join(", ")} 진행 중` };
      }
      if (!base.airport) return { ...base, available: false, reason: "소속 AIRPORT 없음" };
      return { ...base, resting: true, available: true, reason: held.length ? "HOLDING, 남은 FLIGHT 없음" : "PARKED" };
    });

  // ── FLIGHT ──
  const excluded: Plan["excluded"] = [];
  const hold: Plan["hold"] = [];
  const unserved: Unserved[] = [];
  const unservedOf = (t: Ticket, airport: string, cls: Classification, why: Unserved["why"], tails: Set<string> = new Set()): Unserved => ({
    flight: t.key, airport, type: cls.type, ratings: cls.ratings, labeled: cls.sources.length > 0, why, tails: [...tails],
  });
  const eligible: (Ticket & { airport: string; cls: Classification; ind: Independence | null })[] = [];
  // FLEET 규칙(docs/fleet.md 5장): 필요한 TYPE RATING을 모두 가졌고, CREW가 그 FLIGHT TYPE을 날 수 있어야 한다.
  const qualifies = (ac: AircraftState, cls: Classification) => {
    const p = profileOf(fleet, ac.name);
    return cls.ratings.every((r) => p.ratings.includes(r)) && canFly(p.complement, cls.type);
  };
  const unqualifiedWhy = (pool: AircraftState[], cls: Classification) => {
    const need = cls.ratings.map((r) => `rating:${r}`).join("+");
    const rated = pool.filter((ac) => cls.ratings.every((r) => profileOf(fleet, ac.name).ratings.includes(r)));
    if (cls.ratings.length && !rated.length) return `${need} — 그 TYPE RATING을 가진 AIRCRAFT 없음 (FLEET 탭에서 지정)`;
    return `type:${cls.type} — 그 일을 날 수 있는 CREW 없음 (FLEET 탭의 CREW COMPLEMENT)`;
  };
  // 지금 이 FLIGHT를 받을 수 있나(예약 포함). STAND 없는 FLIGHT는 HOLDING·PARKED 팀이 STAND 규칙 밖으로 하나씩 받는다.
  const canTake = (ac: AircraftState, t: { airport: string; cls: Classification }) =>
    ac.airport === t.airport && (needsStand(t.cls.type) ? ac.available && !ac.reserved : Boolean(ac.resting) && !ac.reservedLight);
  const builderSrc: BuilderSources = { logbook, pulls: s.pulls ?? [], claims: s.claims, workspaces: s.workspaces, sessions: s.sessions, history, team };
  const independenceOf = (t: Ticket, airport: string): Independence => {
    const target = checkTargetOf(t);
    return { target, builders: checkBuildersOf(target, { code: airport, repo: s.airports.find((a) => a.code === airport)?.repo ?? null }, builderSrc) };
  };
  const independent = (ac: AircraftState, ind: Independence | null) => !ind || !ind.builders.has(ac.name.toUpperCase());
  const notIndependentWhy = (ind: Independence) =>
    `CHECK 독립성 — 검토 대상을 만든 ${[...ind.builders.keys()].join(", ")} 말고 이 CHECK를 날 AIRCRAFT 없음 (${independenceDetail(ind)})`;
  for (const t of s.tickets) {
    if (t.stateType !== "unstarted") continue;
    if (!isCandidateTicket(t, candidates)) continue; // 보여 주기만 하는 팀(설정 candidateTeams)
    if (parents.has(t.key)) {
      excluded.push({ flight: t.key, reason: parentWhy(t) });
      continue;
    }
    const label = t.labels.find((l) => cfg.excludeLabels.includes(l));
    if (label) {
      excluded.push({ flight: t.key, reason: excludedLabelWhy(label) });
      continue;
    }
    if (t.takenBy) {
      excluded.push({ flight: t.key, reason: takenWhy(t.takenBy) });
      continue;
    }
    const airport = airportOfTicket(t, cfg);
    if (!airport) {
      excluded.push({ flight: t.key, reason: noProjectWhy(t.project) });
      continue;
    }
    if (!openAirports.has(airport)) {
      excluded.push({ flight: t.key, reason: `${airport} AIRPORT가 운항 중이 아님` });
      continue;
    }
    // 진행 중인 제안보다 먼저 본다: 제안이 이 사유로 SUPERSEDED될 때 화면에 이 이유가 보이게
    const worked = workedWhy(t.key, landed, s.pulls ?? []);
    if (worked) {
      excluded.push({ flight: t.key, reason: worked });
      continue;
    }
    const arrived = reserved.arrived?.get(t.key);
    if (arrived) {
      excluded.push({ flight: t.key, reason: arrivedWhy(arrived) });
      continue;
    }
    // FLIGHT 자체의 문제로 최근 거절됨: 모든 AIRCRAFT에서 뺀다. 판정 뒤 이슈가 바뀌었으면 다시 후보
    const heldBy = reserved.recentFlights?.get(t.key);
    if (heldBy && Date.parse(heldBy.until) > now && !(t.updatedAt && Date.parse(t.updatedAt) > Date.parse(heldBy.decidedAt))) {
      excluded.push({ flight: t.key, reason: flightHeldWhy(heldBy.id, heldBy.codes, heldBy.until) });
      continue;
    }
    if (flightsWithStand.has(t.key)) {
      excluded.push({ flight: t.key, reason: hasStandWhy() });
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
      excluded.push({ flight: t.key, reason: NO_PRIORITY_WHY });
      continue;
    }
    // 목록에 없는 선행 FLIGHT는 45일 창 밖(대개 끝난 것)이라 막지 않는 것으로 본다
    const blockers = t.blockedBy.filter((k) => byKey.has(k) && !isDone(k));
    if (blockers.length) {
      hold.push({ flight: t.key, blockedBy: blockers });
      continue;
    }
    const cls = classOf(t.labels);
    if (cls.wake === "J") {
      excluded.push({ flight: t.key, reason: "wake:J — 너무 커서 배정하지 않음, 나눠야 함(SPLIT)" });
      continue;
    }
    const ind = cls.type === "CHECK" ? independenceOf(t, airport) : null;
    const lane = oldLaneOnly(t, now);
    if (lane) {
      excluded.push({ flight: t.key, reason: lane });
      continue;
    }
    const tails = tailsOf(t, now);
    if (tails.size) {
      const tailTag = [...tails].map((n) => `tail:${n}`).join(", ") + (usesOldLane(t) ? " (옛 lane: 라벨 — tail:로 바꿀 것)" : "");
      const mine = aircraft.filter((ac) => tails.has(ac.name.toUpperCase()));
      if (!mine.length) {
        excluded.push({ flight: t.key, reason: `${tailTag} — 그 TEAM 세션이 없음` });
        unserved.push(unservedOf(t, airport, cls, "no-tail", tails));
        continue;
      }
      if (!mine.some((ac) => qualifies(ac, cls))) {
        excluded.push({ flight: t.key, reason: `${tailTag} — ${unqualifiedWhy(mine, cls)}` });
        unserved.push(unservedOf(t, airport, cls, "unqualified", tails));
        continue;
      }
      if (ind && !mine.some((ac) => qualifies(ac, cls) && independent(ac, ind))) {
        excluded.push({ flight: t.key, reason: `${tailTag} — ${notIndependentWhy(ind)}` });
        continue;
      }
      if (!mine.some((ac) => canTake(ac, { airport, cls }))) {
        const light = !needsStand(cls.type);
        const stateOf = (ac: AircraftState) =>
          light
            ? !ac.resting ? ac.reason : ac.reservedLight ? `진행 중인 제안 ${ac.reservedLight}` : `소속 AIRPORT ${ac.airport ?? "없음"}`
            : !ac.available ? ac.reason : ac.reserved ? `진행 중인 제안 ${ac.reserved}` : `소속 AIRPORT ${ac.airport ?? "없음"}`;
        const why = mine.map((ac) => `${ac.name} ${stateOf(ac)}`).join(", ");
        excluded.push({ flight: t.key, reason: `${tailTag} — 지정 팀 배정 불가(${why})` });
        continue;
      }
    } else if (aircraft.length && !aircraft.some((ac) => qualifies(ac, cls))) {
      excluded.push({ flight: t.key, reason: unqualifiedWhy(aircraft, cls) });
      unserved.push(unservedOf(t, airport, cls, "unqualified"));
      continue;
    } else if (ind && aircraft.length && !aircraft.some((ac) => qualifies(ac, cls) && independent(ac, ind))) {
      excluded.push({ flight: t.key, reason: notIndependentWhy(ind) });
      continue;
    }
    eligible.push({ ...t, airport, cls, ind });
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
    const onRoute = Boolean(t.project && profileOf(fleet, ac.name).routes.includes(t.project));
    const f = (id: Factor["id"], label: string, value: number, weight: number, detail: string): Factor => ({
      id, label, value: round1(value), weight, points: round1(value * weight), detail,
    });
    const factors = [
      f("priority", "우선순위", pv, w.priority, PRIORITY_NAME[t.priority] ?? "없음"),
      f("wait", "대기 일수", waitDays, w.wait, `${round1(waitDays)}일`),
      f("unblock", "풀어 주는 FLIGHT", unblocks.length, w.unblock, unblocks.join(", ") || "없음"),
      f("affinity", "팀 적합도", affinity.length, w.affinity, affinity.join(", ") || "이력 없음"),
      f("conflict", "충돌 위험", conflicts.length, w.conflict, conflicts.length ? `AIRBORNE과 연결: ${conflicts.join(", ")}` : "없음"),
      f("route", "ROUTE", onRoute ? 1 : 0, w.route ?? 1, onRoute ? `${t.project} 담당` : "담당 아님"),
      // 지금 구간 WAYPOINT의 FLIGHT: ROUTE를 앞으로 미는 일(docs/routes.md 8단계)
      f("waypoint", "지금 WAYPOINT", activeWaypoint.has(t.key) ? 1 : 0, w.waypoint ?? 1, activeWaypoint.get(t.key) ?? "아님"),
    ];
    return { score: round1(factors.reduce((a, x) => a + x.points, 0)), factors };
  };

  // ── 배정: 점수 높은 짝부터, AIRPORT 슬롯 안에서 ──
  // AIRPORT 슬롯은 WAKE CATEGORY로 센다(L 0.5, M 1, H 2). AIRBORNE 팀은 쥐고 있는 FLIGHT 중 가장 큰 WAKE, 모르면 1.
  const wakeOfKey = (k: string | null | undefined) => (k && byKey.get(k) ? WAKE_SLOTS[classOf(byKey.get(k)!.labels).wake] : 1);
  const airborneAt = new Map<string, number>();
  for (const x of s.sessions) {
    const code = codeOf(x.repo);
    if (x.status !== "busy" || !team.test(x.name) || !code) continue;
    const keys = active.filter((c) => c.sessionId === x.id).map((c) => wsTicket.get(c.workspacePath));
    const load = keys.length ? Math.max(...keys.map(wakeOfKey)) : 1;
    airborneAt.set(code, (airborneAt.get(code) ?? 0) + (Number.isFinite(load) ? load : 1));
  }
  // 켜진 GROUND DELAY(CI 혼잡, ATC-62)는 그 AIRPORT의 AIRBORNE 슬롯을 하나 줄인다
  const delayed = new Set((s.atfm?.groundStops ?? []).filter((g) => g.enforced && g.kind === "delay").map((g) => g.airport)); // atfm.ts delayedAirports와 같다
  const limitOf = (code: string) => Math.max(0, (cfg.slots.airborne[code] ?? cfg.slots.defaultAirborne) - (delayed.has(code) ? 1 : 0));
  type Candidate = (typeof eligible)[number];
  // 짝마다 공통: tail, TYPE RATING·CREW, CHECK 독립성. CHECK에는 독립성 표시(0점)를 붙인다.
  // 24시간 안에 제안됐다 닫힌 짝은 후보에서 뺀다(syncOps의 seen과 같은 기준). 뺀 짝과 짝이 남은 FLIGHT를 적어 둔다
  const blockedPairs = new Map<string, NonNullable<Plan["blockedPairs"]>[number]>();
  const hadPair = new Set<string>();
  const notBlocked = (ac: AircraftState, t: Candidate) => {
    const b = reserved.recentPairs?.get(`${t.key}|${ac.id}`);
    if (!b) return true;
    blockedPairs.set(`${t.key}|${ac.id}`, { flight: t.key, aircraft: ac.id, aircraftName: ac.name, proposal: b.id, until: b.until });
    return false;
  };
  const pairsOf = (flights: Candidate[], ok: (ac: AircraftState, t: Candidate) => boolean, extra: (ac: AircraftState, t: Candidate) => Factor[]) =>
    flights
      .flatMap((t) => {
        const tails = tailsOf(t, now);
        return aircraft
          .filter((ac) => ok(ac, t) && (!tails.size || tails.has(ac.name.toUpperCase())) && qualifies(ac, t.cls) && independent(ac, t.ind) && notBlocked(ac, t))
          .map((ac) => {
            hadPair.add(t.key);
            const sc = score(t, ac);
            const ind = t.ind ? [mark("independence", "CHECK 독립성", t.ind.builders.size ? 1 : 0, independenceDetail(t.ind))] : [];
            return { t, ac, score: sc.score, factors: [...sc.factors, ...ind, ...extra(ac, t)] };
          });
      })
      .sort((a, b) => b.score - a.score || a.t.key.localeCompare(b.t.key) || a.ac.name.localeCompare(b.ac.name));
  const planned = new Map<string, number>();
  const usedFlights = new Set<string>();
  const usedAircraft = new Set<string>();
  const assign: AssignPlan[] = [];
  const place = (pairs: ReturnType<typeof pairsOf>) => {
    for (const p of pairs) {
      if (usedFlights.has(p.t.key) || usedAircraft.has(p.ac.id)) continue;
      const load = (airborneAt.get(p.t.airport) ?? 0) + (planned.get(p.t.airport) ?? 0);
      const size = WAKE_SLOTS[p.t.cls.wake];
      if (load + size > limitOf(p.t.airport) + 1e-9) continue;
      usedFlights.add(p.t.key);
      usedAircraft.add(p.ac.id);
      planned.set(p.t.airport, (planned.get(p.t.airport) ?? 0) + size);
      assign.push({ kind: "ASSIGN", flight: p.t.key, aircraft: p.ac.id, aircraftName: p.ac.name, airport: p.t.airport, score: p.score, factors: p.factors });
    }
  };
  // 1) STAND 규칙: 배정 가능(available)하고 예약 없는 AIRCRAFT에 TEAM당 1건. STAND 없는 FLIGHT도 여기서 먼저 받을 수 있다
  //    (단, 그 AIRCRAFT가 이미 STAND 없는 제안을 쥐고 있으면 아니다).
  place(pairsOf(eligible, (ac, t) => ac.available && !ac.reserved && ac.airport === t.airport && (needsStand(t.cls.type) || !ac.reservedLight), () => []));
  // 2) 남은 STAND 없는 FLIGHT(SURVEY·CHECK): HOLDING·PARKED AIRCRAFT에 STAND 규칙 밖으로. 한 계획에서 AIRCRAFT당 제안 1건,
  //    STAND 없는 FLIGHT는 진행 중인 것까지 AIRCRAFT당 1건. WAKE 슬롯은 같이 센다.
  const light = eligible.filter((t) => !usedFlights.has(t.key) && !needsStand(t.cls.type));
  place(
    pairsOf(
      light,
      (ac, t) => !usedAircraft.has(ac.id) && canTake(ac, t),
      (ac, t) => [mark("standFree", "STAND 없이", 1, `${ac.reason} — ${t.cls.type}는 STAND가 필요 없어 STAND 규칙 밖(AIRCRAFT당 1건)`)],
    ),
  );

  // 배정 가능한 짝이 모두 24시간 규칙에 걸린 FLIGHT는 이유를 남긴다(예: tail로 한 팀만 가능한데 그 짝이 막힘)
  for (const t of eligible) {
    if (usedFlights.has(t.key) || hadPair.has(t.key)) continue;
    const mine = [...blockedPairs.values()].filter((b) => b.flight === t.key).sort((a, b) => a.until.localeCompare(b.until));
    if (mine.length) excluded.push({ flight: t.key, reason: pairBlockedWhy(mine[0].proposal, mine[0].until) });
  }
  // 남은 FLIGHT 중 AIRPORT 슬롯에 자리가 있는데도 받을 AIRCRAFT가 없던 것. 24시간 규칙에 걸린 짝만 있던 FLIGHT는 뺀다
  for (const t of eligible) {
    if (usedFlights.has(t.key) || (!hadPair.has(t.key) && [...blockedPairs.values()].some((b) => b.flight === t.key))) continue;
    const load = (airborneAt.get(t.airport) ?? 0) + (planned.get(t.airport) ?? 0);
    if (load + WAKE_SLOTS[t.cls.wake] > limitOf(t.airport) + 1e-9) continue;
    unserved.push(unservedOf(t, t.airport, t.cls, "no-aircraft", tailsOf(t, now)));
  }

  // ── RELEASE: STAND 없이 오래 ENROUTE ──
  // 코드 작업(AIRPORT에 매핑된 프로젝트)만 본다. 발표 자료처럼 STAND가 원래 없는 일은 방치가 아니다.
  // 컨테이너(상위 이슈)는 RELEASE 대상이 아니지만, 왜 빠졌는지 화면에서 보이게 남긴다.
  for (const t of s.tickets) {
    if (!parents.has(t.key) || t.stateType !== "started" || !cfg.releaseStates.includes(t.state)) continue;
    if (flightsWithStand.has(t.key) || !isCandidateTicket(t, candidates) || !airportOfTicket(t, cfg)) continue;
    excluded.push({ flight: t.key, reason: parentWhy(t) });
  }
  const release: ReleasePlan[] = s.tickets
    .filter((t) => t.stateType === "started" && cfg.releaseStates.includes(t.state) && !flightsWithStand.has(t.key))
    .filter((t) => !parents.has(t.key))
    .filter((t) => isCandidateTicket(t, candidates) && Boolean(airportOfTicket(t, cfg)))
    .map((t) => ({ t, days: (now - Date.parse(t.startedAt ?? t.updatedAt ?? new Date(now).toISOString())) / DAY }))
    .filter((x) => x.days >= cfg.releaseDays)
    .sort((a, b) => b.days - a.days)
    .map(({ t, days }) => ({
      kind: "RELEASE" as const,
      flight: t.key,
      airport: airportOfTicket(t, cfg),
      days: round1(days),
      score: round1(days),
      factors: [
        { id: "wait" as const, label: "STAND 없이 ENROUTE", value: round1(days), weight: 1, points: round1(days), detail: `${round1(days)}일 (기준 ${cfg.releaseDays}일)` },
      ],
    }));

  const mapped = new Set([...Object.values(cfg.projectAirports), ...[...candidates].map((k) => cfg.teamAirports[k])]);
  const slots = [...new Set([...openAirports].filter((c) => mapped.has(c)))].map((code) => ({
    airport: code,
    airborne: airborneAt.get(code) ?? 0,
    planned: planned.get(code) ?? 0,
    limit: limitOf(code),
  }));

  return { at: new Date(now).toISOString(), assign, release, hold, excluded, blockedPairs: [...blockedPairs.values()], aircraft, slots, unserved };
}

// 청구 기록(~/.local/state/atc/claims)으로 세션별 과거 FLIGHT를 모은다. TTL과 상관없이 전부 본다.
export function readFlightHistory(teamKeys: string | string[] = config.linearTeamKeys, dir = join(config.stateDir, "claims")): FlightHistory {
  const keysOf = typeof teamKeys === "string" ? [teamKeys] : teamKeys;
  const re = keyPatternOf(keysOf);
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
        const key = keyInName(basename(decodeURIComponent(f.replace(/\.json$/, ""))), keysOf, re);
        if (key) keys.add(key);
      }
    } catch {}
    if (keys.size) out.set(id, [...keys].sort());
  }
  return out;
}


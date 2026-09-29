import { DEFAULT_RESTART_GRACE_MIN, restartingReason } from "./restarting.ts";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { callsign } from "./callsign.ts";
import { config } from "./config.ts";
import { accountOf, type Classification, canFly, classOf, DEFAULT_FLEET, type FleetFile, type FlightType, needsStand, profileOf, type Rating, WAKE_SLOTS } from "./crew.ts";
import { accountHoldDetail, accountHoldLabel, accountHoldOf, accountHolds, type Health, healthLabel, hhmm } from "./health.ts";
import { DEFAULT_FUEL, type FuelConfig, fuelConfigOf, fuelHoldReason, fuelHolds } from "./fuel-remaining.ts";
import { type Holder, holderLabel, isHeavy, overlapConfigOf, DEFAULT_OVERLAP, type OverlapConfig, overlapDetail, overlapHoldWhy, overlapsOf, overlapValueOf, predictedOf, sameTeamOnlyNote, soleTeamOf, splitByTeam } from "./overlap.ts";
import { keyInName, keyPatternOf, teamOfKey } from "./linear-keys.ts";
import type { LogEntry } from "./logbook.ts";
import { type Claim, type PullRequest, type Session, type Snapshot, type Ticket, type Workspace, parentKeysOf } from "./model.ts";
import { REASON_CODES } from "./reasons.ts";
import { ABSENT_REASON, cutHoldWhy, type ResumeInfo } from "./dispatch-launch.ts";
import { DEFAULT_TEAM_PATTERN, fleetKeyOf, regKey } from "./registration.ts";
import { DEFAULT_MCC, loadMcc } from "./mcc.ts";
import { supervisorConfirmOf } from "./supervisor-confirm.ts";

// 2단계 DISPATCH: 어떤 FLIGHT를 어떤 AIRCRAFT에 보낼지 계산한다(순수 함수 planDispatch).
// 제안을 기록하고 보이는 것은 proposals.ts, 설계는 docs/dispatch.md.

// SETTLED(ATC-117)의 기본 분. proposals.ts가 다시 내보낸다(proposals가 dispatch를 부르므로 값은 여기 둔다)
export const DEFAULT_SETTLE_MIN = 10;

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
  weights: { priority: number; wait: number; unblock: number; affinity: number; conflict: number; route: number; waypoint: number; overlap: number; sameTeam: number };
  // 파일 겹침(ATC-71, docs/dispatch.md): 곧 배정할 FLIGHT가 고칠 파일과 날고 있는 FLIGHT가 고치는 파일. hold가 켜지면 무겁게 겹치는 FLIGHT는 머지될 때까지 HOLD
  overlap: OverlapConfig;
  releaseDays: number; // STAND 없이 이만큼 ENROUTE면 RELEASE 제안
  releaseStates: string[]; // RELEASE 대상 상태 이름
  excludeLabels: string[];
  teamPattern: string; // 배정 대상 세션 이름
  // 외부 착륙 리뷰(ATC-30). security: 보안 규칙(라벨·경로·키워드)에만 걸린 PR을 REVIEW 세션에 보낼까.
  // "exclude"(기본): 보내지 않음. "deepseek": 보냄(SUPERVISOR 결정 2026-09-27). REVIEW가 Claude Sonnet이 된 뒤에도(2026-09-29)
  // dispatch.json 값과 맞추려고 이름은 그대로 둔다. 비밀·키 경로와 FLIGHT 없는 PR은 어느 쪽이든 보내지 않는다
  externalReview: { security: ExternalReviewSecurity };
  // FUEL REMAINING(ATC-55): INFO·HOLD 임계값(쓴 몫 %)과 DISPATCH HOLD 스위치(D3, 기본 꺼짐). SUPERVISOR만 설정 창에서 켠다
  fuel: FuelConfig;
  // /clear 뒤 첫 메시지를 기다려 주는 분(ATC-91, docs/fleet.md 8.5). 그 안에는 AIRCRAFT가 RESTARTING이고 승인된 제안이 기다린다
  restartGraceMin: number;
  // SETTLED(ATC-117): 열린 제안이 이만큼(분) 지내야 OCC 메모·BRIEFING과 CROSSCHECK mark를 받는다. 승인된 제안은 곧장. 0이면 예전처럼 곧장
  settleMin: number;
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
  weights: { priority: 3, wait: 0.5, unblock: 2, affinity: 1, conflict: -2, route: 1, waypoint: 1, overlap: -1, sameTeam: 1 },
  overlap: DEFAULT_OVERLAP,
  releaseDays: 3,
  releaseStates: ["In Progress"],
  excludeLabels: ["symphony-pilot"],
  teamPattern: DEFAULT_TEAM_PATTERN,
  externalReview: { security: "exclude" },
  fuel: DEFAULT_FUEL,
  restartGraceMin: DEFAULT_RESTART_GRACE_MIN,
  settleMin: DEFAULT_SETTLE_MIN,
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
      overlap: overlapConfigOf(user.overlap),
      // 모르는 값은 기본("exclude")으로 — 보안 PR을 잘못 내보내지 않게
      externalReview: { security: user.externalReview?.security === "deepseek" ? "deepseek" : "exclude" },
      // 모르는 값은 기본으로 — HOLD는 true일 때만 켠다
      fuel: fuelConfigOf(user.fuel),
      // 양수가 아니면 기본으로 — 0이나 음수는 기다림을 없애는 것이 아니라 잘못된 값이다
      restartGraceMin: typeof user.restartGraceMin === "number" && Number.isFinite(user.restartGraceMin) && user.restartGraceMin > 0 ? user.restartGraceMin : d.restartGraceMin,
      // 0은 켜지 않는다는 뜻이라 받는다. 음수·숫자가 아닌 값은 기본으로
      settleMin: typeof user.settleMin === "number" && Number.isFinite(user.settleMin) && user.settleMin >= 0 ? user.settleMin : d.settleMin,
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

// 후보 팀이 배정할 수 있는 AIRPORT 코드(projectAirports·teamAirports 값, null 제외).
// 2b 켜기 점검표(readiness.ts)가 이걸로 AIRPORT마다 READBACK 규칙 한 줄을 만든다.
export function assignableAirportCodes(
  cfg: Pick<DispatchConfig, "candidateTeams" | "teamAirports" | "projectAirports">,
  primary = config.linearTeamKey,
): Set<string> {
  const candidates = candidateTeamsOf(cfg, primary);
  const codes = [...Object.values(cfg.projectAirports), ...[...candidates].map((k) => cfg.teamAirports[k])];
  return new Set(codes.filter((c): c is string => Boolean(c)));
}

// FLIGHT의 AIRPORT: 프로젝트 매핑이 먼저(null이면 제외), 매핑에 없는 프로젝트·프로젝트 없음은 팀의 기본 AIRPORT
export function airportOfTicket(t: Pick<Ticket, "key" | "project">, cfg: Pick<DispatchConfig, "projectAirports" | "teamAirports">): string | null {
  if (t.project && t.project in cfg.projectAirports) return cfg.projectAirports[t.project];
  return cfg.teamAirports[teamOfKey(t.key)] ?? null;
}

export interface Factor {
  // standFree·independence는 0점짜리 표시(점수를 바꾸지 않고 왜 이 짝인지 보여 준다)
  id: "priority" | "wait" | "unblock" | "affinity" | "conflict" | "route" | "waypoint" | "overlap" | "overlapSame" | "standFree" | "independence" | "resume";
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
  registration?: string; // 짝·예약·FLIGHT 점유의 키(ATC-91). /clear로 세션 id가 바뀌어도 같다. planDispatch는 늘 채운다(옛 기록·손으로 만든 계획에는 없어 regOfAssign이 이름에서 읽는다)
  airport: string;
  score: number;
  factors: Factor[];
  launch?: true; // 세션이 없는 백그라운드 AIRCRAFT(ATC-129): 승인하면 LAUNCH 뒤 FLIGHT PLAN
  resume?: ResumeInfo; // RESUME 카드(ATC-129): 사용 한도로 끊긴 FLIGHT를 이어서
  supervisorConfirm?: string[]; // 예측 경로 중 사용자 등급 파일(ATC-120). 있을 때만
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
  registration?: string; // REGISTRATION(ATC-67). 제안·짝 규칙·예약은 이것으로 짝짓는다(ATC-91). planDispatch는 늘 채운다(regOfAircraft가 이름에서도 읽는다)
  name: string;
  callsign: string;
  airport: string | null;
  available: boolean;
  reason: string;
  reserved: string | null; // 이 AIRCRAFT로 진행 중인 STAND가 필요한 제안 id(approved·sent·accepted)
  // STAND 없는 FLIGHT(SURVEY·CHECK)를 받을 수 있는 상태: HOLDING이나 PARKED(AIRBORNE·AOG·RETIRED 아님)
  resting?: boolean;
  reservedLight?: string | null; // 이 AIRCRAFT로 진행 중인 STAND 없는 제안 id
  stopped?: true; // 멈춘 팀(ATC-90): health RESUME·STALLED, 또는 끝나지 않은 In Progress FLIGHT를 쥠. 열린 제안은 "AIRCRAFT 멈춤 — …"으로 닫고 짝 규칙은 시작하지 않는다
  room?: number; // 끝나지 않은 FLIGHT를 쥐고도 슬롯(perTeam)이 남은 양(WAKE로 셈). STAND가 필요한 새 FLIGHT는 WAKE가 이 안에 들어야 한다
  restarting?: true; // /clear 뒤 첫 메시지를 기다리는 자리(ATC-91). 세션은 없고 배정은 받지 않지만 승인된 제안은 닫지 않는다
  launch?: true; // 세션이 없는 백그라운드 AIRCRAFT(ATC-129, 스냅샷 absent). 이 AIRCRAFT의 카드는 승인하면 LAUNCH한다
}

// 진행 중인 제안이 잡고 있는 AIRCRAFT·FLIGHT → 제안 id. 새 계획에서 뺀다.
export interface Reserved {
  aircraft: Map<string, string>;
  flights: Map<string, string>;
  // FLIGHT key → HOLD 표시("D-0007 — 선행 FLIGHT 대기"). HELD는 AIRCRAFT를 잡지 않으므로 aircraft에는 없다.
  held?: Map<string, string>;
  // REGISTRATION → 진행 중인 ASSIGN의 FLIGHT들. aircraft는 한 대에 제안 하나만 담아서,
  // STAND 있는 FLIGHT와 없는 FLIGHT를 함께 쥔 AIRCRAFT를 가르려면 이것이 필요하다.
  aircraftFlights?: Map<string, string[]>;
  // "FLIGHT|REGISTRATION" → 24시간 안에 제안됐다 닫힌 짝(거절·SUPERSEDED·EXPIRED·RECALLED …)과 다시 가능해지는 시각.
  // syncOps가 이 짝을 다시 제안하지 않으므로 계획에서도 빼야 AIRCRAFT가 다음으로 좋은 FLIGHT를 받는다.
  recentPairs?: Map<string, { id: string; until: string }>;
  // FLIGHT key → FLIGHT 자체의 문제로 거절된 제안(사유 칩이 FLIGHT_HOLD_CODES 중 하나). 모든 AIRCRAFT에서 뺀다.
  // decidedAt 뒤에 Linear 이슈가 바뀌거나(updatedAt) until(판정 + 24시간)이 지나면 풀린다 — 이슈 쪽은 planner가 본다
  recentFlights?: Map<string, { id: string; decidedAt: string; until: string; codes: string[] }>;
  // FLIGHT key → 최근 ARRIVED한 STAND 없는 FLIGHT의 제안 id. LOGBOOK에 남지 않아 여기서 뺀다(Linear가 아직 Todo여도)
  arrived?: Map<string, string>;
}
export const regOfAssign = (a: Pick<AssignPlan, "registration" | "aircraftName">, teamPattern?: string): string => a.registration ?? regKey(a.aircraftName, teamPattern);
export const regOfAircraft = (a: Pick<AircraftState, "registration" | "name">, teamPattern?: string): string => a.registration ?? regKey(a.name, teamPattern);
const NO_RESERVED: Reserved = { aircraft: new Map(), flights: new Map(), held: new Map() };

// 이 AIRCRAFT가 지금 그 FLIGHT를 받을 수 있는 상태인가(예약은 따로 본다).
// STAND가 필요한 FLIGHT는 배정 가능(available)일 때만, STAND 없는 FLIGHT(SURVEY·CHECK)는 HOLDING이어도 된다.
// planner와 syncOps(승인된 제안이 아직 유효한가)가 같은 규칙을 쓴다.
export function canTakeNow(ac: Pick<AircraftState, "available" | "resting">, t: Pick<Ticket, "labels"> | undefined): boolean {
  if (ac.available) return true;
  return Boolean(ac.resting && t && !needsStand(classOf(t.labels).type));
}

// 멈춘 팀의 사유(ATC-90). health RESUME·STALLED는 SUPERVISOR가 풀어야 다시 배정된다
export function stoppedHealthWhy(h: Pick<Health, "code" | "detail" | "resetsAt"> & Parameters<typeof healthLabel>[0], now: number): string {
  if (h.code === "RESUME") return `RESUME 필요${h.resetsAt ? `(한도 풀림 ${hhmm(Date.parse(h.resetsAt), now)})` : ""}`;
  return `${healthLabel(h, now)} — ${h.detail}`;
}
// 끝나지 않은 In Progress FLIGHT 하나의 사유. PR이 열려 있어도 머지 전이면 아직 진행 중이다
export const unfinishedWhy = (key: string, hasPr: boolean) => `${key} 아직 진행 중(${hasPr ? "PR 머지 전" : "PR 없음"})`;

export interface Plan {
  at: string;
  assign: AssignPlan[];
  release: ReleasePlan[];
  // why: 선행 FLIGHT(Linear blockedBy)가 아닌 HOLD의 사유(파일 겹침, ATC-71)
  hold: { flight: string; blockedBy: string[]; why?: string }[];
  // 파일 겹침으로 HOLD할 FLIGHT(ATC-71). enforced가 false면 스위치가 꺼져 있어 HOLD하지 않고 보여 주기만 한다(shadow)
  overlapHolds?: { flight: string; blockedBy: string[]; why: string; enforced: boolean }[];
  excluded: { flight: string; reason: string }[];
  // 24시간 규칙으로 후보에서 뺀 짝(FLIGHT·AIRCRAFT·제안 id·다시 가능한 시각)
  blockedPairs?: { flight: string; aircraft: string; aircraftName: string; proposal: string; until: string }[];
  aircraft: AircraftState[];
  slots: { airport: string; airborne: number; planned: number; limit: number }[];
  // 받을 AIRCRAFT가 없어 남은 FLIGHT(FLEET PLAN 수요, docs/fleet.md 8.6). AIRPORT 슬롯이 차서 남은 것은 넣지 않는다
  unserved?: Unserved[];
  // RESUME 카드(ATC-129): 한도로 끊긴 FLIGHT를 같은 REGISTRATION에(launch). 슬롯·열린 제안 수에 세지 않는다
  resume?: AssignPlan[];
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
// FLIGHT가 지금 정말 날고 있나(ATC-139): Linear 상태가 끝나지(completed·canceled·duplicate) 않았고, LOGBOOK ARRIVED도, STAND 없는 FLIGHT의 ARRIVED 보고도 없다.
// 모르는 FLIGHT(티켓 목록에 없음)는 날고 있는 것으로 본다(막지 않는 쪽)
export function isFlying(key: string, byKey: ReadonlyMap<string, Pick<Ticket, "stateType">>, landed: Landed, arrived?: ReadonlyMap<string, string>): boolean {
  return !DONE_STATES.has(byKey.get(key)?.stateType ?? "") && !landed.has(key) && !arrived?.has(key);
}

// AIRBORNE FLIGHT 집합(충돌 위험 요소): 죽지 않은 세션의 활성 점유가 가리키는 FLIGHT 중 지금 정말 날고 있는 것만
export function airborneFlightsOf(
  active: readonly Pick<Claim, "sessionId" | "workspacePath">[],
  sessions: readonly Pick<Session, "id" | "status">[],
  wsTicket: ReadonlyMap<string, string | null>,
  inFlight: (key: string) => boolean,
): Set<string> {
  const alive = new Set(sessions.filter((x) => x.status !== "dead").map((x) => x.id));
  const out = new Set<string>();
  for (const c of active) {
    const k = wsTicket.get(c.workspacePath);
    if (k && alive.has(c.sessionId) && inFlight(k)) out.add(k);
  }
  return out;
}

export const STAND_FREE_LANDED = "(STAND 없음)";
export const landedWhy = (pr: string) => (pr === STAND_FREE_LANDED ? "이미 완료됨 — STAND 없이 ARRIVED(LOGBOOK)" : `이미 완료됨 — PR ${pr} 머지됨(LOGBOOK)`);
export const openPrWhy = (n: number) => `열린 PR #${n} 있음`;
export const arrivedWhy = (id: string) => `이미 완료됨 — ${id} ARRIVED(CAPTAIN 보고)`;

// LOGBOOK에서 ARRIVED한 FLIGHT → 머지된 PR("repo#N", 저장소 이름만). 되돌린 PR은 빼서 다시 후보가 된다.
export type Landed = Map<string, string>;
export function landedOf(entries: Pick<LogEntry, "flight" | "reverted" | "pr">[]): Landed {
  const out: Landed = new Map();
  for (const e of entries) {
    if (!e.flight || e.reverted || out.has(e.flight)) continue;
    // STAND 없는 FLIGHT의 확인된 ARRIVED(ATC-72)도 끝난 FLIGHT다
    out.set(e.flight, e.pr ? `${e.pr.repo.split("/").pop()}#${e.pr.number}` : STAND_FREE_LANDED);
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
  const regs = t.labels.map((l) => re.exec(l.trim())?.[2]).filter(Boolean) as string[];
  return new Set(regs.map((r) => regKey(r))); // `tail:team-g`도 TEAM_G(ATC-67)
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

// 파일 겹침의 입력(overlap-run.ts가 캐시에서 채운다). 순수 planner는 git·gh·Linear를 읽지 않는다
export interface FilesInFlight {
  holders: Holder[];
  bodies: Map<string, string | null>; // FLIGHT key → 이슈 본문(읽은 것만)
}
const NO_FILES: FilesInFlight = { holders: [], bodies: new Map() };

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
    const reg = regKey(name, src.team.source);
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
    for (const e of src.logbook) if (e.pr?.number === n && e.airport === airport.code) add(e.aircraft, `PR #${n} LOGBOOK`);
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

// SUPERVISOR CONFIRM은 atc의 착륙 등급 규칙(deploy/landing-tier.mjs)이 미치는 곳, 곧 MCC AIRPORT(mcc.json의 airport, 기본 ATCC)에서만 낸다(ATC-159).
// 파일이 없거나 깨졌으면 loadMcc가 기본값을 줘서 ATCC로 남는다
export const mccAirportNow = () => loadMcc().airport;

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
  files: FilesInFlight = NO_FILES, // 파일 겹침(ATC-71): 날고 있는 FLIGHT의 파일과 이슈 본문
  resumes: AssignPlan[] = [], // RESUME 카드(ATC-129, dispatch-launch.ts resumePlansOf). 그 AIRCRAFT는 새 FLIGHT를 받지 않는다
  confirmAirport: string = DEFAULT_MCC.airport, // SUPERVISOR CONFIRM을 내는 AIRPORT(ATC-159). 호출부는 mccAirportNow()를 넘긴다
): Plan {
  const team = new RegExp(cfg.teamPattern, "i");
  const regOf = (name: string) => regKey(name, cfg.teamPattern); // 세션 이름 → REGISTRATION(ATC-67)
  const byKey = new Map(s.tickets.map((t) => [t.key, t]));
  const codeOf = (repo: string | null) => (repo ? (s.airports.find((a) => a.repo === repo)?.code ?? null) : null);
  const openAirports = new Set(s.airports.map((a) => a.code));
  const candidates = candidateTeamsOf(cfg);
  const active = s.claims.filter((c) => c.state === "active");
  const wsTicket = new Map(s.workspaces.map((w) => [w.path, w.ticketKey]));
  const flightsWithStand = new Set(s.workspaces.map((w) => w.ticketKey).filter(Boolean) as string[]);
  const isDone = (key: string) => DONE_STATES.has(byKey.get(key)?.stateType ?? "");
  // 지금 정말 날고 있는 FLIGHT(ATC-139): Linear가 끝냈거나(completed·canceled) LOGBOOK·CAPTAIN 보고가 ARRIVED라 한 FLIGHT는 팀이 옛 STAND에 앉아 있어도 아니다
  const inFlight = (key: string) => isFlying(key, byKey, landed, reserved.arrived);
  // 겹침 holder도 같은 기준: ARRIVED한 FLIGHT의 파일은 더 겹치지 않는다(overlap-run은 Linear 상태만 본다)
  const overlapHolders = files.holders.filter((h) => inFlight(h.flight));
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
      const base = { id: x.id, registration: regOf(x.name), name: x.name, callsign: callsign(x), airport: codeOf(x.repo), ...reservationsOf(regOf(x.name)), resting: false };
      // FLEET에서 퇴역시키거나 AOG(잠시 운항 중지)로 둔 AIRCRAFT는 배정하지 않는다
      const status = profileOf(fleet, x.name);
      if (status.retired) return { ...base, available: false, reason: "RETIRED" };
      if (status.aog) return { ...base, available: false, reason: `AOG — ${status.aog.reason}${status.aog.until ? ` (~${status.aog.until})` : ""}` };
      // AIRCRAFT health(ATC-45): 사용 한도·모델·맥락·경로 문제나 HUNG이면 풀릴 때까지 배정하지 않는다
      if (x.health?.holds) return { ...base, available: false, reason: `${healthLabel(x.health, now)} — ${x.health.detail}` };
      // RESUME·STALLED(ATC-86): 멈춘 팀은 비어 있는 팀이 아니다. STAND 없는 FLIGHT도 받지 않는다(resting false)
      if (x.health?.code === "RESUME" || x.health?.code === "STALLED") return { ...base, available: false, stopped: true as const, reason: stoppedHealthWhy(x.health, now) };
      const acct = accountHoldOf(holds, accountOf(fleet, x.name), x.name);
      if (acct) return { ...base, available: false, reason: `${accountHoldLabel(acct, now)} — ${accountHoldDetail(acct)}` };
      // FUEL HOLD(ATC-55, D3): SUPERVISOR 스위치가 켜져 있고 그 ACCOUNT가 holdPct 이상 썼으면 reset까지 배정하지 않는다
      const fuel = s.fuel?.[regOf(x.name)];
      if (fuel && fuelHolds(fuel, cfg.fuel ?? DEFAULT_FUEL)) return { ...base, available: false, reason: fuelHoldReason(fuel, now) };
      if (x.status === "busy") return { ...base, available: false, reason: "AIRBORNE" };
      const held = active.filter((c) => c.sessionId === x.id).map((c) => wsTicket.get(c.workspacePath));
      const open = held.filter((k) => !k || inFlight(k));
      // 끝나지 않은 In Progress FLIGHT(ATC-90): STAND를 쥐었든 tail: 라벨이든, 머지된 PR이 없고 STAND 없이 나간 FLIGHT가 아닌 것.
      // 그 WAKE만큼 이 AIRCRAFT의 슬롯(perTeam)을 쓴다. 다 찼으면 멈춘 팀(STAND 없는 FLIGHT는 받는다), 남았으면 그 안에 드는 FLIGHT만 받는다
      const reg = regOf(x.name);
      const unfinished = new Set<string>();
      for (const k of held) if (k) unfinished.add(k);
      for (const t of s.tickets) if (t.stateType === "started" && tailsOf(t, now).has(reg)) unfinished.add(t.key);
      const holding = [...unfinished].filter((k) => {
        const t = byKey.get(k);
        return t && t.stateType === "started" && !landed.has(k) && needsStand(classOf(t.labels).type);
      });
      if (holding.length) {
        const load = holding.reduce((a, k) => a + WAKE_SLOTS[classOf(byKey.get(k)!.labels).wake], 0);
        const why = holding.map((k) => unfinishedWhy(k, (s.pulls ?? []).some((p) => p.ticketKey === k))).join(", ");
        if (load >= cfg.slots.perTeam - 1e-9) return { ...base, resting: true, available: false, stopped: true as const, reason: why };
        if (base.airport) return { ...base, resting: true, available: true, room: cfg.slots.perTeam - load, reason: `${why} — 남은 슬롯 ${cfg.slots.perTeam - load}` };
      }
      if (open.length >= cfg.slots.perTeam) {
        return { ...base, resting: true, available: false, reason: `HOLDING — ${open.map((k) => k ?? "AD HOC STAND").join(", ")} 진행 중` };
      }
      if (!base.airport) return { ...base, available: false, reason: "소속 AIRPORT 없음" };
      return { ...base, resting: true, available: true, reason: held.length ? "HOLDING, 남은 FLIGHT 없음" : "PARKED" };
    });
  // RESTARTING(ATC-91): 세션은 없지만 /clear 뒤 첫 메시지를 기다리는 AIRCRAFT. 배정은 받지 않고(available false), 그 REGISTRATION의 승인된 제안은 닫지 않는다
  for (const r of s.restarting ?? []) {
    if (aircraft.some((a) => regOfAircraft(a, cfg.teamPattern) === r.registration)) continue;
    aircraft.push({ id: `restarting:${r.registration}`, registration: r.registration, name: r.name, callsign: callsign({ name: r.registration }), airport: null, ...reservationsOf(r.registration), resting: false, available: false, reason: restartingReason(r), restarting: true });
  }
  // ABSENT(ATC-129): 세션이 없는 백그라운드 AIRCRAFT(atc가 띄운 적이 있는 것). 후보로 남고 그 카드는 승인하면 LAUNCH한다.
  // RETIRED는 스냅샷이 이미 뺐다. AOG, LIMIT(cut 뒤 reset 전, ACCOUNT HOLD, FUEL HOLD), RESUME 대기, 끝나지 않은 FLIGHT는 새 FLIGHT를 받지 않는다
  for (const a of s.absent ?? []) {
    const reg = a.registration;
    if (aircraft.some((x) => regOfAircraft(x, cfg.teamPattern) === reg)) continue;
    const key = fleetKeyOf(Object.keys(fleet.aircraft), reg, cfg.teamPattern);
    const home = (key ? fleet.aircraft[key]?.base : null) ?? null;
    const base = { id: `absent:${reg}`, registration: reg, name: reg, callsign: callsign({ name: reg }), airport: home && openAirports.has(home) ? home : null, ...reservationsOf(reg), resting: false, launch: true as const };
    const status = profileOf(fleet, reg);
    if (status.aog) {
      aircraft.push({ ...base, available: false, reason: `AOG — ${status.aog.reason}${status.aog.until ? ` (~${status.aog.until})` : ""}` });
      continue;
    }
    const cut = cutHoldWhy(a.cut, now);
    if (cut) {
      aircraft.push({ ...base, available: false, reason: cut });
      continue;
    }
    const resume = resumes.find((r) => r.registration === reg);
    if (resume) {
      aircraft.push({ ...base, available: false, stopped: true, reason: `RESUME — ${resume.flight}을 이어서(RESUME 카드)` });
      continue;
    }
    const acct = accountHoldOf(holds, accountOf(fleet, reg), reg);
    if (acct) {
      aircraft.push({ ...base, available: false, reason: `${accountHoldLabel(acct, now)} — ${accountHoldDetail(acct)}` });
      continue;
    }
    const fuel = s.fuel?.[reg];
    if (fuel && fuelHolds(fuel, cfg.fuel ?? DEFAULT_FUEL)) {
      aircraft.push({ ...base, available: false, reason: fuelHoldReason(fuel, now) });
      continue;
    }
    // 끝나지 않은 In Progress FLIGHT(tail: 라벨, ATC-90). 세션이 없어 점유는 없다
    const holding = s.tickets.filter((t) => t.stateType === "started" && tailsOf(t, now).has(reg) && !landed.has(t.key) && needsStand(classOf(t.labels).type)).map((t) => t.key);
    if (holding.length) {
      aircraft.push({ ...base, available: false, stopped: true, reason: holding.map((k) => unfinishedWhy(k, (s.pulls ?? []).some((p) => p.ticketKey === k))).join(", ") });
      continue;
    }
    if (!base.airport) {
      aircraft.push({ ...base, available: false, reason: "소속 AIRPORT 없음" });
      continue;
    }
    aircraft.push({ ...base, resting: true, available: true, reason: ABSENT_REASON });
  }

  // ── FLIGHT ──
  const excluded: Plan["excluded"] = [];
  // 멈춘 팀(ATC-90)은 제외 목록에도 사유와 쥐고 있는 FLIGHT를 남긴다. 키는 그 REGISTRATION
  for (const ac of aircraft) if (ac.stopped) excluded.push({ flight: regOfAircraft(ac, cfg.teamPattern), reason: `${ac.name} — ${ac.reason}` });
  const hold: Plan["hold"] = [];
  const unserved: Unserved[] = [];
  const unservedOf = (t: Ticket, airport: string, cls: Classification, why: Unserved["why"], tails: Set<string> = new Set()): Unserved => ({
    flight: t.key, airport, type: cls.type, ratings: cls.ratings, labeled: cls.sources.length > 0, why, tails: [...tails],
  });
  const overlapHolds: NonNullable<Plan["overlapHolds"]> = [];
  const sameTeamOnly = new Map<string, string>(); // 같은 팀 예외가 통한 FLIGHT → 그 팀(후보를 그 팀 AIRCRAFT로 좁힌다, ATC-136)
  // 예측 경로: 이 FLIGHT와 연결된 FLIGHT의 본문(관계·blocks·blockedBy)에서. 같은 FLIGHT는 한 번만 센다
  const predictedFor = (t: Ticket) => predictedOf(t.key, [...new Set([...t.related, ...t.blocks, ...t.blockedBy])], files.bodies);
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
  // room(ATC-90): 끝나지 않은 FLIGHT를 쥔 팀은 남은 슬롯 안에 드는 WAKE의 FLIGHT만 STAND 규칙으로 받는다
  const fitsRoom = (ac: AircraftState, t: { cls: Classification }) => ac.room === undefined || !needsStand(t.cls.type) || WAKE_SLOTS[t.cls.wake] <= ac.room + 1e-9;
  const canTake = (ac: AircraftState, t: { airport: string; cls: Classification }) =>
    ac.airport === t.airport && (needsStand(t.cls.type) ? ac.available && !ac.reserved && fitsRoom(ac, t) : Boolean(ac.resting) && !ac.reservedLight);
  // 이 AIRCRAFT가 지금 이 FLIGHT를 못 받는 이유
  const notTakeWhy = (ac: AircraftState, cls: Classification) =>
    !needsStand(cls.type)
      ? !ac.resting ? ac.reason : ac.reservedLight ? `진행 중인 제안 ${ac.reservedLight}` : `소속 AIRPORT ${ac.airport ?? "없음"}`
      : !ac.available ? ac.reason : ac.reserved ? `진행 중인 제안 ${ac.reserved}` : !fitsRoom(ac, { cls }) ? "남은 슬롯 부족" : `소속 AIRPORT ${ac.airport ?? "없음"}`;
  const builderSrc: BuilderSources = { logbook, pulls: s.pulls ?? [], claims: s.claims, workspaces: s.workspaces, sessions: s.sessions, history, team };
  const independenceOf = (t: Ticket, airport: string): Independence => {
    const target = checkTargetOf(t);
    return { target, builders: checkBuildersOf(target, { code: airport, repo: s.airports.find((a) => a.code === airport)?.repo ?? null }, builderSrc) };
  };
  const independent = (ac: AircraftState, ind: Independence | null) => !ind || !ind.builders.has(regOf(ac.name));
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
      const mine = aircraft.filter((ac) => tails.has(regOf(ac.name)));
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
        const why = mine.map((ac) => `${ac.name} ${notTakeWhy(ac, cls)}`).join(", ");
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
    // 파일 겹침 HOLD(ATC-71): 곧 고칠 파일을 날고 있는 FLIGHT가 무겁게 만지면 그 FLIGHT가 머지될 때까지 기다린다.
    // 그 파일을 만지는 팀이 그 팀뿐이고 그 팀이 이 FLIGHT를 지금 받을 수 있으면 HOLD하지 않고 그 팀에만 제안한다(이어서 하면 충돌 없음, ATC-136).
    // 그 팀이 못 받으면(바쁨·HOLD·세션 없음) 다른 겹침과 같이 HOLD
    const ov = overlapsOf(t.key, cls.wake, airport, predictedFor(t), overlapHolders);
    const heavy = ov.filter((o) => isHeavy(o, cfg.overlap));
    if (heavy.length) {
      const soleTeam = soleTeamOf(ov);
      const teamAc = soleTeam ? aircraft.filter((ac) => regOf(ac.name) === soleTeam) : [];
      const sameTeam = teamAc.some((ac) => qualifies(ac, cls) && independent(ac, ind) && canTake(ac, { airport, cls }));
      if (sameTeam) sameTeamOnly.set(t.key, soleTeam as string);
      else {
        const blockedBy = [...new Set(heavy.map((o) => o.holder.flight))];
        const teamWhy = soleTeam
          ? teamAc.length
            ? teamAc.map((ac) => (!qualifies(ac, cls) ? "TYPE RATING·CREW 안 맞음" : !independent(ac, ind) ? "CHECK 독립성" : notTakeWhy(ac, cls))).join(", ")
            : "세션 없음"
          : "";
        const why = overlapHoldWhy(blockedBy, soleTeam ? { name: soleTeam, why: teamWhy } : undefined);
        overlapHolds.push({ flight: t.key, blockedBy, why, enforced: cfg.overlap.hold });
        if (cfg.overlap.hold) {
          hold.push({ flight: t.key, blockedBy, why });
          continue;
        }
      }
    }
    eligible.push({ ...t, airport, cls, ind });
  }

  // ── 점수 ──
  const airborneFlights = airborneFlightsOf(active, s.sessions, wsTicket, inFlight);
  const w = cfg.weights;
  const score = (t: Ticket & { airport?: string }, ac: AircraftState): { score: number; factors: Factor[] } => {
    const pv = PRIORITY_VALUE[t.priority] ?? 1.5;
    const waitDays = t.createdAt ? Math.min(14, Math.max(0, (now - Date.parse(t.createdAt)) / DAY)) : 0;
    const unblocks = t.blocks.filter((k) => byKey.get(k)?.stateType === "unstarted" || byKey.get(k)?.stateType === "backlog");
    const linked = new Set([...t.related, ...t.blocks, ...t.blockedBy]);
    const flown = (history.get(ac.id) ?? []).filter((k) => k !== t.key);
    const affinity = flown.filter((k) => linked.has(k) || (t.project && byKey.get(k)?.project === t.project));
    const conflicts = [...linked].filter((k) => airborneFlights.has(k));
    // 파일 겹침(ATC-71): 이 팀이 이미 날고 있는 FLIGHT와의 겹침은 충돌이 아니다. 그 팀뿐이면 이어서 하는 보너스
    const team = regOfAircraft(ac, cfg.teamPattern);
    const ov = splitByTeam(overlapsOf(t.key, classOf(t.labels).wake, t.airport ?? "", predictedFor(t), overlapHolders), team);
    const holdNote = overlapHolds.find((h) => h.flight === t.key && !h.enforced) ? " — HOLD 스위치가 꺼져 있어 기다리지 않음(켜면 대기)" : "";
    const same = ov.mine.length && !ov.others.length ? ov.mine : [];
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
      f("overlap", "파일 겹침", overlapValueOf(ov.others), w.overlap ?? -1, overlapDetail(ov.others, ov.others.length ? holdNote : "")),
      ...(same.length ? [f("overlapSame", "이어서 하면 충돌 없음", 1, w.sameTeam ?? 1, `${same.map(holderLabel).join(", ")}를 날고 있는 ${team}가 이어 함 — ${overlapDetail(same)}${sameTeamOnly.get(t.key) === team ? ` — ${sameTeamOnlyNote(team)}` : ""}`)] : []),
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
    const keys = active.filter((c) => c.sessionId === x.id).map((c) => wsTicket.get(c.workspacePath)).filter((k) => !k || inFlight(k));
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
    const b = reserved.recentPairs?.get(`${t.key}|${regOfAircraft(ac, cfg.teamPattern)}`);
    if (!b) return true;
    blockedPairs.set(`${t.key}|${regOfAircraft(ac, cfg.teamPattern)}`, { flight: t.key, aircraft: regOfAircraft(ac, cfg.teamPattern), aircraftName: ac.name, proposal: b.id, until: b.until });
    return false;
  };
  const pairsOf = (flights: Candidate[], ok: (ac: AircraftState, t: Candidate) => boolean, extra: (ac: AircraftState, t: Candidate) => Factor[]) =>
    flights
      .flatMap((t) => {
        const tails = tailsOf(t, now);
        return aircraft
          .filter((ac) => ok(ac, t) && fitsRoom(ac, t) && (!tails.size || tails.has(regOf(ac.name))) && (!sameTeamOnly.has(t.key) || regOf(ac.name) === sameTeamOnly.get(t.key)) && qualifies(ac, t.cls) && independent(ac, t.ind) && notBlocked(ac, t))
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
      if (usedFlights.has(p.t.key) || usedAircraft.has(regOfAircraft(p.ac, cfg.teamPattern))) continue;
      const load = (airborneAt.get(p.t.airport) ?? 0) + (planned.get(p.t.airport) ?? 0);
      const size = WAKE_SLOTS[p.t.cls.wake];
      if (load + size > limitOf(p.t.airport) + 1e-9) continue;
      usedFlights.add(p.t.key);
      usedAircraft.add(regOfAircraft(p.ac, cfg.teamPattern));
      // SUPERVISOR CONFIRM AT AIRCRAFT(ATC-120): 예측 경로 중 사용자 등급 파일. 예측이 비면 표시 없음
      // 다른 AIRPORT는 그 규칙을 쓰지 않으니 줄을 내지 않는다(ATC-159)
      const confirm = p.t.airport === confirmAirport ? supervisorConfirmOf(predictedFor(p.t).map((x) => x.pattern)) : [];
      planned.set(p.t.airport, (planned.get(p.t.airport) ?? 0) + size);
      assign.push({ kind: "ASSIGN", flight: p.t.key, aircraft: p.ac.id, aircraftName: p.ac.name, registration: regOfAircraft(p.ac, cfg.teamPattern), airport: p.t.airport, score: p.score, factors: p.factors, ...(p.ac.launch ? { launch: true as const } : {}), ...(confirm.length ? { supervisorConfirm: confirm } : {}) });
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
      (ac, t) => !usedAircraft.has(regOfAircraft(ac, cfg.teamPattern)) && canTake(ac, t),
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

  return { at: new Date(now).toISOString(), assign, release, hold, overlapHolds, excluded, blockedPairs: [...blockedPairs.values()], aircraft, slots, unserved, resume: resumes };
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


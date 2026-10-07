import { JsonlCache } from "./jsonl-cache.ts";
import { accountFolders } from "./accounts.ts";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import type { ArrivalSuggestion } from "./standfree.ts";
import { dirname, join } from "node:path";
import type { Context, Hono } from "hono";
import { config } from "./config.ts";
import { confirmViewOf } from "./supervisor-confirm.ts";
import { callsign, flightNumber } from "./callsign.ts";
import {
  canTakeNow,
  BETTER_WHY,
  DEFAULT_DISPATCH_CONFIG,
  DEFAULT_SETTLE_MIN,
  DONE_STATES,
  FLIGHT_HOLD_CODES,
  type DispatchConfig,
  airportOfTicket,
  candidateTeamsOf,
  type Factor,
  excludedLabelWhy,
  takenWhy,
  hasStandWhy,
  isCandidateTicket,
  type Landed,
  landedOf,
  landedWhy,
  loadDispatchConfig,
  mccAirportNow,
  NO_PRIORITY_WHY,
  parentWhyOf,
  noProjectWhy,
  type Plan,
  PRIORITY_NAME,
  planDispatch,
  readFlightHistory,
  REASON_FILTERS,
  regOfAircraft,
  regOfAssign,
  type Reserved,
  saveDispatchMode,
  stateChangedWhy,
  tailsOf,
  workedWhy,
} from "./dispatch.ts";
import { teamOfKey } from "./linear-keys.ts";
import { fleetKeyOf, regKey, registrationOf } from "./registration.ts";
import { CROSS_ACCOUNT_LABEL, unreachableWhy } from "./account-reach.ts";
import { RESTARTING_TEXT } from "./restarting.ts";
import { applyGroundStops, enforcedStops, groundStopWhy } from "./atfm.ts";
import { classLabel, classOf, needsStand } from "./crew.ts";
import { selfCheckCrewChange } from "./crew-change.ts";
import { type Crosscheck, CrosscheckError, type CrosscheckLine, crosscheckRateOf, examplesOf, type HumanDecision, markOf, oneClickOf, parseCrosscheck, type Via, viaOf } from "./crosscheck.ts";
import { blindStatsOf, isBlind } from "./blind.ts";
import { filesInFlight } from "./overlap-run.ts";
import { type Briefing, BriefingError, factsOf, leadOf, parseBriefing, waypointIndex } from "./briefing.ts";
import { loadFleet } from "./fleet.ts";
import { type DispatchMeasured, dispatchStatsOf } from "./judges/dispatch.ts";
import { type DispatchMarks, dispatchMarksOf, loadJudges, readJudgeLines } from "./judges/store.ts";
import { type LogEntry, loadLogbook, loadPricedLogbook } from "./logbook.ts";
import type { FuelWatch } from "./fuel-watch.ts";
import { confirmCodesOf, confirmReasonOf, type Preflight } from "./preflight.ts";
import { parentKeysOf, type Snapshot, type Ticket, type TrafficEvent } from "./model.ts";
import { composeReason, parseReasonCodes, REASON_CODES, ReasonCodeError, reasonCountsOf } from "./reasons.ts";
import { readiness2bOf, readinessFiles } from "./readiness.ts";
import { noteDispatchHolds, orphanCountsNow } from "./orphan-flight-run.ts";
import { record } from "./recorder.ts";
import { closingLine, overdueBase, responseOf } from "./response.ts";
import { activeWaypointsOf, type Route } from "./routes.ts";
import { readLinearProjects } from "./sources/linear-projects.ts";
import { flightPlanNotesOf, type IssueComment } from "./issue-notes.ts";
import { fetchIssueDetail } from "./sources/linear.ts";
import { DIRECT_LINE, directLines, directSectionsOf, DISCRETION_LINE, FINISH_LINE, formatAssignment } from "./briefs.ts";
import { type Delivery, deliveryOf } from "./session-origin.ts";
import { fromThisApp } from "./origin.ts";
import { causeOf, resolveRecipient } from "./address.ts";
import { type ArrivalReport, foldReports, readReports } from "./arrival-report.ts";
import { readDepartures } from "./departures.ts";
import { allClearances } from "./clearances.ts";
import { holderLines, holderPlansOf, type PrHolder } from "./pr-holder.ts";
import { setHolderRoutes } from "./pr-holder-state.ts";
import { ticketKeyFromBranch } from "./sources/git.ts";
import { k3LaunchWaits, k3WaitOf } from "./k3-launch-wait.ts";
import { flightPlanCalls } from "./stale-reply.ts";
import { refuseStaleReply } from "./stale-reply-run.ts";
import {
  approveLaunch,
  LAUNCH_FAILED_WHY,
  LAUNCHING_TEXT,
  type LaunchResult,
  launchCapOf,
  launchReleaseWhyOf,
  launchMissing,
  launchMissingWhy,
  launchTimedOut,
  launchTimeoutWhy,
  launchViewOf,
  launchWaiting,
  resumedOf,
  resumeKey,
  resumeLines,
  type ResumeInfo,
  resumePlansOf,
} from "./dispatch-launch.ts";

// DISPATCH 제안 기록. 추가만 하는 JSONL을 접어 현재 상태를 만든다(clearances.ts와 같은 방식).
// - 2a(mode "shadow"): SUPERVISOR가 "나라면 승인/거절"만 표시하고 아무에게도 보내지 않는다.
// - 2b(mode "approval"): SUPERVISOR가 승인하면 OCC 세션(DISPATCH)이 FLIGHT PLAN을 CAPTAIN에게 보내고
//   CAPTAIN의 READBACK으로 수락, STAND가 생기면 DEPARTED. 보내는 문구는 서버가 만들고
//   occ/send-guard.mjs가 그 문구 그대로인지 확인한다.
// - RECALL: 보냈거나(sent) READBACK 받은(accepted) FLIGHT PLAN을 SUPERVISOR가 사유를 적어 거둬들인다(recalling).
//   OCC가 서버가 만든 RECALL 문구를 CAPTAIN에게 보내고, CAPTAIN의 "READBACK D-xxxx RECALL"로 recalled.
//   STAND가 생긴(departed) 뒤에는 RECALL하지 않는다(SUPERVISOR가 직접 처리).
// - STAND 없는 FLIGHT(SURVEY·CHECK): READBACK이 곧 DEPARTED다(departedStand null, departedVia "readback").
//   CAPTAIN이 끝났다고 보고하면 OCC가 `dispatch arrived`로 ARRIVED를 적는다. 그때까지 AIRCRAFT·FLIGHT를 잡아 두고
//   만료·SUPERSEDED 하지 않는다. STAND가 없으니 RECALL할 수 있다.

const FILE = join(config.stateDir, "proposals.jsonl");
const DAY = 86_400_000;
export const PROPOSAL_TTL_MS = DAY;
// SUPERVISOR 판정 없이 24시간이 지나 닫는 사유(ATC-152). DISPATCH 탭의 닫힌 목록이 그대로 보인다
export const NO_VERDICT_WHY = "24시간 판정 없음";
// 자동 운항(ATC-367)이 한동안 승인하지 못한 열린 ASSIGN: 사람에게 가지 않고 닫아 planner가 다시 제안한다(churned라 24시간 짝 차단에서 뺀다)
export const AUTO_STALE_WHY = "자동 운항: 승인되지 못함";
export const DISPATCH_MS = 5 * 60_000;
export const GATE = { decided: 20, agreement: 0.8 };
// 2b → 3(ATFM) 제안 기준
export const GATE3 = { dispatched: 10, readback: 0.9, departed: 0.8 };
export const READBACK_OVERDUE_MS = 10 * 60_000;
export const DEPARTURE_OVERDUE_MS = 30 * 60_000;
// STAND 없이 DEPARTED한 FLIGHT가 이만큼 ARRIVED 보고가 없으면 overdue에 올린다(만료는 하지 않는다)
export const ARRIVAL_OVERDUE_MS = DAY;
// ARRIVED한 STAND 없는 FLIGHT를 이 기간 동안 후보에서 뺀다(Linear가 아직 Todo여도). 그 뒤에는 Linear 상태를 믿는다
export const ARRIVED_EXCLUDE_MS = 7 * DAY;

export type ProposalStatus =
  | "proposed"
  | "agreed" // 2a: 나라면 승인
  | "disagreed" // 2a: 나라면 거절
  | "approved" // 2b: SUPERVISOR 승인(RELEASE는 여기서 끝 — SUPERVISOR가 Linear에서 정리)
  | "rejected"
  | "sent" // FLIGHT PLAN 보냄, READBACK 대기
  | "accepted" // CAPTAIN READBACK
  | "declined" // CAPTAIN이 사유로 거절
  | "departed" // FLIGHT에 STAND가 생김(STAND 없는 FLIGHT는 READBACK 때)
  | "arrived" // STAND 없는 FLIGHT: CAPTAIN이 끝났다고 보고함(OCC가 기록)
  | "recalling" // SUPERVISOR가 RECALL 요청, RECALL 문구의 READBACK 대기
  | "recalled" // CAPTAIN이 RECALL을 READBACK함. FLIGHT는 다시 후보(같은 짝은 24시간 제안하지 않음)
  | "superseded"
  | "closed" // 보낸 뒤의 FLIGHT가 Linear에서 이미 끝남(Done·Canceled·Duplicate, ATC-266). 되돌릴 일이 없는 정리
  | "expired";

// 제안의 AIRCRAFT를 가리키는 키. 새 기록은 registration, 옛 기록은 그때의 세션 이름(aircraftName)에서 읽는다(ATC-91)
// 이름도 없는 옛 기록은 세션 id 그대로(예전처럼)
export const regOfProposal = (p: Pick<Proposal, "registration" | "aircraftName"> & Partial<Pick<Proposal, "aircraft">>, teamPattern?: string): string | null =>
  p.registration ?? (p.aircraftName ? regKey(p.aircraftName, teamPattern) : (p.aircraft ?? null));

// SUPERSEDED 사유의 앞머리: AIRCRAFT 사정으로 닫힘
export const AIRCRAFT_WHY = "AIRCRAFT 불가";
// ACCOUNT 불일치로 닫은 카드의 사유 머리(ATC-458): AIRCRAFT 불가로 시작해 misfireOf가 wrong-aircraft로 센다. crossAccountClosedOf가 이 머리로 센다
export const CROSS_ACCOUNT_CLOSED_WHY = `${AIRCRAFT_WHY}: ${CROSS_ACCOUNT_LABEL}`;
// 승인된 ASSIGN의 AIRCRAFT에 세션이 없는 채 approvedWaitMin이 지나 닫음(ATC-388). 판정이 아니라서 24시간 짝 규칙을 시작하지 않는다
export const APPROVED_NO_SESSION_WHY = "승인 뒤 세션 없음";
// 멈춘 AIRCRAFT(RESUME·STALLED, 끝나지 않은 In Progress FLIGHT, ATC-90)로 닫힘. SUPERVISOR 판정이 아니라 24시간 짝 규칙을 시작하지 않는다
export const STOPPED_WHY = "AIRCRAFT 멈춤";
// 보냈는데 닿지 않아(ATC-183) AIRCRAFT가 더는 후보가 아니라 닫힘. SUPERVISOR 판정이 아니라 24시간 짝 규칙을 시작하지 않는다
export const DELIVERY_FAILED_WHY = `${AIRCRAFT_WHY}: 전달 실패`;
// SUPERVISOR가 승인된 카드를 화면에서 취소함(ATC-272). 사람 판정이라 24시간 짝 규칙이 시작된다
export const CANCELLED_WHY = "SUPERVISOR가 취소함";
// 받을 세션이 없어 FLIGHT PLAN을 보내지 않는다(ATC-183)
export const NO_SESSION_SEND_WHY = "AIRCRAFT 세션 없음 — 보내지 않음 (LAUNCH 필요)";

// SETTLED(ATC-117): OCC의 메모·BRIEFING과 CROSSCHECK mark는 SETTLED 제안만 받는다. 승인된 제안이거나, 열린(proposed·HELD) 채로 settleMin분 넘게 지낸 제안.
// 바로 바뀌는 제안(SUPERSEDED가 36/65)에 관제 세션의 한 바퀴를 쓰지 않으려는 것이다. 읽을 때 계산하고 기록 형식은 그대로다. 0은 예전처럼 곧장 SETTLED
export { DEFAULT_SETTLE_MIN };
export function settledOf(p: Pick<Proposal, "status" | "at">, now: number, settleMin: number): boolean {
  if (p.status === "approved") return true;
  if (p.status !== "proposed") return false;
  return now - Date.parse(p.at) >= settleMin * 60_000;
}
// SETTLED까지 남은 분(올림). 이미 SETTLED이거나 열려 있지 않으면 0
export function settlesInMin(p: Pick<Proposal, "status" | "at">, now: number, settleMin: number): number {
  if (p.status !== "proposed" || settledOf(p, now, settleMin)) return 0;
  return Math.ceil((settleMin * 60_000 - (now - Date.parse(p.at))) / 60_000);
}
// 열린·HELD 제안 하나에 settled와 남은 분을 붙인다(dispatch brief)
export const withSettled = <T extends Pick<Proposal, "status" | "at">>(p: T, now: number, settleMin: number) => ({ ...p, settled: settledOf(p, now, settleMin), settlesInMin: settlesInMin(p, now, settleMin) });

// dispatch brief의 open·held(settled·settlesInMin을 붙인 것)와 아직 SETTLED가 아닌 열린·HELD 수. 라우트는 이 결과를 그대로 싣는다
export function settledItemsOf(proposals: Proposal[], now: number, settleMin: number) {
  const open = proposals.filter((p) => p.status === "proposed" && !isHeld(p)).map((p) => withSettled(p, now, settleMin));
  const held = proposals.filter((p) => p.status === "proposed" && isHeld(p)).map((p) => withSettled(p, now, settleMin));
  return { open, held, unsettled: [...open, ...held].filter((p) => !p.settled).length };
}

export const isHeld = (p: Proposal) => p.kind === "ASSIGN" && p.holdAt !== null;
// READBACK으로 DEPARTED한 STAND 없는 FLIGHT(ARRIVED 보고 전)
export const isStandFreeAirborne = (p: Pick<Proposal, "status" | "departedVia">) => p.status === "departed" && p.departedVia === "readback";
// recalling도 CAPTAIN이 아직 쥐고 있을 수 있으니 AIRCRAFT·FLIGHT를 잡아 둔다(recalled가 되면 풀린다).
// STAND 없이 DEPARTED한 FLIGHT도 ARRIVED까지 잡아 둔다(STAND가 없어 planner가 따로 알 길이 없다)
export const isInFlight = (p: Proposal) =>
  p.kind === "ASSIGN" &&
  !isHeld(p) &&
  (p.status === "approved" || p.status === "sent" || p.status === "accepted" || p.status === "recalling" || isStandFreeAirborne(p));

export interface Proposal {
  id: string; // "D-0001"
  at: string;
  kind: "ASSIGN" | "RELEASE";
  flight: string;
  aircraft: string | null; // 만들 때의 세션 id(FUEL 귀속 등). /clear로 바뀌므로 짝·예약의 키가 아니다(ATC-91)
  aircraftName: string | null; // 만들 때의 세션 이름. send-guard가 받는 사람과 비교한다
  registration?: string; // REGISTRATION(ATC-91, registrationOf). 짝 규칙·FLIGHT 점유·유효성·예약의 키. 옛 기록에는 없다: regOfProposal이 이름에서 읽는다
  airport: string | null;
  score: number;
  factors: Factor[];
  status: ProposalStatus;
  decidedAt: string | null; // proposed에서 처음 벗어난 시각
  statusAt: string; // 마지막 상태 변경
  timeline: Partial<Record<ProposalStatus, string>>;
  reason: string | null; // 거절·SUPERSEDED·EXPIRED·DECLINED 사유
  note: string | null; // DISPATCH 세션 검토 메모
  caution: boolean;
  hold: string[]; // DISPATCH가 선행 FLIGHT로 지정한 HOLD (본문에만 있던 blocks 관계)
  holdAt: string | null; // HOLD를 건 시각. hold가 비어 있으면 선행 FLIGHT 없는 HOLD(사람 결정 대기 등, 사유는 note)
  message: string | null; // 보낸 FLIGHT PLAN 문구
  sentVia?: "fresh-start"; // FRESH START(ATC-73)가 새 세션의 첫 프롬프트로 보냈다. 없으면 OCC가 메시지로 보냄(옛 기록 포함)
  departedStand: string | null;
  departedVia?: "stand" | "readback" | "report"; // DEPARTED 근거: STAND가 생김 | STAND 없는 FLIGHT의 READBACK | STAND를 못 본 채 ARRIVED 보고로 끝남(ATC-266, accepted에서 arrived)
  arrivedNote?: string; // STAND 없는 FLIGHT의 ARRIVED 보고(결과 링크나 한 줄)
  arrivedUrl?: string; // 보고에 든 첫 링크
  recallReason?: string; // SUPERVISOR의 RECALL 사유
  recallMessage?: string; // CAPTAIN에게 보낼 RECALL 문구(send-guard가 비교한다)
  crosscheck: Crosscheck | null; // CROSSCHECK 예비 판정(참고 표시, 상태를 바꾸지 않는다)
  via?: Via; // SUPERVISOR 판정을 어떻게 내렸나(옛 기록에는 없다)
  reasonCodes?: string[]; // 거절 사유 칩(disagree·reject, 고른 것이 있을 때만)
  blind?: true; // CROSSCHECK mark를 숨긴 채(blind 표본, ATC-6) SUPERVISOR가 판정함
  briefing?: Briefing; // OCC가 쓴 쉬운 세 줄(ATC-4). 다시 쓰면 덮어쓴다. 옛 기록에는 없다
  preflight?: Preflight; // PREFLIGHT HOLD: CROSSCHECK가 FLIGHT 칩으로 disagree해 HELD로 감(ATC-3). 대기열로 돌리면 지운다
  firstHeldAt?: string; // 처음 HOLD(OCC·PREFLIGHT)된 시각. 준비율(readyRate)에 쓴다
  requeuedAt?: string; // SUPERVISOR가 HOLD를 대기열로 돌린 시각. 그 뒤로는 다시 HOLD하지 않고, 24시간 만료도 여기서 센다
  gateCodes?: string[]; // SUPERVISOR가 뒤늦게 단 사유 칩(recode, ATC-5). 게이트 계산에만 쓴다 — reasonCodes와 달리 FLIGHT 보류를 걸지 않는다
  standbyAt?: string; // CAPTAIN의 첫 STANDBY(ATC-122). READBACK overdue를 여기서 한 번 다시 센다
  standbys?: number; // STANDBY 수(두 번째부터는 기록만)
  launch?: true; // 세션이 없는 백그라운드 AIRCRAFT의 카드(ATC-129): SUPERVISOR가 승인하면 LAUNCH하고, 새 세션이 뜬 뒤 OCC가 보낸다
  launched?: LaunchResult; // 승인 때 한 LAUNCH의 결과(op launch)
  resume?: ResumeInfo; // RESUME 카드(ATC-129): 사용 한도로 끊긴 FLIGHT를 같은 REGISTRATION이 이어서 한다
  prHolder?: PrHolder; // PR HOLDER 카드(ATC-354): STAND를 쥔 세션이 없는 PR의 GO AROUND·FIX를 이어받는다. 이 카드는 머지하지 않는다
  waitingFlights?: string[]; // 이 카드를 낼 때 그 AIRCRAFT가 착륙만 기다리던 FLIGHT(ATC-387). FLIGHT PLAN이 "새 STAND에서 시작" 줄을 싣는다. 옛 기록에는 없다
  supervisorConfirm?: string[]; // SUPERVISOR CONFIRM AT AIRCRAFT(ATC-120): 예측 경로 중 사용자 등급 파일. 표시만 하고 승인을 막지 않는다. 옛 기록에는 없다
  displacedBy?: string; // 경합 보호(ATC-547): 이 카드를 "더 나은 배정"으로 밀어낸 새 카드 id(supersede의 by). 밀어낸 기록의 한 줄이다
  displacedGap?: number; // 밀어낸 점수 차(새 점수 − 이 카드 점수)
  undelivered?: { at: string; reason: string; n: number; cause?: string }; // 보낸 FLIGHT PLAN이 닿지 않았다고 OCC가 알림(ATC-183, op undelivered). 마지막 시각·사유와 횟수. 상태가 바뀌어도 지우지 않는다
  awaitSupervisor?: { at: string; reason: string }; // CAPTAIN이 READBACK도 거절도 아닌 채 사용자의 go를 기다림(ATC-120). sent인 동안만 — 상태가 바뀌면(READBACK 등) 지운다
}

type Create = Omit<Proposal, "status" | "decidedAt" | "statusAt" | "timeline" | "reason" | "note" | "caution" | "hold" | "holdAt" | "message" | "departedStand" | "crosscheck">;
export type Op =
  // ageFrom(ATC-547): 밀려난 카드의 FLIGHT를 다시 제안하는 카드가 원래 카드의 나이(at)를 이어받는다. SETTLED·자동 승인·TTL이 이 시각부터 센다
  | ({ op: "create"; ageFrom?: string } & Create)
  | { op: "verdict"; id: string; at: string; verdict: "agree" | "disagree"; reason: string | null; via?: Via; reasonCodes?: string[]; blind?: true }
  | { op: "note"; id: string; at: string; text: string; caution: boolean }
  | ({ op: "brief"; id: string } & Briefing)
  | { op: "hold"; id: string; at: string; blockedBy: string[] }
  | { op: "preflight"; id: string; at: string; by: string; model: string; codes: string[]; reason: string } // 서버가 CROSSCHECK mark를 보고 건다
  | { op: "requeue"; id: string; at: string } // SUPERVISOR: HOLD를 풀어 같은 제안을 대기열로
  | { op: "recode"; id: string; at: string; by: string; codes: string[] } // SUPERVISOR: 지난 거절에 사유 칩(게이트 계산만)
  | ({ op: "crosscheck"; id: string } & CrosscheckLine)
  | { op: "approve"; id: string; at: string; via?: Via; blind?: true }
  | { op: "reject"; id: string; at: string; reason: string | null; via?: Via; reasonCodes?: string[]; blind?: true }
  | { op: "send"; id: string; at: string; message: string; via?: "fresh-start" } // via: FRESH START(ATC-73)가 새 세션의 첫 프롬프트로 보냄. 없으면 OCC의 메시지
  | { op: "accept"; id: string; at: string }
  | { op: "decline"; id: string; at: string; reason: string } // CAPTAIN의 UNABLE D-xxxx(ATC-122)도 이것
  | { op: "undelivered"; id: string; at: string; reason: string; cause?: string } // OCC의 SendMessage가 실패함(ATC-183). sent를 approved로 돌린다. SUPERVISOR 판정이 아니다
  | { op: "standby"; id: string; at: string } // CAPTAIN의 STANDBY D-xxxx(ATC-122). 상태는 sent 그대로
  | { op: "launch"; id: string; at: string; ok: boolean; by: string; jobId?: string; error?: string } // launch 카드 승인 때의 LAUNCH 결과(ATC-129). 상태는 그대로
  | { op: "relaunch"; id: string; at: string } // 승인된 ASSIGN의 AIRCRAFT에 세션이 없어 서버가 LAUNCH하기로 함(ATC-388). 그 카드가 launch 카드가 된다(상태는 그대로)
  | { op: "await-supervisor"; id: string; at: string; reason: string } // CAPTAIN이 사용자의 go를 기다림(ATC-120). 상태는 sent 그대로, awaitSupervisor만 붙는다
  | { op: "depart"; id: string; at: string; stand: string | null; via?: "readback" } // stand null: STAND 없는 FLIGHT의 READBACK
  | { op: "arrived"; id: string; at: string; note: string } // STAND 없는 FLIGHT: CAPTAIN 보고
  | { op: "recall"; id: string; at: string; reason: string; message: string } // SUPERVISOR 요청
  | { op: "recalled"; id: string; at: string } // CAPTAIN이 RECALL을 READBACK
  | { op: "supersede"; id: string; at: string; reason: string; by?: string; gap?: number } // by·gap: 경합 보호가 켜졌을 때 "더 나은 배정"으로 밀어낸 새 카드와 점수 차(ATC-547)
  | { op: "close"; id: string; at: string; reason: string } // 보낸 뒤 FLIGHT가 이미 끝나 정리(ATC-266). sent·accepted·STAND 없는 departed에만
  | { op: "expire"; id: string; at: string; reason?: string };

type StatusOp = Exclude<Op["op"], "create" | "note" | "brief" | "hold" | "crosscheck" | "preflight" | "requeue" | "recode" | "standby" | "launch" | "relaunch" | "await-supervisor" | "undelivered">;

// 상태 전이 규칙. 여기 없는 전이는 무시한다(API도 같은 규칙으로 검사한다).
const NEXT: Partial<Record<ProposalStatus, Partial<Record<StatusOp, ProposalStatus>>>> = {
  proposed: { verdict: "agreed", approve: "approved", reject: "rejected", supersede: "superseded", expire: "expired" },
  // 그림자(나라면 승인·거절) 표시만 받고 SUPERVISOR 판정 없이 24시간이 지나면 닫는다(ATC-152)
  agreed: { expire: "expired" },
  disagreed: { expire: "expired" },
  approved: { send: "sent", supersede: "superseded", expire: "expired" },
  sent: { accept: "accepted", decline: "declined", recall: "recalling", close: "closed", expire: "expired" },
  // accepted의 arrived: STAND를 못 본 채 ARRIVED 보고가 있는 FLIGHT(ATC-266, arrivedWhyNot가 route에서 검사)
  accepted: { depart: "departed", arrived: "arrived", recall: "recalling", close: "closed", expire: "expired" },
  departed: { arrived: "arrived", recall: "recalling", close: "closed" }, // STAND 없이 DEPARTED한 것만(canApply)
  recalling: { recalled: "recalled", expire: "expired" },
};

export function canApply(p: Proposal, op: StatusOp): boolean {
  if (op === "send" && p.kind !== "ASSIGN") return false;
  // STAND가 생긴 DEPARTED는 LOGBOOK(머지)으로 끝나고 RECALL하지 않는다
  if (p.status === "departed" && !isStandFreeAirborne(p)) return false;
  return Boolean(NEXT[p.status]?.[op]);
}

// CROSSCHECK mark는 SUPERVISOR가 판정할 열린 제안(proposed, HOLD 아님)에만 받는다
export const canCrosscheck = (p: Proposal) => p.status === "proposed" && !isHeld(p);

// SUPERVISOR 판정(shadow agreed/disagreed, approval approved/rejected). 사유는 판정한 상태에 머물러 있을 때만
// (approved 뒤의 reason은 DECLINED·SUPERSEDED 같은 다른 사유다)
export function humanOf(p: Proposal): HumanDecision | null {
  if (p.via === "atfm" || p.via === "preflight" || p.via === "auto") return null; // 자동 판정(ATFM·auto)과 PREFLIGHT 확정은 사람 판정으로 세지 않는다
  const t = p.timeline;
  const at = t.agreed ?? t.disagreed ?? t.approved ?? t.rejected;
  if (!at) return null;
  const verdict = t.agreed || t.approved ? "agree" : "disagree";
  const reason = (p.status === "agreed" || p.status === "disagreed" || p.status === "rejected") && p.reason ? p.reason : null;
  return { verdict, at, reason, ...(p.via ? { via: p.via } : {}) };
}

// 보고 한 줄에서 첫 http(s) 링크
export const urlOf = (text: string) => /https?:\/\/[^\s<>"')\]]+/.exec(text)?.[0] ?? null;

// STAND가 필요 없는 FLIGHT(SURVEY·CHECK)인가. 모르는 FLIGHT는 STAND가 필요한 쪽으로 본다(planner와 같다)
export const standFreeTicket = (t: Pick<Ticket, "labels"> | undefined) => Boolean(t) && !needsStand(classOf(t!.labels ?? []).type);

// CAPTAIN의 READBACK. STAND 없는 FLIGHT는 같은 시각에 DEPARTED(stand null)까지 남긴다
export function readbackOps(p: Pick<Proposal, "id">, ticket: Pick<Ticket, "labels"> | undefined, at: string): Op[] {
  const ops: Op[] = [{ op: "accept", id: p.id, at }];
  if (standFreeTicket(ticket)) ops.push({ op: "depart", id: p.id, at, stand: null, via: "readback" });
  return ops;
}

export function fold(ops: Op[]): Proposal[] {
  const byId = new Map<string, Proposal>();
  for (const o of ops) {
    if (o.op === "create") {
      const { op: _op, ageFrom, ...rest } = o;
      byId.set(o.id, {
        ...rest, ...(ageFrom ? { at: ageFrom } : {}), status: "proposed", decidedAt: null, statusAt: o.at, timeline: { proposed: o.at },
        reason: null, note: null, caution: false, hold: [], holdAt: null, message: null, departedStand: null, crosscheck: null,
      });
      continue;
    }
    const p = byId.get(o.id);
    if (!p) continue;
    if (o.op === "note") {
      p.note = o.text;
      p.caution = o.caution;
      continue;
    }
    if (o.op === "brief") {
      p.briefing = { what: o.what, why: o.why, risk: o.risk, at: o.at };
      continue;
    }
    if (o.op === "hold") {
      p.hold = [...new Set(o.blockedBy)].sort();
      p.holdAt = o.at;
      p.firstHeldAt ??= o.at;
      continue;
    }
    if (o.op === "preflight") {
      if (p.status !== "proposed" || isHeld(p)) continue;
      p.preflight = { at: o.at, by: o.by, model: o.model, codes: o.codes, reason: o.reason };
      p.hold = [];
      p.holdAt = o.at;
      p.firstHeldAt ??= o.at;
      continue;
    }
    if (o.op === "recode") {
      // 그림자 거절에만. 나중 recode가 앞의 것을 대신한다
      if (p.status === "disagreed") p.gateCodes = o.codes;
      continue;
    }
    if (o.op === "requeue") {
      if (p.status !== "proposed" || !isHeld(p)) continue;
      p.hold = [];
      p.holdAt = null;
      delete p.preflight;
      p.requeuedAt = o.at;
      continue;
    }
    if (o.op === "standby") {
      // READBACK을 기다리는 FLIGHT PLAN(sent)에만. 첫 STANDBY만 overdue 기준을 옮긴다
      if (p.status !== "sent") continue;
      p.standbyAt ??= o.at;
      p.standbys = (p.standbys ?? 0) + 1;
      continue;
    }
    if (o.op === "relaunch") {
      // 승인된 ASSIGN(launch 카드 아님)만(ATC-388). 이 뒤로 launch 카드와 같은 길이다: LAUNCH 결과(op launch), LAUNCHING 기다림, 유예가 지나면 SUPERSEDED
      if (p.kind === "ASSIGN" && p.status === "approved" && !p.launch) p.launch = true;
      continue;
    }
    if (o.op === "launch") {
      // 승인된 launch 카드에만(ATC-129). 나중 결과가 앞의 것을 대신한다
      if (p.launch && p.status === "approved") p.launched = { at: o.at, ok: o.ok, by: o.by, ...(o.jobId ? { jobId: o.jobId } : {}), ...(o.error ? { error: o.error } : {}) };
      continue;
    }
    if (o.op === "undelivered") {
      // 보냈다고 했지만 닿지 않은 FLIGHT PLAN(sent)만. approved로 돌려 다음 release가 다시 시도한다. 승인 시각은 지킨다(SUPERVISOR 판정이 아니다)
      if (p.status !== "sent") continue;
      p.status = "approved";
      p.statusAt = o.at;
      delete p.timeline.sent;
      p.message = null;
      delete p.standbyAt;
      delete p.standbys;
      delete p.awaitSupervisor;
      p.undelivered = { at: o.at, reason: o.reason, n: (p.undelivered?.n ?? 0) + 1, cause: causeOf(o.reason, o.cause) };
      continue;
    }
    if (o.op === "await-supervisor") {
      // 보냈는데 READBACK이 없는 FLIGHT PLAN(sent)에만. 다시 부르면 사유만 새로 하고 처음 시각을 지킨다
      if (p.status !== "sent") continue;
      p.awaitSupervisor = { at: p.awaitSupervisor?.at ?? o.at, reason: o.reason };
      continue;
    }
    if (o.op === "crosscheck") {
      // 열린(HOLD 아닌) 제안에만. 나중 mark가 앞의 것을 대신한다
      if (canCrosscheck(p)) p.crosscheck = markOf(o);
      continue;
    }
    if (!canApply(p, o.op)) continue;
    let next = NEXT[p.status]![o.op]!;
    const prev = p.status;
    if (o.op === "verdict" && o.verdict === "disagree") next = "disagreed";
    if (p.status === "proposed") p.decidedAt = o.at;
    p.status = next;
    p.statusAt = o.at;
    p.timeline[next] = o.at;
    delete p.awaitSupervisor; // READBACK·거절·RECALL·만료 어느 쪽이든 대기는 끝났다
    if ("reason" in o && o.reason) p.reason = o.reason;
    if (o.op === "supersede" && o.by) {
      p.displacedBy = o.by;
      if (typeof o.gap === "number") p.displacedGap = o.gap;
    }
    if (o.op === "send") {
      p.message = o.message;
      if (o.via) p.sentVia = o.via;
    }
    if (o.op === "recall") {
      p.recallReason = o.reason;
      p.recallMessage = o.message;
    }
    if (o.op === "arrived" && prev === "accepted") {
      // STAND를 본 적 없이 보고로 끝난 FLIGHT. FOLLOWING·LOGBOOK이 STAND 있는 FLIGHT로 읽지 않게 근거를 남긴다
      p.departedStand = null;
      p.departedVia = "report";
    }
    if (o.op === "depart") {
      p.departedStand = o.stand;
      p.departedVia = o.stand === null ? "readback" : "stand";
    }
    if (o.op === "arrived") {
      p.arrivedNote = o.note;
      const url = urlOf(o.note);
      if (url) p.arrivedUrl = url;
    }
    if ((o.op === "verdict" || o.op === "approve" || o.op === "reject") && o.via) p.via = o.via;
    if ((o.op === "verdict" || o.op === "reject") && o.reasonCodes?.length) p.reasonCodes = o.reasonCodes;
    if ((o.op === "verdict" || o.op === "approve" || o.op === "reject") && o.blind) p.blind = true;
  }
  return [...byId.values()];
}

// approved·sent·accepted인 ASSIGN의 AIRCRAFT·FLIGHT — 새 계획에서 빼서 중복 배정을 막는다.
// HOLD 걸린 ASSIGN은 FLIGHT만 잡아 둔다: AIRCRAFT는 아직 아무도 안 쥐었지만,
// FLIGHT는 DISPATCH가 "선행이 끝날 때까지 착수하지 않는다"고 정한 것이라 다시 제안하면 안 된다.
// (이게 없으면 HELD 제안을 만든 다음 바퀴에 같은 FLIGHT가 다른 AIRCRAFT로 곧바로 다시 나온다.)
// 같은 짝을 다시 제안하지 않는 기간: 만든 때부터 24시간, RECALL된 짝은 RECALL READBACK부터 24시간. 지났으면 null
// 대기열로 돌린(requeue) 제안은 돌린 때부터 24시간(열려 있는 동안 같은 짝을 또 만들지 않게)
function pairUntil(p: Pick<Proposal, "at" | "timeline" | "requeuedAt">, now: number): number | null {
  const from = (iso: string | undefined) => (iso ? Date.parse(iso) + PROPOSAL_TTL_MS : 0);
  const until = Math.max(from(p.at), from(p.timeline.recalled), from(p.requeuedAt));
  return until > now ? until : null;
}
// "더 나은 배정으로 바뀜"으로 닫힌 제안은 판정받지 못한 것이다. 24시간 규칙에서 빼 다시 후보가 되게 한다
// ACCOUNT 불일치로 닫은 카드(ATC-458)도 판정이 아니다: AIRCRAFT가 닿게 되면 같은 짝이 다시 후보가 된다
// LAUNCH 실패(ATC-129)도 판정이 아니다: 다음 계획에 같은 카드가 다시 나와 SUPERVISOR가 다시 승인할 수 있다(스스로 다시 띄우지는 않는다)
const churned = (p: Pick<Proposal, "status" | "reason">) =>
  p.status === "superseded" && [BETTER_WHY, STOPPED_WHY, LAUNCH_FAILED_WHY, DELIVERY_FAILED_WHY, AUTO_STALE_WHY, CROSS_ACCOUNT_CLOSED_WHY].some((w) => (p.reason ?? "").startsWith(w));
// 판정 대기 중인 제안을 바꾸려면 새 제안 점수가 이만큼(비율) 높아야 한다
export const REPLACE_MARGIN = 0.2;

// 24시간 안에 제안됐다 닫힌 ASSIGN 짝 → 다시 가능한 시각. planner(Reserved.recentPairs)와 syncOps(seen)가 같은 기준을 쓴다.
// 열린 제안(proposed)은 빼서 계획에 그대로 남게 한다. 진행 중(approved·sent·…)인 것은 어차피 예약돼 있다.
export function recentPairsOf(existing: Proposal[], now: number): Map<string, { id: string; until: string }> {
  const out = new Map<string, { id: string; until: string }>();
  for (const p of existing) {
    const reg = regOfProposal(p);
    if (p.kind !== "ASSIGN" || !reg || p.status === "proposed" || churned(p)) continue;
    const until = pairUntil(p, now);
    if (until === null) continue;
    const key = `${p.flight}|${reg}`;
    const prev = out.get(key);
    if (!prev || Date.parse(prev.until) < until) out.set(key, { id: p.id, until: new Date(until).toISOString() });
  }
  return out;
}

// FLIGHT 자체의 문제로 거절된 ASSIGN(사유 칩이 FLIGHT_HOLD_CODES 중 하나) → 그 FLIGHT를 모든 AIRCRAFT에서 보류.
// 판정(decidedAt)부터 24시간. 이슈가 판정 뒤에 바뀌면 planner가 먼저 푼다. 칩이 없는 옛 판정은 짝 차단만 받는다.
export function recentFlightsOf(existing: Proposal[], now: number): NonNullable<Reserved["recentFlights"]> {
  const out: NonNullable<Reserved["recentFlights"]> = new Map();
  for (const p of existing) {
    if (p.kind !== "ASSIGN" || (p.status !== "disagreed" && p.status !== "rejected") || !p.decidedAt) continue;
    const codes = (p.reasonCodes ?? []).filter((c) => (FLIGHT_HOLD_CODES as readonly string[]).includes(c));
    if (!codes.length) continue;
    const until = Date.parse(p.decidedAt) + PROPOSAL_TTL_MS;
    if (until <= now) continue;
    const prev = out.get(p.flight);
    if (!prev || prev.decidedAt < p.decidedAt) out.set(p.flight, { id: p.id, decidedAt: p.decidedAt, until: new Date(until).toISOString(), codes });
  }
  return out;
}

export function reservedOf(existing: Proposal[], now = Date.now()): Reserved {
  const live = existing.filter((p) => isInFlight(p) && regOfProposal(p));
  const held = existing.filter((p) => p.status === "proposed" && isHeld(p));
  return {
    aircraft: new Map(live.map((p) => [regOfProposal(p)!, p.id])),
    flights: new Map([...live, ...held].map((p) => [p.flight, p.id])),
    held: new Map(held.map((p) => [p.flight, `${p.id} — ${p.hold.length ? "선행 FLIGHT 대기" : "사람 결정 대기"}`])),
    // AIRCRAFT가 STAND 있는 FLIGHT와 없는 FLIGHT(SURVEY·CHECK)를 함께 쥘 수 있어 한 대의 제안을 모두 넘긴다
    aircraftFlights: live.reduce((m, p) => m.set(regOfProposal(p)!, [...(m.get(regOfProposal(p)!) ?? []), p.flight]), new Map<string, string[]>()),
    recentPairs: recentPairsOf(existing, now),
    recentFlights: recentFlightsOf(existing, now),
    arrived: arrivedOf(existing, now),
  };
}

// 최근 ARRIVED한 STAND 없는 FLIGHT → 제안 id. LOGBOOK에 남지 않으니 planner가 다시 후보로 올리지 않게 넘긴다
export function arrivedOf(existing: Proposal[], now: number): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of existing) {
    if (p.status !== "arrived" || now - Date.parse(p.statusAt) > ARRIVED_EXCLUDE_MS) continue;
    const prev = out.get(p.flight);
    if (!prev || prev < p.id) out.set(p.flight, p.id);
  }
  return out;
}

// 보낼 수 없는 까닭(ATC-91): 그 AIRCRAFT가 /clear 뒤 첫 메시지를 기다리는 중이고 살아 있는 세션이 아직 없다. 아니면 null
export function restartingWhyOf(p: Proposal, s: Pick<Snapshot, "sessions"> & Partial<Pick<Snapshot, "restarting">>, teamPattern?: string): string | null {
  const reg = regOfProposal(p, teamPattern);
  if (!reg || s.sessions.some((x) => x.status !== "dead" && regKey(x.name, teamPattern) === reg)) return null;
  return s.restarting?.some((r) => r.registration === reg) ? `${p.aircraftName ?? reg}: ${RESTARTING_TEXT} — 새 세션이 뜬 뒤에 보낸다(승인은 그대로다)` : null;
}

// 받을 세션이 없어 보내지 않는 까닭(ATC-183). RESTARTING이든 아니든 살아 있는 세션이 없으면 보내지 않는다(없는 곳으로 보내고 SENT로 두지 않는다).
// launch 카드는 LAUNCH가 FLIGHT PLAN을 첫 프롬프트로 가져가므로 뺀다(launchReleaseWhyOf가 따로 본다)
export function noLiveSessionWhyOf(p: Pick<Proposal, "launch" | "registration" | "aircraftName"> & Partial<Pick<Proposal, "aircraft">>, s: Pick<Snapshot, "sessions">, teamPattern?: string): string | null {
  if (p.launch) return null;
  const reg = regOfProposal(p, teamPattern);
  if (!reg || s.sessions.some((x) => x.status !== "dead" && regKey(x.name, teamPattern) === reg)) return null;
  return `${p.aircraftName ?? reg}: ${NO_SESSION_SEND_WHY}`;
}

// 승인됐는데 AIRCRAFT에 살아 있는 세션이 없는 ASSIGN(ATC-388): 서버가 LAUNCH하거나(auto-approve-run.ts runApprovedRelaunch) waitMin 뒤 닫는다.
// waiting: 지금 기다리는 수, overdue: 그중 waitMin을 넘긴 수(서버가 닫기 전에 이 수가 0보다 크면 LAUNCH도 닫기도 안 되고 있다는 신호), closed24h: 지난 24시간에 이 사유로 닫은 수
export function approvedNoSessionOf(proposals: readonly Proposal[], s: Pick<Snapshot, "sessions">, now: number, waitMin: number, teamPattern?: string) {
  const live = (reg: string) => s.sessions.some((x) => x.status !== "dead" && regKey(x.name, teamPattern) === reg);
  const waiting = proposals.filter((p) => {
    const reg = regOfProposal(p, teamPattern);
    return p.kind === "ASSIGN" && p.status === "approved" && Boolean(reg) && !live(reg!);
  });
  const age = (p: Proposal) => now - Date.parse(p.timeline.approved ?? p.statusAt);
  // ATC-534: 그 AIRCRAFT가 job이 사라져(프로세스 없음) 세션이 없는 카드. waiting에 이미 들어 있다
  const gone = (p: Proposal) => s.sessions.some((x) => x.status === "dead" && x.jobGone && regKey(x.name, teamPattern) === regOfProposal(p, teamPattern));
  return {
    waiting: waiting.length,
    jobGone: waiting.filter(gone).length,
    overdue: waiting.filter((p) => age(p) > waitMin * 60_000).length,
    closed24h: proposals.filter((p) => p.status === "superseded" && (p.reason ?? "").startsWith(APPROVED_NO_SESSION_WHY) && now - Date.parse(p.statusAt) < 86_400_000).length,
    waitMin,
  };
}

// 보낼 때의 받는 이(ATC-353): 그 REGISTRATION의 살아 있는 세션. sendTo는 그대로 제안의 aircraftName이다 — OCC의 send-guard가 받는 이를 이 이름과 비교하므로 바꾸지 않는다.
// 살아 있는 세션을 찾으면 선택 필드 sendToName(그 세션의 지금 이름)·sendToId·sendToJobId·sendToAccount를 더한다. 못 찾으면 없다
export function sendAddressOf(p: Pick<Proposal, "registration" | "aircraftName"> & Partial<Pick<Proposal, "aircraft">>, s: Pick<Snapshot, "sessions">, teamPattern?: string) {
  const r = resolveRecipient(s.sessions, { registration: regOfProposal(p, teamPattern) }, teamPattern);
  if (!r.ok) return { sendTo: p.aircraftName };
  return { sendTo: p.aircraftName, sendToName: r.session.name, sendToId: r.session.id, ...(r.session.jobId ? { sendToJobId: r.session.jobId } : {}), ...(r.session.account ? { sendToAccount: r.session.account } : {}) };
}

// ACCOUNT 사이 전달(ATC-251): OCC와 받을 AIRCRAFT의 관찰한 ACCOUNT가 다르면 FLIGHT PLAN이 닿지 않는다. 한쪽이라도 모르면 막지 않는다
export function crossAccountWhyOf(p: Pick<Proposal, "launch" | "registration" | "aircraftName"> & Partial<Pick<Proposal, "aircraft">>, s: Pick<Snapshot, "sessions">, teamPattern?: string): string | null {
  if (p.launch) return null;
  const reg = regOfProposal(p, teamPattern);
  if (!reg) return null;
  const live = (x: Snapshot["sessions"][number]) => x.status !== "dead";
  const to = s.sessions.find((x) => live(x) && regKey(x.name, teamPattern) === reg);
  const from = s.sessions.find((x) => live(x) && x.name === "OCC");
  return unreachableWhy({ fromName: "OCC", from: from?.account, toName: p.aircraftName ?? reg, to: to?.account });
}

// 승인됐는데 ACCOUNT 불일치로 보내지 못하는 카드 → FOLLOW·STATUS에 보일 한 줄(ATC-458). 짧은 글: 누가 어느 ACCOUNT에 있나. 한쪽이라도 모르면 없다
export function crossAccountCardWaitsOf(proposals: readonly Proposal[], s: Pick<Snapshot, "sessions">, teamPattern?: string): Record<string, string> {
  const out: Record<string, string> = {};
  const from = s.sessions.find((x) => x.status !== "dead" && x.name === "OCC");
  for (const p of proposals) {
    if (p.kind !== "ASSIGN" || p.status !== "approved" || !crossAccountWhyOf(p, s, teamPattern)) continue;
    const reg = regOfProposal(p, teamPattern)!;
    const to = s.sessions.find((x) => x.status !== "dead" && regKey(x.name, teamPattern) === reg);
    out[p.id] = `${CROSS_ACCOUNT_LABEL} — ${p.aircraftName ?? reg}(${to?.account}) ≠ OCC(${from?.account}), OCC가 닿지 못함`;
  }
  return out;
}

// RESTARTING(ATC-91): /clear 뒤 첫 메시지를 기다리는 AIRCRAFT의 열린·승인된 ASSIGN → 카드가 보일 글.
// LAUNCHING(ATC-129): LAUNCH한 launch 카드의 AIRCRAFT에 아직 세션이 없다(계획에 absent로 남음)
export function waitingOf(proposals: Proposal[], plan: Pick<Plan, "aircraft">, teamPattern?: string, sessions?: Pick<Snapshot, "sessions">): Record<string, string> {
  const restarting = new Set(plan.aircraft.filter((a) => a.restarting).map((a) => regOfAircraft(a, teamPattern)));
  const absent = new Set(plan.aircraft.filter((a) => a.launch).map((a) => regOfAircraft(a, teamPattern)));
  const out: Record<string, string> = {};
  let crossWhy: string | null;
  for (const p of proposals) {
    if (p.kind !== "ASSIGN" || (p.status !== "proposed" && p.status !== "approved")) continue;
    const reg = regOfProposal(p, teamPattern) ?? "";
    if (restarting.has(reg)) out[p.id] = RESTARTING_TEXT;
    else if (p.status === "approved" && p.launched?.ok && absent.has(reg)) out[p.id] = LAUNCHING_TEXT;
    else if (sessions && p.kind === "ASSIGN" && (crossWhy = crossAccountWhyOf(p, sessions, teamPattern))) out[p.id] = `${CROSS_ACCOUNT_LABEL} — ${crossWhy}`; // ATC-251: 보내기 전에 카드가 먼저 말한다
  }
  return out;
}

// 보낸 뒤(sent·accepted·STAND 없는 departed)의 제안을 FLIGHT가 이미 끝났을 때 정리한다(ATC-266). 순수.
// - Canceled·Duplicate: close. 하던 일이 없어졌다.
// - Completed: STAND를 본 적 없는 accepted나 STAND 없이 departed한 것은 ARRIVED 보고(dispatch report)나 머지된 PR이 있으면 arrived로, 없으면 STAND 없는 FLIGHT는 보고를 기다리게 그대로 둔다
//   (STAND가 있는 accepted는 depart가 먼저). 그 밖(sent, STAND 없는 FLIGHT가 아닌 accepted)은 close
// - recalling은 건드리지 않는다: RECALL의 READBACK이 남아 있다. STAND가 있는 departed는 LOGBOOK(머지)이 끝낸다
export function inFlightDoneOp(
  p: Proposal,
  t: Pick<Ticket, "stateType" | "state" | "labels"> | undefined,
  ctx: { at: string; standNow: boolean; report?: Pick<ArrivalReport, "pr" | "result">; landedPr?: string },
): Op | null {
  if (p.kind !== "ASSIGN" || !t || !DONE_STATES.has(t.stateType)) return null;
  const airborneFree = isStandFreeAirborne(p);
  if (p.status !== "sent" && p.status !== "accepted" && !airborneFree) return null;
  const why = stateChangedWhy(t.state);
  if (t.stateType !== "completed") return { op: "close", id: p.id, at: ctx.at, reason: why };
  const sawStand = Boolean(p.timeline.departed) || ctx.standNow;
  if (p.status === "accepted" && sawStand) return null; // STAND가 있으면 depart가 먼저(PR 머지는 LOGBOOK이 ARRIVED)
  if (p.status !== "sent" && (ctx.report || ctx.landedPr)) {
    const note = ctx.report ? (ctx.report.pr !== null ? `PR #${ctx.report.pr} (ARRIVED 보고)` : `RESULT ${ctx.report.result} (ARRIVED 보고)`) : `PR ${ctx.landedPr} 머지됨(LOGBOOK)`;
    return { op: "arrived", id: p.id, at: ctx.at, note };
  }
  if (airborneFree || (p.status === "accepted" && standFreeTicket(t))) return null; // STAND 없는 FLIGHT는 ARRIVED 보고를 기다린다
  return { op: "close", id: p.id, at: ctx.at, reason: why };
}

// dispatch arrived가 accepted·departed에서 받는 조건(ATC-266). 받을 수 없으면 사유, 받으면 null. 순수
// accepted: STAND 없는 FLIGHT(SURVEY·CHECK), 또는 STAND를 본 적 없고 ARRIVED 보고(dispatch report)가 기록된 FLIGHT
export function arrivedWhyNot(
  p: Pick<Proposal, "status" | "departedVia" | "timeline">,
  t: Pick<Ticket, "labels"> | undefined,
  ctx: { standNow: boolean; departureSeen: boolean; report: boolean },
): string | null {
  if (p.status === "departed" && p.departedVia !== "readback") return "STAND가 있는 FLIGHT는 LOGBOOK(PR 머지)으로 ARRIVED — dispatch arrived는 STAND 없는 FLIGHT만";
  if (p.status !== "accepted") return null;
  if (standFreeTicket(t)) return null;
  if (p.timeline.departed || ctx.standNow || ctx.departureSeen) return "STAND가 있는(또는 있었던) FLIGHT는 LOGBOOK(PR 머지)으로 ARRIVED — accepted에서 dispatch arrived는 STAND 없는 FLIGHT만";
  if (!ctx.report) return "STAND를 본 적 없는 FLIGHT는 ARRIVED 보고가 먼저 — `dispatch report`로 기록한 뒤 dispatch arrived";
  return null;
}

// ── 경합 보호(ATC-547) ──
// 열린 ASSIGN 카드가 자리를 잡은(settled) 순간에 더 높은 점수의 새 카드가 같은 AIRCRAFT를 가져가면, 점수가 낮은 FLIGHT는 자동 승인 직전마다 카드를 잃고 계속 기다렸다(10-05 ATC-539, 30분에 세 번).
// 보호하는 카드: (a) 자동 운항에서 settleMin이 지났거나 다음 계획 주기(DISPATCH_MS) 안에 지날 카드, (c) 24시간에 두 번 밀려난 FLIGHT의 카드. 보호한 카드는 "더 나은 배정"으로 닫지 않는다.
// 계획이 그 카드의 짝을 뺐으면(droppedGuardedOf) 호출부가 그 짝을 예약으로 넣어 다시 계획한다: 점수가 더 높은 FLIGHT는 다른 빈 AIRCRAFT(자격·AIRPORT는 planner가 따진다)로 가고, 없으면 한 주기 기다린다
export const DISPLACE_MAX_24H = 2;
// 밀려난 FLIGHT의 새 카드가 나이를 이어받는 창: 밀려난 지 이 안이어야 한다(옛 나이로 곧바로 AUTO_STALE이 되지 않게)
const DISPLACE_AGE_WINDOW_MS = 30 * 60_000;
// 24시간 안에 이 FLIGHT의 카드가 "더 나은 배정"으로 밀려난 횟수(밀어낸 기록 by가 있는 것만)
export const displacedCountOf = (existing: readonly Proposal[], flight: string, now: number): number =>
  existing.filter((x) => x.kind === "ASSIGN" && x.flight === flight && x.status === "superseded" && x.displacedBy && now - Date.parse(x.statusAt) < DAY).length;
export function guardedOf(existing: readonly Proposal[], cfg: Pick<DispatchConfig, "contestGuard" | "autoDispatch" | "settleMin">, now: number): Set<string> {
  const out = new Set<string>();
  if (cfg.contestGuard !== "on") return out;
  for (const p of existing) {
    if (p.kind !== "ASSIGN" || p.status !== "proposed" || isHeld(p) || p.prHolder || p.resume) continue;
    const settling = cfg.autoDispatch === "on" && now - Date.parse(p.at) + DISPATCH_MS >= cfg.settleMin * 60_000;
    if (settling || displacedCountOf(existing, p.flight, now) >= DISPLACE_MAX_24H) out.add(p.id);
  }
  return out;
}
// 보호하는데 계획이 짝을 뺀 카드: 호출부가 이 카드의 AIRCRAFT·FLIGHT를 예약으로 넣고 다시 계획한다
export function droppedGuardedOf(existing: readonly Proposal[], plan: Pick<Plan, "assign">, guarded: ReadonlySet<string>, teamPattern?: string): Proposal[] {
  const planned = new Set(plan.assign.map((a) => `${a.flight}|${regOfAssign(a, teamPattern)}`));
  return existing.filter((p) => guarded.has(p.id) && !planned.has(`${p.flight}|${regOfProposal(p, teamPattern)}`));
}

// 열린 제안 수(openProposals) 상태(ATC-403). 수가 상한이면 계획이 낸 짝 가운데 상한 때문에 카드가 못 된 FLIGHT를 적는다.
// 세는 기준은 syncOps와 같다: 결정 안 된 ASSIGN. HELD·RESUME·PR HOLDER 카드는 세지 않는다. 읽기만 하고 상한 값은 바꾸지 않는다
export interface CapView {
  open: number;
  cap: number;
  full: boolean;
  waitingForCap: { flight: string; aircraft: string | null; airport: string | null; score: number }[]; // 상한 때문에 제안되지 못한 FLIGHT(점수 높은 순). 브리프의 held(HOLD 카드)와 다르다
}
export function capStateOf(proposals: Proposal[], plan: Pick<Plan, "assign">, cfg: Pick<DispatchConfig, "slots" | "teamPattern">, now: number): CapView {
  const cap = cfg.slots.openProposals;
  const openCards = proposals.filter((p) => p.kind === "ASSIGN" && p.status === "proposed" && !isHeld(p) && !p.resume && !p.prHolder);
  const open = openCards.length;
  if (open < cap) return { open, cap, full: false, waitingForCap: [] };
  const cardFlights = new Set(proposals.filter((p) => p.kind === "ASSIGN" && p.status === "proposed").map((p) => p.flight));
  const recent = recentPairsOf(proposals, now);
  const waitingForCap = plan.assign
    .filter((a) => !cardFlights.has(a.flight) && !recent.has(`${a.flight}|${regOfAssign(a, cfg.teamPattern)}`))
    .map((a) => ({ flight: a.flight, aircraft: a.aircraftName, airport: a.airport || null, score: a.score }))
    .sort((x, y) => y.score - x.score);
  return { open, cap, full: true, waitingForCap };
}

let lastCap: CapView | null = null;
export const lastCapView = () => lastCap;

// 새 계획과 열린 제안을 맞춘다. 순수 함수: 추가할 op만 돌려준다.
export function syncOps(
  existing: Proposal[],
  plan: Plan,
  s: Pick<Snapshot, "tickets" | "workspaces"> & Partial<Pick<Snapshot, "pulls">>,
  cfg: DispatchConfig,
  now: number,
  seq: number,
  landed: Landed = new Map(),
  reports: Map<string, Pick<ArrivalReport, "pr" | "result">> = new Map(),
): Op[] {
  const at = new Date(now).toISOString();
  const ops: Op[] = [];
  const stateOf = new Map(s.tickets.map((t) => [t.key, t]));
  // 제안의 AIRCRAFT는 REGISTRATION으로 찾는다(ATC-91): /clear로 세션 id가 바뀌어도 같은 AIRCRAFT다
  const tp = cfg.teamPattern;
  const aircraftOf = new Map(plan.aircraft.map((a) => [regOfAircraft(a, tp), a]));
  const planned = new Set(plan.assign.map((a) => `${a.flight}|${regOfAssign(a, tp)}`));
  const regOf = (p: Proposal) => regOfProposal(p, tp);
  const acOf = (p: Proposal) => {
    const reg = regOf(p);
    return reg ? aircraftOf.get(reg) : undefined;
  };
  const parents = parentKeysOf(s.tickets);
  const releasing = new Set(plan.release.map((r) => r.flight));
  const standOf = new Map(s.workspaces.filter((w) => w.ticketKey).map((w) => [w.ticketKey!, w.path]));
  // 계획이 이미 FLIGHT를 뺀 이유(상위 이슈, HOLD, 라벨, STAND 있음 …). SUPERSEDED 사유로 그대로 쓴다:
  // "더 나은 배정으로 바뀜"만으로는 그 FLIGHT가 왜 빠졌는지 화면에서 알 수 없다.
  const excludedWhy = new Map(plan.excluded.map((e) => [e.flight, e.reason]));
  const standOfTicket = new Set(s.workspaces.map((w) => w.ticketKey).filter(Boolean) as string[]);
  const age = (p: Proposal) => now - Date.parse(p.statusAt);
  // 이미 끝났거나(LOGBOOK) 열린 PR이 있는 FLIGHT. planner와 같은 문구
  const worked = (flight: string) => workedWhy(flight, landed, s.pulls ?? []);

  const why = (p: Proposal): string => {
    const t = stateOf.get(p.flight);
    if (p.kind === "RELEASE") return t && t.stateType !== "started" ? stateChangedWhy(t.state) : "STAND가 생겼거나 기준에서 벗어남";
    if (!t || t.stateType !== "unstarted") return stateChangedWhy(t?.state ?? "목록에 없음");
    // FLIGHT가 이미 끝났거나 누가 작업 중이면 AIRCRAFT 사정보다 그것이 먼저다
    const done = worked(p.flight);
    if (done) return done;
    if (parents.has(p.flight)) return parentWhyOf(stateOf.get(p.flight)!, s.tickets);
    const ac = acOf(p);
    if (ac?.stopped && !canTakeNow(ac, t)) return `${STOPPED_WHY} — ${ac.name} — ${ac.reason}`;
    if (!ac || !canTakeNow(ac, t)) return p.undelivered ? `${DELIVERY_FAILED_WHY} — ${p.undelivered.reason}` : `${AIRCRAFT_WHY}: ${ac?.reason ?? "세션 없음"}`;
    // 계획의 제외 목록을 먼저 믿는다. 거기에 없을 때만 planner의 규칙을 직접 확인한다 —
    // plan.excluded는 "지금 후보인 FLIGHT"의 사유만 담아서, 이미 후보에서 빠진 FLIGHT는 여기 없다.
    const fromPlan = excludedWhy.get(p.flight);
    if (fromPlan) return fromPlan;
    if (standOfTicket.has(p.flight)) return hasStandWhy();
    if (!t.priority) return NO_PRIORITY_WHY;
    if (!isCandidateTicket(t, candidateTeamsOf(cfg))) return `${teamOfKey(t.key)} 팀은 DISPATCH 후보가 아님(설정 candidateTeams)`;
    if (!airportOfTicket(t, cfg)) return noProjectWhy(t.project);
    const label = t.labels.find((l) => cfg.excludeLabels.includes(l));
    if (label) return excludedLabelWhy(label);
    if (t.takenBy) return takenWhy(t.takenBy);
    return BETTER_WHY;
  };
  // 승인됐지만 아직 안 보낸 ASSIGN이 여전히 유효한가(FLIGHT가 Todo이고 AIRCRAFT가 배정 가능)
  const stillValid = (p: Proposal) =>
    !isHeld(p) &&
    !parents.has(p.flight) &&
    stateOf.get(p.flight)?.stateType === "unstarted" &&
    !stateOf.get(p.flight)?.takenBy &&
    !worked(p.flight) &&
    Boolean(acOf(p) && canTakeNow(acOf(p)!, stateOf.get(p.flight)));
  // /clear 뒤 첫 메시지를 기다리는 AIRCRAFT의 제안은 AIRCRAFT 사정만으로는 닫지 않는다(ATC-91). 유예(restartGraceMin, 0이면 RESTARTING 없음)가 지나면 RESTARTING이 사라져 예전처럼 닫힌다.
  // LAUNCH한 launch 카드(ATC-129)는 launchCardTimeoutMin 동안 기다린다(RESTARTING 유예와 따로, 끌 수 없다): 새 세션은 CREW BRIEFING을 읽느라 잠깐 AIRBORNE이다
  // ACCOUNT 불일치(ATC-458): 스위치(crossAccountRelease)가 꺼져 있으면 카드를 닫지 않고 ATC-251 사유로 기다린다
  const waits = (p: Proposal, reason: string) =>
    p.kind === "ASSIGN" &&
    (acOf(p)?.restarting === true || launchWaiting(p, now, cfg.launchCardTimeoutMin) || (acOf(p)?.crossAccount === true && cfg.crossAccountRelease === "off")) &&
    reason.startsWith(`${AIRCRAFT_WHY}:`);
  // RESUME 카드(ATC-129): FLIGHT가 아직 In Progress이고 LOGBOOK에 없어야 한다. 아니면 닫을 사유
  const resumeWhy = (p: Proposal): string | null => {
    const t = stateOf.get(p.flight);
    if (!t || t.stateType !== "started") return stateChangedWhy(t?.state ?? "목록에 없음");
    const pr = landed.get(p.flight);
    return pr ? landedWhy(pr) : null;
  };
  const resumePlanned = new Set((plan.resume ?? []).map((r) => `${r.flight}|${regOfAssign(r, tp)}`));
  // PR HOLDER 카드(ATC-354): 계획에 아직 같은 PR·head·type·AIRCRAFT가 있어야 유효하다. FLIGHT 상태(started)와 열린 PR은 이 카드의 전제라 일반 ASSIGN의 사유로 닫지 않는다
  const holderPlanned = new Set((plan.holders ?? []).map((h) => `${h.prHolder!.key}|${regOfAssign(h, tp)}`));
  const holderWhy = (p: Proposal): string | null => {
    if (holderPlanned.has(`${p.prHolder!.key}|${regOf(p)}`)) return null;
    const ac = acOf(p);
    return ac && canTakeNow(ac, stateOf.get(p.flight)) ? "PR HOLDER 불필요 — PR이 머지·닫힘, 쥔 세션이 생김, head가 바뀜 또는 다른 AIRCRAFT가 더 맞음" : `${AIRCRAFT_WHY}: ${ac?.reason ?? "세션 없음"}`;
  };

  const guarded = guardedOf(existing, cfg, now);
  // 계획이 보호한 카드의 짝을 예약으로 뺐을 때 planner가 적는 제외 사유(dispatch.ts): 이 카드 자신이 잡은 것이라 닫을 사유가 아니다
  const ownHoldWhy = (p: Proposal) => `진행 중인 제안 ${p.id}`;
  let open = 0;
  let openRelease = 0;
  // 다른 사유 없이 "더 나은 배정"으로만 계획에서 빠진 판정 대기 제안. 바로 닫지 않고, 아래에서 같은 FLIGHT나
  // AIRCRAFT에 점수가 충분히 높은 새 제안이 실제로 만들어질 때만 닫는다(판정할 기회를 잃지 않게).
  const contested: Proposal[] = [];
  const keptByGuard: Proposal[] = []; // 경합 보호가 "더 나은 배정"으로 닫지 않고 둔 카드
  for (const p of existing) {
    // 보낸 뒤 FLIGHT가 이미 끝났으면(Done·Canceled·Duplicate) 닫는다. recalling은 RECALL READBACK이 남아 건드리지 않는다(ATC-266)
    if (p.status === "sent" || p.status === "accepted" || p.status === "departed") {
      const done = inFlightDoneOp(p, stateOf.get(p.flight), { at, standNow: standOfTicket.has(p.flight), report: reports.get(p.flight), landedPr: landed.get(p.flight) });
      if (done) {
        ops.push(done);
        continue;
      }
    }
    if (p.status === "proposed") {
      if (isHeld(p)) {
        // DISPATCH가 잡아 둔 HOLD는 24시간 만료가 없다. 대신 풀리는 조건이 있다:
        // FLIGHT 자체가 Todo가 아니게 됨 / 선행 FLIGHT가 모두 끝남 / (선행 없는 HOLD) HOLD 뒤에 FLIGHT가 수정됨
        const t = stateOf.get(p.flight);
        const blockers = p.hold.filter((k) => stateOf.has(k) && !DONE_STATES.has(stateOf.get(k)!.stateType));
        if (!t || t.stateType !== "unstarted") ops.push({ op: "supersede", id: p.id, at, reason: `FLIGHT 상태가 바뀜(${t?.state ?? "목록에 없음"})` });
        else if (worked(p.flight)) ops.push({ op: "supersede", id: p.id, at, reason: worked(p.flight)! });
        else if (p.hold.length && !blockers.length) ops.push({ op: "supersede", id: p.id, at, reason: `선행 FLIGHT(${p.hold.join(", ")})가 끝남 — 다시 후보` });
        else if (!p.hold.length && t.updatedAt && Date.parse(t.updatedAt) > Date.parse(p.holdAt!))
          ops.push({ op: "supersede", id: p.id, at, reason: "HOLD 뒤에 FLIGHT가 수정됨 — 다시 검토" });
        continue;
      }
      // 대기열로 돌린 제안은 돌린 때부터 24시간
      if (now - Date.parse(p.requeuedAt ?? p.at) > PROPOSAL_TTL_MS) ops.push({ op: "expire", id: p.id, at, reason: NO_VERDICT_WHY });
      else if (cfg.autoDispatch === "on" && p.kind === "ASSIGN" && now - Date.parse(p.requeuedAt ?? p.at) > cfg.autoCardTtlMin * 60_000)
        ops.push({ op: "supersede", id: p.id, at, reason: `${AUTO_STALE_WHY} (${cfg.autoCardTtlMin}분)` });
      else if (p.prHolder) {
        const reason = holderWhy(p);
        if (reason && !waits(p, reason)) ops.push({ op: "supersede", id: p.id, at, reason });
      } else if (p.resume) {
        // 열린 제안 수(openProposals)에 세지 않는다. 세션이 다시 떴으면 그 세션에서 ATC-86대로("계속")
        const ac = acOf(p);
        const gone = ac && !ac.launch ? `${AIRCRAFT_WHY}: 세션이 다시 떴음 — RESUME은 그 세션에서 SUPERVISOR가 "계속"(ATC-86)` : `${AIRCRAFT_WHY}: RESUME 조건이 더는 맞지 않음(${ac?.reason ?? "세션 없음"})`;
        const reason = resumeWhy(p) ?? (resumePlanned.has(`${p.flight}|${regOf(p)}`) ? null : gone);
        if (reason) ops.push({ op: "supersede", id: p.id, at, reason });
      }
      else if (p.kind === "ASSIGN" && !planned.has(`${p.flight}|${regOf(p)}`)) {
        const reason = why(p);
        if (guarded.has(p.id) && (reason === BETTER_WHY || reason === ownHoldWhy(p))) {
          // 보호한 카드: 더 나은 배정이 밀어내지 않는다
          keptByGuard.push(p);
          open++;
        }
        else if (reason === BETTER_WHY) {
          contested.push(p);
          open++;
        } else if (waits(p, reason)) open++;
        else ops.push({ op: "supersede", id: p.id, at, reason });
      }
      else if (p.kind === "RELEASE" && !releasing.has(p.flight)) ops.push({ op: "supersede", id: p.id, at, reason: why(p) });
      else if (p.kind === "ASSIGN") open++;
      else openRelease++;
    } else if (p.status === "agreed" || p.status === "disagreed") {
      // ASSIGN·RELEASE 모두. "나라면" 표시만 있고 승인·거절이 없어 SUPERVISOR 알림(pending)에 계속 남던 것(ATC-152). 표시한 때부터 24시간. HOLD가 걸린 것은 만료가 없다
      if (!isHeld(p) && age(p) > PROPOSAL_TTL_MS) ops.push({ op: "expire", id: p.id, at, reason: NO_VERDICT_WHY });
    } else if (p.kind === "ASSIGN" && p.status === "approved") {
      if (age(p) > PROPOSAL_TTL_MS) ops.push({ op: "expire", id: p.id, at, reason: "승인 뒤 24시간 동안 전달되지 않음" });
      // LAUNCH했는데 유예가 지나도 세션이 없다(계획에 아직 absent)
      else if (acOf(p)?.launch && launchTimedOut(p, now, cfg.launchCardTimeoutMin)) ops.push({ op: "supersede", id: p.id, at, reason: launchTimeoutWhy(cfg.launchCardTimeoutMin) });
      else if (acOf(p)?.launch && launchMissing(p, now, cfg.launchCardTimeoutMin)) ops.push({ op: "supersede", id: p.id, at, reason: launchMissingWhy(cfg.launchCardTimeoutMin, k3WaitOf(p.id)) });
      else if (p.prHolder) {
        const reason = holderWhy(p);
        if (reason && !waits(p, reason)) ops.push({ op: "supersede", id: p.id, at, reason });
      } else if (p.resume) {
        const reason = resumeWhy(p);
        if (reason) ops.push({ op: "supersede", id: p.id, at, reason });
      } else if (!stillValid(p)) {
        const reason = why(p);
        if (!waits(p, reason)) ops.push({ op: "supersede", id: p.id, at, reason });
      }
    } else if (p.status === "sent") {
      // 보낸 뒤에는 CAPTAIN이 쥐고 있으니 자동 SUPERSEDED 하지 않는다
      if (age(p) > PROPOSAL_TTL_MS) ops.push({ op: "expire", id: p.id, at, reason: "24시간 동안 READBACK 없음" });
    } else if (p.status === "recalling") {
      // RECALL 문구의 READBACK을 기다린다. STAND가 생겨도 DEPARTED로 바꾸지 않는다(멈추라고 한 FLIGHT다)
      if (age(p) > PROPOSAL_TTL_MS) ops.push({ op: "expire", id: p.id, at, reason: "RECALL 뒤 24시간 동안 READBACK 없음" });
    } else if (p.status === "accepted") {
      const stand = standOf.get(p.flight);
      if (stand) ops.push({ op: "depart", id: p.id, at, stand });
      // STAND 없는 FLIGHT가 accepted에 남아 있으면(READBACK 때 FLIGHT를 몰랐거나 옛 기록) 지금 DEPARTED로
      else if (standFreeTicket(stateOf.get(p.flight))) ops.push({ op: "depart", id: p.id, at, stand: null, via: "readback" });
      else if (age(p) > PROPOSAL_TTL_MS) ops.push({ op: "expire", id: p.id, at, reason: "READBACK 뒤 24시간 동안 STAND가 생기지 않음" });
    }
    // STAND 없이 DEPARTED한 제안은 ARRIVED 보고(또는 RECALL)까지 그대로 둔다: 만료·SUPERSEDED 없음
  }

  // 같은 짝(RELEASE는 같은 FLIGHT)을 24시간 안에 다시 제안하지 않는다(거절한 것도 포함).
  // RECALL된 짝은 RECALL READBACK 시각부터 24시간 다시 제안하지 않는다
  // planner와 같은 기준(pairUntil, churned). 열린 제안의 짝도 그대로 두어 중복 제안을 막는다
  const recent = existing.filter((x) => pairUntil(x, now) !== null && !churned(x));
  const seen = new Set(recent.map((x) => (x.kind === "ASSIGN" ? `${x.flight}|${regOf(x)}` : `R|${x.flight}`)));
  const nextId = () => `D-${String(++seq).padStart(4, "0")}`;
  const replaced = new Set<string>();
  // 보호한 카드가 쥔 AIRCRAFT·FLIGHT: 호출부가 예약으로 다시 계획했으면 계획에 없다. 안 했으면 여기서 새 카드를 만들지 않는다(같은 FLIGHT·AIRCRAFT에 카드가 둘이 되지 않게)
  // (이번 바퀴에 다른 사유로 닫는 카드와 계획에 짝이 남은 카드는 넣지 않는다: 앞의 것은 이미 닫히고, 뒤의 것은 계획이 그 AIRCRAFT를 이미 준 것이다)
  const heldByGuard = keptByGuard;
  const guardedFlights = new Set(heldByGuard.map((p) => p.flight));
  const guardedRegs = new Set(heldByGuard.map((p) => regOf(p)).filter(Boolean) as string[]);
  // 밀려난 FLIGHT의 새 카드는 원래 카드의 나이를 이어받는다(경합 보호가 켜졌을 때). 이번 바퀴에 민 카드와 최근에 밀려난 카드 가운데 가장 나중 것
  const displacedAt = new Map<string, string>();
  if (cfg.contestGuard === "on") {
    for (const x of [...existing].sort((m, n) => Date.parse(m.statusAt) - Date.parse(n.statusAt))) {
      if (x.kind !== "ASSIGN" || x.status !== "superseded" || !x.displacedBy || now - Date.parse(x.statusAt) > DISPLACE_AGE_WINDOW_MS) continue;
      displacedAt.set(x.flight, x.at);
    }
  }
  const ageOf = (flight: string) => (displacedAt.has(flight) ? { ageFrom: displacedAt.get(flight)! } : {});
  for (const a of plan.assign) {
    const reg = regOfAssign(a, tp);
    if (seen.has(`${a.flight}|${reg}`)) continue;
    if (guardedFlights.has(a.flight) || guardedRegs.has(reg)) continue;
    const rivals = contested.filter((p) => !replaced.has(p.id) && (p.flight === a.flight || regOf(p) === reg));
    if (rivals.length) {
      // 판정 대기 중인 제안보다 REPLACE_MARGIN 이상 높을 때만 바꾼다. 아니면 새 제안을 만들지 않고 기존 것을 둔다
      const best = Math.max(...rivals.map((p) => p.score));
      if (a.score - best < Math.abs(best) * REPLACE_MARGIN) continue;
      const id = nextId();
      for (const p of rivals) {
        const record = cfg.contestGuard === "on" ? { by: id, gap: Math.round((a.score - p.score) * 100) / 100 } : {};
        ops.push({ op: "supersede", id: p.id, at, reason: `${BETTER_WHY} — ${id} (${p.score} → ${a.score})`, ...record });
        replaced.add(p.id);
        if (cfg.contestGuard === "on") displacedAt.set(p.flight, p.at); // 같은 바퀴에 계획이 그 FLIGHT를 다른 AIRCRAFT에 주었으면 그 카드가 이 나이를 이어받는다
        open--;
      }
      ops.push({ op: "create", id, at, kind: "ASSIGN", flight: a.flight, aircraft: a.aircraft, aircraftName: a.aircraftName, registration: reg, airport: a.airport, score: a.score, factors: a.factors, ...ageOf(a.flight), ...(a.launch ? { launch: true as const } : {}), ...(a.supervisorConfirm?.length ? { supervisorConfirm: a.supervisorConfirm } : {}), ...(a.waiting?.length ? { waitingFlights: a.waiting } : {}) });
      open++;
      continue;
    }
    if (open >= cfg.slots.openProposals) continue;
    ops.push({ op: "create", id: nextId(), at, kind: "ASSIGN", flight: a.flight, aircraft: a.aircraft, aircraftName: a.aircraftName, registration: reg, airport: a.airport, score: a.score, factors: a.factors, ...ageOf(a.flight), ...(a.launch ? { launch: true as const } : {}), ...(a.supervisorConfirm?.length ? { supervisorConfirm: a.supervisorConfirm } : {}) });
    open++;
  }
  // RESUME 카드(ATC-129): 한 cut에 한 번. 그 FLIGHT를 이미 쥔 진행 중인 제안이 있으면 만들지 않는다
  const resumed = resumedOf(existing);
  for (const r of plan.resume ?? []) {
    if (!r.resume || resumed.has(resumeKey(r.flight, r.resume.cutAt))) continue;
    if (existing.some((x) => x.flight === r.flight && (isInFlight(x) || (x.status === "proposed" && x.kind === "ASSIGN")))) continue;
    resumed.add(resumeKey(r.flight, r.resume.cutAt));
    ops.push({ op: "create", id: nextId(), at, kind: "ASSIGN", flight: r.flight, aircraft: r.aircraft, aircraftName: r.aircraftName, registration: regOfAssign(r, tp), airport: r.airport, score: r.score, factors: r.factors, launch: true, resume: r.resume });
  }
  // PR HOLDER 카드(ATC-354): PR·head·type마다 한 번. 열린 제안 수에 세지 않는다(PR이 멈추지 않게)
  for (const h of plan.holders ?? []) {
    if (existing.some((x) => x.prHolder?.key === h.prHolder!.key && x.status !== "superseded" && x.status !== "expired")) continue;
    ops.push({ op: "create", id: nextId(), at, kind: "ASSIGN", flight: h.flight, aircraft: h.aircraft, aircraftName: h.aircraftName, registration: regOfAssign(h, tp), airport: h.airport || null, score: h.score, factors: h.factors, ...(h.launch ? { launch: true as const } : {}), prHolder: h.prHolder });
  }
  for (const r of plan.release) {
    if (openRelease >= cfg.slots.openReleases) break;
    if (seen.has(`R|${r.flight}`)) continue;
    ops.push({ op: "create", id: nextId(), at, kind: "RELEASE", flight: r.flight, aircraft: null, aircraftName: null, airport: r.airport, score: r.score, factors: r.factors });
    openRelease++;
  }
  return ops;
}

// Linear 이슈 상세의 본문(문자열이 아니면 null)
export const descriptionOf = (d: Record<string, unknown>): string | null => (typeof d.description === "string" ? d.description : null);

// CAPTAIN에게 보낼 FLIGHT PLAN. send-guard는 DISPATCH가 이 문구를 그대로 보내는지 확인한다.
// DIRECT 지시서(ATC-32): 이슈 본문(description)에서 목표·완료 기준·이 작업만의 제약만 옮기고, 끝까지 한 번에 날게 한다.
// 본문을 못 읽었으면(null) 완료 기준은 링크의 이슈 본문을 따르라고 적는다.
export function formatFlightPlan(p: Proposal, ticket: Pick<Ticket, "title" | "url" | "priority"> | undefined, sessionName: string, description: string | null = null, now = Date.now(), notes: readonly string[] = []): string {
  const sign = callsign({ name: sessionName });
  const who = sign === sessionName ? sessionName : `${sign} (${sessionName})`;
  const note = p.note ? `DISPATCH note: ${p.caution ? "CAUTION · " : ""}${p.note}` : p.caution ? "DISPATCH note: CAUTION" : null;
  const hold = p.hold.length ? `HOLD: start after the preceding FLIGHT ${p.hold.map(flightNumber).join(", ")} is done` : null;
  // 이 AIRCRAFT가 착륙만 기다리는 FLIGHT를 쥐고 있다(ATC-387): 새 FLIGHT는 새 STAND에서, 앞 STAND는 FIX·GO AROUND를 위해 남긴다
  const waiting = p.waitingFlights?.length
    ? `STAND: ${p.waitingFlights.map(flightNumber).join(", ")} only waits to land in its own STAND. Start this FLIGHT in a NEW STAND (a new worktree) and keep the earlier one. A FIX or GO AROUND for the earlier PR still reaches you: handle it in the earlier STAND, then return to this FLIGHT`
    : null;
  return [
    `[DISPATCH ${p.id}] FLIGHT PLAN · ${who}`,
    DIRECT_LINE,
    `FLIGHT ${flightNumber(p.flight)} · AIRPORT ${p.airport ?? "—"} · PRIORITY ${ticket?.priority ? (PRIORITY_NAME[ticket.priority] ?? "None") : "None"}`,
    ticket?.title ?? p.flight,
    ticket?.url ?? null,
    // RESUME 카드(ATC-129): 처음부터 다시 하지 말고 STAND·브랜치·마지막 커밋에서 이어서
    ...(p.resume ? resumeLines(p.resume, now) : []),
    ...(p.prHolder ? holderLines(p.prHolder) : []),
    ...directLines(directSectionsOf(description)),
    ...notes,
    note,
    hold,
    waiting,
    DISCRETION_LINE,
    closingLine("flight-plan", responseOf("flight-plan"), p.id),
    FINISH_LINE,
  ]
    .filter(Boolean)
    .join("\n");
}

// CAPTAIN에게 보낼 RECALL. send-guard는 OCC가 이 문구를 그대로 보내는지 확인한다(docs/dispatch.md "RECALL").
export function formatRecall(p: Pick<Proposal, "id" | "flight" | "airport" | "status" | "departedVia">, ticket: Pick<Ticket, "title"> | undefined, sessionName: string, reason: string): string {
  const sign = callsign({ name: sessionName });
  const who = sign === sessionName ? sessionName : `${sign} (${sessionName})`;
  return [
    `[DISPATCH ${p.id}] RECALL · ${who}`,
    `FLIGHT ${flightNumber(p.flight)} · AIRPORT ${p.airport ?? "—"}. This FLIGHT PLAN is withdrawn.`,
    ticket?.title ?? p.flight,
    `Reason: ${reason}`,
    // STAND 없이 DEPARTED한 FLIGHT(SURVEY·CHECK)에는 정리할 STAND가 없다. 중간 결과를 남기게 한다
    isStandFreeAirborne(p)
      ? "Stop work. If you have interim results, leave a link or one line. Then another AIRCRAFT can pick them up."
      : "Stop work. Do not clean up the STAND (worktree). Leave it as it is. Then another AIRCRAFT can pick it up.",
    closingLine("recall", responseOf("recall"), p.id),
  ].join("\n");
}

export function overdueOf(proposals: Proposal[], now: number): string[] {
  return proposals
    .filter(
      (p) =>
        (p.status === "sent" && !p.awaitSupervisor && now - overdueBase(p.statusAt, p.standbyAt) > READBACK_OVERDUE_MS) || // SUPERVISOR를 기다리는 중(ATC-120)이면 READBACK 지연이 아니다 // 첫 STANDBY부터 다시 센다(ATC-122)
        (p.status === "recalling" && now - Date.parse(p.statusAt) > READBACK_OVERDUE_MS) ||
        (p.status === "accepted" && now - Date.parse(p.statusAt) > DEPARTURE_OVERDUE_MS) ||
        (isStandFreeAirborne(p) && now - Date.parse(p.statusAt) > ARRIVAL_OVERDUE_MS),
    )
    .map((p) => p.id);
}

// 게이트가 보는 거절 사유 칩: SUPERVISOR가 뒤늦게 단 칩(recode)이 있으면 그것, 없으면 판정 때의 칩
export const gateCodesOf = (p: Pick<Proposal, "gateCodes" | "reasonCodes">): string[] => p.gateCodes ?? p.reasonCodes ?? [];
// 준비 안 됨 거절(ATC-5): 칩이 모두 FLIGHT 칩인 그림자 거절. 팀 선택이 아니라 티켓 문제라 게이트에서 뺀다.
// 칩이 없거나 wrong-aircraft·other가 하나라도 섞이면 팀 선택 판정으로 센다
export function notReadyOf(p: Pick<Proposal, "status" | "gateCodes" | "reasonCodes">): boolean {
  const codes = gateCodesOf(p);
  return p.status === "disagreed" && codes.length > 0 && codes.every((c) => (FLIGHT_HOLD_CODES as readonly string[]).includes(c));
}

// 2b 켜기 점검표(표시만). DISPATCH 브리핑과 ROUTE MAP의 WAYPOINT 점검(docs/routes.md 6단계)이 같이 쓴다
export function readiness2bNow(gate: ReturnType<typeof gateOf>, now = Date.now(), files = readinessFiles()) {
  return readiness2bOf({ gate, ...selfCheck2b(files.atcctl, now), crewChangeMissing: selfCheckCrewChange(files.atcctl, now), sendGuard: files.sendGuard, readback: files.readback });
}

export function gateOf(proposals: Proposal[]) {
  // 게이트는 AIRCRAFT 선택만 잰다(2026-09-27, SUPERVISOR): 사람 판정 중 준비 안 됨 거절은 따로 센다
  const judged = proposals.filter((p) => (p.status === "agreed" || p.status === "disagreed") && p.via !== "atfm" && p.via !== "preflight" && p.via !== "auto");
  const decided = judged.filter((p) => !notReadyOf(p));
  const agreed = decided.filter((p) => p.status === "agreed").length;
  const agreement = decided.length ? agreed / decided.length : null;
  return {
    decided: decided.length,
    notReady: judged.length - decided.length, // 준비 안 됨 거절(게이트 제외)
    agreed,
    agreement,
    target: GATE,
    ready: decided.length >= GATE.decided && agreement !== null && agreement >= GATE.agreement,
    // 게이트와 따로: CROSSCHECK가 SUPERVISOR 판정과 얼마나 맞았나, 그중 "CROSSCHECK에 동의" 한 번 클릭은 몇 건인가
    crosscheck: {
      ...crosscheckRateOf(proposals.filter((p) => p.crosscheck).map((p) => ({ crosscheck: p.crosscheck, human: humanOf(p) }))),
      // blind 판정은 뺀다: blind 카드는 한 번 클릭이 막혀 있어 분모에 넣으면 비율이 실제보다 낮아 보인다(ATC-6)
      oneClick: oneClickOf(proposals.filter((p) => !p.blind).map((p) => ({ crosscheck: p.crosscheck, human: humanOf(p) }))),
    },
    // 거절 사유 칩별 건수(사람이 disagree·reject한 것 중 칩이 있는 것)
    reasonCounts: reasonCountsOf(proposals.filter((p) => humanOf(p)?.verdict === "disagree")),
    // 게이트와 따로: PREFLIGHT에 걸린 제안 수와 준비율(공급 품질)
    preflight: preflightStatsOf(proposals),
    // 게이트와 따로: 게이트가 센 판정 중 blind 표본의 합의율(anchoring 점검, ATC-6)
    blind: blindStatsOf(decided),
  };
}

// DISPATCH 판정 계열(ATC-88)의 화면용 묶음. 그림자 전용이라 제안·점수·상태는 건드리지 않는다.
// marks: RECENT(닫힌 제안)에만 싣는다 — 열린·HOLD 카드에는 보내지 않아 SUPERVISOR가 쏠리지 않게. hidden은 그 숨긴 수.
// stats: 게이트 패널의 세 줄(Ready = no ↔ 거절, Prerequisite = yes ↔ waiting-on-prior 칩·OCC HOLD, Same area ↔ 승인)
export const occHeldOf = (p: Proposal) => p.hold.length > 0 || (p.holdAt !== null && !p.preflight);

export function judgesBriefOf(proposals: Proposal[], recent: Proposal[], marks: DispatchMarks, mode: string) {
  const items: DispatchMeasured[] = [];
  const visible: Record<string, { family: string; model: string; engine: string; run: string; at: string; ready: number; prerequisite: number; sameArea: { score: number; level: number; confidence: number | null } | null; withheld: string | null; recentWithheld: string | null; sent: string[] }[]> = {};
  const recentIds = new Set(recent.map((p) => p.id));
  let hidden = 0;
  for (const p of proposals) {
    const m = marks.get(p.id);
    if (!m || p.kind !== "ASSIGN") continue;
    const list = Object.values(m);
    if (p.status === "proposed") hidden += list.length;
    else if (recentIds.has(p.id))
      visible[p.id] = list.map((l) => ({ family: l.family, model: l.model, engine: l.engine, run: l.run, at: l.at, ready: l.judgment.ready, prerequisite: l.judgment.prerequisite, sameArea: l.judgment.sameArea, withheld: l.withheld, recentWithheld: l.recentWithheld, sent: l.sent }));
    for (const l of list) items.push({ id: p.id, judgment: l.judgment, human: humanOf(p), codes: gateCodesOf(p), occHold: occHeldOf(p) });
  }
  return { mode, marks: visible, hidden, stats: dispatchStatsOf(items) };
}

// PREFLIGHT 통계(ASSIGN만). held: 한 번이라도 HOLD(OCC·PREFLIGHT)된 제안(대기열로 돌렸거나 확정했어도 센다),
// notReady: HOLD 없이 판정까지 갔지만 준비 안 됨 거절(칩이 모두 FLIGHT 칩, ATC-5)이 된 제안 — 거름을 빠져나간 것,
// passed: 그 밖에 HOLD 없이 SUPERVISOR 판정까지 간 제안. readyRate = passed / (passed + held + notReady) — 게이트 기준은 아니다
export function preflightStatsOf(proposals: Proposal[]) {
  const assign = proposals.filter((p) => p.kind === "ASSIGN");
  const held = assign.filter((p) => p.firstHeldAt).length;
  const holding = assign.filter((p) => p.status === "proposed" && isHeld(p)).length;
  const judged = assign.filter((p) => !p.firstHeldAt && humanOf(p));
  const notReady = judged.filter(notReadyOf).length;
  const passed = judged.length - notReady;
  const all = passed + held + notReady;
  return { held, holding, passed, notReady, readyRate: all ? passed / all : null };
}

// 거절 사유 칩별 건수, 최근 예시 FLIGHT, 지금 planner가 그 사유를 스스로 거르나(REASON_FILTERS).
// 어느 사유를 규칙으로 옮길지 고르는 근거다.
export function reasonStatsOf(proposals: Proposal[]) {
  const rejected = proposals
    .filter((p) => humanOf(p)?.verdict === "disagree" || (p.via === "preflight" && (p.status === "disagreed" || p.status === "rejected")))
    .sort((a, b) => (b.decidedAt ?? b.statusAt).localeCompare(a.decidedAt ?? a.statusAt));
  const counts = reasonCountsOf(rejected);
  return REASON_CODES.map((r) => ({
    code: r.code,
    label: r.label,
    count: counts[r.code] ?? 0,
    examples: [...new Set(rejected.filter((p) => p.reasonCodes?.includes(r.code)).map((p) => p.flight))].slice(0, 3),
    ...(REASON_FILTERS[r.code] ?? { auto: "manual" as const, how: "—" }),
  }));
}

// CROSSCHECK 브리핑: mark가 없는 열린 제안과 보정용 최근 SUPERVISOR 판정
// SETTLED인 것만 pending에 두고(ATC-117), 나머지 수는 unsettledMarks로 알린다
export function crosscheckBriefOf(proposals: Proposal[], now = Date.now(), settleMin = DEFAULT_SETTLE_MIN) {
  const markable = proposals.filter((p) => canCrosscheck(p) && !p.crosscheck);
  const pending = markable.filter((p) => settledOf(p, now, settleMin));
  const examples = examplesOf(proposals.map((p) => ({ p, human: humanOf(p) }))).map(({ p, human }) => ({
    id: p.id,
    kind: p.kind,
    flight: p.flight,
    aircraft: p.aircraftName,
    verdict: human!.verdict,
    reason: human!.reason,
    crosscheck: p.crosscheck ? { model: p.crosscheck.model, verdict: p.crosscheck.verdict, reason: p.crosscheck.reason } : null,
  }));
  return {
    pending: pending.map((p) => ({ id: p.id, kind: p.kind, flight: p.flight, aircraft: p.aircraftName, airport: p.airport, score: p.score, note: p.note, caution: p.caution })),
    unsettledMarks: markable.length - pending.length, // mark를 받을 수 있는데(열림, HOLD 아님, mark 없음) 아직 SETTLED가 아닌 수. dispatch brief의 unsettled와 다르다
    examples,
  };
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

// PR HOLDER 카드의 READBACK 시간(ATC-392): PR이 dirty가 되거나 FIX를 받은 때(prHolder.since)부터 holder의 READBACK(accepted)까지 분. since가 없는 옛 카드는 세지 않는다
export function holderReadbackOf(proposals: readonly Pick<Proposal, "id" | "prHolder" | "timeline">[]) {
  const rows = proposals.flatMap((p) => {
    const since = p.prHolder?.since;
    const at = p.timeline.accepted;
    if (!since || !at || !Number.isFinite(Date.parse(since)) || Date.parse(at) < Date.parse(since)) return [];
    return [{ id: p.id, pr: p.prHolder!.pr, type: p.prHolder!.type, min: Math.round(((Date.parse(at) - Date.parse(since)) / 60_000) * 10) / 10 }];
  });
  const m = median(rows.map((r) => r.min));
  return { n: rows.length, medianMin: m === null ? null : Math.round(m * 10) / 10, rows: rows.slice(-20) };
}

// 2b → 3(ATFM) 점검: 보낸 FLIGHT PLAN 중 READBACK 받은 비율, READBACK까지 걸린 시간, READBACK 뒤 DEPARTED 비율.
// STAND 없는 FLIGHT는 READBACK이 곧 DEPARTED라 DEPARTED 비율에서 뺀다(넣으면 비율이 저절로 오른다).
// READBACK 비율에는 넣고, ARRIVED 보고 수는 standFree로 따로 보인다
// timely: STAND 없는 FLIGHT가 일이 끝난 뒤 24시간 안에 ARRIVED한 비율(ATC-72, standfree.ts timelinessOf)
export function gate3Of(proposals: Proposal[], timely: { within: number; total: number; rate: number | null } | null = null) {
  const dispatched = proposals.filter((p) => p.timeline.sent && p.via !== "atfm"); // 2b 점검은 사람이 승인한 FLIGHT PLAN만
  const readBack = dispatched.filter((p) => p.timeline.accepted);
  const light = readBack.filter((p) => p.departedVia === "readback");
  const standReadBack = readBack.filter((p) => p.departedVia !== "readback");
  const departed = standReadBack.filter((p) => p.timeline.departed);
  const readbackRate = dispatched.length ? readBack.length / dispatched.length : null;
  const departedRate = standReadBack.length ? departed.length / standReadBack.length : null;
  const mins = median(readBack.map((p) => (Date.parse(p.timeline.accepted!) - Date.parse(p.timeline.sent!)) / 60_000));
  return {
    dispatched: dispatched.length,
    readBack: readBack.length,
    departed: departed.length,
    declined: dispatched.filter((p) => p.status === "declined").length,
    readbackRate,
    readbackMedianMin: mins === null ? null : Math.round(mins * 10) / 10,
    holderReadback: holderReadbackOf(proposals),
    departedRate,
    standFree: { readBack: light.length, arrived: light.filter((p) => p.timeline.arrived).length, timely },
    target: GATE3,
    ready:
      dispatched.length >= GATE3.dispatched &&
      readbackRate !== null && readbackRate >= GATE3.readback &&
      departedRate !== null && departedRate >= GATE3.departed,
  };
}

// 2b 점검표용 코드 사실: 합성 기록으로 전이·문구·API·CLI가 실제로 있는지 확인한다. 빠진 것 목록(비면 갖춰짐).
// 이름만 보고 "ready"라고 하지 않으려는 것이다. atcctl은 소스에서 명령 분기가 있는지만 본다
export function selfCheck2b(atcctlSource: string | null, now = Date.now()) {
  const at = new Date(now - 30 * DAY).toISOString();
  const id = "D-0001";
  const base: Op[] = [
    { op: "create", id, at, kind: "ASSIGN", flight: "X-1", aircraft: "a", aircraftName: "TEAM_A", airport: "A", score: 0, factors: [] },
    { op: "approve", id, at },
    { op: "send", id, at, message: "m" },
  ];
  const has = (re: RegExp) => Boolean(atcctlSource && re.test(atcctlSource));
  const actions: readonly string[] = DISPATCH_ACTIONS;

  const recallMissing: string[] = [];
  const recalled = fold([...base, { op: "recall", id, at, reason: "r", message: "R" }, { op: "recalled", id, at }])[0];
  if (recalled.status !== "recalled") recallMissing.push("recall → recalled 전이");
  else if (isInFlight(recalled)) recallMissing.push("RECALLED 뒤 AIRCRAFT·FLIGHT 풀림");
  if (!formatRecall(fold(base)[0], undefined, "TEAM_A", "r").startsWith(`[DISPATCH ${id}] RECALL`)) recallMissing.push("RECALL 문구");
  for (const a of ["recall", "recall-send", "recalled"]) if (!actions.includes(a)) recallMissing.push(`POST …/${a}`);
  for (const a of ["recall-send", "recalled"]) if (!has(new RegExp(`args\\[0\\] === "${a}"`))) recallMissing.push(`atcctl dispatch ${a}`);

  const standFreeMissing: string[] = [];
  const light = fold([...base, ...readbackOps({ id }, { labels: ["type:SURVEY"] }, at)])[0];
  if (!(light.status === "departed" && light.departedStand === null && light.departedVia === "readback")) standFreeMissing.push("READBACK → DEPARTED(stand 없음)");
  if (!isInFlight(light)) standFreeMissing.push("ARRIVED 전 AIRCRAFT·FLIGHT 예약");
  const plan: Plan = { at, assign: [], release: [], hold: [], excluded: [], aircraft: [], slots: [] };
  if (syncOps([light], plan, { tickets: [], workspaces: [] }, DEFAULT_DISPATCH_CONFIG, now, 1).some((o) => o.id === id)) standFreeMissing.push("30일 지나도 만료·SUPERSEDED 없음");
  const arrived = fold([...base, ...readbackOps({ id }, { labels: ["type:CHECK"] }, at), { op: "arrived", id, at, note: "n" }])[0];
  if (arrived.status !== "arrived" || isInFlight(arrived)) standFreeMissing.push("ARRIVED 전이");
  if (!actions.includes("arrived")) standFreeMissing.push("POST …/arrived");
  if (!has(/args\[0\] === "arrived"/)) standFreeMissing.push("atcctl dispatch arrived");
  return { recallMissing, standFreeMissing };
}

// ── 파일 ──

// 자라기만 한 파일은 새 줄만 읽는다(jsonl-cache.ts, ATC-537). 돌려준 배열은 읽기 전용으로 쓴다
const opsCache = new JsonlCache<Op>();
export function readOps(file = FILE): Op[] {
  return opsCache.read(file).lines as Op[];
}

export function append(ops: Op[]) {
  if (!ops.length) return;
  mkdirSync(dirname(FILE), { recursive: true });
  appendFileSync(FILE, ops.map((o) => JSON.stringify(o)).join("\n") + "\n");
  for (const o of ops) record({ t: o.at, kind: "dispatch", op: o.op, id: o.id, ...(o.op === "send" && o.via ? { via: o.via } : {}), ...(o.op === "approve" && o.via === "auto" ? { by: "auto" } : {}) });
}

// 보낼 FLIGHT PLAN 문구. release(OCC가 보냄)와 FRESH START(ATC-73, 새 세션의 첫 프롬프트)가 같이 쓴다
// DIRECT 지시서에 옮길 이슈 본문(Linear 읽기 전용). 못 읽어도 보낸다 — 완료 기준은 링크를 따르라고 적힌다
// 이슈 댓글 중 SUPERVISOR가 쓴 것은 NOTES FROM THE ISSUE로 함께 간다(ATC-271)
export async function flightPlanMessageOf(p: Proposal, s: Pick<Snapshot, "tickets">): Promise<string> {
  const detail = (await fetchIssueDetail(p.flight).catch(() => null)) as Record<string, unknown> & { comments: unknown[] } | null;
  const description = detail ? descriptionOf(detail) : null;
  const notes = detail ? flightPlanNotesOf(detail.comments as IssueComment[], loadDispatchConfig().issueNotes, typeof detail.url === "string" ? detail.url : null) : [];
  return formatFlightPlan(p, s.tickets.find((t) => t.key === p.flight), p.aircraftName ?? "", description, Date.now(), notes);
}

// DIRECT 지시서(GET /api/dispatch/flight/:key/brief?to=). FLEET 카드의 LAUNCH with a FLIGHT(ATC-73)도 첫 프롬프트에 이것을 쓴다
export async function directBriefOf(key: string, to: string | null): Promise<string> {
  const d = (await fetchIssueDetail(key)) as Record<string, unknown>;
  const url = typeof d.url === "string" ? d.url : null;
  const notes = flightPlanNotesOf(d.comments as IssueComment[], loadDispatchConfig().issueNotes, url);
  return formatAssignment({ key, title: typeof d.title === "string" ? d.title : null, url }, descriptionOf(d), to, notes);
}

// 한 FLIGHT의 제안 기록: 최근 것이 먼저, limit건까지(ATC-377)
export function proposalsOfFlight<T extends Pick<Proposal, "flight" | "at">>(all: readonly T[], flight: string, limit = 20): T[] {
  return all.filter((p) => p.flight === flight).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

// 기록이 바뀌지 않았으면 접은 결과를 그대로 쓴다(tick마다 부르는 곳이 여럿이다, ATC-537). 배열은 복사해 주고 항목은 읽기 전용으로 쓴다(fold 밖에서 바꾸는 곳은 없다)
let folded: { gen: number; proposals: Proposal[] } | null = null;
export function allProposals(): Proposal[] {
  const { lines, gen } = opsCache.read(FILE);
  if (gen === 0) return fold([]);
  if (folded?.gen !== gen) folded = { gen, proposals: fold(lines as Op[]) };
  return folded.proposals.slice();
}

// 서버 tick에서 5분마다 부른다.
export function runDispatch(s: Snapshot, now = Date.now(), events: () => readonly TrafficEvent[] = () => []): Plan {
  const cfg = loadDispatchConfig();
  const ops = readOps();
  const existing = fold(ops);
  const logbook = loadLogbook();
  const landed = landedOf(logbook);
  // RESUME 카드(ATC-129): 세션이 없는 백그라운드 AIRCRAFT가 한도로 끊긴 FLIGHT. DEPARTURE LOG로 STAND·브랜치를 찾는다
  const fleet = loadFleet();
  const resumes = resumePlansOf(s, readDepartures(), landed, now, baseOfFleet(fleet, cfg.teamPattern));
  // 켜진 GROUND STOP이 걸린 AIRPORT의 ASSIGN은 계획에서 뺀다(docs/atfm.md 6장). 열린 제안은 그 사유로 SUPERSEDED
  // 끝내고 나서 시작한다(ATC-392): PR HOLDER 카드를 새 ASSIGN보다 먼저 계획한다. 먼저 계획의 AIRCRAFT 상태를 얻어 holder가 쓸 AIRCRAFT를 고르고(RESUME이 고른 것만 빼고),
  // 그 AIRCRAFT를 예약으로 넣어 계획을 다시 짠다 → 놀고 있는 AIRCRAFT는 열린 PR을 먼저 받고, 새 ASSIGN은 남은 AIRCRAFT에 간다
  const orphans = orphanCountsNow(s, now, existing, landed, cfg.teamPattern); // ORPHAN FLIGHT(ATC-516): 앞 세션이 멈춘 FLIGHT를 그 REGISTRATION의 슬롯으로 센다(스위치 off면 비어 있다)
  const plan0 = applyGroundStops(planDispatch(s, readFlightHistory(), cfg, now, reservedOf(existing, now), fleet, landed, logbook, activeWaypointsOf(readLinearProjects().milestones), filesInFlight(), resumes, mccAirportNow(), accountFolders(), undefined, orphans), s.atfm?.groundStops ?? []);
  // PR HOLDER(ATC-354): 계획의 AIRCRAFT 상태로 STAND를 쥔 세션이 없는 PR의 GO AROUND·FIX를 이어받을 AIRCRAFT를 고른다. 결과 경로는 RELAY 카드와 DUTY brief가 읽는다
  const holders = holderPlansOf(s, { clearances: allClearances(), events: events(), existing, lastAircraft: { departures: readDepartures(), proposals: existing, reports: readReports(), regOf: (n) => registrationOf(n, cfg.teamPattern) }, fleet, aircraft: plan0.aircraft, teamPattern: cfg.teamPattern, assigned: (plan0.resume ?? []).map((a) => regOfAssign(a, cfg.teamPattern)), keyFromBranch: ticketKeyFromBranch, now });
  const reserved = reservedOf(existing, now);
  for (const h of holders.plans) {
    const reg = regOfAssign(h, cfg.teamPattern);
    const by = `PR HOLDER #${h.prHolder!.pr}`;
    if (!reserved.aircraft.has(reg)) reserved.aircraft.set(reg, by);
    reserved.aircraftFlights?.set(reg, [...new Set([...(reserved.aircraftFlights.get(reg) ?? []), h.flight])]);
    if (!reserved.flights.has(h.flight)) reserved.flights.set(h.flight, by);
  }
  const replan = () => applyGroundStops(planDispatch(s, readFlightHistory(), cfg, now, reserved, fleet, landed, logbook, activeWaypointsOf(readLinearProjects().milestones), filesInFlight(), resumes, mccAirportNow(), accountFolders(), undefined, orphans), s.atfm?.groundStops ?? []);
  let plan = holders.plans.length ? replan() : plan0;
  // 경합 보호(ATC-547): 보호한 카드(자리 잡았거나 24시간에 두 번 밀려난 FLIGHT)의 짝을 계획이 뺐으면 그 짝을 예약으로 넣고 다시 계획한다.
  // 더 높은 점수의 FLIGHT는 다른 빈 AIRCRAFT가 받고, 없으면 한 주기 기다린다. 보호한 카드는 syncOps가 닫지 않는다
  const dropped = droppedGuardedOf(existing, plan, guardedOf(existing, cfg, now), cfg.teamPattern);
  if (dropped.length) {
    for (const p of dropped) {
      const reg = regOfProposal(p, cfg.teamPattern);
      if (reg && !reserved.aircraft.has(reg)) reserved.aircraft.set(reg, p.id);
      if (reg) reserved.aircraftFlights?.set(reg, [...new Set([...(reserved.aircraftFlights.get(reg) ?? []), p.flight])]);
      if (!reserved.flights.has(p.flight)) reserved.flights.set(p.flight, p.id);
    }
    plan = replan();
  }
  noteDispatchHolds(plan.aircraft, now); // ORPHAN FLIGHT 때문에만 막힌 REGISTRATION을 기록(MISFIRE 셈)
  plan.holders = holders.plans;
  setHolderRoutes(holders.routes);
  const seq = ops.filter((o) => o.op === "create").length;
  append(syncOps(existing, plan, s, cfg, now, seq, landed, foldReports(readReports())));
  lastCap = capStateOf(allProposals(), plan, cfg, now); // 방금 만든 카드까지 센다(ATC-403)
  return plan;
}

// ── API ──

// 열린·HELD 카드의 사실 줄(서버 계산)과, BRIEFING이 없으면 본문 첫 문장(ATC-4)
async function cardBriefsOf(cards: Proposal[], s: Snapshot, all: Proposal[], logbook: ReturnType<typeof loadPricedLogbook>, now: number, fuel: FuelWatch | null, routesOf: RoutesLoader) {
  const routes = await routesOf(s, logbook, now);
  const index = waypointIndex(routes);
  const flying = all.filter((p) => isInFlight(p) || isStandFreeAirborne(p)).map((p) => ({ flight: p.flight, aircraftName: p.aircraftName, at: p.statusAt }));
  const ctx = { now, tickets: s.tickets, routes, entries: logbook, flying, coldCache: fuel?.coldCache ?? [] };
  return Object.fromEntries(
    // blind: 판정 전까지 CROSSCHECK mark를 숨길 카드(열린 제안만. HELD는 HOLD 자체가 CROSSCHECK를 드러낸다)
    cards.map((p) => [p.id, { facts: factsOf(p, ctx, index), lead: p.briefing ? null : leadOf(p.flight, now), blind: !isHeld(p) && isBlind(p.id) }]),
  );
}

// 등록부의 base AIRPORT(RESUME 카드, ATC-129)
const baseOfFleet = (fleet: ReturnType<typeof loadFleet>, teamPattern: string) => (reg: string) => {
  const key = fleetKeyOf(Object.keys(fleet.aircraft), reg, teamPattern);
  return (key ? fleet.aircraft[key]?.base : null) ?? null;
};

// POST /api/dispatch/proposals/:id/<동작>. 2b 점검표(readiness.ts)도 이 목록으로 RECALL·ARRIVED 창구를 확인한다
export const DISPATCH_ACTIONS = [
  "verdict", "note", "briefing", "hold", "unhold", "requeue", "confirm-hold", "codes", "approve", "reject", "release", "accept", "decline", "standby", "await-supervisor", "undelivered", "cancel", "recall", "recall-send", "recalled", "arrived",
] as const;
// HELD 제안에 SUPERVISOR 판정을 받지 않는다(PREFLIGHT, ATC-3): 대기열로 돌린 뒤 판정하거나 FLIGHT 보류를 확정한다
const JUDGE_ACTIONS: readonly DispatchAction[] = ["verdict", "approve", "reject"];
type DispatchAction = (typeof DISPATCH_ACTIONS)[number];

// watchFuel: FUEL 경고(fuel-watch.ts). fuel-run.ts가 이 파일을 불러 순환이 되므로 index.ts가 넘긴다
// standFree(ATC-72): STAND 없는 FLIGHT의 ARRIVED 후보와 지표, D-xxxx ARRIVED 뒤 LOGBOOK 줄. index.ts가 standfree-run.ts를 넘긴다(순환 import를 피해서)
export interface StandFreeHooks {
  candidates: () => ArrivalSuggestion[];
  timeliness: () => { within: number; total: number; rate: number | null };
  arrived: (p: Proposal, s: Snapshot) => unknown;
}
// 제안 AIRCRAFT(세션 이름)마다 전달 정보. OCC는 살아 있는 OCC 세션의 permission mode
export function deliveryMapOf(s: Pick<Snapshot, "sessions">, proposals: Pick<Proposal, "aircraftName">[]): Record<string, Delivery> {
  const live = s.sessions.filter((x) => x.status !== "dead");
  const occ = live.find((x) => x.name.toUpperCase() === "OCC")?.permissionMode ?? null;
  const out: Record<string, Delivery> = {};
  for (const p of proposals) {
    if (!p.aircraftName || out[p.aircraftName]) continue;
    out[p.aircraftName] = deliveryOf(live.find((x) => x.name === p.aircraftName) ?? null, occ);
  }
  return out;
}

// LAUNCH on approve(ATC-129): launch 카드 승인이 부르는 LAUNCH(FLEET LAUNCH 버튼과 같은 launchAircraft)와 상한(ATC_MAX_LAUNCHED).
// index.ts가 session-control.ts를 넘긴다. 이 승인 말고는 카드로 세션을 띄우는 길이 없다
export interface DispatchLauncher {
  max: number;
  launch: (s: Snapshot, registration: string, proposal: string, resume: boolean, flight: string) => Promise<{ ok: boolean; jobId?: string; error?: string; wait?: string }>; // resume: RESUME 카드(끊긴 ACCOUNT에서 다시). flight: 카드의 FLIGHT(K3 발권이면 새 세션에 allow 항목을 준다, ATC-372)
  // 자동 FRESH START(ATC-560, fresh-start-run.ts autoFreshStartGate): 승인된 카드를 보내기 전에 부른다. 문구를 돌려주면 보내지 않고 409로 그것을 말한다
  beforeRelease?: (p: Proposal, s: Snapshot) => Promise<string | null>;
}

// 카드 사실 줄의 ROUTE·WAYPOINT(routes-load.ts loadRoutes). routes-load.ts가 이 파일을 불러 순환이 되므로 index.ts가 넘긴다(ATC-337)
export type RoutesLoader = (s: Snapshot, entries: LogEntry[], now: number) => Promise<Route[]>;

export function mountDispatch(app: Hono, getSnapshot: () => Promise<Snapshot>, watchFuel: ((s: Snapshot) => FuelWatch) | undefined, standFree: StandFreeHooks | undefined, launcher: DispatchLauncher | undefined, briefExtras: ((s: Snapshot, now: number, inFlight: Proposal[]) => Record<string, unknown>) | undefined, routesOf: RoutesLoader) {
  app.get("/api/dispatch/brief", async (c) => {
    const s = await getSnapshot();
    const cfg = loadDispatchConfig();
    const now = Date.now();
    const proposals = allProposals();
    // 값을 매긴 LOGBOOK: planner에는 fuelCost를 쓰지 않는다(TRIP FUEL은 카드의 사실 줄에만)
    const logbook = loadPricedLogbook();
    const fuel = watchFuel?.(s) ?? null;
    const landed = landedOf(logbook);
    const fleet = loadFleet();
    const plan = applyGroundStops(planDispatch(s, readFlightHistory(), cfg, now, reservedOf(proposals, now), fleet, landed, logbook, activeWaypointsOf(readLinearProjects().milestones), filesInFlight(), resumePlansOf(s, readDepartures(), landed, now, baseOfFleet(fleet, cfg.teamPattern)), mccAirportNow(), accountFolders(), undefined, orphanCountsNow(s, now, proposals, landed, cfg.teamPattern)), s.atfm?.groundStops ?? []);
    // SETTLED(ATC-117): 열린·HELD 제안마다 settled와 남은 분(settlesInMin)을 붙인다. OCC는 settled인 것만 메모·BRIEFING을 단다
    const { open, held, unsettled } = settledItemsOf(proposals, now, cfg.settleMin);
    const inFlight = proposals.filter(isInFlight).sort((a, b) => a.statusAt.localeCompare(b.statusAt));
    const recent = proposals
      .filter((p) => p.status !== "proposed" && !isInFlight(p) && now - Date.parse(p.statusAt) < 7 * DAY)
      .sort((a, b) => b.statusAt.localeCompare(a.statusAt))
      .slice(0, 50);
    const gate = gateOf(proposals);
    const files = readinessFiles();
    const keys = new Set([...proposals.map((p) => p.flight), ...plan.hold.flatMap((h) => [h.flight, ...h.blockedBy]), ...plan.excluded.map((e) => e.flight)]);
    const flights = Object.fromEntries(
      s.tickets.filter((t) => keys.has(t.key)).map((t) => {
        const cls = classOf(t.labels);
        // 분류(FLIGHT TYPE · WAKE · 필요한 TYPE RATING)와 TAIL ASSIGNMENT. 라벨이 없으면 기본값(BUILD · M)이다.
        const info = { title: t.title, state: t.state, priority: t.priority, project: t.project, url: t.url };
        return [t.key, { ...info, cls: classLabel(cls), clsDefault: !cls.explicit.type && !cls.explicit.wake, tails: [...tailsOf(t)] }];
      }),
    );
    const waiting = waitingOf(proposals, plan, cfg.teamPattern, s);
    // LAUNCH on approve(ATC-129): 상한은 살아 있는 백그라운드 세션 + 승인됐지만 아직 세션이 없는 launch 카드
    const launchCap = launchCapOf(s.sessions, proposals, launcher?.max ?? 0, cfg.teamPattern);
    return c.json({
      mode: cfg.mode,
      at: new Date(now).toISOString(),
      plan,
      cap: capStateOf(proposals, plan, cfg, now), // open proposals n/cap, 가득 차면 상한 때문에 기다리는 FLIGHT(ATC-403)
      open,
      held,
      unsettled, // 열린·HELD 중 아직 SETTLED가 아닌 수(메모가 있어도 센다). CROSSCHECK 브리핑의 unsettledMarks와 다르다
      waiting,
      // launch 카드(proposal.launch)마다 "LAUNCH on approve", 상한이 찬 열린 카드는 기다린다는 글(ATC-129)
      launch: launchViewOf([...open, ...held, ...inFlight], launchCap, k3LaunchWaits()),
      launchCap,
      approvedNoSession: approvedNoSessionOf(proposals, s, now, cfg.approvedWaitMin, cfg.teamPattern), // ATC-388
      briefs: await cardBriefsOf([...open, ...held], s, proposals, logbook, now, fuel, routesOf),
      inFlight,
      overdue: overdueOf(proposals, now),
      recent,
      flights,
      gate,
      reasonStats: reasonStatsOf(proposals),
      gate3: gate3Of(proposals, standFree?.timeliness() ?? null),
      // ARRIVED 후보(ATC-72): OCC가 증거를 확인하고 command를 친다. atc는 ARRIVED를 스스로 적지 않는다
      arrivalCandidates: standFree?.candidates() ?? [],
      // OCC 재시작 안전(ATC-169): arrivalMissing(머지됐는데 도착 보고가 없는 FLIGHT)과 restartSafety(지금 STOP·LAUNCH해도 잃는 것이 없나)
      ...(briefExtras?.(s, now, inFlight) ?? {}),
      crosscheck: crosscheckBriefOf([], now, cfg.settleMin), // CROSSCHECK 은퇴(ATC-371): 표시할 mark 대기가 없다
      judges: judgesBriefOf(proposals, recent, dispatchMarksOf(readJudgeLines()), loadJudges().jev),
      // 2b 켜기 점검표(표시만)
      readiness2b: readiness2bNow(gate, now, files),
      reasonCodes: REASON_CODES,
      config: cfg,
      // FUEL F8(ATC-56): OCC가 FLIGHT PLAN을 보내기 전에 보는 경고. HOLDING CAPTAIN의 COLD CACHE와 24시간 안 큰 LEAK. 막지 않는다
      fuel: fuel && { coldCache: fuel.coldCache, largeLeaks: fuel.largeLeaks, error: fuel.error },
      // 2b 전달(ATC-76): 제안 AIRCRAFT 세션의 출처·permission mode와 OCC의 mode. 다르면 warn(메시지가 붙들릴 수 있음). 막지 않는다
      delivery: deliveryMapOf(s, [...open, ...held, ...inFlight]),
      // SUPERVISOR CONFIRM AT AIRCRAFT(ATC-120): 카드·승인 창이 보일 표시와 붙여 넣을 한 줄. 승인을 막지 않는다
      confirm: Object.fromEntries([...open, ...held, ...inFlight].flatMap((p) => { const v = confirmViewOf(p); return v ? [[p.id, v]] : []; })),
    });
  });

  // 한 FLIGHT의 배정 기록(ATC-377): FLIGHT 서랍이 읽는다. 읽기만
  app.get("/api/dispatch/proposals", (c) => {
    const flight = (c.req.query("flight") ?? "").trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]*-\d+$/.test(flight)) return c.json({ error: "flight=ATC-n 형식이 필요함" }, 400);
    return c.json({ flight, mode: loadDispatchConfig().mode, proposals: proposalsOfFlight(allProposals(), flight) });
  });

  // send-guard가 쓰는 단건 조회
  app.get("/api/dispatch/proposals/:id", (c) => {
    const p = allProposals().find((x) => x.id === c.req.param("id").toUpperCase());
    return p ? c.json({ proposal: p, mode: loadDispatchConfig().mode }) : c.json({ error: "그런 제안이 없음" }, 404);
  });

  const reasonOf = (body: { reason?: unknown }) => (typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null);
  // 거절 사유 칩. disagree·reject에만 받는다(agree·approve에 칩을 보내면 400)
  const codesOf = (body: { reasonCodes?: unknown }, rejecting: boolean): string[] | { error: string } => {
    try {
      const codes = parseReasonCodes(body.reasonCodes);
      return codes.length && !rejecting ? { error: "reasonCodes는 disagree·reject에만" } : codes;
    } catch (e) {
      if (e instanceof ReasonCodeError) return { error: e.message };
      throw e;
    }
  };

  // 상태를 바꾸는 동작 하나. 모드·전이 규칙을 검사하고 op를 남긴다.
  const act =
    (name: DispatchAction) =>
    async (c: Context) => {
      const id = (c.req.param("id") ?? "").toUpperCase();
      const body = await c.req.json().catch(() => ({}));
      const p = allProposals().find((x) => x.id === id);
      if (!p) return c.json({ error: "그런 제안이 없음" }, 404);
      const mode = loadDispatchConfig().mode;
      const at = new Date().toISOString();
      const closed = (op: StatusOp) => (canApply(p, op) ? null : c.json({ error: `지금 상태(${p.status})에서는 할 수 없음` }, 409));
      // CAPTAIN의 답(accept=READBACK·decline=UNABLE·standby·await-supervisor)은 같은 FLIGHT로 뒤에 나간 FLIGHT PLAN이 있으면 최신 id로 안내하고 받지 않는다(ATC-554). RECALL의 답(recalled)은 거르지 않는다
      if (name === "accept" || name === "decline" || name === "standby" || name === "await-supervisor") {
        const stale = refuseStaleReply("flight-plan", id, name, flightPlanCalls(allProposals()));
        if (stale) return c.json({ error: stale }, 409);
      }
      if (JUDGE_ACTIONS.includes(name) && isBlind(id) && viaOf(body) === "crosscheck")
        return c.json({ error: "BLIND 카드는 CROSSCHECK 한 번 클릭으로 판정하지 않는다 — 카드를 보고 직접 판정" }, 409);
      if (JUDGE_ACTIONS.includes(name) && p.status === "proposed" && isHeld(p))
        return c.json({ error: "HELD 제안은 판정하지 않는다 — 대기열로 돌리거나(requeue) FLIGHT 보류를 확정(confirm-hold)" }, 409);

      if (name === "note") {
        if (typeof body.text !== "string" || !body.text.trim()) return c.json({ error: "text가 필요함" }, 400);
        append([{ op: "note", id, at, text: body.text.trim(), caution: Boolean(body.caution) }]);
      } else if (name === "briefing") {
        // 판정 전(열린 제안·HELD)에만. 다시 쓰면 덮어쓴다
        if (p.status !== "proposed") return c.json({ error: `지금 상태(${p.status})에서는 BRIEFING을 쓸 수 없음` }, 409);
        try {
          append([{ op: "brief", id, at, ...parseBriefing(body) }]);
        } catch (e) {
          if (e instanceof BriefingError) return c.json({ error: e.message }, 400);
          throw e;
        }
      } else if (name === "hold") {
        if (p.status !== "proposed") return c.json({ error: `지금 상태(${p.status})에서는 HOLD를 바꿀 수 없음` }, 409);
        if (p.kind !== "ASSIGN") return c.json({ error: "RELEASE 제안에는 HOLD를 걸지 않는다" }, 400);
        if (p.requeuedAt && !isHeld(p)) return c.json({ error: "SUPERVISOR가 대기열로 돌린 제안 — 다시 HOLD하지 않는다" }, 409);
        const raw = Array.isArray(body.blockedBy) ? body.blockedBy : [];
        const blockedBy: string[] = [...new Set<string>(raw.map((k: unknown) => String(k).toUpperCase()))];
        // 선행 FLIGHT 없는 HOLD(사람 결정·외부 입력 대기)는 사유가 note에 있어야 한다
        if (!blockedBy.length && !p.note) return c.json({ error: "선행 FLIGHT 없는 HOLD는 사유 메모(note)가 먼저 필요함" }, 400);
        const bad = blockedBy.find((k) => !/^[A-Z]+-\d+$/.test(k));
        if (bad) return c.json({ error: `FLIGHT key 형식이 아님: ${bad}` }, 400);
        if (blockedBy.includes(p.flight)) return c.json({ error: `자기 자신(${p.flight})을 선행 FLIGHT로 걸 수 없음` }, 400);
        // 목록에 없는 key는 오타일 가능성이 크다. 그대로 두면 풀리지 않는 HOLD가 된다
        const known = new Set((await getSnapshot()).tickets.map((t) => t.key));
        const unknown = blockedBy.find((k) => !known.has(k));
        if (unknown) return c.json({ error: `열린 FLIGHT 목록에 없는 key: ${unknown}` }, 400);
        append([{ op: "hold", id, at, blockedBy }]);
      } else if (name === "unhold") {
        // SUPERVISOR가 HOLD를 푼다. 제안은 닫고, FLIGHT는 다음 계획에서 다시 후보가 된다
        if (!isHeld(p)) return c.json({ error: "HOLD 중인 제안이 아님" }, 409);
        const bad = closed("supersede");
        if (bad) return bad;
        append([{ op: "supersede", id, at, reason: "SUPERVISOR가 HOLD를 풂 — 다시 후보" }]);
      } else if (name === "requeue") {
        // PREFLIGHT: HOLD를 풀고 같은 제안을 SUPERVISOR 대기열로 돌린다(24시간은 지금부터)
        if (p.status !== "proposed" || !isHeld(p)) return c.json({ error: "HOLD 중인 제안이 아님" }, 409);
        append([{ op: "requeue", id, at }]);
      } else if (name === "codes") {
        // ATC-5: 지난 그림자 거절에 사유 칩을 단다. 게이트 계산만 바꾸고 FLIGHT 보류(#56)는 뒤늦게 걸지 않는다
        if (p.status !== "disagreed") return c.json({ error: `거절(disagreed)한 제안에만 사유 칩을 단다 — 지금 ${p.status}` }, 409);
        if (p.via === "atfm" || p.via === "preflight") return c.json({ error: "사람 판정이 아닌 거절(ATFM·PREFLIGHT 확정)에는 달지 않는다" }, 409);
        let codes: string[];
        try {
          codes = parseReasonCodes(body.codes);
        } catch (e) {
          if (e instanceof ReasonCodeError) return c.json({ error: e.message.replace("reasonCodes", "codes") }, 400);
          throw e;
        }
        if (!codes.length) return c.json({ error: "codes(사유 칩 하나 이상)가 필요함" }, 400);
        append([{ op: "recode", id, at, by: "SUPERVISOR", codes }]);
      } else if (name === "confirm-hold") {
        // PREFLIGHT 확정: FLIGHT 칩으로 닫아 #56의 FLIGHT 보류(24시간, 이슈가 바뀌면 풀림)를 건다. 사람 판정(게이트)에는 세지 않는다
        if (p.status !== "proposed" || !isHeld(p)) return c.json({ error: "HOLD 중인 제안이 아님" }, 409);
        if (p.hold.length) return c.json({ error: `선행 FLIGHT(${p.hold.join(", ")}) HOLD는 확정하지 않는다 — 선행이 끝나면 atc가 푼다` }, 409);
        const codes = confirmCodesOf(p);
        const reason = confirmReasonOf(p, codes);
        append([
          mode === "shadow"
            ? { op: "verdict", id, at, verdict: "disagree", reason, via: "preflight", reasonCodes: codes }
            : { op: "reject", id, at, reason, via: "preflight", reasonCodes: codes },
        ]);
      } else if (name === "verdict") {
        if (mode !== "shadow") return c.json({ error: "그림자 판정은 shadow 모드에서만 — approval 모드에서는 approve/reject" }, 409);
        if (body.verdict !== "agree" && body.verdict !== "disagree") return c.json({ error: "verdict는 agree|disagree" }, 400);
        const codes = codesOf(body, body.verdict === "disagree");
        if (!Array.isArray(codes)) return c.json(codes, 400);
        const bad = closed("verdict");
        if (bad) return bad;
        const reason = body.verdict === "disagree" ? composeReason(codes, reasonOf(body)) : reasonOf(body);
        append([{ op: "verdict", id, at, verdict: body.verdict, reason, via: viaOf(body), ...(codes.length ? { reasonCodes: codes } : {}), ...(isBlind(id) ? { blind: true as const } : {}) }]);
      } else if (name === "approve" || name === "reject") {
        if (mode !== "approval") return c.json({ error: "승인·거절은 approval 모드(2b)에서만" }, 409);
        const codes = codesOf(body, name === "reject");
        if (!Array.isArray(codes)) return c.json(codes, 400);
        const bad = closed(name);
        if (bad) return bad;
        const via = viaOf(body);
        const blind = isBlind(id) ? { blind: true as const } : {};
        if (name === "approve" && p.launch) {
          // LAUNCH on approve(ATC-129): SUPERVISOR가 이 화면에서 누른 승인만 세션을 띄운다(관제 세션의 CLI는 Origin이 없다)
          if (!fromThisApp(c)) return c.json({ error: "LAUNCH 카드는 SUPERVISOR가 화면에서 승인한다" }, 403);
          if (!launcher) return c.json({ error: "이 서버는 LAUNCH를 하지 않는다" }, 409);
          const s = await getSnapshot();
          const tp = loadDispatchConfig().teamPattern;
          const reg = regOfProposal(p, tp) ?? "";
          const live = s.sessions.some((x) => x.status !== "dead" && regKey(x.name, tp) === reg);
          const r = await approveLaunch(id, {
            live,
            cap: launchCapOf(s.sessions, allProposals(), launcher.max, tp),
            approve: { op: "approve", id, at, via, ...blind },
            append,
            launch: () => launcher.launch(s, reg, id, !!p.resume, p.flight),
            now: () => new Date().toISOString(),
          });
          if (!r.ok) return c.json({ error: r.error, proposal: allProposals().find((x) => x.id === id) }, r.status as 409);
          return c.json({ proposal: allProposals().find((x) => x.id === id), ...(r.wait ? { wait: r.wait } : {}) });
        }
        append([
          name === "approve"
            ? { op: "approve", id, at, via, ...blind }
            : { op: "reject", id, at, reason: composeReason(codes, reasonOf(body)), via, ...(codes.length ? { reasonCodes: codes } : {}), ...blind },
        ]);
      } else if (name === "release") {
        if (mode !== "approval") return c.json({ error: "FLIGHT PLAN은 approval 모드(2b)에서만 보낸다" }, 409);
        if (p.kind !== "ASSIGN") return c.json({ error: "RELEASE 제안은 보내지 않는다" }, 400);
        // 재송신: 이미 보낸 제안이면 같은 문구를 다시 돌려준다. 받을 세션이 없으면 그것도 보내지 않는다(ATC-183)
        if (p.status === "sent") {
          const snap = await getSnapshot();
          // FRESH START(ATC-73)가 새 세션의 첫 프롬프트로 보낸 것은 다시 보내지 않는다(같은 계획이 두 번 간다)
          if (p.sentVia === "fresh-start") return c.json({ error: "FRESH START가 새 세션의 첫 프롬프트로 이미 보냄 — 다시 보내지 않는다. READBACK을 기다린다" }, 409);
          const gone = noLiveSessionWhyOf(p, snap, loadDispatchConfig().teamPattern) ?? crossAccountWhyOf(p, snap, loadDispatchConfig().teamPattern);
          if (gone) return c.json({ error: gone }, 409);
          return c.json({ proposal: p, ...sendAddressOf(p, snap, loadDispatchConfig().teamPattern), message: p.message });
        }
        // 켜진 GROUND STOP이 걸린 AIRPORT에는 FLIGHT PLAN을 보내지 않는다(승인된 제안은 풀릴 때까지 기다린다)
        const stop = p.airport ? enforcedStops((await getSnapshot()).atfm?.groundStops ?? []).get(p.airport) : undefined;
        if (stop) return c.json({ error: `${groundStopWhy(stop)} — 풀릴 때까지 보내지 않는다` }, 409);
        const s = await getSnapshot();
        // 자동 FRESH START(ATC-560): 이 세션이 이미 FLIGHT를 날았고 AIRPORT 스위치가 켜져 있으면 서버가 새 세션의 첫 프롬프트로 보낸다(OCC는 보내지 않는다)
        const fresh = launcher?.beforeRelease ? await launcher.beforeRelease(p, s).catch((e: Error) => (console.error("[atc] auto FRESH START gate failed:", e), null)) : null;
        if (fresh) return c.json({ error: fresh }, 409);
        // /clear 뒤 첫 메시지를 기다리는 AIRCRAFT에는 아직 받을 세션이 없다(ATC-91). 승인은 그대로 두고 새 세션이 뜬 뒤에 보낸다
        const waits = restartingWhyOf(p, s, loadDispatchConfig().teamPattern) ?? launchReleaseWhyOf(p, s, loadDispatchConfig().teamPattern) ?? noLiveSessionWhyOf(p, s, loadDispatchConfig().teamPattern) ?? crossAccountWhyOf(p, s, loadDispatchConfig().teamPattern);
        if (waits) return c.json({ error: waits }, 409);
        const bad = closed("send");
        if (bad) return bad;
        const message = await flightPlanMessageOf(p, s);
        append([{ op: "send", id, at, message }]);
        const sent = allProposals().find((x) => x.id === id)!;
        return c.json({ proposal: sent, ...sendAddressOf(sent, s, loadDispatchConfig().teamPattern), message: sent.message });
      } else if (name === "undelivered") {
        // OCC의 SendMessage가 실패했다(ATC-183). READBACK처럼 OCC가 CLI로 알린다 — 대화 기록을 읽어 알아내지 않는다
        if (p.status !== "sent") return c.json({ error: `undelivered는 보낸 FLIGHT PLAN(sent)에만 — 지금 ${p.status}` }, 409);
        const reason = reasonOf(body);
        if (!reason) return c.json({ error: "undelivered에는 사유(reason)가 필요함" }, 400);
        if (reason.length > 300) return c.json({ error: "사유는 300자 이내" }, 400);
        append([{ op: "undelivered", id, at, reason, cause: causeOf(reason, typeof body.cause === "string" ? body.cause : null) }]);
      } else if (name === "cancel") {
        // 승인됐지만 아직 안 보낸 카드(approved)를 SUPERVISOR가 닫는다(ATC-272). 화면에서만(관제 세션의 CLI는 Origin이 없다). 보낸 뒤는 RECALL
        if (!fromThisApp(c)) return c.json({ error: "CANCEL은 SUPERVISOR가 화면에서 한다" }, 403);
        if (p.status !== "approved") return c.json({ error: `CANCEL은 승인된(approved) 카드에만 — 지금 ${p.status}${p.status === "sent" ? ". 보낸 FLIGHT PLAN은 RECALL" : ""}` }, 409);
        const bad = closed("supersede");
        if (bad) return bad;
        append([{ op: "supersede", id, at, reason: CANCELLED_WHY }]);
      } else if (name === "recall") {
        // SUPERVISOR만(화면·API). OCC의 atcctl에는 이 명령이 없다. 출발 중지와 상관없이 받는다(회수는 안전 쪽 동작)
        const reason = reasonOf(body);
        if (!reason) return c.json({ error: "RECALL에는 사유(reason)가 필요함" }, 400);
        if (reason.length > 300) return c.json({ error: "사유는 300자 이내" }, 400);
        if (p.status === "departed" && !isStandFreeAirborne(p))
          return c.json({ error: "STAND가 생긴(DEPARTED) FLIGHT는 RECALL하지 않는다 — SUPERVISOR가 CAPTAIN에게 직접" }, 409);
        const bad = closed("recall");
        if (bad) return bad;
        const s = await getSnapshot();
        const message = formatRecall(p, s.tickets.find((t) => t.key === p.flight), p.aircraftName ?? "", reason);
        append([{ op: "recall", id, at, reason, message }]);
      } else if (name === "recall-send") {
        // OCC가 보낼 RECALL 문구(상태는 바꾸지 않는다, 재송신도 같은 문구)
        if (mode !== "approval") return c.json({ error: "RECALL은 approval 모드(2b)에서만 보낸다 — shadow면 SUPERVISOR가 CAPTAIN에게 직접" }, 409);
        if (p.status !== "recalling" || !p.recallMessage) return c.json({ error: `RECALL 요청된 제안이 아님(${p.status})` }, 409);
        return c.json({ proposal: p, ...sendAddressOf(p, await getSnapshot(), loadDispatchConfig().teamPattern), message: p.recallMessage });
      } else if (name === "recalled") {
        const bad = closed("recalled");
        if (bad) return bad;
        append([{ op: "recalled", id, at }]);
      } else if (name === "accept") {
        const bad = closed("accept");
        if (bad) return bad;
        // STAND 없는 FLIGHT(SURVEY·CHECK)는 READBACK과 함께 DEPARTED
        append(readbackOps(p, (await getSnapshot()).tickets.find((t) => t.key === p.flight), at));
      } else if (name === "standby") {
        // CAPTAIN의 STANDBY D-xxxx(ATC-122): 받았지만 시간이 필요함. 상태는 그대로, overdue를 한 번 다시 센다
        if (p.status !== "sent") return c.json({ error: `STANDBY는 READBACK을 기다리는 FLIGHT PLAN(sent)에만 — 지금 ${p.status}` }, 409);
        append([{ op: "standby", id, at }]);
      } else if (name === "await-supervisor") {
        // CAPTAIN이 READBACK도 거절도 아닌 채 사용자의 go를 기다린다(ATC-120). 상태는 sent 그대로, 사유를 남긴다. 승인은 대신 보내지 않는다
        if (p.status !== "sent") return c.json({ error: `await-supervisor는 READBACK을 기다리는 FLIGHT PLAN(sent)에만 — 지금 ${p.status}` }, 409);
        const reason = reasonOf(body);
        if (!reason) return c.json({ error: "await-supervisor에는 CAPTAIN이 기다리는 것(reason)이 필요함" }, 400);
        if (reason.length > 300) return c.json({ error: "사유는 300자 이내" }, 400);
        append([{ op: "await-supervisor", id, at, reason }]);
      } else if (name === "arrived") {
        // STAND 없이 DEPARTED한 FLIGHT의 CAPTAIN 보고(OCC가 기록). STAND가 있는 FLIGHT는 LOGBOOK(머지)이 ARRIVED다
        const note = typeof body.note === "string" ? body.note.trim() : "";
        if (!note) return c.json({ error: "arrived에는 CAPTAIN 보고(note: 결과 링크나 한 줄)가 필요함" }, 400);
        if (note.length > 500) return c.json({ error: "보고는 500자 이내" }, 400);
        {
          const snap = await getSnapshot();
          const why = arrivedWhyNot(p, snap.tickets.find((t) => t.key === p.flight), {
            standNow: snap.workspaces.some((w) => w.ticketKey === p.flight),
            departureSeen: readDepartures().some((d) => d.flight === p.flight),
            report: foldReports(readReports()).has(p.flight),
          });
          if (why) return c.json({ error: why }, 409);
        }
        const bad = closed("arrived");
        if (bad) return bad;
        append([{ op: "arrived", id, at, note }]);
        // 확인된 STAND 없는 ARRIVED를 LOGBOOK에(TARGETS·CHECKRIDE·FUEL이 센다)
        try {
          standFree?.arrived(allProposals().find((x) => x.id === id)!, await getSnapshot());
        } catch (e) {
          console.error("[atc] STAND 없는 ARRIVED LOGBOOK:", e);
        }
      } else {
        const reason = reasonOf(body);
        if (!reason) return c.json({ error: "decline에는 CAPTAIN의 사유(reason)가 필요함" }, 400);
        const bad = closed("decline");
        if (bad) return bad;
        append([{ op: "decline", id, at, reason }]);
      }
      return c.json({ proposal: allProposals().find((x) => x.id === id) });
    };
  for (const name of DISPATCH_ACTIONS) {
    app.post(`/api/dispatch/proposals/:id/${name}`, act(name));
  }

  // CROSSCHECK는 은퇴했다(ATC-371): 새 mark를 받지 않는다. 옛 mark는 기록으로 읽힌다
  app.post("/api/dispatch/proposals/:id/crosscheck", (c) => c.json({ error: "CROSSCHECK는 은퇴했다(ATC-371) — 새 mark를 받지 않는다" }, 410));

  // 2a ↔ 2b 전환. 2b에서는 승인된 FLIGHT PLAN이 CAPTAIN에게 나간다.
  app.post("/api/dispatch/mode", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (body.mode !== "shadow" && body.mode !== "approval") return c.json({ error: "mode는 shadow|approval" }, 400);
    saveDispatchMode(body.mode);
    record({ t: new Date().toISOString(), kind: "dispatch", op: `mode:${body.mode}`, id: "-" });
    return c.json({ mode: loadDispatchConfig().mode });
  });

  // 사용자나 다른 세션이 팀에 붙여 넣을 DIRECT 배정 문구(ATC-32). ?to=TEAM_X면 머리에 받는 팀을 적는다
  app.get("/api/dispatch/flight/:key/brief", async (c) => {
    const key = c.req.param("key").toUpperCase();
    try {
      const to = c.req.query("to")?.trim().toUpperCase() || null;
      return c.json({ key, brief: "DIRECT", text: await directBriefOf(key, to) });
    } catch (e) {
      return c.json({ error: String((e as Error).message ?? e) }, 502);
    }
  });

  // DISPATCH 세션이 티켓 본문을 읽는 창구(Linear 읽기 전용)
  app.get("/api/dispatch/flight/:key", async (c) => {
    try {
      return c.json(await fetchIssueDetail(c.req.param("key").toUpperCase()));
    } catch (e) {
      return c.json({ error: String((e as Error).message ?? e) }, 502);
    }
  });
}

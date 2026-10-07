import type { QueueKind } from "./supervisor-queue.ts";

// QUEUE CONTRACT(ATC-546, docs/alerting.md "Queue contract"): HOME의 할 일 줄 하나하나가 약속하는 두 가지를 한 표에 둔다.
//   ends:   스스로 사라지는 조건(말로) + 그것을 구현한 함수. 사라지지 않는 줄은 SUPERVISOR가 영영 치워야 하는 줄이다(ATC-540~545)
//   action: SUPERVISOR가 HOME에서 누르는 것. 화면이 그리는 단추 하나(homeControlOf, web/src/home-rows.ts)와 같아야 한다
// 새 QUEUE 종류나 HOME에 닿는 알림 종류를 더하면 여기에 줄을 더한다. server/queue-contract.test.ts가 빠진 줄과 그려지지 않는 단추를 막는다. 순수(자료만)

// approve: 줄을 열어 승인·거절. brake: CANCEL·RECALL. hand: 손으로 전하는 카드(RELAY 초안 포함). answer: 선택지·PASS/FAIL로 답. done: 확인하고 Done으로. open: 그 일이 있는 화면·주소를 연다
export type HomeControl = "approve" | "brake" | "hand" | "answer" | "open" | "done";

export interface ContractRow {
  ends: string; // 무엇이 이 줄을 없애나
  endsBy: string; // 그 규칙을 구현한 함수(파일의 함수 이름)
  action: HomeControl;
  screenOnly: boolean; // true: 이 동작은 HOME 화면에서만 할 수 있다(누르는 자리가 줄뿐). false: 화면 밖(Linear, 다른 탭, 세션)에서 일이 끝난다
  gap?: string; // 알려진 어긋남: 선언한 동작이 아직 HOME에 그려지지 않는다. 시험이 정말 어긋나 있는지 확인하므로 고치면 이 칸도 지운다
}

export const QUEUE_CONTRACT: Record<QueueKind, ContractRow> = {
  PROPOSAL: { ends: "the proposal is judged (status no longer proposed), put on HOLD, or the server auto-approves ASSIGN (autoDispatch)", endsBy: "supervisorQueueOf", action: "approve", screenOnly: true },
  SCHEDULE: { ends: "the draft is judged, or the schedule mode is no longer approval", endsBy: "scheduleWaitsOnSupervisor", action: "approve", screenOnly: true },
  "FLEET PLAN": { ends: "the proposal is no longer open, or the latest cycle no longer produces it (stale)", endsBy: "supervisorQueueOf", action: "approve", screenOnly: true },
  "HUMAN CHECK": { ends: "PASS or FAIL is recorded in the PR body, or the PR is a draft/closed", endsBy: "waitsOnHuman", action: "answer", screenOnly: true },
  LANDING: { ends: "the PR is merged or closed, or its landing is no longer CLEARED for the SUPERVISOR (landBy)", endsBy: "supervisorQueueOf", action: "open", screenOnly: false },
  UPDATE: { ends: "the service catches up with origin/main, or main CI is no longer ok", endsBy: "supervisorQueueOf", action: "approve", screenOnly: true },
  "NEEDS YOU": { ends: "the session is no longer blocked or PENDING (an answer arrived, or it died)", endsBy: "waitingOnPersonOf", action: "open", screenOnly: false },
  RELAY: { ends: "the head changes, the PR closes, or a session holds the STAND (the offer disappears)", endsBy: "relayOffersOf", action: "hand", screenOnly: true },
  UNDELIVERED: { ends: "the text is marked delivered by hand, answered, sent again, or becomes moot (FLIGHT closed, PR closed, newer text delivered)", endsBy: "isMoot", action: "hand", screenOnly: true },
  GO: { ends: "the SUPERVISOR's go reaches the CAPTAIN (awaitSupervisor clears)", endsBy: "waitingOnPersonOf", action: "open", screenOnly: false },
  BACKLOG: { ends: "the issue is fired (Todo) or dropped (Canceled) on RELEASE", endsBy: "filedProposalsOf", action: "open", screenOnly: false },
  ALERT: { ends: "the condition behind the alert clears (the alert key disappears), see ALERT_CONTRACT", endsBy: "supervisorAlertsOf", action: "open", screenOnly: false },
  STUCK: { ends: "the FLIGHT is finished or no longer stuck, or a queue row of another kind holds it", endsBy: "stuckRowsOf", action: "brake", screenOnly: true },
  EFFECT: { ends: "the verdict is improved or the SUPERVISOR marks it wrong", endsBy: "openBadOf", action: "open", screenOnly: false },
  CLOSE: { ends: "the issue is Done in Linear (the approved CLOSE has no manual step left)", endsBy: "closeManualOf", action: "open", screenOnly: false },
  ARRIVED: { ends: "Linear moves the issue out of started (the click moves it to Done)", endsBy: "arrivedOpenOf", action: "done", screenOnly: true },
  DECISION: { ends: "the SUPERVISOR answers, the role withdraws, or the FLIGHT/PR is closed (moot)", endsBy: "isMoot", action: "answer", screenOnly: true },
};

// HOME에 닿는 알림: 목적지가 alerts이고 WARNING·CAUTION인 것(actionableAlertsOf). key의 앞마디(필요하면 앞 두 마디)로 가른다.
// ORPHAN FLIGHT의 RESUME 초안은 줄에 붙는 RELAY라 action이 hand여야 하는데 HOME은 아직 그리지 않는다(gap)
export interface AlertContractRow extends ContractRow {
  family: string; // key 앞마디: `alert`, `rts|halted` …
}

export const ALERT_CONTRACT: AlertContractRow[] = [
  { family: "alert|orphan-flight", ends: "a live session holds the STAND, or the PR merged or the FLIGHT was canceled", endsBy: "supervisorAlertsOf", action: "hand", screenOnly: true, gap: "ALERT 줄의 RELAY 초안(item.orphan)을 줄 상세가 그리지 않는다: 단추가 FLIGHT 화면으로 갈 뿐이다" },
  { family: "alert", ends: "the condition behind the alert (K3 hold, canceled FLIGHT's open PR, event-loop lag, health, conflict) clears", endsBy: "supervisorAlertsOf", action: "open", screenOnly: false },
  { family: "following", ends: "the FLIGHT FOLLOWING issue is resolved", endsBy: "supervisorAlertsOf", action: "open", screenOnly: false },
  { family: "follow|failed", ends: "the GO AROUND is answered, RTS succeeds, or the revert is undone", endsBy: "supervisorAlertsOf", action: "open", screenOnly: false },
  { family: "control", ends: "the control session is back, the stop check is cleared, or the duplicate job is stopped", endsBy: "controlDownOf", action: "open", screenOnly: false },
  { family: "control|absent", ends: "the control session is seen again, the SUPERVISOR acknowledges it or marks it false, or the escalation switch is turned off; each repeat replaces the previous key", endsBy: "absentEscalationsNow", action: "open", screenOnly: false },
  { family: "control|wake", ends: "the role is relaunched with /loop, or its wake breaker re-arms", endsBy: "wakeFallbackStuckNow", action: "open", screenOnly: false },
  { family: "host", ends: "memory is back above the limit", endsBy: "supervisorAlertsOf", action: "open", screenOnly: false },
  { family: "revert", ends: "the SUPERVISOR picks the lane and the AUTO REVERT switch again", endsBy: "supervisorAlertsOf", action: "open", screenOnly: false },
  { family: "recycle|wait", ends: "the session recycles, or its context is no longer over the cap", endsBy: "supervisorAlertsOf", action: "open", screenOnly: false },
  { family: "recycle|blocked", ends: "the session is no longer blocked on the SUPERVISOR (answered), it recycles, or its context is no longer over the cap", endsBy: "capBlockedOf", action: "open", screenOnly: false },
  { family: "reposition|stuck", ends: "a session exists for the aircraft again", endsBy: "repositionStuckOf", action: "open", screenOnly: false },
  { family: "rts|halted", ends: "the SUPERVISOR picks the MCC mode again (stop becomes null)", endsBy: "rtsHaltedOf", action: "open", screenOnly: false, gap: "알림의 link가 #home이라 HOME에서 누르면 제자리다(MCC 모드는 설정 창에서 고른다)" },
];

// 알림이 HOME 할 일에 닿지 않는 key 앞마디와 그 이유(destOf). 새 앞마디는 DEST_PREFIXES에 더할 때 여기나 ALERT_CONTRACT 중 한 곳에 둔다
export const ALERT_NOT_ON_HOME: Record<string, string> = {
  pending: "dest queue: a QUEUE row of its own kind (PROPOSAL, SCHEDULE, HUMAN CHECK, tool)",
  land: "dest queue or log: LANDING row, or MCC/the team lands it",
  rts: "rts|<at>|<result> is an event (log); rts|halted is in ALERT_CONTRACT",
  cap: "advisory only (idle session hint): ALERTS list, never HOME",
  recycle: "recycle|<session>|<t> is an event (log), recycle|over is advisory only; recycle|wait and recycle|blocked are in ALERT_CONTRACT",
  reposition: "reposition|<aircraft>|<t> and flap are events (log); stuck is in ALERT_CONTRACT",
  follow: "ready is a queue row, landed/deployed/arrived are log, stuck is the STUCK row; failed is in ALERT_CONTRACT",
};

// key 하나의 계약 줄: 가장 긴 family부터 맞춘다
export const alertRowOf = (key: string): AlertContractRow | undefined =>
  [...ALERT_CONTRACT].sort((a, b) => b.family.length - a.family.length).find((r) => key === r.family || key.startsWith(`${r.family}|`));

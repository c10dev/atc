import type { Restarting } from "./restarting.ts";
import type { CarriedReview, CodexFindingSummary, CodexUnavailable, ExtReviewState, Stranded } from "./landing.ts";
import type { GroundStop, MainStatus } from "./atfm.ts";
import type { AutolandView } from "./autoland.ts";
import type { Health } from "./health.ts";
import type { FuelRemaining } from "./fuel-remaining.ts";
import type { HumanCheckStatus, UiChange } from "./human-check.ts";
import type { SessionOrigin } from "./session-origin.ts";
import type { Job } from "./job-state.ts";
export type Agent = "claude" | "codex";

export interface Session {
  id: string;
  agent: Agent;
  name: string; // "TEAM_B", 세션 제목
  status: "busy" | "idle" | "dead";
  pid: number | null;
  cwd: string;
  startedAt: string;
  lastActiveAt: string | null;
  // cwd가 속한 저장소와 워크스페이스. 본 체크아웃이면 workspacePath === repo (TOWER)
  repo: string | null;
  workspacePath: string | null;
  // AIRCRAFT health(ATC-45): 왜 멈췄는지, 무엇을 기다리는지. 문제가 없으면 없다(null)
  health?: Health | null;
  // 세션 출처(ATC-76): background·desktop·terminal·unknown. 살아 있는 claude 세션만(죽었거나 codex면 없다)
  origin?: SessionOrigin;
  permissionMode?: string | null; // 명령줄의 --permission-mode, 백그라운드면 LAUNCH 기록. 모르면 null
  // 한도로 잘리거나(cut LIMIT) 한도가 풀렸는데 멈췄거나(RESUME) 멈춘(STALLED) AIRCRAFT가 쥔 FLIGHT 중, 점유(claimTtl)가 지나 claims에서 빠진 것.
  // FLEET 줄이 FLIGHT를 잃지 않게 한다(ATC-86). 그 밖에는 없다
  keptFlights?: string[];
  // 백그라운드 job 상태(ATC-99): ~/.claude/jobs/<jobId>/state.json에서 읽은 state·detail·needs. bg 세션이 아니거나 못 읽으면 없다(null)
  job?: Job | null;
}

export interface Airport {
  id: string; // 첫 커밋 해시 (폴더를 옮겨도 같다)
  repo: string; // 본 체크아웃 경로
  name: string;
  code: string; // 대문자 4자
}

// AIRPORT 관리 화면용. open: 운항 중, closed: 폐쇄, missing: 등록된 경로에 저장소가 없음
export interface AirportStatus extends Airport {
  closed: boolean;
  status: "open" | "closed" | "missing";
  discovered: boolean;
  addedAt: string;
}

export interface Workspace {
  path: string;
  name: string; // 디렉터리 이름
  repo: string; // 본 체크아웃 경로
  isMain: boolean;
  branch: string | null; // detached면 null
  head: string;
  dirty: number | null; // 변경 파일 수, 아직 모르면 null
  lastCommitAt: string | null;
  ticketKey: string | null; // 브랜치의 voc-<n>에서 추출
  // 이 브랜치의 마지막 커밋이 origin에 있나(origin/<branch> 추적 ref가 HEAD와 같다, ATC-86). 브랜치가 없거나 origin이 없으면 null. 모르면 없다
  pushed?: boolean | null;
}

export type TicketStateType =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled"
  | "duplicate"
  | "unknown";

export interface Ticket {
  key: string; // "VOC-191"
  title: string;
  state: string; // Linear workflow state 이름
  stateType: TicketStateType;
  stateColor: string | null;
  assignee: string | null;
  takenBy: string | null; // atc 밖에서 맡은 사람·agent(Linear 위임 대상이나 API 키 주인이 아닌 담당자). DISPATCH가 배정하지 않는다
  priority: number; // 0 없음, 1 긴급 … 4 낮음
  url: string | null;
  updatedAt: string | null;
  project: string | null;
  labels: string[];
  createdAt: string | null;
  startedAt: string | null; // started 상태(ENROUTE 등)에 들어간 시각
  blocks: string[]; // 이 FLIGHT가 막고 있는 FLIGHT key
  blockedBy: string[]; // 이 FLIGHT를 막고 있는 FLIGHT key
  related: string[];
  parent: string | null; // 상위 이슈 key (Linear parent)
  children: string[]; // 하위 이슈 key (Linear children)
}

// 상위 이슈(하위 이슈를 묶는 컨테이너). Linear의 children이 있거나 다른 FLIGHT의 parent로 지목된 것.
// 이런 FLIGHT는 그 자체로 작업 대상이 아니다: 배정하지 않고, 방치(RELEASE·NO CONTACT)로도 보지 않는다.
export function parentKeysOf(tickets: Ticket[]): Set<string> {
  const keys = new Set(tickets.filter((t) => t.children.length).map((t) => t.key));
  for (const t of tickets) if (t.parent) keys.add(t.parent);
  return keys;
}

export interface TicketColumn {
  name: string;
  type: TicketStateType;
  color: string | null;
}

// hook: PostToolUse hook 기록, cwd: 세션 cwd가 워크트리 안(Codex), transcript: 대화 기록 추정
export type ClaimSource = "hook" | "cwd" | "transcript";

export interface Claim {
  sessionId: string;
  workspacePath: string;
  since: string;
  lastAt: string;
  source: ClaimSource;
  tool: string | null;
  // handed-off: 다른 세션이 이어받았다. 점유로 치지 않고 기록으로만 보여준다.
  state: "active" | "handed-off";
  handedOffTo: string | null;
}

export interface Handoff {
  workspacePath: string;
  from: string;
  to: string;
  at: string;
}

export type AlertKind = "conflict" | "orphan" | "unattended" | "no-workspace" | "stranded" | "health"; // stranded: 기본 브랜치에 닿지 않은 머지(ATC-29), health: AIRCRAFT health ALERT(ATC-45)

export interface Alert {
  kind: AlertKind;
  message: string;
  workspacePath?: string;
  sessionIds?: string[];
  ticketKey?: string;
  key?: string; // 같은 kind·STAND·FLIGHT로 가를 수 없는 경보의 구분 키(health)
}

// CLEARANCE. TOWER 세션이 atc에 기록하고 팀 세션에 메시지로 보낸다. 팀이 READBACK하면 readbackAt이 찍힌다.
export type ClearanceType = "TRAFFIC" | "HOLD" | "CONTINUE" | "LAND" | "REPORT" | "INFO";

export interface Clearance {
  id: string; // "C-0007"
  at: string;
  to: string; // sessionId
  toName: string; // 보낼 때의 세션 이름 (SendMessage 주소)
  type: ClearanceType;
  stand: string | null; // 워크스페이스 경로
  flight: string | null; // "VOC-191"
  text: string;
  readbackAt: string | null; // READBACK이나 ROGER로 닫힌 시각
  cancelledAt: string | null;
  // 응답(ATC-122, server/response.ts). 옛 기록에는 없다
  ackWord?: "READBACK" | "ROGER"; // 무엇으로 닫혔나
  unableAt?: string | null; // UNABLE로 닫힌 시각
  unableReason?: string | null;
  standbyAt?: string | null; // 첫 STANDBY(overdue를 한 번 다시 센다)
  standbys?: number;
}

export type TrafficEventKind =
  | "alert.raised"
  | "alert.cleared"
  | "handoff"
  | "landing.requested"
  | "landing.cleared"
  | "landing.blocked"
  | "landing.left"
  | "session.lost"
  | "away.started"
  | "away.ended"
  | "groundstop.started" // 켜진 스위치로 실제로 막는 출발 중지만(그림자는 FLIGHT RECORDER에만)
  | "groundstop.ended";

// 스냅샷 사이의 변화. CONTROLLER가 "지난번 이후 무엇이 바뀌었나"를 읽는 단위.
export interface TrafficEvent {
  id: number;
  at: string;
  kind: TrafficEventKind;
  alertKind?: AlertKind;
  workspacePath?: string;
  ticketKey?: string;
  sessionIds?: string[];
  repo?: string; // away.*: OUTSTATION으로 간 AIRPORT(저장소), landing.*: PR의 AIRPORT
  pull?: number; // landing.*: PR 번호
  blocks?: LandingBlockCode[]; // landing.requested·landing.blocked: 그때 막힌 조건
  carriedFrom?: string; // landing.cleared: 이전 커밋의 리뷰를 이어받아 CLEARED가 됐으면 그 커밋(ATC-31)
  message?: string;
}

// CLEARED TO LAND 조건(server/landing.ts). 하나라도 걸리면 APPROACH.
export type LandingBlockCode =
  | "stacked" // base가 기본 브랜치가 아님(쌓인 PR, ATC-29). 이 PR은 CLEARED가 되지 않는다
  | "draft"
  | "checks-pending"
  | "checks-failed"
  | "no-checks"
  | "no-review"
  | "review-stale"
  | "review-findings" // head에 Codex 지적(COMMENTED 리뷰)이 있고 그 뒤 👍가 없음
  | "changes-requested"
  | "behind"
  | "dirty"
  | "blocked"
  | "merge-unknown"
  | "los";

// GitHub에 열린 PR. LANDING SEQUENCE의 단위.
export interface PullRequest {
  repo: string; // AIRPORT 본 체크아웃 경로 (Workspace.repo와 같은 값)
  number: number;
  title: string;
  url: string;
  branch: string; // headRefName
  head: string; // headRefOid
  base: string;
  ticketKey: string | null; // 브랜치의 voc-<n>
  standPath: string | null; // 그 브랜치를 체크아웃한 워크트리 path
  draft: boolean;
  landing: "CLEARED" | "APPROACH";
  blocks: { code: LandingBlockCode; text: string }[]; // 한국어 한 줄씩
  readyAt: string | null; // 이 head에서 모든 조건이 처음 맞은 시각. CLEARED일 때만
  createdAt: string; // PR을 연 시각 (APPROACH 정렬, LAND CLEARANCE 짝짓기)
  carried?: CarriedReview | null; // main 병합만 한 head에 이어받은 이전 커밋의 리뷰(ATC-31)
  stack?: { base: number | null; chain: number[] } | null; // 쌓인 PR의 사슬(아래부터, ATC-29). base: 바로 아래 열린 PR
  codexFindings?: CodexFindingSummary | null; // 현재 head의 Codex 인라인 지적 등급별 수(ATC-28). ok면 P3만·모두 해결·답글이라 착륙을 막지 않음
  codexUnavailable?: CodexUnavailable | null; // CODEX UNAVAILABLE(ATC-7): Codex 한도·무응답
  extReview?: ExtReviewState | null;
  // HUMAN CHECK(ATC-37): PR 본문 `## UI change` 블록(없으면 null)과 이 head에서 사람 확인 상태(main 병합만 한 head는 이어받음)
  uiChange?: UiChange | null;
  humanCheck?: HumanCheckStatus | null;
  externalExclusion?: string | null; // 외부 리뷰에서 빼는 사유(ATC-27·30). null이면 REVIEW에 보낼 수 있음. 모르면 없음 // Codex를 쓸 수 없을 때 Muse 리뷰 상태(제외·대기·통과·지적). Codex를 쓸 수 있으면 null
}

export interface Snapshot {
  at: string;
  linear: { enabled: boolean; error: string | null; fetchedAt: string | null };
  github: { enabled: boolean; error: string | null; fetchedAt: string | null };
  sessions: Session[];
  workspaces: Workspace[];
  tickets: Ticket[];
  columns: TicketColumn[];
  airports: Airport[];
  claims: Claim[];
  handoffs: Handoff[];
  alerts: Alert[];
  clearances: Clearance[]; // READBACK 대기 중이거나 최근 24시간 안의 CLEARANCE
  pulls: PullRequest[]; // 열린 PR. CLEARED(readyAt 순) 다음 APPROACH(연 순서)
  stranded?: Stranded[]; // 기본 브랜치에 닿지 않은 머지(ATC-29). 경보(kind stranded)와 FLIGHT FOLLOWING이 읽는다
  atfm: { mains: MainStatus[]; groundStops: GroundStop[] }; // 기본 브랜치 CI와 출발 중지(docs/atfm.md)
  autoland?: AutolandView; // AUTOLAND(ATC-34): AIRPORT마다 다음 할 일, PR마다 표시·제외 사유
  fuel?: Record<string, FuelRemaining>; // FUEL REMAINING(ATC-55): REGISTRATION(대문자) → 그 ACCOUNT의 가장 새 statusline 값
  fuelAccounts?: FuelRemaining[]; // ACCOUNT마다 하나(ATC-60): 관제 세션만 있는 ACCOUNT도 들어간다
  restarting?: Restarting[]; // /clear 뒤 첫 메시지를 기다리는 AIRCRAFT(ATC-91). restartGraceMin 안에서만
}

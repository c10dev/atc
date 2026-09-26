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

export type AlertKind = "conflict" | "orphan" | "unattended" | "no-workspace";

export interface Alert {
  kind: AlertKind;
  message: string;
  workspacePath?: string;
  sessionIds?: string[];
  ticketKey?: string;
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
  readbackAt: string | null;
  cancelledAt: string | null;
}

export type TrafficEventKind =
  | "alert.raised"
  | "alert.cleared"
  | "handoff"
  | "landing.requested"
  | "landing.left"
  | "session.lost"
  | "away.started"
  | "away.ended";

// 스냅샷 사이의 변화. CONTROLLER가 "지난번 이후 무엇이 바뀌었나"를 읽는 단위.
export interface TrafficEvent {
  id: number;
  at: string;
  kind: TrafficEventKind;
  alertKind?: AlertKind;
  workspacePath?: string;
  ticketKey?: string;
  sessionIds?: string[];
  repo?: string; // away.*: OUTSTATION으로 간 AIRPORT(저장소)
  message?: string;
}

export interface Snapshot {
  at: string;
  linear: { enabled: boolean; error: string | null; fetchedAt: string | null };
  sessions: Session[];
  workspaces: Workspace[];
  tickets: Ticket[];
  columns: TicketColumn[];
  airports: Airport[];
  claims: Claim[];
  handoffs: Handoff[];
  alerts: Alert[];
  clearances: Clearance[]; // READBACK 대기 중이거나 최근 24시간 안의 CLEARANCE
}

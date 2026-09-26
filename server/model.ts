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
  // cwd가 속한 저장소와 워크스페이스. 본 체크아웃이면 workspacePath === repo (관제탑)
  repo: string | null;
  workspacePath: string | null;
}

export interface Airport {
  repo: string; // 본 체크아웃 경로
  name: string; // 폴더 이름
  code: string; // 대문자 4자
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
}

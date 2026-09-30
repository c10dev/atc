import { MOVABLE_TYPES } from "./detail.ts";

// FLIGHT 상태 버튼(DUTY G3, docs/duty.md 3.6)의 순수 판정. 쓰기는 sources/linear-write.ts, 길은 flight-state-run.ts.
// 서버는 스스로 Linear를 쓰지 않는다: 이 판정을 지난 SUPERVISOR의 클릭 하나가 이슈 하나의 상태를 한 번 옮긴다.

export interface MoveBody {
  from: string;
  to: string;
}
export type MoveParse = { ok: true; move: MoveBody } | { ok: false; error: string };

// 요청 본문: {from, to}는 둘 다 상태 이름 문자열
export function parseMoveBody(raw: unknown): MoveParse {
  const b = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const name = (v: unknown) => (typeof v === "string" && v.trim() && v.length <= 64 && !/[\u0000-\u001f]/.test(v) ? v.trim() : null);
  const from = name(b.from);
  const to = name(b.to);
  if (!from || !to) return { ok: false, error: "본문은 {from, to}(상태 이름)" };
  return { ok: true, move: { from, to } };
}

export interface TeamState {
  id: string;
  name: string;
  type: string;
}
export interface MoveIssue {
  id: string; // Linear의 이슈 id(mutation에 쓴다)
  key: string;
  team: string | null; // 팀 key(ATC …)
  state: { name: string; type: string };
  states: TeamState[]; // 그 팀의 워크플로 상태 전부
}
export type MoveVerdict = { ok: true; stateId: string; to: TeamState } | { ok: false; status: 400 | 403 | 409; error: string };

// 옮겨도 되나. 순서: 우리가 읽는 팀인가(403) → 지금 상태가 from 그대로인가(409) → 지금 상태가 Backlog·Todo·Canceled인가(409)
// → to가 이 팀의 Backlog·Todo·Canceled 상태인가(400). 같은 상태로 옮기는 것은 400
export function moveVerdict(issue: MoveIssue, move: MoveBody, teams: readonly string[]): MoveVerdict {
  if (!issue.team || !teams.includes(issue.team.toUpperCase())) return { ok: false, status: 403, error: `팀 ${issue.team ?? "?"}은 atc가 읽는 팀이 아님` };
  if (issue.state.name !== move.from) return { ok: false, status: 409, error: `상태가 이미 바뀜: 지금 ${issue.state.name} (요청한 from ${move.from})` };
  if (!MOVABLE_TYPES.includes(issue.state.type)) return { ok: false, status: 409, error: `${issue.state.name}(${issue.state.type})에서는 옮기지 않는다 — 팀의 PR과 Linear의 몫` };
  const to = issue.states.find((x) => x.name === move.to);
  if (!to) return { ok: false, status: 400, error: `이 팀에 없는 상태: ${move.to}` };
  if (!MOVABLE_TYPES.includes(to.type)) return { ok: false, status: 400, error: `${to.name}(${to.type})로는 옮기지 않는다 — Backlog·Todo·Canceled만` };
  if (to.name === issue.state.name) return { ok: false, status: 400, error: "이미 그 상태" };
  return { ok: true, stateId: to.id, to };
}

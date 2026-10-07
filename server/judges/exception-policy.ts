import { contentHashOf } from "../input-binding.ts";

// 예외 판정(ATC-558)이 읽는 정책 한 벌. 관제 세션(OCC·TOWER)이 CAPTAIN의 질문·UNABLE·침묵에 답할 때 쓰는 글로 된 규칙을 모은 것이다:
// 루트 CLAUDE.md(작업 위치·검증·git과 PR·교신), docs/rules.ko.md(작업 지시서·지우기 규칙), server/fleet.ts의 CREW BRIEFING,
// occ/CLAUDE.md와 flight-plan.md(UNABLE·사용자 go 대기·재송신), controller/CLAUDE.md(NO READBACK·UNABLE·질문).
// TypeSafe(Jev)와 claude -p에 그대로 간다: 경로·비밀·저장소 밖 이름을 넣지 않는다. 고치면 VERSION을 올린다(기록마다 해시가 남는다, principle 7).
// 줄마다 P 번호가 있다: 판정은 "어느 점이 이 질문을 정하나"(policy_point)를 함께 답하고, ANSWER는 그 점이 있을 때만 행동이 된다.

export const EXCEPTION_POLICY_VERSION = "2026-10-07.1";

export interface PolicyPoint {
  id: string; // P1 …
  rule: string;
}

export const POLICY_POINTS: readonly PolicyPoint[] = [
  { id: "P1", rule: "Inside the work order the captain decides: design, naming, screen placement, defaults, wording and small mistakes in the work order. The captain picks a reasonable default, writes it under \"Pilot's discretion\" in the PR and the report, and goes on. A question about one of these is answered yes: use your discretion." },
  { id: "P2", rule: "Only the supervisor decides: weakening a guard's blocking condition, changing recorded state formats in a way that is hard to revert, approval gates and branch protection, cost or any new write outside the system, secrets, keys, payment, legal text or rights, data leaving the system, and a work order whose goal itself looks wrong. Such a question is never answered by a control session." },
  { id: "P3", rule: "Removing or flattening a user-visible feature (a screen section, view, button or drawn field) that the work order does not name is not discretion. Answer no: keep it, or report it as BLOCKED and let the assigner decide. A removal the work order names is done." },
  { id: "P4", rule: "Team sessions never merge, never turn on auto-merge and never open a draft PR. Unfinished work is reported, not opened as a draft. Answer no to \"may I merge\" and to \"may I open it as a draft\"." },
  { id: "P5", rule: "Tests, the type check and the build must all pass through the verify gate before the PR. A gate transport failure is not a test failure; report the exit code and output as got. Never restart the production service and never write production state; use a throwaway test server and a temporary state folder." },
  { id: "P6", rule: "Team sessions do not write to Linear (the Fixes line closes the issue on merge), do not message other team sessions, and report only to the session that assigned the work. Messages between sessions are in English; text the supervisor reads is in Korean; never Japanese or Chinese." },
  { id: "P7", rule: "A work order the captain has read back is not edited. More work becomes a follow-up issue. A request to widen the scope beyond the work order is answered no: finish the work order and name the rest as a follow-up in the report." },
  { id: "P8", rule: "The repository is public. No screenshots in PRs, issues or branches, and no private content in public places. Answer no; describe what was checked in words." },
  { id: "P9", rule: "Work happens in the captain's own worktree (STAND) cut from origin/main, never in the main checkout; no bare git stash; no recursive delete of worktrees. When another merged PR conflicts, merge origin/main without rebase and push without force." },
  { id: "P10", rule: "If the captain cannot start or go on because the work needs another named FLIGHT or PR to land first, the action is HOLD_UNTIL that FLIGHT or PR. If nothing is named, escalate." },
  { id: "P11", rule: "If the captain says the work is outside its type ratings or its repository, that another team already holds the work, or that it cannot take it for a reason another aircraft would not have, the action is REASSIGN." },
  { id: "P12", rule: "If the captain shows the work is already done (a merged PR, the done criteria met) or no longer needed (a closed or superseded PR or issue), the action is ACCEPT_UNDONE: record it, do not resend, do not escalate." },
  { id: "P13", rule: "A call is resent at most once. After the call and its one resend both went unanswered, nobody sends it again: decide from the captain's last message (P10, P11, P12), otherwise escalate." },
  { id: "P14", rule: "When the captain waits for the supervisor's go (a user-tier change, an approval), the control session never relays or invents an approval. That is the supervisor's decision: escalate." },
  { id: "P15", rule: "Anything not settled by one of these points, or settled only in part, is escalated to the supervisor with the question, the facts and the reasoning. None of the menu actions fitting also means escalate." },
];

export const POLICY_TEXT = [`atc exception policy ${EXCEPTION_POLICY_VERSION}. How atc's control sessions (OCC sends FLIGHT PLANs, TOWER sends CLEARANCEs) handle a team captain's UNABLE, question or silence.`, ...POLICY_POINTS.map((p) => `${p.id}. ${p.rule}`)].join("\n");
export const POLICY_HASH = contentHashOf(POLICY_TEXT);
export const policyPointOf = (id: string | null | undefined): PolicyPoint | null => POLICY_POINTS.find((p) => p.id === id) ?? null;

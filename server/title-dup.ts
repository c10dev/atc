import type { Ticket } from "./model.ts";
import type { RecordLine } from "./recorder.ts";
import { similarTickets } from "./schedule.ts";

// 비슷한 제목 검사(ATC-488): 같은 작업 지시서가 두 번 올라가는 일(2026-10-03 ATC-475와 ATC-476, 1초 간격)을 알아챈다. 순수 함수만.
// 규칙은 schedule NEW의 중복 검색과 같다(`similarTickets`). 여기서는 무엇을 후보로 보나만 정한다.
// 1) `duty linear create`: 열린 ATC 이슈와 거의 같은 제목이면 거절(Canceled·Duplicate·끝난 이슈는 세지 않는다). 2) PARKED 줄: MCP로 올린 이슈는 서버 검사를 거치지 않아 표시만 한다

const CLOSED = new Set(["completed", "canceled", "duplicate"]);
const DEAD = new Set(["canceled", "duplicate"]);
const WEEK = 7 * 86_400_000;

export interface TitleTwin {
  key: string;
  title: string;
}

// 새 제목과 비슷한 열린 ATC 이슈(없으면 null). 취소·중복·끝난 이슈는 후보가 아니다
export function openDuplicateOf(title: string, tickets: readonly Ticket[], now: number, team = "ATC"): TitleTwin | null {
  const open = tickets.filter((t) => !CLOSED.has(t.stateType) && t.key.startsWith(`${team}-`));
  return similarTickets(title, open, now)[0] ?? null;
}

// PARKED 줄의 표시: 이 이슈와 제목이 비슷한 다른 이슈(열린 것과 최근에 만들어졌거나 바뀐 것). 취소·중복은 후보가 아니다. 정보일 뿐이다
export function possibleDuplicateOf(self: Pick<Ticket, "key" | "title">, tickets: readonly Ticket[], now: number): TitleTwin | null {
  const others = tickets.filter((t) => t.key !== self.key && !DEAD.has(t.stateType) && t.key.split("-")[0] === self.key.split("-")[0]);
  return similarTickets(self.title, others, now)[0] ?? null;
}

export interface DuplicateCounts {
  refused: number; // 지난 7일 409로 거절한 수
  overrides: number; // 그 가운데 `--same-title-ok`로 넘겨 만든 수(거절을 사람이 뒤집음)
  bothFired: number; // PARKED 표시가 있는 이슈를 SUPERVISOR가 발권했는데 비슷한 이슈도 이미 발권돼 있던 수
}

// 오작동 세기: 기록(policy / duplicate-title)에서 7일 안의 것
export function duplicateCountsOf(lines: readonly RecordLine[], now: number): DuplicateCounts {
  const out: DuplicateCounts = { refused: 0, overrides: 0, bothFired: 0 };
  for (const l of lines) {
    if (l.kind !== "policy" || l.op !== "duplicate-title" || now - Date.parse(l.t) > WEEK) continue;
    if (l.event === "refused") out.refused++;
    else if (l.event === "override") out.overrides++;
    else if (l.event === "both-fired") out.bothFired++;
  }
  return out;
}

// PARKED 표시가 있는 이슈를 발권할 때 쌍도 이미 발권돼 있나(Todo 이상이고 취소·중복이 아님). 그러면 둘 다 쏜 것이다
export const twinAlreadyFired = (twin: Pick<Ticket, "stateType"> | undefined): boolean => Boolean(twin && (twin.stateType === "unstarted" || twin.stateType === "started" || twin.stateType === "completed"));

import { isCandidateTicket } from "./dispatch.ts";
import { parentKeysOf, type Ticket } from "./model.ts";
import type { ReleaseLine } from "./release.ts";

// PARKED(ATC-487): 후보 팀의 Backlog 이슈 가운데 막는 이슈가 없고 atc가 올린 제안도 아니라서 어느 화면에도 오르지 않던 것.
// RELEASE 화면이 접힌 절로 보이고, 발권 단추가 READY와 같은 길(/api/releases/fire)로 Todo로 옮기며 발권한다. 순수 함수만.
// 이 절은 스스로 아무것도 발권하거나 옮기지 않고 SUPERVISOR QUEUE에도 줄을 더하지 않는다. Sequence 줄은 순서 표시일 뿐 막지 않는다.

const FINISHED = new Set(["completed", "canceled", "duplicate"]);
const DAY = 86_400_000;
const WEEK = 7 * DAY;

export interface ParkedInput {
  tickets: readonly Ticket[];
  teams: Set<string>;
  filed: ReadonlySet<string>; // 제안으로 이미 보이는 이슈
  inTree?: ReadonlySet<string>; // 이미 나무의 줄인 이슈
}

export interface ParkedRow {
  key: string;
  title: string;
  state: string; // Linear 상태 이름(Todo로 옮길 때 from)
  priority: number;
  createdAt: string | null;
  by: string | null; // 올린 사람, 모르면 null
  hash: string | null;
  kEffects: string | null;
  k3: Ticket["k3"] | null;
  sequence: { after: string; reason: string } | null; // 줄이 읽혔을 때만. 막지 않고 숨기지도 않는다
}

// 오래된 이슈가 위, 같으면 key 순
export function parkedOf(inp: ParkedInput): ParkedRow[] {
  const parents = parentKeysOf(inp.tickets as Ticket[]);
  return inp.tickets
    .filter((t) => t.stateType === "backlog" && t.blockedBy.length === 0 && !parents.has(t.key) && isCandidateTicket(t, inp.teams) && !inp.filed.has(t.key) && !inp.inTree?.has(t.key))
    .map((t): ParkedRow => ({
      key: t.key,
      title: t.title,
      state: t.state,
      priority: t.priority,
      createdAt: t.createdAt,
      by: t.creator ?? null,
      hash: t.releaseHash ?? null,
      kEffects: t.kEffects ?? null,
      k3: t.k3 ?? null,
      sequence: t.sequence && !t.sequence.problem && t.sequence.after && t.sequence.reason ? { after: t.sequence.after, reason: t.sequence.reason } : null,
    }))
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.key.localeCompare(b.key, "en", { numeric: true }));
}

export type ParkedVerdict = { ok: true; ticket: Ticket } | { ok: false; status: 409; error: string };

// 발권 단추가 누른 이슈를 PARKED로 받을 수 있나. 스위치가 꺼져 있으면 늘 거절(옛 동작). 막는 이슈가 안 끝난 것은 "기다림"으로 남는다
export function parkedFireVerdict(inp: ParkedInput & { on: boolean }, key: string): ParkedVerdict {
  const no = (error: string): ParkedVerdict => ({ ok: false, status: 409, error });
  const t = inp.tickets.find((x) => x.key === key);
  if (!inp.on || !t) return no(`${key}는 발권할 수 있는 READY Backlog FLIGHT나 제안이 아님`);
  if (parentKeysOf(inp.tickets as Ticket[]).has(key)) return no(`${key}는 상위 이슈 — 하위 이슈가 작업`);
  if (!isCandidateTicket(t, inp.teams)) return no(`${key}는 후보 팀의 이슈가 아님`);
  if (t.stateType !== "backlog") return no(`${key}는 Backlog가 아님`);
  const pending = t.blockedBy.filter((k) => !FINISHED.has(inp.tickets.find((x) => x.key === k)?.stateType ?? ""));
  if (pending.length) return no(`${key}는 ${pending.join(", ")}를 기다림`);
  if (!parkedOf(inp).some((r) => r.key === key)) return no(`${key}는 PARKED 이슈가 아님`);
  return { ok: true, ticket: t };
}

export interface ParkedMisfires {
  fired: number; // 최근 7일에 PARKED 절에서 발권한 수
  misfires: string[]; // 그 가운데 24시간 안에 Canceled·Duplicate가 된 이슈 key
}

// 이슈가 취소·중복으로 닫힌 시각은 updatedAt으로 갈음한다(Linear가 상태를 바꾸면 updatedAt이 움직인다). 순수
export function parkedMisfiresOf(lines: readonly ReleaseLine[], tickets: readonly Ticket[], now: number): ParkedMisfires {
  const byKey = new Map(tickets.map((t) => [t.key, t]));
  const mine = lines.filter((l) => l.op === "release" && l.parked && now - Date.parse(l.at) <= WEEK);
  const bad = new Set<string>();
  for (const l of mine) {
    if (l.op !== "release") continue;
    const t = byKey.get(l.flight);
    if (!t || (t.stateType !== "canceled" && t.stateType !== "duplicate") || !t.updatedAt) continue;
    const gap = Date.parse(t.updatedAt) - Date.parse(l.at);
    if (gap >= 0 && gap <= DAY) bad.add(l.flight);
  }
  return { fired: mine.length, misfires: [...bad].sort() };
}

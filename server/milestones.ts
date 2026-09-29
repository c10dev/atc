import type { Departure } from "./departures.ts";
import type { LogEntry } from "./logbook.ts";
import type { RtsRecord } from "./mcc.ts";
import type { Proposal } from "./proposals.ts";

// OOOI(ATC-123): FLIGHT마다 OUT(DEPARTED)·OFF(PR을 엶)·ON(머지)·IN(RTS로 서비스에 들어감)의 실제 시각.
// atc가 이미 가진 기록에서만 셈한다(순수). 모르면 null이고 추측하지 않는다. 목표 시각·지연 사유·ETA는 아직 없다.
// 브라우저에서도 쓰므로 node 모듈을 끌어오지 않는다(타입 import만).

export const MILESTONES = ["out", "off", "on", "in"] as const;
export type Milestone = (typeof MILESTONES)[number];

export interface Milestones {
  out: string | null;
  off: string | null;
  on: string | null;
  in: string | null;
  // ON의 PR이 되돌려졌다. ON과 IN은 그대로 두고 화면이 알린다
  reverted: { number: number; url: string; at: string } | null;
}
export const EMPTY_MILESTONES: Milestones = { out: null, off: null, on: null, in: null, reverted: null };

const MIN = 60_000;

export interface MilestoneSources {
  departures: Pick<Departure, "flight" | "t">[]; // DEPARTURE LOG(departures.jsonl)
  proposals: Pick<Proposal, "flight" | "kind" | "timeline">[]; // STAND 없는 FLIGHT는 제안의 departed
  pulls: { ticketKey: string | null; createdAt: string }[]; // 열린 PR(스냅샷). 브랜치·Fixes·Refs로 FLIGHT에 묶인 것
  logbook: LogEntry[]; // 머지된 PR(ARRIVED 줄, 되돌린 것 포함)
  landingRequested: { flight: string | null; at: string }[]; // FLIGHT RECORDER의 landing.requested
  rts: Pick<RtsRecord, "at" | "to" | "result">[]; // rts.jsonl(읽기만)
  rtsAirport: string | null; // RTS가 배포하는 저장소의 AIRPORT 코드(MCC AIRPORT). 없으면 IN은 어디에도 없다
  // 그 머지 줄의 머지 커밋(git). 모르면 null
  mergeCommitOf: (entry: LogEntry) => string | null;
  // 커밋이 그 RTS 대상(to)에 들어 있나(git merge-base --is-ancestor)
  isAncestor: (commit: string, to: string) => boolean;
}

const earliest = (xs: (string | null | undefined)[]): string | null => {
  const ok = xs.filter((x): x is string => Boolean(x) && Number.isFinite(Date.parse(x!)));
  return ok.length ? ok.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a)) : null;
};

// FLIGHT 하나의 OOOI(순수)
export function milestonesOf(flight: string, src: MilestoneSources): Milestones {
  // OUT: DEPARTURE LOG의 첫 줄. 없으면 제안의 departed(STAND 없는 FLIGHT). 그것도 없으면 LOGBOOK이 출발 시각을 실제로 알던 줄(PR로 추정한 것은 뺀다)
  const merged = src.logbook.filter((e) => e.flight === flight && e.pr && e.landingWaitMin !== null);
  const out =
    earliest(src.departures.filter((d) => d.flight === flight).map((d) => d.t)) ??
    earliest(src.proposals.filter((p) => p.kind === "ASSIGN" && p.flight === flight).map((p) => p.timeline.departed)) ??
    earliest(merged.filter((e) => e.departedFrom !== "pr").map((e) => e.departedAt));

  // OFF: 이 FLIGHT의 PR 중 가장 이른 createdAt. 머지된 PR은 (머지 − 착륙 대기)로 센다. PR을 못 찾으면 첫 landing.requested
  const off = earliest([
    ...src.pulls.filter((p) => p.ticketKey === flight).map((p) => p.createdAt),
    ...merged.map((e) => new Date(Date.parse(e.arrivedAt) - e.landingWaitMin! * MIN).toISOString()),
    ...src.landingRequested.filter((e) => e.flight === flight).map((e) => e.at),
  ]);

  // ON: 머지된 PR(여럿이면 가장 이른 머지). 되돌려졌어도 ON은 그대로이고 reverted가 알린다
  const first = [...merged].sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt))[0];
  const on = first?.arrivedAt ?? null;
  const reverted = first?.reverted && first.revertedBy ? { number: first.revertedBy.number, url: first.revertedBy.url, at: first.revertedBy.at } : null;

  // IN: MCC AIRPORT의 FLIGHT만. 머지 커밋이 들어 있는 대상으로 성공한 첫 RTS의 시각(거절·실패·롤백은 건너뛴다)
  let inAt: string | null = null;
  if (first && on && src.rtsAirport && first.airport === src.rtsAirport) {
    const commit = src.mergeCommitOf(first);
    if (commit) {
      const hit = src.rts
        .filter((r) => r.result === "ok" && Date.parse(r.at) >= Date.parse(on))
        .sort((a, b) => a.at.localeCompare(b.at))
        .find((r) => src.isAncestor(commit, r.to));
      inAt = hit?.at ?? null;
    }
  }
  return { out, off, on, in: inAt, reverted };
}

export const hasMilestone = (m: Milestones | null | undefined) => Boolean(m && MILESTONES.some((k) => m[k]));

// 가장 늦은 시각의 이정표(FIDS REMARKS). 시각이 같으면 뒤 단계
export function latestMilestone(m: Milestones | null | undefined): { name: Milestone; at: string } | null {
  if (!m) return null;
  let best: { name: Milestone; at: string } | null = null;
  for (const name of MILESTONES) {
    const at = m[name];
    if (at && (!best || Date.parse(at) >= Date.parse(best.at))) best = { name, at };
  }
  return best;
}

// 좁은 한 줄: "OUT 03:12 · OFF 03:40 · ON 04:02 · IN 04:07". 닿지 않은 칸은 —
export function milestoneLine(m: Milestones | null | undefined, fmt: (iso: string) => string): string {
  return MILESTONES.map((k) => `${k.toUpperCase()} ${m?.[k] ? fmt(m[k]!) : "—"}`).join(" · ");
}

// 툴팁: 이정표마다 한 줄, 되돌려졌으면 그렇다고
export function milestoneTitle(m: Milestones | null | undefined, fmt: (iso: string) => string): string {
  const lines: string[] = MILESTONES.map((k) => `${k.toUpperCase()} ${m?.[k] ? fmt(m[k]!) : "—"}`);
  if (m?.reverted) lines.push(`ON은 그대로 — PR이 #${m.reverted.number}로 되돌려짐`);
  return lines.join("\n");
}

import { type CodexUnavailable, isCodexBot, repoCodexOf } from "./landing.ts";
import type { GhPull } from "./landing.ts";

// 조용한 리뷰 레인(ATC-386, docs/autonomy.md 원칙 5: 리뷰 레인이 둘이면 한쪽이 죽어도 PR이 몇 시간 기다리지 않는다). 순수 함수만. 기록 읽기·쓰기는 codex-lane-run.ts.
// 레인 둘: Codex(PR 댓글·리뷰·👍)와 REVIEW(착륙 리뷰 세션, Claude Sonnet). 기다리던 PR이 Codex를 6시간 기다려야 REVIEW로 가던 것을, 저장소 수준에서 Codex가 조용하다고 판단하면 곧바로 보낸다.
//   조용함: 이 저장소의 어느 PR에도 Codex 신호(리뷰·지적·👍·댓글·한도 안내)가 없고, 신호가 없던 동안 Codex를 기다린 PR이 있다(그 PR의 head·생성 뒤로 LANE_SILENT_MS가 지남).
//   다시 말함: 조용하다고 판단한 뒤 이 저장소에 Codex 신호가 하나라도 오면 새 head는 다시 Codex로 간다.
// REVIEW가 받지 않는 PR(비밀 경로, 보안 규칙 스위치가 꺼졌을 때의 보안 PR)은 그대로 제외다: 이 파일은 "Codex를 쓸 수 없다"만 바꾸고 제외 판단은 landing.ts의 gate가 한다.

export const LANE_SILENT_MS = 30 * 60_000;

export interface LaneOp {
  t: string; // 기록 시각
  repo: string;
  op: "silent" | "speaks";
  since?: string; // silent: 조용해진 것으로 보는 시각(기다린 PR의 base + LANE_SILENT_MS)
  evidence?: number[]; // silent: 기다리던 PR 번호
}

export type LanePull = Pick<GhPull, "number" | "codex" | "reviews" | "createdAt"> & Partial<Pick<GhPull, "isDraft">>;

// 저장소의 지금 상태: 기록의 마지막 줄. silent면 그 since
export function laneSilentSince(ops: readonly LaneOp[], repo: string): string | null {
  const last = ops.filter((o) => o.repo === repo).at(-1);
  return last?.op === "silent" ? (last.since ?? last.t) : null;
}

const latestOf = (ts: (string | null | undefined)[]) => ts.filter((t): t is string => Boolean(t)).sort().at(-1) ?? null;
const ms = (iso: string) => Date.parse(iso);

// 이 PR에서 base 뒤에 Codex가 낸 신호(한도 안내 포함: 말은 했다)가 있나
function spokeOn(p: LanePull, base: string): boolean {
  const c = p.codex;
  const stamps = [c?.lastComment?.at, c?.thumbsAt, ...(p.reviews ?? []).filter((r) => isCodexBot(r.author?.login)).map((r) => r.submittedAt)];
  const at = latestOf(stamps);
  return at !== null && at >= base;
}

export interface LaneStep {
  silentAt: string | null; // 이 단계 뒤의 상태(null이면 말하는 중)
  op: LaneOp | null; // 기록할 전이
}

// 한 저장소의 한 단계. prev: 기록에서 읽은 지금 상태. pulls: 그 저장소의 열린 PR(이미 읽은 Codex 신호가 든 것)
export function laneStepOf(repo: string, prev: string | null, pulls: readonly LanePull[], now: number, thresholdMs = LANE_SILENT_MS): LaneStep {
  const rc = repoCodexOf(pulls);
  const signalAt = latestOf([rc.signalAt, rc.limitAt]);
  if (prev) {
    if (signalAt && signalAt > prev) return { silentAt: null, op: { t: new Date(now).toISOString(), repo, op: "speaks" } };
    return { silentAt: prev, op: null };
  }
  const waiting: { number: number; base: string }[] = [];
  for (const p of pulls) {
    if (p.isDraft || !p.codex) continue; // Codex 신호를 아직 안 읽은 PR·Draft는 기다림의 근거가 아니다
    const base = latestOf([p.codex.headAt, p.createdAt]);
    if (!base || now - ms(base) < thresholdMs) continue;
    if (spokeOn(p, base)) continue;
    if (signalAt && signalAt >= base) continue; // 그 동안 다른 PR에는 말했다: 이 PR만 조용한 것이다(PR별 6시간 규칙이 맡는다)
    waiting.push({ number: p.number, base });
  }
  if (!waiting.length) return { silentAt: null, op: null };
  const since = new Date(Math.min(...waiting.map((w) => ms(w.base))) + thresholdMs).toISOString();
  return { silentAt: since, op: { t: new Date(now).toISOString(), repo, op: "silent", since, evidence: waiting.map((w) => w.number).sort((a, b) => a - b) } };
}

// buildPulls가 쓰는 표시: 이 저장소가 조용하면 그 PR의 CODEX UNAVAILABLE
export const laneUnavailable = (since: string): CodexUnavailable => ({ why: "lane", since, scope: "repo" });

// ── 한 레인으로 착륙한 PR(기록과 센 수) ──

export interface SingleLaneLine {
  t: string; // 기록 시각(CLEARED가 된 때)
  repo: string;
  number: number;
  head: string;
  cause: CodexUnavailable["why"]; // Codex를 쓸 수 없던 까닭
}

// CLEARED가 된 PR이 REVIEW 한 레인만으로 통과했나: Codex를 쓸 수 없었고(codexUnavailable) REVIEW의 pass가 이 head의 리뷰다
export function singleLaneCauseOf(p: { landing: string; codexUnavailable?: { why: CodexUnavailable["why"] } | null; extReview?: { status: string } | null }): CodexUnavailable["why"] | null {
  return p.landing === "CLEARED" && p.codexUnavailable && p.extReview?.status === "pass" ? p.codexUnavailable.why : null;
}

export interface LandedLine {
  t: string; // 착륙(머지) 시각
  number: number;
  head: string;
}
export interface LaneDay {
  day: string; // 착륙한 UTC 날짜
  landed: number;
  single: number; // 그 가운데 한 레인(REVIEW)만으로 착륙한 수
  causes: Record<string, number>;
}

const dayOf = (iso: string) => iso.slice(0, 10);
const keyOf = (number: number, head: string) => `${number}@${head.slice(0, 7)}`;

// 날짜별 수: 착륙한 PR(머지 성공 기록)을 센 다음, 같은 PR·head의 단일 레인 기록이 있으면 single로 센다. 오래된 날부터
export function laneDaysOf(landed: readonly LandedLine[], lines: readonly SingleLaneLine[], days: number, now: number): LaneDay[] {
  const single = new Map<string, SingleLaneLine>();
  for (const l of lines) single.set(keyOf(l.number, l.head), l);
  const out = new Map<string, LaneDay>();
  for (let i = days - 1; i >= 0; i--) {
    const day = dayOf(new Date(now - i * 86_400_000).toISOString());
    out.set(day, { day, landed: 0, single: 0, causes: {} });
  }
  const seen = new Set<string>();
  for (const l of landed) {
    const d = out.get(dayOf(l.t));
    const k = keyOf(l.number, l.head);
    if (!d || seen.has(k)) continue;
    seen.add(k);
    d.landed++;
    const s = single.get(k);
    if (s) {
      d.single++;
      d.causes[s.cause] = (d.causes[s.cause] ?? 0) + 1;
    }
  }
  return [...out.values()];
}

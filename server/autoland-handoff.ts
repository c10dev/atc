import type { AutolandView } from "./autoland.ts";
import type { AutolandHandoff } from "./land-by.ts";
import { pullKey } from "./landing.ts";
import type { PullRequest } from "./model.ts";

// AUTOLAND가 SUPERVISOR에게 넘긴 PR(ATC-513). 순수 계산만: 파일 입출력은 autoland-handoff-run.ts.
// AUTOLAND(merge 모드)가 CLEARED PR을 머지하지 않고 SUPERVISOR에게 남기는 판정(mergeExclusionOf의 사유)을 TOWER·HOME·알림이 같은 착륙 판정(land-by.ts)으로 읽는다.
// 판정이 없으면(AUTOLAND off·shadow, 리뷰 전, 옛 head의 판정, 스위치 off) 결과는 이 기능이 없을 때와 같다.

export type HandoffMode = "on" | "off";

// 이 PR이 AUTOLAND가 이 head에서 SUPERVISOR에게 넘긴 것이면 사유 글. 아니면 null
export function handoffOf(view: Pick<AutolandView, "mode" | "exclusions" | "exclusionHeads"> | null | undefined, on: boolean, p: Pick<PullRequest, "repo" | "number" | "head" | "landing" | "draft">): AutolandHandoff | null {
  if (!on || !view || view.mode !== "merge") return null;
  if (p.draft || p.landing !== "CLEARED") return null;
  const key = pullKey(p);
  const reason = view.exclusions[key];
  if (typeof reason !== "string" || !reason.trim()) return null; // null이면 위임된 PR(AUTOLAND가 머지한다)
  if (view.exclusionHeads?.[key] !== p.head) return null; // 판정이 어느 head의 것인지 모르거나 옛 head의 것이면 쓰지 않는다
  return { reason };
}

// 마이그레이션이 이유인가: Risk:Migration 라벨, 마이그레이션·SQL 경로(보안 게이트·migrationGate 사유 글)
export const needsMigrationFirst = (reason: string): boolean => /risk:\s*migration|migration|마이그레이션|\.sql\b|\bSQL\b/i.test(reason);

export const MIGRATION_FIRST = "호스티드에 마이그레이션을 먼저 적용한 뒤 머지";

// LANDING 줄이 읽는 한 문장: AUTOLAND의 사유 그대로, 마이그레이션이 이유면 순서를 덧붙인다
export const handoffNeedOf = (reason: string): string => `AUTOLAND가 넘김 — ${reason}${needsMigrationFirst(reason) ? ` · ${MIGRATION_FIRST}` : ""}`;

// ── 오작동 세기 ──
// 기록 한 줄(JSONL, autoland-handoff.jsonl과 FLIGHT RECORDER에 같은 모양으로)
//   mark      — (PR, head)를 처음 넘김으로 본 때. head마다 한 줄
//   done      — 열려 있던 넘김 PR이 열린 목록에서 사라져 상태를 읽은 때: merged 또는 closed(머지 없이 닫힘). PR마다 한 줄
//   land-sent — AUTOLAND가 넘긴 head의 PR에 팀으로 LAND CLEARANCE가 나갔다(0이어야 한다)
export interface HandoffRecord {
  t: string;
  op: "mark" | "done" | "land-sent";
  pr: string; // pullKey: <저장소>#<번호>
  number: number;
  head?: string;
  airport?: string;
  slug?: string; // <owner>/<repo>: 열린 목록에서 사라진 뒤 GitHub에서 상태를 읽는 데 쓴다
  reason?: string; // mark: AUTOLAND의 사유(앞 120자)
  result?: "merged" | "closed"; // done
  clearance?: string; // land-sent: LAND CLEARANCE id
}

export interface HandoffCounters {
  marked: number; // 넘김으로 본 (PR, head) 수
  closedWithoutMerge: number; // (a) SUPERVISOR 몫 LANDING 줄이 머지 없이 닫힘으로 끝난 PR 수
  landSent: number; // (b) 넘긴 PR에 팀으로 나간 LAND 수(0이어야 한다)
}

export function parseHandoffRecords(text: string): HandoffRecord[] {
  const out: HandoffRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as HandoffRecord;
      if (r && typeof r.t === "string" && typeof r.pr === "string" && (r.op === "mark" || r.op === "done" || r.op === "land-sent")) out.push(r);
    } catch {
      // 반쯤 쓰인 줄은 건너뛴다
    }
  }
  return out;
}

export function countHandoff(records: readonly HandoffRecord[], sinceMs = 0): HandoffCounters {
  const marks = new Set<string>();
  const closed = new Set<string>();
  let landSent = 0;
  for (const r of records) {
    if (Date.parse(r.t) < sinceMs) continue;
    if (r.op === "mark") marks.add(`${r.pr}@${r.head ?? ""}`);
    else if (r.op === "done" && r.result === "closed") closed.add(r.pr);
    else if (r.op === "land-sent") landSent += 1;
  }
  return { marked: marks.size, closedWithoutMerge: closed.size, landSent };
}

export interface HandoffView {
  total: HandoffCounters;
  last7d: HandoffCounters;
  recent: HandoffRecord[]; // 최근 몇 건(기록의 실제 모양을 보인다)
}
export function handoffView(records: readonly HandoffRecord[], nowMs: number): HandoffView {
  return { total: countHandoff(records), last7d: countHandoff(records, nowMs - 7 * 86_400_000), recent: records.slice(-5).reverse() };
}

const slugOf = (url: string | undefined): string | undefined => /github\.com\/([^/]+\/[^/]+)\/pull\/\d+/.exec(url ?? "")?.[1];

// 지금 스냅샷에서 새로 기록할 것을 정한다. known은 이미 기록에 있는 mark들(`<pr>@<head>`)과 끝난 PR(done)이다
export interface Observed {
  marks: HandoffRecord[]; // 새 (PR, head)
  gone: { pr: string; number: number; slug: string | null }[]; // 한 번이라도 넘겼고 지금 열린 목록에 없고 아직 done이 없는 PR: 상태를 읽어 done을 쓴다
}
export function observeHandoffs(
  s: { pulls: readonly Pick<PullRequest, "repo" | "number" | "head" | "landing" | "draft" | "url">[]; airports: readonly { code: string; repo: string }[]; autoland?: Pick<AutolandView, "mode" | "exclusions" | "exclusionHeads"> },
  on: boolean,
  records: readonly HandoffRecord[],
  nowIso: string,
): Observed {
  const marked = new Set(records.filter((r) => r.op === "mark").map((r) => `${r.pr}@${r.head ?? ""}`));
  const finished = new Set(records.filter((r) => r.op === "done").map((r) => r.pr));
  const marks: HandoffRecord[] = [];
  for (const p of s.pulls) {
    const h = handoffOf(s.autoland, on, p);
    const key = pullKey(p);
    if (!h || marked.has(`${key}@${p.head}`) || marks.some((m) => m.pr === key && m.head === p.head)) continue;
    marks.push({ t: nowIso, op: "mark", pr: key, number: p.number, head: p.head, airport: s.airports.find((a) => a.repo === p.repo)?.code, slug: slugOf(p.url), reason: h.reason.slice(0, 120) });
  }
  const open = new Set(s.pulls.map((p) => pullKey(p)));
  const gone: Observed["gone"] = [];
  for (const key of new Set(records.filter((r) => r.op === "mark").map((r) => r.pr))) {
    if (open.has(key) || finished.has(key)) continue;
    const m = records.find((r) => r.op === "mark" && r.pr === key)!;
    gone.push({ pr: key, number: m.number, slug: m.slug ?? null });
  }
  return { marks, gone };
}

// LAND CLEARANCE가 나가는 PR(같은 STAND, 없으면 같은 FLIGHT)이 지금 AUTOLAND가 넘긴 head인가(b). 맞으면 그 PR
export function landSentTo(
  clearance: { stand?: string | null; flight?: string | null },
  s: { pulls: readonly Pick<PullRequest, "repo" | "number" | "head" | "landing" | "draft" | "standPath" | "ticketKey">[]; autoland?: Pick<AutolandView, "mode" | "exclusions" | "exclusionHeads"> },
  on: boolean,
): { pr: string; number: number; head: string } | null {
  for (const p of s.pulls) {
    const mine = (p.standPath && clearance.stand === p.standPath) || (!clearance.stand && p.ticketKey && clearance.flight === p.ticketKey);
    if (!mine || !handoffOf(s.autoland, on, p)) continue;
    return { pr: pullKey(p), number: p.number, head: p.head };
  }
  return null;
}

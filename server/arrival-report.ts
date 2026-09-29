import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";

// 도착 보고(ARRIVED report, ATC-124): CAPTAIN의 최종 보고는 고정 첫 줄과 고정 줄(PR·TIER·TESTS·DISCRETION·BLOCKED)로 시작한다.
// 받은 세션(OCC, 또는 ENGINEERING)이 `atcctl dispatch report`로 한 번에 기록한다. atc는 팀 메시지를 읽지 않는다.
// 고정 칸만 저장한다 — 자유 요약은 저장하지 않는다. 추가만 하는 JSONL(arrival-reports.jsonl), FLIGHT마다 마지막 보고가 유효.
// 설계: docs/dispatch.md "Arrival reports as built (ATC-124)"

export const REPORT_TIERS = ["auto", "flagged", "user"] as const;
export type ReportTier = (typeof REPORT_TIERS)[number];
export const BLOCKED_MAX = 300;
export const RESULT_MAX = 300;

export interface ArrivalReport {
  op: "report";
  flight: string; // FLIGHT key (ATC-124)
  at: string; // 기록한 시각
  proposal: string | null; // FLIGHT PLAN으로 받았으면 D-xxxx, 직접 배정이면 null
  pr: number | null; // PR 번호. PR이 없는 SURVEY·CHECK FLIGHT는 null
  result: string | null; // PR 대신 결과 링크(SURVEY·CHECK)
  tier: ReportTier;
  tests: { pass: number; total: number } | null; // PR이 없으면 null일 수 있다
  discretion: number; // PILOT'S DISCRETION으로 고른 것의 수
  blocked: string; // "none" 또는 막힌 점 한 줄씩
}

export class ReportError extends Error {}

const FLIGHT_RE = /^[A-Z][A-Z0-9]*-\d+$/;

// POST 본문(ref는 FLIGHT key로 풀린 뒤) → 기록할 보고. 순수. 잘못이면 ReportError
export function parseReport(body: unknown, flight: string, proposal: string | null, at: string): ArrivalReport {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (!FLIGHT_RE.test(flight)) throw new ReportError(`FLIGHT key가 아님: ${flight}`);
  const pr = b.pr === undefined || b.pr === null || b.pr === "" ? null : Number(b.pr);
  if (pr !== null && (!Number.isInteger(pr) || pr < 1)) throw new ReportError("pr은 1 이상의 정수");
  const result = typeof b.result === "string" && b.result.trim() ? b.result.trim() : null;
  if (pr === null && !result) throw new ReportError("PR 번호(pr)나 결과 링크(result)가 필요함");
  if (pr !== null && result) throw new ReportError("pr과 result는 함께 쓰지 않는다(PR이 없는 FLIGHT만 result)");
  if (result && result.length > RESULT_MAX) throw new ReportError(`result는 ${RESULT_MAX}자 이내`);
  if (typeof b.tier !== "string" || !(REPORT_TIERS as readonly string[]).includes(b.tier)) throw new ReportError(`tier는 ${REPORT_TIERS.join("|")} 중 하나`);
  let tests: ArrivalReport["tests"] = null;
  if (b.tests !== undefined && b.tests !== null && b.tests !== "") {
    const t = b.tests as { pass?: unknown; total?: unknown } | string;
    const m = typeof t === "string" ? /^(\d+)\/(\d+)$/.exec(t.trim()) : null;
    const pass = m ? Number(m[1]) : Number((t as { pass?: unknown }).pass);
    const total = m ? Number(m[2]) : Number((t as { total?: unknown }).total);
    if (!Number.isInteger(pass) || !Number.isInteger(total) || pass < 0 || total < 0 || pass > total) throw new ReportError("tests는 <통과>/<전체> (예: 1122/1122)");
    tests = { pass, total };
  }
  if (pr !== null && !tests) throw new ReportError("PR 보고에는 tests(<통과>/<전체>)가 필요함");
  const discretion = Number(b.discretion);
  if (!Number.isInteger(discretion) || discretion < 0 || discretion > 99) throw new ReportError("discretion은 0–99의 정수(PILOT'S DISCRETION으로 고른 수)");
  const blockedRaw = typeof b.blocked === "string" ? b.blocked.replace(/\s+/g, " ").trim() : "";
  if (!blockedRaw) throw new ReportError('blocked가 필요함 ("none" 또는 막힌 점)');
  if (blockedRaw.length > BLOCKED_MAX) throw new ReportError(`blocked는 ${BLOCKED_MAX}자 이내`);
  const blocked = blockedRaw.toLowerCase() === "none" ? "none" : blockedRaw;
  return { op: "report", flight, at, proposal, pr, result, tier: b.tier as ReportTier, tests, discretion, blocked };
}

// FLIGHT마다 마지막 보고(순수). 다시 기록하면 대신한다
export function foldReports(ops: ArrivalReport[]): Map<string, ArrivalReport> {
  const out = new Map<string, ArrivalReport>();
  for (const o of [...ops].sort((a, b) => a.at.localeCompare(b.at))) if (o.op === "report") out.set(o.flight, o);
  return out;
}

const FILE = () => join(config.stateDir, "arrival-reports.jsonl");

export function readReports(file = FILE()): ArrivalReport[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: ArrivalReport[] = [];
  for (const line of text.split("\n")) {
    try {
      const o = JSON.parse(line);
      if (o?.op === "report" && typeof o.flight === "string" && typeof o.at === "string") out.push(o as ArrivalReport);
    } catch {}
  }
  return out;
}

export function appendReport(r: ArrivalReport, file = FILE()) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(r) + "\n");
}

// 사람이 읽는 한 줄(atcctl 출력용)
export function reportLine(r: ArrivalReport): string {
  const where = r.pr !== null ? `PR #${r.pr}` : `RESULT ${r.result}`;
  const tests = r.tests ? ` · TESTS ${r.tests.pass}/${r.tests.total}` : "";
  return `${r.flight} ARRIVED 보고 기록 · ${where} · TIER ${r.tier}${tests} · DISCRETION ${r.discretion} · BLOCKED ${r.blocked}`;
}

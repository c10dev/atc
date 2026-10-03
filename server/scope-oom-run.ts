import { readRecords, type RecordLine } from "./recorder.ts";
import { oomDeltasOf, readScopeOom, type ScopeOomView } from "./scope-memory.ts";

// SCOPE OOM 세기의 읽기(ATC-505, 계산은 scope-memory.ts). 쓰는 것은 jobs/scope-oom.ts가 recorder에 남기는 줄뿐이다.
const WEEK = 7 * 86_400_000;
type OomLine = Extract<RecordLine, { op: "scope-oom" }>;

const oomLines = (now: number): OomLine[] => readRecords(now - WEEK).filter((r): r is OomLine => r.kind === "policy" && r.op === "scope-oom");

// 지금 늘어난 oom_kill를 recorder 줄로. 이미 기록한 합계(unit별 가장 큰 total)부터 센다
export function scopeOomRecordsNow(now = Date.now()): OomLine[] {
  const known = new Map<string, number>();
  for (const r of oomLines(now)) known.set(r.unit, Math.max(known.get(r.unit) ?? 0, r.total));
  const t = new Date(now).toISOString();
  return oomDeltasOf(readScopeOom(), known).map((d) => ({ t, kind: "policy", op: "scope-oom", unit: d.unit, total: d.total, delta: d.delta }));
}

// SUPERVISOR가 보는 수: 지난 7일에 기록된 OOM kill 합과, 지금 떠 있는 scope 수(GET /api/control/sessions의 scopeOom)
export function scopeOomViewNow(now = Date.now()): ScopeOomView {
  return { kills7d: oomLines(now).reduce((n, r) => n + r.delta, 0), scopes: readScopeOom().length };
}

import { readRecords, type RecordLine } from "./recorder.ts";
import { type OomState, oomKills7d, oomStateOf, oomStep, readScopeOom, type ScopeOomView } from "./scope-memory.ts";

// SCOPE OOM 세기의 읽기(ATC-505, 계산은 scope-memory.ts). 쓰는 것은 jobs/scope-oom.ts가 recorder에 남기는 줄뿐이다.
// 합계는 보관된 기록 전체로 한 번 채우고(7일 창으로 채우면 오래 사는 scope의 옛 kill을 다시 센다) 이후 메모리에서 이어 간다. 1분마다 기록 파일을 다시 읽지 않는다
type OomLine = Extract<RecordLine, { op: "scope-oom" }>;

let state: OomState | null = null;
const stateNow = (): OomState => (state ??= oomStateOf(readRecords(0).filter((r): r is OomLine => r.kind === "policy" && r.op === "scope-oom")));
// 시험이 비운다
export const resetScopeOomState = () => {
  state = null;
};

// 지금 늘어난 oom_kill를 recorder 줄로
export function scopeOomRecordsNow(now = Date.now()): OomLine[] {
  return oomStep(stateNow(), readScopeOom(), now).map((l) => ({ ...l, kind: "policy", op: "scope-oom" }));
}

// SUPERVISOR가 보는 수: 지난 7일에 기록된 OOM kill 합과, 지금 떠 있는 scope 수(GET /api/control/sessions의 scopeOom)
export function scopeOomViewNow(now = Date.now()): ScopeOomView {
  return { kills7d: oomKills7d(stateNow(), now), scopes: readScopeOom().length };
}

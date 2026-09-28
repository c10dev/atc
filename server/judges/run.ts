import { config } from "../config.ts";
import type { Snapshot } from "../model.ts";
import { type ClassifyPayload, humanOf, loadScheduleOps, type ScheduleOp } from "../schedule.ts";
import { fetchIssueDetail } from "../sources/linear.ts";
import { bodyWithheld, classifyInputOf, JUDGE_FAMILIES, type JudgeFamily, judgmentOf, verdictOf } from "./classify.ts";
import { type JudgeEngine, jevEngine, stubEngine } from "./engines.ts";
import { appendJudgeLines, type JudgeLine, type JudgeMarks, type JudgeMode, type JudgeRun, loadJudges, marksOf, readJudgeLines } from "./store.ts";

// 판정 계열 실행(ATC-36). 스냅숏마다 부르지만 CYCLE_MS에 한 번, 한 번에 PER_CYCLE건까지만 부른다(비용·속도 한도).
// replay: SUPERVISOR가 판정한 지난 CLASSIFY 초안 가운데 이 계열 mark가 없는 것(오래된 것부터).
// shadow: 열린 CLASSIFY 초안 가운데 mark가 없는 것. mark는 SUPERVISOR 판정 뒤에만 화면에 보인다.
// off면 아무것도 읽거나 보내지 않는다.

const CYCLE_MS = 60_000;
const PER_CYCLE = 3;
const RETRY_MS = 60 * 60_000; // 실패한 초안은 한 시간 뒤 다시
const SKIP_MS = 24 * 60 * 60_000; // 판정할 수 없던 초안(제목을 모름, 비교할 축 없음)은 하루 뒤 다시

// 이번 주기에 판정할 초안(순수 함수)
export function targetsOf(ops: ScheduleOp[], marks: JudgeMarks, family: JudgeFamily, mode: JudgeMode, skip: Set<string> = new Set(), max = PER_CYCLE): ScheduleOp[] {
  if (mode === "off") return [];
  const fresh = ops.filter((o) => o.kind === "CLASSIFY" && o.flight && !marks.get(o.id)?.[family] && !skip.has(o.id));
  const picked = mode === "replay" ? fresh.filter((o) => humanOf(o)).sort((a, b) => a.at.localeCompare(b.at)) : fresh.filter((o) => o.status === "draft").sort((a, b) => a.at.localeCompare(b.at));
  return picked.slice(0, max);
}

// 초안 하나를 판정해 기록 줄을 만든다. description은 본문을 보낼 때만 읽는다(withheld면 부르지 않는다)
export async function judgeOp(
  op: ScheduleOp,
  ticket: { title: string; labels: string[] } | null,
  readDescription: (key: string) => Promise<{ title: string; description: string | null }>,
  engine: JudgeEngine,
  family: JudgeFamily,
  run: JudgeRun,
  at: string,
): Promise<JudgeLine | null> {
  const payload = op.payload as ClassifyPayload;
  const withheld = bodyWithheld(ticket?.labels ?? null, payload);
  const detail = withheld ? null : await readDescription(op.flight!);
  const title = detail?.title ?? ticket?.title;
  if (!title) return null; // 제목도 모르면 판정하지 않는다
  const input = classifyInputOf({ title, description: detail?.description ?? null }, Boolean(withheld));
  const result = await engine.judge(input);
  const judgment = judgmentOf(result.answers);
  const v = verdictOf(payload, ticket?.labels ?? null, judgment);
  if (!v) return null;
  return {
    op: "judge",
    family,
    target: "schedule",
    id: op.id,
    flight: op.flight,
    at,
    run,
    engine: engine.name,
    model: result.model,
    verdict: v.verdict,
    reason: v.reason,
    judgment,
    withheld,
    sent: ["title", ...Object.keys(input.sections)],
  };
}

// ---- 입출력 ----
export interface JudgeStatus {
  lastRunAt: string | null;
  lastError: string | null; // 키는 들어가지 않는다(engines.ts)
  judged: number; // 이 서버가 켜진 뒤 남긴 mark 수
}
export const judgeStatus: Record<JudgeFamily, JudgeStatus> = Object.fromEntries(JUDGE_FAMILIES.map((f) => [f, { lastRunAt: null, lastError: null, judged: 0 }])) as Record<JudgeFamily, JudgeStatus>;

// 엔진: ATC_JUDGE_ENGINE=stub이면 녹화 응답(네트워크 없음). 아니면 jev(TYPESAFE_API_KEY)
export const engineName = () => (config.judgeEngine === "stub" ? "stub" : "jev");
const engineOf = (): JudgeEngine => (engineName() === "stub" ? stubEngine() : jevEngine(config.typesafeApiKey));

const failedUntil = new Map<string, number>();
const pausedUntil = new Map<JudgeFamily, number>(); // 401·429: 키·한도 문제면 계열 전체를 한 시간 쉰다
let running = false;
let lastCycle = 0;

async function readDescription(key: string) {
  const d = (await fetchIssueDetail(key)) as { title?: unknown; description?: unknown };
  return { title: typeof d.title === "string" ? d.title : "", description: typeof d.description === "string" ? d.description : null };
}

export function runJudges(s: Snapshot, now = Date.now()) {
  if (running || now - lastCycle < CYCLE_MS) return;
  const modes = loadJudges();
  if (JUDGE_FAMILIES.every((f) => modes[f] === "off")) return;
  if (!s.linear.enabled || !s.linear.fetchedAt) return; // 라벨을 모르면 본문 반출 규칙을 지킬 수 없다
  lastCycle = now;
  running = true;
  cycle(s, modes)
    .catch((e) => console.error("[atc] judges failed:", (e as Error).message))
    .finally(() => (running = false));
}

async function cycle(s: Snapshot, modes: ReturnType<typeof loadJudges>) {
  const ops = loadScheduleOps();
  const marks = marksOf(readJudgeLines());
  const byKey = new Map(s.tickets.map((t) => [t.key, t]));
  const nowMs = Date.now();
  const skip = new Set([...failedUntil].filter(([, until]) => until > nowMs).map(([id]) => id));
  for (const family of JUDGE_FAMILIES) {
    const mode = modes[family];
    if (mode === "off") continue;
    const engine = engineOf();
    const st = judgeStatus[family];
    if ((pausedUntil.get(family) ?? 0) > nowMs) continue;
    if (engine.name === "jev" && !config.typesafeApiKey) {
      st.lastError = "TYPESAFE_API_KEY 없음 — 아무것도 보내지 않음";
      continue;
    }
    st.lastRunAt = new Date().toISOString();
    for (const op of targetsOf(ops, marks, family, mode, skip)) {
      if (loadJudges()[family] !== mode) break; // 도는 동안 SUPERVISOR가 스위치를 바꿨으면 멈춘다
      const t = byKey.get(op.flight!);
      try {
        const line = await judgeOp(op, t ? { title: t.title, labels: t.labels } : null, readDescription, engine, family, mode as JudgeRun, new Date().toISOString());
        if (line) {
          appendJudgeLines([line]);
          st.judged++;
        } else failedUntil.set(op.id, Date.now() + SKIP_MS); // 같은 초안이 주기마다 자리를 막지 않게
        st.lastError = null;
      } catch (e) {
        failedUntil.set(op.id, Date.now() + RETRY_MS);
        st.lastError = `${op.id}: ${(e as Error).message}`.slice(0, 300);
        const status = (e as { status?: number }).status;
        if (status === 401 || status === 429) {
          pausedUntil.set(family, Date.now() + RETRY_MS);
          break;
        }
      }
    }
  }
}

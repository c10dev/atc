import { contentHashOf } from "../input-binding.ts";
import { releaseOfFlightNow } from "../input-binding-run.ts";
import type { Hono } from "hono";
import { config } from "../config.ts";
import { loadDispatchConfig } from "../dispatch.ts";
import { type LogEntry, loadLogbook } from "../logbook.ts";
import type { Session, Snapshot } from "../model.ts";
import { allProposals, humanOf as proposalHumanOf, type Proposal, regOfProposal } from "../proposals.ts";
import { type ClassifyPayload, humanOf, loadScheduleOps, type ScheduleOp } from "../schedule.ts";
import { fromThisApp } from "../origin.ts";
import { fetchIssueDetail } from "../sources/linear.ts";
import { bodyWithheld, classifyInputOf, JUDGE_FAMILIES, type JudgeFamily, judgmentOf, verdictOf } from "./classify.ts";
import { lastMessageOfSession } from "../sources/claude.ts";
import { maskText, reportCandidatesOf, reportJudgmentOf, reportQuestions, registrationOf, ruleJudgmentOf } from "./report.ts";
import { dispatchJudgmentOf, dispatchQuestions, dispatchStateOf, dispatchWithheld, recentEntriesOf, sentOf } from "./dispatch.ts";
import { type JudgeEngine, jevEngine, stubEngine } from "./engines.ts";
import { appendJudgeLines, type DispatchJudgeLine, type DispatchMarks, dispatchMarksOf, type JudgeLine, type JudgeMarks, type JudgeMode, type JudgeRun, loadJudges, marksOf, markReport, readJudgeLines, type ReportJudgeLine, reportRate, reportViewsOf } from "./store.ts";

// 판정 계열 실행(ATC-36, DISPATCH는 ATC-88). 스냅숏마다 부르지만 CYCLE_MS에 한 번, 한 번에 PER_CYCLE건까지만 부른다(비용·속도 한도).
// 한도는 CLASSIFY 초안과 DISPATCH ASSIGN이 나눠 쓴다(번갈아 뽑는다: takeTurns). REPORT(ATC-89)도 같은 한도를 쓴다.
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

// DISPATCH 대상(순수 함수). replay: SUPERVISOR가 판정한 ASSIGN 가운데 mark가 없는 것(오래된 것부터), shadow: 열린(proposed, HOLD 포함) ASSIGN 가운데 mark가 없는 것.
// HOLD 중인 제안도 센다: Prerequisite가 OCC HOLD와 맞았는지 재려면 그 제안의 mark가 있어야 한다
export function dispatchTargetsOf(proposals: Proposal[], marks: DispatchMarks, family: JudgeFamily, mode: JudgeMode, skip: Set<string> = new Set(), max = PER_CYCLE): Proposal[] {
  if (mode === "off") return [];
  const fresh = proposals.filter((p) => p.kind === "ASSIGN" && !marks.get(p.id)?.[family] && !skip.has(p.id));
  const picked = mode === "replay" ? fresh.filter((p) => proposalHumanOf(p)) : fresh.filter((p) => p.status === "proposed");
  return picked.sort((a, b) => a.at.localeCompare(b.at)).slice(0, max);
}

// ASSIGN 하나를 판정해 기록 줄을 만든다. 본문은 ATC-36과 같은 규칙(withheld면 읽지 않는다).
// Same area는 AIRCRAFT의 마지막 3 LOGBOOK FLIGHT가 모두 atc FLIGHT이고 제목을 모두 알 때만 묻는다
export async function judgeDispatchOp(
  p: Pick<Proposal, "id" | "flight">,
  ticket: { title: string; labels: string[] } | null,
  readDescription: (key: string) => Promise<{ title: string; description: string | null }>,
  recent: { keys: string[]; why: string | null },
  titleOf: (key: string) => Promise<string | null>,
  engine: JudgeEngine,
  family: JudgeFamily,
  run: JudgeRun,
  at: string,
): Promise<DispatchJudgeLine | null> {
  const withheld = dispatchWithheld(ticket?.labels ?? null);
  const detail = withheld ? null : await readDescription(p.flight);
  const title = detail?.title || ticket?.title;
  if (!title) return null;
  let recentWithheld = recent.why;
  let titles: string[] | null = null;
  if (!recentWithheld) {
    const got = await Promise.all(recent.keys.map(titleOf));
    if (got.every((t): t is string => Boolean(t))) titles = got;
    else recentWithheld = "지난 FLIGHT의 제목을 모름";
  }
  const state = dispatchStateOf({ title, description: detail?.description ?? null }, Boolean(withheld), titles);
  const result = await engine.ask({ target: "dispatch", title, state: state as unknown as Record<string, unknown>, questions: dispatchQuestions(Boolean(titles)) });
  return {
    op: "judge",
    family,
    target: "dispatch",
    id: p.id,
    flight: p.flight,
    at,
    run,
    engine: engine.name,
    model: result.model,
    judgment: dispatchJudgmentOf(result.answers, Boolean(titles)),
    withheld,
    recentWithheld,
    sent: sentOf(state),
    hash: contentHashOf({ title, state }), // 판정한 입력(ATC-555, WO-23): 엔진에 보낸 제목과 상태
  };
}

// 여러 목록에서 번갈아 max건까지(한쪽이 밀려 굶지 않게)
export function takeTurns<T>(lists: T[][], max = PER_CYCLE): T[] {
  const out: T[] = [];
  for (let i = 0; out.length < max && lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length && out.length < max) out.push(l[i]);
  return out;
}

// REPORT 대상(순수 함수, ATC-89). 후보는 이미 ATCC AIRCRAFT의 idle 세션(reportCandidatesOf)이고, 여기서는 이번 턴을 아직 보지 않은 것만 고른다.
// seen: 세션 → 마지막으로 처리한 lastActiveAt. shadow는 서버가 켜진 뒤 끝난 턴만: 처음 본 세션은 기준선으로만 적는다(baseline). replay는 처음 본 세션의 마지막 턴도 판정한다
export function reportTargetsOf(
  cands: Pick<Session, "id" | "lastActiveAt">[],
  seen: ReadonlyMap<string, string>,
  mode: JudgeMode,
  skip: Set<string> = new Set(),
  max = PER_CYCLE,
): { targets: string[]; baseline: string[] } {
  if (mode === "off") return { targets: [], baseline: [] };
  const targets: string[] = [];
  const baseline: string[] = [];
  for (const c of cands) {
    const key = c.lastActiveAt ?? "";
    if (seen.get(c.id) === key || skip.has(c.id)) continue;
    if (!seen.has(c.id) && mode === "shadow") baseline.push(c.id);
    else if (targets.length < max) targets.push(c.id);
  }
  return { targets, baseline };
}

// 세션 하나의 마지막 메시지를 판정해 기록 줄을 만든다. 메시지는 마스킹해 보내고 기록하지 않는다(보낸 글자 수만).
// readLast는 ATCC 확인을 끝낸 세션에만 부른다(reportCandidatesOf)
export async function judgeReportOp(
  s: Pick<Session, "id" | "name" | "cwd" | "account">,
  teamPattern: string,
  readLast: (cwd: string, id: string, account?: string) => { text: string; at: number; cut?: true } | null,
  judgedIds: ReadonlySet<string>,
  engine: JudgeEngine,
  family: JudgeFamily,
  run: JudgeRun,
  at: string,
): Promise<ReportJudgeLine | null> {
  const msg = readLast(s.cwd, s.id, s.account);
  if (!msg) return null;
  const id = `R-${s.id.slice(0, 8)}-${Math.floor(msg.at / 1000)}`;
  if (judgedIds.has(id)) return null;
  const masked = maskText(msg.text);
  if (!masked) return null;
  const aircraft = registrationOf(s.name, teamPattern);
  // 규칙 먼저(ATC-141): 한도로 잘린 턴은 Jev를 부르지 않는다. 보내는 것이 없어 sent.chars는 0
  const rule = ruleJudgmentOf(msg.cut);
  const hash = contentHashOf(masked); // 판정한 입력(ATC-555, WO-23): 마스킹한 메시지의 해시만 남긴다(본문은 남기지 않는다)
  if (rule) return { op: "judge", family, target: "report", id, session: s.id, aircraft, at, turnAt: new Date(msg.at).toISOString(), run, engine: "rule", model: "rule", judgment: rule.judgment, reason: rule.reason, sent: { chars: 0 }, hash };
  const result = await engine.ask({ target: "report", title: aircraft, state: { message: masked }, questions: reportQuestions() });
  return {
    op: "judge",
    family,
    target: "report",
    id,
    session: s.id,
    aircraft,
    at,
    turnAt: new Date(msg.at).toISOString(),
    run,
    engine: engine.name,
    model: result.model,
    judgment: reportJudgmentOf(result.answers),
    sent: { chars: masked.length },
    hash,
  };
}

// 초안 하나를 판정해 description은 본문을 보낼 때만 읽는다(withheld면 부르지 않는다)
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
    hash: contentHashOf(input), // 판정한 입력(ATC-555, WO-23): 엔진에 보낸 제목과 절
  };
}

const recentEntriesOfProposal = (logbook: readonly LogEntry[], p: Proposal, teamPattern?: string) => recentEntriesOf(logbook, regOfProposal(p, teamPattern));

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
const reportSeen = new Map<string, string>(); // 세션 → 판정한 턴의 lastActiveAt(ATC-89). 서버를 다시 켜면 기준선부터

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
  const lines = readJudgeLines();
  const marks = marksOf(lines);
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
    const proposals = allProposals();
    const dmarks = dispatchMarksOf(lines);
    const logbook = loadLogbook();
    const teamPattern = loadDispatchConfig().teamPattern;
    const titles = new Map<string, string | null>();
    const titleOf = async (key: string) => {
      const known = byKey.get(key)?.title;
      if (known) return known;
      if (!titles.has(key)) titles.set(key, (await readDescription(key).catch(() => ({ title: "" }))).title || null);
      return titles.get(key)!;
    };
    const jids = reportViewsOf(lines).ids;
    const cands = reportCandidatesOf(s.sessions, s.airports, teamPattern); // ATCC 확인은 어떤 읽기보다 먼저
    const rep = reportTargetsOf(cands, reportSeen, mode, skip, PER_CYCLE);
    for (const id of rep.baseline) reportSeen.set(id, cands.find((c) => c.id === id)!.lastActiveAt ?? "");
    type Item = { k: "schedule"; op: ScheduleOp } | { k: "dispatch"; p: Proposal } | { k: "report"; s: (typeof cands)[number] };
    const picked = takeTurns<Item>(
      [
        targetsOf(ops, marks, family, mode, skip, PER_CYCLE).map((op) => ({ k: "schedule" as const, op })),
        dispatchTargetsOf(proposals, dmarks, family, mode, skip, PER_CYCLE).map((p) => ({ k: "dispatch" as const, p })),
        rep.targets.map((id) => ({ k: "report" as const, s: cands.find((c) => c.id === id)! })),
      ],
      PER_CYCLE,
    );
    for (const item of picked) {
      if (loadJudges()[family] !== mode) break; // 도는 동안 SUPERVISOR가 스위치를 바꿨으면 멈춘다
      const id = item.k === "schedule" ? item.op.id : item.k === "dispatch" ? item.p.id : item.s.id;
      const flight = item.k === "schedule" ? item.op.flight! : item.k === "dispatch" ? item.p.flight : "";
      const t = byKey.get(flight);
      const ticket = t ? { title: t.title, labels: t.labels } : null;
      try {
        const at = new Date().toISOString();
        const line =
          item.k === "schedule"
            ? await judgeOp(item.op, ticket, readDescription, engine, family, mode as JudgeRun, at)
            : item.k === "dispatch"
              ? await judgeDispatchOp(item.p, ticket, readDescription, recentEntriesOfProposal(logbook, item.p, teamPattern), titleOf, engine, family, mode as JudgeRun, at)
              : await judgeReportOp(item.s, teamPattern, lastMessageOfSession, jids, engine, family, mode as JudgeRun, at);
        if (item.k === "report") reportSeen.set(id, item.s.lastActiveAt ?? ""); // 메시지가 없어도 이 턴은 다시 읽지 않는다
        if (line) {
          const release = "flight" in line ? releaseOfFlightNow(line.flight) : null; // 그 FLIGHT의 발권 id(ATC-555, WO-23). 없으면 칸을 넣지 않는다
          appendJudgeLines([release ? { ...line, release } : line]);
          st.judged++;
        } else if (item.k !== "report") failedUntil.set(id, Date.now() + SKIP_MS); // 같은 대상이 주기마다 자리를 막지 않게
        st.lastError = null;
      } catch (e) {
        failedUntil.set(id, Date.now() + RETRY_MS);
        st.lastError = `${id}: ${(e as Error).message}`.slice(0, 300);
        const status = (e as { status?: number }).status;
        if (status === 401 || status === 429) {
          pausedUntil.set(family, Date.now() + RETRY_MS);
          break;
        }
      }
    }
  }
}

// SUPERVISOR가 REPORT 분류를 맞다·틀리다고 표시한다(ATC-89). 이 화면 Origin만 받는다 — 관제 세션은 표시할 수 없다
export function mountJudges(app: Hono) {
  app.post("/api/judges/report/:id/mark", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서만 표시할 수 있다" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as { verdict?: unknown };
    if (body.verdict !== "right" && body.verdict !== "wrong") return c.json({ error: "verdict는 right|wrong" }, 400);
    if (!markReport(c.req.param("id"), body.verdict)) return c.json({ error: "그런 판정이 없다" }, 404);
    return c.json({ ok: true, rate: reportRate() });
  });
}

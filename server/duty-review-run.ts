// DUTY REVIEW 런타임(ATC-396, docs/duty.md): 주기마다 신호를 읽고, 트리거가 서면 DUTY 턴을 서버가 시작한다.
// 외부에 나가는 동작: DUTY 세션(`claude -p`)에 글을 쓴다(duty-run.ts). 스위치(duty.json review)는 SUPERVISOR만 설정 창에서 바꾼다. 기본 켜짐, DUTY가 꺼져 있으면 돌지 않는다.
// 기록은 duty-reviews.jsonl(추가만): 점검 한 줄, 제안 한 줄. 세기는 GET /api/duty/review.
import type { Hono } from "hono";
import { loadDutyConfig } from "./duty-config.ts";
import { appendReviewLine, readReviewLines } from "./duty-review-store.ts";
import { type DutyRuntime, duty } from "./duty-run.ts";
import { openEffectLines } from "./effect-check-run.ts";
import { decideReview, emptyMisfiresOf, FACTS_KEEP_MAX, HEARTBEAT_HOUR_UTC, lastRunOf, namedReadyOf, nextReviewId, openSimilarKey, pendingSkipOf, REVIEW_DAILY_MAX, reviewDaysOf, reviewFactsOf, reviewLeaksOf, reviewMemosOf, reviewPromptOf, type ReviewLine, type ReviewTrigger, signalsOf, skipCountsOf, skipVerdictOf } from "./duty-review.ts";
import { type OpenLeak, openFromRecords } from "./leaks.ts";
import { readLeaks } from "./leaks-run.ts";
import type { Snapshot } from "./model.ts";
import type { ReleaseLine } from "./release.ts";
import { readReleaseLines } from "./release-store.ts";
import { currentAlerts } from "./supervisor-alerts-run.ts";
import { timed } from "./job-timing.ts";
import { releaseReadyNow } from "./release-run.ts";
import { GithubOffError } from "./github-switch.ts";
import { IDEA_LABEL, IDEAS_REPO, shapeIdeaList } from "./ideas.ts";
import { fetchIdeaList } from "./sources/github.ts";

export const TICK_MS = 60_000;
const WARMUP_MS = 3 * 60_000; // 서버가 뜬 직후(RTS 재시작)에는 스냅샷이 비어 있다: 이만큼 기다린다

export type Fetcher = (path: string) => Promise<unknown>;
export interface ReviewDeps {
  snapshot: () => Promise<Snapshot>;
  get: Fetcher; // 서버 안에서 같은 핸들러를 부른다
  rt: () => DutyRuntime;
  lines: () => ReviewLine[];
  append: (l: ReviewLine) => void;
  releases: () => ReleaseLine[];
  openLeaks: (now: number) => { title: string; sinceMs: number; id?: string }[];
  alerts: () => { level: string; text: string; key?: string }[]; // key: 사실 지문(ATC-566)이 쓴다(글에는 분이 들어 있다)
  effects?: () => string[]; // 열린 EFFECT CHECK 평결(not improved·worse, ATC-402). 없으면 빈 목록
  ready?: (snap: Snapshot) => { key: string; title: string; priority: number | null }[]; // empty 점검 지시문에 줄 READY Backlog. 없으면 releaseReadyNow
  ideas?: () => Promise<{ number: number; title: string }[] | null>; // empty 점검 지시문에 줄 열린 idea. null이면 읽지 못함. 없으면 gh
  cfg?: () => ReturnType<typeof loadDutyConfig>; // 시험용
  now: () => number;
  startedAt: number;
}

const openLeaksNow = (now: number): { title: string; sinceMs: number; id: string }[] => reviewLeaksOf([...openFromRecords(readLeaks(), now).values()].map((o: OpenLeak) => o.rec));

const ideasNow = async (): Promise<{ number: number; title: string }[] | null> => {
  try {
    return shapeIdeaList(await fetchIdeaList(IDEAS_REPO, IDEA_LABEL)).map((i) => ({ number: i.number, title: i.title }));
  } catch (e) {
    if (!(e instanceof GithubOffError)) console.warn(`[atc] duty review: ideas ${e instanceof Error ? e.message : e}`);
    return null;
  }
};

// 도는 empty 점검의 결과를 모은다(턴이 끝나면 outcome 줄 하나: DUTY의 답이 READY를 몇 개 이름 붙였나, ATC-470)
let emptyTurn: { id: string; ready: { key: string }[]; text: string } | null = null;
export function watchEmptyTurn(rt: DutyRuntime, append: (l: ReviewLine) => void, now: () => number): () => void {
  return rt.subscribe((e) => {
    if (!emptyTurn) return;
    if (e.type === "text" && e.final) emptyTurn.text += `\n${e.text}`;
    // 줄 선 SUPERVISOR 글이 이어 쓰이면(user) 점검 턴은 거기서 끝난다: 그 뒤의 답은 점검의 답이 아니다
    else if (e.type === "user" || (e.type === "state" && e.state !== "thinking")) {
      const t = emptyTurn;
      emptyTurn = null;
      append({ v: 1, ev: "outcome", at: new Date(now()).toISOString(), review: t.id, named: namedReadyOf(t.text, t.ready) });
    }
  });
}

// 지금 REVIEW 턴이 도는 중이면 id를 기억한다(제안 줄에 붙인다)
let currentReview: string | null = null;
// 턴이 끝났으면 id도 버린다(제안 줄이 지난 점검의 id를 달고 가지 않게)
export const reviewTurnActive = (rt: () => DutyRuntime = duty) => {
  if (currentReview !== null && !rt().reviewTurn()) currentReview = null;
  return currentReview !== null;
};

// DUTY ACCOUNT의 FUEL이 HOLD 임계값 이상인가(서버가 시작하는 턴은 FUEL을 아낀다). 모르면 false
export const fuelHoldOf = (snap: Pick<Snapshot, "fuelAccounts">, account: string): boolean => (snap.fuelAccounts ?? []).some((f) => (f.account ?? f.group) === account && f.level === "hold");

export function landingLinesOf(brief: unknown): string[] {
  const q = (brief as { landingQueue?: unknown[] } | null)?.landingQueue;
  if (!Array.isArray(q)) return [];
  return q.slice(0, 20).map((raw) => {
    const x = raw as { landing?: string; key?: string | null; pr?: { number?: number }; landBy?: string; landWhy?: string | null; holders?: unknown[]; blocks?: { code?: string }[] };
    const blocks = (x.blocks ?? []).map((b) => b.code).filter(Boolean).join("+");
    return `PR #${x.pr?.number ?? "?"}${x.key ? ` (${x.key})` : ""} ${x.landing ?? "?"} · landBy ${x.landBy ?? "?"}${x.landWhy ? `/${x.landWhy}` : ""} · holders ${(x.holders ?? []).length}${blocks ? ` · blocks ${blocks}` : ""}`;
  });
}

// 한 주기. 시험이 직접 부른다. 돌렸으면 점검 id
export async function reviewTick(d: ReviewDeps, state: { idleSince: number | null; emptySince?: number | null }): Promise<string | null> {
  const cfg = (d.cfg ?? loadDutyConfig)();
  const now = d.now();
  if (!cfg.enabled || !cfg.review || now - d.startedAt < WARMUP_MS) return null;
  const [dispatch, snap] = await Promise.all([d.get("/api/dispatch/brief").catch(() => null), d.snapshot()]);
  if (dispatch === null) return null; // 읽지 못한 채 신호를 지어내지 않는다
  const lines = d.lines();
  // 점검 기록만 본다(서버를 다시 띄워도 정기 점검이 밀리지 않는다: 막 뜬 때는 WARMUP_MS가 막는다).
  // 건너뛴 점검(ATC-566)도 점검처럼 넣는다: 오늘 규칙이 점검했을 때마다 한 번 건너뛰고, 건너뛴 다음 주기에 다시 서지 않는다(하루 상한에는 돈 점검만 센다)
  const memos = reviewMemosOf(lines).filter((m) => cfg.reviewSkip || !m.skipped); // 스위치가 꺼지면 오늘처럼 돈 점검만 본다
  const lastAt = Math.max(0, ...memos.map((r) => r.at));
  const leaks = d.openLeaks(now);
  const signals = signalsOf(dispatch, leaks, now);
  const rt = d.rt();
  const st = rt.status();
  if (currentReview !== null && !rt.reviewTurn()) currentReview = null;
  const busy = st.state !== "idle" || st.queued > 0;
  const fuelHold = fuelHoldOf(snap, cfg.account);
  const dec = decideReview({ now, lastAt, busy, cfg, signals, idleSince: state.idleSince, emptySince: state.emptySince ?? null, history: memos, fuelHold });
  state.idleSince = dec.idleSince;
  state.emptySince = dec.emptySince;
  // 밀린 점검(ATC-566): 마지막으로 돈 점검 뒤에 건너뛴 점검이 있으면, 사실이 바뀌거나 하루 한 번이 오면 트리거를 기다리지 않고 곧바로 돈다.
  // 돈 점검끼리의 간격·하루 상한·바쁨·FUEL은 그대로 지킨다
  const last = lastRunOf(lines);
  const pending = cfg.reviewSkip && !dec.run && !busy && !fuelHold ? pendingSkipOf(lines) : null;
  const lastRunAt = last?.at ?? 0;
  const runsToday = memos.filter((m) => !m.skipped && now - m.at < 24 * 60 * 60_000).length;
  const pendingOk = pending !== null && now - lastRunAt >= cfg.reviewGapMin * 60_000 && runsToday < REVIEW_DAILY_MAX;
  if (!(dec.run && dec.trigger) && !pendingOk) return null;
  const brief = await d.get("/api/controller/brief").catch(() => null);
  const landing = landingLinesOf(brief);
  const alerts = d.alerts();
  const effects = d.effects?.() ?? [];
  const facts = reviewFactsOf({ signals, leakIds: leaks.map((l) => l.id ?? l.title), landing, alerts: alerts.map((a) => ({ level: a.level, key: a.key ?? a.text })), effects });
  const verdict = skipVerdictOf({ on: cfg.reviewSkip, fp: facts.fp, last, now });
  let trigger: ReviewTrigger;
  let detail: string;
  let key: string | undefined;
  if (dec.run && dec.trigger) {
    if (verdict.skip) {
      d.append({ v: 1, ev: "skip", at: new Date(now).toISOString(), trigger: dec.trigger, detail: (dec.detail ?? "").slice(0, 300), ...(dec.key ? { key: dec.key.slice(0, 500) } : {}), same: last?.id ?? "", fp: facts.fp, facts: facts.facts.slice(0, FACTS_KEEP_MAX), why: verdict.why });
      console.log(`[atc] duty review: skipped ${dec.trigger} — ${verdict.why} (fp ${facts.fp})`);
      return null;
    }
    trigger = dec.trigger;
    detail = `${dec.detail ?? ""}${verdict.why === "heartbeat" ? ` · daily heartbeat (${String(HEARTBEAT_HOUR_UTC).padStart(2, "0")}:00Z)` : ""}`;
    key = dec.key;
  } else {
    // 밀린 점검: 사실이 그대로면(그리고 하루 한 번이 아직이면) 기다린다. 줄을 더 쓰지 않는다
    if (verdict.skip || !pending) return null;
    trigger = pending.trigger;
    key = pending.key;
    detail = verdict.why === "heartbeat" ? `daily heartbeat (${String(HEARTBEAT_HOUR_UTC).padStart(2, "0")}:00Z): facts unchanged since ${last?.id ?? "the last review"}` : `facts changed since the review skipped at ${pending.at.slice(11, 16)}Z (${pending.detail.slice(0, 160)})`;
  }
  const id = nextReviewId(lines);
  const alertLines = alerts
    .filter((a) => a.level === "warning" || a.level === "caution")
    .slice(0, 10)
    .map((a) => `${a.level}: ${a.text.slice(0, 160)}`);
  const open = snap.tickets.filter((t) => t.stateType !== "completed" && t.stateType !== "canceled").map((t) => ({ key: t.key, title: t.title }));
  const isEmpty = trigger === "empty";
  const readyBacklog = isEmpty ? (d.ready ?? releaseReadyNow)(snap).map((r) => ({ key: r.key, title: r.title, priority: r.priority ?? null })) : undefined;
  const ideas = isEmpty ? await (d.ideas ?? ideasNow)() : undefined;
  const text = reviewPromptOf({ id, trigger, detail, signals, linear: cfg.l1, landing, alerts: alertLines, effects, openIssues: open, readyBacklog, ideas });
  const line = `DUTY REVIEW ${id} · ${trigger} · ${detail}`.slice(0, 300);
  currentReview = id; // 턴 시작 전에 세운다: 첫 도구 호출이 이 id를 본다
  if (isEmpty) emptyTurn = { id, ready: readyBacklog ?? [], text: "" };
  const r = await rt.sendReview(text, line);
  if (r.verdict !== "sent") {
    currentReview = null;
    emptyTurn = null;
    return null;
  }
  d.append({ v: 1, ev: "review", id, at: new Date(now).toISOString(), trigger, detail: detail.slice(0, 300), ...(key ? { key: key.slice(0, 500) } : {}), fp: facts.fp, facts: facts.facts.slice(0, FACTS_KEEP_MAX) });
  return id;
}

export function mountDutyReview(app: Hono, snapshot: () => Promise<Snapshot>, deps: Partial<ReviewDeps> = {}) {
  const d: ReviewDeps = {
    snapshot,
    get:
      deps.get ??
      (async (path) => {
        const r = await app.request(path);
        if (!r.ok) throw new Error(`${path} → ${r.status}`);
        return r.json();
      }),
    rt: duty,
    lines: () => readReviewLines(),
    append: (l) => appendReviewLine(l),
    releases: () => readReleaseLines(),
    openLeaks: openLeaksNow,
    alerts: () => currentAlerts().map((a) => ({ level: a.level ?? "", text: a.text ?? "", key: a.key })),
    effects: deps.effects ?? openEffectLines,
    now: Date.now,
    startedAt: Date.now(),
    ...deps,
  };
  const state = { idleSince: null as number | null, emptySince: null as number | null };
  watchEmptyTurn(d.rt(), d.append, d.now);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await reviewTick(d, state);
    } catch (e) {
      console.warn(`[atc] duty review: ${e instanceof Error ? e.message : e}`);
    } finally {
      running = false;
    }
  };
  setInterval(() => void timed("tick:duty-review", tick), TICK_MS).unref();

  // 읽기만: 스위치 상태와 하루 세기(스위치는 설정 창에서만 바뀐다: PUT /api/settings의 dutyReview, Origin 검사)
  app.get("/api/duty/review", async (c) => {
    const cfg = loadDutyConfig();
    const lines = d.lines();
    const last = [...lines].reverse().find((l) => l.ev === "review");
    let tickets: Snapshot["tickets"] = [];
    try {
      tickets = (await d.snapshot()).tickets;
    } catch {}
    return c.json({
      on: cfg.review,
      dutyEnabled: cfg.enabled,
      linear: cfg.l1,
      config: { everyMin: cfg.reviewEveryMin, idleMin: cfg.reviewIdleMin, leakMin: cfg.reviewLeakMin, gapMin: cfg.reviewGapMin, emptyMin: cfg.reviewEmptyMin, emptyGapMin: cfg.reviewEmptyGapMin },
      empty: { on: cfg.reviewEmpty, ...emptyMisfiresOf(lines, tickets) },
      skip: { on: cfg.reviewSkip, heartbeatHourUtc: HEARTBEAT_HOUR_UTC, ...skipCountsOf(lines) },
      last: last && last.ev === "review" ? { id: last.id, at: last.at, trigger: last.trigger, detail: last.detail } : null,
      days: reviewDaysOf(lines, d.releases(), tickets, d.now(), 14),
    });
  });
}

// duty-l1-run.ts에 꽂는 조각: REVIEW 턴이면 제안을 Backlog에만, 비슷한 열린 이슈는 막고, 만든 제안은 기록한다
export function reviewHooks(snapshot: () => Promise<Snapshot>) {
  return {
    reviewTurn: () => reviewTurnActive(),
    openSimilar: async (title: string) => openSimilarKey(title, (await snapshot()).tickets, Date.now()),
    onProposal: (key: string, title: string) => {
      if (currentReview) appendReviewLine({ v: 1, ev: "proposal", at: new Date().toISOString(), review: currentReview, key, title: title.slice(0, 200) });
    },
    // 이미 있는 이슈에 쓴 댓글·고침(ATC-566): 그 점검이 무언가 냈다는 기록. 다음 점검을 건너뛰지 않게 한다
    onWrite: (key: string, action: "comment" | "update") => {
      if (currentReview) appendReviewLine({ v: 1, ev: "write", at: new Date().toISOString(), review: currentReview, key, action });
    },
  };
}

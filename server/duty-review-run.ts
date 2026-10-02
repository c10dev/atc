// DUTY REVIEW 런타임(ATC-396, docs/duty.md): 주기마다 신호를 읽고, 트리거가 서면 DUTY 턴을 서버가 시작한다.
// 외부에 나가는 동작: DUTY 세션(`claude -p`)에 글을 쓴다(duty-run.ts). 스위치(duty.json review)는 SUPERVISOR만 설정 창에서 바꾼다. 기본 켜짐, DUTY가 꺼져 있으면 돌지 않는다.
// 기록은 duty-reviews.jsonl(추가만): 점검 한 줄, 제안 한 줄. 세기는 GET /api/duty/review.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { loadDutyConfig } from "./duty-config.ts";
import { type DutyRuntime, duty } from "./duty-run.ts";
import { decideReview, nextReviewId, openSimilarKey, reviewDaysOf, reviewPromptOf, type ReviewLine, signalsOf } from "./duty-review.ts";
import { type OpenLeak, openFromRecords } from "./leaks.ts";
import { readLeaks } from "./leaks-run.ts";
import type { Snapshot } from "./model.ts";
import type { ReleaseLine } from "./release.ts";
import { readReleaseLines } from "./release-store.ts";
import { currentAlerts } from "./supervisor-alerts-run.ts";

export const REVIEWS_FILE = () => join(config.stateDir, "duty-reviews.jsonl");
export const TICK_MS = 60_000;
const WARMUP_MS = 3 * 60_000; // 서버가 뜬 직후(RTS 재시작)에는 스냅샷이 비어 있다: 이만큼 기다린다

export function readReviewLines(file = REVIEWS_FILE()): ReviewLine[] {
  let raw = "";
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return raw.split("\n").flatMap((l) => {
    try {
      const j = JSON.parse(l) as ReviewLine;
      return j && (j.ev === "review" || j.ev === "proposal") ? [j] : [];
    } catch {
      return [];
    }
  });
}
export function appendReviewLine(line: ReviewLine, file = REVIEWS_FILE()) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(line)}\n`);
}

export type Fetcher = (path: string) => Promise<unknown>;
export interface ReviewDeps {
  snapshot: () => Promise<Snapshot>;
  get: Fetcher; // 서버 안에서 같은 핸들러를 부른다
  rt: () => DutyRuntime;
  lines: () => ReviewLine[];
  append: (l: ReviewLine) => void;
  releases: () => ReleaseLine[];
  openLeaks: (now: number) => { title: string; sinceMs: number }[];
  alerts: () => { level: string; text: string }[];
  cfg?: () => ReturnType<typeof loadDutyConfig>; // 시험용
  now: () => number;
  startedAt: number;
}

const openLeaksNow = (now: number): { title: string; sinceMs: number }[] =>
  [...openFromRecords(readLeaks(), now).values()].map((o: OpenLeak) => ({ title: o.rec.title, sinceMs: Date.parse(o.rec.since) })).filter((x) => Number.isFinite(x.sinceMs));

// 지금 REVIEW 턴이 도는 중이면 id를 기억한다(제안 줄에 붙인다)
let currentReview: string | null = null;
export const reviewTurnActive = (rt: () => DutyRuntime = duty) => currentReview !== null && rt().reviewTurn();

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
export async function reviewTick(d: ReviewDeps, state: { idleSince: number | null }): Promise<string | null> {
  const cfg = (d.cfg ?? loadDutyConfig)();
  const now = d.now();
  if (!cfg.enabled || !cfg.review || now - d.startedAt < WARMUP_MS) return null;
  const [dispatch, snap] = await Promise.all([d.get("/api/dispatch/brief").catch(() => null), d.snapshot()]);
  if (dispatch === null) return null; // 읽지 못한 채 신호를 지어내지 않는다
  const lines = d.lines();
  const lastAt = Math.max(d.startedAt, ...lines.filter((l) => l.ev === "review").map((l) => Date.parse(l.at)));
  const signals = signalsOf(dispatch, d.openLeaks(now), now);
  const rt = d.rt();
  const st = rt.status();
  const dec = decideReview({ now, lastAt, busy: st.state !== "idle" || st.queued > 0, cfg, signals, idleSince: state.idleSince });
  state.idleSince = dec.idleSince;
  if (!dec.run || !dec.trigger) return null;
  const id = nextReviewId(lines);
  const brief = await d.get("/api/controller/brief").catch(() => null);
  const alertLines = d
    .alerts()
    .filter((a) => a.level === "warning" || a.level === "caution")
    .slice(0, 10)
    .map((a) => `${a.level}: ${a.text.slice(0, 160)}`);
  const open = snap.tickets.filter((t) => t.stateType !== "completed" && t.stateType !== "canceled").map((t) => ({ key: t.key, title: t.title }));
  const text = reviewPromptOf({ id, trigger: dec.trigger, detail: dec.detail ?? "", signals, linear: cfg.l1, landing: landingLinesOf(brief), alerts: alertLines, openIssues: open });
  const line = `DUTY REVIEW ${id} · ${dec.trigger} · ${dec.detail ?? ""}`.slice(0, 300);
  currentReview = id; // 턴 시작 전에 세운다: 첫 도구 호출이 이 id를 본다
  const r = await rt.sendReview(text, line);
  if (r.verdict !== "sent") {
    currentReview = null;
    return null;
  }
  d.append({ v: 1, ev: "review", id, at: new Date(now).toISOString(), trigger: dec.trigger, detail: (dec.detail ?? "").slice(0, 300) });
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
    alerts: () => currentAlerts().map((a) => ({ level: a.level ?? "", text: a.text ?? "" })),
    now: Date.now,
    startedAt: Date.now(),
    ...deps,
  };
  const state = { idleSince: null as number | null };
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
  setInterval(() => void tick(), TICK_MS).unref();

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
      config: { everyMin: cfg.reviewEveryMin, idleMin: cfg.reviewIdleMin, leakMin: cfg.reviewLeakMin, gapMin: cfg.reviewGapMin },
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
  };
}

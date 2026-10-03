import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { type AutoSwitch, parseAutoSwitch } from "./autonomy-auto.ts";
import { allClearances } from "./clearances.ts";
import { config } from "./config.ts";
import { type EffectData, type EffectLine, effectLine, foldEffects, judge, type Measure, measureOf, misfireOf as effectMisfireOf, openBadOf, windowElapsed, WINDOW_MAX_DAYS } from "./effect-check.ts";
import { appendEffectLine, readEffectLines, VERDICTS_FILE } from "./effect-store.ts";
import { loadMcc } from "./mcc.ts";
import { isAutoApproved, misfireOf } from "./misfire.ts";
import { milestonesNow } from "./milestones-run.ts";
import type { Snapshot } from "./model.ts";
import { allProposals } from "./proposals.ts";
import { readRecords } from "./recorder.ts";
import { releaseIdOf } from "./release.ts";
import { readReleaseView } from "./release-store.ts";
import { readLeaks } from "./leaks-run.ts";
import { fetchIssueDetail } from "./sources/linear.ts";

// EFFECT CHECK의 읽고 쓰기(ATC-402). 규칙은 effect-check.ts(순수). 평결은 effect-verdicts.jsonl에 추가만 한다(FLIGHT마다 하나, 그 뒤 SUPERVISOR의 표시 줄).
// 끄는 스위치는 effect-check.json의 `on`(on·off, 없으면 on). 바꾸는 길은 설정 창뿐이다(SUPERVISOR 자격이 있는 요청만, atcctl 명령은 없다).
const DAY = 86_400_000;
export { appendEffectLine, readEffectLines, VERDICTS_FILE };
const SWITCH_FILE = () => join(config.stateDir, "effect-check.json");
export const TICK_MS = 10 * 60_000;
const MAX_FETCH = 15; // 한 주기에 Linear에서 읽는 본문 수
const LOOKBACK_DAYS = WINDOW_MAX_DAYS + 7; // 이만큼 안에 배포된 FLIGHT만 본다

export function loadEffectSwitch(file = SWITCH_FILE()): AutoSwitch {
  try {
    return parseAutoSwitch(JSON.parse(readFileSync(file, "utf8")).on);
  } catch {
    return "on"; // 없거나 깨져도 켜 둔다(재는 것뿐이고 아무것도 바꾸지 않는다)
  }
}
export function saveEffectSwitch(v: AutoSwitch, file = SWITCH_FILE()) {
  if (loadEffectSwitch(file) === v) return;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ on: v }, null, 2) + "\n");
  renameSync(tmp, file);
}

// ── 측정할 것을 모으기 ──
const recorderFirstAt = (): number | null => {
  try {
    const f = readdirSync(join(config.stateDir, "flight-recorder")).filter((x) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(x)).sort()[0];
    return f ? Date.parse(`${f.slice(0, 10)}T00:00:00Z`) : null;
  } catch {
    return null;
  }
};
const minMs = (xs: (string | undefined)[]) => {
  const ts = xs.flatMap((x) => (x ? [Date.parse(x)] : [])).filter(Number.isFinite);
  return ts.length ? Math.min(...ts) : null;
};

export function gatherEffectData(sinceMs: number): EffectData {
  const leaks = readLeaks();
  const proposals = allProposals();
  const clearances = allClearances();
  const events = readRecords(sinceMs).flatMap((r) => (r.kind === "event" && r.event.kind === "alert.raised" && r.event.alertKind ? [{ at: r.event.at, kind: String(r.event.alertKind) }] : []));
  return {
    leaks,
    misfires: proposals.filter((p) => isAutoApproved(p) && misfireOf(p)).map((p) => ({ at: p.timeline.approved! })),
    alerts: events,
    clearances: clearances.map((c) => ({ at: c.at, type: c.type })),
    coverageFrom: {
      leak: minMs(leaks.map((r) => r.t)),
      "leak-minutes": minMs(leaks.map((r) => r.t)),
      misfire: minMs(proposals.filter(isAutoApproved).map((p) => p.timeline.approved)),
      alert: recorderFirstAt(),
      clearance: minMs(clearances.map((c) => c.at)),
    },
  };
}

// ── 한 주기 ──
export interface EffectDeps {
  now: () => number;
  on: () => boolean;
  lines: () => EffectLine[];
  append: (l: EffectLine) => void;
  deployed: () => Map<string, number>; // FLIGHT → 배포된 시각(ms)
  body: (flight: string) => Promise<string | null>; // 이슈 본문(못 읽으면 null)
  data: (sinceMs: number) => EffectData;
  releaseOf: (flight: string) => string | null;
}

// 본문의 측정 해석 캐시(하루): 착륙한 작업 지시서는 고치지 않으므로(후속 이슈로 간다) None·절 없음·잘못된 모양도 하루 동안 다시 읽지 않는다
const parseCache = new Map<string, { at: number; measure: Measure | null }>();
export const resetEffectCache = () => parseCache.clear();
const PARSE_TTL = DAY;
const MIN_WINDOW_MS = DAY; // 창은 1d 이상이라 배포 뒤 하루가 안 지난 FLIGHT는 본문을 읽어도 평결을 낼 수 없다

// 마지막 주기가 본문을 못 읽고 넘긴 FLIGHT 수(굶은 점검이 화면에 보이게)
let lastSkipped = 0;
export const skippedCount = () => lastSkipped;

export async function runEffectCheck(d: EffectDeps): Promise<{ written: number; fetched: number }> {
  const out = { written: 0, fetched: 0 };
  if (!d.on()) return out;
  const now = d.now();
  const have = new Set(d.lines().filter((l) => l.ev === "verdict").map((l) => l.flight));
  const fresh = (f: string) => {
    const c = parseCache.get(f);
    return !!c && now - c.at <= PARSE_TTL;
  };
  // 아직 읽지 않은(또는 캐시가 지난) FLIGHT를 먼저, 그 안에서는 최근 배포 먼저: 다음에 창이 지나는 것이 먼저 읽힌다. 읽은 것은 하루 캐시라 후보 수가 많아도 몇 주기 안에 모두 한 번씩 본다
  const cands = [...d.deployed()]
    .filter(([f, at]) => !have.has(f) && now - at <= LOOKBACK_DAYS * DAY && now - at >= MIN_WINDOW_MS)
    .sort((a, b) => Number(fresh(a[0])) - Number(fresh(b[0])) || b[1] - a[1]);
  let skipped = 0;
  for (const [flight, deployedAt] of cands) {
    let c = parseCache.get(flight);
    if (!c || now - c.at > PARSE_TTL) {
      if (out.fetched >= MAX_FETCH) {
        skipped++;
        continue;
      }
      out.fetched++;
      const body = await d.body(flight).catch(() => null);
      if (body === null) {
        skipped++;
        continue; // 못 읽었다: 다음 주기에
      }
      const p = measureOf(body);
      c = { at: now, measure: p.kind === "measure" ? p.measure : null }; // None·절 없음·잘못된 모양은 평결이 없다
      parseCache.set(flight, c);
    }
    if (!c.measure || !windowElapsed(deployedAt, c.measure, now)) continue;
    const m = c.measure;
    const j = judge(m, deployedAt, d.data(deployedAt - m.windowDays * DAY));
    d.append({ v: 1, ev: "verdict", at: new Date(now).toISOString(), flight, release: d.releaseOf(flight), deployedAt: new Date(deployedAt).toISOString(), metric: `${m.source}:${m.name}`, direction: m.direction, windowDays: m.windowDays, before: j.before, after: j.after, verdict: j.verdict, reason: j.reason });
    out.written++;
  }
  lastSkipped = skipped;
  return out;
}

// 배포된 FLIGHT: IN이 있으면 그 시각, MCC AIRPORT가 아닌 곳은 배포가 없어 ON(착륙)
export function deployedOf(s: Pick<Snapshot, "pulls" | "airports">, now: number): Map<string, number> {
  const mccAirport = loadMcc().airport;
  const noDeploy = new Set<string>();
  const codeOf = (repo: string) => s.airports.find((a) => a.repo === repo)?.code ?? null;
  for (const p of s.pulls) {
    const code = codeOf(p.repo);
    if (p.ticketKey && code && code !== mccAirport) noDeploy.add(p.ticketKey);
  }
  const out = new Map<string, number>();
  for (const [flight, m] of milestonesNow(s, now)) {
    const at = m.in ?? (noDeploy.has(flight) ? m.on : null);
    if (at && !m.reverted) out.set(flight, Date.parse(at));
  }
  return out;
}

export const realDeps = (s: Snapshot): EffectDeps => ({
  now: Date.now,
  on: () => loadEffectSwitch() === "on",
  lines: readEffectLines,
  append: (l) => appendEffectLine(l),
  deployed: () => deployedOf(s, Date.now()),
  body: async (f) => {
    const d = (await fetchIssueDetail(f)) as { description?: unknown };
    return typeof d.description === "string" ? d.description : "";
  },
  data: gatherEffectData,
  releaseOf: (f) => {
    const r = readReleaseView().records[f];
    return r ? releaseIdOf(r) : null;
  },
});

export function viewOf(lines = readEffectLines()) {
  const verdicts = foldEffects(lines);
  return { on: loadEffectSwitch() === "on", verdicts, misfire: effectMisfireOf(verdicts), open: openBadOf(verdicts).map((v) => v.flight), skipped: lastSkipped };
}

// DUTY REVIEW가 읽는 줄: 열린 not improved·worse 평결(ATC-402)
export const openEffectLines = (): string[] => openBadOf(foldEffects(readEffectLines())).map(effectLine);

export function mountEffectCheck(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const s = await getSnapshot();
      if (s.github.enabled && !s.github.fetchedAt) return; // PR이 아직 없으면 배포된 FLIGHT도 모른다
      await runEffectCheck(realDeps(s));
    } catch (e) {
      console.warn(`[atc] effect-check: ${e instanceof Error ? e.message : e}`);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void tick(), 90_000).unref();
  setInterval(() => void tick(), TICK_MS).unref();

  // 평결 목록(?flight=KEY면 그 FLIGHT만). 읽기만
  app.get("/api/effect", (c) => {
    const v = viewOf();
    const f = (c.req.query("flight") ?? "").toUpperCase();
    return c.json(f ? { ...v, verdicts: v.verdicts.filter((x) => x.flight === f) } : v);
  });
  // SUPERVISOR가 평결이 틀렸다고 표시한다(또는 거둔다). 서버 전체의 SUPERVISOR 자격 문이 이 쓰기를 막아 주고(에이전트 길 목록에 없다), 여기서는 모양만 본다
  app.post("/api/effect/mark", async (c) => {
    const b = (await c.req.json().catch(() => null)) as { flight?: unknown; wrong?: unknown } | null;
    const flight = typeof b?.flight === "string" ? b.flight.trim().toUpperCase() : "";
    if (!/^[A-Z][A-Z0-9]*-\d+$/.test(flight) || typeof b?.wrong !== "boolean") return c.json({ error: "flight(ATC-n)와 wrong(true|false)이 필요함" }, 400);
    if (!foldEffects(readEffectLines()).some((v) => v.flight === flight)) return c.json({ error: "그 FLIGHT의 평결이 없음" }, 404);
    appendEffectLine({ v: 1, ev: "mark", at: new Date().toISOString(), flight, wrong: b.wrong });
    return c.json(viewOf());
  });
}


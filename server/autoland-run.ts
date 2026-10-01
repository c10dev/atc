import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";
import type { Hono } from "hono";
import {
  AUTOLAND_MODES,
  type AirportPlan,
  type AutolandConfig,
  type AutolandMode,
  type AutolandRecord,
  type AutolandState,
  checkWarningsOf,
  escalateOf,
  headKey,
  type InFlight,
  isHeld,
  latchGroundStops,
  loadAutoland,
  loadAutolandState,
  mergeExclusionOf,
  planAutoland,
  RECORD_FILE,
  type ReviewRequest,
  type ReviewedSecurity,
  reviewRequestOf,
  saveAutoland,
  saveAutolandState,
  setCheckWarnings,
  settleOf,
  writeResultOf,
} from "./autoland.ts";
import { mergeReviewOf, pullKey, reviewPasses, slugOfUrl } from "./landing.ts";
import { readMergeReviews } from "./landing-review.ts";
import { assertGithubOn } from "./github-switch.ts";
import { hostedDbOfAirport } from "./airports.ts";
import { type MigrationGate, migrationGateOf } from "./migration-gate.ts";
import { listPullFiles } from "./sources/github.ts";
import { readAppliedFor } from "./sources/supabase-migrations.ts";
import type { PullRequest, Snapshot } from "./model.ts";
import { fromThisApp } from "./origin.ts";

// AUTOLAND 실행부(ATC-34). GitHub을 새로 읽을 때마다(90초) 한 주기: GROUND STOP 걸기 → 갱신한 PR 정리 → AIRPORT마다 할 일 하나.
// GitHub에 쓰는 호출은 셋뿐이다: update 모드의 update-branch(expected_head_sha), merge 모드의 위임 PR 정확한 head 머지(sha),
// 갱신한 head에 리뷰가 이어지지 않았을 때 head마다 한 번 다는 PR 댓글 `@codex review`(ATC-38).
// force-push, GitHub auto-merge, 브랜치 보호·strict는 건드리지 않는다.

const run = promisify(execFile);
const gh = async (args: string[]) => {
  assertGithubOn();
  return (await run("gh", args, { timeout: 60_000, maxBuffer: 16 << 20 })).stdout;
};

export function appendRecord(r: Omit<AutolandRecord, "at"> & { at?: string }) {
  const line: AutolandRecord = { at: r.at ?? new Date().toISOString(), ...r } as AutolandRecord;
  const file = RECORD_FILE();
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(line) + "\n");
  if (["update", "merge", "groundstop", "groundstop-clear", "mode", "review-request"].includes(line.op)) console.log(`[atc] autoland ${line.op}${line.number ? ` #${line.number}` : ""}${line.result ? ` ${line.result}` : ""}${line.detail ? ` — ${line.detail}` : ""}`);
}

export function readRecords(limit = 50): AutolandRecord[] {
  try {
    return readFileSync(RECORD_FILE(), "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as AutolandRecord];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

// 스위치(SUPERVISOR만: 설정 창 PUT /api/settings의 autolandMode)
export function setAutolandMode(mode: AutolandMode) {
  const cfg = loadAutoland();
  if (cfg.mode === mode) return;
  saveAutoland({ ...cfg, mode });
  appendRecord({ op: "mode", mode, detail: `${cfg.mode} → ${mode}` });
}

// reviewedSecurity 스위치(ATC-328, SUPERVISOR만: 설정 창 PUT /api/settings의 autolandReviewedSecurity). 관제 세션 CLI에는 명령이 없다
export function setReviewedSecurity(v: ReviewedSecurity) {
  const cfg = loadAutoland();
  if (cfg.reviewedSecurity === v) return;
  saveAutoland({ ...cfg, reviewedSecurity: v });
  appendRecord({ op: "reviewed-security", mode: cfg.mode, detail: `${cfg.reviewedSecurity} → ${v}` });
}

let running = false;
let lastCycle: string | null = null;

// 스냅샷마다 부르지만, GitHub을 새로 읽었을 때만 한 주기를 돈다(같은 자료로 두 번 쓰지 않게)
export function runAutoland(s: Snapshot) {
  if (running || !s.github.fetchedAt || s.github.fetchedAt === lastCycle) return;
  lastCycle = s.github.fetchedAt;
  running = true;
  cycle(s)
    .catch((e) => console.error("[atc] autoland failed:", e))
    .finally(() => (running = false));
}

const airportsOf = (s: Snapshot) => s.airports.map((a) => ({ code: a.code, repo: a.repo }));

async function cycle(s: Snapshot) {
  const cfg = loadAutoland();
  const st = loadAutolandState();
  const now = new Date().toISOString();
  const covered = airportsOf(s).filter((a) => cfg.airports.includes(a.code));

  // GROUND STOP: 맡은 AIRPORT의 main에서 Application Check가 빨가면 건다(스위치가 꺼져 있어도 — 켤 때 멈춘 채로 보이게)
  const stops = latchGroundStops(cfg, covered, s.atfm.mains, st, now);
  for (const g of stops.filter((x) => !st.groundStops.includes(x))) {
    appendRecord({ op: "groundstop", mode: cfg.mode, airport: g.airport, head: g.sha, result: "stopped", detail: `main ${g.failing.join(", ")} 실패` });
  }
  st.groundStops = stops;
  setCheckWarnings(checkWarningsOf(cfg, covered, s.atfm.mains)); // applicationCheck가 main에서 어떤 체크·워크플로 이름과도 안 맞으면 설정 창이 알린다(ATC-330)

  // 갱신한 PR 정리: 닫힘·CI 끝남(CLEARED나 다른 막힘)·시간 초과
  const settled: { f: InFlight; p: PullRequest }[] = [];
  st.inflight = st.inflight.filter((f) => {
    const p = s.pulls.find((x) => x.repo === f.repo && x.number === f.number);
    const done = settleOf(f, p, Date.now());
    if (!done) return true;
    appendRecord({ op: "settle", mode: cfg.mode, airport: f.airport, slug: f.slug, number: f.number, head: done.head ?? f.fromHead, result: done.result, detail: done.detail });
    if (done.result === "timeout" && !done.head) st.skip.push(`${f.repo}#${f.number}@${f.fromHead}`);
    if (p && done.head) settled.push({ f, p });
    return false;
  });

  // 재리뷰(ATC-38): update·merge이고 GROUND STOP이 아닌 AIRPORT만. 갱신이 끝난 head에 리뷰가 이어지지 않았으면 head마다 한 번 요청하고,
  // codex로 요청한 것은 한도·30분 무응답이면 REVIEW(외부 리뷰 제외 PR은 SUPERVISOR)로 넘긴다
  const active = (airport: string) => cfg.mode !== "off" && cfg.airports.includes(airport) && !st.groundStops.some((g) => g.airport === airport);
  const airportOfRepo = (repo: string) => s.airports.find((a) => a.repo === repo)?.code ?? "";
  for (const { f, p } of settled) {
    if (!active(f.airport)) continue;
    const r = reviewRequestOf(p, f.slug, st.reviewRequests, new Date().toISOString());
    if (!r) continue;
    st.reviewRequests.push(r);
    await requestReview(r, cfg.mode, f.airport);
  }
  st.reviewRequests = st.reviewRequests.map((r) => {
    if (!active(airportOfRepo(r.repo))) return r;
    const next = escalateOf(r, s.pulls.find((x) => x.repo === r.repo && x.number === r.number), Date.now());
    if (next) appendRecord({ op: "review-request", mode: cfg.mode, airport: airportOfRepo(r.repo), slug: r.slug, number: r.number, head: r.head, via: next.via, result: "ok", detail: next.reason });
    return next ?? r;
  });
  // 맡지 않게 된 AIRPORT의 비행 기록은 지운다
  st.inflight = st.inflight.filter((f) => cfg.airports.includes(f.airport));

  if (cfg.mode !== "off") {
    const exclusions = s.autoland?.exclusions ?? {};
    const view = planAutoland({ cfg, airports: airportsOf(s), pulls: s.pulls, st, exclusionOf: (p) => (pullKey(p) in exclusions ? exclusions[pullKey(p)] : "제외 여부를 아직 계산하지 않음") });
    for (const plan of view.airports) {
      const p = s.pulls.find((x) => x.repo === plan.repo && x.number === plan.number);
      if (!p) continue;
      if (plan.status === "update") await doUpdate(plan, p, st);
      else if (plan.status === "merge") await doMerge(plan, p, st, s);
    }
  }
  // 주기 사이에 SUPERVISOR가 푼 GROUND STOP은 되살리지 않는다
  st.clearedShas = [...new Set([...st.clearedShas, ...loadAutolandState().clearedShas])];
  st.groundStops = st.groundStops.filter((g) => !st.clearedShas.includes(g.sha));
  saveAutolandState(st);
}

// 재리뷰 요청 하나. codex면 PR 댓글 `@codex review`(이 작업의 유일한 새 GitHub 쓰기), deepseek·supervisor는 기록만(buildPulls가 대기열을 정한다)
async function requestReview(r: ReviewRequest, mode: AutolandMode, airport: string) {
  const base = { op: "review-request" as const, mode, airport, slug: r.slug, number: r.number, head: r.head, via: r.via };
  if (r.via !== "codex") return appendRecord({ ...base, result: "ok", detail: r.reason });
  const cfg = loadAutoland();
  if (cfg.mode === "off" || loadAutolandState().groundStops.some((g) => g.airport === airport)) return appendRecord({ ...base, result: "skipped", detail: "스위치가 꺼졌거나 GROUND STOP" });
  try {
    await gh(["api", "-X", "POST", `repos/${r.slug}/issues/${r.number}/comments`, "-f", "body=@codex review"]);
    appendRecord({ ...base, result: "ok", detail: "PR 댓글 @codex review" });
  } catch (e) {
    // 댓글이 실패해도 요청은 남는다: 30분 뒤 REVIEW로 넘어간다
    appendRecord({ ...base, result: "failed", detail: writeResultOf(errText(e)).detail });
  }
}

// 쓰기 직전에 스위치와 GROUND STOP을 다시 본다(주기 사이에 SUPERVISOR가 끄거나 main이 빨개졌으면 쓰지 않는다)
function stillAllowed(plan: AirportPlan, need: AutolandMode[]): AutolandConfig | null {
  const cfg = loadAutoland();
  if (!need.includes(cfg.mode) || !cfg.airports.includes(plan.airport)) return null;
  if (loadAutolandState().groundStops.some((g) => g.airport === plan.airport)) return null;
  return cfg;
}

const errText = (e: unknown) => {
  const err = e as { stderr?: string; message?: string };
  return err.stderr?.trim() || err.message || String(e);
};

async function doUpdate(plan: AirportPlan, p: PullRequest, st: AutolandState) {
  const cfg = stillAllowed(plan, ["update", "merge"]);
  const slug = slugOfUrl(p.url);
  if (!cfg || !slug) return;
  const base = { mode: cfg.mode, airport: plan.airport, slug, number: p.number, head: p.head };
  try {
    // 일반 merge 커밋(force-push 아님). head가 그사이 움직였으면 GitHub이 422로 거절한다
    await gh(["api", "-X", "PUT", `repos/${slug}/pulls/${p.number}/update-branch`, "-f", `expected_head_sha=${p.head}`]);
    st.inflight.push({ airport: plan.airport, repo: p.repo, slug, number: p.number, fromHead: p.head, at: new Date().toISOString() });
    appendRecord({ op: "update", ...base, result: "ok" });
  } catch (e) {
    const r = writeResultOf(errText(e));
    // 이 head로는 다시 하지 않는다. head가 움직였으면(rejected) 다음 주기에 새 head로 다시 후보가 된다
    st.skip.push(headKey(p));
    appendRecord({ op: "update", ...base, ...r });
  }
}

interface FreshPull {
  headRefOid: string;
  isDraft: boolean;
  title: string;
  body: string | null;
  labels: { name: string }[] | null;
  files: { path: string }[] | null;
}

// 이 head의 머지 리뷰 pass가 기록 파일에 있나: 이 head의 마지막 기록이 pass거나, 이어받았으면(main 병합만) 그 이전 커밋의 마지막 기록이 pass(ATC-328)
export function mergeReviewPassOn(slug: string, p: Pick<PullRequest, "number" | "head" | "mergeReview">, reviews = readMergeReviews()): boolean {
  const mr = p.mergeReview;
  if (!mr) return false;
  const at = mr.carriedFrom ?? p.head;
  return reviewPasses(mergeReviewOf(reviews, slug, p.number, at)) && mr.pass;
}

async function doMerge(plan: AirportPlan, p: PullRequest, st: AutolandState, s: Snapshot) {
  const cfg = stillAllowed(plan, ["merge"]);
  const slug = slugOfUrl(p.url);
  if (!cfg || !slug) return;
  const base = { mode: cfg.mode, airport: plan.airport, slug, number: p.number, head: p.head };
  try {
    // 머지 직전에 PR을 다시 읽어 head·Draft·라벨·본문·파일로 제외 목록을 다시 본다(90초 전 자료로 머지하지 않게)
    const fresh = JSON.parse(await gh(["pr", "view", String(p.number), "--repo", slug, "--json", "headRefOid,isDraft,title,body,labels,files"])) as FreshPull;
    if (fresh.headRefOid !== p.head) {
      appendRecord({ op: "merge", ...base, result: "rejected", detail: `head가 움직임(${fresh.headRefOid.slice(0, 7)}) — 다음 주기에 다시 봄` });
      return;
    }
    const ticket = p.ticketKey ? s.tickets.find((t) => t.key === p.ticketKey) : undefined;
    const files = fresh.files && fresh.files.length < 100 ? fresh.files.map((f) => f.path) : null; // 100개(한도)면 다 못 봤다
    // 마이그레이션 게이트(ATC-329): hostedDb가 있는 AIRPORT는 머지 직전에 파일 상태와 호스티드 DB의 적용 버전을 캐시 없이 새로 읽는다. 읽기만 한다
    const db = hostedDbOfAirport(p.repo);
    let migrationGate: MigrationGate | undefined;
    if (db) {
      const rows = await listPullFiles(slug, p.number).catch(() => null);
      const paths = rows ? rows.map((f) => f.path) : files;
      const touches = (paths ?? []).some((f) => f.startsWith(`${db.migrationsDir}/`));
      const applied = touches ? await readAppliedFor(db) : null;
      migrationGate = migrationGateOf({ hostedDb: db, files: paths, added: rows ? rows.filter((f) => f.status === "added").map((f) => f.path) : null, applied });
    }
    const why = fresh.isDraft
      ? "Draft"
      : mergeExclusionOf({
          held: isHeld(cfg, p),
          flight: p.ticketKey,
          ticketLabels: ticket?.labels ?? [],
          prLabels: (fresh.labels ?? []).map((l) => l.name),
          files,
          title: fresh.title,
          body: fresh.body,
          flightTitle: ticket?.title ?? null,
          head: fresh.headRefOid,
          // 스냅숏에서 이 head(위에서 같음을 확인)가 잇는 HUMAN CHECK 커밋만(ATC-31·37)
          carryFrom: p.humanCheck?.carriedFrom ? [p.humanCheck.carriedFrom] : [],
          reviewedSecurity: cfg.reviewedSecurity,
          migrationGate,
          // 머지 직전에 머지 리뷰가 지금도 이 head에 있는지 파일에서 다시 본다(head가 같음은 위에서 확인). main 병합만 해서 이어받은 것은 그 이전 커밋의 기록
          mergeReviewPass: mergeReviewPassOn(slug, p),
        });
    if (why) {
      st.skip.push(headKey(p));
      appendRecord({ op: "skip", ...base, result: "excluded", detail: why });
      return;
    }
    // 정확한 head만 머지한다(sha: gh pr merge --match-head-commit과 같은 조건). auto-merge를 켜지 않는다
    await gh(["api", "-X", "PUT", `repos/${slug}/pulls/${p.number}/merge`, "-f", `sha=${p.head}`, "-f", `merge_method=${cfg.mergeMethod}`]);
    st.merged.push(headKey(p));
    appendRecord({ op: "merge", ...base, result: "ok", detail: cfg.mergeMethod });
  } catch (e) {
    const r = writeResultOf(errText(e));
    st.skip.push(headKey(p));
    appendRecord({ op: "merge", ...base, ...r });
  }
}

// ── API ──
// 읽기는 누구나. HOLD와 GROUND STOP 풀기는 이 화면(Origin localhost)에서 온 요청만: SUPERVISOR 전용
export function mountAutoland(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  app.get("/api/autoland", async (c) => {
    const s = await getSnapshot();
    return c.json({ config: loadAutoland(), state: loadAutolandState(), view: s.autoland ?? null, records: readRecords(50), modes: AUTOLAND_MODES });
  });

  app.post("/api/autoland/hold", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다(SUPERVISOR 전용)" }, 403);
    const b = (await c.req.json().catch(() => null)) as { repo?: unknown; number?: unknown; hold?: unknown } | null;
    if (!b || typeof b.repo !== "string" || !Number.isInteger(b.number) || typeof b.hold !== "boolean") return c.json({ error: "repo, number, hold(true|false)가 필요함" }, 400);
    const s = await getSnapshot();
    const p = s.pulls.find((x) => x.repo === b.repo && x.number === b.number);
    if (b.hold && !p) return c.json({ error: "열린 PR이 아님" }, 404);
    const cfg = loadAutoland();
    const pr = { repo: b.repo, number: b.number as number };
    const holds = cfg.holds.filter((h) => !(h.repo === pr.repo && h.number === pr.number));
    if (b.hold) holds.push({ ...pr, at: new Date().toISOString() });
    saveAutoland({ ...cfg, holds });
    appendRecord({ op: b.hold ? "hold" : "unhold", mode: cfg.mode, airport: s.airports.find((a) => a.repo === pr.repo)?.code, slug: p ? (slugOfUrl(p.url) ?? undefined) : undefined, number: pr.number, head: p?.head });
    return c.json({ holds });
  });

  app.post("/api/autoland/groundstop/clear", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다(SUPERVISOR 전용)" }, 403);
    const b = (await c.req.json().catch(() => null)) as { airport?: unknown } | null;
    const airport = typeof b?.airport === "string" ? b.airport.toUpperCase() : "";
    const st = loadAutolandState();
    const stop = st.groundStops.find((g) => g.airport === airport);
    if (!stop) return c.json({ error: `${airport || "?"}에 AUTOLAND GROUND STOP이 없음` }, 404);
    st.groundStops = st.groundStops.filter((g) => g !== stop);
    st.clearedShas.push(stop.sha);
    saveAutolandState(st);
    appendRecord({ op: "groundstop-clear", mode: loadAutoland().mode, airport, head: stop.sha, result: "cleared", detail: "SUPERVISOR" });
    return c.json({ groundStops: st.groundStops });
  });
}

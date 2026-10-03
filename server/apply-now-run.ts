import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Context, Hono } from "hono";
import { accountFolders, observedLabelsOn } from "./accounts.ts";
import {
  type ApplyAircraft,
  type ApplyCounts,
  type ApplyPending,
  type ApplyRow,
  type ApplyTarget,
  applyNowPlanOf,
  countsOf,
  pendingLiveOf,
  pendingOfFile,
  waitingOf,
} from "./apply-now.ts";
import { aircraftWithLivePrOf, canceledKeysOf, liveFlightsOf, standHoldersOf } from "./canceled-flight.ts";
import { config } from "./config.ts";
import { applyControlFactsOf, applyNowControl, type ActDeps, type FactDeps } from "./control-recycle-run.ts";
import { loadDispatchConfig } from "./dispatch.ts";
import { loadFleet } from "./fleet.ts";
import { FLEET_PLAN_DEFAULTS } from "./fleet-plan.ts";
import { inputsOf, moveAircraftAccount } from "./fleet-plan-run.ts";
import { effectiveLaunchAccount, launchSettingOf } from "./launch-account.ts";
import type { Snapshot } from "./model.ts";
import { fromThisApp } from "./origin.ts";
import { record } from "./recorder.ts";
import { regKey } from "./registration.ts";
import { accountStatusesOf, agentRowsOf, liveRowsOf } from "./session-control.ts";

// LAUNCH ACCOUNT APPLY NOW(ATC-244). 계획은 apply-now.ts(순수). 여기는 사실을 읽고, 한 번에 한 세션씩 STOP → LAUNCH하고, 기다릴 것을 기억한다.
// 새로 세션을 멈추는 길은 없다: AIRCRAFT는 ACCOUNT CHANGE의 실행(moveAircraftAccount), 관제 세션은 CONTROL RECYCLE의 performRecycle이다.

const PENDING_FILE = () => join(config.stateDir, "apply-now.json");
export function readPending(file = PENDING_FILE()): ApplyPending | null {
  try {
    return pendingOfFile(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}
function writePending(p: ApplyPending | null, file = PENDING_FILE()) {
  if (!p) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(p, null, 2) + "\n");
  renameSync(tmp, file);
}

type Launch = { aircraft: string | null; control: string | null };
const launchAccountNow = (): Launch => {
  const folders = accountFolders();
  const reg = observedLabelsOn(folders) ? folders.map((f) => f.label) : [];
  const setting = launchSettingOf(loadFleet().launchAccount);
  return { aircraft: effectiveLaunchAccount(setting, "aircraft", reg).label, control: effectiveLaunchAccount(setting, "control", reg).label };
};

// 지금 계획: 사실을 새로 읽는다(claude agents, 스냅샷, 안전 조건)
export async function planNow(s: Snapshot, facts: FactDeps): Promise<{ launchAccount: Launch; rows: ApplyRow[] }> {
  const now = Date.now();
  const launchAccount = launchAccountNow();
  const folders = accountFolders();
  const read = await agentRowsOf(folders).catch(() => ({ rows: [], failed: [] as string[] }));
  const rows = liveRowsOf(read.rows);
  const statuses = await accountStatusesOf(s.fuelAccounts, folders, now);
  const targets: ApplyTarget[] = folders.map((f) => {
    const st = statuses.get(f.label);
    return {
      label: f.label,
      refused: read.failed.includes(f.label) ? "세션 목록을 읽지 못함" : st?.loggedIn === false ? "로그인되어 있지 않음" : st?.hold ? `FUEL hold 수준: ${st.hold}` : null,
      maxLaunched: f.maxLaunched ?? null,
      running: rows.filter((r) => r.kind === "background" && r.account === f.label).length,
    };
  });
  const inputs = inputsOf(s, rows, now, []);
  const assigned = new Set(inputs.plan.assign.map((p) => regKey(p.aircraftName)));
  // 취소된 FLIGHT는 AIRCRAFT를 붙들지 않는다(ATC-460): 그 STAND 점유와 열린 PR은 진행 중으로 세지 않는다
  const canceled = canceledKeysOf(s.tickets);
  const nameOf = new Map(s.sessions.map((x) => [x.id, regKey(x.name, loadDispatchConfig().teamPattern)]));
  const livePr = aircraftWithLivePrOf(s.pulls ?? [], standHoldersOf(s.claims, (id) => nameOf.get(id)), canceled);
  const aircraft: ApplyAircraft[] = inputs.aircraft.map((a) => {
    const fact = inputs.sessions.find((x) => regKey(x.registration) === a.registration);
    const row = rows.find((r) => regKey(r.name, loadDispatchConfig().teamPattern) === a.registration);
    const d = inputs.dwell.get(a.registration);
    return {
      registration: a.registration,
      current: row?.account ?? a.observedAccount ?? a.account ?? null,
      session: !fact ? null : (fact.origin ?? (fact.kind === "background" ? "background" : "other")) === "background" ? "background" : "other",
      idle: a.status === "idle",
      retired: !!a.retired,
      aog: !!a.aog,
      flights: liveFlightsOf([...a.flying, ...a.flights.map((f) => f.key)], canceled),
      openPr: livePr.has(a.registration),
      assigned: assigned.has(a.registration),
      launchedRecently: d?.op === "launch" && now - Date.parse(d.at) < FLEET_PLAN_DEFAULTS.minDwellMin * 60_000,
      limitCut: a.health?.code === "LIMIT" && !!a.health.cut,
    };
  });
  const control = await applyControlFactsOf(s, facts, rows);
  return { launchAccount, rows: applyNowPlanOf({ aircraft, control, launchAccount, targets }) };
}

// ── 실행(순수한 흐름, 입출력은 deps): 한 번에 한 세션. 매번 계획을 새로 읽어 move-now인 것만, 첫 거절·실패에서 멈춘다 ──
export interface ApplyDeps {
  plan: () => Promise<ApplyRow[]>;
  move: (r: ApplyRow) => Promise<{ ok: boolean; error?: string; jobId?: string }>;
}
export interface ApplyResult {
  rows: ApplyRow[]; // 마지막으로 읽은 계획(옮긴 세션은 이미 빠졌을 수 있다)
  results: Record<string, { ok: boolean; error?: string; jobId?: string }>; // "aircraft|TEAM_H"
  stoppedAt: string | null; // 실패해서 나머지를 멈춘 행
}
export async function runApplyRows(deps: ApplyDeps, kinds: { aircraft: boolean; control: boolean }): Promise<ApplyResult> {
  const results: ApplyResult["results"] = {};
  let rows: ApplyRow[] = [];
  let stoppedAt: string | null = null;
  for (;;) {
    rows = (await deps.plan()).filter((r) => kinds[r.kind]);
    const next = rows.find((r) => r.action === "move-now" && !results[`${r.kind}|${r.name}`]);
    if (!next) break;
    const key = `${next.kind}|${next.name}`;
    results[key] = await deps.move(next);
    if (!results[key].ok) {
      stoppedAt = key;
      break;
    }
  }
  return { rows, results, stoppedAt };
}

let running = false;
export const applyNowRunning = () => running;

export function mountApplyNow(app: Hono, getSnapshot: () => Promise<Snapshot>, deps: { facts: FactDeps; act: ActDeps }) {
  const depsOf = (by: string): ApplyDeps => ({
    plan: async () => (await planNow(await getSnapshot(), deps.facts)).rows,
    move: (r) => (r.kind === "aircraft" ? moveAircraftAccount(r.name, r.to, by, getSnapshot) : applyNowControl(deps.act, r.name, r.to, by)),
  });
  const summary = (by: string, l: Launch, c: ApplyCounts, note?: string) =>
    record({ t: new Date().toISOString(), kind: "apply-now", op: "apply", by, aircraft: l.aircraft, control: l.control, ...c, ...(note ? { note } : {}) });

  // 계획(읽기만)과 기다리는 중인 APPLY
  app.get("/api/fleet/apply-now", async (c) => {
    const { launchAccount, rows } = await planNow(await getSnapshot(), deps.facts);
    const pending = pendingLiveOf(readPending(), launchAccount, Date.now());
    return c.json({ launchAccount, rows, pending: pending ? { ...pending, at: readPending()?.at ?? null } : null, running, duty: "DUTY는 멈추지 않는다 — 자기 블록에서 ACCOUNT를 바꾼다" });
  });

  // 실행. SUPERVISOR만(이 화면 Origin·JSON). 본문의 launchAccount가 지금 설정과 같아야 한다: 화면에서 확인한 것만 한다
  app.post("/api/fleet/apply-now", async (c: Context) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    if (running) return c.json({ error: "APPLY NOW가 이미 실행 중" }, 409);
    const body = (await c.req.json().catch(() => null)) as { confirm?: unknown; launchAccount?: Partial<Launch> } | null;
    const now = launchAccountNow();
    if (body?.confirm !== true) return c.json({ error: "confirm: true가 필요함 — 화면의 확인 창에서 누른다" }, 400);
    if ((body.launchAccount?.aircraft ?? null) !== now.aircraft || (body.launchAccount?.control ?? null) !== now.control) return c.json({ error: "LAUNCH ACCOUNT가 확인한 뒤 바뀜 — 다시 확인한다" }, 409);
    if (!now.aircraft && !now.control) return c.json({ error: "LAUNCH ACCOUNT가 없음(각 home) — 옮길 곳이 없다" }, 409);
    running = true;
    try {
      const by = "SUPERVISOR";
      const r = await runApplyRows(depsOf(by), { aircraft: !!now.aircraft, control: !!now.control });
      const waiting = waitingOf(r.rows);
      // 기다릴 행이 있으면 그 종류만 pending(설정이 바뀌거나 24시간 지나면 끝). 없으면 옛 pending도 지운다
      const pend: ApplyPending = {
        at: new Date().toISOString(),
        aircraft: waiting.some((w) => w.kind === "aircraft") ? now.aircraft : null,
        control: waiting.some((w) => w.kind === "control") ? now.control : null,
      };
      writePending(pend.aircraft || pend.control ? pend : null);
      const counts = countsOf(r.rows, r.results);
      summary(by, now, counts, r.stoppedAt ? `멈춤: ${r.stoppedAt} — ${r.results[r.stoppedAt].error ?? "실패"}` : undefined);
      return c.json({ ok: !r.stoppedAt, ...r, pending: pend.aircraft || pend.control ? pend : null, counts });
    } finally {
      running = false;
    }
  });

  // 기다리는 APPLY를 취소한다(SUPERVISOR만). 이미 옮긴 세션은 그대로
  app.delete("/api/fleet/apply-now/pending", async (c: Context) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    if (readPending()) record({ t: new Date().toISOString(), kind: "apply-now", op: "pending-end", by: "SUPERVISOR", aircraft: null, control: null, moved: 0, failed: 0, waiting: 0, skipped: 0, note: "cancelled" });
    writePending(null);
    return c.json({ ok: true });
  });

  // 1분마다(RECYCLE 주기와 같이): 기다리는 APPLY가 있으면 이제 안전해진 세션을 옮긴다. 설정이 바뀌었거나 24시간이 지났으면 끝낸다
  return {
    tick: async () => {
      const p = readPending();
      if (!p || running) return;
      const live = pendingLiveOf(p, launchAccountNow(), Date.now());
      if (!live) {
        record({ t: new Date().toISOString(), kind: "apply-now", op: "pending-end", by: "atc", aircraft: p.aircraft, control: p.control, moved: 0, failed: 0, waiting: 0, skipped: 0, note: "expired or LAUNCH ACCOUNT changed" });
        writePending(null);
        return;
      }
      running = true;
      try {
        const by = "APPLY NOW (pending)";
        const r = await runApplyRows(depsOf(by), { aircraft: !!live.aircraft, control: !!live.control });
        if (Object.keys(r.results).length) summary(by, launchAccountNow(), countsOf(r.rows, r.results));
        const waiting = waitingOf(r.rows);
        if (!waiting.length || r.stoppedAt) {
          // 더 기다릴 것이 없거나(또는 실패로 멈춤 — 다시 누를 때까지 자동으로 이어 가지 않는다) pending을 끝낸다
          record({ t: new Date().toISOString(), kind: "apply-now", op: "pending-end", by: "atc", aircraft: live.aircraft, control: live.control, moved: 0, failed: 0, waiting: waiting.length, skipped: 0, note: r.stoppedAt ? `stopped at ${r.stoppedAt}` : "done" });
          writePending(null);
        }
      } catch (e) {
        console.error("[atc] apply-now pending failed:", e);
      } finally {
        running = false;
      }
    },
  };
}

import type { Context, Hono } from "hono";
import { accountFolders, observedLabelsOn } from "./accounts.ts";
import type { ApplyTarget } from "./apply-now.ts";
import {
  type BulkOp,
  type BulkResult,
  type BulkRow,
  type BulkSession,
  bulkCountsOf,
  bulkOpOk,
  bulkPlanOf,
  bulkRunOrderOf,
  driftOf,
  expectMismatch,
  heldOf,
  intendedAccountOf,
} from "./control-bulk.ts";
import { type ActDeps, applyNowControl, type FactDeps, recyclingNow, safeFactsOf } from "./control-recycle-run.ts";
import { jobIdle, safeBlocksOf } from "./control-recycle.ts";
import { config } from "./config.ts";
import { loadFleet } from "./fleet.ts";
import { effectiveLaunchAccount, launchSettingOf } from "./launch-account.ts";
import { readJob, settleJob } from "./job-state.ts";
import type { Snapshot } from "./model.ts";
import { fromThisApp } from "./origin.ts";
import { record } from "./recorder.ts";
import { accountStatusesOf, agentRowsOf, CONTROL_SESSIONS, controlDirOf, controlRowsOf, parentPidOf, tmuxBin, tmuxPaneOf, tmuxPanes } from "./session-control.ts";

// CONTROL SESSIONS 일괄 동작(ATC-255). 계획은 control-bulk.ts(순수). 여기는 사실을 읽고, 한 번에 한 세션씩 FLEET의 LAUNCH·STOP 버튼과 같은 함수로 하고, 요약을 FLIGHT RECORDER에 남긴다.
// SUPERVISOR만(이 화면 Origin·JSON). 화면이 미리 본 행동(expect)과 지금 계획이 다른 세션은 하지 않는다. 새로 세션을 보내거나 조종하는 길은 없다.

// 사실: 관제 세션마다 떠 있는 모양·지금 ACCOUNT·intended ACCOUNT·지금 멈추면 잃는 것, ACCOUNT마다 받을 수 있는지
export async function bulkFactsOf(s: Snapshot, facts: FactDeps): Promise<{ sessions: BulkSession[]; targets: ApplyTarget[] }> {
  const folders = accountFolders();
  const labels = observedLabelsOn(folders) ? folders.map((f) => f.label) : [];
  const read = await agentRowsOf(folders); // 못 읽으면 던진다: 이미 떠 있는지 모르는 채 띄우거나 멈추지 않는다
  const fleet = loadFleet();
  const preferred = effectiveLaunchAccount(launchSettingOf(fleet.launchAccount), "control", labels).label;
  const defaultLabel = folders.find((f) => f.dir === config.claudeDir)?.label ?? null;
  const specs = CONTROL_SESSIONS.filter((x) => x.launch === "bg");
  const anyLive = specs.some((x) => controlRowsOf(x, read.rows, controlDirOf(x)).length > 0);
  const safe = anyLive ? await safeFactsOf(s, facts).catch(() => null) : null;
  const panes = anyLive ? await tmuxPanes(tmuxBin() ?? "tmux") : [];
  const sessions: BulkSession[] = specs.map((spec) => {
    const live = controlRowsOf(spec, read.rows, controlDirOf(spec));
    const bg = live.find((r) => r.kind === "background" && r.id);
    const tmux = bg ? null : live.find((r) => tmuxPaneOf(r.pid, panes, parentPidOf));
    const kind = bg ? "background" : tmux ? "tmux" : live.length ? "other" : null;
    const job = bg ? (settleJob(readJob(bg.id)) ?? null) : null;
    const blocks = kind
      ? [
          ...(bg && !jobIdle(job) ? [`턴 사이가 아님(job ${job ? `${job.state}/${job.tempo ?? "?"}` : "?"})`] : []),
          ...safeBlocksOf(spec.name, safe),
          ...(recyclingNow() && recyclingNow() !== spec.name ? [`${recyclingNow()}가 재시작 중`] : []),
        ]
      : [];
    const home = fleet.control?.[spec.name as keyof NonNullable<typeof fleet.control>]?.account ?? null;
    return { name: spec.name, live: kind, current: (bg ?? live[0])?.account ?? null, intended: intendedAccountOf({ labels, defaultLabel, preferred, home }), blocks };
  });
  const statuses = await accountStatusesOf(s.fuelAccounts, folders);
  const bgRows = read.rows.filter((r) => !r.stale && r.kind === "background");
  const targets: ApplyTarget[] = labels.length
    ? folders.map((f) => {
        const st = statuses.get(f.label);
        return {
          label: f.label,
          refused: read.failed.includes(f.label) ? "세션 목록을 읽지 못함" : st?.loggedIn === false ? "로그인되어 있지 않음" : st?.hold ? `FUEL hold 수준: ${st.hold}` : null,
          maxLaunched: f.maxLaunched ?? null,
          running: bgRows.filter((r) => r.account === f.label).length,
        };
      })
    : [];
  return { sessions, targets };
}

// ── 실행(흐름만, 입출력은 deps) ──
export interface BulkDeps {
  launch: (name: string, to: string | null) => Promise<{ ok: boolean; error?: string; jobId?: string }>;
  stop: (name: string) => Promise<{ ok: boolean; error?: string; jobId?: string }>;
  restart: (name: string, to: string | null) => Promise<{ ok: boolean; error?: string; jobId?: string }>;
}

// 계획 순서대로(STOP은 거꾸로) 한 세션씩. 계획이 바뀐 행·held(force가 아닐 때)는 하지 않는다.
// LAUNCH·RESTART·ALIGN은 첫 실패에서 나머지를 멈춘다(순서가 있는 일이라 뒤를 이어 가지 않는다). STOP은 실패해도 나머지를 내린다
export async function runBulkRows(deps: BulkDeps, op: BulkOp, rows: readonly BulkRow[], expect: Readonly<Record<string, unknown>>, force: boolean): Promise<BulkResult[]> {
  const changed = new Set(expectMismatch(rows, expect));
  const results: BulkResult[] = [];
  let halted: string | null = null;
  for (const r of bulkRunOrderOf(op, rows)) {
    const base = { name: r.name, action: r.action, from: r.from, to: r.to };
    if (changed.has(r.name)) {
      results.push({ ...base, ok: false, skipped: "미리 본 뒤 계획이 바뀜 — 다시 미리 본다" });
      continue;
    }
    if (heldOf(r) && !force) {
      results.push({ ...base, ok: false, held: true, skipped: `안전하지 않음: ${r.blocks.join("; ")}` });
      continue;
    }
    if (halted) {
      results.push({ ...base, ok: false, skipped: `${halted}가 실패해 멈춤` });
      continue;
    }
    const x = r.action === "launch" ? await deps.launch(r.name, r.to) : r.action === "stop" ? await deps.stop(r.name) : await deps.restart(r.name, r.to);
    results.push({ ...base, ok: x.ok, ...(x.jobId ? { jobId: x.jobId } : {}), ...(x.error ? { error: x.error } : {}) });
    if (!x.ok && op !== "stop") halted = r.name;
  }
  return results;
}

let running = false;
export const bulkRunning = () => running;

// act: by가 SUPERVISOR인 ActDeps(defaultActDeps(…, "SUPERVISOR")). launchControl·stopControl을 여기서 부르지 않고 index.ts가 넘긴 것으로 한다
export function mountControlBulk(app: Hono, getSnapshot: () => Promise<Snapshot>, deps: { facts: FactDeps; act: ActDeps }) {
  const planOf = async (op: BulkOp) => {
    const { sessions, targets } = await bulkFactsOf(await getSnapshot(), deps.facts);
    return { rows: bulkPlanOf({ op, sessions, targets }), drift: sessions.filter(driftOf).map((x) => ({ name: x.name, from: x.current, to: x.intended })) };
  };

  // 미리 보기(읽기만): 순서·세션마다 행동·이유·ACCOUNT drift. op: launch | restart | stop | align
  app.get("/api/control/bulk", async (c) => {
    const op = c.req.query("op");
    if (!bulkOpOk(op)) return c.json({ error: "op는 launch | restart | stop | align" }, 400);
    try {
      return c.json({ op, running, ...(await planOf(op)) });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
  });

  // 실행. 본문 { op, expect: { 이름: 행동 }, force? }: 화면에서 미리 본 것만 한다
  app.post("/api/control/bulk", async (c: Context) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const body = (await c.req.json().catch(() => null)) as { op?: unknown; expect?: unknown; force?: unknown } | null;
    if (!body || !bulkOpOk(body.op)) return c.json({ error: "op는 launch | restart | stop | align" }, 400);
    if (!body.expect || typeof body.expect !== "object" || Array.isArray(body.expect)) return c.json({ error: "expect는 미리 본 { 이름: 행동 } — 먼저 미리 본다" }, 400);
    if (running) return c.json({ error: "CONTROL BULK가 이미 실행 중" }, 409);
    const op = body.op;
    const force = body.force === true;
    running = true;
    try {
      const by = "SUPERVISOR";
      const { rows } = await planOf(op);
      const results = await runBulkRows(
        {
          launch: (name, to) => deps.act.launch(name, to ?? undefined),
          stop: (name) => deps.act.stop(name),
          restart: (name, to) => applyNowControl(deps.act, name, to, by, `CONTROL BULK ${op.toUpperCase()}`),
        },
        op,
        rows,
        body.expect as Record<string, unknown>,
        force,
      );
      const n = bulkCountsOf(results);
      record({ t: new Date().toISOString(), kind: "control", op: "bulk", by, bulk: op, force, ok: n.failed === 0, ...n, results });
      console.log(`[atc] control bulk ${op}: done ${n.done} failed ${n.failed} held ${n.held} skipped ${n.skipped}`);
      return c.json({ ok: n.failed === 0, op, force, ...n, results });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
    } finally {
      running = false;
    }
  });
}

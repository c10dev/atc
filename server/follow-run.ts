// FOLLOW의 길(docs/follow.md 5장). GET /api/follow는 읽기만 한다 — 스냅샷과 이미 있는 읽기 길(제안, OOOI, FLIGHT FOLLOWING, DISPATCH 계획)에서
// 합치고 GitHub·Linear를 따로 부르지 않으며 아무것도 쓰지 않는다. POST /api/follow {parent, on}은 이 화면에서 온 요청만(fromThisApp) 받아
// follow.json(설정, 따라가는 상위 이슈 key만)을 바꿔 쓴다. 아무 권한도 주지 않는다.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { applyGroundStops } from "./atfm.ts";
import { config } from "./config.ts";
import { landedOf, loadDispatchConfig, mccAirportNow, planDispatch, readFlightHistory } from "./dispatch.ts";
import { arrowsBundleOf, type FollowFile, FOLLOW_STAGES, followBoardOf, parseFollowBody, parseFollowFile, toggleParent } from "./follow.ts";
import { followingNow } from "./following.ts";
import { loadFleet } from "./fleet.ts";
import { loadLogbook } from "./logbook.ts";
import { loadMcc } from "./mcc.ts";
import { readReleaseView } from "./release-store.ts";
import { mccLandInfoCached } from "./mcc-run.ts";
import { milestonesNow, progressNow } from "./milestones-run.ts";
import type { Snapshot } from "./model.ts";
import { fromThisApp } from "./origin.ts";
import { filesInFlight } from "./overlap-run.ts";
import { allProposals, reservedOf } from "./proposals.ts";
import { activeWaypointsOf } from "./routes.ts";
import { readLinearProjects } from "./sources/linear-projects.ts";

const FILE = () => join(config.stateDir, "follow.json");

export function loadFollow(file = FILE()): FollowFile {
  try {
    return parseFollowFile(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return { parents: [] };
  }
}

// 원자적으로 바꿔 쓴다(임시 파일 → rename)
export function saveFollow(f: FollowFile, file = FILE()) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(f, null, 2) + "\n");
  renameSync(tmp, file);
}

export function followNow(s: Snapshot, now = Date.now()) {
  const parents = loadFollow().parents;
  const proposals = allProposals();
  const milestones = milestonesNow(s, now);
  const logbook = loadLogbook();
  const mccAirport = loadMcc().airport;
  // MCC AIRPORT가 아닌 곳의 FLIGHT는 배포 단계가 없다. 어느 AIRPORT인지 모르면 있는 것으로 둔다
  const noDeploy = new Set<string>();
  const airportOf = (repo: string) => s.airports.find((a) => a.repo === repo)?.code ?? null;
  for (const e of logbook) if (e.flight && e.pr && e.airport && e.airport !== mccAirport) noDeploy.add(e.flight);
  for (const p of s.pulls) {
    const code = airportOf(p.repo);
    if (p.ticketKey && code && code !== mccAirport) noDeploy.add(p.ticketKey);
  }
  let plan = null;
  try {
    const cfg = loadDispatchConfig();
    plan = applyGroundStops(planDispatch(s, readFlightHistory(), cfg, now, reservedOf(proposals, now), loadFleet(), landedOf(logbook), logbook, activeWaypointsOf(readLinearProjects().milestones), filesInFlight(), undefined, mccAirportNow()), s.atfm?.groundStops ?? []);
  } catch {
    plan = null; // 계획을 못 만들어도 보드는 그린다(Todo 사유만 비운다)
  }
  // MCC AIRPORT에서 SUPERVISOR가 머지할 PR(캐시된 등급만 읽는다, GitHub를 부르지 않는다). 등급을 모르면 merge 칩을 내지 않는다
  const land = mccLandInfoCached(s);
  const userPulls = new Set<number>(land ? [...land.tiers].filter(([, v]) => v.tier === "user").map(([n]) => n).concat(land.escalated) : []);
  const rest = {
    tickets: s.tickets,
    proposals,
    pulls: s.pulls,
    clearances: s.clearances ?? [],
    milestones,
    following: followingNow(s, now),
    progress: progressNow(s, milestones, now),
    plan,
    noDeploy,
    userPulls,
    airports: s.airports.map((a) => ({ code: a.code, repo: a.repo })),
    now,
  };
  const manual = followBoardOf({ parents, ...rest });
  // ATC-382: 발권한 FLIGHT는 FOLLOW 클릭 없이 따라간다(SUPERVISOR의 화살표). 손으로 따라가는 번들에 이미 줄이 있는 FLIGHT는 거기에만 둔다
  const held = new Set(manual.flatMap((b) => b.rows.map((r) => r.key)));
  let arrows = null;
  try {
    const released = Object.values(readReleaseView().records).filter((r) => !held.has(r.flight)).map((r) => ({ flight: r.flight, at: r.at }));
    arrows = released.length ? arrowsBundleOf(released, rest) : null;
  } catch {
    arrows = null; // 발권 기록을 못 읽어도 손으로 따라가는 번들은 그대로
  }
  const bundles = arrows ? [arrows, ...manual] : manual;
  const next = bundles.reduce((n, b) => n + b.next, 0); // 머리 NEXT n: 따라가는 모든 번들의 다음 할 일 수
  return { at: new Date(now).toISOString(), dispatchMode: loadDispatchConfig().mode, linear: s.linear.fetchedAt, stages: [...FOLLOW_STAGES], parents, bundles, next };
}

export function mountFollow(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  app.get("/api/follow", async (c) => c.json(followNow(await getSnapshot())));
  // 가벼운 목록(FLIGHT 서랍의 FOLLOW 토글이 쓴다): 보드를 셈하지 않는다
  app.get("/api/follow/list", (c) => c.json(loadFollow()));
  app.post("/api/follow", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다(SUPERVISOR 전용)" }, 403);
    const parsed = parseFollowBody(await c.req.json().catch(() => null), config.linearTeamKeys);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const next = toggleParent(loadFollow(), parsed.parent, parsed.on);
    saveFollow(next);
    return c.json({ ok: true, parents: next.parents });
  });
}

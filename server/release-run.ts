// 발권 기록의 길(ATC-362, docs/autonomy.md 원칙 1·10). 판정은 release.ts(순수), 파일은 release-store.ts.
// - GET  /api/releases              기록, gate 상태, 발권 없는 FLIGHT 목록, 세션별 attested 수(읽기만)
// - POST /api/releases              {flight, hash?}  화면 클릭 한 건. 이 화면에서 온 요청만(fromThisApp, 아니면 403): agent·CLI·curl은 Origin이 없어 만들 수 없다
// - POST /api/releases/fire         {flight, hash?}  READY Backlog FLIGHT, PARKED 이슈(ATC-487, releaseParked 스위치)나 아직 쏘지 않은 제안(ATC-401): Todo로 옮기고 screen 발권을 한 요청으로 적는다(우선순위가 없으면 옮기지 않는다). 같은 Origin 검사
// - POST /api/releases/discard      {flight, hash?, reason?}  아직 쏘지 않은 제안을 Canceled로 옮기고 사유를 이슈 댓글로 남긴다(ATC-401). 같은 Origin 검사
// - POST /api/releases/bulk         {flights: [{key, hash}]}  일괄 확인(이미 Todo에 있는 FLIGHT). 같은 Origin 검사. 이 줄부터 gate가 켜진다(arm)
// - POST /api/releases/attest       {flight, session, words}  다른 세션에 한 SUPERVISOR의 말을 그 세션이 증언. attested로 표시한다
// - releaseFromChat(text)           DUTY 채팅에 SUPERVISOR가 직접 쓴 글(Origin 검사를 거친 /api/duty/message)에서 `RELEASE ATC-n`·`발권 ATC-n` 줄을 읽는다
// 서버는 스스로 발권하지 않는다: 스케줄러·주기·후크는 이 길을 부르지 않는다.
import type { Context, Hono } from "hono";
import { isReady } from "./detail.ts";
import { candidateTeamsOf, isCandidateTicket, loadDispatchConfig } from "./dispatch.ts";
import { type K3Status, k3StatusOf } from "./k3-allow.ts";
import { k3MisfiresNow } from "./k3-hold-run.ts";
import { k3RelaunchMisfiresNow } from "./k3-relaunch-run.ts";
import type { K3RelaunchMisfires } from "./k3-relaunch.ts";
import { moveFlight } from "./flight-state-run.ts";
import { type Snapshot, type Ticket, parentKeysOf } from "./model.ts";
import { fromThisApp } from "./origin.ts";
import {
  attestedCounts,
  attestedRelease,
  bulkTargets,
  kEffectsOf,
  chatRelease,
  chatReleaseKeys,
  kConfirmOf,
  kPendingOf,
  foldReleases,
  releaseGateOn,
  releaseStateOf,
  screenRelease,
  type ReleaseGateMode,
  type ReleaseLine,
} from "./release.ts";
import { classOf } from "./crew.ts";
import { filesInFlight } from "./overlap-run.ts";
import type { FilesInFlight } from "./dispatch.ts";
import { appendReleaseLines, readReleaseLines } from "./release-store.ts";
import { releaseTreeOf, type TreeRow } from "./release-tree.ts";
import { releaseQueueOf } from "./release-queue.ts";
import { parkedFireVerdict, parkedMisfiresOf, parkedOf } from "./release-parked.ts";
import { possibleDuplicateOf, twinAlreadyFired } from "./title-dup.ts";
import { duplicateCountsNow, duplicateTitleOn } from "./title-dup-run.ts";
import { record } from "./recorder.ts";
import { loadScheduleOps, type NewPayload } from "./schedule.ts";
import { readReviewLines } from "./duty-review-store.ts";
import { bustQueue } from "./queue-bust.ts";
import { filedProposalsOf, type ProposalSource, proposalSourcesOf } from "./release-proposals.ts";
import { createDutyComment, fetchDutyIssue } from "./sources/linear-write.ts";

const BODY_MAX = 64 * 1024;

export interface ReleaseDeps {
  snapshot: () => Promise<Snapshot>;
  lines: () => ReleaseLine[];
  append: (lines: readonly ReleaseLine[]) => void;
  now: () => Date;
  gateMode: () => ReleaseGateMode;
  teams: () => Set<string>;
  // 선택(시험이 비워 둔다): 열린 SCHEDULE NEW 초안, Backlog → Todo 옮기기(Linear 쓰기)
  proposals?: () => ReleaseProposal[];
  moveToTodo?: (key: string, from: string) => Promise<{ ok: true } | { ok: false; status: 400 | 403 | 404 | 409 | 502 | 503; error: string }>;
  // 제안(ATC-401): atc가 Backlog에 올린 이슈의 출처(DUTY REVIEW·SCHEDULE NEW), 버리기(Canceled로 옮기고 사유를 이슈에 남긴다)
  proposalSources?: () => Map<string, ProposalSource>;
  discard?: (key: string, from: string, reason: string) => Promise<MoveOutcome & { warning?: string }>;
  files?: () => FilesInFlight | null; // 파일 겹침 자료(ATC-456 같은 파일 칸). 시험이 채운다(없으면 DISPATCH가 모은 캐시)
  parkedOn?: () => boolean; // PARKED 스위치(releaseParked). 시험이 채운다(없으면 dispatch.json)
  duplicateOn?: () => boolean; // 비슷한 제목 표시 스위치(duplicateTitle, ATC-488). 시험이 채운다
  duplicateCounts?: () => { refused: number; overrides: number; bothFired: number }; // 시험이 채운다(없으면 기록에서 센다)
  recordLine?: typeof record; // 시험이 채운다(없으면 recorder)
  k3RelaunchMisfires?: () => K3RelaunchMisfires; // 시험이 채운다(없으면 FLEET PLAN 카드와 기록에서 센다)
  k3Misfires?: (s: Snapshot) => { nuisance: string[]; miss: { flight: string; aircraft: string; t: string }[]; waits?: { flight: string; id: string; t: string }[] }; // 시험이 채운다(없으면 기록과 세션에서 센다)
}
type MoveOutcome = { ok: true } | { ok: false; status: 400 | 403 | 404 | 409 | 502 | 503; error: string };
export const DISCARD_REASON_MAX = 500;

// 발권 후보에 오른 에이전트 제안(ATC-376): 아직 이슈가 아니라 발권할 수 없다. 승인은 지금 SCHEDULE에서(ATC-378이 옮긴다)
export interface ReleaseProposal {
  id: string;
  title: string;
  reason: string;
  status: string;
  kEffects: string | null;
  priority: number;
}
const defaultDeps = (snapshot: () => Promise<Snapshot>): ReleaseDeps => ({
  snapshot,
  lines: () => readReleaseLines(),
  append: (l) => appendReleaseLines(l),
  now: () => new Date(),
  gateMode: () => loadDispatchConfig().releaseGate,
  teams: () => candidateTeamsOf(loadDispatchConfig()),
  proposals: () => newProposalsOf(loadScheduleOps()),
  moveToTodo: (key, from) => moveFlight(key, { from, to: "Todo" }),
  proposalSources: () => proposalSourcesOf(readReviewLines(), loadScheduleOps()),
  discard: discardProposal,
});

// 제안 버리기: Canceled로 옮긴 뒤 사유를 이슈 댓글로 남긴다(서버의 Linear 키로). 옮기기가 실패하면 댓글도 없다. 댓글만 실패하면 버려진 것은 그대로고 경고를 준다
async function discardProposal(key: string, from: string, reason: string): Promise<MoveOutcome & { warning?: string }> {
  const moved = await moveFlight(key, { from, to: "Canceled" });
  if (!moved.ok) return moved;
  try {
    const issue = await fetchDutyIssue(key);
    if (!issue) throw new Error(`${key}를 다시 읽지 못함`);
    await createDutyComment(issue.id, `Discarded by the SUPERVISOR from the RELEASE screen. Reason: ${reason}`);
    return { ok: true };
  } catch (e) {
    return { ok: true, warning: `${key}는 Canceled로 옮겼지만 사유 댓글을 남기지 못함: ${String((e as Error).message ?? e).slice(0, 200)}` };
  }
}

// 열린 NEW 초안(결정 전 draft·agreed와 승인 뒤 아직 반영 전 approved·released)
const OPEN_NEW = new Set(["draft", "agreed", "approved", "released"]);
export function newProposalsOf(ops: readonly { id: string; kind: string; status: string; reason: string; payload: unknown }[]): ReleaseProposal[] {
  return ops
    .filter((o) => o.kind === "NEW" && OPEN_NEW.has(o.status))
    .map((o) => {
      const p = o.payload as NewPayload;
      return { id: o.id, title: p.title, reason: o.reason, status: o.status, kEffects: kEffectsOf(p.body), priority: p.priority ?? 0 };
    });
}

// 발권할 수 있는 후보: 후보 팀의 Todo(시작 전)이고 상위 이슈가 아닌 FLIGHT
const candidatesOf = (s: Snapshot, teams: Set<string>) => {
  const parents = parentKeysOf(s.tickets);
  return s.tickets.filter((t) => t.stateType === "unstarted" && isCandidateTicket(t, teams) && !parents.has(t.key));
};

// 발권할 수 있는 READY Backlog FLIGHT: 막는 FLIGHT가 모두 끝난 것(FOLLOW의 `Todo로`와 같은 규칙)
const readyOf = (s: Snapshot, teams: Set<string>) => {
  const parents = parentKeysOf(s.tickets);
  const typeOf = (k: string) => s.tickets.find((x) => x.key === k)?.stateType ?? null;
  return s.tickets.filter((t) => isCandidateTicket(t, teams) && !parents.has(t.key) && isReady(t.stateType, t.blockedBy.map(typeOf)));
};
// K3 줄이 있는 FLIGHT가 클릭 전에 보이는 상태(ATC-398): 선언이 읽히나, 지금 발권이 allow를 주나. 줄이 없으면 null
const k3Of = (t: Ticket, view: ReturnType<typeof foldReleases>): K3Status | null => k3StatusOf({ check: t.k3Check, declared: t.k3, flight: t.key, hash: t.releaseHash, releases: view });
const rowOf = (t: Ticket, view: ReturnType<typeof foldReleases>, state: "ready" | "unreleased" | "stale", why: string | null = null) => ({ key: t.key, why, title: t.title, hash: t.releaseHash ?? null, priority: t.priority, kEffects: t.kEffects ?? null, k3: k3Of(t, view), state });
const WEEK = 7 * 86_400_000;

export function releaseView(s: Snapshot, d: ReleaseDeps) {
  const lines = d.lines();
  const view = foldReleases(lines);
  const cands = candidatesOf(s, d.teams());
  const unreleased = bulkTargets(cands, view).map((t) => {
    const full = cands.find((c) => c.key === t.key)!;
    return rowOf(full, view, releaseStateOf(t.key, t.releaseHash, view) as "unreleased" | "stale", view.revoked?.[t.key]?.reason ?? null);
  });
  // 제안(ATC-401)은 따로 보인다: 막는 이슈가 모두 끝난 제안이 READY에도 오르지 않게 뺀다
  const filed = filedProposalsOf(s.tickets, d.proposalSources?.() ?? new Map(), d.teams()).map((f) => ({ ...f, k3: ((t) => (t ? k3Of(t, view) : null))(s.tickets.find((x) => x.key === f.key)) }));
  const filedKeys = new Set(filed.map((f) => f.key));
  const ready = readyOf(s, d.teams()).filter((t) => !filedKeys.has(t.key)).map((t) => rowOf(t, view, "ready"));
  const titleOf = (k: string) => s.tickets.find((t) => t.key === k)?.title ?? null;
  const records = Object.values(view.records).sort((a, b) => b.at.localeCompare(a.at));
  const since = d.now().getTime() - WEEK;
  const channels = { screen: 0, "duty-chat": 0, attested: 0 };
  for (const r of records) if (Date.parse(r.at) >= since) channels[r.channel]++;
  const recent = records.slice(0, 15).map((r) => ({ key: r.flight, title: titleOf(r.flight), channel: r.channel, at: r.at, via: r.via ?? null, session: r.session ?? null }));
  // K 효과를 선언했는데 attested뿐인 발권(ATC-391): SUPERVISOR가 한 번 눌러야 K 권한이 착륙까지 간다(발권 때의 일). 지금 본문의 해시와 같은 발권만
  const ticketOf = (k: string) => s.tickets.find((t) => t.key === k);
  const kPending = kPendingOf(view, (k) => Boolean(ticketOf(k)?.k3?.length) && ticketOf(k)?.releaseHash === view.records[k]?.hash).map((r) => ({
    key: r.flight,
    title: titleOf(r.flight),
    hash: r.hash,
    at: r.at,
    session: r.session ?? null,
    words: r.words ?? null,
    kEffects: ticketOf(r.flight)?.kEffects ?? null,
  }));
  // 순서(ATC-456): 상위 이슈마다 나무. 읽기만 한다
  const filedBy = new Map(filed.map((f) => [f.key, f]));
  const parents = parentKeysOf(s.tickets);
  const openPr = new Set((s.pulls ?? []).filter((p) => p.ticketKey).map((p) => p.ticketKey as string));
  // PARKED 이슈 key(나무의 줄이 아니라 이 화면의 다른 구역): 기다리는 줄이 "막는 이슈가 PARKED에 있다"고 말한다(ATC-488)
  const parkedOn = d.parkedOn ? d.parkedOn() : loadDispatchConfig().releaseParked !== "off";
  const parkedKeys = new Set(parkedOn ? parkedOf({ tickets: s.tickets, teams: d.teams(), filed: filedKeys }).map((r) => r.key) : []);
  const tree = releaseTreeOf({
    tickets: s.tickets,
    parked: parkedKeys,
    candidate: (t) => isCandidateTicket(t, d.teams()) && !parents.has(t.key),
    filed: filedKeys,
    released: (k) => releaseStateOf(k, ticketOf(k)?.releaseHash, view) === "released",
    stageOf: (t) => (openPr.has(t.key) ? "PR" : null),
    wakeOf: (t) => classOf(t.labels).wake,
    files: d.files ? d.files() : filesInFlight(),
    extra: (t) => ({ hash: t.releaseHash ?? null, kEffects: t.kEffects ?? null, k3: k3Of(t, view), filed: filedBy.get(t.key) ? { by: filedBy.get(t.key)!.by, at: filedBy.get(t.key)!.at } : null, why: view.revoked?.[t.key]?.reason ?? null, stale: releaseStateOf(t.key, t.releaseHash, view) === "stale" }),
  });
  // PARKED(ATC-487): 나무에도 제안에도 없는 후보 팀의 Backlog 이슈. 스위치가 꺼지면 절이 없다. 읽기만 한다
  const inTree = new Set<string>();
  const walk = (rows: readonly TreeRow<unknown>[]) => rows.forEach((r) => (inTree.add(r.key), walk(r.children)));
  for (const g of tree.groups) walk(g.rows);
  // 비슷한 제목 표시(ATC-488): 정보일 뿐이다. 스위치(duplicateTitle)가 꺼지면 표시도 세기도 없다
  const dupOn = d.duplicateOn ? d.duplicateOn() : duplicateTitleOn();
  const nowMs = d.now().getTime();
  const parked = parkedOn
    ? {
        on: true,
        rows: parkedOf({ tickets: s.tickets, teams: d.teams(), filed: filedKeys, inTree }).map((r) => ({ ...r, k3: ((t) => (t ? k3Of(t, view) : null))(ticketOf(r.key)), duplicateOf: dupOn ? (possibleDuplicateOf(r, s.tickets, nowMs)?.key ?? null) : null })),
        ...parkedMisfiresOf(lines, s.tickets, nowMs),
        duplicate: dupOn ? { on: true, ...(d.duplicateCounts ? d.duplicateCounts() : duplicateCountsNow(nowMs)) } : { on: false, refused: 0, overrides: 0, bothFired: 0 },
      }
    : { on: false, rows: [], fired: 0, misfires: [], duplicate: { on: false, refused: 0, overrides: 0, bothFired: 0 } };
  const released = cands.filter((t) => releaseStateOf(t.key, t.releaseHash, view) === "released").map((t) => ({ key: t.key, ...view.records[t.key]! }));
  const proposals = d.proposals?.() ?? [];
  // 발권 대기열과 순서 지도: 이 화면에서 할 일이 있는 줄을 한 순서로, 남은 이슈의 순서를 상위 이슈·사슬마다 한 줄로. 읽기만 한다
  const queue = releaseQueueOf({
    groups: tree.groups,
    order: tree.order,
    kPending: kPending.map((k) => ({ ...k, k3: ((t) => (t ? k3Of(t, view) : null))(ticketOf(k.key)) })),
    proposals,
    airportOf: (k) => ticketOf(k)?.airport ?? null,
    priorityOf: (k) => ticketOf(k)?.priority ?? 0,
    records,
    now: d.now().getTime(),
  });
  return {
    k3Hold: { mode: loadDispatchConfig().k3Hold ?? "on", ...((m) => ({ nuisance: m.nuisance, miss: m.miss, waits: m.waits ?? [] }))(d.k3Misfires ? d.k3Misfires(s) : k3MisfiresNow(s, loadDispatchConfig().teamPattern)) },
    k3Relaunch: { mode: loadDispatchConfig().k3Relaunch ?? "off", ...(d.k3RelaunchMisfires ? d.k3RelaunchMisfires() : k3RelaunchMisfiresNow(d.now().getTime())) },
    gate: { mode: d.gateMode(), on: releaseGateOn(d.gateMode(), view.armedAt), armedAt: view.armedAt },
    tree: tree.groups,
    ready,
    filed,
    parked,
    proposals,
    unreleased,
    kPending,
    released,
    recent,
    channels,
    attested: attestedCounts(lines),
    queue,
  };
}

// 발권할 수 있는 READY 목록만(GET /api/releases의 ready와 같은 값, NOTICES가 읽는다, ATC-447)
export const releaseReadyNow = (s: Snapshot) => releaseView(s, defaultDeps(async () => s)).ready;

export function mountReleases(app: Hono, snapshot: () => Promise<Snapshot>, deps: ReleaseDeps = defaultDeps(snapshot)) {
  const readBody = async (c: Context): Promise<Record<string, unknown> | null> => {
    const raw = await c.req.text();
    if (raw.length > BODY_MAX) return null;
    try {
      const p = JSON.parse(raw || "{}");
      return p && typeof p === "object" && !Array.isArray(p) ? p : {};
    } catch {
      return null;
    }
  };

  app.get("/api/releases", async (c) => c.json(releaseView(await deps.snapshot(), deps)));

  app.post("/api/releases", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "화면 발권은 이 화면에서 보낸 요청만 받습니다(SUPERVISOR 전용). 다른 길은 /api/releases/attest" }, 403);
    const body = await readBody(c);
    if (!body || typeof body.flight !== "string") return c.json({ error: "flight(FLIGHT key)가 필요함" }, 400);
    const s = await deps.snapshot();
    const r = screenRelease(s.tickets.find((t) => t.key === body.flight), body.flight, body.hash, "click", deps.now());
    if (!r.ok) return c.json({ error: r.error }, r.status);
    deps.append([r.value]);
    return c.json({ release: r.value });
  });

  // READY Backlog FLIGHT 발권(ATC-376): Todo로 옮기고(상태 버튼과 같은 Linear 쓰기 길) 같은 클릭으로 screen 발권을 적는다.
  // 우선순위가 없으면 DISPATCH가 못 배정하므로 옮기지 않는다. 옮기기가 실패하면 발권도 없다
  app.post("/api/releases/fire", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "화면 발권은 이 화면에서 보낸 요청만 받습니다(SUPERVISOR 전용)" }, 403);
    const body = await readBody(c);
    if (!body || typeof body.flight !== "string") return c.json({ error: "flight(FLIGHT key)가 필요함" }, 400);
    const s = await deps.snapshot();
    // 발권할 수 있는 것: READY Backlog FLIGHT와 아직 쏘지 않은 제안(ATC-401)
    const filedKeys = new Set(filedProposalsOf(s.tickets, deps.proposalSources?.() ?? new Map(), deps.teams()).map((f) => f.key));
    let t = [...readyOf(s, deps.teams()), ...s.tickets.filter((x) => filedKeys.has(x.key))].find((x) => x.key === body.flight);
    // PARKED(ATC-487): 막는 이슈 없이 손으로 올린 Backlog 이슈. 스위치가 꺼지면 옛 거절 그대로. 아래 Origin·우선순위·K3 길은 READY와 같다
    let parked = false;
    if (!t) {
      const pv = parkedFireVerdict({ tickets: s.tickets, teams: deps.teams(), filed: filedKeys, on: deps.parkedOn ? deps.parkedOn() : loadDispatchConfig().releaseParked !== "off" }, body.flight);
      if (!pv.ok) return c.json({ error: pv.error }, pv.status);
      t = pv.ticket;
      parked = true;
    }
    if (t.priority <= 0) return c.json({ error: `${t.key}에 우선순위가 없음 — 먼저 FLIGHT 서랍에서 정함(DISPATCH는 우선순위 없는 FLIGHT를 배정하지 않는다)` }, 409);
    const r = screenRelease({ ...t, stateType: "unstarted" }, t.key, body.hash, "click", deps.now());
    if (!r.ok) return c.json({ error: r.error }, r.status);
    if (parked && r.value.op === "release") r.value.parked = true;
    // 비슷한 제목 표시가 있는 PARKED 이슈를 발권하는데 쌍도 이미 발권돼 있으면 둘 다 쏜 것이다(ATC-488 오작동 세기)
    let bothFiredWith: string | null = null;
    if (parked && (deps.duplicateOn ? deps.duplicateOn() : duplicateTitleOn())) {
      const twin = possibleDuplicateOf(t, s.tickets, deps.now().getTime());
      if (twin && twinAlreadyFired(s.tickets.find((x) => x.key === twin.key))) bothFiredWith = twin.key;
    }
    const moved = await (deps.moveToTodo ?? (async () => ({ ok: false as const, status: 503 as const, error: "상태 옮기기 길이 없음" })))(t.key, t.state);
    if (!moved.ok) return c.json({ error: moved.error }, moved.status);
    deps.append([r.value]);
    if (bothFiredWith) (deps.recordLine ?? record)({ t: deps.now().toISOString(), kind: "policy", op: "duplicate-title", event: "both-fired", flight: t.key, of: bothFiredWith });
    bustQueue(); // 제안이 SUPERVISOR QUEUE에서 곧바로 빠진다
    return c.json({ release: r.value, moved: true });
  });

  // 제안 버리기(ATC-401): 아직 쏘지 않은 제안만. Canceled로 옮기고 사유를 이슈에 남겨 목록이 차지 않게 한다. SUPERVISOR 클릭만(Origin)
  app.post("/api/releases/discard", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "버리기는 이 화면에서 보낸 요청만 받습니다(SUPERVISOR 전용)" }, 403);
    const body = await readBody(c);
    if (!body || typeof body.flight !== "string") return c.json({ error: "flight(FLIGHT key)가 필요함" }, 400);
    const reason = typeof body.reason === "string" ? body.reason.replace(/\s+/g, " ").trim().slice(0, DISCARD_REASON_MAX) : "";
    const s = await deps.snapshot();
    const f = filedProposalsOf(s.tickets, deps.proposalSources?.() ?? new Map(), deps.teams()).find((x) => x.key === body.flight);
    if (!f) return c.json({ error: `${body.flight}는 버릴 수 있는 제안이 아님(Backlog에 있고 아직 쏘지 않은 atc의 제안만)` }, 409);
    if (typeof body.hash === "string" && f.hash && body.hash !== f.hash) return c.json({ error: `${f.key}가 화면에 보인 뒤 바뀜 — 새로 고쳐 다시 확인` }, 409);
    const out = await (deps.discard ?? (async () => ({ ok: false as const, status: 503 as const, error: "버리는 길이 없음" })))(f.key, f.state, reason || "no reason given");
    if (!out.ok) return c.json({ error: out.error }, out.status);
    bustQueue();
    return c.json({ discarded: f.key, ...(out.warning ? { warning: out.warning } : {}) });
  });

  app.post("/api/releases/bulk", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "일괄 확인은 이 화면에서 보낸 요청만 받습니다(SUPERVISOR 전용)" }, 403);
    const body = await readBody(c);
    const list = body && Array.isArray(body.flights) ? body.flights : null;
    if (!list || !list.length) return c.json({ error: "flights([{key, hash}])가 필요함 — 화면이 보여 준 목록" }, 400);
    const s = await deps.snapshot();
    const cands = new Map(candidatesOf(s, deps.teams()).map((t) => [t.key, t]));
    const at = deps.now();
    const lines: ReleaseLine[] = [];
    const skipped: { key: string; error: string }[] = [];
    for (const f of list) {
      const item = f && typeof f === "object" ? (f as { key?: unknown; hash?: unknown }) : {};
      const key = typeof item.key === "string" ? item.key : "";
      if (!cands.has(key)) {
        skipped.push({ key, error: `${key || "?"}는 발권할 수 있는 Todo FLIGHT가 아님` });
        continue;
      }
      const r = screenRelease(cands.get(key), key, item.hash, "bulk", at);
      if (r.ok) lines.push(r.value);
      else skipped.push({ key, error: r.error });
    }
    if (!lines.length) return c.json({ error: "발권한 FLIGHT가 없음", skipped }, 409);
    deps.append([...lines, { op: "arm", at: at.toISOString(), flights: lines.length }]);
    return c.json({ released: lines.length, skipped });
  });

  // attested 발권의 K 효과 확인(ATC-391): 화면 클릭 한 번(fromThisApp). 서버가 확인할 수 없는 증언에 SUPERVISOR가 직접 K 권한을 준다 — 발권 때의 일이지 머지 때가 아니다
  app.post("/api/releases/k-confirm", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "K 확인은 이 화면에서 보낸 요청만 받습니다(SUPERVISOR 전용)" }, 403);
    const body = await readBody(c);
    if (!body || typeof body.flight !== "string") return c.json({ error: "flight(FLIGHT key)가 필요함" }, 400);
    const s = await deps.snapshot();
    const t = s.tickets.find((x) => x.key === body.flight);
    const r = kConfirmOf(foldReleases(deps.lines()), body.flight, t?.releaseHash, body.hash, Boolean(t?.k3?.length), deps.now());
    if (!r.ok) return c.json({ error: r.error }, r.status);
    deps.append([r.value]);
    return c.json({ confirm: r.value });
  });

  app.post("/api/releases/attest", async (c) => {
    const body = await readBody(c);
    if (!body) return c.json({ error: "본문은 JSON이어야 합니다" }, 400);
    const s = await deps.snapshot();
    const key = typeof body.flight === "string" ? body.flight : "";
    const r = attestedRelease(s.tickets.find((t) => t.key === key), body, deps.now());
    if (!r.ok) return c.json({ error: r.error }, r.status);
    deps.append([r.value]);
    return c.json({ release: r.value });
  });
}

// DUTY 채팅의 SUPERVISOR 글. 호출하는 곳은 Origin 검사를 거친 /api/duty/message뿐이다. 발권한 key를 돌려준다(없으면 빈 배열)
export async function releaseFromChat(text: string, snapshot: () => Promise<Snapshot>, deps: ReleaseDeps = defaultDeps(snapshot)): Promise<string[]> {
  const keys = chatReleaseKeys(text);
  if (!keys.length) return [];
  const s = await deps.snapshot();
  const lines: ReleaseLine[] = [];
  for (const key of keys) {
    const r = chatRelease(s.tickets.find((t) => t.key === key), key, text, deps.now());
    if (r.ok) lines.push(r.value);
  }
  deps.append(lines);
  return lines.flatMap((l) => (l.op === "release" ? [l.flight] : []));
}

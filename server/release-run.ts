// 발권 기록의 길(ATC-362, docs/autonomy.md 원칙 1·10). 판정은 release.ts(순수), 파일은 release-store.ts.
// - GET  /api/releases              기록, gate 상태, 발권 없는 FLIGHT 목록, 세션별 attested 수(읽기만)
// - POST /api/releases              {flight, hash?}  화면 클릭 한 건. 이 화면에서 온 요청만(fromThisApp, 아니면 403): agent·CLI·curl은 Origin이 없어 만들 수 없다
// - POST /api/releases/bulk         {flights: [{key, hash}]}  일괄 확인(이미 Todo에 있는 FLIGHT). 같은 Origin 검사. 이 줄부터 gate가 켜진다(arm)
// - POST /api/releases/attest       {flight, session, words}  다른 세션에 한 SUPERVISOR의 말을 그 세션이 증언. attested로 표시한다
// - releaseFromChat(text)           DUTY 채팅에 SUPERVISOR가 직접 쓴 글(Origin 검사를 거친 /api/duty/message)에서 `RELEASE ATC-n`·`발권 ATC-n` 줄을 읽는다
// 서버는 스스로 발권하지 않는다: 스케줄러·주기·후크는 이 길을 부르지 않는다.
import type { Context, Hono } from "hono";
import { isReady } from "./detail.ts";
import { candidateTeamsOf, isCandidateTicket, loadDispatchConfig } from "./dispatch.ts";
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
  foldReleases,
  releaseGateOn,
  releaseStateOf,
  screenRelease,
  type ReleaseGateMode,
  type ReleaseLine,
} from "./release.ts";
import { appendReleaseLines, readReleaseLines } from "./release-store.ts";
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
const rowOf = (t: Ticket, state: "ready" | "unreleased" | "stale") => ({ key: t.key, title: t.title, hash: t.releaseHash ?? null, priority: t.priority, kEffects: t.kEffects ?? null, state });
const WEEK = 7 * 86_400_000;

export function releaseView(s: Snapshot, d: ReleaseDeps) {
  const lines = d.lines();
  const view = foldReleases(lines);
  const cands = candidatesOf(s, d.teams());
  const unreleased = bulkTargets(cands, view).map((t) => {
    const full = cands.find((c) => c.key === t.key)!;
    return rowOf(full, releaseStateOf(t.key, t.releaseHash, view) as "unreleased" | "stale");
  });
  // 제안(ATC-401)은 따로 보인다: 막는 이슈가 모두 끝난 제안이 READY에도 오르지 않게 뺀다
  const filed = filedProposalsOf(s.tickets, d.proposalSources?.() ?? new Map(), d.teams());
  const filedKeys = new Set(filed.map((f) => f.key));
  const ready = readyOf(s, d.teams()).filter((t) => !filedKeys.has(t.key)).map((t) => rowOf(t, "ready"));
  const titleOf = (k: string) => s.tickets.find((t) => t.key === k)?.title ?? null;
  const records = Object.values(view.records).sort((a, b) => b.at.localeCompare(a.at));
  const since = d.now().getTime() - WEEK;
  const channels = { screen: 0, "duty-chat": 0, attested: 0 };
  for (const r of records) if (Date.parse(r.at) >= since) channels[r.channel]++;
  const recent = records.slice(0, 15).map((r) => ({ key: r.flight, title: titleOf(r.flight), channel: r.channel, at: r.at, via: r.via ?? null, session: r.session ?? null }));
  const released = cands.filter((t) => releaseStateOf(t.key, t.releaseHash, view) === "released").map((t) => ({ key: t.key, ...view.records[t.key]! }));
  return {
    gate: { mode: d.gateMode(), on: releaseGateOn(d.gateMode(), view.armedAt), armedAt: view.armedAt },
    ready,
    filed,
    proposals: d.proposals?.() ?? [],
    unreleased,
    released,
    recent,
    channels,
    attested: attestedCounts(lines),
  };
}

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
    const t = [...readyOf(s, deps.teams()), ...s.tickets.filter((x) => filedKeys.has(x.key))].find((x) => x.key === body.flight);
    if (!t) return c.json({ error: `${body.flight}는 발권할 수 있는 READY Backlog FLIGHT나 제안이 아님` }, 409);
    if (t.priority <= 0) return c.json({ error: `${t.key}에 우선순위가 없음 — 먼저 FLIGHT 서랍에서 정함(DISPATCH는 우선순위 없는 FLIGHT를 배정하지 않는다)` }, 409);
    const r = screenRelease({ ...t, stateType: "unstarted" }, t.key, body.hash, "click", deps.now());
    if (!r.ok) return c.json({ error: r.error }, r.status);
    const moved = await (deps.moveToTodo ?? (async () => ({ ok: false as const, status: 503 as const, error: "상태 옮기기 길이 없음" })))(t.key, t.state);
    if (!moved.ok) return c.json({ error: moved.error }, moved.status);
    deps.append([r.value]);
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

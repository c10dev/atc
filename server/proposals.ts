import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Context, Hono } from "hono";
import { config } from "./config.ts";
import { callsign, flightNumber } from "./callsign.ts";
import {
  DONE_STATES,
  type DispatchConfig,
  type Factor,
  loadDispatchConfig,
  type Plan,
  PRIORITY_NAME,
  planDispatch,
  readFlightHistory,
  type Reserved,
  saveDispatchMode,
} from "./dispatch.ts";
import type { Snapshot, Ticket } from "./model.ts";
import { record } from "./recorder.ts";
import { fetchIssueDetail } from "./sources/linear.ts";

// DISPATCH 제안 기록. 추가만 하는 JSONL을 접어 현재 상태를 만든다(clearances.ts와 같은 방식).
// - 2a(mode "shadow"): SUPERVISOR가 "나라면 승인/거절"만 표시하고 아무에게도 보내지 않는다.
// - 2b(mode "approval"): SUPERVISOR가 승인하면 DISPATCH 세션이 FLIGHT PLAN을 CAPTAIN에게 보내고
//   CAPTAIN의 READBACK으로 수락, STAND가 생기면 DEPARTED. 보내는 문구는 서버가 만들고
//   dispatch/send-guard.mjs가 그 문구 그대로인지 확인한다.

const FILE = join(config.stateDir, "proposals.jsonl");
const DAY = 86_400_000;
export const PROPOSAL_TTL_MS = DAY;
export const DISPATCH_MS = 5 * 60_000;
export const GATE = { decided: 20, agreement: 0.8 };
// 2b → 3(ATFM) 제안 기준
export const GATE3 = { dispatched: 10, readback: 0.9, departed: 0.8 };
export const READBACK_OVERDUE_MS = 10 * 60_000;
export const DEPARTURE_OVERDUE_MS = 30 * 60_000;

export type ProposalStatus =
  | "proposed"
  | "agreed" // 2a: 나라면 승인
  | "disagreed" // 2a: 나라면 거절
  | "approved" // 2b: SUPERVISOR 승인(RELEASE는 여기서 끝 — SUPERVISOR가 Linear에서 정리)
  | "rejected"
  | "sent" // FLIGHT PLAN 보냄, READBACK 대기
  | "accepted" // CAPTAIN READBACK
  | "declined" // CAPTAIN이 사유로 거절
  | "departed" // FLIGHT에 STAND가 생김
  | "superseded"
  | "expired";

export const isHeld = (p: Proposal) => p.kind === "ASSIGN" && p.holdAt !== null;
export const isInFlight = (p: Proposal) => p.kind === "ASSIGN" && !isHeld(p) && (p.status === "approved" || p.status === "sent" || p.status === "accepted");

export interface Proposal {
  id: string; // "D-0001"
  at: string;
  kind: "ASSIGN" | "RELEASE";
  flight: string;
  aircraft: string | null;
  aircraftName: string | null;
  airport: string | null;
  score: number;
  factors: Factor[];
  status: ProposalStatus;
  decidedAt: string | null; // proposed에서 처음 벗어난 시각
  statusAt: string; // 마지막 상태 변경
  timeline: Partial<Record<ProposalStatus, string>>;
  reason: string | null; // 거절·SUPERSEDED·EXPIRED·DECLINED 사유
  note: string | null; // DISPATCH 세션 검토 메모
  caution: boolean;
  hold: string[]; // DISPATCH가 선행 FLIGHT로 지정한 HOLD (본문에만 있던 blocks 관계)
  holdAt: string | null; // HOLD를 건 시각. hold가 비어 있으면 선행 FLIGHT 없는 HOLD(사람 결정 대기 등, 사유는 note)
  message: string | null; // 보낸 FLIGHT PLAN 문구
  departedStand: string | null;
}

type Create = Omit<Proposal, "status" | "decidedAt" | "statusAt" | "timeline" | "reason" | "note" | "caution" | "hold" | "holdAt" | "message" | "departedStand">;
export type Op =
  | ({ op: "create" } & Create)
  | { op: "verdict"; id: string; at: string; verdict: "agree" | "disagree"; reason: string | null }
  | { op: "note"; id: string; at: string; text: string; caution: boolean }
  | { op: "hold"; id: string; at: string; blockedBy: string[] }
  | { op: "approve"; id: string; at: string }
  | { op: "reject"; id: string; at: string; reason: string | null }
  | { op: "send"; id: string; at: string; message: string }
  | { op: "accept"; id: string; at: string }
  | { op: "decline"; id: string; at: string; reason: string }
  | { op: "depart"; id: string; at: string; stand: string }
  | { op: "supersede"; id: string; at: string; reason: string }
  | { op: "expire"; id: string; at: string; reason?: string };

type StatusOp = Exclude<Op["op"], "create" | "note" | "hold">;

// 상태 전이 규칙. 여기 없는 전이는 무시한다(API도 같은 규칙으로 검사한다).
const NEXT: Partial<Record<ProposalStatus, Partial<Record<StatusOp, ProposalStatus>>>> = {
  proposed: { verdict: "agreed", approve: "approved", reject: "rejected", supersede: "superseded", expire: "expired" },
  approved: { send: "sent", supersede: "superseded", expire: "expired" },
  sent: { accept: "accepted", decline: "declined", expire: "expired" },
  accepted: { depart: "departed", expire: "expired" },
};

export function canApply(p: Proposal, op: StatusOp): boolean {
  if (op === "send" && p.kind !== "ASSIGN") return false;
  return Boolean(NEXT[p.status]?.[op]);
}

export function fold(ops: Op[]): Proposal[] {
  const byId = new Map<string, Proposal>();
  for (const o of ops) {
    if (o.op === "create") {
      const { op: _op, ...rest } = o;
      byId.set(o.id, {
        ...rest, status: "proposed", decidedAt: null, statusAt: o.at, timeline: { proposed: o.at },
        reason: null, note: null, caution: false, hold: [], holdAt: null, message: null, departedStand: null,
      });
      continue;
    }
    const p = byId.get(o.id);
    if (!p) continue;
    if (o.op === "note") {
      p.note = o.text;
      p.caution = o.caution;
      continue;
    }
    if (o.op === "hold") {
      p.hold = [...new Set(o.blockedBy)].sort();
      p.holdAt = o.at;
      continue;
    }
    if (!canApply(p, o.op)) continue;
    let next = NEXT[p.status]![o.op]!;
    if (o.op === "verdict" && o.verdict === "disagree") next = "disagreed";
    if (p.status === "proposed") p.decidedAt = o.at;
    p.status = next;
    p.statusAt = o.at;
    p.timeline[next] = o.at;
    if ("reason" in o && o.reason) p.reason = o.reason;
    if (o.op === "send") p.message = o.message;
    if (o.op === "depart") p.departedStand = o.stand;
  }
  return [...byId.values()];
}

// approved·sent·accepted인 ASSIGN의 AIRCRAFT·FLIGHT — 새 계획에서 빼서 중복 배정을 막는다.
// HOLD 걸린 ASSIGN은 FLIGHT만 잡아 둔다: AIRCRAFT는 아직 아무도 안 쥐었지만,
// FLIGHT는 DISPATCH가 "선행이 끝날 때까지 착수하지 않는다"고 정한 것이라 다시 제안하면 안 된다.
// (이게 없으면 HELD 제안을 만든 다음 바퀴에 같은 FLIGHT가 다른 AIRCRAFT로 곧바로 다시 나온다.)
export function reservedOf(existing: Proposal[]): Reserved {
  const live = existing.filter(isInFlight);
  const held = existing.filter((p) => p.status === "proposed" && isHeld(p));
  return {
    aircraft: new Map(live.map((p) => [p.aircraft!, p.id])),
    flights: new Map([...live, ...held].map((p) => [p.flight, p.id])),
    held: new Map(held.map((p) => [p.flight, `${p.id} — ${p.hold.length ? "선행 FLIGHT 대기" : "사람 결정 대기"}`])),
  };
}

// 새 계획과 열린 제안을 맞춘다. 순수 함수: 추가할 op만 돌려준다.
export function syncOps(
  existing: Proposal[],
  plan: Plan,
  s: Pick<Snapshot, "tickets" | "workspaces">,
  cfg: DispatchConfig,
  now: number,
  seq: number,
): Op[] {
  const at = new Date(now).toISOString();
  const ops: Op[] = [];
  const stateOf = new Map(s.tickets.map((t) => [t.key, t]));
  const aircraftOf = new Map(plan.aircraft.map((a) => [a.id, a]));
  const planned = new Set(plan.assign.map((a) => `${a.flight}|${a.aircraft}`));
  const releasing = new Set(plan.release.map((r) => r.flight));
  const standOf = new Map(s.workspaces.filter((w) => w.ticketKey).map((w) => [w.ticketKey!, w.path]));
  // 계획이 이미 FLIGHT를 뺀 이유(상위 이슈, HOLD, 라벨, STAND 있음 …). SUPERSEDED 사유로 그대로 쓴다:
  // "더 나은 배정으로 바뀜"만으로는 그 FLIGHT가 왜 빠졌는지 화면에서 알 수 없다.
  const excludedWhy = new Map(plan.excluded.map((e) => [e.flight, e.reason]));
  const age = (p: Proposal) => now - Date.parse(p.statusAt);

  const why = (p: Proposal): string => {
    const t = stateOf.get(p.flight);
    if (p.kind === "RELEASE") return t && t.stateType !== "started" ? `FLIGHT 상태가 바뀜(${t.state})` : "STAND가 생겼거나 기준에서 벗어남";
    if (!t || t.stateType !== "unstarted") return `FLIGHT 상태가 바뀜(${t?.state ?? "목록에 없음"})`;
    const ac = p.aircraft ? aircraftOf.get(p.aircraft) : undefined;
    if (!ac || !ac.available) return `AIRCRAFT 불가: ${ac?.reason ?? "세션 없음"}`;
    return excludedWhy.get(p.flight) ?? "더 나은 배정으로 바뀜";
  };
  // 승인됐지만 아직 안 보낸 ASSIGN이 여전히 유효한가(FLIGHT가 Todo이고 AIRCRAFT가 배정 가능)
  const stillValid = (p: Proposal) =>
    !isHeld(p) && stateOf.get(p.flight)?.stateType === "unstarted" && Boolean(p.aircraft && aircraftOf.get(p.aircraft)?.available);

  let open = 0;
  let openRelease = 0;
  for (const p of existing) {
    if (p.status === "proposed") {
      if (isHeld(p)) {
        // DISPATCH가 잡아 둔 HOLD는 24시간 만료가 없다. 대신 풀리는 조건이 있다:
        // FLIGHT 자체가 Todo가 아니게 됨 / 선행 FLIGHT가 모두 끝남 / (선행 없는 HOLD) HOLD 뒤에 FLIGHT가 수정됨
        const t = stateOf.get(p.flight);
        const blockers = p.hold.filter((k) => stateOf.has(k) && !DONE_STATES.has(stateOf.get(k)!.stateType));
        if (!t || t.stateType !== "unstarted") ops.push({ op: "supersede", id: p.id, at, reason: `FLIGHT 상태가 바뀜(${t?.state ?? "목록에 없음"})` });
        else if (p.hold.length && !blockers.length) ops.push({ op: "supersede", id: p.id, at, reason: `선행 FLIGHT(${p.hold.join(", ")})가 끝남 — 다시 후보` });
        else if (!p.hold.length && t.updatedAt && Date.parse(t.updatedAt) > Date.parse(p.holdAt!))
          ops.push({ op: "supersede", id: p.id, at, reason: "HOLD 뒤에 FLIGHT가 수정됨 — 다시 검토" });
        continue;
      }
      if (now - Date.parse(p.at) > PROPOSAL_TTL_MS) ops.push({ op: "expire", id: p.id, at });
      else if (p.kind === "ASSIGN" && !planned.has(`${p.flight}|${p.aircraft}`)) ops.push({ op: "supersede", id: p.id, at, reason: why(p) });
      else if (p.kind === "RELEASE" && !releasing.has(p.flight)) ops.push({ op: "supersede", id: p.id, at, reason: why(p) });
      else if (p.kind === "ASSIGN") open++;
      else openRelease++;
    } else if (p.kind === "ASSIGN" && p.status === "approved") {
      if (age(p) > PROPOSAL_TTL_MS) ops.push({ op: "expire", id: p.id, at, reason: "승인 뒤 24시간 동안 전달되지 않음" });
      else if (!stillValid(p)) ops.push({ op: "supersede", id: p.id, at, reason: why(p) });
    } else if (p.status === "sent") {
      // 보낸 뒤에는 CAPTAIN이 쥐고 있으니 자동 SUPERSEDED 하지 않는다
      if (age(p) > PROPOSAL_TTL_MS) ops.push({ op: "expire", id: p.id, at, reason: "24시간 동안 READBACK 없음" });
    } else if (p.status === "accepted") {
      const stand = standOf.get(p.flight);
      if (stand) ops.push({ op: "depart", id: p.id, at, stand });
      else if (age(p) > PROPOSAL_TTL_MS) ops.push({ op: "expire", id: p.id, at, reason: "READBACK 뒤 24시간 동안 STAND가 생기지 않음" });
    }
  }

  // 같은 짝(RELEASE는 같은 FLIGHT)을 24시간 안에 다시 제안하지 않는다(거절한 것도 포함).
  const recent = existing.filter((x) => now - Date.parse(x.at) < PROPOSAL_TTL_MS);
  const seen = new Set(recent.map((x) => (x.kind === "ASSIGN" ? `${x.flight}|${x.aircraft}` : `R|${x.flight}`)));
  const nextId = () => `D-${String(++seq).padStart(4, "0")}`;
  for (const a of plan.assign) {
    if (open >= cfg.slots.openProposals) break;
    if (seen.has(`${a.flight}|${a.aircraft}`)) continue;
    ops.push({ op: "create", id: nextId(), at, kind: "ASSIGN", flight: a.flight, aircraft: a.aircraft, aircraftName: a.aircraftName, airport: a.airport, score: a.score, factors: a.factors });
    open++;
  }
  for (const r of plan.release) {
    if (openRelease >= cfg.slots.openReleases) break;
    if (seen.has(`R|${r.flight}`)) continue;
    ops.push({ op: "create", id: nextId(), at, kind: "RELEASE", flight: r.flight, aircraft: null, aircraftName: null, airport: r.airport, score: r.score, factors: r.factors });
    openRelease++;
  }
  return ops;
}

// CAPTAIN에게 보낼 FLIGHT PLAN. send-guard는 DISPATCH가 이 문구를 그대로 보내는지 확인한다.
export function formatFlightPlan(p: Proposal, ticket: Pick<Ticket, "title" | "url" | "priority"> | undefined, sessionName: string): string {
  const sign = callsign({ name: sessionName });
  const who = sign === sessionName ? sessionName : `${sign} (${sessionName})`;
  const note = p.note ? `DISPATCH 메모: ${p.caution ? "CAUTION · " : ""}${p.note}` : p.caution ? "DISPATCH 메모: CAUTION" : null;
  const hold = p.hold.length ? `HOLD — 선행 FLIGHT ${p.hold.map(flightNumber).join(", ")}가 끝난 뒤 착수` : null;
  return [
    `[DISPATCH ${p.id}] FLIGHT PLAN · ${who}`,
    `FLIGHT ${flightNumber(p.flight)} · AIRPORT ${p.airport ?? "—"} · PRIORITY ${PRIORITY_NAME[ticket?.priority ?? 0] ?? "없음"}`,
    ticket?.title ?? p.flight,
    ticket?.url ?? null,
    note,
    hold,
    `— 맡으면 이 메시지에 "READBACK ${p.id}", 못 맡으면 사유로 답장해 주세요.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function overdueOf(proposals: Proposal[], now: number): string[] {
  return proposals
    .filter(
      (p) =>
        (p.status === "sent" && now - Date.parse(p.statusAt) > READBACK_OVERDUE_MS) ||
        (p.status === "accepted" && now - Date.parse(p.statusAt) > DEPARTURE_OVERDUE_MS),
    )
    .map((p) => p.id);
}

export function gateOf(proposals: Proposal[]) {
  const decided = proposals.filter((p) => p.status === "agreed" || p.status === "disagreed");
  const agreed = decided.filter((p) => p.status === "agreed").length;
  const agreement = decided.length ? agreed / decided.length : null;
  return {
    decided: decided.length,
    agreed,
    agreement,
    target: GATE,
    ready: decided.length >= GATE.decided && agreement !== null && agreement >= GATE.agreement,
  };
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

// 2b → 3(ATFM) 점검: 보낸 FLIGHT PLAN 중 READBACK 받은 비율, READBACK까지 걸린 시간, READBACK 뒤 DEPARTED 비율
export function gate3Of(proposals: Proposal[]) {
  const dispatched = proposals.filter((p) => p.timeline.sent);
  const readBack = dispatched.filter((p) => p.timeline.accepted);
  const departed = readBack.filter((p) => p.timeline.departed);
  const readbackRate = dispatched.length ? readBack.length / dispatched.length : null;
  const departedRate = readBack.length ? departed.length / readBack.length : null;
  const mins = median(readBack.map((p) => (Date.parse(p.timeline.accepted!) - Date.parse(p.timeline.sent!)) / 60_000));
  return {
    dispatched: dispatched.length,
    readBack: readBack.length,
    departed: departed.length,
    declined: dispatched.filter((p) => p.status === "declined").length,
    readbackRate,
    readbackMedianMin: mins === null ? null : Math.round(mins * 10) / 10,
    departedRate,
    target: GATE3,
    ready:
      dispatched.length >= GATE3.dispatched &&
      readbackRate !== null && readbackRate >= GATE3.readback &&
      departedRate !== null && departedRate >= GATE3.departed,
  };
}

// ── 파일 ──

function readOps(file = FILE): Op[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const ops: Op[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      ops.push(JSON.parse(line));
    } catch {}
  }
  return ops;
}

function append(ops: Op[]) {
  if (!ops.length) return;
  mkdirSync(dirname(FILE), { recursive: true });
  appendFileSync(FILE, ops.map((o) => JSON.stringify(o)).join("\n") + "\n");
  for (const o of ops) record({ t: o.at, kind: "dispatch", op: o.op, id: o.id });
}

export function allProposals(): Proposal[] {
  return fold(readOps());
}

// 서버 tick에서 5분마다 부른다.
export function runDispatch(s: Snapshot, now = Date.now()): Plan {
  const cfg = loadDispatchConfig();
  const ops = readOps();
  const existing = fold(ops);
  const plan = planDispatch(s, readFlightHistory(), cfg, now, reservedOf(existing));
  const seq = ops.filter((o) => o.op === "create").length;
  append(syncOps(existing, plan, s, cfg, now, seq));
  return plan;
}

// ── API ──

export function mountDispatch(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  app.get("/api/dispatch/brief", async (c) => {
    const s = await getSnapshot();
    const cfg = loadDispatchConfig();
    const now = Date.now();
    const proposals = allProposals();
    const plan = planDispatch(s, readFlightHistory(), cfg, now, reservedOf(proposals));
    const open = proposals.filter((p) => p.status === "proposed" && !isHeld(p));
    const held = proposals.filter((p) => p.status === "proposed" && isHeld(p));
    const inFlight = proposals.filter(isInFlight).sort((a, b) => a.statusAt.localeCompare(b.statusAt));
    const recent = proposals
      .filter((p) => p.status !== "proposed" && !isInFlight(p) && now - Date.parse(p.statusAt) < 7 * DAY)
      .sort((a, b) => b.statusAt.localeCompare(a.statusAt))
      .slice(0, 50);
    const keys = new Set([...proposals.map((p) => p.flight), ...plan.hold.flatMap((h) => [h.flight, ...h.blockedBy]), ...plan.excluded.map((e) => e.flight)]);
    const flights = Object.fromEntries(
      s.tickets.filter((t) => keys.has(t.key)).map((t) => [t.key, { title: t.title, state: t.state, priority: t.priority, project: t.project, url: t.url }]),
    );
    return c.json({
      mode: cfg.mode,
      at: new Date(now).toISOString(),
      plan,
      open,
      held,
      inFlight,
      overdue: overdueOf(proposals, now),
      recent,
      flights,
      gate: gateOf(proposals),
      gate3: gate3Of(proposals),
      config: cfg,
    });
  });

  // send-guard가 쓰는 단건 조회
  app.get("/api/dispatch/proposals/:id", (c) => {
    const p = allProposals().find((x) => x.id === c.req.param("id").toUpperCase());
    return p ? c.json({ proposal: p, mode: loadDispatchConfig().mode }) : c.json({ error: "그런 제안이 없음" }, 404);
  });

  const reasonOf = (body: { reason?: unknown }) => (typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null);

  // 상태를 바꾸는 동작 하나. 모드·전이 규칙을 검사하고 op를 남긴다.
  const act =
    (name: "verdict" | "note" | "hold" | "unhold" | "approve" | "reject" | "release" | "accept" | "decline") =>
    async (c: Context) => {
      const id = (c.req.param("id") ?? "").toUpperCase();
      const body = await c.req.json().catch(() => ({}));
      const p = allProposals().find((x) => x.id === id);
      if (!p) return c.json({ error: "그런 제안이 없음" }, 404);
      const mode = loadDispatchConfig().mode;
      const at = new Date().toISOString();
      const closed = (op: StatusOp) => (canApply(p, op) ? null : c.json({ error: `지금 상태(${p.status})에서는 할 수 없음` }, 409));

      if (name === "note") {
        if (typeof body.text !== "string" || !body.text.trim()) return c.json({ error: "text가 필요함" }, 400);
        append([{ op: "note", id, at, text: body.text.trim(), caution: Boolean(body.caution) }]);
      } else if (name === "hold") {
        if (p.status !== "proposed") return c.json({ error: `지금 상태(${p.status})에서는 HOLD를 바꿀 수 없음` }, 409);
        if (p.kind !== "ASSIGN") return c.json({ error: "RELEASE 제안에는 HOLD를 걸지 않는다" }, 400);
        const raw = Array.isArray(body.blockedBy) ? body.blockedBy : [];
        const blockedBy: string[] = [...new Set<string>(raw.map((k: unknown) => String(k).toUpperCase()))];
        // 선행 FLIGHT 없는 HOLD(사람 결정·외부 입력 대기)는 사유가 note에 있어야 한다
        if (!blockedBy.length && !p.note) return c.json({ error: "선행 FLIGHT 없는 HOLD는 사유 메모(note)가 먼저 필요함" }, 400);
        const bad = blockedBy.find((k) => !/^[A-Z]+-\d+$/.test(k));
        if (bad) return c.json({ error: `FLIGHT key 형식이 아님: ${bad}` }, 400);
        if (blockedBy.includes(p.flight)) return c.json({ error: `자기 자신(${p.flight})을 선행 FLIGHT로 걸 수 없음` }, 400);
        // 목록에 없는 key는 오타일 가능성이 크다. 그대로 두면 풀리지 않는 HOLD가 된다
        const known = new Set((await getSnapshot()).tickets.map((t) => t.key));
        const unknown = blockedBy.find((k) => !known.has(k));
        if (unknown) return c.json({ error: `열린 FLIGHT 목록에 없는 key: ${unknown}` }, 400);
        append([{ op: "hold", id, at, blockedBy }]);
      } else if (name === "unhold") {
        // SUPERVISOR가 HOLD를 푼다. 제안은 닫고, FLIGHT는 다음 계획에서 다시 후보가 된다
        if (!isHeld(p)) return c.json({ error: "HOLD 중인 제안이 아님" }, 409);
        const bad = closed("supersede");
        if (bad) return bad;
        append([{ op: "supersede", id, at, reason: "SUPERVISOR가 HOLD를 풂 — 다시 후보" }]);
      } else if (name === "verdict") {
        if (mode !== "shadow") return c.json({ error: "그림자 판정은 shadow 모드에서만 — approval 모드에서는 approve/reject" }, 409);
        if (body.verdict !== "agree" && body.verdict !== "disagree") return c.json({ error: "verdict는 agree|disagree" }, 400);
        const bad = closed("verdict");
        if (bad) return bad;
        append([{ op: "verdict", id, at, verdict: body.verdict, reason: reasonOf(body) }]);
      } else if (name === "approve" || name === "reject") {
        if (mode !== "approval") return c.json({ error: "승인·거절은 approval 모드(2b)에서만" }, 409);
        const bad = closed(name);
        if (bad) return bad;
        append([name === "approve" ? { op: "approve", id, at } : { op: "reject", id, at, reason: reasonOf(body) }]);
      } else if (name === "release") {
        if (mode !== "approval") return c.json({ error: "FLIGHT PLAN은 approval 모드(2b)에서만 보낸다" }, 409);
        if (p.kind !== "ASSIGN") return c.json({ error: "RELEASE 제안은 보내지 않는다" }, 400);
        // 재송신: 이미 보낸 제안이면 같은 문구를 다시 돌려준다
        if (p.status === "sent") return c.json({ proposal: p, sendTo: p.aircraftName, message: p.message });
        const bad = closed("send");
        if (bad) return bad;
        const s = await getSnapshot();
        const message = formatFlightPlan(p, s.tickets.find((t) => t.key === p.flight), p.aircraftName ?? "");
        append([{ op: "send", id, at, message }]);
        const sent = allProposals().find((x) => x.id === id)!;
        return c.json({ proposal: sent, sendTo: sent.aircraftName, message: sent.message });
      } else if (name === "accept") {
        const bad = closed("accept");
        if (bad) return bad;
        append([{ op: "accept", id, at }]);
      } else {
        const reason = reasonOf(body);
        if (!reason) return c.json({ error: "decline에는 CAPTAIN의 사유(reason)가 필요함" }, 400);
        const bad = closed("decline");
        if (bad) return bad;
        append([{ op: "decline", id, at, reason }]);
      }
      return c.json({ proposal: allProposals().find((x) => x.id === id) });
    };
  for (const name of ["verdict", "note", "hold", "unhold", "approve", "reject", "release", "accept", "decline"] as const) {
    app.post(`/api/dispatch/proposals/:id/${name}`, act(name));
  }

  // 2a ↔ 2b 전환. 2b에서는 승인된 FLIGHT PLAN이 CAPTAIN에게 나간다.
  app.post("/api/dispatch/mode", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (body.mode !== "shadow" && body.mode !== "approval") return c.json({ error: "mode는 shadow|approval" }, 400);
    saveDispatchMode(body.mode);
    record({ t: new Date().toISOString(), kind: "dispatch", op: `mode:${body.mode}`, id: "-" });
    return c.json({ mode: loadDispatchConfig().mode });
  });

  // DISPATCH 세션이 티켓 본문을 읽는 창구(Linear 읽기 전용)
  app.get("/api/dispatch/flight/:key", async (c) => {
    try {
      return c.json(await fetchIssueDetail(c.req.param("key").toUpperCase()));
    } catch (e) {
      return c.json({ error: String((e as Error).message ?? e) }, 502);
    }
  });
}

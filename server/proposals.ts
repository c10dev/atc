import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Context, Hono } from "hono";
import { config } from "./config.ts";
import { type DispatchConfig, type Factor, loadDispatchConfig, type Plan, planDispatch, readFlightHistory } from "./dispatch.ts";
import type { Snapshot } from "./model.ts";
import { record } from "./recorder.ts";
import { fetchIssueDetail } from "./sources/linear.ts";

// DISPATCH 제안 기록. 추가만 하는 JSONL을 접어 현재 상태를 만든다(clearances.ts와 같은 방식).
// 2a(그림자 운용)에서는 SUPERVISOR가 "나라면 승인/거절"만 표시하고 아무에게도 보내지 않는다.

const FILE = join(config.stateDir, "proposals.jsonl");
const DAY = 86_400_000;
export const PROPOSAL_TTL_MS = DAY;
export const DISPATCH_MS = 5 * 60_000;
export const GATE = { decided: 20, agreement: 0.8 };

export type ProposalStatus = "proposed" | "agreed" | "disagreed" | "superseded" | "expired";

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
  decidedAt: string | null;
  reason: string | null; // 거절·SUPERSEDED 사유
  note: string | null; // DISPATCH 세션 검토 메모
  caution: boolean;
}

type Create = Omit<Proposal, "status" | "decidedAt" | "reason" | "note" | "caution">;
export type Op =
  | ({ op: "create" } & Create)
  | { op: "verdict"; id: string; at: string; verdict: "agree" | "disagree"; reason: string | null }
  | { op: "note"; id: string; at: string; text: string; caution: boolean }
  | { op: "supersede"; id: string; at: string; reason: string }
  | { op: "expire"; id: string; at: string };

export function fold(ops: Op[]): Proposal[] {
  const byId = new Map<string, Proposal>();
  for (const o of ops) {
    if (o.op === "create") {
      const { op: _op, ...rest } = o;
      byId.set(o.id, { ...rest, status: "proposed", decidedAt: null, reason: null, note: null, caution: false });
      continue;
    }
    const p = byId.get(o.id);
    if (!p) continue;
    if (o.op === "note") {
      p.note = o.text;
      p.caution = o.caution;
    } else if (p.status === "proposed") {
      p.decidedAt = o.at;
      if (o.op === "verdict") {
        p.status = o.verdict === "agree" ? "agreed" : "disagreed";
        p.reason = o.reason;
      } else if (o.op === "supersede") {
        p.status = "superseded";
        p.reason = o.reason;
      } else p.status = "expired";
    }
  }
  return [...byId.values()];
}

// 새 계획과 열린 제안을 맞춘다. 순수 함수: 추가할 op만 돌려준다.
export function syncOps(existing: Proposal[], plan: Plan, s: Pick<Snapshot, "tickets">, cfg: DispatchConfig, now: number, seq: number): Op[] {
  const at = new Date(now).toISOString();
  const ops: Op[] = [];
  const stateOf = new Map(s.tickets.map((t) => [t.key, t]));
  const aircraftOf = new Map(plan.aircraft.map((a) => [a.id, a]));
  const planned = new Set(plan.assign.map((a) => `${a.flight}|${a.aircraft}`));
  const releasing = new Set(plan.release.map((r) => r.flight));

  const why = (p: Proposal): string => {
    const t = stateOf.get(p.flight);
    if (p.kind === "RELEASE") return t && t.stateType !== "started" ? `FLIGHT 상태가 바뀜(${t.state})` : "STAND가 생겼거나 기준에서 벗어남";
    if (!t || t.stateType !== "unstarted") return `FLIGHT 상태가 바뀜(${t?.state ?? "목록에 없음"})`;
    const ac = p.aircraft ? aircraftOf.get(p.aircraft) : undefined;
    if (!ac || !ac.available) return `AIRCRAFT 불가: ${ac?.reason ?? "세션 없음"}`;
    return "더 나은 배정으로 바뀜";
  };

  let open = 0;
  let openRelease = 0;
  for (const p of existing.filter((x) => x.status === "proposed")) {
    if (now - Date.parse(p.at) > PROPOSAL_TTL_MS) ops.push({ op: "expire", id: p.id, at });
    else if (p.kind === "ASSIGN" && !planned.has(`${p.flight}|${p.aircraft}`)) ops.push({ op: "supersede", id: p.id, at, reason: why(p) });
    else if (p.kind === "RELEASE" && !releasing.has(p.flight)) ops.push({ op: "supersede", id: p.id, at, reason: why(p) });
    else if (p.kind === "ASSIGN") open++;
    else openRelease++;
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
  const plan = planDispatch(s, readFlightHistory(), cfg, now);
  const ops = readOps();
  const seq = ops.filter((o) => o.op === "create").length;
  append(syncOps(fold(ops), plan, s, cfg, now, seq));
  return plan;
}

// ── API ──

export function mountDispatch(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  app.get("/api/dispatch/brief", async (c) => {
    const s = await getSnapshot();
    const cfg = loadDispatchConfig();
    const now = Date.now();
    const plan = planDispatch(s, readFlightHistory(), cfg, now);
    const proposals = allProposals();
    const open = proposals.filter((p) => p.status === "proposed");
    const recent = proposals
      .filter((p) => p.status !== "proposed" && now - Date.parse(p.decidedAt ?? p.at) < 7 * DAY)
      .sort((a, b) => (b.decidedAt ?? b.at).localeCompare(a.decidedAt ?? a.at))
      .slice(0, 50);
    const keys = new Set([...proposals.map((p) => p.flight), ...plan.hold.flatMap((h) => [h.flight, ...h.blockedBy]), ...plan.excluded.map((e) => e.flight)]);
    const flights = Object.fromEntries(
      s.tickets.filter((t) => keys.has(t.key)).map((t) => [t.key, { title: t.title, state: t.state, priority: t.priority, project: t.project, url: t.url }]),
    );
    return c.json({ mode: cfg.mode, at: new Date(now).toISOString(), plan, open, recent, flights, gate: gateOf(proposals), config: cfg });
  });

  const verdictOrNote = (op: "verdict" | "note") => async (c: Context) => {
    const id = (c.req.param("id") ?? "").toUpperCase();
    const body = await c.req.json().catch(() => ({}));
    const p = allProposals().find((x) => x.id === id);
    if (!p) return c.json({ error: "그런 제안이 없음" }, 404);
    const at = new Date().toISOString();
    if (op === "verdict") {
      if (body.verdict !== "agree" && body.verdict !== "disagree") return c.json({ error: "verdict는 agree|disagree" }, 400);
      if (p.status !== "proposed") return c.json({ error: `이미 닫힌 제안(${p.status})` }, 409);
      append([{ op: "verdict", id, at, verdict: body.verdict, reason: typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null }]);
    } else {
      if (typeof body.text !== "string" || !body.text.trim()) return c.json({ error: "text가 필요함" }, 400);
      append([{ op: "note", id, at, text: body.text.trim(), caution: Boolean(body.caution) }]);
    }
    return c.json({ proposal: allProposals().find((x) => x.id === id) });
  };
  app.post("/api/dispatch/proposals/:id/verdict", verdictOrNote("verdict"));
  app.post("/api/dispatch/proposals/:id/note", verdictOrNote("note"));

  // DISPATCH 세션이 티켓 본문을 읽는 창구(Linear 읽기 전용)
  app.get("/api/dispatch/flight/:key", async (c) => {
    try {
      return c.json(await fetchIssueDetail(c.req.param("key").toUpperCase()));
    } catch (e) {
      return c.json({ error: String((e as Error).message ?? e) }, 502);
    }
  });
}

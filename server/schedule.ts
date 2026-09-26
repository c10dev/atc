import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Context, Hono } from "hono";
import { flightNumber } from "./callsign.ts";
import { config } from "./config.ts";
import { classLabel, classOf, FLIGHT_TYPES, type FlightType, RATINGS, type Rating, WAKES, type Wake } from "./crew.ts";
import { PRIORITY_NAME } from "./dispatch.ts";
import type { Snapshot, Ticket } from "./model.ts";
import { record } from "./recorder.ts";

// OCC S1 — SCHEDULE 초안(그림자 운용). OCC가 Linear에 쓸 변경을 초안으로 남기고, SUPERVISOR가
// "승인했을 것 / 거절했을 것"을 표시해 초안 품질을 잰다. 이 단계에서는 아무것도 Linear에 쓰지 않는다.
// 설계: docs/occ.md 5~7장. 첫 작업 종류는 CLASSIFY(분류 라벨)와 PRIORITIZE(우선순위).

export const SCHEDULE_KINDS = ["CLASSIFY", "PRIORITIZE"] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

export interface ClassifyPayload {
  type?: FlightType;
  wake?: Wake;
  ratings?: Rating[]; // 붙일 rating 라벨
}
export interface PrioritizePayload {
  priority: 1 | 2 | 3 | 4; // Urgent High Medium Low
}
export type SchedulePayload = ClassifyPayload | PrioritizePayload;

export type ScheduleStatus = "draft" | "agreed" | "disagreed" | "superseded" | "expired";

export interface ScheduleOp {
  id: string; // "S-0001"
  kind: ScheduleKind;
  flight: string;
  payload: SchedulePayload;
  reason: string; // OCC의 근거 한 줄
  at: string;
  status: ScheduleStatus;
  statusAt: string;
  verdictReason: string | null; // 거절 사유, SUPERSEDED·EXPIRED 사유
}

type LogLine =
  | { op: "draft"; id: string; at: string; kind: ScheduleKind; flight: string; payload: SchedulePayload; reason: string }
  | { op: "verdict"; id: string; at: string; verdict: "agree" | "disagree"; reason: string | null }
  | { op: "supersede"; id: string; at: string; reason: string }
  | { op: "expire"; id: string; at: string };

export const SCHEDULE_OPEN_LIMIT = 5; // 결정 안 된 초안 최대 수(SUPERVISOR 검토 부담)
const TTL_MS = 3 * 86_400_000; // 3일 동안 판정이 없으면 EXPIRED
const GATE = { decided: 20, agreement: 0.8 };

const FILE = () => join(config.stateDir, "schedule.jsonl");

export class ScheduleError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function fold(lines: LogLine[]): ScheduleOp[] {
  const byId = new Map<string, ScheduleOp>();
  for (const l of lines) {
    if (l.op === "draft") {
      byId.set(l.id, { id: l.id, kind: l.kind, flight: l.flight, payload: l.payload, reason: l.reason, at: l.at, status: "draft", statusAt: l.at, verdictReason: null });
      continue;
    }
    const s = byId.get(l.id);
    if (!s || s.status !== "draft") continue; // 닫힌 초안은 바꾸지 않는다
    if (l.op === "verdict") s.status = l.verdict === "agree" ? "agreed" : "disagreed";
    else if (l.op === "supersede") s.status = "superseded";
    else s.status = "expired";
    s.statusAt = l.at;
    s.verdictReason = l.op === "verdict" ? l.reason : l.op === "supersede" ? l.reason : "3일 동안 판정 없음";
  }
  return [...byId.values()];
}

function readLines(file = FILE()): LogLine[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: LogLine[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {}
  }
  return out;
}

function append(lines: LogLine[], file = FILE()) {
  if (!lines.length) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  for (const l of lines) record({ t: l.at, kind: "schedule", op: l.op, id: l.id });
}

const isOpenTicket = (t: Ticket | undefined) => Boolean(t && (t.stateType === "unstarted" || t.stateType === "backlog"));

// 초안이 지금 티켓에 적용하면 무엇이 바뀌는지. 바뀌는 게 없으면 빈 배열.
export function changesOf(kind: ScheduleKind, payload: SchedulePayload, t: Pick<Ticket, "labels" | "priority">): string[] {
  if (kind === "PRIORITIZE") {
    const p = (payload as PrioritizePayload).priority;
    return t.priority === p ? [] : [`priority ${PRIORITY_NAME[t.priority] ?? "없음"} → ${PRIORITY_NAME[p]}`];
  }
  const c = classOf(t.labels);
  const want = payload as ClassifyPayload;
  const out: string[] = [];
  if (want.type && !(c.explicit.type && c.type === want.type)) out.push(`type:${want.type}`);
  if (want.wake && !(c.explicit.wake && c.wake === want.wake)) out.push(`wake:${want.wake}`);
  for (const r of want.ratings ?? []) if (!c.ratings.includes(r)) out.push(`rating:${r}`);
  return out;
}

// 입력을 검사해 payload로 만든다
export function parsePayload(kind: unknown, raw: Record<string, unknown>): { kind: ScheduleKind; payload: SchedulePayload } {
  if (!SCHEDULE_KINDS.includes(kind as ScheduleKind)) throw new ScheduleError(`모르는 SCHEDULE 작업: ${kind} (가능: ${SCHEDULE_KINDS.join(", ")})`);
  if (kind === "PRIORITIZE") {
    const p = Number(raw.priority);
    if (![1, 2, 3, 4].includes(p)) throw new ScheduleError("priority는 1(Urgent)·2(High)·3(Medium)·4(Low)");
    return { kind, payload: { priority: p as PrioritizePayload["priority"] } };
  }
  const payload: ClassifyPayload = {};
  if (raw.type != null) {
    const v = String(raw.type).toUpperCase();
    if (!(FLIGHT_TYPES as readonly string[]).includes(v)) throw new ScheduleError(`모르는 FLIGHT TYPE: ${v}`);
    payload.type = v as FlightType;
  }
  if (raw.wake != null) {
    const v = String(raw.wake).toUpperCase();
    if (!(WAKES as readonly string[]).includes(v)) throw new ScheduleError(`모르는 WAKE: ${v}`);
    payload.wake = v as Wake;
  }
  if (raw.ratings != null) {
    const list = (Array.isArray(raw.ratings) ? raw.ratings : [raw.ratings]).map((r) => String(r).toUpperCase());
    const bad = list.find((r) => !(RATINGS as readonly string[]).includes(r));
    if (bad) throw new ScheduleError(`모르는 TYPE RATING: ${bad}`);
    if (list.length) payload.ratings = [...new Set(list as Rating[])];
  }
  if (!payload.type && !payload.wake && !payload.ratings) throw new ScheduleError("CLASSIFY에는 type·wake·rating 중 하나 이상이 필요함");
  return { kind: "CLASSIFY", payload };
}

// 새 초안 만들기(순수). 같은 FLIGHT·종류의 열린 초안은 새 초안이 SUPERSEDED로 대신한다.
export function draftOps(
  existing: ScheduleOp[],
  input: { kind: unknown; flight: unknown; reason: unknown; [k: string]: unknown },
  tickets: Ticket[],
  now: string,
  seq: number,
): LogLine[] {
  const flight = String(input.flight ?? "").toUpperCase();
  const t = tickets.find((x) => x.key === flight);
  if (!t) throw new ScheduleError(`열린 FLIGHT 목록에 없음: ${flight || "(비었음)"}`);
  if (!isOpenTicket(t)) throw new ScheduleError(`${flight}는 Todo·Backlog가 아님(${t.state}) — 계획 단계의 FLIGHT만 초안을 쓴다`);
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) throw new ScheduleError("근거(reason) 한 줄이 필요함");
  const { kind, payload } = parsePayload(input.kind, input);
  if (!changesOf(kind, payload, t).length) throw new ScheduleError(`${flight}에는 이미 그렇게 되어 있음 — 바꿀 것이 없음`);
  const open = existing.filter((s) => s.status === "draft");
  const replaced = open.filter((s) => s.flight === flight && s.kind === kind);
  if (open.length - replaced.length >= SCHEDULE_OPEN_LIMIT) throw new ScheduleError(`열린 초안이 ${SCHEDULE_OPEN_LIMIT}건 — SUPERVISOR 판정을 기다린다`, 409);
  const id = `S-${String(seq + 1).padStart(4, "0")}`;
  return [
    ...replaced.map((s) => ({ op: "supersede" as const, id: s.id, at: now, reason: `새 초안 ${id}로 바뀜` })),
    { op: "draft", id, at: now, kind, flight, payload, reason: reason.slice(0, 500) },
  ];
}

// 상황이 바뀐 열린 초안을 닫는다(순수): FLIGHT가 계획 단계를 벗어남, 이미 반영됨, 3일 지남
export function syncLines(existing: ScheduleOp[], tickets: Ticket[], nowMs: number): LogLine[] {
  const at = new Date(nowMs).toISOString();
  const byKey = new Map(tickets.map((t) => [t.key, t]));
  const out: LogLine[] = [];
  for (const s of existing) {
    if (s.status !== "draft") continue;
    const t = byKey.get(s.flight);
    if (!isOpenTicket(t)) out.push({ op: "supersede", id: s.id, at, reason: `FLIGHT 상태가 바뀜(${t?.state ?? "목록에 없음"})` });
    else if (!changesOf(s.kind, s.payload, t!).length) out.push({ op: "supersede", id: s.id, at, reason: "Linear에 이미 반영됨" });
    else if (nowMs - Date.parse(s.at) > TTL_MS) out.push({ op: "expire", id: s.id, at });
  }
  return out;
}

export function gateOf(ops: ScheduleOp[]) {
  const decided = ops.filter((s) => s.status === "agreed" || s.status === "disagreed");
  const agreed = decided.filter((s) => s.status === "agreed").length;
  const agreement = decided.length ? agreed / decided.length : null;
  return {
    decided: decided.length,
    agreed,
    agreement,
    target: GATE,
    ready: decided.length >= GATE.decided && agreement !== null && agreement >= GATE.agreement,
  };
}

// OCC가 초안을 쓸 후보: 계획 단계(Todo·Backlog)인데 분류 라벨이 없거나 우선순위가 없는 FLIGHT
export function candidatesOf(tickets: Ticket[], ops: ScheduleOp[]) {
  const openFor = new Set(ops.filter((s) => s.status === "draft").map((s) => `${s.kind}|${s.flight}`));
  const planning = tickets.filter(isOpenTicket);
  return {
    classify: planning.filter((t) => { const c = classOf(t.labels); return !c.explicit.type || !c.explicit.wake; }).filter((t) => !openFor.has(`CLASSIFY|${t.key}`)).map((t) => t.key),
    prioritize: planning.filter((t) => !t.priority && !openFor.has(`PRIORITIZE|${t.key}`)).map((t) => t.key),
  };
}

export function mountSchedule(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  // 브리핑할 때마다 상황이 바뀐 초안을 먼저 닫는다
  const current = (tickets: Ticket[]) => {
    const lines = readLines();
    const ops = fold(lines);
    const closing = syncLines(ops, tickets, Date.now());
    if (closing.length) {
      append(closing);
      return fold([...lines, ...closing]);
    }
    return ops;
  };

  app.get("/api/schedule/brief", async (c) => {
    const s = await getSnapshot();
    const ops = current(s.tickets);
    const now = Date.now();
    const open = ops.filter((x) => x.status === "draft").sort((a, b) => a.at.localeCompare(b.at));
    const recent = ops
      .filter((x) => x.status !== "draft" && now - Date.parse(x.statusAt) < 7 * 86_400_000)
      .sort((a, b) => b.statusAt.localeCompare(a.statusAt))
      .slice(0, 50);
    const candidates = candidatesOf(s.tickets, ops);
    const keys = new Set([...ops.map((x) => x.flight), ...candidates.classify, ...candidates.prioritize]);
    const byKey = new Map(s.tickets.map((t) => [t.key, t]));
    const flights = Object.fromEntries(
      [...keys].filter((k) => byKey.has(k)).map((k) => {
        const t = byKey.get(k)!;
        return [k, { title: t.title, state: t.state, priority: t.priority, project: t.project, url: t.url, cls: classLabel(classOf(t.labels)), labels: t.labels }];
      }),
    );
    const changes = Object.fromEntries(open.map((x) => [x.id, byKey.get(x.flight) ? changesOf(x.kind, x.payload, byKey.get(x.flight)!) : []]));
    return c.json({ mode: "shadow", open, recent, changes, gate: gateOf(ops), limit: SCHEDULE_OPEN_LIMIT, candidates, flights });
  });

  app.get("/api/schedule/ops/:id", async (c) => {
    const id = (c.req.param("id") ?? "").toUpperCase();
    const op = fold(readLines()).find((x) => x.id === id);
    return op ? c.json({ op, mode: "shadow" }) : c.json({ error: "그런 SCHEDULE 작업이 없음" }, 404);
  });

  app.post("/api/schedule/ops", async (c: Context) => {
    const s = await getSnapshot();
    const body = await c.req.json().catch(() => ({}));
    try {
      const ops = current(s.tickets);
      const lines = draftOps(ops, body, s.tickets, new Date().toISOString(), ops.length);
      append(lines);
      const id = lines[lines.length - 1].id;
      return c.json({ op: fold(readLines()).find((x) => x.id === id), label: `${flightNumber(String(body.flight).toUpperCase())}` });
    } catch (e) {
      if (e instanceof ScheduleError) return c.json({ error: e.message }, e.status as 400);
      throw e;
    }
  });

  app.post("/api/schedule/ops/:id/verdict", async (c: Context) => {
    const id = (c.req.param("id") ?? "").toUpperCase();
    const body = await c.req.json().catch(() => ({}));
    if (body.verdict !== "agree" && body.verdict !== "disagree") return c.json({ error: "verdict는 agree|disagree" }, 400);
    const op = fold(readLines()).find((x) => x.id === id);
    if (!op) return c.json({ error: "그런 SCHEDULE 작업이 없음" }, 404);
    if (op.status !== "draft") return c.json({ error: `지금 상태(${op.status})에서는 판정할 수 없음` }, 409);
    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;
    append([{ op: "verdict", id, at: new Date().toISOString(), verdict: body.verdict, reason }]);
    return c.json({ op: fold(readLines()).find((x) => x.id === id) });
  });
}

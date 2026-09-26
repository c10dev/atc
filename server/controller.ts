import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import { callsign, flightNumber } from "./callsign.ts";
import { awayOperations } from "./away.ts";
import { allClearances, CLEARANCE_TYPES, isPending, issueClearance, markClearance } from "./clearances.ts";
import { config } from "./config.ts";
import { type EventLog, landingKeys } from "./events.ts";
import type { Clearance, ClearanceType, Session, Snapshot, TrafficEvent } from "./model.ts";

// 관제사(1단계, 조언 모드)가 쓰는 API. atc는 판단하지 않고, 브리핑을 주고 지시·복창을 기록만 한다.

const OVERDUE_MS = 10 * 60_000;

function sessionLabel(s: Session | undefined, id: string) {
  return s
    ? { id: s.id, name: s.name, callsign: callsign(s), status: s.status }
    : { id, name: id.slice(0, 8), callsign: id.slice(0, 8), status: "dead" as const };
}

export function buildBrief(
  s: Snapshot,
  since: { events: TrafficEvent[]; reset: boolean; cursor: string },
  clearances: Clearance[],
  now = Date.now(),
) {
  const sessionById = new Map(s.sessions.map((x) => [x.id, x]));
  const label = (id: string) => sessionLabel(sessionById.get(id), id);
  const wsByPath = new Map(s.workspaces.map((w) => [w.path, w]));
  const standName = (path?: string | null) => (path ? (wsByPath.get(path)?.name ?? path.split("/").pop()) : undefined);
  const flight = (key?: string | null) => (key ? flightNumber(key) : undefined);
  const active = s.claims.filter((c) => c.state === "active");
  const codeOf = (repo: string | null | undefined) =>
    repo ? (s.airports.find((a) => a.repo === repo)?.code ?? repo.split("/").pop()) : undefined;
  const away = awayOperations(s);

  const pending = clearances.filter(isPending);
  const clearanceView = (c: Clearance) => ({
    id: c.id,
    to: label(c.to),
    type: c.type,
    stand: standName(c.stand),
    flight: flight(c.flight),
    text: c.text,
    ageMin: Math.round((now - Date.parse(c.at)) / 60_000),
  });

  const landing = landingKeys(s);
  const landingQueue = s.tickets
    .filter((t) => landing.has(t.key))
    .sort((a, b) => (a.updatedAt ?? "").localeCompare(b.updatedAt ?? ""))
    .map((t) => {
      const stands = s.workspaces.filter((w) => w.ticketKey === t.key);
      const lastLand = clearances.filter((c) => c.type === "LAND" && c.flight === t.key && !c.cancelledAt).at(-1);
      return {
        flight: flightNumber(t.key),
        key: t.key,
        title: t.title,
        stands: stands.map((w) => ({
          stand: w.name,
          holders: active.filter((c) => c.workspacePath === w.path).map((c) => label(c.sessionId)),
        })),
        landClearance: lastLand ? { id: lastLand.id, readBack: Boolean(lastLand.readbackAt) } : null,
      };
    });

  const traffic = s.sessions
    .filter((x) => x.status !== "dead" && active.some((c) => c.sessionId === x.id))
    .map((x) => ({
      ...label(x.id),
      home: codeOf(x.repo),
      away: (away.get(x.id) ?? []).map(codeOf),
      stands: active
        .filter((c) => c.sessionId === x.id)
        .map((c) => ({
          stand: standName(c.workspacePath),
          standPath: c.workspacePath,
          airport: codeOf(wsByPath.get(c.workspacePath)?.repo),
          flight: flight(wsByPath.get(c.workspacePath)?.ticketKey),
          source: c.source,
          since: c.since,
          lastAt: c.lastAt,
        })),
    }));

  const alertsOf = (kind: string) => s.alerts.filter((a) => a.kind === kind);
  return {
    at: new Date(now).toISOString(),
    cursor: since.cursor,
    reset: since.reset,
    events: since.events.map((e) => ({
      id: e.id,
      at: e.at,
      kind: e.kind,
      alert: e.alertKind,
      stand: standName(e.workspacePath),
      flight: flight(e.ticketKey),
      sessions: e.sessionIds?.map(label),
      airport: codeOf(e.repo),
      message: e.message,
    })),
    open: {
      conflicts: alertsOf("conflict").map((a) => ({
        stand: standName(a.workspacePath),
        standPath: a.workspacePath,
        // since가 이른 쪽이 먼저 들어온 항공기
        sessions: active
          .filter((c) => c.workspacePath === a.workspacePath && a.sessionIds?.includes(c.sessionId))
          .sort((x, y) => x.since.localeCompare(y.since))
          .map((c) => ({ ...label(c.sessionId), since: c.since, lastAt: c.lastAt })),
      })),
      orphans: alertsOf("orphan").map((a) => ({ stand: standName(a.workspacePath), sessions: a.sessionIds?.map(label) })),
      unattended: alertsOf("unattended").map((a) => ({ stand: standName(a.workspacePath), message: a.message })),
      noContact: alertsOf("no-workspace").map((a) => flight(a.ticketKey)),
    },
    landingQueue,
    clearances: {
      pending: pending.map(clearanceView),
      overdue: pending.filter((c) => now - Date.parse(c.at) > OVERDUE_MS).map((c) => c.id),
    },
    traffic,
  };
}

export function formatClearance(c: Clearance, s: Snapshot): string {
  const target = s.sessions.find((x) => x.id === c.to);
  const who = target ? `${callsign(target)}${callsign(target) !== target.name ? ` (${target.name})` : ""}` : c.toName;
  const stand = c.stand ? (s.workspaces.find((w) => w.path === c.stand)?.name ?? c.stand) : null;
  const where = [stand && `주기장 ${stand}`, c.flight && `편 ${flightNumber(c.flight)}`].filter(Boolean).join(" · ");
  return [
    `[ATC ${c.id}] ${who} · ${c.type}`,
    where,
    c.text,
    `— 받았으면 이 메시지에 "READBACK ${c.id}"로 답장해 주세요.`,
  ]
    .filter(Boolean)
    .join("\n");
}

// 이름 또는 ID로 살아 있는 세션 하나를 찾는다. 이름이 겹치면 모호하다고 거절한다.
export function resolveSession(s: Snapshot, to: string): Session | string {
  const byId = s.sessions.find((x) => x.id === to);
  if (byId) return byId;
  const byName = s.sessions.filter((x) => x.status !== "dead" && (x.name === to || callsign(x) === to.toUpperCase()));
  if (byName.length === 1) return byName[0];
  return byName.length ? `"${to}" 이름의 세션이 ${byName.length}개라 ID로 지정해야 함` : `"${to}" 세션을 찾을 수 없음`;
}

function resolveStand(s: Snapshot, stand: string | undefined): string | null | { error: string } {
  if (!stand) return null;
  const ws = s.workspaces.find((w) => w.path === stand || w.name === stand);
  return ws ? ws.path : { error: `"${stand}" 주기장(워크트리)을 찾을 수 없음` };
}

function normalizeFlight(flight: string | undefined): string | null {
  if (!flight) return null;
  const m = flight.toUpperCase().match(/^([A-Z]+)-?(\d+)$/);
  return m ? `${m[1]}-${Number(m[2])}` : flight;
}

const consumerFile = (name: string) => join(config.stateDir, "consumers", `${name}.json`);

function readCursor(name: string): string | null {
  try {
    return JSON.parse(readFileSync(consumerFile(name), "utf8")).cursor ?? null;
  } catch {
    return null;
  }
}

function writeCursor(name: string, cursor: string) {
  mkdirSync(join(config.stateDir, "consumers"), { recursive: true });
  writeFileSync(consumerFile(name), JSON.stringify({ cursor, at: new Date().toISOString() }) + "\n");
}

export function mountController(app: Hono, getSnapshot: () => Promise<Snapshot>, log: EventLog) {
  const consumerOf = (v: string | undefined) => (v && /^[\w-]+$/.test(v) ? v : "controller");

  app.get("/api/controller/brief", async (c) => {
    const consumer = consumerOf(c.req.query("consumer"));
    const since = log.since(c.req.query("cursor") ?? readCursor(consumer));
    return c.json(buildBrief(await getSnapshot(), since, allClearances()));
  });

  app.post("/api/controller/ack", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (typeof body.cursor !== "string") return c.json({ error: "cursor가 필요함" }, 400);
    writeCursor(consumerOf(body.consumer), body.cursor);
    return c.json({ ok: true, cursor: body.cursor });
  });

  app.post("/api/clearances", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const s = await getSnapshot();
    if (!CLEARANCE_TYPES.includes(body.type)) return c.json({ error: `type은 ${CLEARANCE_TYPES.join("|")} 중 하나` }, 400);
    if (typeof body.text !== "string" || !body.text.trim()) return c.json({ error: "text가 필요함" }, 400);
    const target = resolveSession(s, String(body.to ?? ""));
    if (typeof target === "string") return c.json({ error: target }, 400);
    const stand = resolveStand(s, body.stand);
    if (stand && typeof stand === "object") return c.json(stand, 400);
    const clearance = issueClearance({
      to: target.id,
      toName: target.name,
      type: body.type as ClearanceType,
      stand,
      flight: normalizeFlight(body.flight),
      text: body.text.trim(),
    });
    return c.json({ clearance, sendTo: target.name, message: formatClearance(clearance, s) });
  });

  for (const op of ["readback", "cancel"] as const) {
    app.post(`/api/clearances/:id/${op}`, (c) => {
      const cleared = markClearance(c.req.param("id").toUpperCase(), op);
      return cleared ? c.json({ clearance: cleared }) : c.json({ error: "그런 지시가 없음" }, 404);
    });
  }
}

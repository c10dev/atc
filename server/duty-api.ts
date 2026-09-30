// DUTY L0의 서버 쪽(ATC-219, docs/duty.md 3): `atcctl duty`가 부르는 읽기 경로와 초안 경로.
// 읽기: GET /api/duty/brief. 초안: POST /api/duty/{card,note,charter}는 `duty-drafts.jsonl`(상태 폴더)에 한 줄을 붙일 뿐이고 밖으로 나가는 동작이 없다.
// 프로세스를 띄우지 않는다(D2). Origin을 보는 쓰기 경로도 아니다(atcctl은 브라우저가 아니다, 다른 관제 세션 경로와 같다).
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { loadDispatchConfig } from "./dispatch.ts";
import { briefDecisionsOf, briefMaxCharsOf, dutyBriefOf, type DutyBriefInput } from "./duty-brief.ts";
import { confirmOf, decisionsOf, parseDecisionLines, retireOf } from "./duty-decisions.ts";
import { cardDraftOf, charterDraftOf, type DismissLine, type DraftLine, type DraftResult, nextDraftId, noteDraftOf } from "./duty-drafts.ts";
import { fleetRows } from "./fleet-status.ts";
import { fleetView, loadFleet } from "./fleet.ts";
import type { Snapshot } from "./model.ts";
import { fromThisApp } from "./origin.ts";
import { currentAlerts } from "./supervisor-alerts-run.ts";
import { collectQueueInput } from "./supervisor-queue-run.ts";
import { supervisorQueueView } from "./supervisor-queue.ts";
import type { UpdateStatus } from "./update.ts";

const DRAFTS_FILE = () => join(config.stateDir, "duty-drafts.jsonl");
const DUTY_CONFIG_FILE = () => join(config.stateDir, "duty.json");
const DECISIONS_FILE = () => join(config.stateDir, "decisions.jsonl");
const BODY_MAX = 16 * 1024;

// 브라우저는 다른 사이트의 글도 text/plain POST로 보낼 수 있다. Origin이 있는데 이 컴퓨터가 아니면 거절한다.
// atcctl은 Origin을 보내지 않으니 그대로 통과한다(다른 관제 세션 경로와 같다)
export function foreignOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return false;
  try {
    return !["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname);
  } catch {
    return true;
  }
}

// duty.briefMaxChars(상태 폴더의 duty.json). 없거나 깨졌으면 기본값
export function loadBriefMaxChars(file = DUTY_CONFIG_FILE()): number {
  try {
    return briefMaxCharsOf((JSON.parse(readFileSync(file, "utf8")) as { briefMaxChars?: unknown }).briefMaxChars);
  } catch {
    return briefMaxCharsOf(undefined);
  }
}

// duty.briefDecisions(duty.json). 없거나 깨졌으면 기본값
export function loadBriefDecisions(file = DUTY_CONFIG_FILE()): number {
  try {
    return briefDecisionsOf((JSON.parse(readFileSync(file, "utf8")) as { briefDecisions?: unknown }).briefDecisions);
  } catch {
    return briefDecisionsOf(undefined);
  }
}

const readText = (file: string): string => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
};
const jsonLines = (raw: string): Record<string, unknown>[] =>
  raw.split("\n").flatMap((l) => {
    try {
      const j = JSON.parse(l);
      return j && typeof j === "object" ? [j as Record<string, unknown>] : [];
    } catch {
      return [];
    }
  });
// 초안 줄(id 있는 것)과 버린 초안 번호
function draftsNow(): { drafts: Map<string, Record<string, unknown>>; dismissed: Set<string> } {
  const drafts = new Map<string, Record<string, unknown>>();
  const dismissed = new Set<string>();
  for (const j of jsonLines(readText(DRAFTS_FILE()))) {
    if (j.kind === "dismiss" && typeof j.draft === "string") dismissed.add(j.draft);
    else if (typeof j.id === "string") drafts.set(j.id, j);
  }
  return { drafts, dismissed };
}
const decisionLines = () => parseDecisionLines(readText(DECISIONS_FILE()));

function draftIds(file: string): string[] {
  try {
    return readFileSync(file, "utf8")
      .split("\n")
      .flatMap((l) => {
        try {
          const id = (JSON.parse(l) as { id?: unknown }).id;
          return typeof id === "string" ? [id] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

// onDraft(D3): 받아들인 초안을 대화에 적는 곳(duty-run.ts). 초안 줄을 붙인 뒤에 부른다. 여기에도 승인·거절·머지·보내기 길은 없다
export function mountDuty(app: Hono, getSnapshot: () => Promise<Snapshot>, updateStatus: () => Promise<UpdateStatus | null>, onDraft: (line: DraftLine) => void = () => {}) {
  const queueNow = async (now: number) => supervisorQueueView(await collectQueueInput(await getSnapshot(), updateStatus, now), now);

  app.get("/api/duty/brief", async (c) => {
    const now = Date.now();
    const s = await getSnapshot();
    const queue = supervisorQueueView(await collectQueueInput(s, updateStatus, now), now);
    const teamPattern = loadDispatchConfig().teamPattern;
    const input: DutyBriefInput = {
      at: new Date(now).toISOString(),
      queue,
      alerts: currentAlerts()
        .filter((a) => a.level === "warning" || a.level === "caution")
        .map((a) => ({ key: a.key, level: a.level, aircraft: a.aircraft, flight: a.flight, text: a.text, since: a.since })),
      fleet: fleetRows(fleetView(s, loadFleet(), teamPattern, [], now), now).map((r) => ({
        registration: r.registration,
        status: r.status,
        airport: r.airport,
        account: r.account,
        flight: r.flight?.key ?? null,
        more: r.more,
        fuelHold: r.fuelHold !== null,
      })),
      flights: s.tickets.filter((t) => t.stateType === "started").map((t) => ({ key: t.key, state: t.state })),
      fuel: (s.fuelAccounts ?? []).map((f) => ({ account: f.account ?? f.group, window: f.top.name, pct: f.top.pct, resetsAt: f.top.resetsAt, level: f.level })),
    };
    input.decisions = decisionsOf(decisionLines(), now).active.map((d) => ({ id: d.id, text: d.text, until: d.until }));
    input.decisionsMax = loadBriefDecisions();
    return c.json(dutyBriefOf(input, loadBriefMaxChars()));
  });

  // 정해 둔 결정(D4). 읽기는 누구나(DUTY의 brief와 같은 자료). 쓰기는 이 화면의 클릭뿐(fromThisApp): atcctl은 Origin이 없어 닿지 못한다
  app.get("/api/duty/decisions", (c) => {
    const v = decisionsOf(decisionLines(), Date.now());
    return c.json({ active: v.active, confirmedDrafts: v.confirmedDrafts, dismissed: [...draftsNow().dismissed] });
  });

  const readBody = async (c: import("hono").Context): Promise<Record<string, unknown> | null> => {
    const raw = await c.req.text();
    if (raw.length > BODY_MAX) return null;
    try {
      const p = JSON.parse(raw || "{}");
      return p && typeof p === "object" && !Array.isArray(p) ? p : {};
    } catch {
      return null;
    }
  };
  const append = (file: string, line: object) => {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(line)}\n`);
  };

  // 확정: 초안 note의 글을 그대로 결정으로 적는다(글은 서버가 초안에서 읽는다. 화면이 보낸 글을 쓰지 않는다)
  app.post("/api/duty/decisions", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const body = await readBody(c);
    if (!body || typeof body.draft !== "string") return c.json({ error: "draft(DD-n)가 필요합니다" }, 400);
    const now = Date.now();
    const lines = decisionLines();
    const { drafts, dismissed } = draftsNow();
    const d = drafts.get(body.draft);
    const r = confirmOf(d && { id: body.draft, kind: String(d.kind), text: typeof d.text === "string" ? d.text : undefined, until: typeof d.until === "string" ? d.until : null }, decisionsOf(lines, now), dismissed, lines, now);
    if (!r.ok) return c.json({ error: r.error }, r.status);
    append(DECISIONS_FILE(), r.line);
    return c.json({ decision: r.line });
  });

  // 해제
  app.post("/api/duty/decisions/:id/retire", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const body = await readBody(c);
    if (!body) return c.json({ error: "본문은 JSON이어야 합니다" }, 400);
    const now = Date.now();
    const r = retireOf(c.req.param("id") ?? "", decisionsOf(decisionLines(), now), body.why, now);
    if (!r.ok) return c.json({ error: r.error }, r.status);
    append(DECISIONS_FILE(), r.line);
    return c.json({ decision: r.line });
  });

  // 버림: 초안에 버렸다는 줄을 붙인다. 확정한 초안은 버릴 수 없다
  app.post("/api/duty/drafts/:id/dismiss", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const id = c.req.param("id") ?? "";
    const { drafts, dismissed } = draftsNow();
    const d = drafts.get(id);
    if (!d || d.kind !== "note") return c.json({ error: "버릴 note 초안이 아닙니다" }, 404);
    if (dismissed.has(id)) return c.json({ error: `${id}는 이미 버렸습니다` }, 409);
    if (decisionsOf(decisionLines(), Date.now()).confirmedDrafts[id]) return c.json({ error: `${id}는 이미 확정했습니다` }, 409);
    const line: DismissLine = { kind: "dismiss", draft: id, at: new Date().toISOString() };
    append(DRAFTS_FILE(), line);
    return c.json({ dismissed: id });
  });

  // 초안을 한 줄 붙인다. 받은 모양만 검사하고 밖으로 나가는 동작은 없다
  const draft = (make: (body: Record<string, unknown>, id: string, now: number) => Promise<DraftResult> | DraftResult) => async (c: import("hono").Context) => {
    if (foreignOrigin(c.req.header("origin"))) return c.json({ error: "다른 사이트에서 온 요청은 받지 않습니다" }, 403);
    const raw = await c.req.text();
    if (raw.length > BODY_MAX) return c.json({ error: "body too large" }, 413);
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw || "{}");
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return c.json({ error: "body must be JSON" }, 400);
    }
    const file = DRAFTS_FILE();
    const now = Date.now();
    const r = await make(body, nextDraftId(draftIds(file)), now);
    if (!r.ok) return c.json({ error: r.error }, 400);
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(r.line)}\n`);
    try {
      onDraft(r.line);
    } catch {} // 대화에 적지 못해도 초안은 남았다
    return c.json({ draft: r.line });
  };

  app.post("/api/duty/card", draft(async (b, id, now) => cardDraftOf((await queueNow(now)).items, b.kind, b.key, id, now)));
  app.post("/api/duty/note", draft((b, id, now) => noteDraftOf(b.text, b.until, id, now)));
  app.post("/api/duty/charter", draft((b, id, now) => charterDraftOf(b.text, id, now)));
}

// DUTY L0의 서버 쪽(ATC-219, docs/duty.md 3): `atcctl duty`가 부르는 읽기 경로와 초안 경로.
// 읽기: GET /api/duty/brief. 초안: POST /api/duty/{card,note,charter}는 `duty-drafts.jsonl`(상태 폴더)에 한 줄을 붙일 뿐이고 밖으로 나가는 동작이 없다.
// 프로세스를 띄우지 않는다(D2). Origin을 보는 쓰기 경로도 아니다(atcctl은 브라우저가 아니다, 다른 관제 세션 경로와 같다).
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { loadDispatchConfig } from "./dispatch.ts";
import { briefMaxCharsOf, dutyBriefOf, type DutyBriefInput } from "./duty-brief.ts";
import { cardDraftOf, charterDraftOf, type DraftResult, nextDraftId, noteDraftOf } from "./duty-drafts.ts";
import { fleetRows } from "./fleet-status.ts";
import { fleetView, loadFleet } from "./fleet.ts";
import type { Snapshot } from "./model.ts";
import { currentAlerts } from "./supervisor-alerts-run.ts";
import { collectQueueInput } from "./supervisor-queue-run.ts";
import { supervisorQueueView } from "./supervisor-queue.ts";
import type { UpdateStatus } from "./update.ts";

const DRAFTS_FILE = () => join(config.stateDir, "duty-drafts.jsonl");
const DUTY_CONFIG_FILE = () => join(config.stateDir, "duty.json");
const BODY_MAX = 16 * 1024;

// duty.briefMaxChars(상태 폴더의 duty.json). 없거나 깨졌으면 기본값
export function loadBriefMaxChars(file = DUTY_CONFIG_FILE()): number {
  try {
    return briefMaxCharsOf((JSON.parse(readFileSync(file, "utf8")) as { briefMaxChars?: unknown }).briefMaxChars);
  } catch {
    return briefMaxCharsOf(undefined);
  }
}

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

export function mountDuty(app: Hono, getSnapshot: () => Promise<Snapshot>, updateStatus: () => Promise<UpdateStatus | null>) {
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
    return c.json(dutyBriefOf(input, loadBriefMaxChars()));
  });

  // 초안을 한 줄 붙인다. 받은 모양만 검사하고 밖으로 나가는 동작은 없다
  const draft = (make: (body: Record<string, unknown>, id: string, now: number) => Promise<DraftResult> | DraftResult) => async (c: import("hono").Context) => {
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
    return c.json({ draft: r.line });
  };

  app.post("/api/duty/card", draft(async (b, id, now) => cardDraftOf((await queueNow(now)).items, b.kind, b.key, id, now)));
  app.post("/api/duty/note", draft((b, id, now) => noteDraftOf(b.text, b.until, id, now)));
  app.post("/api/duty/charter", draft((b, id, now) => charterDraftOf(b.text, id, now)));
}

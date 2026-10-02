// QRH shadow의 실행부(ATC-288). 이미 계산된 조건(health, 제안의 undelivered·overdue, GO AROUND, arrivalMissing)을 모아
// 서버 tick마다 쓸고, 처음 보인 조건만 FLIGHT RECORDER에 한 줄(kind "qrh", op "named") 적는다. 새 감지기는 없고 세션이 받는 글도 바꾸지 않는다.
// GET /api/qrh/named?since=는 그 줄을 읽기만 한다.
import type { Hono } from "hono";
import { foldReports, readReports } from "./arrival-report.ts";
import { loadDispatchConfig } from "./dispatch.ts";
import { arrivalMissingOf, followingNow, undeliveredOf } from "./following.ts";
import type { Snapshot } from "./model.ts";
import { allProposals, overdueOf } from "./proposals.ts";
import { type QrhNamedLine, qrhConditionsOf, qrhKey, qrhSweep } from "./qrh.ts";
import { readRecords, record } from "./recorder.ts";
import { regKey } from "./registration.ts";

const DAY = 86_400_000;
const RUN_MS = 10_000; // tick(몇 초)마다 전부 다시 읽지 않는다
let lastRunAt = 0;
let open: Set<string> | null = null; // 적었고 아직 풀리지 않은 id|subject

// 재시작 직후: 하루 안에 적은 줄을 열린 것으로 본다. 아직 참인 조건을 다시 적지 않고, 풀린 것은 첫 쓸기에서 빠진다
function seedOpen(now: number): Set<string> {
  const seed = new Set<string>();
  for (const r of readRecords(now - DAY)) if (r.kind === "qrh" && r.op === "named") seed.add(qrhKey(r.id, r.subject));
  return seed;
}

export function runQrh(s: Snapshot, now = Date.now()) {
  if (now - lastRunAt < RUN_MS) return;
  lastRunAt = now;
  const tp = loadDispatchConfig().teamPattern;
  const proposals = allProposals();
  const conditions = qrhConditionsOf({
    sessions: s.sessions,
    proposals,
    overdue: overdueOf(proposals, now),
    undelivered: undeliveredOf(proposals, now),
    clearances: s.clearances ?? [],
    arrivalMissing: arrivalMissingOf(followingNow(s, now, undefined, false), foldReports(readReports()), now),
    regOf: (name) => regKey(name, tp),
  });
  const swept = qrhSweep(conditions, open ?? seedOpen(now), new Date(now).toISOString());
  for (const line of swept.lines) record(line);
  open = swept.open;
}

// 읽기만 한다. since는 ISO 시각이나 밀리초(기본 24시간 전)
export function sinceOf(raw: string | undefined, now: number): number {
  if (!raw) return now - DAY;
  const n = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
  return Number.isFinite(n) ? n : now - DAY;
}

export function mountQrh(app: Hono) {
  app.get("/api/qrh/named", (c) => {
    const now = Date.now();
    const since = sinceOf(c.req.query("since"), now);
    const lines = readRecords(since).filter((r): r is QrhNamedLine => r.kind === "qrh" && r.op === "named");
    return c.json({ since: new Date(since).toISOString(), count: lines.length, lines });
  });
}

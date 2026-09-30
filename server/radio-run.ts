import type { Hono } from "hono";
import { readReports } from "./arrival-report.ts";
import { readOps as readClearanceOps } from "./clearances.ts";
import { readOps as readCrewChangeOps } from "./crew-change.ts";
import { readJsonl, readMccRecords, RTS_FILE, type RtsRecord } from "./mcc.ts";
import { readOps as readProposalOps } from "./proposals.ts";
import { changedRadio, parseRadioQuery, radioOf, selectRadio, txKey, type Transmission } from "./radio.ts";

// RADIO R1(ATC-170): 기록을 읽어 교신 목록을 만든다. 파일을 읽기만 하고 아무것도 쓰지 않는다.
export function readRadio(): Transmission[] {
  return radioOf({
    clearances: readClearanceOps(),
    proposals: readProposalOps(),
    crewChanges: readCrewChangeOps(),
    reports: readReports(),
    mcc: readMccRecords(),
    rts: readJsonl<RtsRecord>(RTS_FILE()),
  });
}

// SSE `radio` 토픽. 듣는 이가 있을 때만 tick마다 기록을 읽어 새로 생기거나 바뀐 교신을 보낸다.
// 처음 듣는 이가 붙을 때 지금까지의 교신을 조용히 기준으로 삼는다(과거 전체를 다시 보내지 않는다 — GET /api/radio가 준다)
export class RadioFeed {
  private readonly listeners = new Set<(txs: Transmission[]) => void>();
  private seen: Map<string, string> | null = null;
  private readonly read: () => Transmission[];

  constructor(read: () => Transmission[] = readRadio) {
    this.read = read;
  }

  subscribe(l: (txs: Transmission[]) => void): () => void {
    if (!this.seen) this.seen = new Map(this.read().map((t) => [t.id, txKey(t)]));
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
      if (!this.listeners.size) this.seen = null;
    };
  }

  poll() {
    if (!this.listeners.size || !this.seen) return;
    let all: Transmission[];
    try {
      all = this.read();
    } catch {
      return;
    }
    const changed = changedRadio(this.seen, all);
    if (!changed.length) return;
    for (const t of changed) this.seen.set(t.id, txKey(t));
    for (const l of this.listeners) l(changed);
  }
}

// GET /api/radio?since=<iso>&freq=<list>&limit=  — 오래된 것부터(newest last). 기본은 지난 6시간, 상한 MAX_LIMIT
export function mountRadio(app: Hono, read: () => Transmission[] = readRadio) {
  app.get("/api/radio", (c) => {
    const now = Date.now();
    const parsed = parseRadioQuery({ since: c.req.query("since"), freq: c.req.query("freq"), limit: c.req.query("limit") }, now);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const transmissions = selectRadio(read(), parsed.query);
    return c.json({ at: new Date(now).toISOString(), since: new Date(parsed.query.since).toISOString(), transmissions });
  });
}

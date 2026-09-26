import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import type { Snapshot, TrafficEvent } from "./model.ts";

// 블랙박스(비행기록장치). 날짜(UTC)별 JSONL에 추가만 한다. 서버를 재시작해도 남아 지표 계산에 쓴다.
// - event: 스냅샷 차이 이벤트(events.ts)
// - sample: 5분마다 교통량 표본
// - ack: 관제사가 브리핑을 처리함(TOWER가 실제로 운용된 날을 센다)

export interface Sample {
  airborne: number; // 작업 중(busy) 세션
  holding: number; // 대기 중이지만 주기장을 점유한 세션
  claims: number; // 점유(이양 제외)
  conflicts: number;
  alerts: number; // 열린 경보 전체
  landing: number; // 착륙(머지) 대기열 길이
  pendingClearances: number;
}

export type RecordLine =
  | { t: string; kind: "event"; epoch: string; event: TrafficEvent }
  | ({ t: string; kind: "sample" } & Sample)
  | { t: string; kind: "ack"; consumer: string };

const DIR = join(config.stateDir, "flight-recorder");
export const SAMPLE_MS = 5 * 60_000;
const RETENTION_DAYS = 30;

const dayOf = (iso: string) => iso.slice(0, 10);

export function record(line: RecordLine) {
  mkdirSync(DIR, { recursive: true });
  appendFileSync(join(DIR, `${dayOf(line.t)}.jsonl`), JSON.stringify(line) + "\n");
}

export function sampleOf(s: Snapshot): Sample {
  const active = s.claims.filter((c) => c.state === "active");
  const holders = new Set(active.map((c) => c.sessionId));
  return {
    airborne: s.sessions.filter((x) => x.status === "busy").length,
    holding: s.sessions.filter((x) => x.status === "idle" && holders.has(x.id)).length,
    claims: active.length,
    conflicts: s.alerts.filter((a) => a.kind === "conflict").length,
    alerts: s.alerts.length,
    landing: s.tickets.filter((t) => t.state === config.landingState).length,
    pendingClearances: s.clearances.filter((c) => !c.readbackAt && !c.cancelledAt).length,
  };
}

// sinceMs 이후 기록. 해당 날짜 파일만 읽는다.
export function readRecords(sinceMs: number, dir = DIR): RecordLine[] {
  const firstDay = dayOf(new Date(sinceMs).toISOString());
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) >= firstDay).sort();
  } catch {
    return [];
  }
  const out: RecordLine[] = [];
  for (const f of files) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line) continue;
      try {
        const r = JSON.parse(line) as RecordLine;
        if (Date.parse(r.t) >= sinceMs) out.push(r);
      } catch {}
    }
  }
  return out;
}

export function pruneRecords(now = Date.now(), dir = DIR) {
  const cutoff = dayOf(new Date(now - RETENTION_DAYS * 86_400_000).toISOString());
  try {
    for (const f of readdirSync(dir)) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) < cutoff) rmSync(join(dir, f));
  } catch {}
}

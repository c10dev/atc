import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { inSequence } from "./landing.ts";
import type { Snapshot, TrafficEvent } from "./model.ts";

// FLIGHT RECORDER. 날짜(UTC)별 JSONL에 추가만 한다. 서버를 재시작해도 남아 지표 계산에 쓴다.
// - event: 스냅샷 차이 이벤트(events.ts)
// - sample: 5분마다 교통량 표본
// - dispatch: DISPATCH 제안 기록(create / verdict / note / supersede / expire)
// - ack: CONTROLLER가 브리핑을 처리함(TOWER가 실제로 운용된 날을 센다)
// - checkride: SUPERVISOR의 TYPE RATING 부여·회수와 그 근거(checkride.ts)
// - fleet: SUPERVISOR가 AIRCRAFT 세션을 띄우거나 멈춤(session-control.ts)

export interface Sample {
  airborne: number; // 작업 중(busy) 세션
  holding: number; // 대기 중이지만 STAND를 점유한 세션
  claims: number; // 점유(HANDOFF 제외)
  conflicts: number;
  alerts: number; // 열린 경보 전체
  landing: number; // LANDING SEQUENCE(Draft가 아닌 열린 PR) 길이
  pendingClearances: number;
}

export type RecordLine =
  | { t: string; kind: "event"; epoch: string; event: TrafficEvent }
  | ({ t: string; kind: "sample" } & Sample)
  | { t: string; kind: "ack"; consumer: string }
  | { t: string; kind: "dispatch"; op: string; id: string }
  | { t: string; kind: "schedule"; op: string; id: string }
  | { t: string; kind: "landing"; op: string; id: string } // Muse 리뷰(ATC-7)
  // CHECKRIDE 부여·회수: 누가, 추천이었나, 근거(LOGBOOK key·FLIGHT·출처)
  | { t: string; kind: "checkride"; op: "grant" | "revoke"; aircraft: string; rating: string; by: string; recommended: boolean; status: string; reason: string; evidence: string[] }
  // ATFM(docs/atfm.md): 출발 중지 시작·끝, CI 소요 시간, BEHIND 전이, 그림자 판정(eligible, s3-eligible), 되돌린 라벨, 스위치
  // 세션 조종: LAUNCH·STOP 결과(docs/fleet.md 8.5). FLEET PLAN 승인(8.7)은 entry·aog·return·retire도, by는 "FLEET PLAN F-0001"
  | { t: string; kind: "fleet"; op: "launch" | "stop" | "entry" | "aog" | "return" | "retire"; aircraft: string; by: string; ok: boolean; jobId?: string; cwd?: string; permissionMode?: string; model?: string; error?: string }
  // FLEET PLAN 모드 전환(8.7). 4단계가 승인 운용 기간을 잰다
  | { t: string; kind: "fleet-plan"; op: "mode:shadow" | "mode:approval"; by: string }
  // 관제 세션 LAUNCH·STOP(docs/fleet.md 8.5.1)
  | { t: string; kind: "control"; op: "launch" | "stop"; session: string; by: string; ok: boolean; jobId?: string; cwd?: string; error?: string }
  | { t: string; kind: "atfm"; op: string; id?: string; airport?: string; data?: Record<string, unknown> };

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
    landing: s.pulls.filter(inSequence).length,
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

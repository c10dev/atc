import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { inSequence } from "./landing.ts";
import type { Milestone } from "./milestones.ts";
import type { Snapshot, TrafficEvent } from "./model.ts";

// FLIGHT RECORDER. 날짜(UTC)별 JSONL에 추가만 한다. 서버를 재시작해도 남아 지표 계산에 쓴다.
// - event: 스냅샷 차이 이벤트(events.ts)
// - sample: 5분마다 교통량 표본
// - dispatch: DISPATCH 제안 기록(create / verdict / note / supersede / expire)
// - ack: CONTROLLER가 브리핑을 처리함(TOWER가 실제로 운용된 날을 센다)
// - checkride: SUPERVISOR의 TYPE RATING 부여·회수와 그 근거(checkride.ts)
// - fleet: SUPERVISOR가 AIRCRAFT 세션을 띄우거나 멈춤(session-control.ts)
// - milestone: FLIGHT의 OOOI(ATC-123, milestone.out|off|on|in)를 처음 본 때. t는 이정표가 일어난 시각, seenAt은 atc가 처음 본 시각. FLIGHT·이정표마다 한 줄

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
  | { t: string; kind: "milestone"; milestone: Milestone; flight: string; at: string; seenAt: string }
  | { t: string; kind: "dispatch"; op: string; id: string }
  | { t: string; kind: "schedule"; op: string; id: string }
  | { t: string; kind: "flight"; op: "state"; flight: string; by: string; ok: boolean; from: string; to: string; error?: string } // SUPERVISOR가 FLIGHT 상태 버튼으로 Linear 상태를 옮김(DUTY G3). 실패도 적는다
  | { t: string; kind: "pr"; op: "merge"; by: "supervisor"; airport: string; number: number; head: string; ok: boolean; result: string; method?: string; error?: string } // SUPERVISOR가 PR 서랍의 MERGE 버튼으로 user 등급 PR을 머지함(DUTY G2). 거절·실패도 적는다
  | { t: string; kind: "duty"; op: "stand" | "stand-done" | "linear"; by: "DUTY"; ok: boolean; name?: string; action?: "create" | "update" | "comment"; key?: string; state?: string; error?: string } // DUTY L1(D7a): STAND 만들기·치우기, Linear 쓰기(본문은 적지 않는다). 거절·실패도 적는다
  | { t: string; kind: "landing"; op: string; id: string } // 착륙 리뷰(ATC-7, REVIEW 세션)
  // CHECKRIDE 부여·회수: 누가, 추천이었나, 근거(LOGBOOK key·FLIGHT·출처)
  | { t: string; kind: "checkride"; op: "grant" | "revoke"; aircraft: string; rating: string; by: string; recommended: boolean; status: string; reason: string; evidence: string[] }
  // ATFM(docs/atfm.md): 출발 중지 시작·끝, CI 소요 시간, BEHIND 전이, 그림자 판정(eligible, s3-eligible), 되돌린 라벨, 스위치
  // 세션 조종: LAUNCH·STOP 결과(docs/fleet.md 8.5). FLEET PLAN 승인(8.7)은 entry·aog·return·retire도, by는 "FLEET PLAN F-0001"
  // proposal: DISPATCH launch 카드 승인으로 띄웠으면 그 제안 id(ATC-129)
  // reposition(ATC-179): AIRCRAFT의 base를 옮김(STOP·base 쓰기·LAUNCH를 한 사건으로). by는 supervisor | auto, stage는 실패한 단계(precheck는 STOP 전 거절)
  | { t: string; kind: "fleet"; op: "launch" | "stop" | "entry" | "aog" | "return" | "retire" | "account-change" | "reposition"; aircraft: string; by: string; ok: boolean; jobId?: string; cwd?: string; permissionMode?: string; model?: string; account?: string; from?: string; to?: string; error?: string; proposal?: string; stage?: "stop" | "base" | "launch" | "precheck" }
  // REPOSITION 스위치와 그림자(ATC-179): mode는 스위치 바꿈(auto가 flapping으로 approval이 되면 by auto), would는 shadow의 "옮겼을 것"
  | { t: string; kind: "reposition"; op: "mode"; by: string; from: string; to: string; reason?: string }
  | { t: string; kind: "reposition"; op: "would"; aircraft: string; from: string; to: string; reasons: string[] }
  // FLEET PLAN 모드 전환(8.7). 4단계가 승인 운용 기간을 잰다
  | { t: string; kind: "fleet-plan"; op: "mode:shadow" | "mode:approval"; by: string }
  // 관제 세션 LAUNCH·STOP(docs/fleet.md 8.5.1)
  | { t: string; kind: "control"; op: "launch" | "stop"; session: string; by: string; ok: boolean; jobId?: string; tmux?: string; cwd?: string; permissionMode?: string; account?: string; error?: string }
  // CONTROL RECYCLE(ATC-166): atc가 관제 세션을 안전한 순간에 STOP·LAUNCH한 결과(shadow면 result would). 스위치 바꿈은 recycle-mode
  | { t: string; kind: "control"; op: "recycle"; session: string; by: string; mode: "shadow" | "on"; ok: boolean; contextBefore: number; reason: string; result: "recycled" | "would" | "would-wait" | "stop-failed" | "stop-unconfirmed" | "launch-failed"; account?: string; jobId?: string; error?: string; launch?: { ok: boolean; jobId?: string; error?: string }; blocks?: string[] }
  | { t: string; kind: "control"; op: "recycle-mode"; by: string; from: string; to: string }
  // 캡·auto 바꿈(ATC-175): 세션마다 한 줄. from·to는 CAP 토큰(null이면 없음) 또는 auto true·false
  | { t: string; kind: "control"; op: "recycle-caps" | "recycle-auto"; by: string; session: string; from: number | boolean | null; to: number | boolean | null }
  // 그 밖의 백그라운드 세션 STOP(ATC-184): AIRCRAFT도 관제 세션도 아닌 세션을 SUPERVISOR가 FLEET 탭에서 멈춤
  | { t: string; kind: "other"; op: "stop"; session: string; by: string; ok: boolean; jobId: string; cwd?: string; account?: string; error?: string }
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

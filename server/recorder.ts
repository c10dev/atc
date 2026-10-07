import { appendFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { JsonlCache } from "./jsonl-cache.ts";
import type { HandoffRecord } from "./autoland-handoff.ts";
import { config } from "./config.ts";
import { inSequence } from "./landing.ts";
import type { Milestone } from "./milestones.ts";
import type { Snapshot, TrafficEvent } from "./model.ts";
import type { QrhNamedLine } from "./qrh.ts";
import type { LinearCallLine } from "./linear-call.ts";
import type { LivenessLine } from "./job-liveness.ts";

// FLIGHT RECORDER. 날짜(UTC)별 JSONL에 추가만 한다. 서버를 재시작해도 남아 지표 계산에 쓴다.
// - event: 스냅샷 차이 이벤트(events.ts)
// - sample: 5분마다 교통량 표본
// - dispatch: DISPATCH 제안 기록(create / verdict / note / supersede / expire)
// - ack: CONTROLLER가 브리핑을 처리함(TOWER가 실제로 운용된 날을 센다)
// - checkride: SUPERVISOR의 TYPE RATING 부여·회수와 그 근거(checkride.ts)
// - fleet: SUPERVISOR가 AIRCRAFT 세션을 띄우거나 멈춤(session-control.ts)
// - qrh: 서버가 체크리스트를 부를 조건을 처음 본 때(ATC-288, shadow: 보내는 글은 바뀌지 않는다). subject마다 풀릴 때까지 한 줄(qrh.ts)
// - relay: SUPERVISOR RELAY(ATC-271)의 만들기·issued·undeliverable·hand. 글은 싣지 않는다
// - ticket: Linear 상태 변화를 서버가 본 때(ATC-468, op state. 이슈 key, from(처음 본 이슈는 null), to). created → Todo의 유일한 출처
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

// FLOW(ATC-468): 표본 줄에 더하는 DISPATCH 계획의 두 사실. 옛 표본에는 없다("기록 안 됨"이지 0이 아니다). 계획을 못 읽었을 때도 싣지 않는다
export interface SampleFacts {
  available?: number; // 배정 받을 수 있는 놀고 있는 AIRCRAFT 수
  waiting?: number; // 일감이 있는데 아직 배정되지 않은 Todo FLIGHT 수
}

export type RecordLine =
  | { t: string; kind: "event"; epoch: string; event: TrafficEvent }
  | ({ t: string; kind: "sample" } & Sample & SampleFacts)
  | { t: string; kind: "ack"; consumer: string }
  | { t: string; kind: "milestone"; milestone: Milestone; flight: string; at: string; seenAt: string }
  | QrhNamedLine
  | { t: string; kind: "ticket"; op: "state"; key: string; from: string | null; to: string } // t는 서버가 본 시각. from이 null이면 만든 직후(10분 안)에 처음 본 것이다
  | { t: string; kind: "dispatch"; op: string; id: string; via?: string; flight?: string; aircraft?: string; by?: string; ok?: boolean; stage?: "stop" | "launch" | "send"; jobId?: string; error?: string }
  | { t: string; kind: "schedule"; op: string; id: string }
  // SUPERVISOR RELAY(ATC-271): 화면에서 만든 relay와 그 뒤의 표시. 글(text)은 relays.jsonl에만 있고 여기에는 적지 않는다. by는 만든 쪽(supervisor), 표시한 쪽(TOWER 또는 supervisor)
  | { t: string; kind: "relay"; op: "create" | "issued" | "undeliverable" | "hand"; id: string; by: string; to?: string; relayKind?: string; flight?: string | null; clearance?: string; reason?: string }
  // 관제 세션의 DECISION 카드(ATC-352): 올림·답·거둠. 글은 decision-cards.jsonl에만 있다(기본값 진행은 카드가 없어 글도 여기에 적는다)
  | { t: string; kind: "decision"; op: "create" | "answer" | "withdraw"; id: string; by: string; key?: string; pr?: number | null; role?: string; choice?: number | null }
  // K1–K3가 아닌 결정을 세션이 정한 기본값으로 진행한 기록(카드 없음). 글은 여기에만 있다
  | { t: string; kind: "decision"; op: "default"; by: string; key: string; what: string; chose: string }
  | { t: string; kind: "flight"; op: "state"; flight: string; by: string; ok: boolean; from: string; to: string; error?: string } // SUPERVISOR가 FLIGHT 상태 버튼으로 Linear 상태를 옮김(DUTY G3). 실패도 적는다
  | { t: string; kind: "pr"; op: "merge"; by: "supervisor"; airport: string; number: number; head: string; ok: boolean; result: string; method?: string; error?: string } // SUPERVISOR가 PR 서랍의 MERGE 버튼으로 user 등급 PR을 머지함(DUTY G2). 거절·실패도 적는다
  | { t: string; kind: "duty"; op: "stand" | "stand-done" | "linear"; by: "DUTY"; ok: boolean; name?: string; action?: "create" | "update" | "comment"; key?: string; state?: string; error?: string } // DUTY L1(D7a): STAND 만들기·치우기, Linear 쓰기(본문은 적지 않는다). 거절·실패도 적는다
  // DUTY 글의 언어 검사(ATC-510): lang은 글 하나의 검사 결과(checked 줄 중 flagged 줄), lang-flag는 걸린 줄마다 한 줄. 글은 적지 않는다. session은 DUTY 세션 id 앞 8자
  | { t: string; kind: "duty"; op: "lang"; by: "DUTY"; ok: true; session: string | null; checked: number; flagged: number }
  | { t: string; kind: "duty"; op: "lang-flag"; by: "DUTY"; ok: false; session: string | null }
  | { t: string; kind: "landing"; op: string; id: string } // 착륙 리뷰(ATC-7, REVIEW 세션)
  // CHECKRIDE 부여·회수: 누가, 추천이었나, 근거(LOGBOOK key·FLIGHT·출처)
  | { t: string; kind: "checkride"; op: "grant" | "revoke"; aircraft: string; rating: string; by: string; recommended: boolean; status: string; reason: string; evidence: string[] }
  // ATFM(docs/atfm.md): 출발 중지 시작·끝, CI 소요 시간, BEHIND 전이, 그림자 판정(eligible, s3-eligible), 되돌린 라벨, 스위치
  // 세션 조종: LAUNCH·STOP 결과(docs/fleet.md 8.5). FLEET PLAN 승인(8.7)은 entry·aog·return·retire도, by는 "FLEET PLAN F-0001"
  // proposal: DISPATCH launch 카드 승인으로 띄웠으면 그 제안 id(ATC-129)
  // reposition(ATC-179): AIRCRAFT의 base를 옮김(STOP·base 쓰기·LAUNCH를 한 사건으로). by는 supervisor | auto, stage는 실패한 단계(precheck는 STOP 전 거절)
  | { t: string; kind: "fleet"; op: "launch" | "stop" | "entry" | "aog" | "return" | "retire" | "account-change" | "reposition"; aircraft: string; by: string; ok: boolean; jobId?: string; cwd?: string; permissionMode?: string; model?: string; modelFrom?: string; account?: string; from?: string; to?: string; error?: string; proposal?: string; flight?: string; stage?: "stop" | "base" | "launch" | "precheck"; k3?: { release: string; stand: string; entries: string[] } }
  // STALE STOP(ATC-369): FLIGHT가 끝난(머지·ARRIVED) AIRCRAFT가 PENDING·HUNG으로 30분 남아 서버가 멈춘 것. ok는 STOP 결과(세션 기록은 fleet stop 줄이 따로 남는다), mode는 스위치 바꿈
  | { t: string; kind: "policy"; op: "stale-stop"; aircraft: string; ok: boolean; code: "PENDING" | "HUNG"; heldMin: number; flights: string[]; jobId?: string; error?: string }
  | { t: string; kind: "policy"; op: "stale-stop-mode"; by: string; from: string; to: string }
  | { t: string; kind: "policy"; op: "red-main-mode"; by: string; from: string; to: string }
  | { t: string; kind: "policy"; op: "event-loop-lag-mode"; by: string; from: string; to: string }
  | { t: string; kind: "policy"; op: "orphan-flight-mode"; by: string; from: string; to: string }
  | { t: string; kind: "policy"; op: "clearance-moot-mode"; by: string; from: string; to: string }
  | { t: string; kind: "policy"; op: "clearance-ended-mode"; by: string; from: string; to: string } // 받는 세션이 끝난 CLEARANCE 닫기(ATC-567) 스위치
  | { t: string; kind: "policy"; op: "stale-reply-mode"; by: string; from: string; to: string }
  | { t: string; kind: "policy"; op: "readback-hash-mode"; by: string; from: string; to: string }
  | { t: string; kind: "policy"; op: "job-timing-mode"; by: string; from: string; to: string }
  | { t: string; kind: "policy"; op: "warm-start-mode"; by: string; from: string; to: string }
  | { t: string; kind: "policy"; op: "landing-gap-mode"; by: string; from: string; to: string }
  | { t: string; kind: "policy"; op: "control-stop-check-mode"; by: string; from: string; to: string }
  | { t: string; kind: "policy"; op: "control-recycle-carry-mode"; by: string; from: string; to: string } // TOWER CARRY-OVER 스위치(ATC-565)
  | { t: string; kind: "policy"; op: "linear-retry-count"; by: string; from: string; to: string }
  | LinearCallLine // LINEAR CALL(ATC-561): Linear·atc 서버 호출의 실패한 시도·다시 시도·복구·포기. 구간·종류·원인만(글·제목·토큰 없음)
  | { t: string; kind: "policy"; op: "job-liveness-mode"; by: string; from: string; to: string }
  | LivenessLine // JOB LIVENESS(ATC-534): job이 사라진 때(gone)·init에서 죽은 LAUNCH·그 때문에 카드를 다시 띄우거나 넘긴 것(relaunch·handoff)·자동 LAUNCH를 막은 것(hold)
  | { t: string; kind: "policy"; op: "cross-account-release-mode"; by: string; from: string; to: string }
  | { t: string; kind: "policy"; op: "stuck-unserved-mode"; by: string; from: string; to: string }
  | { t: string; kind: "policy"; op: "contest-guard-mode"; by: string; from: string; to: string }
  | { t: string; kind: "policy"; op: "stuck-unserved"; flight: string; why: string; airport: string } // 막힘 알림이 새 문구를 쓴 때(ATC-522): 알림이 새로 올라올 때 한 줄
  | { t: string; kind: "policy"; op: "chat-release-mode"; by: string; from: string; to: string }
  | { t: string; kind: "policy"; op: "chat-release"; event: "refused"; why: "switch-off" | "no-supervisor-turn" | "k-effects"; flight: null }
  | { t: string; kind: "policy"; op: "duplicate-title-mode"; by: string; from: string; to: string }
  | { t: string; kind: "policy"; op: "duplicate-title"; event: "refused" | "override" | "both-fired"; flight: string | null; of: string } // 비슷한 제목 검사(ATC-488): 거절, --same-title-ok로 만든 것, PARKED 표시가 있는데 SUPERVISOR가 둘 다 발권한 것
  | { t: string; kind: "policy"; op: "bg-memory-cap-mode"; by: string; from: string; to: string }
  | { t: string; kind: "policy"; op: "verify-gate-mode"; by: string; from: string; to: string }
  | { t: string; kind: "policy"; op: "autoland-handoff-mode"; by: string; from: string; to: string }
  // AUTOLAND가 SUPERVISOR에게 넘긴 PR(ATC-513): mark(처음 넘김, head마다), done(머지 또는 머지 없이 닫힘), land-sent(넘긴 PR에 팀으로 LAND가 나감, 0이어야 한다). autoland-handoff.jsonl과 같은 줄
  | ({ kind: "handoff" } & HandoffRecord)
  | { t: string; kind: "policy"; op: "verify-remote-mode"; by: string; from: string; to: string }
  | { t: string; kind: "policy"; op: "browser-gate-mode"; by: string; from: string; to: string }
  | { t: string; kind: "policy"; op: "scope-oom"; unit: string; total: number; delta: number } // 백그라운드 session scope 안의 OOM kill(ATC-505): cgroup memory.events의 oom_kill가 늘 때마다 한 줄
  // 서버가 MCC 세션 없이 한 기계적 판단(ATC-556). 입력을 줄에 함께 둔다(autonomy.md 원칙 7): land·refused·recheck는 pr+head, rts는 from→to.
  // recheck는 착륙 뒤 PR을 다시 읽은 결과이고 misfire에 다시 읽으면 막았을 조건이 있다. refused는 서버가 하려다 막힌 것(MCC 세션도 queue에서 본다)
  | { t: string; kind: "mcc-auto"; op: "land"; pr: number; head: string; tier: string }
  | { t: string; kind: "mcc-auto"; op: "refused"; pr: number; head: string; why: string }
  | { t: string; kind: "mcc-auto"; op: "already-landed"; pr: number; head: string; why: string } // 다른 쪽이 먼저 머지함(ATC-563): 실패·오작동이 아니다
  | { t: string; kind: "mcc-auto"; op: "recheck"; pr: number; head: string; misfire: string[] }
  | { t: string; kind: "mcc-auto"; op: "rts"; from: string | null; to: string; result: "started" | "failed"; mode: string; detail?: string }
  | { t: string; kind: "policy"; op: "mcc-server-auto-mode"; by: string; from: string; to: string }
  | { t: string; kind: "policy"; op: "release-parked-mode"; by: string; from: string; to: string }
  // REPOSITION 스위치와 그림자(ATC-179): mode는 스위치 바꿈(auto가 flapping으로 approval이 되면 by auto), would는 shadow의 "옮겼을 것"
  | { t: string; kind: "reposition"; op: "mode"; by: string; from: string; to: string; reason?: string }
  | { t: string; kind: "reposition"; op: "would"; aircraft: string; from: string; to: string; reasons: string[] }
  // FLEET PLAN 모드 전환(8.7). 4단계가 승인 운용 기간을 잰다
  | { t: string; kind: "fleet-plan"; op: "mode:shadow" | "mode:approval" | "auto:on" | "auto:off"; by: string }
  // 관제 세션 LAUNCH·STOP(docs/fleet.md 8.5.1)
  | { t: string; kind: "control"; op: "launch" | "stop"; session: string; by: string; ok: boolean; jobId?: string; tmux?: string; cwd?: string; permissionMode?: string; account?: string; error?: string; unverified?: boolean }
  // CONTROL STOP CHECK(ATC-521): stop의 unverified는 claude stop이 종료 코드 0이었지만 job state.json이 stopped가 되지 않아 ok를 막은 것. stop-check는 그 막음·같은 이름 job 중복 경고·그것이 틀렸다는 표시(contradicted 검사가 뒤늦게 틀렸다, dismissed SUPERVISOR가 오탐 표시)
  | { t: string; kind: "control"; op: "stop-check"; event: "blocked" | "duplicate" | "contradicted" | "dismissed"; session: string; by: string; jobIds: string[]; account?: string | null; state?: string | null; of?: string; detail?: string }
  // CONTROL RECYCLE(ATC-166): atc가 관제 세션을 안전한 순간에 STOP·LAUNCH한 결과(shadow면 result would). 스위치 바꿈은 recycle-mode
  | { t: string; kind: "control"; op: "recycle"; session: string; by: string; mode: "shadow" | "on"; ok: boolean; contextBefore: number; reason: string; result: "recycled" | "would" | "would-wait" | "stop-failed" | "stop-unverified" | "stop-unconfirmed" | "launch-failed"; account?: string; jobId?: string; error?: string; launch?: { ok: boolean; jobId?: string; error?: string }; blocks?: string[]; carried?: string[] }
  | { t: string; kind: "control"; op: "recycle-mode"; by: string; from: string; to: string }
  // 캡·auto 바꿈(ATC-175): 세션마다 한 줄. from·to는 CAP 토큰(null이면 없음) 또는 auto true·false
  | { t: string; kind: "control"; op: "recycle-caps" | "recycle-auto"; by: string; session: string; from: number | boolean | null; to: number | boolean | null }
  // LAUNCH ACCOUNT APPLY NOW(ATC-244): SUPERVISOR가 한 번 눌러 세션을 옮긴 요약(세션마다의 사건은 account-change·recycle). op pending은 기다림의 끝(expired·done·changed)
  | { t: string; kind: "apply-now"; op: "apply" | "pending-end"; by: string; aircraft: string | null; control: string | null; moved: number; failed: number; waiting: number; skipped: number; note?: string }
  // CONTROL SESSIONS 일괄 동작(ATC-255): SUPERVISOR가 한 번 확인하고 누른 LAUNCH ALL·RESTART ALL·STOP ALL·ALIGN의 요약(세션마다의 사건은 launch·stop·recycle 줄). held는 안전 조건으로 하지 않은 것
  | { t: string; kind: "control"; op: "bulk"; by: string; bulk: "launch" | "restart" | "stop" | "align"; force: boolean; ok: boolean; done: number; failed: number; held: number; skipped: number; results: { name: string; action: string; ok: boolean; held?: boolean; skipped?: string; from?: string | null; to?: string | null; jobId?: string; error?: string }[] }
  // 그 밖의 백그라운드 세션 STOP(ATC-184): AIRCRAFT도 관제 세션도 아닌 세션을 SUPERVISOR가 FLEET 탭에서 멈춤
  | { t: string; kind: "other"; op: "stop"; session: string; by: string; ok: boolean; jobId: string; cwd?: string; account?: string; error?: string }
  // LAUNCH MODEL을 바꿈(ATC-279): 설정 창에서 SUPERVISOR가 한 칸을 바꿀 때마다 한 줄. scope default는 key 없음
  // DUTY 컨텍스트 CAP을 바꿈(ATC-496): 설정 창에서 SUPERVISOR가 바꿀 때마다 한 줄. from·to는 duty.json의 cap 토큰(null이면 없음 = 모델로 정함)
  | { t: string; kind: "duty-cap"; by: string; from: number | null; to: number | null }
  | { t: string; kind: "launch-model"; by: string; scope: "default" | "airport" | "aircraft"; key?: string; from: string | null; to: string | null }
  | { t: string; kind: "atfm"; op: string; id?: string; airport?: string; data?: Record<string, unknown> };

// 쓸 때마다 config.stateDir에서 정한다(ATC-564: import 때 고정하면 import 뒤에 상태 폴더를 바꾼 시험이 운영 기록에 쓴다)
const recorderDir = () => join(config.stateDir, "flight-recorder");
export const SAMPLE_MS = 5 * 60_000;
const RETENTION_DAYS = 30;

const dayOf = (iso: string) => iso.slice(0, 10);

export function record(line: RecordLine) {
  const dir = recorderDir();
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${dayOf(line.t)}.jsonl`), JSON.stringify(line) + "\n");
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

// 날짜 파일마다 한 번 파싱하고(자라기만 하면 새 줄만, jsonl-cache.ts, ATC-537) 시각(ms)을 같이 둔다. 거르기만 tick마다 한다
const dayCache = new JsonlCache<{ ms: number; r: RecordLine }>((raw) => {
  const r = raw as RecordLine;
  return { ms: Date.parse(r.t), r };
});

// sinceMs 이후 기록. 해당 날짜 파일만 읽는다.
export function readRecords(sinceMs: number, dir = recorderDir()): RecordLine[] {
  const firstDay = dayOf(new Date(sinceMs).toISOString());
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) >= firstDay).sort();
  } catch {
    return [];
  }
  const out: RecordLine[] = [];
  for (const f of files) {
    for (const { ms, r } of dayCache.read(join(dir, f)).lines) if (ms >= sinceMs) out.push(r);
  }
  return out;
}

export function pruneRecords(now = Date.now(), dir = recorderDir()) {
  const cutoff = dayOf(new Date(now - RETENTION_DAYS * 86_400_000).toISOString());
  try {
    for (const f of readdirSync(dir)) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) < cutoff) rmSync(join(dir, f));
  } catch {}
}

import { type AlertLevel, alertLevel } from "./alert-level.ts";
import { pendingLevelOf, pendingNeedsOf, pendingTextOf, type WaitingCall } from "./pending.ts";
import { registrationOf } from "./registration.ts";
import { attachCommandOf } from "./session-origin.ts";
import type { EndedKey, FollowItem } from "./following.ts";
import type { FollowRow } from "./follow.ts";
import type { Alert, PullRequest, Session, Ticket, Workspace } from "./model.ts";
import type { LandBy } from "./land-by.ts";
import type { RtsRecord } from "./mcc.ts";
import { compareRegistration } from "./registration.ts";
import type { Proposal } from "./proposals.ts";
import { type OverCap, overCapAlertTextOf, recycleAlertTextOf, type RecycleRecord, type WaitStuck, waitAlertTextOf } from "./control-recycle-text.ts";
import { repositionAlertTextOf, type RepositionRecordLike, repositionFlapAlertText } from "./reposition.ts";
import type { ScheduleMode, ScheduleOp } from "./schedule.ts";
import { type CapIdleHint, idleText } from "./other-background.ts";

// SUPERVISOR alerts(ATC-87): 화면을 안 보는 SUPERVISOR에게 알릴 변화의 목록. 새 감지는 없다 — 이미 있는 것(ALERT, FLIGHT FOLLOWING, health, 제안, PR, RTS)의
// 키를 모아 안정된 key로 세울 뿐이다. 서버는 key가 처음 생기거나 사라질 때 `alert` SSE 이벤트를 보내고, 알림·소리는 화면(브라우저)이 정한다.
// 순수 함수만. 읽기는 supervisor-alerts-run.ts

// 알림 종류(화면 설정에서 종류별로 켠다)
export const ALERT_GROUPS = ["health", "alert", "following", "pending", "land", "rts", "recycle", "reposition", "follow"] as const;
export type AlertGroup = (typeof ALERT_GROUPS)[number];

// 어디로 가나(ATC-197, docs/alerting.md 3.1): alerts(지금 있는 조건, 풀릴 때까지), queue(SUPERVISOR가 결정할 것), log(일어난 일)
export type AlertDest = "alerts" | "queue" | "log";

export interface SupervisorAlert {
  key: string; // 같은 일이면 늘 같은 key. 사라졌다 돌아오면 같은 key
  group: AlertGroup;
  // ATC-110의 ALERT 등급. 없으면(옛 항목) 소리 없음
  level: AlertLevel | null;
  // 등급과 별개의 소리: call(SUPERVISOR를 기다리는 새 항목), done(RTS 결과)
  cue: "call" | "done" | null;
  aircraft: string | null;
  flight: string | null;
  text: string; // 한 줄. 화면에 이미 있는 문구만
  next: string; // 다음 한 걸음
  link: string; // 화면 주소(hash): 그 항목이 있는 탭
  since: string | null;
  // 무엇을 청하나(ATC-162, 음성 문구용, 선택). pending|proposal은 `assign`·`release`, pending|schedule은 SCHEDULE 종류를 소문자로(`tail`·`classify` …).
  // key 형식은 그대로다(브라우저·메뉴 막대·atc-app이 key로 중복을 거른다). 다른 항목에는 없다
  ask?: string;
  // 이 항목이 가는 곳(ATC-197). 클라이언트는 A3·A4 전까지 이 칸을 무시한다. key는 그대로다
  dest: AlertDest;
}

// ── 목적지 규칙(ATC-197, docs/alerting.md 3.1) ──
// key의 첫 마디로 정하고, 마디가 더 필요한 것은 아래 함수가 가른다. 새 key 종류를 더하면 DEST_PREFIXES와 여기에도 규칙을 더해야 한다(시험이 이 파일의 key 모양을 읽어 확인한다).
// 순수 함수: 읽는 것은 key와, land 항목의 landBy(PR → 누가 착륙시키나, land-by.ts)뿐이다. 등급 규칙을 새로 두지 않고 landByOf(=deploy/landing-tier.mjs의 등급)를 그대로 쓴다
export const DEST_PREFIXES = ["alert", "pending", "following", "land", "rts", "recycle", "cap", "control", "reposition", "follow"] as const;
export function destOf(item: Pick<SupervisorAlert, "key">, landBy?: ReadonlyMap<string, LandBy>): AlertDest {
  const p = item.key.split("|");
  switch (p[0]) {
    case "alert":
      return "alerts";
    case "pending": // tool·proposal·schedule·humancheck: SUPERVISOR의 결정을 기다린다
      return "queue";
    case "following":
      return item.key.includes("|await-supervisor") ? "queue" : "alerts"; // CAPTAIN이 SUPERVISOR의 go를 기다리는 것은 결정 대기
    case "land": {
      // land|<repo>#<번호>|<head>. SUPERVISOR가 착륙시켜야 하면(landBy supervisor: user 등급, ESCALATE·HOLD, MCC가 착륙시키지 않는 모드, 등급 모름) queue, MCC나 팀이 착륙시키면 log.
      // 자료가 없으면 SUPERVISOR가 볼 수 있게 queue
      const by = landBy?.get(p[1] ?? "");
      return by === "mcc" || by === "holder" ? "log" : "queue";
    }
    case "rts":
      return p[1] === "halted" ? "alerts" : "log"; // rts|halted는 조건, rts|<at>|<result>는 일어난 일
    case "recycle":
      return p[1] === "over" || p[1] === "wait" ? "alerts" : "log"; // recycle|<session>|<t>는 결과
    case "cap":
      return "alerts";
    case "control": // control|down|<session>: 멈춘 채인 관제 세션
      return "alerts";
    case "reposition":
      return p[1] === "stuck" ? "alerts" : "log"; // reposition|stuck|<aircraft>는 조건, 나머지는 결과
    case "follow": // FOLLOW(ATC-278, docs/follow.md 3.5): ready·approve는 SUPERVISOR의 몫(queue), landed·deployed·arrived는 일어난 일(log), stuck·failed는 조건(alerts)
      return p[1] === "ready" || p[1] === "approve" ? "queue" : p[1] === "landed" || p[1] === "deployed" || p[1] === "arrived" ? "log" : "alerts";
    default:
      return "alerts"; // 모르는 종류는 SUPERVISOR가 놓치지 않게 alerts에. 시험이 이 경우를 막는다
  }
}

// ── 조건 항목의 상태 입력(ATC-197). 이벤트가 아니라 지금의 상태에서 만든다: 상태가 풀리면 항목이 저절로 사라진다 ──
export interface RtsHalted {
  since: string;
  reason: string; // mcc.ts rtsStopOf가 돌려준 글
}
export interface ControlDown {
  session: string;
  since: string; // 멈춘 RECYCLE 기록 시각
  reason: string;
}
export interface RepositionStuck {
  aircraft: string;
  since: string;
  to: string;
  error?: string;
}

// 순수: rtsState().stop(ROLLBACK 뒤 멈춤 사유, 없으면 null)과 마지막 RTS 기록 → rts|halted 입력. 모드를 다시 고르면 stop이 null이 되어 사라진다
export function rtsHaltedOf(stop: string | null, last: Pick<RtsRecord, "at"> | null): RtsHalted | null {
  return stop && last ? { since: last.at, reason: stop } : null;
}

// 순수: RECYCLE 기록 → 멈춘 채인 관제 세션. 세션마다 마지막 실행 기록(would·would-wait는 뺀다)이 launch-failed이거나,
// stop-unconfirmed인데 LAUNCH도 안 됐고(launch.ok가 아님), 그 세션이 지금 돌지 않으면(running에 없음) 멈춘 것이다. 다시 뜨거나 뒤에 recycled가 나오면 사라진다
export function controlDownOf(
  recycles: readonly { t: string; session: string; result: string; ok: boolean; error?: string; launch?: { ok: boolean; error?: string } }[],
  running: ReadonlySet<string>,
): ControlDown[] {
  const last = new Map<string, (typeof recycles)[number]>();
  for (const r of [...recycles].sort((a, b) => a.t.localeCompare(b.t))) {
    if (r.result === "would" || r.result === "would-wait") continue;
    last.set(r.session, r);
  }
  const out: ControlDown[] = [];
  for (const r of last.values()) {
    const stopped = r.result === "launch-failed" || (r.result === "stop-unconfirmed" && r.launch !== undefined && !r.launch.ok);
    if (stopped && !running.has(r.session)) out.push({ session: r.session, since: r.t, reason: r.launch?.error ?? r.error ?? r.result });
  }
  return out.sort((a, b) => a.session.localeCompare(b.session));
}

// 순수: REPOSITION 기록 → base는 옮겼는데 LAUNCH가 실패해 세션이 없는 AIRCRAFT. AIRCRAFT마다 마지막 기록이 stage launch의 실패이고, 그 AIRCRAFT가 지금 돌지 않으면(running에 없음) 멈춘 것이다.
// 뒤에 성공 기록이 나오거나 세션이 다시 뜨면(FLEET LAUNCH, DISPATCH의 ABSENT LAUNCH 카드) 사라진다
export function repositionStuckOf(repositions: readonly RepositionRecordLike[], running: ReadonlySet<string>): RepositionStuck[] {
  const last = new Map<string, RepositionRecordLike>();
  for (const r of [...repositions].sort((a, b) => a.t.localeCompare(b.t))) last.set(r.aircraft, r);
  const out: RepositionStuck[] = [];
  for (const r of last.values()) if (!r.ok && r.stage === "launch" && !running.has(r.aircraft)) out.push({ aircraft: r.aircraft, since: r.t, to: r.to, ...(r.error ? { error: r.error } : {}) });
  return out.sort((a, b) => compareRegistration(a.aircraft, b.aircraft)); // ATC-181: REGISTRATION 정렬
}

// FOLLOW(ATC-278): 따라가는 번들의 줄. followBoardOf의 줄을 그대로 읽는다(단계를 다시 세지 않는다). folded 번들의 줄은 넣지 않는다
export type FollowAlertRow = Pick<FollowRow, "key" | "title" | "finished" | "current" | "stages" | "issues" | "proposal" | "ready" | "goAround" | "reverted" | "stuck"> & Partial<Pick<FollowRow, "arrow" | "arrivedAt">>;
export const FOLLOW_LOG_WINDOW_MS = 24 * 3_600_000; // landed·deployed 항목이 남는 시간(그 단계의 시각부터). 시각을 모르면 번들이 접힐 때까지

export interface AlertsInput {
  sessions: (Pick<Session, "id" | "name" | "status" | "health"> & Partial<Pick<Session, "job" | "jobId" | "attachDir">>)[];
  alerts: Alert[];
  workspaces: (Pick<Workspace, "path" | "ticketKey"> & Partial<Pick<Workspace, "name">>)[];
  tickets: Pick<Ticket, "key" | "stateType">[];
  following: Pick<FollowItem, "flight" | "aircraft" | "issues">[];
  proposals: Pick<Proposal, "id" | "kind" | "status" | "flight" | "aircraftName" | "holdAt" | "statusAt">[];
  autoDispatch?: boolean; // 자동 운항(ATC-367): ASSIGN 카드는 서버가 승인하므로 판정 대기 알림이 없다
  pulls: Pick<PullRequest, "repo" | "number" | "title" | "head" | "landing" | "draft" | "ticketKey" | "humanCheck">[];
  rts: Pick<RtsRecord, "at" | "from" | "to" | "result" | "detail"> | null;
  // SCHEDULE 판정(ATC-162): approval 모드에서만 SUPERVISOR 결정을 기다리는 일이다. shadow는 게이트 판정이라 항목이 없다. 없으면 항목 없음
  // CONTROL RECYCLE(ATC-166): 최근 재시작 기록(shadow의 would는 알리지 않는다). 없으면 항목 없음
  recycles?: Pick<RecycleRecord, "t" | "session" | "contextBefore" | "result" | "ok" | "error" | "launch">[];
  waiting?: WaitStuck[]; // CAP을 넘고 waitAlertMin 넘게 재시작하지 못한 세션(ATC-175)
  // REPOSITION(ATC-179): 최근 옮김 기록(자동이면 ADVISORY, 실패는 CAUTION)과 auto가 flapping 때문에 approval로 돌아온 기록
  repositions?: RepositionRecordLike[];
  repositionFlaps?: { t: string; reason: string }[];
  overCap?: (OverCap & { since: string })[]; // CAP을 넘었지만 자동 재시작 대상이 아닌 세션(OCC)
  // ATC-197: 상태에서 만드는 조건 항목 셋(각각 순수 함수 rtsHaltedOf·controlDownOf·repositionStuckOf의 결과)과, land 항목의 목적지를 가르는 PR별 landBy(`<repo>#<번호>` → 누가 착륙시키나)
  rtsHalted?: RtsHalted | null;
  controlDown?: ControlDown[];
  repositionStuck?: RepositionStuck[];
  landBy?: ReadonlyMap<string, LandBy>;
  capIdle?: CapIdleHint[]; // 상한 때문에 LAUNCH가 막힌 채 120분 넘게 논 그 밖의 백그라운드 세션(ATC-184). 알리기만 한다
  schedule?: { mode: ScheduleMode; ops: Pick<ScheduleOp, "id" | "kind" | "flight" | "status" | "statusAt">[] };
  // PENDING approval(ATC-327): 지금(now)과 CAUTION으로 올리는 분(pendingMin), AIRCRAFT(REGISTRATION)별로 기다리는 RADIO 호출. 없으면 전과 같다(ADVISORY)
  pending?: { now: number; pendingMin: number; calls: ReadonlyMap<string, WaitingCall[]>; teamPattern?: string };
  // 주인 없는 조건(ATC-385): 주인 없는 변경(unattended)·종료된 세션의 점유(orphan)가 afterMs(기본 UNOWNED_AFTER_MS) 넘게 그대로면 CAUTION 수에서 빠지고 한 줄(`alert|cleanup`)로 접힌다.
  // since: alertKeyOf → 처음 본 시각(ms). 접힌 key는 ended에 모은다(있으면). 없으면 접지 않는다. 변경은 지우지 않는다 — 알림에서 접을 뿐이다
  unowned?: { now: number; since: ReadonlyMap<string, number>; afterMs?: number; ended?: EndedKey[] };
  follow?: { rows: FollowAlertRow[]; now: number }; // FOLLOW(ATC-278): follow.json에 든 번들의 줄. 없으면 follow 항목 없음
}

// 줄의 FLIGHT FOLLOWING 문제 가운데 알릴 것: warn만. await-supervisor는 결정 대기라 following 그룹이 queue로 보내고, landing-wait·health·stranded는 DUPLICATED로 뺀다
export const stuckIssuesOf = (row: Pick<FollowAlertRow, "issues" | "finished">) => (row.finished ? [] : row.issues.filter((i) => i.severity === "warn" && !DUPLICATED.has(i.code) && i.code !== "await-supervisor"));

// 줄 하나의 follow|stuck(ATC-304, F4). 줄의 F2 막힘 표시(row.stuck)가 있으면 그것을 쓴다: 단계는 stuck.stage, 글은 stuck.text, 시각은 stuck.since.
// F2의 새 한도(Todo 30분, 승인 뒤 발송 없음 10분, ON 뒤 IN 없음 15분)와 READBACK 지연이 이렇게 알림이 된다. landing-wait는 PR 항목이 알리니 줄을 내지 않는다(없으면 FLIGHT FOLLOWING 문제로 돌아간다).
// 표시가 없거나 landing-wait면 F3의 길: warn 문제 가운데 첫 것, 단계는 row.current. 같은 문제를 두 번 세지 않으려고, 표시가 문제 하나를 가리키면(no-pr, pr-not-cleared, undelivered) 그 문제는 "외 n건"에서 뺀다
export interface FollowStuckLine {
  stage: string;
  text: string;
  more: number;
  since: string | null;
  code: string | null; // F2 표시의 code, 문제에서 온 줄이면 그 문제의 code
}
export function stuckLineOf(row: Pick<FollowAlertRow, "issues" | "finished" | "current" | "stuck">): FollowStuckLine | null {
  if (row.finished) return null;
  const issues = stuckIssuesOf(row);
  const m = row.stuck && row.stuck.code !== "landing-wait" ? row.stuck : null;
  if (m) return { stage: m.stage, text: m.text, more: issues.filter((i) => i.code !== m.code).length, since: m.since, code: m.code };
  if (!issues.length) return null;
  return { stage: row.current ?? "todo", text: issues[0]!.text, more: issues.length - 1, since: null, code: issues[0]!.code };
}

// FOLLOWING 문제 가운데 다른 경로가 이미 알리는 것은 뺀다: health·stranded는 ALERT가, landing-wait는 PR 항목이 알린다
const DUPLICATED = new Set<string>(["health", "stranded", "landing-wait"]);

const NEXT_BY_ISSUE: Partial<Record<string, string>> = {
  "await-supervisor": "그 세션에서 직접 go를 친다",
  report: "그 세션의 보고를 읽고 결정한다",
  unable: "UNABLE 사유를 읽고 FLIGHT를 다시 배정한다",
  launch: "LAUNCH 실패 사유를 보고 다시 띄운다",
  undelivered: "그 AIRCRAFT 세션을 확인한다(없으면 LAUNCH). 승인은 그대로라 세션이 돌아오면 다시 보낸다",
  fuel: "ACCOUNT의 FUEL을 확인한다",
};

// F2의 막힘 표시(code)마다 다음 한 걸음(ATC-304). FLIGHT FOLLOWING 문제와 같은 code(undelivered 등)는 NEXT_BY_ISSUE를 쓴다
const NEXT_BY_STUCK: Partial<Record<string, string>> = {
  "approved-not-sent": "DISPATCH 탭에서 발송을 확인한다(승인했는데 OCC가 아직 보내지 않았다)",
  "landed-not-deployed": "UPDATE 바와 RTS 상태를 확인한다(착륙했는데 배포(IN)가 없다)",
  "todo-no-proposal": "DISPATCH 탭에서 이 FLIGHT가 제안이 되지 않은 이유(제외 사유)를 확인한다",
  "sent-no-readback": "RADIO 탭에서 FLIGHT PLAN의 READBACK을 확인한다(AIRCRAFT 세션이 받았는지)",
};

// STAND 이름(ATC-152): 워크트리 이름, 없으면 경로의 마지막 마디
export const standNameOf = (path: string, names: ReadonlyMap<string, string | undefined>) => names.get(path) || path.replace(/\/+$/, "").split("/").pop() || path;

// 주인 없는 조건: 어느 쪽에도 주인(세션)이 없는 STAND의 일. 오래 그대로면 CAUTION이 아니라 정리 줄 하나로 접는다(ATC-385)
export const UNOWNED_KINDS: ReadonlySet<Alert["kind"]> = new Set(["unattended", "orphan"]);
export const UNOWNED_AFTER_MS = 6 * 3_600_000;
export const CLEANUP_KEY = "alert|cleanup";
export const alertKeyOf = (a: Pick<Alert, "key" | "kind" | "workspacePath" | "ticketKey" | "sessionIds">): string =>
  `alert|${a.key ?? [a.kind, a.workspacePath ?? "", a.ticketKey ?? "", (a.sessionIds ?? []).join(",")].join("|")}`;

const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : "?");

export function supervisorAlertsOf(inp: AlertsInput): SupervisorAlert[] {
  const out: Omit<SupervisorAlert, "dest">[] = [];
  const idx = {
    wsByPath: new Map(inp.workspaces.map((w) => [w.path, { ticketKey: w.ticketKey }])),
    ticketByKey: new Map(inp.tickets.map((t) => [t.key, { stateType: t.stateType }])),
  };
  const nameOf = new Map(inp.sessions.map((s) => [s.id, s.name]));
  const standNames = new Map(inp.workspaces.map((w) => [w.path, w.name]));

  const stale: { a: Alert; first: number }[] = [];
  // 1) ALERT(ATC-110 등급 그대로). health 종류는 LIMIT·RESUME·STALLED·NETWORK 같은 AIRCRAFT health
  for (const a of inp.alerts) {
    const ids = a.sessionIds ?? [];
    const aircraft = ids.map((id) => nameOf.get(id)).filter(Boolean).join(", ") || null;
    const health = ids.map((id) => inp.sessions.find((s) => s.id === id)?.health).find(Boolean);
    const key = alertKeyOf(a);
    const first = inp.unowned?.since.get(key);
    if (inp.unowned && UNOWNED_KINDS.has(a.kind) && first !== undefined && inp.unowned.now - first >= (inp.unowned.afterMs ?? UNOWNED_AFTER_MS)) {
      stale.push({ a, first });
      inp.unowned.ended?.push({ key, rule: "unowned-stale" });
      continue;
    }
    out.push({
      key,
      group: a.kind === "health" ? "health" : "alert",
      level: alertLevel(a, idx),
      cue: null,
      aircraft,
      flight: a.ticketKey ?? (a.workspacePath ? (idx.wsByPath.get(a.workspacePath)?.ticketKey ?? null) : null),
      // 키에 STAND 경로가 든 ALERT(주인 없는 변경·종료된 세션의 점유 …)는 어느 STAND인지 문구에 붙인다(ATC-152). 이미 이름이 있으면 그대로
      text: a.workspacePath && !a.message.includes(standNameOf(a.workspacePath, standNames)) ? `${a.message} — ${standNameOf(a.workspacePath, standNames)}` : a.message,
      next: health?.next ?? "",
      link: "#strips",
      since: null,
    });
  }

  // 1b) 오래 주인이 없는 것은 한 줄로(ATC-385): 개수만 센다. 자동으로 지우지 않는다
  if (stale.length) {
    const changes = stale.filter((x) => x.a.kind === "unattended");
    const claims = stale.filter((x) => x.a.kind === "orphan");
    const names = stale.slice(0, 3).map((x) => (x.a.workspacePath ? standNameOf(x.a.workspacePath, standNames) : x.a.message));
    out.push({
      key: CLEANUP_KEY,
      group: "alert",
      level: "advisory",
      cue: null,
      aircraft: null,
      flight: null,
      text: `정리 대기 ${stale.length}건 — 주인 없는 변경 ${changes.length}곳, 종료된 세션의 점유 ${claims.length}곳이 ${Math.round((inp.unowned!.afterMs ?? UNOWNED_AFTER_MS) / 3_600_000)}시간 넘게 그대로 (${names.join(", ")}${stale.length > 3 ? " …" : ""})`,
      next: "STAND를 확인해 커밋·푸시하거나 직접 정리한다. atc는 변경을 지우지 않는다",
      link: "#strips",
      since: new Date(Math.min(...stale.map((x) => x.first))).toISOString(),
    });
  }

  // 2) PENDING: 도구 호출이 승인을 기다린다(SUPERVISOR를 기다리는 새 항목).
  // ATC-327: pendingMin분이 지났거나 그 AIRCRAFT에게 가는 열린 호출이 있으면 CAUTION(키는 그대로라 ACK가 이어진다), 아니면 ADVISORY. 청하는 것(needs)과 붙는 명령을 보인다
  for (const s of inp.sessions) {
    if (s.status === "dead" || s.health?.code !== "PENDING") continue;
    const reg = registrationOf(s.name, inp.pending?.teamPattern);
    const calls = (reg && inp.pending?.calls.get(reg)) || [];
    const now = inp.pending?.now ?? Date.now();
    const level = inp.pending ? pendingLevelOf({ since: s.health.since, now, pendingMin: inp.pending.pendingMin, calls: calls.length }) : "advisory";
    const needs = pendingNeedsOf(s);
    out.push({
      key: `pending|tool|${s.id}|${s.health.since}`,
      group: "pending",
      level,
      cue: "call",
      aircraft: s.name,
      flight: null,
      text: inp.pending ? pendingTextOf({ name: s.name, since: s.health.since, now, calls, needs }) : `${s.name} — PENDING: ${s.health.detail}`,
      next: s.jobId ? `${s.health.next} — ${attachCommandOf(s.jobId, s.attachDir)}` : s.health.next,
      link: "#strips",
      since: s.health.since,
    });
  }

  // 3) FLIGHT FOLLOWING 문제(warn은 CAUTION, info는 ADVISORY)
  // follow|stuck가 같은 문제를 줄 단위로 알리는 FLIGHT는 following 항목을 내지 않는다(이중 알림 없음, ATC-278)
  const followRows = new Map((inp.follow?.rows ?? []).map((r) => [r.key, r]));
  const followStuck = new Set([...followRows.values()].filter((r) => stuckLineOf(r)).map((r) => r.key));
  const followProposals = new Set([...followRows.values()].flatMap((r) => (r.proposal ? [r.proposal] : [])));
  for (const f of inp.following) {
    for (const i of f.issues) {
      if (DUPLICATED.has(i.code)) continue;
      if (followStuck.has(f.flight) && i.severity === "warn" && i.code !== "await-supervisor") continue;
      out.push({
        key: `following|${i.key}`,
        group: "following",
        level: i.severity === "warn" ? "caution" : "advisory",
        cue: null,
        aircraft: f.aircraft,
        flight: f.flight,
        text: i.text,
        next: NEXT_BY_ISSUE[i.code] ?? "FLIGHT FOLLOWING에서 그 FLIGHT를 확인한다",
        link: "#strips",
        since: i.since,
      });
    }
  }

  // 4) SUPERVISOR가 판정할 DISPATCH 제안(HOLD 걸린 것은 사람 결정을 기다리는 게 아니라 선행 FLIGHT를 기다린다)
  for (const p of inp.proposals) {
    if (p.holdAt !== null || (p.status !== "proposed" && p.status !== "agreed" && p.status !== "disagreed")) continue;
    if (inp.autoDispatch && p.kind === "ASSIGN") continue;
    // 따라가는 줄의 제안은 follow|approve로 낸다(pending|proposal을 대신한다, 이중 알림 없음)
    out.push({
      key: followProposals.has(p.id) ? `follow|approve|${p.id}` : `pending|proposal|${p.id}`,
      group: followProposals.has(p.id) ? "follow" : "pending",
      level: "advisory",
      cue: "call",
      aircraft: p.aircraftName,
      flight: p.flight,
      text: `제안 ${p.id} — ${p.flight}${p.aircraftName ? ` → ${p.aircraftName}` : ""} ${p.kind === "RELEASE" ? "RELEASE " : ""}판정 대기`,
      next: "HOME의 QUEUE에서 승인하거나 거절한다",
      link: "#home",
      since: p.statusAt,
      ask: p.kind === "RELEASE" ? "release" : "assign",
    });
  }

  // 4b) SCHEDULE 판정(approval 모드만): 열린 작업(draft·agreed·disagreed)은 SUPERVISOR의 승인·거절을 기다린다
  if (inp.schedule?.mode === "approval") {
    for (const op of inp.schedule.ops) {
      if (op.status !== "draft" && op.status !== "agreed" && op.status !== "disagreed") continue;
      out.push({
        key: `pending|schedule|${op.id}`,
        group: "pending",
        level: "advisory",
        cue: "call",
        aircraft: null,
        flight: op.flight,
        text: `SCHEDULE ${op.id} — ${op.kind}${op.flight ? ` ${op.flight}` : ""} 판정 대기`,
        next: "SCHEDULE 탭에서 승인하거나 거절한다",
        link: "#schedule",
        since: op.statusAt,
        ask: op.kind.toLowerCase(),
      });
    }
  }

  // 5) PR: 착륙할 수 있음(CLEARED), HUMAN CHECK 대기
  for (const pr of inp.pulls) {
    if (pr.draft) continue;
    const id = `${pr.repo}#${pr.number}`;
    if (pr.landing === "CLEARED") {
      out.push({ key: `land|${id}|${pr.head}`, group: "land", level: "advisory", cue: null, aircraft: null, flight: pr.ticketKey, text: `PR #${pr.number} ${pr.title} — CLEARED TO LAND`, next: "착륙시킨다(MCC 또는 머지)", link: "#airports", since: null });
    }
    const hc = pr.humanCheck;
    if (hc?.required && hc.state !== "done") {
      out.push({ key: `pending|humancheck|${id}|${pr.head}`, group: "pending", level: "advisory", cue: "call", aircraft: null, flight: pr.ticketKey, text: `PR #${pr.number} ${pr.title} — HUMAN CHECK 대기`, next: "사람이 확인하고 PR 본문에 적는다", link: "#airports", since: null });
    }
  }

  // 6) RTS 결과(running은 아직 결과가 아니다)
  const r = inp.rts;
  if (r && r.result !== "running") {
    const bad = r.result === "rollback" || r.result === "failed";
    out.push({
      key: `rts|${r.at}|${r.result}`,
      group: "rts",
      level: bad ? "warning" : r.result === "refused" ? "caution" : null,
      cue: r.result === "ok" ? "done" : null,
      aircraft: null,
      flight: null,
      text: `RTS ${short(r.from)} → ${short(r.to)} ${r.result.toUpperCase()}${r.detail ? ` — ${r.detail}` : ""}`,
      next: bad ? "설정 창에서 MCC 모드를 다시 고르기 전에 원인을 본다(docs/mcc.md 6)" : r.result === "refused" ? "UPDATE 바에서 사유를 본다" : "",
      link: "#radar",
      since: r.at,
    });
  }

  // 7) CONTROL RECYCLE: 재시작 성공은 ADVISORY, 실패는 CAUTION(launch-failed는 세션이 멈춘 채라고 말한다)
  for (const r of inp.recycles ?? []) {
    if (r.result === "would" || r.result === "would-wait") continue;
    const w = recycleAlertTextOf(r);
    out.push({ key: `recycle|${r.session}|${r.t}`, group: "recycle", level: r.ok ? "advisory" : "caution", cue: null, aircraft: null, flight: null, text: w.text, next: w.next, link: "#fleet/control", since: r.t });
  }

  // 7c) REPOSITION: 옮긴 것마다 하나. supervisor가 승인한 성공은 SUPERVISOR가 이미 아는 일이라 알리지 않는다(자동과 실패만)
  for (const r of inp.repositions ?? []) {
    if (r.ok && r.by !== "auto") continue;
    const w = repositionAlertTextOf(r);
    out.push({ key: `reposition|${r.aircraft}|${r.t}`, group: "reposition", level: w.level, cue: null, aircraft: r.aircraft, flight: null, text: w.text, next: w.next, link: "#fleet", since: r.t });
  }
  for (const f of inp.repositionFlaps ?? []) {
    const w = repositionFlapAlertText(f.reason);
    out.push({ key: `reposition|flap|${f.t}`, group: "reposition", level: "advisory", cue: null, aircraft: null, flight: null, text: w.text, next: w.next, link: "#automation", since: f.t });
  }

  // 7b) CAP을 넘은 OCC: 재시작하지 않고 알린다(넘어 있는 동안 같은 key)
  for (const o of inp.overCap ?? []) {
    const w = overCapAlertTextOf(o);
    out.push({ key: `recycle|over|${o.session}`, group: "recycle", level: "advisory", cue: null, aircraft: null, flight: null, text: w.text, next: w.next, link: "#fleet/control", since: o.since });
  }

  // 7c) CAP을 넘고 오래 재시작하지 못한 세션(ATC-175): CAUTION. 막는 것이 풀려 재시작하면 저절로 사라진다(같은 key)
  // 상한 자리를 쥔 채 논 세션(ATC-184): ADVISORY. STOP은 SUPERVISOR가 FLEET 탭에서 누를 때만 한다
  for (const h of inp.capIdle ?? []) {
    out.push({
      key: `cap|other|${h.id}`,
      group: "recycle",
      level: "advisory",
      cue: null,
      aircraft: null,
      flight: null,
      text: `그 밖의 백그라운드 세션 ${h.name}이 ${idleText(h.idleMin) ?? "오래"} 놀고 있고 ATC_MAX_LAUNCHED 때문에 LAUNCH(${h.refused})가 막혀 있음`,
      next: "FLEET의 OTHER BACKGROUND SESSIONS에서 그 세션을 STOP할지 정한다(자동으로 멈추지 않는다)",
      link: "#fleet/control",
      since: null,
    });
  }
  for (const w of inp.waiting ?? []) {
    const t = waitAlertTextOf(w);
    out.push({ key: `recycle|wait|${w.session}`, group: "recycle", level: "caution", cue: null, aircraft: null, flight: null, text: t.text, next: t.next, link: "#fleet/control", since: w.since });
  }

  // 8) 조건 항목 셋(ATC-197): 이벤트가 아니라 지금의 상태에서 만든다. 상태가 풀리면 저절로 사라진다(같은 key)
  if (inp.rtsHalted) {
    out.push({
      key: "rts|halted",
      group: "rts",
      level: "warning",
      cue: null,
      aircraft: null,
      flight: null,
      text: `RTS 멈춤 — ${inp.rtsHalted.reason}`,
      next: "원인을 본 뒤 설정 창에서 MCC 모드를 다시 고른다(docs/mcc.md 6). 그때까지 배포되지 않는다",
      link: "#radar",
      since: inp.rtsHalted.since,
    });
  }
  for (const c of inp.controlDown ?? []) {
    out.push({
      key: `control|down|${c.session}`,
      group: "recycle",
      level: "caution",
      cue: null,
      aircraft: null,
      flight: null,
      text: `CONTROL RECYCLE — ${c.session}을 멈췄지만 다시 뜨지 않았음: ${c.reason}`,
      next: "FLEET 탭 CONTROL SESSIONS에서 LAUNCH한다",
      link: "#fleet/control",
      since: c.since,
    });
  }
  for (const r of inp.repositionStuck ?? []) {
    out.push({
      key: `reposition|stuck|${r.aircraft}`,
      group: "reposition",
      level: "caution",
      cue: null,
      aircraft: r.aircraft,
      flight: null,
      text: `REPOSITION — ${r.aircraft}의 base를 ${r.to}로 바꿨지만 LAUNCH가 실패해 세션이 없음${r.error ? ` — ${r.error}` : ""}`,
      next: "FLEET 탭에서 LAUNCH하거나, 다음 DISPATCH의 ABSENT LAUNCH 카드를 승인한다",
      link: "#fleet",
      since: r.since,
    });
  }

  // 9) FOLLOW(ATC-278, docs/follow.md 3.5): 따라가는 줄의 변화. 줄은 followBoardOf가 이미 센 것이다 — 여기서 단계를 다시 세지 않는다
  if (inp.follow) {
    const now = inp.follow.now;
    const rtsBad = inp.rts && (inp.rts.result === "rollback" || inp.rts.result === "failed") ? inp.rts : null;
    const recent = (at: string | null) => !at || now - Date.parse(at) < FOLLOW_LOG_WINDOW_MS;
    const title = (r: FollowAlertRow) => `${r.key}${r.title ? ` ${r.title}` : ""}`;
    for (const r of inp.follow.rows) {
      const base = { group: "follow" as const, aircraft: null, flight: r.key, link: "#follow" };
      if (r.ready && !r.finished) out.push({ ...base, key: `follow|ready|${r.key}`, level: "advisory", cue: "call", text: `${title(r)} — 풀 수 있음(READY)`, next: "FOLLOW 탭에서 Todo로 푼다", since: null });
      const stuck = stuckLineOf(r);
      if (stuck) {
        out.push({ ...base, key: `follow|stuck|${r.key}|${stuck.stage}`, level: "caution", cue: null, text: `${title(r)} — 막힘: ${stuck.text}${stuck.more > 0 ? ` (외 ${stuck.more}건)` : ""}`, next: (stuck.code && (NEXT_BY_STUCK[stuck.code] ?? NEXT_BY_ISSUE[stuck.code])) || "FOLLOW 탭에서 그 FLIGHT를 확인한다", since: stuck.since });
      }
      // 실패: GO AROUND, ROLLBACK 뒤에도 배포되지 않은 착륙, 되돌려진 ON. 한 줄에 사유를 모은다
      const why: string[] = [];
      if (r.goAround && !r.finished) why.push(`GO AROUND ${r.goAround.id}${r.goAround.readbackAt ? "" : " (READBACK 대기)"}`);
      if (rtsBad && r.stages.landed.done && !r.stages.deployed.done && !r.stages.deployed.na && (!r.stages.landed.at || r.stages.landed.at <= rtsBad.at)) why.push(`RTS ${rtsBad.result.toUpperCase()}`);
      if (r.reverted) why.push(`PR #${r.reverted.number}로 되돌려짐`);
      if (why.length) out.push({ ...base, key: `follow|failed|${r.key}`, level: "warning", cue: null, text: `${title(r)} — ${why.join(" · ")}`, next: "FOLLOW 탭에서 그 FLIGHT의 기록을 보고 결정한다", since: r.reverted?.at ?? null });
      // 화살표(발권한 FLIGHT, ATC-382)는 끝에서 한 번만 알린다: IN이 남아 있는 동안은 ON을 따로 알리지 않는다
      if (!r.stages.landed.na && r.stages.landed.done && recent(r.stages.landed.at) && !(r.arrow && !r.stages.deployed.na)) out.push({ ...base, key: `follow|landed|${r.key}`, level: null, cue: null, text: `${title(r)} — 착륙(ON)`, next: "", since: r.stages.landed.at });
      if (!r.stages.deployed.na && r.stages.deployed.done && recent(r.stages.deployed.at)) out.push({ ...base, key: `follow|deployed|${r.key}`, level: null, cue: null, text: `${title(r)} — 배포(IN)`, next: "", since: r.stages.deployed.at });
      // PR 없는 FLIGHT의 끝은 ARRIVED(ATC-382)
      if (r.arrow && r.arrivedAt && recent(r.arrivedAt)) out.push({ ...base, key: `follow|arrived|${r.key}`, level: null, cue: null, text: `${title(r)} — 도착(ARRIVED)`, next: "", since: r.arrivedAt });
    }
  }

  // 같은 key는 한 번만(먼저 나온 것). 마지막에 목적지(dest)를 붙인다
  const seen = new Set<string>();
  return out.filter((a) => !seen.has(a.key) && (seen.add(a.key), true)).map((a) => ({ ...a, dest: destOf(a, inp.landBy) }));
}

// key 차이: 새로 생긴 것과 사라진 key
export interface AlertDiff {
  raised: SupervisorAlert[];
  cleared: string[];
}
export function diffAlerts(prev: ReadonlyMap<string, SupervisorAlert>, next: readonly SupervisorAlert[]): AlertDiff {
  const keys = new Set(next.map((a) => a.key));
  return { raised: next.filter((a) => !prev.has(a.key)), cleared: [...prev.keys()].filter((k) => !keys.has(k)) };
}

// SSE `alert` 이벤트 본문. initial: 연결 직후의 현재 전체(화면은 이걸 기준선으로 삼는다)
export interface AlertEvent extends AlertDiff {
  initial: boolean;
  items: SupervisorAlert[]; // 지금 있는 전체
}

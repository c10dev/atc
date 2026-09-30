import { type AlertLevel, alertLevel } from "./alert-level.ts";
import type { FollowItem } from "./following.ts";
import type { Alert, PullRequest, Session, Ticket, Workspace } from "./model.ts";
import type { RtsRecord } from "./mcc.ts";
import type { Proposal } from "./proposals.ts";
import { type OverCap, overCapAlertTextOf, recycleAlertTextOf, type RecycleRecord, type WaitStuck, waitAlertTextOf } from "./control-recycle-text.ts";
import { repositionAlertTextOf, type RepositionRecordLike, repositionFlapAlertText } from "./reposition.ts";
import type { ScheduleMode, ScheduleOp } from "./schedule.ts";
import { type CapIdleHint, idleText } from "./other-background.ts";

// SUPERVISOR alerts(ATC-87): 화면을 안 보는 SUPERVISOR에게 알릴 변화의 목록. 새 감지는 없다 — 이미 있는 것(ALERT, FLIGHT FOLLOWING, health, 제안, PR, RTS)의
// 키를 모아 안정된 key로 세울 뿐이다. 서버는 key가 처음 생기거나 사라질 때 `alert` SSE 이벤트를 보내고, 알림·소리는 화면(브라우저)이 정한다.
// 순수 함수만. 읽기는 supervisor-alerts-run.ts

// 알림 종류(화면 설정에서 종류별로 켠다)
export const ALERT_GROUPS = ["health", "alert", "following", "pending", "land", "rts", "recycle", "reposition"] as const;
export type AlertGroup = (typeof ALERT_GROUPS)[number];

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
}

export interface AlertsInput {
  sessions: Pick<Session, "id" | "name" | "status" | "health">[];
  alerts: Alert[];
  workspaces: (Pick<Workspace, "path" | "ticketKey"> & Partial<Pick<Workspace, "name">>)[];
  tickets: Pick<Ticket, "key" | "stateType">[];
  following: Pick<FollowItem, "flight" | "aircraft" | "issues">[];
  proposals: Pick<Proposal, "id" | "kind" | "status" | "flight" | "aircraftName" | "holdAt" | "statusAt">[];
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
  capIdle?: CapIdleHint[]; // 상한 때문에 LAUNCH가 막힌 채 120분 넘게 논 그 밖의 백그라운드 세션(ATC-184). 알리기만 한다
  schedule?: { mode: ScheduleMode; ops: Pick<ScheduleOp, "id" | "kind" | "flight" | "status" | "statusAt">[] };
}

// FOLLOWING 문제 가운데 다른 경로가 이미 알리는 것은 뺀다: health·stranded는 ALERT가, landing-wait는 PR 항목이 알린다
const DUPLICATED = new Set<string>(["health", "stranded", "landing-wait"]);

const NEXT_BY_ISSUE: Partial<Record<string, string>> = {
  "await-supervisor": "그 세션에서 직접 go를 친다",
  report: "그 세션의 보고를 읽고 결정한다",
  unable: "UNABLE 사유를 읽고 FLIGHT를 다시 배정한다",
  launch: "LAUNCH 실패 사유를 보고 다시 띄운다",
  fuel: "ACCOUNT의 FUEL을 확인한다",
};

// STAND 이름(ATC-152): 워크트리 이름, 없으면 경로의 마지막 마디
export const standNameOf = (path: string, names: ReadonlyMap<string, string | undefined>) => names.get(path) || path.replace(/\/+$/, "").split("/").pop() || path;

const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : "?");

export function supervisorAlertsOf(inp: AlertsInput): SupervisorAlert[] {
  const out: SupervisorAlert[] = [];
  const idx = {
    wsByPath: new Map(inp.workspaces.map((w) => [w.path, { ticketKey: w.ticketKey }])),
    ticketByKey: new Map(inp.tickets.map((t) => [t.key, { stateType: t.stateType }])),
  };
  const nameOf = new Map(inp.sessions.map((s) => [s.id, s.name]));
  const standNames = new Map(inp.workspaces.map((w) => [w.path, w.name]));

  // 1) ALERT(ATC-110 등급 그대로). health 종류는 LIMIT·RESUME·STALLED·NETWORK 같은 AIRCRAFT health
  for (const a of inp.alerts) {
    const ids = a.sessionIds ?? [];
    const aircraft = ids.map((id) => nameOf.get(id)).filter(Boolean).join(", ") || null;
    const health = ids.map((id) => inp.sessions.find((s) => s.id === id)?.health).find(Boolean);
    out.push({
      key: `alert|${a.key ?? [a.kind, a.workspacePath ?? "", a.ticketKey ?? "", ids.join(",")].join("|")}`,
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

  // 2) PENDING: 도구 호출이 승인을 기다린다(SUPERVISOR를 기다리는 새 항목)
  for (const s of inp.sessions) {
    if (s.status === "dead" || s.health?.code !== "PENDING") continue;
    out.push({
      key: `pending|tool|${s.id}|${s.health.since}`,
      group: "pending",
      level: "advisory",
      cue: "call",
      aircraft: s.name,
      flight: null,
      text: `${s.name} — PENDING: ${s.health.detail}`,
      next: s.health.next,
      link: "#strips",
      since: s.health.since,
    });
  }

  // 3) FLIGHT FOLLOWING 문제(warn은 CAUTION, info는 ADVISORY)
  for (const f of inp.following) {
    for (const i of f.issues) {
      if (DUPLICATED.has(i.code)) continue;
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
    out.push({
      key: `pending|proposal|${p.id}`,
      group: "pending",
      level: "advisory",
      cue: "call",
      aircraft: p.aircraftName,
      flight: p.flight,
      text: `제안 ${p.id} — ${p.flight}${p.aircraftName ? ` → ${p.aircraftName}` : ""} ${p.kind === "RELEASE" ? "RELEASE " : ""}판정 대기`,
      next: "DISPATCH 탭에서 승인하거나 거절한다",
      link: "#dispatch",
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

  // 같은 key는 한 번만(먼저 나온 것)
  const seen = new Set<string>();
  return out.filter((a) => !seen.has(a.key) && (seen.add(a.key), true));
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

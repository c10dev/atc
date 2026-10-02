import type { FollowRow, FollowStage } from "./follow.ts";
import type { Milestones } from "./milestones.ts";
import type { PullRequest, Ticket } from "./model.ts";
import type { SinceLook } from "./since-look.ts";
import type { SupervisorAlert } from "./supervisor-alerts.ts";

// STATUS(ATC-384): "현재 상태"와 "ATC-n 어디까지"에 한 번에 답하는 읽기 전용 요약. 새 감지는 없다 — 보드(FOLLOW), 알림 목록, 발권·OOOI 기록, 스냅샷의 PR을 한 곳에 모은다.
// 어느 세션이 물어도 같은 모양으로 답하도록 모양을 고정한다(project skill `status`가 이것만 읽는다). 순수 함수만. 읽기는 status-run.ts

export const STATUS_V = 1;
const MAX_FLYING = 15;
const MAX_ALERTS = 10;
const MAX_WAITING = 10;
const MAX_TOPIC = 5;
const MAX_TEXT = 160; // 알림 글은 길 수 있다(BLOCKED의 사람 대기 글 등). 한 줄로 읽히게 자른다
const clip = (t: string) => (t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t);

export const STAGE_LABEL: Record<FollowStage, string> = { todo: "TODO", proposed: "PROPOSED", approved: "APPROVED", sent: "SENT", readback: "READBACK", pr: "PR", ci: "CLEARED", landed: "ON", deployed: "IN" };
const ORDER: FollowStage[] = ["todo", "proposed", "approved", "sent", "readback", "pr", "ci", "landed", "deployed"];

export interface StatusFlight {
  key: string;
  title: string | null;
  stage: FollowStage | null;
  stageLabel: string | null;
  now: string; // 지금 어디에 있나 한 줄(보드의 글)
  stuck: string | null; // 막힌 글. 없으면 null
}

export interface StatusPr {
  number: number;
  url: string;
  draft: boolean;
  landing: "CLEARED" | "APPROACH";
  blocks: string[]; // 막는 조건(한국어 한 줄씩, 앞 3개)
  humanCheck: boolean; // 사람 확인을 기다림
}

export interface StatusFocus {
  key: string;
  found: boolean; // 이슈나 보드 줄이 있나
  title: string | null;
  state: string | null; // Linear 상태
  stage: FollowStage | null;
  stageLabel: string | null; // 단계: 보드 줄이 있으면 그것, 없으면 OOOI의 마지막
  now: string | null;
  pr: StatusPr | null; // 열린 PR(Draft보다 아닌 것이 먼저)
  blockers: string[]; // 아직 안 끝난 막는 FLIGHT key
  stuck: string | null;
  next: string | null; // 다음 한 걸음
}

export interface Status {
  v: typeof STATUS_V;
  at: string;
  since: Pick<SinceLook, "since" | "line" | "released" | "landed" | "deployed" | "stuck">; // 마지막 본 뒤(옮기지 않는다)
  flying: StatusFlight[]; // 비행 중(Todo 뒤 IN 전)
  flyingTotal: number;
  waiting: { key: string; text: string; link: string }[]; // 지금 SUPERVISOR의 결정을 기다리는 것(dest queue)
  alerts: { level: "warning" | "caution"; text: string; next: string; flight: string | null }[]; // WARNING·CAUTION
  rts: { result: string; at: string; from: string | null; to: string } | null;
  focus?: StatusFocus; // ?flight=
  topic?: { query: string; flying: StatusFlight[]; waiting: Status["waiting"]; alerts: Status["alerts"]; issues: { key: string; title: string; state: string }[] }; // ?topic=
}

export interface StatusInput {
  at: string;
  sinceLook: SinceLook;
  rows: readonly FollowRow[]; // 모든 번들의 줄
  alerts: readonly Pick<SupervisorAlert, "key" | "level" | "dest" | "text" | "next" | "flight" | "link">[];
  rts: Status["rts"];
  tickets: readonly Pick<Ticket, "key" | "title" | "state" | "stateType" | "blockedBy">[];
  pulls: readonly Pick<PullRequest, "number" | "url" | "ticketKey" | "draft" | "landing" | "blocks" | "humanCheck">[];
  milestones: ReadonlyMap<string, Pick<Milestones, "out" | "off" | "on" | "in">>;
  query?: { flight?: string; topic?: string };
}

const flightOf = (r: FollowRow): StatusFlight => ({ key: r.key, title: r.title, stage: r.current, stageLabel: r.current ? STAGE_LABEL[r.current] : null, now: r.now, stuck: r.stuck?.text ?? null });
const lastOoi = (m: Pick<Milestones, "out" | "off" | "on" | "in"> | undefined): FollowStage | null => (m?.in ? "deployed" : m?.on ? "landed" : m?.off ? "pr" : m?.out ? "sent" : null);

export function statusOf(inp: StatusInput): Status {
  const seen = new Set<string>();
  const rows = inp.rows.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));
  const flyingAll = rows
    .filter((r) => !r.finished && r.current && r.current !== "todo")
    .sort((a, b) => ORDER.indexOf(b.current!) - ORDER.indexOf(a.current!) || a.key.localeCompare(b.key))
    .map(flightOf);
  const waiting = inp.alerts
    .filter((a) => a.dest === "queue")
    .map((a) => ({ key: a.key, text: clip(a.text), link: a.link }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const alerts = inp.alerts
    .filter((a): a is typeof a & { level: "warning" | "caution" } => a.level === "warning" || a.level === "caution")
    .sort((a, b) => Number(b.level === "warning") - Number(a.level === "warning") || a.key.localeCompare(b.key))
    .map((a) => ({ level: a.level, text: clip(a.text), next: clip(a.next), flight: a.flight }));
  const s = inp.sinceLook;
  const out: Status = {
    v: STATUS_V,
    at: inp.at,
    since: { since: s.since, line: s.line, released: s.released, landed: s.landed, deployed: s.deployed, stuck: s.stuck },
    flying: flyingAll.slice(0, MAX_FLYING),
    flyingTotal: flyingAll.length,
    waiting: waiting.slice(0, MAX_WAITING),
    alerts: alerts.slice(0, MAX_ALERTS),
    rts: inp.rts,
  };
  const key = inp.query?.flight?.trim().toUpperCase();
  if (key) out.focus = focusOf(key, inp, rows);
  const topic = inp.query?.topic?.trim();
  if (!key && topic) {
    const q = topic.toLowerCase();
    const has = (...xs: (string | null | undefined)[]) => xs.some((x) => x?.toLowerCase().includes(q));
    out.topic = {
      query: topic,
      flying: flyingAll.filter((f) => has(f.key, f.title, f.now)).slice(0, MAX_TOPIC),
      waiting: waiting.filter((w) => has(w.key, w.text)).slice(0, MAX_TOPIC),
      alerts: alerts.filter((a) => has(a.text, a.flight)).slice(0, MAX_TOPIC),
      issues: inp.tickets
        .filter((t) => t.stateType !== "completed" && t.stateType !== "canceled" && has(t.key, t.title))
        .slice(0, MAX_TOPIC)
        .map((t) => ({ key: t.key, title: t.title, state: t.state })),
    };
  }
  return out;
}

function focusOf(key: string, inp: StatusInput, rows: readonly FollowRow[]): StatusFocus {
  const row = rows.find((r) => r.key === key);
  const t = inp.tickets.find((x) => x.key === key);
  const pull = [...inp.pulls.filter((p) => p.ticketKey === key)].sort((a, b) => Number(a.draft) - Number(b.draft))[0];
  const stage = row?.current ?? lastOoi(inp.milestones.get(key)) ?? null;
  const blockers = (t?.blockedBy ?? []).filter((k) => {
    const b = inp.tickets.find((x) => x.key === k);
    return !b || (b.stateType !== "completed" && b.stateType !== "canceled");
  });
  const pr: StatusPr | null = pull
    ? { number: pull.number, url: pull.url, draft: pull.draft, landing: pull.landing, blocks: pull.blocks.slice(0, 3).map((b) => b.text), humanCheck: Boolean(pull.humanCheck?.required && pull.humanCheck.state !== "done") }
    : null;
  const stuck = row?.stuck?.text ?? null;
  const next = row?.next?.label ?? stuck ?? (pr ? (pr.humanCheck ? "사람 확인(HUMAN CHECK)" : pr.landing === "CLEARED" ? "착륙(머지) 대기" : (pr.blocks[0] ?? "착륙 조건 대기")) : blockers.length ? `막는 FLIGHT ${blockers.join(", ")}` : null);
  return {
    key,
    found: Boolean(row || t),
    title: row?.title ?? t?.title ?? null,
    state: row?.state ?? t?.state ?? null,
    stage,
    stageLabel: stage ? STAGE_LABEL[stage] : null,
    now: row?.now ?? null,
    pr,
    blockers,
    stuck,
    next,
  };
}

import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Context, Hono } from "hono";
import { DONE_RE, GOAL_RE, sectionsOfMd } from "./briefs.ts";
import { flightNumber } from "./callsign.ts";
import { config } from "./config.ts";
import { classLabel, classOf, FLIGHT_TYPES, type FlightType, RATINGS, type Rating, WAKES, type Wake } from "./crew.ts";
import { type Crosscheck, CrosscheckError, type CrosscheckLine, type CrosscheckVerdict, crosscheckRateOf, examplesOf, type HumanDecision, markOf, oneClickOf, parseCrosscheck, type Via, viaOf } from "./crosscheck.ts";
import { candidateTeamsOf, DONE_STATES, isCandidateTicket, loadDispatchConfig, PRIORITY_NAME } from "./dispatch.ts";
import { teamOfKey } from "./linear-keys.ts";
import { type AircraftView, fleetView, loadFleet } from "./fleet.ts";
import { type LogEntry, loadLogbook, type PrLink, prLinkOf } from "./logbook.ts";
import type { Snapshot, Ticket } from "./model.ts";
import { record } from "./recorder.ts";
import { cachedPrBody, fetchPrBody } from "./sources/github.ts";
import { loadLinearProjects, type Milestone } from "./sources/linear-projects.ts";
import { isNetworkKind, type NetworkCtx, NetworkDraftError, type NetworkKind, type NetworkPayload, networkChangesOf, networkSupersedeReason, parseNetwork } from "./network-drafts.ts";
import { routeRows } from "./network.ts";
import { loadRoutes } from "./routes.ts";
import { ofTeams, waypointGapsOf } from "./waypoint-gaps.ts";
import { parseTail, type TailCtx, TailError, type TailPayload, tailCautionOf, tailChangesOf, tailDiffOf, tailSignalsOf, type TailSignal } from "./schedule-tail.ts";
import { readDepartures } from "./departures.ts";
import type { Proposal } from "./proposals.ts";
import { loadTailLabels } from "./sources/linear-labels.ts";
import { judgesViewOf, loadJudges, marksOf, readJudgeLines } from "./judges/store.ts";
import { ackSlips, freshSlipKeys, loadSlipsReported, saveSlipsReported, slipsOf, waypointEtasOf } from "./waypoint-slips.ts";
import { regKey } from "./registration.ts";

// OCC SCHEDULE — OCC가 Linear에 쓸 변경을 초안으로 남긴다. 설계: docs/occ.md 5~7장.
// 작업 종류는 CLASSIFY(분류 라벨), PRIORITIZE(우선순위), NEW(새 이슈), CLOSE(PR이 머지된 FLIGHT를 Done으로),
// TARGET·ROUTE(AIRCRAFT의 FLEET TARGETS·ROUTE 변경, ATC-25 — network-drafts.ts. 지금은 모드와 상관없이 그림자 판정만),
// TAIL(FLIGHT의 tail:TEAM_X, ATC-68 — schedule-tail.ts).
// - S1(mode "shadow"): SUPERVISOR가 "승인했을 것 / 거절했을 것"만 표시한다. 아무것도 Linear에 쓰지 않는다.
// - S2(mode "approval"): SUPERVISOR가 승인하면 atc가 Linear 도구 호출 입력(calls)을 정확히 만들고(release),
//   OCC가 그대로 호출한다. occ/mcp-guard.mjs(linear-guard)가 발부된 입력과 한 글자도 다르지 않은 쓰기만 통과시킨다.
//   다음 Linear 읽기에서 반영이 보이면 APPLIED.

export const SCHEDULE_KINDS = ["CLASSIFY", "PRIORITIZE", "TAIL", "NEW", "CLOSE", "TARGET", "ROUTE"] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

export interface ClassifyPayload {
  type?: FlightType;
  wake?: Wake;
  ratings?: Rating[]; // 붙일 rating 라벨
}
export interface PrioritizePayload {
  priority: 1 | 2 | 3 | 4; // Urgent High Medium Low
}
export interface SimilarTicket {
  key: string;
  title: string;
}
// 새 이슈 초안. SUPERVISOR 요청을 OCC가 vocado 형식 본문으로 옮긴 것(docs/occ.md 5.2)
export interface NewPayload extends ClassifyPayload {
  title: string;
  body: string;
  project: string;
  priority?: PrioritizePayload["priority"];
  tail?: string; // tail:TEAM_X
  parent?: string;
  related?: string[];
  blockedBy?: string[];
  milestone?: { id: string; name: string }; // 그 프로젝트의 마일스톤(WAYPOINT, ATC-8). S2 호출에는 id로 들어간다
  gap?: true; // WAYPOINT gap 초안(ATC-8): 완료 기준 가운데 덮는 이슈가 없는 것을 OCC가 올림
  similar: SimilarTicket[]; // 초안을 쓸 때 atc가 찾은 비슷한 제목(중복 검색 결과)
}
// PR이 머지돼(LOGBOOK ARRIVED) 끝난 FLIGHT를 닫자는 초안. 이슈 상태를 바꾸는 일이라 vocado 규칙상 OCC가 쓰지 않는다 —
// 승인되면 SUPERVISOR가 Linear에서 직접 Done으로 바꾼다(docs/occ.md 5장). payload는 atc가 LOGBOOK에서 채운다.
export interface ClosePayload {
  pr: { repo: string; number: number; url: string };
  mergedAt: string;
  fixes?: boolean; // PR 본문에 `Fixes VOC-n` — vocado 규칙상 이것만 이슈를 끝낸다
  partOf?: boolean; // PR 본문에 `Part of VOC-n` — 일부만. 후보에서는 빠지고, 초안이면 "일부만"으로 보인다
}
export type SchedulePayload = ClassifyPayload | PrioritizePayload | TailPayload | NewPayload | ClosePayload | NetworkPayload;
export type { TailPayload } from "./schedule-tail.ts";

// TARGET·ROUTE는 Linear 쓰기 게이트(판정 20건·합의율 80%)와 CROSSCHECK 일치율에 넣지 않고 따로 센다(docs/fleet.md 7.4)
export const countsForGate = (s: Pick<ScheduleOp, "kind">) => !isNetworkKind(s.kind);
// TARGET·ROUTE의 S2 적용(fleet.json 쓰기)은 아직 없다 — approval 모드에서도 그림자 판정만 받는다
export const NETWORK_APPLY_WHY = "TARGET·ROUTE는 아직 그림자 판정만 — 승인해도 fleet.json에 쓰는 길이 없음(docs/fleet.md 7.4)";

// CLOSE는 발부하지 않는다(Linear 상태 변경은 vocado 규칙상 OCC 몫이 아님). 나중에 규칙이 바뀌면 여기서 켠다(docs/occ.md 5.3)
export const CLOSE_RELEASE_WHY = "CLOSE는 SUPERVISOR가 Linear에서 직접 — vocado 규칙상 OCC는 상태를 바꾸지 않음";

export type ScheduleStatus = "draft" | "agreed" | "disagreed" | "approved" | "rejected" | "released" | "applied" | "superseded" | "expired";
export type ScheduleMode = "shadow" | "approval";

// OCC가 그대로 부를 Linear MCP 도구 호출 하나. input은 도구 입력 그대로(linear-guard가 이것과 비교한다).
export interface LinearCall {
  tool: "save_issue" | "save_comment";
  input: Record<string, unknown>;
}

export interface ScheduleOp {
  id: string; // "S-0001"
  kind: ScheduleKind;
  flight: string | null; // NEW는 null(아직 없는 이슈)
  payload: SchedulePayload;
  reason: string; // OCC의 근거 한 줄
  at: string;
  status: ScheduleStatus;
  statusAt: string;
  verdictReason: string | null; // 거절 사유, SUPERSEDED·EXPIRED 사유
  calls: LinearCall[] | null; // S2: release 때 atc가 만든 Linear 호출
  used?: number[]; // linear-guard가 이미 한 번 통과시킨 호출의 번호(calls 안의 위치). 같은 호출은 두 번 통과하지 않는다
  appliedRef: string | null; // APPLIED: 반영된 FLIGHT key(NEW면 새로 생긴 이슈)
  decision: { verdict: CrosscheckVerdict; at: string } | null; // SUPERVISOR 판정(verdict·approve·reject). 뒤 상태로 넘어가도 남는다
  crosscheck: Crosscheck | null; // CROSSCHECK 예비 판정(참고 표시, 상태를 바꾸지 않는다)
  via?: Via; // SUPERVISOR 판정을 어떻게 내렸나(옛 기록에는 없다)
}

type LogLine =
  | { op: "draft"; id: string; at: string; kind: ScheduleKind; flight: string | null; payload: SchedulePayload; reason: string }
  | { op: "verdict"; id: string; at: string; verdict: "agree" | "disagree"; reason: string | null; via?: Via }
  | { op: "supersede"; id: string; at: string; reason: string }
  | { op: "expire"; id: string; at: string; reason?: string }
  | { op: "approve"; id: string; at: string; via?: Via }
  | { op: "reject"; id: string; at: string; reason: string | null; via?: Via }
  | { op: "release"; id: string; at: string; calls: LinearCall[] }
  | { op: "apply"; id: string; at: string; ref: string }
  | { op: "use"; id: string; at: string; call: number }
  | ({ op: "crosscheck"; id: string } & CrosscheckLine);

export const SCHEDULE_OPEN_LIMIT = 5; // 결정 안 된 초안 최대 수(SUPERVISOR 검토 부담)
const TTL_MS = 3 * 86_400_000; // 3일 동안 판정이 없으면 EXPIRED
const GATE = { decided: 20, agreement: 0.8 };

const FILE = () => join(config.stateDir, "schedule.jsonl");
const MODE_FILE = () => join(config.stateDir, "schedule.json");

export function loadScheduleMode(file = MODE_FILE()): ScheduleMode {
  try {
    return JSON.parse(readFileSync(file, "utf8")).mode === "approval" ? "approval" : "shadow";
  } catch {
    return "shadow";
  }
}

function saveScheduleMode(mode: ScheduleMode, file = MODE_FILE()) {
  let user: Record<string, unknown> = {};
  try {
    user = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...user, mode }, null, 2) + "\n");
  renameSync(tmp, file);
}

export class ScheduleError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// 상태 전이. 여기 없는 전이는 무시한다(API도 같은 규칙으로 검사한다).
type StatusLine = Exclude<LogLine["op"], "draft" | "crosscheck" | "use">;
const NEXT: Partial<Record<ScheduleStatus, Partial<Record<StatusLine, ScheduleStatus>>>> = {
  draft: { verdict: "agreed", approve: "approved", reject: "rejected", supersede: "superseded", expire: "expired" },
  approved: { release: "released", supersede: "superseded", expire: "expired" },
  released: { release: "released", apply: "applied", supersede: "superseded", expire: "expired" },
};
export const canApplyOp = (s: Pick<ScheduleOp, "status">, op: StatusLine) => Boolean(NEXT[s.status]?.[op]);

// SUPERVISOR 판정과 그 사유. 사유는 판정한 상태에 머물러 있을 때만(approved 뒤의 verdictReason은 SUPERSEDED·EXPIRED 사유다)
export function humanOf(s: ScheduleOp): HumanDecision | null {
  if (!s.decision || s.via === "atfm") return null; // 자동 판정(ATFM)은 사람 판정으로 세지 않는다
  const reason = (s.status === "agreed" || s.status === "disagreed" || s.status === "rejected") && s.verdictReason ? s.verdictReason : null;
  return { ...s.decision, reason, ...(s.via ? { via: s.via } : {}) };
}

export function fold(lines: LogLine[]): ScheduleOp[] {
  const byId = new Map<string, ScheduleOp>();
  for (const l of lines) {
    if (l.op === "draft") {
      byId.set(l.id, { id: l.id, kind: l.kind, flight: l.flight, payload: l.payload, reason: l.reason, at: l.at, status: "draft", statusAt: l.at, verdictReason: null, calls: null, appliedRef: null, decision: null, crosscheck: null });
      continue;
    }
    const s = byId.get(l.id);
    if (!s) continue;
    if (l.op === "crosscheck") {
      // 열린 초안에만. 나중 mark가 앞의 것을 대신한다
      if (s.status === "draft") s.crosscheck = markOf(l);
      continue;
    }
    if (l.op === "use") {
      // 발부된 호출이 linear-guard를 통과함. 상태는 그대로(APPLIED는 Linear 조회로 판정)
      if (s.status === "released" && s.calls?.[l.call] && !(s.used ?? []).includes(l.call)) s.used = [...(s.used ?? []), l.call];
      continue;
    }
    if (!canApplyOp(s, l.op)) continue; // 닫힌 초안은 바꾸지 않는다
    if (l.op === "verdict") s.decision = { verdict: l.verdict, at: l.at };
    else if (l.op === "approve" || l.op === "reject") s.decision = { verdict: l.op === "approve" ? "agree" : "disagree", at: l.at };
    if ((l.op === "verdict" || l.op === "approve" || l.op === "reject") && l.via) s.via = l.via;
    s.status = l.op === "verdict" && l.verdict === "disagree" ? "disagreed" : NEXT[s.status]![l.op]!;
    s.statusAt = l.at;
    if (l.op === "verdict" || l.op === "reject" || l.op === "supersede") s.verdictReason = l.reason;
    else if (l.op === "expire") s.verdictReason = l.reason ?? "3일 동안 판정 없음";
    else if (l.op === "release") s.calls = l.calls;
    else if (l.op === "apply") s.appliedRef = l.ref;
  }
  return [...byId.values()];
}

// 키 순서와 상관없이 같은 값인가(JSON 값만. occ/mcp-guard.mjs의 sameJson과 같다)
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const oa = a as Record<string, unknown>;
    const ob = b as Record<string, unknown>;
    const ka = Object.keys(oa).filter((k) => oa[k] !== undefined).sort();
    const kb = Object.keys(ob).filter((k) => ob[k] !== undefined).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && sameJson(oa[k], ob[k]));
  }
  return false;
}

// linear-guard의 한 번 쓰기: 도구·입력이 같은, 아직 쓰지 않은 발부 호출을 찾는다(순수).
// 같은 호출이 이미 한 번 통과했으면 막는다 — 반복 호출로 댓글·이슈가 두 번 생기지 않게.
export function claimOf(ops: ScheduleOp[], mode: ScheduleMode, tool: unknown, input: unknown): { id: string; call: number } | { error: string } {
  if (mode !== "approval") return { error: "SCHEDULE이 S1(shadow) — Linear에 쓰지 않는다" };
  let usedMatch: string | null = null;
  for (const op of ops) {
    if (op.status !== "released" || !op.calls) continue;
    for (const [i, c] of op.calls.entries()) {
      if (c.tool !== tool || !sameJson(c.input, input ?? {})) continue;
      if ((op.used ?? []).includes(i)) usedMatch ??= op.id;
      else return { id: op.id, call: i };
    }
  }
  if (usedMatch) return { error: `${usedMatch}의 이 호출은 이미 한 번 통과함 — 같은 쓰기를 두 번 하지 않는다. Linear에 반영이 안 됐으면 SUPERVISOR에게 보고` };
  return { error: "입력이 발부된 SCHEDULE 호출과 다름 — `atcctl schedule release`가 준 입력을 그대로 써야 함" };
}

function readLines(file = FILE()): LogLine[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: LogLine[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {}
  }
  return out;
}

// 접은 SCHEDULE 작업 전부(CHECKRIDE가 받아들인 CLASSIFY의 rating을 읽는다)
export const loadScheduleOps = (file = FILE()) => fold(readLines(file));

function append(lines: LogLine[], file = FILE()) {
  if (!lines.length) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  for (const l of lines) record({ t: l.at, kind: "schedule", op: l.op, id: l.id });
}

const isOpenTicket = (t: Ticket | undefined) => Boolean(t && (t.stateType === "unstarted" || t.stateType === "backlog"));

// 초안이 지금 티켓에 적용하면 무엇이 바뀌는지. 바뀌는 게 없으면 빈 배열. NEW는 티켓 없이 한 줄.
// TARGET·ROUTE는 티켓 대신 그 AIRCRAFT의 FLEET 보기(view)와 비교한다.
export function changesOf(
  kind: ScheduleKind,
  payload: SchedulePayload,
  t?: Pick<Ticket, "labels" | "priority"> & Partial<Pick<Ticket, "state" | "stateType">>,
  view?: Parameters<typeof networkChangesOf>[2],
): string[] {
  if (isNetworkKind(kind)) return networkChangesOf(kind, payload as NetworkPayload, view);
  if (kind === "NEW") {
    const n = payload as NewPayload;
    const labels = [n.type && `type:${n.type}`, n.wake && `wake:${n.wake}`, ...(n.ratings ?? []).map((r) => `rating:${r}`), n.tail && `tail:${n.tail}`].filter(Boolean);
    return [[`새 이슈: ${n.title}`, n.project, n.milestone && `WAYPOINT ${n.milestone.name}`, n.priority ? PRIORITY_NAME[n.priority] : "없음", labels.join(" ")].filter(Boolean).join(" · ")];
  }
  if (!t) return [];
  if (kind === "CLOSE") {
    const c = payload as ClosePayload;
    if (DONE_STATES.has(t.stateType ?? "")) return [];
    const repo = c.pr.repo.split("/").pop();
    return [`${t.state ?? "?"} → Done · PR ${repo}#${c.pr.number} 머지 ${c.mergedAt.slice(0, 10)}${c.partOf ? " · Part of(일부만)" : c.fixes ? " · Fixes" : ""}`];
  }
  if (kind === "PRIORITIZE") {
    const p = (payload as PrioritizePayload).priority;
    return t.priority === p ? [] : [`priority ${PRIORITY_NAME[t.priority] ?? "없음"} → ${PRIORITY_NAME[p]}`];
  }
  if (kind === "TAIL") return tailChangesOf(t.labels, (payload as TailPayload).registration);
  const c = classOf(t.labels);
  const want = payload as ClassifyPayload;
  const out: string[] = [];
  if (want.type && !(c.explicit.type && c.type === want.type)) out.push(`type:${want.type}`);
  if (want.wake && !(c.explicit.wake && c.wake === want.wake)) out.push(`wake:${want.wake}`);
  for (const r of want.ratings ?? []) if (!c.ratings.includes(r)) out.push(`rating:${r}`);
  return out;
}

function parsePriority(v: unknown): PrioritizePayload["priority"] {
  const p = Number(v);
  if (![1, 2, 3, 4].includes(p)) throw new ScheduleError("priority는 1(Urgent)·2(High)·3(Medium)·4(Low)");
  return p as PrioritizePayload["priority"];
}

// type·wake·ratings(CLASSIFY와 NEW 공용). 주어진 것만 담는다.
function parseClass(raw: Record<string, unknown>): ClassifyPayload {
  const payload: ClassifyPayload = {};
  if (raw.type != null) {
    const v = String(raw.type).toUpperCase();
    if (!(FLIGHT_TYPES as readonly string[]).includes(v)) throw new ScheduleError(`모르는 FLIGHT TYPE: ${v}`);
    payload.type = v as FlightType;
  }
  if (raw.wake != null) {
    const v = String(raw.wake).toUpperCase();
    if (!(WAKES as readonly string[]).includes(v)) throw new ScheduleError(`모르는 WAKE: ${v}`);
    payload.wake = v as Wake;
  }
  if (raw.ratings != null) {
    const list = (Array.isArray(raw.ratings) ? raw.ratings : [raw.ratings]).map((r) => String(r).toUpperCase());
    const bad = list.find((r) => !(RATINGS as readonly string[]).includes(r));
    if (bad) throw new ScheduleError(`모르는 TYPE RATING: ${bad}`);
    if (list.length) payload.ratings = [...new Set(list as Rating[])];
  }
  return payload;
}

// 입력을 검사해 payload로 만든다(CLASSIFY·PRIORITIZE). NEW는 parseNew.
export function parsePayload(kind: unknown, raw: Record<string, unknown>): { kind: "CLASSIFY" | "PRIORITIZE"; payload: ClassifyPayload | PrioritizePayload } {
  if (kind === "NEW") throw new ScheduleError("NEW는 parseNew로 검사한다");
  if (kind === "CLOSE") throw new ScheduleError("CLOSE의 payload는 atc가 LOGBOOK에서 채운다(draftOps)");
  if (kind === "TAIL") throw new ScheduleError("TAIL은 parseTail로 검사한다");
  if (isNetworkKind(kind)) throw new ScheduleError(`${kind}는 parseNetwork로 검사한다`);
  if (!SCHEDULE_KINDS.includes(kind as ScheduleKind)) throw new ScheduleError(`모르는 SCHEDULE 작업: ${kind} (가능: ${SCHEDULE_KINDS.join(", ")})`);
  if (kind === "PRIORITIZE") return { kind, payload: { priority: parsePriority(raw.priority) } };
  const payload = parseClass(raw);
  if (!payload.type && !payload.wake && !payload.ratings) throw new ScheduleError("CLASSIFY에는 type·wake·rating 중 하나 이상이 필요함");
  return { kind: "CLASSIFY", payload };
}

// NEW 본문 칸(ATC-32 DIRECT). 목표(Goal·Outcome)와 완료 기준(Acceptance·Done criteria·Done when)만 필수다.
// rating:SEC는 이 작업만의 보안 한계를 적은 Hard constraints 줄이 더 있어야 한다(예: "staging에 적용하지 않음").
// 수정 허용 범위·금지 사항·Invariants·Verification은 써도 되지만 필수가 아니다. 늘 지키는 규칙은
// vocado CLAUDE.md·AGENTS.md·guard·브랜치 보호에 있고 이슈마다 되풀이하지 않는다.
// 칸 제목은 마크다운 제목(`## 목표`), 굵은 줄(`**Goal:** …`), 평문 이름표(`완료 기준: …`) 모두 된다(briefs.ts labelOf).
// 제목만 있고 내용이 비면 없는 칸으로 본다.
const BODY_SECTIONS: [string, RegExp][] = [
  ["목표", GOAL_RE],
  ["완료 기준", DONE_RE],
];
export const HARD_CONSTRAINTS_RE = /^(?:hard\s+constraints|필수\s*제약)/;
const SEC_SECTIONS: [string, RegExp][] = [["Hard constraints", HARD_CONSTRAINTS_RE]];
export function missingSections(body: string, sec = false): string[] {
  const filled = sectionsOfMd(body).filter((x) => x.text).map((x) => x.title);
  const need = sec ? [...BODY_SECTIONS, ...SEC_SECTIONS] : BODY_SECTIONS;
  return need.filter(([, re]) => !filled.some((h) => re.test(h))).map(([name]) => name);
}

// 제목 비교용: NFKC, 소문자, 글자·숫자 밖은 공백
export const normTitle = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const STOP = new Set(["the", "and", "for", "with", "from", "into", "only", "not", "of", "to", "in", "on", "a", "an", "is", "be"]);
const JOSA = /(?:에서|으로|부터|까지|을|를|이|가|은|는|의|에|로|와|과|도)$/;
// 제목 토큰: 두 글자 이상, 영어 불용어 빼고, 한국어 끝 조사 하나 떼기
export function titleTokens(title: string): Set<string> {
  const out = new Set<string>();
  for (let w of normTitle(title).split(" ")) {
    if (/\p{Script=Hangul}/u.test(w) && w.length > 2) w = w.replace(JOSA, "");
    if (w.length >= 2 && !STOP.has(w)) out.add(w);
  }
  return out;
}

const SIMILAR_WINDOW_MS = 45 * 86_400_000;
// 비슷한 제목(중복 후보). 대상: 열린 티켓 + 45일 안에 만들어졌거나 바뀐 티켓.
// 규칙: 정규화한 제목이 같거나, 겹치는 토큰이 2개 이상이고 겹침 계수(겹침 ÷ 짧은 쪽 토큰 수)가 0.5 이상.
// 점수 높은 순(같으면 key 순)으로 5개까지.
export function similarTickets(title: string, tickets: Ticket[], nowMs: number): SimilarTicket[] {
  const want = titleTokens(title);
  const norm = normTitle(title);
  const recent = (v: string | null) => v != null && nowMs - Date.parse(v) <= SIMILAR_WINDOW_MS;
  const scored: { key: string; title: string; score: number }[] = [];
  for (const t of tickets) {
    if (DONE_STATES.has(t.stateType) && !recent(t.updatedAt) && !recent(t.createdAt)) continue;
    let score = normTitle(t.title) === norm ? 2 : 0;
    if (!score) {
      const got = titleTokens(t.title);
      const shared = [...want].filter((w) => got.has(w)).length;
      const ratio = shared / Math.max(1, Math.min(want.size, got.size));
      if (shared >= 2 && ratio >= 0.5) score = ratio;
    }
    if (score) scored.push({ key: t.key, title: t.title, score });
  }
  scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key, "en", { numeric: true }));
  return scored.slice(0, 5).map(({ key, title }) => ({ key, title }));
}

const keyList = (v: unknown) => (v == null ? [] : Array.isArray(v) ? v : [v]).map((k) => String(k).trim().toUpperCase()).filter(Boolean);

// NEW의 tail로 쓸 수 있는 AIRCRAFT: 퇴역, health로 HOLD된 AIRCRAFT(ATC-45), 같은 ACCOUNT의 LIMIT으로 붙들린 AIRCRAFT(ATC-51)는 뺀다(순수)
export const newTailsOf = (views: Pick<AircraftView, "registration" | "retired" | "health" | "accountHold">[]) =>
  views.filter((a) => !a.retired && !a.health?.holds && !a.accountHold).map((a) => a.registration);

// NEW 입력 검사(similar는 draftOps가 채운다). tails: 퇴역하지 않은 FLEET 등록번호.
// milestones: Linear 마일스톤(못 읽었으면 null). milestone은 그 프로젝트의 마일스톤 이름이나 id여야 한다
export function parseNew(raw: Record<string, unknown>, tickets: Ticket[], tails: string[], milestones: Milestone[] | null = null): Omit<NewPayload, "similar"> {
  const title = typeof raw.title === "string" ? raw.title.trim().replace(/\s+/g, " ") : "";
  if (!title || title.length > 120) throw new ScheduleError("제목(title)은 1~120자");
  const body = typeof raw.body === "string" ? raw.body.trim() : "";
  if (!body) throw new ScheduleError("본문(body)이 필요함");
  if (body.length > 20_000) throw new ScheduleError("본문이 20,000자를 넘음");
  const cls = parseClass(raw);
  const missing = missingSections(body);
  if (missing.length) throw new ScheduleError(`본문에 빠진 칸: ${missing.join(", ")} (DIRECT: 목표와 완료 기준이 필요함)`);
  if (cls.ratings?.includes("SEC") && missingSections(body, true).includes("Hard constraints"))
    throw new ScheduleError('rating:SEC 이슈에는 Hard constraints 줄이 필요함 — 이 작업만의 보안 한계(예: "staging에 적용하지 않음", "service_role 경로 유지")');
  const projects = [...new Set(tickets.map((t) => t.project).filter(Boolean) as string[])];
  const project = projects.find((p) => p.toLowerCase() === String(raw.project ?? "").trim().toLowerCase());
  if (!project) throw new ScheduleError(`모르는 프로젝트: ${raw.project ?? "(비었음)"} (가능: ${projects.sort().join(", ")})`);
  const out: Omit<NewPayload, "similar"> = { title, body, project, ...cls };
  if (raw.priority != null) out.priority = parsePriority(raw.priority);
  const wanted = raw.milestone == null ? "" : String(raw.milestone).trim();
  if (wanted) {
    if (!milestones) throw new ScheduleError("Linear 마일스톤을 아직 읽지 못함 — 잠시 뒤 다시");
    const mine = milestones.filter((m) => m.project === project);
    const m = mine.find((x) => x.id === wanted || x.name.toLowerCase() === wanted.toLowerCase());
    if (!m) throw new ScheduleError(`${project}의 마일스톤이 아님: ${wanted} (가능: ${mine.map((x) => x.name).join(", ") || "없음"})`);
    out.milestone = { id: m.id, name: m.name };
  }
  if (raw.tail != null) {
    const tail = regKey(String(raw.tail).trim().replace(/^TAIL:\s*/i, "")); // `Team J`도 TEAM_J(ATC-67)
    if (!tails.some((x) => regKey(x) === tail)) throw new ScheduleError(`FLEET에 없거나 퇴역했거나 health·ACCOUNT LIMIT으로 HOLD된 AIRCRAFT: ${tail}`);
    out.tail = tail;
  }
  const keys = new Set(tickets.map((t) => t.key));
  const unknown = (list: string[]) => list.find((k) => !keys.has(k));
  if (raw.parent != null) {
    const [parent] = keyList(raw.parent);
    if (!parent || !keys.has(parent)) throw new ScheduleError(`parent가 FLIGHT 목록에 없음: ${parent ?? "(비었음)"}`);
    out.parent = parent;
  }
  for (const field of ["related", "blockedBy"] as const) {
    const list = [...new Set(keyList(raw[field]))];
    const bad = unknown(list);
    if (bad) throw new ScheduleError(`${field}가 FLIGHT 목록에 없음: ${bad}`);
    if (list.length) out[field] = list;
  }
  return out;
}

// CLOSE 후보: LOGBOOK에 ARRIVED(되돌림 아님)인데 Linear 이슈가 아직 Done·Canceled가 아닌 FLIGHT.
// FLIGHT에 PR이 여럿이면 Fixes인 것을 먼저, 없으면 가장 최근 것. 모든 PR이 되돌려졌으면 reverted.
// link가 null이면 PR 본문을 아직 모른다(옛 LOGBOOK 줄 — 서버가 gh로 읽기 전용으로 가져온다).
export interface Closable {
  flight: string;
  key: string; // LOGBOOK key "owner/repo#N"
  pr: ClosePayload["pr"];
  mergedAt: string;
  link: PrLink | null;
}
export function closableOf(entries: Pick<LogEntry, "key" | "flight" | "pr" | "arrivedAt" | "reverted" | "link">[], tickets: Ticket[], bodyOf: (key: string) => string | undefined) {
  const byKey = new Map(tickets.map((t) => [t.key, t]));
  const byFlight = new Map<string, typeof entries>();
  for (const e of entries) if (e.flight) byFlight.set(e.flight, [...(byFlight.get(e.flight) ?? []), e]);
  const closable = new Map<string, Closable>();
  const reverted = new Set<string>();
  for (const [flight, list] of byFlight) {
    const live = list.filter((e) => !e.reverted).sort((a, b) => b.arrivedAt.localeCompare(a.arrivedAt));
    if (!live.length) {
      reverted.add(flight);
      continue;
    }
    const t = byKey.get(flight);
    if (!t || DONE_STATES.has(t.stateType)) continue;
    const linkOf = (e: (typeof live)[number]): PrLink | null => {
      if (e.link) return e.link;
      const body = bodyOf(e.key);
      return body === undefined ? null : prLinkOf(body, flight);
    };
    const pick = live.find((e) => linkOf(e) === "fixes") ?? live[0];
    closable.set(flight, { flight, key: pick.key, pr: { repo: pick.pr.repo, number: pick.pr.number, url: pick.pr.url }, mergedAt: pick.arrivedAt, link: linkOf(pick) });
  }
  return { closable, reverted };
}

// 새 초안 만들기(순수). 같은 FLIGHT·종류의 열린 초안은 새 초안이 SUPERSEDED로 대신한다.
// NEW는 FLIGHT 없이 쓰고, 다른 NEW를 대신하지 않는다. ctx.tails: tail로 쓸 수 있는 FLEET 등록번호.
export function draftOps(
  existing: ScheduleOp[],
  input: { kind: unknown; flight?: unknown; reason: unknown; [k: string]: unknown },
  tickets: Ticket[],
  now: string,
  seq: number,
  ctx: { tails?: string[]; closable?: Map<string, Closable>; teams?: Set<string>; milestones?: Milestone[] | null; network?: NetworkCtx; tail?: TailCtx & { views: Parameters<typeof tailCautionOf>[2] } } = {},
): LogLine[] {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  // 후보 팀(dispatch.json candidateTeams)이 아닌 FLIGHT에는 초안을 쓰지 않는다. 보여 주기만 하는 팀이고, 분류 라벨도 없다
  if (input.kind !== "NEW" && ctx.teams && input.flight != null) {
    const team = teamOfKey(String(input.flight));
    if (!ctx.teams.has(team)) throw new ScheduleError(`${team} 팀은 SCHEDULE 후보가 아님(dispatch.json candidateTeams) — 보여 주기만 한다`, 409);
  }
  let kind: ScheduleKind;
  let flight: string | null = null;
  let payload: SchedulePayload;
  if (isNetworkKind(input.kind)) {
    // TARGET·ROUTE: FLIGHT 없이 AIRCRAFT 하나에 대해. 근거 숫자는 atc가 붙인다
    if (!ctx.network) throw new ScheduleError("FLEET·NETWORK 자료가 없음", 503);
    if (!reason) throw new ScheduleError("근거(reason) 한 줄이 필요함");
    kind = input.kind;
    try {
      payload = parseNetwork(input.kind, input, ctx.network);
    } catch (e) {
      if (e instanceof NetworkDraftError) throw new ScheduleError(e.message, e.status);
      throw e;
    }
  } else if (input.kind === "NEW") {
    const base = parseNew(input, tickets, ctx.tails ?? [], ctx.milestones ?? null);
    if (!reason) throw new ScheduleError("근거(reason) 한 줄이 필요함");
    if (!reason.includes("중복 검색:")) throw new ScheduleError("NEW 근거에는 \"중복 검색:\"과 찾아본 결과가 필요함");
    kind = "NEW";
    const similar = similarTickets(base.title, tickets, Date.parse(now));
    // WAYPOINT gap 초안: 마일스톤이 있어야 하고, 비슷한 FLIGHT가 하나라도 있으면 쓰지 않는다(OCC가 먼저 읽고 판단한다)
    if (input.gap === true) {
      if (!base.milestone) throw new ScheduleError("WAYPOINT gap 초안에는 milestone이 필요함");
      if (similar.length) throw new ScheduleError(`비슷한 FLIGHT가 있어 WAYPOINT gap 초안을 쓰지 않음: ${similar.map((m) => `${m.key} ${m.title}`).join(" · ")}`);
    }
    payload = { ...base, similar, ...(input.gap === true ? { gap: true as const } : {}) };
  } else if (input.kind === "CLOSE") {
    // CLOSE: 계획 단계가 아니어도 된다(In Progress·In Review가 흔하다). 닫히지 않았고 LOGBOOK에 ARRIVED여야 한다
    flight = String(input.flight ?? "").toUpperCase();
    const t = tickets.find((x) => x.key === flight);
    if (!t) throw new ScheduleError(`FLIGHT 목록에 없음: ${flight || "(비었음)"}`);
    if (DONE_STATES.has(t.stateType)) throw new ScheduleError(`${flight}는 이미 닫힘(${t.state})`);
    const c = ctx.closable?.get(flight);
    if (!c) throw new ScheduleError(`${flight}는 LOGBOOK에 ARRIVED 기록이 없음(또는 PR이 되돌려짐) — 머지된 PR이 있어야 CLOSE를 쓴다`);
    if (!c.link) throw new ScheduleError(`${flight}의 PR 본문을 아직 읽지 못함 — 잠시 뒤 다시`, 503);
    if (!reason) throw new ScheduleError("근거(reason) 한 줄이 필요함");
    kind = "CLOSE";
    payload = { pr: c.pr, mergedAt: c.mergedAt, ...(c.link === "fixes" ? { fixes: true } : {}), ...(c.link === "part-of" ? { partOf: true } : {}) };
  } else if (input.kind === "TAIL") {
    // TAIL: 계획 단계가 아니어도 된다(팀이 이미 몰고 있는 FLIGHT가 흔하다). 닫히지 않았어야 한다
    flight = String(input.flight ?? "").toUpperCase();
    const t = tickets.find((x) => x.key === flight);
    if (!t) throw new ScheduleError(`FLIGHT 목록에 없음: ${flight || "(비었음)"}`);
    if (DONE_STATES.has(t.stateType)) throw new ScheduleError(`${flight}는 이미 닫힘(${t.state})`);
    if (!ctx.tail) throw new ScheduleError("FLEET·Linear 라벨 자료가 없음", 503);
    let registration: string;
    try {
      registration = parseTail(input, t, ctx.tail);
    } catch (e) {
      if (e instanceof TailError) throw new ScheduleError(e.message, e.status);
      throw e;
    }
    if (!reason) throw new ScheduleError("근거(reason) 한 줄이 필요함");
    kind = "TAIL";
    const caution = tailCautionOf(t, registration, ctx.tail.views);
    payload = { registration, ...(caution ? { caution } : {}) };
  } else {
    flight = String(input.flight ?? "").toUpperCase();
    const t = tickets.find((x) => x.key === flight);
    if (!t) throw new ScheduleError(`열린 FLIGHT 목록에 없음: ${flight || "(비었음)"}`);
    if (!isOpenTicket(t)) throw new ScheduleError(`${flight}는 Todo·Backlog가 아님(${t.state}) — 계획 단계의 FLIGHT만 초안을 쓴다`);
    if (!reason) throw new ScheduleError("근거(reason) 한 줄이 필요함");
    ({ kind, payload } = parsePayload(input.kind, input));
    if (!changesOf(kind, payload, t).length) throw new ScheduleError(`${flight}에는 이미 그렇게 되어 있음 — 바꿀 것이 없음`);
  }
  const open = existing.filter((s) => s.status === "draft");
  // 같은 대상: FLIGHT, TARGET·ROUTE는 AIRCRAFT(AIRCRAFT·종류마다 열린 초안 하나 — 새것이 대신한다)
  const reg = isNetworkKind(kind) ? (payload as NetworkPayload).registration : null;
  const same = (s: ScheduleOp) => s.kind === kind && (reg ? (s.payload as NetworkPayload).registration === reg : s.flight === flight);
  const inFlight = kind === "NEW" ? undefined : existing.find((s) => (s.status === "approved" || s.status === "released") && same(s));
  if (inFlight) throw new ScheduleError(`${reg ?? flight}에는 진행 중인 ${kind} ${inFlight.id}(${inFlight.status})가 있음`, 409);
  const replaced = kind === "NEW" ? [] : open.filter(same);
  if (open.length - replaced.length >= SCHEDULE_OPEN_LIMIT) throw new ScheduleError(`열린 초안이 ${SCHEDULE_OPEN_LIMIT}건 — SUPERVISOR 판정을 기다린다`, 409);
  const id = `S-${String(seq + 1).padStart(4, "0")}`;
  return [
    ...replaced.map((s) => ({ op: "supersede" as const, id: s.id, at: now, reason: `새 초안 ${id}로 바뀜` })),
    { op: "draft", id, at: now, kind, flight, payload, reason: reason.slice(0, 500) },
  ];
}

// S2: 승인된 작업을 Linear MCP 호출로 옮긴다(순수). 계획 필드만 쓴다(docs/occ.md 4장) — 상태·담당은 건드리지 않는다.
// 라벨 이름: type·wake는 Linear 라벨 그룹의 하위 라벨(BUILD, M …), rating·tail은 평면 라벨(rating:SEC, tail:TEAM_E).
export function callsOf(op: ScheduleOp, t: Pick<Ticket, "labels" | "priority"> | undefined, teamName: string): LinearCall[] {
  if (op.kind === "CLOSE") throw new ScheduleError(CLOSE_RELEASE_WHY, 409);
  if (isNetworkKind(op.kind)) throw new ScheduleError(NETWORK_APPLY_WHY, 409);
  const trail = `(SCHEDULE ${op.id}, SUPERVISOR 승인)`;
  if (op.kind === "NEW") {
    const n = op.payload as NewPayload;
    const labels = [n.type, n.wake, ...(n.ratings ?? []).map((r) => `rating:${r}`), n.tail && `tail:${n.tail}`].filter(Boolean) as string[];
    const input: Record<string, unknown> = {
      team: teamName,
      title: n.title,
      description: `${n.body}\n\n— OCC ${op.id} · CHARTER REQUEST ${trail}`,
      project: n.project,
    };
    if (n.priority) input.priority = n.priority;
    if (labels.length) input.labels = labels;
    if (n.parent) input.parentId = n.parent;
    if (n.blockedBy?.length) input.blockedBy = n.blockedBy;
    if (n.related?.length) input.relatedTo = n.related;
    if (n.milestone) input.milestone = n.milestone.id;
    return [{ tool: "save_issue", input }];
  }
  const flight = op.flight!;
  const note = (what: string) => ({ tool: "save_comment" as const, input: { issueId: flight, body: `[OCC ${op.id}] ${what} — 근거: ${op.reason} ${trail}` } });
  if (op.kind === "PRIORITIZE") {
    const p = (op.payload as PrioritizePayload).priority;
    return [{ tool: "save_issue", input: { id: flight, priority: p } }, note(`우선순위 ${PRIORITY_NAME[p]}`)];
  }
  if (op.kind === "TAIL") {
    // 라벨만: tail:TEAM_X를 붙이고 다른 tail:을 뗀다. 나머지 라벨(lane: 포함)은 손대지 않는다.
    // labels(전체 교체)가 아니라 addLabels·removeLabels로 쓴다 — 스냅샷 라벨은 20개까지이고 그룹 라벨 이름("type:BUILD" → "BUILD")이 달라
    // 전체 목록을 되살리면 모르는 라벨을 지울 수 있다. 결과 라벨은 tailLabelsOf와 같다.
    const reg = (op.payload as TailPayload).registration;
    const { remove } = tailDiffOf(t?.labels ?? [], reg);
    const input: Record<string, unknown> = { id: flight, addLabels: [`tail:${reg}`] };
    if (remove.length) input.removeLabels = remove;
    return [{ tool: "save_issue", input }, note(`TAIL ASSIGNMENT tail:${reg}${remove.length ? ` (${remove.join(", ")} 대신)` : ""}`)];
  }
  const want = op.payload as ClassifyPayload;
  const c = classOf(t?.labels ?? []);
  const add: string[] = [];
  const remove: string[] = [];
  if (want.type && !(c.explicit.type && c.type === want.type)) {
    add.push(want.type);
    if (c.explicit.type) remove.push(c.type);
  }
  if (want.wake && !(c.explicit.wake && c.wake === want.wake)) {
    add.push(want.wake);
    if (c.explicit.wake) remove.push(c.wake);
  }
  for (const r of want.ratings ?? []) if (!c.ratings.includes(r)) add.push(`rating:${r}`);
  const input: Record<string, unknown> = { id: flight, addLabels: add };
  if (remove.length) input.removeLabels = remove;
  return [{ tool: "save_issue", input }, note(`분류 ${changesOf("CLASSIFY", want, t).join(" ")}`)];
}

// 상황이 바뀐 열린 초안을 닫는다(순수): FLIGHT가 계획 단계를 벗어남, 이미 반영됨, 3일 지남.
// NEW는 초안 뒤에 같은 제목(정규화)의 이슈가 Linear에 생기면 SUPERSEDED.
// CLOSE는 Linear가 Done·Canceled가 되면 닫고(발부된 것이면 APPLIED), PR이 되돌려지면 SUPERSEDED.
// TARGET·ROUTE는 AIRCRAFT가 없거나 퇴역했거나 FLEET 탭에서 이미 그렇게 바뀌면 SUPERSEDED(ctx.views가 있을 때).
export function syncLines(existing: ScheduleOp[], tickets: Ticket[], nowMs: number, ctx: { reverted?: Set<string>; views?: NetworkCtx["views"] } = {}): LogLine[] {
  const at = new Date(nowMs).toISOString();
  const byKey = new Map(tickets.map((t) => [t.key, t]));
  const out: LogLine[] = [];
  for (const s of existing) {
    if (s.status !== "draft" && s.status !== "approved" && s.status !== "released") continue;
    // 발부(released)된 작업이 Linear에 보이면 APPLIED, 발부 전에 이미 그렇게 됐으면 SUPERSEDED
    const done = (ref: string, why: string): LogLine =>
      s.status === "released" ? { op: "apply", id: s.id, at, ref } : { op: "supersede", id: s.id, at, reason: why };
    const stale = nowMs - Date.parse(s.statusAt) > TTL_MS;
    const staleWhy = s.status === "draft" ? undefined : s.status === "approved" ? "승인 뒤 3일 동안 발부되지 않음" : "발부 뒤 3일 동안 Linear에 반영되지 않음";
    if (isNetworkKind(s.kind)) {
      const why = ctx.views ? networkSupersedeReason(s.kind, s.payload as NetworkPayload, ctx.views) : null;
      if (why) out.push({ op: "supersede", id: s.id, at, reason: why });
      else if (stale) out.push({ op: "expire", id: s.id, at, ...(staleWhy ? { reason: staleWhy } : {}) });
      continue;
    }
    if (s.kind === "NEW" || s.flight == null) {
      const norm = normTitle((s.payload as NewPayload).title ?? "");
      const made = tickets.find((t) => normTitle(t.title) === norm && t.createdAt != null && Date.parse(t.createdAt) >= Date.parse(s.at));
      if (made) out.push(done(made.key, `Linear에 이미 만들어짐 ${made.key}`));
      else if (stale) out.push({ op: "expire", id: s.id, at, ...(staleWhy ? { reason: staleWhy } : {}) });
      continue;
    }
    const t = byKey.get(s.flight);
    if (s.kind === "CLOSE") {
      const closeStale = s.status === "approved" ? "승인 뒤 3일 동안 Linear에서 닫히지 않음" : staleWhy;
      if (!t) out.push({ op: "supersede", id: s.id, at, reason: "FLIGHT가 목록에 없음" });
      else if (DONE_STATES.has(t.stateType)) out.push(done(s.flight, `Linear에서 닫힘(${t.state})`));
      else if (ctx.reverted?.has(s.flight)) out.push({ op: "supersede", id: s.id, at, reason: "PR이 되돌려짐(LOGBOOK)" });
      else if (stale) out.push({ op: "expire", id: s.id, at, ...(closeStale ? { reason: closeStale } : {}) });
      continue;
    }
    if (s.kind === "TAIL") {
      // TAIL은 In Progress도 된다. 닫히면 SUPERSEDED, 그 tail:이 보이면 APPLIED(발부 전이면 SUPERSEDED)
      if (!t) out.push({ op: "supersede", id: s.id, at, reason: "FLIGHT가 목록에 없음" });
      else if (DONE_STATES.has(t.stateType)) out.push({ op: "supersede", id: s.id, at, reason: `FLIGHT가 닫힘(${t.state})` });
      else if (!changesOf(s.kind, s.payload, t).length) out.push(done(s.flight, "Linear에 이미 반영됨"));
      else if (stale) out.push({ op: "expire", id: s.id, at, ...(staleWhy ? { reason: staleWhy } : {}) });
      continue;
    }
    if (!isOpenTicket(t)) out.push({ op: "supersede", id: s.id, at, reason: `FLIGHT 상태가 바뀜(${t?.state ?? "목록에 없음"})` });
    else if (!changesOf(s.kind, s.payload, t!).length) out.push(done(s.flight, "Linear에 이미 반영됨"));
    else if (stale) out.push({ op: "expire", id: s.id, at, ...(staleWhy ? { reason: staleWhy } : {}) });
  }
  return out;
}

export function gateOf(all: ScheduleOp[]) {
  const ops = all.filter(countsForGate);
  const decided = ops.filter((s) => (s.status === "agreed" || s.status === "disagreed") && s.via !== "atfm");
  const agreed = decided.filter((s) => s.status === "agreed").length;
  // (S2 이후의 승인·거절은 이 점검에 넣지 않는다 — 그림자 판정의 합의율만 잰다)
  const agreement = decided.length ? agreed / decided.length : null;
  return {
    decided: decided.length,
    agreed,
    agreement,
    target: GATE,
    ready: decided.length >= GATE.decided && agreement !== null && agreement >= GATE.agreement,
    // 게이트와 따로: CROSSCHECK가 SUPERVISOR 판정(S1 판정과 S2 승인·거절)과 얼마나 맞았나
    crosscheck: { ...crosscheckRateOf(ops.map((s) => ({ crosscheck: s.crosscheck, human: humanOf(s) }))), oneClick: oneClickOf(ops.map((s) => ({ crosscheck: s.crosscheck, human: humanOf(s) }))) },
    // TARGET·ROUTE 그림자 판정(게이트와 따로, 종류마다). S3 자동 처리 대상이 아니다
    network: networkGateOf(all),
  };
}

export function networkGateOf(ops: ScheduleOp[]) {
  const per = (kind: NetworkKind) => {
    const decided = ops.filter((s) => s.kind === kind && s.decision && s.via !== "atfm");
    const agreed = decided.filter((s) => s.decision!.verdict === "agree").length;
    return { decided: decided.length, agreed, agreement: decided.length ? agreed / decided.length : null };
  };
  return { TARGET: per("TARGET"), ROUTE: per("ROUTE") };
}

// OCC 보정용 예시: 최근 SUPERVISOR 판정(사유 있는 것 먼저)과 OCC가 냈던 초안. 같은 실수를 되풀이하지 않게 초안 쓰기 전에 본다.
// NEW의 본문·비슷한 FLIGHT는 빼고 분류·우선순위만 남긴다.
export function occExamplesOf(ops: ScheduleOp[]) {
  return examplesOf(ops.map((s) => ({ s, human: humanOf(s) }))).map(({ s, human }) => {
    const { body: _b, similar: _s, evidence: _e, ...proposed } = s.payload as NewPayload & { evidence?: unknown };
    return { id: s.id, kind: s.kind, flight: s.flight, proposed, draft: s.reason, verdict: human!.verdict, reason: human!.reason };
  });
}

// CROSSCHECK 브리핑: mark가 없는 열린 초안과 보정용 최근 SUPERVISOR 판정
export function crosscheckBriefOf(ops: ScheduleOp[], changes: Record<string, string[]> = {}) {
  const pending = ops.filter((s) => s.status === "draft" && !s.crosscheck);
  const examples = examplesOf(ops.map((s) => ({ s, human: humanOf(s) }))).map(({ s, human }) => ({
    id: s.id,
    kind: s.kind,
    flight: s.flight,
    draft: s.reason,
    verdict: human!.verdict,
    reason: human!.reason,
    crosscheck: s.crosscheck ? { model: s.crosscheck.model, verdict: s.crosscheck.verdict, reason: s.crosscheck.reason } : null,
  }));
  return {
    pending: pending.map((s) => ({ id: s.id, kind: s.kind, flight: s.flight, reason: s.reason, changes: changes[s.id] ?? [] })),
    examples,
  };
}

// 제목으로 본 SURVEY·CHECK 후보(리서치·검토·비교·계획). 분류 후보 순서만 바꾼다 — 라벨을 대신하지 않는다.
// SURVEY·CHECK로 분류되면 HOLDING 팀도 받을 수 있어(docs/fleet.md 5장) 먼저 분류할 가치가 크다.
const STAND_FREE_HINT = /\b(review|audit|research|survey|investigat\w*|inventory|compar\w*|evaluat\w*|verif\w*)\b|리뷰|검토|감사|조사|점검|비교|평가|검증|계획/i;
export const standFreeHint = (title: string) => STAND_FREE_HINT.test(title);

// OCC가 초안을 쓸 후보: 계획 단계(Todo·Backlog)인데 분류 라벨이 없거나 우선순위가 없는 FLIGHT.
// classify는 SURVEY·CHECK로 보이는 FLIGHT를 앞에 둔다(나머지 순서는 그대로).
// close: 닫을 FLIGHT(Closable). Part of인 PR과 본문을 아직 모르는 것은 뺀다. 오래 머지된 것부터.
// 최근 7일 안에 판정된 CLOSE가 있는 FLIGHT도 뺀다: 승인했을 것이면 "직접 Done" 목록에 있고, 거절이면 다시 쓰지 않는다.
// tail: TAIL 신호(tail: 없이 팀이 몰고 있는 FLIGHT, schedule-tail.ts). 열린 TAIL 작업이 있는 FLIGHT는 뺀다. 초안은 OCC가 판단해 쓴다.
export function candidatesOf(tickets: Ticket[], ops: ScheduleOp[], closable: Map<string, Closable> = new Map(), nowMs = Date.now(), tailSignals: TailSignal[] = []) {
  const openFor = new Set(ops.filter((s) => s.status === "draft" || s.status === "approved" || s.status === "released").map((s) => `${s.kind}|${s.flight}`));
  const decidedClose = new Set(
    ops.filter((s) => s.kind === "CLOSE" && (s.status === "agreed" || s.status === "disagreed" || s.status === "rejected") && nowMs - Date.parse(s.statusAt) < 7 * 86_400_000).map((s) => s.flight),
  );
  const planning = tickets.filter(isOpenTicket);
  return {
    classify: planning
      .filter((t) => { const c = classOf(t.labels); return !c.explicit.type || !c.explicit.wake; })
      .filter((t) => !openFor.has(`CLASSIFY|${t.key}`))
      .sort((x, y) => Number(standFreeHint(y.title ?? "")) - Number(standFreeHint(x.title ?? "")))
      .map((t) => t.key),
    prioritize: planning.filter((t) => !t.priority && !openFor.has(`PRIORITIZE|${t.key}`)).map((t) => t.key),
    close: [...closable.values()]
      .filter((c) => c.link && c.link !== "part-of" && !openFor.has(`CLOSE|${c.flight}`) && !decidedClose.has(c.flight))
      .sort((a, b) => a.mergedAt.localeCompare(b.mergedAt))
      .map((c) => c.flight),
    tail: tailSignals.filter((x) => !openFor.has(`TAIL|${x.flight}`)),
  };
}

// FLEET 등록부의 AIRCRAFT(TAIL 검사용): fleet.json에 있는 것만, RETIRED 표시
const fleetRegsOf = (fleet: ReturnType<typeof loadFleet>): TailCtx["fleet"] =>
  Object.entries(fleet.aircraft).map(([k, v]) => ({ registration: regKey(k), retired: Boolean(v.retired) }));

// proposals: DISPATCH 제안 목록(TAIL 신호의 READBACK). proposals.ts가 routes.ts를 거쳐 이 파일을 읽어 index.ts에서 넘긴다(순환 import 방지)
export function mountSchedule(app: Hono, getSnapshot: () => Promise<Snapshot>, proposals: () => Proposal[] = () => []) {
  // 브리핑할 때마다 상황이 바뀐 초안을 먼저 닫는다. Linear를 아직 못 읽었으면(시작 직후, 꺼짐) 닫지 않는다 —
  // 빈 티켓 목록과 맞추면 열린 초안이 모두 SUPERSEDED가 된다.
  // CLOSE 후보. 옛 LOGBOOK 줄의 PR 본문은 gh로 읽기 전용으로 가져온다(백그라운드, 다음 브리핑에 반영)
  const closeInfo = (s: Snapshot) => {
    const info = closableOf(loadLogbook(), s.tickets, cachedPrBody);
    for (const c of info.closable.values()) if (!c.link) void fetchPrBody(c.key);
    return info;
  };
  // TARGET·ROUTE 초안을 쓰고 보이는 데 드는 FLEET 보기(실적 포함). 열린 TARGET·ROUTE가 없으면 만들지 않는다
  const viewsOf = (s: Snapshot, entries = loadLogbook(), now = Date.now()) => fleetView(s, loadFleet(), loadDispatchConfig().teamPattern, entries, now);
  const networkCtxOf = async (s: Snapshot): Promise<NetworkCtx> => {
    const now = Date.now();
    const entries = loadLogbook();
    const views = viewsOf(s, entries, now);
    const lp = await loadLinearProjects();
    const goals = lp.ok ? lp.projects : null;
    return { views, entries, tickets: s.tickets, goals, routeRows: routeRows({ tickets: s.tickets, entries, views, goals, now }), now };
  };
  // TAIL 초안 검사 자료. 라벨이 캐시에 없으면 한 번 새로 읽는다(ENGINEERING이 방금 만든 라벨)
  const tailCtxOf = async (s: Snapshot, reg: string) => {
    const teamPattern = loadDispatchConfig().teamPattern;
    const fleet = loadFleet();
    let tailLabels = await loadTailLabels();
    const want = `tail:${reg.trim().replace(/^tail:\s*/i, "")}`.toLowerCase();
    if (tailLabels && !tailLabels.has(want)) tailLabels = await loadTailLabels(true);
    return { teamPattern, fleet: fleetRegsOf(fleet), tailLabels, views: fleetView(s, fleet, teamPattern) };
  };
  const current = (s: Snapshot) => {
    const lines = readLines();
    const ops = fold(lines);
    const openNetwork = ops.some((x) => x.status === "draft" && isNetworkKind(x.kind));
    const closing = s.linear.enabled && s.linear.fetchedAt ? syncLines(ops, s.tickets, Date.now(), { reverted: closeInfo(s).reverted, views: openNetwork ? viewsOf(s) : undefined }) : [];
    if (closing.length) {
      append(closing);
      return fold([...lines, ...closing]);
    }
    return ops;
  };

  app.get("/api/schedule/brief", async (c) => {
    const s = await getSnapshot();
    const ops = current(s);
    const now = Date.now();
    const mode = loadScheduleMode();
    const open = ops.filter((x) => x.status === "draft").sort((a, b) => a.at.localeCompare(b.at));
    // S2: 승인됐거나 발부돼 Linear 반영을 기다리는 작업
    const inProgress = ops.filter((x) => x.status === "approved" || x.status === "released").sort((a, b) => a.statusAt.localeCompare(b.statusAt));
    const recent = ops
      .filter((x) => x.status !== "draft" && x.status !== "approved" && x.status !== "released" && now - Date.parse(x.statusAt) < 7 * 86_400_000)
      .sort((a, b) => b.statusAt.localeCompare(a.statusAt))
      .slice(0, 50);
    const { closable } = closeInfo(s);
    const teams = candidateTeamsOf(loadDispatchConfig());
    const mine = new Map([...closable].filter(([flight]) => teams.has(teamOfKey(flight))));
    const mineTickets = s.tickets.filter((t) => isCandidateTicket(t, teams));
    // TAIL 신호(ATC-68): tail: 없이 팀이 몰고 있는 FLIGHT와 그 기록(STAND·DEPARTURE LOG·READBACK). 초안은 OCC가 판단한다
    const dcfg = loadDispatchConfig();
    const fleet = loadFleet();
    const tailSignals = tailSignalsOf({
      tickets: mineTickets,
      views: fleetView(s, fleet, dcfg.teamPattern),
      departures: readDepartures(),
      proposals: proposals(),
      clearances: s.clearances,
      fleet: fleetRegsOf(fleet),
      teamPattern: dcfg.teamPattern,
      now,
    });
    const candidates = candidatesOf(mineTickets, ops, mine, now, tailSignals);
    // SUPERVISOR가 Linear에서 직접 Done으로 바꿀 것: 승인된 CLOSE, 그림자 운용이면 "승인했을 것"(7일 안) 중 아직 열린 이슈
    const byKeyAll = new Map(s.tickets.map((t) => [t.key, t]));
    const closeManual = ops
      .filter((x) => x.kind === "CLOSE" && (x.status === "approved" || (x.status === "agreed" && now - Date.parse(x.statusAt) < 7 * 86_400_000)))
      .filter((x) => !DONE_STATES.has(byKeyAll.get(x.flight ?? "")?.stateType ?? "completed"))
      .sort((a, b) => a.statusAt.localeCompare(b.statusAt));
    // NEW 초안의 관계·비슷한 FLIGHT도 화면이 제목과 링크를 보이게 넣는다
    const newKeys = [...open, ...inProgress, ...recent].filter((x) => x.kind === "NEW").flatMap((x) => {
      const p = x.payload as NewPayload;
      return [p.parent, ...(p.related ?? []), ...(p.blockedBy ?? []), ...(p.similar ?? []).map((m) => m.key)].filter(Boolean) as string[];
    });
    const keys = new Set([...(ops.map((x) => x.flight).filter(Boolean) as string[]), ...candidates.classify, ...candidates.prioritize, ...candidates.close, ...candidates.tail.map((x) => x.flight), ...newKeys]);
    const byKey = new Map(s.tickets.map((t) => [t.key, t]));
    const flights = Object.fromEntries(
      [...keys].filter((k) => byKey.has(k)).map((k) => {
        const t = byKey.get(k)!;
        return [k, { title: t.title, state: t.state, priority: t.priority, project: t.project, url: t.url, cls: classLabel(classOf(t.labels)), labels: t.labels }];
      }),
    );
    const views = [...open, ...inProgress].some((x) => isNetworkKind(x.kind)) ? viewsOf(s) : [];
    const viewOf = (x: ScheduleOp) => (isNetworkKind(x.kind) ? views.find((v) => v.registration === (x.payload as NetworkPayload).registration) : undefined);
    const changes = Object.fromEntries([...open, ...inProgress].map((x) => [x.id, changesOf(x.kind, x.payload, x.flight ? byKey.get(x.flight) : undefined, viewOf(x))]));
    // CLOSE 후보의 PR·머지 시각·Fixes 여부(초안 근거와 화면용)
    const closeInfoOut = Object.fromEntries(candidates.close.map((k) => { const c = closable.get(k)!; return [k, { pr: c.pr, mergedAt: c.mergedAt, link: c.link }]; }));
    // ROUTE마다 지금·다음 WAYPOINT의 완료 기준과 이슈(ATC-8). 마일스톤을 못 읽었으면 null
    const lp = await loadLinearProjects();
    // 후보 팀 마일스톤만(NEW는 주 팀에 이슈를 만든다). ETA·지연 경고는 읽는 팀 전부
    const waypointGaps = lp.milestones ? waypointGapsOf(lp.milestones, lp.ok ? lp.projects : null, teams) : null;
    // 지나지 않은 WAYPOINT의 ETA와 지연 경고(ATC-24). fresh는 OCC가 아직 SUPERVISOR에게 보고하지 않은 경고
    const waypointEtas = lp.milestones ? waypointEtasOf(await loadRoutes(s, loadLogbook(), now)) : null;
    const reported = loadSlipsReported();
    const slipList = waypointEtas ? slipsOf(waypointEtas, now) : [];
    const freshSlips = new Set(freshSlipKeys(slipList, reported));
    const slips = waypointEtas ? slipList.map((x) => ({ ...x, fresh: freshSlips.has(x.key), reportedAt: reported.reported[x.key] ?? null })) : null;
    // 판정 계열(ATC-36): 일치율과, SUPERVISOR가 판정한 초안의 mark만(열린 초안의 mark는 숨긴다). 게이트와 따로
    // mark는 화면에 보이는 판정된 초안(recent·inProgress)만 싣는다(브리핑이 replay 기록만큼 커지지 않게)
    const shown = new Set([...recent, ...inProgress].map((x) => x.id));
    const judges = judgesViewOf(ops.map((x) => ({ id: x.id, kind: x.kind, human: humanOf(x) })), marksOf(readJudgeLines()), loadJudges(), shown);
    return c.json({ mode, open, inProgress, recent, changes, gate: gateOf(ops), limit: SCHEDULE_OPEN_LIMIT, candidates, close: closeInfoOut, closeManual, flights, examples: occExamplesOf(ops), crosscheck: crosscheckBriefOf(ops, changes), waypointGaps, waypointEtas, slips, judges });
  });

  // OCC가 SUPERVISOR에게 보고한 WAYPOINT 지연 경고를 적는다. keys가 없으면 지금 fresh 전부
  app.post("/api/schedule/slips/ack", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const lp = await loadLinearProjects();
    if (!lp.milestones) return c.json({ error: "마일스톤을 읽지 못해 지연 경고가 없음" }, 503);
    const now = Date.now();
    const slipList = slipsOf(waypointEtasOf(await loadRoutes(await getSnapshot(), loadLogbook(), now)), now);
    const r = loadSlipsReported();
    const keys: string[] = Array.isArray(body.keys) ? body.keys.map(String) : freshSlipKeys(slipList, r);
    const next = ackSlips(slipList, r, keys, new Date(now).toISOString());
    saveSlipsReported(next);
    return c.json({ acked: keys.filter((k) => k in next.reported), reported: Object.keys(next.reported).length });
  });

  app.get("/api/schedule/ops/:id", async (c) => {
    const id = (c.req.param("id") ?? "").toUpperCase();
    const op = fold(readLines()).find((x) => x.id === id);
    return op ? c.json({ op, mode: loadScheduleMode() }) : c.json({ error: "그런 SCHEDULE 작업이 없음" }, 404);
  });

  // linear-guard가 읽는 목록: 지금 모드와 발부된(released) 작업의 Linear 호출
  app.get("/api/schedule/released", (c) => {
    const ops = fold(readLines()).filter((x) => x.status === "released" && x.calls);
    return c.json({ mode: loadScheduleMode(), calls: ops.flatMap((x) => x.calls!.map((call, i) => ({ id: x.id, ...call, used: (x.used ?? []).includes(i) }))) });
  });

  // linear-guard가 통과시키기 직전에 부른다: 맞는 발부 호출을 한 번 쓴 것으로 기록한다. 읽기와 기록 사이에 await가 없어 두 번 통과하지 않는다.
  app.post("/api/schedule/released/claim", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "요청 본문을 읽지 못함" }, 400);
    const r = claimOf(fold(readLines()), loadScheduleMode(), body.tool, body.input);
    if ("error" in r) return c.json({ error: r.error }, 409);
    append([{ op: "use", id: r.id, at: new Date().toISOString(), call: r.call }]);
    return c.json(r);
  });

  app.post("/api/schedule/mode", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (body.mode !== "shadow" && body.mode !== "approval") return c.json({ error: "mode는 shadow|approval" }, 400);
    saveScheduleMode(body.mode);
    record({ t: new Date().toISOString(), kind: "schedule", op: `mode:${body.mode}`, id: "-" });
    return c.json({ mode: body.mode });
  });

  app.post("/api/schedule/ops", async (c: Context) => {
    const s = await getSnapshot();
    const body = await c.req.json().catch(() => ({}));
    try {
      const ops = current(s);
      const tails = body.kind === "NEW" ? newTailsOf(fleetView(s, loadFleet(), loadDispatchConfig().teamPattern)) : [];
      let closable: Map<string, Closable> | undefined;
      if (body.kind === "CLOSE") {
        // PR 본문을 아직 모르면 여기서 읽고(읽기 전용) 다시 계산한다
        closable = closeInfo(s).closable;
        const c = closable.get(String(body.flight ?? "").toUpperCase());
        if (c && !c.link) {
          await fetchPrBody(c.key);
          closable = closeInfo(s).closable;
        }
      }
      // NEW의 --milestone은 후보 팀 마일스톤만(다른 팀 WAYPOINT에 주 팀 이슈를 붙이지 않는다)
      const allMs = body.kind === "NEW" && body.milestone != null ? (await loadLinearProjects()).milestones : null;
      const milestones = allMs ? ofTeams(allMs, candidateTeamsOf(loadDispatchConfig())) : null;
      const network = isNetworkKind(body.kind) ? await networkCtxOf(s) : undefined;
      const tail = body.kind === "TAIL" ? await tailCtxOf(s, String(body.registration ?? "")) : undefined;
      const lines = draftOps(ops, body, s.tickets, new Date().toISOString(), ops.length, { tails, closable, teams: candidateTeamsOf(loadDispatchConfig()), milestones, network, tail });
      append(lines);
      const op = fold(readLines()).find((x) => x.id === lines[lines.length - 1].id);
      return c.json({ op, label: op?.flight ? flightNumber(op.flight) : null });
    } catch (e) {
      if (e instanceof ScheduleError) return c.json({ error: e.message }, e.status as 400);
      throw e;
    }
  });

  app.post("/api/schedule/ops/:id/verdict", async (c: Context) => {
    const id = (c.req.param("id") ?? "").toUpperCase();
    const body = await c.req.json().catch(() => ({}));
    if (body.verdict !== "agree" && body.verdict !== "disagree") return c.json({ error: "verdict는 agree|disagree" }, 400);
    const op = fold(readLines()).find((x) => x.id === id);
    if (!op) return c.json({ error: "그런 SCHEDULE 작업이 없음" }, 404);
    // TARGET·ROUTE는 적용하는 길이 아직 없어 approval 모드에서도 그림자 판정을 받는다
    if (loadScheduleMode() !== "shadow" && !isNetworkKind(op.kind)) return c.json({ error: "그림자 판정은 shadow 모드(S1)에서만 — approval 모드(S2)에서는 approve/reject" }, 409);
    if (op.status !== "draft") return c.json({ error: `지금 상태(${op.status})에서는 판정할 수 없음` }, 409);
    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;
    append([{ op: "verdict", id, at: new Date().toISOString(), verdict: body.verdict, reason, via: viaOf(body) }]);
    return c.json({ op: fold(readLines()).find((x) => x.id === id) });
  });

  // CROSSCHECK 예비 판정. 판정 권한이 아니라 참고 표시라 mode와 상관없이 받는다
  app.post("/api/schedule/ops/:id/crosscheck", async (c: Context) => {
    const id = (c.req.param("id") ?? "").toUpperCase();
    const body = await c.req.json().catch(() => ({}));
    const op = fold(readLines()).find((x) => x.id === id);
    if (!op) return c.json({ error: "그런 SCHEDULE 작업이 없음" }, 404);
    if (op.status !== "draft") return c.json({ error: `지금 상태(${op.status})에서는 CROSSCHECK를 달 수 없음 — 열린 초안만` }, 409);
    try {
      append([{ op: "crosscheck", id, ...parseCrosscheck(body, new Date().toISOString()) }]);
    } catch (e) {
      if (e instanceof CrosscheckError) return c.json({ error: e.message }, 400);
      throw e;
    }
    return c.json({ op: fold(readLines()).find((x) => x.id === id) });
  });

  // S2: 승인·거절(SUPERVISOR). approval 모드에서만
  for (const name of ["approve", "reject"] as const) {
    app.post(`/api/schedule/ops/:id/${name}`, async (c: Context) => {
      const id = (c.req.param("id") ?? "").toUpperCase();
      const body = await c.req.json().catch(() => ({}));
      if (loadScheduleMode() !== "approval") return c.json({ error: "승인·거절은 approval 모드(S2)에서만" }, 409);
      const op = fold(readLines()).find((x) => x.id === id);
      if (!op) return c.json({ error: "그런 SCHEDULE 작업이 없음" }, 404);
      if (isNetworkKind(op.kind)) return c.json({ error: `${NETWORK_APPLY_WHY} — verdict로 판정` }, 409);
      if (!canApplyOp(op, name)) return c.json({ error: `지금 상태(${op.status})에서는 할 수 없음` }, 409);
      const at = new Date().toISOString();
      const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;
      const via = viaOf(body);
      append([name === "approve" ? { op: "approve", id, at, via } : { op: "reject", id, at, reason, via }]);
      return c.json({ op: fold(readLines()).find((x) => x.id === id) });
    });
  }

  // S2: 발부(OCC). 승인된 작업의 Linear 호출을 만들어 기록하고 돌려준다. 이미 발부됐으면 같은 호출을 다시 준다(재시도용).
  app.post("/api/schedule/ops/:id/release", async (c: Context) => {
    const id = (c.req.param("id") ?? "").toUpperCase();
    if (loadScheduleMode() !== "approval") return c.json({ error: "발부는 approval 모드(S2)에서만" }, 409);
    const s = await getSnapshot();
    const op = current(s).find((x) => x.id === id);
    if (!op) return c.json({ error: "그런 SCHEDULE 작업이 없음" }, 404);
    if (op.status === "released" && op.calls) return c.json({ op, calls: op.calls });
    if (op.status !== "approved") return c.json({ error: `승인된 작업만 발부한다(지금 ${op.status})` }, 409);
    if (!s.linear.enabled || !s.linear.fetchedAt) return c.json({ error: "Linear를 아직 읽지 못함 — 잠시 뒤 다시" }, 503);
    let calls: LinearCall[];
    try {
      calls = callsOf(op, op.flight ? s.tickets.find((t) => t.key === op.flight) : undefined, config.linearTeamName);
    } catch (e) {
      if (e instanceof ScheduleError) return c.json({ error: e.message }, e.status as 409);
      throw e;
    }
    append([{ op: "release", id, at: new Date().toISOString(), calls }]);
    return c.json({ op: fold(readLines()).find((x) => x.id === id), calls });
  });
}

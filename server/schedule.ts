import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Context, Hono } from "hono";
import { flightNumber } from "./callsign.ts";
import { config } from "./config.ts";
import { classLabel, classOf, FLIGHT_TYPES, type FlightType, RATINGS, type Rating, WAKES, type Wake } from "./crew.ts";
import { type Crosscheck, CrosscheckError, type CrosscheckLine, type CrosscheckVerdict, crosscheckRateOf, examplesOf, type HumanDecision, markOf, oneClickOf, parseCrosscheck, type Via, viaOf } from "./crosscheck.ts";
import { DONE_STATES, loadDispatchConfig, PRIORITY_NAME } from "./dispatch.ts";
import { fleetView, loadFleet } from "./fleet.ts";
import type { Snapshot, Ticket } from "./model.ts";
import { record } from "./recorder.ts";

// OCC SCHEDULE — OCC가 Linear에 쓸 변경을 초안으로 남긴다. 설계: docs/occ.md 5~7장.
// 작업 종류는 CLASSIFY(분류 라벨), PRIORITIZE(우선순위), NEW(새 이슈).
// - S1(mode "shadow"): SUPERVISOR가 "승인했을 것 / 거절했을 것"만 표시한다. 아무것도 Linear에 쓰지 않는다.
// - S2(mode "approval"): SUPERVISOR가 승인하면 atc가 Linear 도구 호출 입력(calls)을 정확히 만들고(release),
//   OCC가 그대로 호출한다. occ/mcp-guard.mjs(linear-guard)가 발부된 입력과 한 글자도 다르지 않은 쓰기만 통과시킨다.
//   다음 Linear 읽기에서 반영이 보이면 APPLIED.

export const SCHEDULE_KINDS = ["CLASSIFY", "PRIORITIZE", "NEW"] as const;
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
  similar: SimilarTicket[]; // 초안을 쓸 때 atc가 찾은 비슷한 제목(중복 검색 결과)
}
export type SchedulePayload = ClassifyPayload | PrioritizePayload | NewPayload;

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
type StatusLine = Exclude<LogLine["op"], "draft" | "crosscheck">;
const NEXT: Partial<Record<ScheduleStatus, Partial<Record<StatusLine, ScheduleStatus>>>> = {
  draft: { verdict: "agreed", approve: "approved", reject: "rejected", supersede: "superseded", expire: "expired" },
  approved: { release: "released", supersede: "superseded", expire: "expired" },
  released: { release: "released", apply: "applied", supersede: "superseded", expire: "expired" },
};
export const canApplyOp = (s: Pick<ScheduleOp, "status">, op: StatusLine) => Boolean(NEXT[s.status]?.[op]);

// SUPERVISOR 판정과 그 사유. 사유는 판정한 상태에 머물러 있을 때만(approved 뒤의 verdictReason은 SUPERSEDED·EXPIRED 사유다)
export function humanOf(s: ScheduleOp): HumanDecision | null {
  if (!s.decision) return null;
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
export function changesOf(kind: ScheduleKind, payload: SchedulePayload, t?: Pick<Ticket, "labels" | "priority">): string[] {
  if (kind === "NEW") {
    const n = payload as NewPayload;
    const labels = [n.type && `type:${n.type}`, n.wake && `wake:${n.wake}`, ...(n.ratings ?? []).map((r) => `rating:${r}`), n.tail && `tail:${n.tail}`].filter(Boolean);
    return [[`새 이슈: ${n.title}`, n.project, n.priority ? PRIORITY_NAME[n.priority] : "없음", labels.join(" ")].filter(Boolean).join(" · ")];
  }
  if (!t) return [];
  if (kind === "PRIORITIZE") {
    const p = (payload as PrioritizePayload).priority;
    return t.priority === p ? [] : [`priority ${PRIORITY_NAME[t.priority] ?? "없음"} → ${PRIORITY_NAME[p]}`];
  }
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
  if (!SCHEDULE_KINDS.includes(kind as ScheduleKind)) throw new ScheduleError(`모르는 SCHEDULE 작업: ${kind} (가능: ${SCHEDULE_KINDS.join(", ")})`);
  if (kind === "PRIORITIZE") return { kind, payload: { priority: parsePriority(raw.priority) } };
  const payload = parseClass(raw);
  if (!payload.type && !payload.wake && !payload.ratings) throw new ScheduleError("CLASSIFY에는 type·wake·rating 중 하나 이상이 필요함");
  return { kind: "CLASSIFY", payload };
}

// 본문 칸 검사. 제목 줄은 마크다운 제목(`## 목표`)이거나 굵은 글씨로 시작하는 줄(`**목표**`, `**Goal:** …`)이다.
// 제목 글은 앞 번호(`1.`)·끝 콜론을 떼고 소문자로 바꿔, 칸 이름으로 시작하는지 본다(한국어·영어 둘 다).
// vocado 네 칸: 목표(Goal·Outcome), 수정 허용 범위(Allowed changes·files·scope), 금지 사항(Forbidden),
// 완료 기준(Acceptance·Done criteria). rating:SEC는 Codex Engineering Task 템플릿(Linear)의 칸
// Allowed files(`### Allowed files / surfaces`도 됨), Forbidden changes, Invariants, Acceptance Criteria,
// Verification이 더 있어야 한다. 그 템플릿 본문은 Outcome·Allowed files·Forbidden changes·Acceptance
// Criteria로 네 칸 검사도 통과한다.
const BODY_SECTIONS: [string, RegExp][] = [
  ["목표", /^(?:목표|goals?(?![a-z])|outcome)/],
  ["수정 허용 범위", /^(?:수정\s*허용\s*범위|허용\s*범위|allowed\s+(?:changes|files|scope))/],
  ["금지 사항", /^(?:금지|forbidden)/],
  ["완료 기준", /^(?:완료\s*기준|(?:acceptance|done)\s+criteria)/],
];
const CODEX_SECTIONS: [string, RegExp][] = [
  ["Allowed files", /^allowed\s+files/],
  ["Forbidden changes", /^forbidden\s+changes/],
  ["Invariants", /^invariants/],
  ["Acceptance Criteria", /^acceptance\s+criteria/],
  ["Verification", /^verification/],
];
export function headingsOf(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split("\n")) {
    const m = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/) ?? line.match(/^\s*(?:\*\*|__)(.+?)(?:\*\*|__)/);
    if (!m) continue;
    out.push(m[1].replace(/^\d+[.)]\s*/, "").replace(/[:：]\s*$/, "").replace(/\s+/g, " ").trim().toLowerCase());
  }
  return out;
}
export function missingSections(body: string, sec = false): string[] {
  const hs = headingsOf(body);
  const need = sec ? [...BODY_SECTIONS, ...CODEX_SECTIONS] : BODY_SECTIONS;
  return need.filter(([, re]) => !hs.some((h) => re.test(h))).map(([name]) => name);
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

// NEW 입력 검사(similar는 draftOps가 채운다). tails: 퇴역하지 않은 FLEET 등록번호.
export function parseNew(raw: Record<string, unknown>, tickets: Ticket[], tails: string[]): Omit<NewPayload, "similar"> {
  const title = typeof raw.title === "string" ? raw.title.trim().replace(/\s+/g, " ") : "";
  if (!title || title.length > 120) throw new ScheduleError("제목(title)은 1~120자");
  const body = typeof raw.body === "string" ? raw.body.trim() : "";
  if (!body) throw new ScheduleError("본문(body)이 필요함");
  if (body.length > 20_000) throw new ScheduleError("본문이 20,000자를 넘음");
  const cls = parseClass(raw);
  const missing = missingSections(body);
  if (missing.length) throw new ScheduleError(`본문에 빠진 칸: ${missing.join(", ")} (목표·수정 허용 범위·금지 사항·완료 기준 네 칸이 필요함)`);
  const codex = cls.ratings?.includes("SEC") ? missingSections(body, true).filter((m) => CODEX_SECTIONS.some(([n]) => n === m)) : [];
  if (codex.length) throw new ScheduleError(`rating:SEC 이슈는 Codex Engineering Task 템플릿으로 — 빠진 칸: ${codex.join(", ")}`);
  const projects = [...new Set(tickets.map((t) => t.project).filter(Boolean) as string[])];
  const project = projects.find((p) => p.toLowerCase() === String(raw.project ?? "").trim().toLowerCase());
  if (!project) throw new ScheduleError(`모르는 프로젝트: ${raw.project ?? "(비었음)"} (가능: ${projects.sort().join(", ")})`);
  const out: Omit<NewPayload, "similar"> = { title, body, project, ...cls };
  if (raw.priority != null) out.priority = parsePriority(raw.priority);
  if (raw.tail != null) {
    const tail = String(raw.tail).trim().toUpperCase().replace(/^TAIL:/, "");
    if (!tails.some((x) => x.toUpperCase() === tail)) throw new ScheduleError(`FLEET에 없거나 퇴역한 AIRCRAFT: ${tail}`);
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

// 새 초안 만들기(순수). 같은 FLIGHT·종류의 열린 초안은 새 초안이 SUPERSEDED로 대신한다.
// NEW는 FLIGHT 없이 쓰고, 다른 NEW를 대신하지 않는다. ctx.tails: tail로 쓸 수 있는 FLEET 등록번호.
export function draftOps(
  existing: ScheduleOp[],
  input: { kind: unknown; flight?: unknown; reason: unknown; [k: string]: unknown },
  tickets: Ticket[],
  now: string,
  seq: number,
  ctx: { tails?: string[] } = {},
): LogLine[] {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  let kind: ScheduleKind;
  let flight: string | null = null;
  let payload: SchedulePayload;
  if (input.kind === "NEW") {
    const base = parseNew(input, tickets, ctx.tails ?? []);
    if (!reason) throw new ScheduleError("근거(reason) 한 줄이 필요함");
    if (!reason.includes("중복 검색:")) throw new ScheduleError("NEW 근거에는 \"중복 검색:\"과 찾아본 결과가 필요함");
    kind = "NEW";
    payload = { ...base, similar: similarTickets(base.title, tickets, Date.parse(now)) };
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
  const inFlight = kind === "NEW" ? undefined : existing.find((s) => (s.status === "approved" || s.status === "released") && s.flight === flight && s.kind === kind);
  if (inFlight) throw new ScheduleError(`${flight}에는 진행 중인 ${kind} ${inFlight.id}(${inFlight.status})가 있음`, 409);
  const replaced = kind === "NEW" ? [] : open.filter((s) => s.flight === flight && s.kind === kind);
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
    return [{ tool: "save_issue", input }];
  }
  const flight = op.flight!;
  const note = (what: string) => ({ tool: "save_comment" as const, input: { issueId: flight, body: `[OCC ${op.id}] ${what} — 근거: ${op.reason} ${trail}` } });
  if (op.kind === "PRIORITIZE") {
    const p = (op.payload as PrioritizePayload).priority;
    return [{ tool: "save_issue", input: { id: flight, priority: p } }, note(`우선순위 ${PRIORITY_NAME[p]}`)];
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
export function syncLines(existing: ScheduleOp[], tickets: Ticket[], nowMs: number): LogLine[] {
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
    if (s.kind === "NEW" || s.flight == null) {
      const norm = normTitle((s.payload as NewPayload).title ?? "");
      const made = tickets.find((t) => normTitle(t.title) === norm && t.createdAt != null && Date.parse(t.createdAt) >= Date.parse(s.at));
      if (made) out.push(done(made.key, `Linear에 이미 만들어짐 ${made.key}`));
      else if (stale) out.push({ op: "expire", id: s.id, at, ...(staleWhy ? { reason: staleWhy } : {}) });
      continue;
    }
    const t = byKey.get(s.flight);
    if (!isOpenTicket(t)) out.push({ op: "supersede", id: s.id, at, reason: `FLIGHT 상태가 바뀜(${t?.state ?? "목록에 없음"})` });
    else if (!changesOf(s.kind, s.payload, t!).length) out.push(done(s.flight, "Linear에 이미 반영됨"));
    else if (stale) out.push({ op: "expire", id: s.id, at, ...(staleWhy ? { reason: staleWhy } : {}) });
  }
  return out;
}

export function gateOf(ops: ScheduleOp[]) {
  const decided = ops.filter((s) => s.status === "agreed" || s.status === "disagreed");
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
  };
}

// OCC 보정용 예시: 최근 SUPERVISOR 판정(사유 있는 것 먼저)과 OCC가 냈던 초안. 같은 실수를 되풀이하지 않게 초안 쓰기 전에 본다.
// NEW의 본문·비슷한 FLIGHT는 빼고 분류·우선순위만 남긴다.
export function occExamplesOf(ops: ScheduleOp[]) {
  return examplesOf(ops.map((s) => ({ s, human: humanOf(s) }))).map(({ s, human }) => {
    const { body: _b, similar: _s, ...proposed } = s.payload as NewPayload;
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

// OCC가 초안을 쓸 후보: 계획 단계(Todo·Backlog)인데 분류 라벨이 없거나 우선순위가 없는 FLIGHT
export function candidatesOf(tickets: Ticket[], ops: ScheduleOp[]) {
  const openFor = new Set(ops.filter((s) => s.status === "draft" || s.status === "approved" || s.status === "released").map((s) => `${s.kind}|${s.flight}`));
  const planning = tickets.filter(isOpenTicket);
  return {
    classify: planning.filter((t) => { const c = classOf(t.labels); return !c.explicit.type || !c.explicit.wake; }).filter((t) => !openFor.has(`CLASSIFY|${t.key}`)).map((t) => t.key),
    prioritize: planning.filter((t) => !t.priority && !openFor.has(`PRIORITIZE|${t.key}`)).map((t) => t.key),
  };
}

export function mountSchedule(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  // 브리핑할 때마다 상황이 바뀐 초안을 먼저 닫는다. Linear를 아직 못 읽었으면(시작 직후, 꺼짐) 닫지 않는다 —
  // 빈 티켓 목록과 맞추면 열린 초안이 모두 SUPERSEDED가 된다.
  const current = (s: Snapshot) => {
    const lines = readLines();
    const ops = fold(lines);
    const closing = s.linear.enabled && s.linear.fetchedAt ? syncLines(ops, s.tickets, Date.now()) : [];
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
    const candidates = candidatesOf(s.tickets, ops);
    // NEW 초안의 관계·비슷한 FLIGHT도 화면이 제목과 링크를 보이게 넣는다
    const newKeys = [...open, ...inProgress, ...recent].filter((x) => x.kind === "NEW").flatMap((x) => {
      const p = x.payload as NewPayload;
      return [p.parent, ...(p.related ?? []), ...(p.blockedBy ?? []), ...(p.similar ?? []).map((m) => m.key)].filter(Boolean) as string[];
    });
    const keys = new Set([...(ops.map((x) => x.flight).filter(Boolean) as string[]), ...candidates.classify, ...candidates.prioritize, ...newKeys]);
    const byKey = new Map(s.tickets.map((t) => [t.key, t]));
    const flights = Object.fromEntries(
      [...keys].filter((k) => byKey.has(k)).map((k) => {
        const t = byKey.get(k)!;
        return [k, { title: t.title, state: t.state, priority: t.priority, project: t.project, url: t.url, cls: classLabel(classOf(t.labels)), labels: t.labels }];
      }),
    );
    const changes = Object.fromEntries([...open, ...inProgress].map((x) => [x.id, changesOf(x.kind, x.payload, x.flight ? byKey.get(x.flight) : undefined)]));
    return c.json({ mode, open, inProgress, recent, changes, gate: gateOf(ops), limit: SCHEDULE_OPEN_LIMIT, candidates, flights, examples: occExamplesOf(ops), crosscheck: crosscheckBriefOf(ops, changes) });
  });

  app.get("/api/schedule/ops/:id", async (c) => {
    const id = (c.req.param("id") ?? "").toUpperCase();
    const op = fold(readLines()).find((x) => x.id === id);
    return op ? c.json({ op, mode: loadScheduleMode() }) : c.json({ error: "그런 SCHEDULE 작업이 없음" }, 404);
  });

  // linear-guard가 읽는 목록: 지금 모드와 발부된(released) 작업의 Linear 호출
  app.get("/api/schedule/released", (c) => {
    const ops = fold(readLines()).filter((x) => x.status === "released" && x.calls);
    return c.json({ mode: loadScheduleMode(), calls: ops.flatMap((x) => x.calls!.map((call) => ({ id: x.id, ...call }))) });
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
      const tails = body.kind === "NEW" ? fleetView(s, loadFleet(), loadDispatchConfig().teamPattern).filter((a) => !a.retired).map((a) => a.registration) : [];
      const lines = draftOps(ops, body, s.tickets, new Date().toISOString(), ops.length, { tails });
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
    if (loadScheduleMode() !== "shadow") return c.json({ error: "그림자 판정은 shadow 모드(S1)에서만 — approval 모드(S2)에서는 approve/reject" }, 409);
    const op = fold(readLines()).find((x) => x.id === id);
    if (!op) return c.json({ error: "그런 SCHEDULE 작업이 없음" }, 404);
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
    const calls = callsOf(op, op.flight ? s.tickets.find((t) => t.key === op.flight) : undefined, config.linearTeamName);
    append([{ op: "release", id, at: new Date().toISOString(), calls }]);
    return c.json({ op: fold(readLines()).find((x) => x.id === id), calls });
  });
}

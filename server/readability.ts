import type { Transmission } from "./radio.ts";
import type { TrafficEvent } from "./model.ts";
import { CAUSES, causeOf, type UndeliveredCause } from "./address.ts";
import { DEFAULT_TEAM_PATTERN, regKey } from "./registration.ts";

// READABILITY R0(ATC-176, docs/readability.md): 무선 교신의 질을 재는 순수 함수. 기록(RADIO의 교신)과 대화 기록에서 뽑은 답 한 줄, 이벤트에서 계산하고
// 아무것도 읽거나 쓰지 않는다. 재는 것을 바꾸지 않으려고 문구·가드·매뉴얼은 건드리지 않는다.

// 토큰 추정: 문자 수 ÷ 2.5(한국어·영어 섞인 글의 어림). 정확한 토크나이저가 아니다
export const CHARS_PER_TOKEN = 2.5;
export const tokensOf = (chars: number) => Math.round(chars / CHARS_PER_TOKEN);

// 답이 이보다 늦으면 overdue: CLEARANCE·FLIGHT PLAN·CREW CHANGE의 기존 규칙과 같은 10분
export const OVERDUE_MS = 10 * 60_000;
// 닫는 답이 이보다 앞서 기록됐으면 그 호출은 그 메시지가 오기 전에 닫힌 것이다(기록과 대화 기록의 시각 차이 여유)
export const CLOSE_GRACE_MS = 2 * 60_000;
export const FIRST_LINE_MAX = 200;

export const UNABLE_CLASSES = ["no-merge", "stale", "wrong-target", "busy", "blocked", "none", "other"] as const;
export type UnableClass = (typeof UNABLE_CLASSES)[number];

// ── 대화 기록에서 뽑은 답 ──

// 관제 세션(TOWER·OCC)이 받은 cross-session-message 한 통. 첫 줄(≤ 200자)과 전체 길이(봉투 포함)만 든다. 본문은 남기지 않는다
export interface TranscriptReply {
  at: string;
  from: string; // 보낸 세션 이름(from-name)
  to: "TOWER" | "OCC"; // 받은 관제 세션
  first: string;
  length: number; // 봉투(<cross-session-message …> 태그)까지 뺀 것 없이 받은 그대로의 길이
  lines: number; // 봉투 안 본문의 비어 있지 않은 줄 수
}

// 대화 기록의 user 줄은 봉투 앞에 하네스가 "Another Claude session sent a message:" 줄을 붙이고 뒤에 안내 글을 덧붙인다. 길이는 그 전체다
const ENVELOPE = /^\s*(?:Another Claude session sent a message:\s*)?<cross-session-message\b([^>]*)>\n?/;
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

// user 메시지 content(문자열) → 답. 봉투가 아니면 null
export function replyOfEnvelope(content: string, at: string, to: TranscriptReply["to"]): TranscriptReply | null {
  const m = ENVELOPE.exec(content);
  if (!m) return null;
  const from = attr(m[1]!, "from-name");
  if (!from) return null;
  const inner = content.slice(m[0].length).replace(/<\/cross-session-message>[\s\S]*$/, "");
  const lines = inner.split("\n").map((l) => l.trim()).filter(Boolean);
  return { at, from, to, first: cap(lines[0] ?? "", FIRST_LINE_MAX), length: content.length, lines: lines.length };
}

// 답의 머리: `READBACK|UNABLE|STANDBY|ROGER <id>` (RECALL 답은 뒤에 RECALL이 붙는다)
const HEAD = /^(READBACK|UNABLE|STANDBY|ROGER)\s+([A-Z]{1,4}-\d{1,6})\b/;
export interface Head {
  answer: "READBACK" | "UNABLE" | "STANDBY" | "ROGER";
  id: string;
  reason: string | null; // UNABLE <id> — 사유 의 사유(첫 줄 안에서)
}
export function headOf(first: string): Head | null {
  const m = HEAD.exec(first.trim());
  if (!m) return null;
  const rest = first.trim().slice(m[0].length).replace(/^\s*(RECALL\b)?\s*[—–-]*\s*/i, "").trim();
  return { answer: m[1] as Head["answer"], id: m[2]!, reason: rest || null };
}
// 보고 머리(`[TEAM_X → OCC] ARRIVED …`)는 답이 아니다
export const isReport = (first: string) => /^\[[^\]]*→[^\]]*\]/.test(first.trim());

// ── UNABLE 사유 분류: 작은 고정 분류기 ──
// 처음 맞는 것이 이긴다. 사유가 없으면 none, 어디에도 안 맞으면 other
const NO_MERGE = /\b(?:don'?t|do not|does not|never|cannot|can'?t|must not|not allowed to|not permitted to)\s+(?:\w+\s+){0,3}merge|landing is (?:the )?(?:mcc|user|supervisor)|MCC lands|머지하지|머지는/i;
const WRONG_TARGET = /wrong (?:session|team|aircraft|target|recipient|stand|repo)|not (?:my|our) (?:flight|task|stand|pr)|not the (?:holder|owner|captain)|not addressed to|no such (?:pr|stand|flight|aircraft)|unknown (?:flight|pr|stand)/i;
const STALE = /nothing left|already (?:merged|landed|done|closed|arrived)|state (?:is )?merged|no longer (?:needed|applies|open)|superseded/i;
const BUSY = /\b(?:busy|occupied|another (?:flight|task|clearance)|already (?:working|assigned|flying)|no capacity|cannot take|can'?t take|mid-?flight|in the middle of)\b/i;
const BLOCKED = /\b(?:blocked|waiting (?:on|for)|depends on|dependency|prerequisite|cannot proceed|can'?t proceed|guard|denied|refus\w+|CI (?:is )?(?:red|failing|failed)|conflicts?)\b/i;
export function unableClassOf(reason: string | null | undefined): UnableClass {
  const r = (reason ?? "").trim();
  if (!r) return "none";
  if (NO_MERGE.test(r)) return "no-merge";
  if (WRONG_TARGET.test(r)) return "wrong-target";
  if (STALE.test(r)) return "stale";
  if (BUSY.test(r)) return "busy";
  if (BLOCKED.test(r)) return "blocked";
  return "other";
}

// ── 통계 ──

export interface Stat {
  n: number;
  medianMs: number | null;
  p90Ms: number | null;
}
export function statOf(values: readonly number[]): Stat {
  if (!values.length) return { n: 0, medianMs: null, p90Ms: null };
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  const median = v.length % 2 ? v[mid]! : Math.round((v[mid - 1]! + v[mid]!) / 2);
  return { n: v.length, medianMs: median, p90Ms: v[Math.ceil(0.9 * v.length) - 1]! };
}

export interface Size {
  n: number;
  chars: number;
  tokens: number; // 추정: chars ÷ CHARS_PER_TOKEN
}
export interface Compliance extends Stat {
  applicable: number; // 이 종류의 호출 수
  complied: number; // 기록에 따른 이행 근거가 있음
  unknown: number; // 근거 없음(이행 안 함이 아니다)
}
export interface Phraseology {
  checked: number; // 답으로 본 메시지 수
  missingHead: number;
  multilineUnable: number;
  wrongId: number;
}
export interface Bucket {
  calls: number;
  replied: number; // 창 안에 첫 답이 있음
  late: number; // 첫 답이 창이 끝난 뒤에야 옴(무응답에 세지 않는다)
  noReply: number; // 답 없음. 취소·철회로 거둔 호출은 뺀다
  withdrawn: number; // 취소(cancel)·철회(recall·supersede)·다른 길로 전달(delivered)로 거둔 호출
  overdue: number; // 첫 답이 10분보다 늦음, 또는 답 없이 창 끝까지 10분이 지남
  latency: Stat; // 호출 → 첫 답(STANDBY 포함)
  unable: { n: number; classes: Record<UnableClass, number> };
  sent: Size; // atc → 팀: 기록된 문구(봉투 없음)
  received: Size; // 팀 → 관제: 대화 기록에서 본 메시지 전체(봉투 포함)
  compliance: { goAround: Compliance; flightPlan: Compliance; recall: Compliance };
  phraseology: Phraseology;
  undelivered: { n: number; causes: Record<UndeliveredCause, number> }; // 닿지 못한 호출의 원인별 수(ATC-353). 옛 줄에는 없다
}
export interface Readability {
  window: { from: string; to: string };
  total: Bucket;
  byFreq: Record<string, Bucket>;
  byKind: Record<string, Bucket>;
  byAircraft: Record<string, Bucket>;
}

interface Comp {
  goAround: number[];
  flightPlan: number[];
  recall: number[];
  n: { goAround: number; flightPlan: number; recall: number };
}
interface Acc {
  calls: number;
  replied: number;
  late: number;
  noReply: number;
  withdrawn: number;
  overdue: number;
  latency: number[];
  unable: Record<UnableClass, number>;
  sent: { n: number; chars: number };
  received: { n: number; chars: number };
  comp: Comp;
  ph: Phraseology;
  undelivered: Record<UndeliveredCause, number>;
}
const newAcc = (): Acc => ({
  calls: 0, replied: 0, late: 0, noReply: 0, withdrawn: 0, overdue: 0, latency: [],
  unable: Object.fromEntries(UNABLE_CLASSES.map((c) => [c, 0])) as Record<UnableClass, number>,
  sent: { n: 0, chars: 0 }, received: { n: 0, chars: 0 },
  comp: { goAround: [], flightPlan: [], recall: [], n: { goAround: 0, flightPlan: 0, recall: 0 } },
  ph: { checked: 0, missingHead: 0, multilineUnable: 0, wrongId: 0 },
  undelivered: Object.fromEntries(CAUSES.map((c) => [c, 0])) as Record<UndeliveredCause, number>,
});
const size = (s: { n: number; chars: number }): Size => ({ n: s.n, chars: s.chars, tokens: tokensOf(s.chars) });
const comp = (values: number[], applicable: number): Compliance => ({ ...statOf(values), applicable, complied: values.length, unknown: applicable - values.length });
function finalize(a: Acc): Bucket {
  const unableN = UNABLE_CLASSES.reduce((n, c) => n + a.unable[c], 0);
  return {
    calls: a.calls, replied: a.replied, late: a.late, noReply: a.noReply, withdrawn: a.withdrawn, overdue: a.overdue,
    latency: statOf(a.latency), unable: { n: unableN, classes: a.unable },
    sent: size(a.sent), received: size(a.received),
    compliance: { goAround: comp(a.comp.goAround, a.comp.n.goAround), flightPlan: comp(a.comp.flightPlan, a.comp.n.flightPlan), recall: comp(a.comp.recall, a.comp.n.recall) },
    phraseology: a.ph,
    undelivered: { n: CAUSES.reduce((n, c) => n + a.undelivered[c], 0), causes: a.undelivered },
  };
}

// ── 계산 ──

const CLOSING = new Set(["READBACK", "ROGER", "UNABLE"]);
const WITHDRAWN = new Set(["cancel", "recall", "supersede", "delivered", "undelivered"]);
const rootId = (id: string) => id.split("#")[0]!;
const isCall = (t: Transmission) => !t.replyTo && (t.from === "TOWER" || t.from === "OCC") && t.freq !== "GROUND" && t.freq !== "PREFLIGHT"; // PREFLIGHT는 호출이 아니다(ATC-267)
const ms = (iso: string) => Date.parse(iso);

export interface Window {
  from: string; // 포함
  to: string; // 미포함
}

// GO AROUND 본문(영어, go-around.ts)에서 PR 번호와 head 7자리
const goAroundTarget = (body: string | undefined) => {
  const pr = /\bPR #(\d+)/.exec(body ?? "")?.[1];
  const head = /\bhead ([0-9a-f]{7})\b/i.exec(body ?? "")?.[1];
  return pr ? { pr: Number(pr), head: head?.toLowerCase() ?? null } : null;
};

// GO AROUND 이행 근거: 같은 PR에서 그 뒤에 (다른 head의 충돌·앞 PR 머지 이벤트) 또는 (landing.cleared·landing.left)가 생김.
// 이벤트에는 head가 CLEARED 쪽엔 없어서, CLEARED·left는 충돌이 풀렸다는 근거로 쓴다(대개 새 head가 push된 뒤에야 풀린다)
function goAroundEvidence(call: Transmission, events: readonly TrafficEvent[], toMs: number): number | null {
  const target = goAroundTarget(call.body);
  if (!target) return null;
  const at = ms(call.at);
  let best: number | null = null;
  for (const e of events) {
    if (e.pull !== target.pr) continue;
    const t = ms(e.at);
    if (t <= at || t >= toMs) continue;
    const changed = (e.kind === "landing.conflict" || e.kind === "landing.prevMerged") && e.head !== undefined && target.head !== null && e.head.toLowerCase() !== target.head;
    if (changed || e.kind === "landing.cleared" || e.kind === "landing.left") best = best === null ? t : Math.min(best, t);
  }
  return best === null ? null : best - at;
}

export function readabilityOf(transmissions: readonly Transmission[], replies: readonly TranscriptReply[], events: readonly TrafficEvent[], window: Window, teamPattern = DEFAULT_TEAM_PATTERN): Readability {
  const fromMs = ms(window.from);
  const toMs = ms(window.to);
  const inWindow = (iso: string) => ms(iso) >= fromMs && ms(iso) < toMs;

  const byCall = new Map<string, Transmission[]>();
  for (const t of transmissions) if (t.replyTo) byCall.set(t.replyTo, [...(byCall.get(t.replyTo) ?? []), t]);
  for (const list of byCall.values()) list.sort((a, b) => ms(a.at) - ms(b.at));
  const calls = transmissions.filter(isCall);
  const arrived = transmissions.filter((t) => t.kind === "ARRIVED");

  const total = newAcc();
  const byFreq = new Map<string, Acc>();
  const byKind = new Map<string, Acc>();
  const byAircraft = new Map<string, Acc>();
  const get = (m: Map<string, Acc>, k: string) => m.get(k) ?? (m.set(k, newAcc()), m.get(k)!);
  // 한 호출의 통계를 (전체, 주파수, 종류, AIRCRAFT)에 모두 더한다
  const accsOf = (t: Transmission) => [total, get(byFreq, t.freq), get(byKind, t.kind), get(byAircraft, t.aircraft ?? "?")];

  // 이 AIRCRAFT에 간 호출 목록(받은 관제 세션별로 TOWER는 TOWER, 나머지는 OCC)
  const receiverOf = (t: Transmission): "TOWER" | "OCC" => (t.from === "TOWER" ? "TOWER" : "OCC");
  const callsTo = new Map<string, Transmission[]>();
  for (const c of calls) callsTo.set(`${receiverOf(c)}|${regKey(c.aircraft, teamPattern)}`, [...(callsTo.get(`${receiverOf(c)}|${regKey(c.aircraft, teamPattern)}`) ?? []), c]);

  const closeAt = (c: Transmission): number | null => {
    const r = (byCall.get(c.id) ?? []).find((x) => CLOSING.has(x.kind));
    return r ? ms(r.at) : null;
  };

  // 창 안의 호출
  const windowCalls = calls.filter((c) => inWindow(c.at));
  // 대화 기록의 답에서 UNABLE 사유를 찾는다: 같은 AIRCRAFT가 그 id로 UNABLE을 보낸 첫 줄의 사유
  const unableReasonFromTranscript = (c: Transmission): string | null => {
    for (const r of replies) {
      if (regKey(r.from, teamPattern) !== regKey(c.aircraft, teamPattern)) continue;
      const h = headOf(r.first);
      if (h?.answer === "UNABLE" && h.id === rootId(c.id)) return h.reason;
    }
    return null;
  };

  for (const c of windowCalls) {
    const accs = accsOf(c);
    const list = byCall.get(c.id) ?? [];
    const visible = list.filter((r) => ms(r.at) < toMs);
    const first = visible[0];
    for (const a of accs) {
      a.calls++;
      a.sent.n++;
      a.sent.chars += (c.body ?? "").length;
    }
    if (first) {
      const lat = Math.max(0, ms(first.at) - ms(c.at));
      for (const a of accs) {
        a.replied++;
        a.latency.push(lat);
        if (lat > OVERDUE_MS) a.overdue++;
      }
    } else if (list.length) {
      for (const a of accs) a.late++;
    } else if (c.closedBy && WITHDRAWN.has(c.closedBy)) {
      for (const a of accs) a.withdrawn++;
    } else {
      for (const a of accs) {
        a.noReply++;
        if (toMs - ms(c.at) > OVERDUE_MS) a.overdue++;
      }
    }
    if (c.undelivered !== undefined) {
      const cause = causeOf(c.undelivered, c.undeliveredCause);
      for (const a of accs) a.undelivered[cause]++;
    }
    for (const r of visible) {
      if (r.kind !== "UNABLE") continue;
      const cls = unableClassOf(r.body ?? unableReasonFromTranscript(c));
      for (const a of accs) a.unable[cls]++;
    }

    // 이행: 기록에서 이끌어 낼 수 있는 것만. 근거가 없으면 unknown(이행 안 함이 아니다)
    if (c.kind === "GO AROUND") {
      for (const a of accs) a.comp.n.goAround++;
      const dt = goAroundEvidence(c, events, toMs);
      if (dt !== null) for (const a of accs) a.comp.goAround.push(dt);
    } else if (c.kind === "FLIGHT PLAN") {
      for (const a of accs) a.comp.n.flightPlan++;
      const rb = visible.find((r) => r.kind === "READBACK");
      const arr = rb ? arrived.filter((t) => t.flight === c.flight && ms(t.at) > ms(rb.at) && ms(t.at) < toMs).sort((x, y) => ms(x.at) - ms(y.at))[0] : undefined;
      if (rb && arr) for (const a of accs) a.comp.flightPlan.push(ms(arr.at) - ms(rb.at));
    } else if (c.kind === "RECALL") {
      for (const a of accs) a.comp.n.recall++;
      const rb = visible.find((r) => r.kind === "READBACK");
      if (rb) for (const a of accs) a.comp.recall.push(Math.max(0, ms(rb.at) - ms(c.at)));
    }
  }

  // 대화 기록의 답: 받은 크기와 화법
  for (const r of replies) {
    if (!inWindow(r.at)) continue;
    const t = ms(r.at);
    const key = `${r.to}|${regKey(r.from, teamPattern)}`;
    const mine = (callsTo.get(key) ?? []).filter((c) => ms(c.at) <= t);
    // 그 메시지가 오기 전에 이미 닫힌 호출은 뺀다: 이 메시지는 그 호출의 답이 아니다
    const open = mine.filter((c) => {
      const closed = closeAt(c);
      return closed === null || closed >= t - CLOSE_GRACE_MS;
    });
    const latest = open.at(-1);
    const accs = latest ? accsOf(latest) : [total, get(byAircraft, regKey(r.from, teamPattern))];
    for (const a of accs) {
      a.received.n++;
      a.received.chars += r.length;
    }
    if (isReport(r.first) || !latest) continue;
    const h = headOf(r.first);
    for (const a of accs) {
      a.ph.checked++;
      if (!h) a.ph.missingHead++;
      else {
        if (!open.some((c) => rootId(c.id) === h.id)) a.ph.wrongId++;
        if (h.answer === "UNABLE" && r.lines > 1) a.ph.multilineUnable++;
      }
    }
  }

  const done = (m: Map<string, Acc>) => Object.fromEntries([...m].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, finalize(v)]));
  return { window, total: finalize(total), byFreq: done(byFreq), byKind: done(byKind), byAircraft: done(byAircraft) };
}

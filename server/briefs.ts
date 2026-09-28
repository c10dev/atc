import { findingSeverityOf, type GhThread, isCodexBot, type LandingReview } from "./landing.ts";

// DIRECT·VECTORS 지시서(ATC-32). 설계: docs/dispatch.md "DIRECT briefs".
// VECTORS: 지금까지의 지시서(번호 붙은 단계, 긴 템플릿, 모호하면 먼저 묻기).
// DIRECT: 목표, 완료 기준, 이 작업만의 제약만 담고 "끝까지 한 번에"를 적은 지시서. 모호한 것은 PILOT'S DISCRETION.
// 둘을 LOGBOOK 기록으로 비교한다: 중간 질문 수, READBACK → PR 시간, P0–P2 지적, PR 뒤 수정 커밋.

export type BriefKind = "DIRECT" | "VECTORS";
export const BRIEF_KINDS: BriefKind[] = ["VECTORS", "DIRECT"];
export const DIRECT_LINE = "BRIEF: DIRECT";
export const FINISH_LINE = "끝까지 진행하고, SUPERVISOR 결정이 필요한 것만 멈춰서 물어 주세요.";
export const DISCRETION_LINE = "애매한 곳은 PILOT'S DISCRETION으로 합리적인 기본값을 고르고 PR에 적으세요.";

// 지시서 머리 줄. `BRIEF: DIRECT`가 있으면 DIRECT, `BRIEF: VECTORS`면 VECTORS, 없으면 null
export function briefLineOf(text: string): BriefKind | null {
  const m = /^\s*BRIEF\s*[:：]\s*(DIRECT|VECTORS)\b/im.exec(text);
  return m ? (m[1].toUpperCase() as BriefKind) : null;
}

// ── 이슈 본문에서 목표·완료 기준·이 작업만의 제약 ──

export const GOAL_RE = /^(?:목표|goals?(?![a-z])|outcome|objective)/;
export const DONE_RE = /^(?:완료\s*(?:기준|조건)|(?:acceptance|done|exit)\s+criteria|acceptance|done\s+when|definition\s+of\s+done)/;
export const CONSTRAINT_RE = /^(?:이\s*작업만의\s*제약|필수\s*제약|제약|hard\s+constraints|constraints|금지|forbidden|invariants|not\s+in\s+scope|out\s+of\s+scope)/;
const KNOWN = [GOAL_RE, DONE_RE, CONSTRAINT_RE, /^(?:수정\s*허용\s*범위|허용\s*범위|allowed\s|scope|verification|context|why|배경)/];

interface Label {
  i: number;
  level: number; // 마크다운 제목은 # 수, 굵은 줄·평문 이름표는 7
  title: string; // 소문자, 앞 번호·끝 콜론 뗌
  rest: string; // 같은 줄에 이어 쓴 내용(`**Goal:** x`, `목표: x`)
}
const clean = (s: string) => s.replace(/^\d+[.)]\s*/, "").replace(/[:：]\s*$/, "").replace(/\s+/g, " ").trim().toLowerCase();
// 칸 제목 줄: 마크다운 제목, 굵은 글씨로 시작하는 줄, 아는 칸 이름으로 시작하는 평문 이름표(`완료 기준: …`)
export function labelOf(line: string, i = 0): Label | null {
  const h = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  if (h) return { i, level: h[1].length, title: clean(h[2]), rest: "" };
  const b = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*[:：]?\s*(.*)$/.exec(line);
  if (b) return { i, level: 7, title: clean(b[1]), rest: b[2].trim() };
  const p = /^\s*([^\s:：#*\-|>`][^:：\n]{0,29}?)\s*[:：]\s*(.*)$/.exec(line);
  if (p && KNOWN.some((re) => re.test(clean(p[1])))) return { i, level: 7, title: clean(p[1]), rest: p[2].trim() };
  return null;
}

// 긴 칸은 줄 경계에서 자른다(나머지는 링크의 이슈 본문)
export function clip(text: string, max = 600): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf("\n", max);
  return `${text.slice(0, cut > max / 2 ? cut : max).trimEnd()} …`;
}

export interface DirectSections {
  goal: string | null;
  done: string | null;
  constraints: string | null;
}
// 칸 제목과 그 내용(제목 줄에 이어 쓴 것 + 다음 같은 급 이하 제목 전까지)
export function sectionsOfMd(md: string | null | undefined): { title: string; text: string }[] {
  const lines = (md ?? "").split("\n");
  const labels = lines.map((l, i) => labelOf(l, i)).filter((x) => x !== null);
  return labels.map((h) => {
    const next = labels.find((x) => x.i > h.i && x.level <= h.level);
    return { title: h.title, text: [h.rest, ...lines.slice(h.i + 1, next?.i ?? lines.length)].join("\n").trim() };
  });
}

export function directSectionsOf(md: string | null | undefined): DirectSections {
  const sections = sectionsOfMd(md);
  const take = (re: RegExp) => {
    const got = sections.filter((x) => re.test(x.title) && x.text).map((x) => x.text);
    return got.length ? clip(got.join("\n")) : null;
  };
  return { goal: take(GOAL_RE), done: take(DONE_RE), constraints: take(CONSTRAINT_RE) };
}

// DIRECT 지시서의 본문 줄(머리 줄과 끝 줄 사이). 여러 줄이면 이름표 다음 줄부터
export function directLines(s: DirectSections): string[] {
  const field = (name: string, v: string) => (v.includes("\n") ? `${name}:\n${v}` : `${name}: ${v}`);
  return [
    s.goal ? field("목표", s.goal) : null,
    field("완료 기준", s.done ?? "이슈 본문(링크)의 완료 기준을 따릅니다."),
    s.constraints ? field("이 작업만의 제약", s.constraints) : null,
  ].filter((x) => x !== null);
}

// structure 같은 세션이 팀에 붙여 넣을 DIRECT 배정 문구(GET /api/dispatch/flight/:key/brief). FLIGHT PLAN과 같은 모양
export function formatAssignment(t: { key: string; title: string | null; url: string | null }, description: string | null, to: string | null): string {
  return [
    to ? `[→ ${to}] ${t.key}` : t.key,
    DIRECT_LINE,
    t.title,
    t.url,
    ...directLines(directSectionsOf(description)),
    DISCRETION_LINE,
    `— 맡으면 "READBACK ${t.key}", 못 맡으면 사유로 답해 주세요. PR을 올리면 번호를 알려 주세요.`,
    FINISH_LINE,
  ]
    .filter(Boolean)
    .join("\n");
}

// ── 대화 기록에서 지시서·READBACK·질문 ──
// 팀 세션의 대화 기록(.jsonl)에서 필요한 사실만 뽑는다. 본문은 저장하지 않는다.
//   in:  받은 메시지(다른 세션의 cross-session 메시지, 사용자가 친 메시지) — 시각, 보낸 세션, FLIGHT key, D-xxxx, BRIEF 줄
//   out: 보낸 SendMessage — 시각, 받는 곳, FLIGHT key, D-xxxx, READBACK인지, PR 보고인지
//   ask: AskUserQuestion 호출 시각

export interface TalkEvent {
  t: string;
  dir: "in" | "out" | "ask";
  from?: string | null; // in: cross-session from(주소). 사용자가 친 메시지면 null
  fromName?: string | null; // in: from-name(structure, OCC …)
  to?: string; // out
  keys: string[]; // "ATC-32" 꼴
  ids: string[]; // DISPATCH 제안 id(D-0007)
  brief?: BriefKind | null; // in: BRIEF 줄
  readback?: boolean; // out
  report?: boolean; // out: PR 번호를 알림
}

const keysIn = (text: string) => {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?<![A-Za-z0-9])([A-Z][A-Z0-9]{1,9})-(\d{1,6})(?!\d)/g)) out.add(`${m[1]}-${Number(m[2])}`);
  for (const m of text.matchAll(/\bFLIGHT\s+([A-Z]{2,10})(\d{1,6})\b/g)) out.add(`${m[1]}-${Number(m[2])}`);
  return [...out];
};
const idsIn = (text: string) => [...new Set([...text.matchAll(/\b(D-\d{4,})\b/g)].map((m) => m[1]))];
const attr = (head: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(head)?.[1] ?? null;

function textOf(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const texts = content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text as string);
  return texts.length ? texts.join("\n") : null;
}

// 대화 기록 조각(여러 줄) → 사건. 서브에이전트 줄(isSidechain)과 도구 결과는 뺀다
export function talkEventsOf(text: string): TalkEvent[] {
  const out: TalkEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line || !(line.includes('"type":"user"') || line.includes('"SendMessage"') || line.includes('"AskUserQuestion"'))) continue;
    let d: { type?: string; timestamp?: string; isSidechain?: boolean; isMeta?: boolean; message?: { content?: unknown } };
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.isSidechain || typeof d.timestamp !== "string") continue;
    const t = d.timestamp;
    if (d.type === "user") {
      const body = textOf(d.message?.content);
      if (!body) continue;
      const cross = /<cross-session-message\b([^>]*)>/.exec(body);
      // skill 본문·시스템 알림(isMeta)은 받은 지시가 아니다. cross-session 메시지는 isMeta여도 받는다
      if (!cross && d.isMeta) continue;
      const keys = keysIn(body);
      const ids = idsIn(body);
      if (!keys.length && !ids.length) continue;
      out.push({ t, dir: "in", from: cross ? attr(cross[1], "from") : null, fromName: cross ? attr(cross[1], "from-name") : null, keys, ids, brief: briefLineOf(body) });
    } else if (d.type === "assistant" && Array.isArray(d.message?.content)) {
      for (const b of d.message.content as { type?: string; name?: string; input?: { to?: unknown; message?: unknown } }[]) {
        if (b?.type !== "tool_use") continue;
        if (b.name === "AskUserQuestion") out.push({ t, dir: "ask", keys: [], ids: [] });
        if (b.name !== "SendMessage") continue;
        const msg = typeof b.input?.message === "string" ? b.input.message : JSON.stringify(b.input?.message ?? "");
        out.push({
          t,
          dir: "out",
          to: String(b.input?.to ?? ""),
          keys: keysIn(msg),
          ids: idsIn(msg),
          readback: /\bREADBACK\b/.test(msg),
          report: /\bPR\s*#\d+|\/pull\/\d+/.test(msg),
        });
      }
    }
  }
  return out;
}

export interface BriefFacts {
  kind: BriefKind;
  at: string; // 지시서를 받은 시각
  by: string | null; // 보낸 세션 이름(structure, OCC …). 사용자가 쳤으면 null
  readbackAt: string | null;
  questions: number; // READBACK(없으면 지시서) 뒤 PR을 열기 전까지, 지시한 쪽에 보낸 메시지와 AskUserQuestion
}
const BRIEF_LOOKBACK_MS = 14 * 86_400_000;
const NO_READBACK_SLACK_MS = 12 * 3_600_000;

// FLIGHT 하나의 지시서. 지시서 = 그 FLIGHT를 언급한 받은 메시지 중
//   READBACK이 있으면 그 READBACK 직전의 것, 없으면 착수 12시간 전 이후의 첫 것(그것도 없으면 마지막 것).
// READBACK = 첫 언급 뒤 보낸 READBACK 중 그 FLIGHT key나 받은 D-xxxx를 담은 첫 것. 못 찾으면 null(모름)
export function briefFactsOf(events: TalkEvent[], flight: string, openedAt: string, departedAt: string): BriefFacts | null {
  const open = Date.parse(openedAt);
  const ins = events.filter((e) => e.dir === "in" && e.keys.includes(flight) && Date.parse(e.t) <= open && Date.parse(e.t) >= open - BRIEF_LOOKBACK_MS);
  if (!ins.length) return null;
  const ids = new Set(ins.flatMap((e) => e.ids));
  const rb = events.find((e) => e.dir === "out" && e.readback && e.t >= ins[0].t && Date.parse(e.t) <= open && (e.keys.includes(flight) || e.ids.some((id) => ids.has(id))));
  const dep = Date.parse(departedAt) - NO_READBACK_SLACK_MS;
  const brief = rb ? ins.filter((e) => e.t <= rb.t).at(-1)! : (ins.find((e) => Date.parse(e.t) >= dep) ?? ins.at(-1)!);
  const from = (rb ?? brief).t;
  const toBriefer = (to: string | undefined) => Boolean(to && ((brief.from && to === brief.from) || (brief.fromName && to === brief.fromName)));
  const questions = events.filter(
    (e) => e.t > from && Date.parse(e.t) < open && (e.dir === "ask" || (e.dir === "out" && !e.readback && !e.report && toBriefer(e.to))),
  ).length;
  return { kind: brief.brief === "DIRECT" ? "DIRECT" : "VECTORS", at: brief.t, by: brief.fromName ?? null, readbackAt: rb?.t ?? null, questions };
}

// ── GitHub 쪽: P0–P2 지적, PR 뒤 수정 커밋 ──

export interface Findings {
  p0: number;
  p1: number;
  p2: number;
}
// Codex 인라인 지적(스레드 첫 댓글이 Codex, 배지가 없으면 P2) + 착륙 리뷰(head마다 마지막 리뷰의 P0–P2)
export function findingsOf(threads: Pick<GhThread, "comments">[], reviews: LandingReview[], repo: string, number: number): Findings {
  const out: Findings = { p0: 0, p1: 0, p2: 0 };
  for (const t of threads) {
    const first = t.comments[0];
    if (!first || !isCodexBot(first.author)) continue;
    const sev = findingSeverityOf(first.body) ?? 2;
    if (sev <= 2) out[`p${sev}` as keyof Findings]++;
  }
  const byHead = new Map<string, LandingReview>();
  for (const r of reviews) if (r.repo === repo && r.number === number) byHead.set(r.head, r);
  for (const r of byHead.values()) {
    out.p0 += r.p0;
    out.p1 += r.p1;
    out.p2 += r.p2;
  }
  return out;
}

export interface GhCommit {
  authoredDate: string;
  messageHeadline: string;
}
// PR을 연 뒤 새로 쓴 커밋 수(병합 커밋 제외). rebase해도 authoredDate는 그대로라 다시 세지 않는다
export function reworkOf(commits: GhCommit[], openedAt: string): number {
  const open = Date.parse(openedAt);
  return commits.filter((c) => Date.parse(c.authoredDate) > open && !/^Merge\b/.test(c.messageHeadline)).length;
}

// ── VECTORS 대 DIRECT 비교 ──

export interface Measured {
  brief?: BriefFacts | null; // null: 지시서를 찾지 못함(AD HOC 포함). 없으면 아직 안 잼
  findings?: Findings;
  rework?: number;
}
export interface BriefRow {
  key: string;
  flight: string | null;
  aircraft: string | null;
  arrivedAt: string;
  kind: BriefKind;
  by: string | null;
  questions: number;
  readbackToPrMin: number;
  findings: number | null; // P0+P1+P2
  rework: number | null;
}
export interface BriefStats {
  flights: number;
  questionsPerFlight: number | null;
  oneShot: number | null; // 질문 없이 PR까지 간 비율
  readbackToPrMedianMin: number | null;
  findingsPerFlight: number | null; // P0–P2
  findingsMeasured: number;
  reworkPerFlight: number | null;
  reworkMeasured: number;
}
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

export function briefRowOf(e: { key: string; flight: string | null; aircraft: string | null; arrivedAt: string; landingWaitMin: number; measured?: Measured }): BriefRow | null {
  const b = e.measured?.brief;
  if (!b) return null;
  const opened = Date.parse(e.arrivedAt) - e.landingWaitMin * 60_000;
  const f = e.measured?.findings;
  return {
    key: e.key,
    flight: e.flight,
    aircraft: e.aircraft,
    arrivedAt: e.arrivedAt,
    kind: b.kind,
    by: b.by,
    questions: b.questions,
    readbackToPrMin: Math.max(0, Math.round((opened - Date.parse(b.readbackAt ?? b.at)) / 60_000)),
    findings: f ? f.p0 + f.p1 + f.p2 : null,
    rework: e.measured?.rework ?? null,
  };
}

export function briefStatsOf(rows: BriefRow[]): BriefStats {
  const f = rows.flatMap((r) => (r.findings === null ? [] : [r.findings]));
  const w = rows.flatMap((r) => (r.rework === null ? [] : [r.rework]));
  return {
    flights: rows.length,
    questionsPerFlight: mean(rows.map((r) => r.questions)),
    oneShot: rows.length ? Math.round((rows.filter((r) => r.questions === 0).length / rows.length) * 100) / 100 : null,
    readbackToPrMedianMin: median(rows.map((r) => r.readbackToPrMin)),
    findingsPerFlight: mean(f),
    findingsMeasured: f.length,
    reworkPerFlight: mean(w),
    reworkMeasured: w.length,
  };
}

// 기간 안에 도착한 FLIGHT를 지시서 종류별로 나눈다. unmeasured: 아직 재지 않았거나 지시서를 못 찾은 수
export function compareBriefs(
  entries: Parameters<typeof briefRowOf>[0][],
  now: number,
  days: number,
): { rows: BriefRow[]; stats: Record<BriefKind, BriefStats>; unmeasured: number } {
  const since = now - days * 86_400_000;
  const inWindow = entries.filter((e) => Date.parse(e.arrivedAt) >= since && Date.parse(e.arrivedAt) <= now);
  const rows = inWindow.map(briefRowOf).filter((r) => r !== null).sort((a, b) => b.arrivedAt.localeCompare(a.arrivedAt));
  return {
    rows,
    stats: { VECTORS: briefStatsOf(rows.filter((r) => r.kind === "VECTORS")), DIRECT: briefStatsOf(rows.filter((r) => r.kind === "DIRECT")) },
    unmeasured: inWindow.length - rows.length,
  };
}

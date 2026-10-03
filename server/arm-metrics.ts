import { type GhCommit, reworkOf } from "./briefs.ts";
import { isCodexBot } from "./codex-bot.ts";
import { dedupeFuel, type FuelRecord, type Kinds, parseFuelLines, tokenSum, zero } from "./fuel.ts";
import type { LogEntry } from "./logbook.ts";

// 벤치마크 B4(ATC-465, docs/research/atc-vs-solo.md 4절): 두 팔(solo·atc)에서 같은 칸을 가진 이슈별 기록.
// 순수 함수만 둔다(읽기는 arm-metrics-run.ts). 상태 폴더를 쓰지 않고 GitHub는 읽기만 한다. 본문(프롬프트·답)은 읽어도 남기지 않는다.

export type Arm = "solo" | "atc";
const MIN = 60_000;
const ms = (t: string) => Date.parse(t);
const minutesBetween = (a: string, b: string) => Math.round(((ms(b) - ms(a)) / MIN) * 10) / 10;
const inRange = (t: string, from: string, to: string) => ms(t) >= ms(from) && ms(t) <= ms(to);

export interface Window {
  start: string;
  end: string;
}

// 토큰: measured가 false면 숫자를 지어내지 않고 이유만 적는다(solo 팔의 대화 기록에 usage가 없을 때)
export interface Tokens {
  measured: boolean;
  reason: string | null;
  captain: Kinds | null;
  crew: Kinds | null; // 서브에이전트
  total: number | null; // CAPTAIN + CREW (control 몫은 따로)
  requests: number;
}

export interface Interruptions {
  count: number | null; // null: 모름(기록이 없다)
  parts: Record<string, number | null>; // 종류별. null은 그 종류를 못 쟀다
}

export interface ControlShare {
  tokens: number; // 창 안의 OCC·MCC 토큰 전체
  issues: number; // 나눈 이슈 수
  perIssue: number; // 고르게 나눈 몫
  byRole: Record<string, number>;
}

export interface ArmRecord {
  issue: string;
  arm: Arm;
  start: string; // 실험 창이 이 이슈에 대해 시작한 시각(LOGBOOK blockMin이 아니다)
  mergeReady: string | null;
  mergeReadyBasis: string; // 무엇을 merge-ready로 봤나
  elapsedMin: number | null;
  reworkRounds: number | null;
  interruptions: Interruptions;
  tokens: Tokens;
  control: ControlShare | null; // atc 팔만. solo에는 OCC·MCC가 없다
  codexReviews: number | null;
  codexTokens: "unmeasured"; // FUEL은 Claude 대화 기록만 읽는다
  models: string[];
  versions: string[];
  notes: string[];
}

const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))].sort();

// ── 토큰: 기존 FUEL 파서(parseFuelLines·dedupeFuel)로만 센다 ──
export function tokensOf(records: Iterable<FuelRecord>, none: string): Tokens {
  const captain = zero();
  const crew = zero();
  let requests = 0;
  for (const r of records) {
    const to = r.sidechain ? crew : captain;
    to.input += r.input;
    to.cacheWrite5m += r.cacheWrite5m;
    to.cacheWrite1h += r.cacheWrite1h;
    to.cacheRead += r.cacheRead;
    to.output += r.output;
    requests++;
  }
  if (!requests) return { measured: false, reason: none, captain: null, crew: null, total: null, requests: 0 };
  return { measured: true, reason: null, captain, crew, total: tokenSum(captain) + tokenSum(crew), requests };
}

// ── solo: 내보낸 대화 기록 ──
export interface TranscriptFacts {
  records: FuelRecord[];
  humanTurns: string[]; // SUPERVISOR 메시지 시각(첫 줄은 작업 지시서)
  rejections: string[]; // 승인을 거절한 도구 호출 시각
  unknown: number;
}

const REJECTED_RE = /doesn't want to proceed|was rejected|permission to use .* has been denied|user rejected/i;
const WRAPPED = /^\s*<(local-command|command-|system-reminder|task-notification|bash-)/;

// 사람이 친 줄만: 문자열이거나 text 블록뿐인 user 줄(sidechain·메타·도구 결과·명령 출력 아님). 시각만 남기고 본문은 버린다
export function transcriptFacts(text: string): TranscriptFacts {
  const parsed = parseFuelLines(text);
  const humanTurns: string[] = [];
  const rejections: string[] = [];
  for (const line of text.split("\n")) {
    if (!line.includes('"type":"user"') && !line.includes('"type": "user"')) continue;
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d?.type !== "user" || d.isSidechain === true || d.isMeta === true || typeof d.timestamp !== "string" || !Number.isFinite(ms(d.timestamp))) continue;
    const c = d.message?.content;
    if (Array.isArray(c) && c.some((b: any) => b?.type === "tool_result")) {
      for (const b of c) {
        if (b?.type !== "tool_result" || b.is_error !== true) continue;
        const body = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((x: any) => (typeof x?.text === "string" ? x.text : "")).join(" ") : "";
        if (REJECTED_RE.test(body)) rejections.push(d.timestamp);
      }
      continue;
    }
    const body = typeof c === "string" ? c : Array.isArray(c) && c.every((b: any) => b?.type === "text" || b?.type === "image") ? c.map((b: any) => (b.type === "text" ? b.text : "")).join(" ") : null;
    if (body === null || !body.trim() || WRAPPED.test(body)) continue;
    humanTurns.push(d.timestamp);
  }
  return {
    records: [...dedupeFuel(parsed.records).values()],
    humanTurns: humanTurns.sort(),
    rejections: rejections.sort(),
    unknown: parsed.unknown,
  };
}

// 읽기 전용 gh 입력(gh pr view --json 등에서 가져온 것). 시험은 fixture를 넣는다
export interface GhRun {
  name: string;
  conclusion: string | null; // SUCCESS …
  completedAt: string | null;
}
export interface GhPr {
  number: number;
  createdAt: string; // PR을 연 시각(solo는 Draft)
  isDraft?: boolean;
  commits: GhCommit[];
  checks: GhRun[]; // 마지막 head의 check run
  reviews?: { author: string | null; state: string }[];
  mergedAt?: string | null;
}

export const CHECK_NAME = "check";

// CI `check`가 마지막으로 초록이 된 시각: 이름이 check인 run 중 가장 늦게 끝난 성공. 마지막 run이 실패면 null
export function checkGreenAt(checks: readonly GhRun[]): string | null {
  const mine = checks.filter((c) => c.name === CHECK_NAME && c.completedAt).sort((a, b) => ms(a.completedAt!) - ms(b.completedAt!));
  const last = mine.at(-1);
  return last && last.conclusion?.toUpperCase() === "SUCCESS" ? last.completedAt : null;
}

export const codexReviewsOf = (reviews: GhPr["reviews"]): number => (reviews ?? []).filter((r) => isCodexBot(r.author) && r.state === "COMMENTED").length;

export interface SoloInput {
  issue: string;
  start: string; // 실험 창의 시작
  transcript: string | null; // 내보낸 대화 기록 텍스트(없으면 토큰·끼어듦은 모름)
  pr: GhPr | null;
  reviewPassedAt?: string | null; // 블라인드 리뷰 통과 시각(손으로 적는다). 있으면 merge-ready = max(CI green, 이것)
}

const UNMEASURED_SOLO = "no message.usage in the transcript";

export function soloRecord(i: SoloInput): ArmRecord {
  const notes: string[] = [];
  const facts = i.transcript === null ? null : transcriptFacts(i.transcript);
  const tokens = facts ? tokensOf(facts.records, UNMEASURED_SOLO) : tokensOf([], "no transcript given");
  if (facts && !tokens.measured) notes.push("transcript has no usable message.usage: tokens unmeasured (protocol falls back to a local session)");
  const humans = facts ? Math.max(0, facts.humanTurns.length - 1) : null; // 첫 메시지는 작업 지시서
  const rejected = facts ? facts.rejections.length : null;
  // 승인은 대화 기록에 표지가 없다: 거절만 센다. 승인 횟수는 모른다
  const interruptions: Interruptions = {
    count: humans === null ? null : humans + (rejected ?? 0),
    parts: { supervisorMessages: humans, permissionRejections: rejected, permissionApprovals: null },
  };
  if (facts) notes.push("permission approvals leave no mark in the transcript: counted rejections only");
  const green = i.pr ? checkGreenAt(i.pr.checks) : null;
  let mergeReady: string | null = null;
  let basis = "none";
  if (green) {
    mergeReady = green;
    basis = "CI check green";
    if (i.reviewPassedAt && ms(i.reviewPassedAt) > ms(green)) {
      mergeReady = i.reviewPassedAt;
      basis = "blind review passed (after CI green)";
    } else if (i.reviewPassedAt) basis = "CI check green (review passed earlier)";
    else notes.push("no reviewPassedAt given: merge-ready is CI green only");
  }
  return {
    issue: i.issue,
    arm: "solo",
    start: i.start,
    mergeReady,
    mergeReadyBasis: basis,
    elapsedMin: mergeReady ? minutesBetween(i.start, mergeReady) : null,
    reworkRounds: i.pr ? reworkOf(i.pr.commits, i.pr.createdAt) : null,
    interruptions,
    tokens,
    control: null,
    codexReviews: i.pr ? codexReviewsOf(i.pr.reviews) : null,
    codexTokens: "unmeasured",
    models: uniq(facts?.records.map((r) => r.model) ?? []),
    versions: uniq(facts?.records.map((r) => r.version) ?? []),
    notes,
  };
}

// ── atc: 상태 폴더의 기록 ──
// 읽을 줄은 호출한 쪽이 상태 폴더에서 읽어 넘긴다(여기는 파일을 모른다)
export interface AtcState {
  logbook: LogEntry[]; // foldLogbook 결과
  leaks: { ev: string; t: string; flight: string | null; id: string }[]; // leaks.jsonl
  relays: { op: string; at: string; flight: string | null; id?: string }[]; // relays.jsonl
  proposals: { op: string; id: string; at: string; via?: string; flight?: string }[]; // proposals.jsonl(create로 FLIGHT를 알고 approve로 승인)
  clearances: { op: string; at: string; id: string; flight?: string | null; type?: string }[]; // clearances.jsonl
}

export interface ControlTranscript {
  role: string; // OCC · MCC
  text: string;
}

export interface AtcInput {
  issue: string;
  start: string; // 이 이슈의 실험 창 시작
  window: Window;
  batchIssues: number; // 같은 묶음 이슈 수(control 몫을 나눈다)
  state: AtcState;
  control: ControlTranscript[];
  mergeReadyAt?: string | null; // 손으로 정하면 그것을 쓴다
}

// 창 안 control 요청 토큰을 역할별로 센다(요청 시각으로 가른다)
export function controlShare(control: readonly ControlTranscript[], w: Window, issues: number): ControlShare {
  const byRole: Record<string, number> = {};
  let tokens = 0;
  for (const c of control) {
    const recs = [...dedupeFuel(parseFuelLines(c.text).records).values()].filter((r) => inRange(r.t, w.start, w.end));
    const n = recs.reduce((s, r) => s + tokenSum(r), 0);
    byRole[c.role] = (byRole[c.role] ?? 0) + n;
    tokens += n;
  }
  return { tokens, issues, perIssue: issues > 0 ? Math.round(tokens / issues) : 0, byRole };
}

export function atcRecord(i: AtcInput): ArmRecord {
  const notes: string[] = [];
  const e = i.state.logbook.find((x) => x.flight === i.issue && x.pr && !x.reverted) ?? i.state.logbook.find((x) => x.flight === i.issue) ?? null;
  const f = e?.fuel;
  const tokens: Tokens = f
    ? { measured: true, reason: null, captain: { input: f.captain.input, cacheWrite5m: f.captain.cacheWrite5m, cacheWrite1h: f.captain.cacheWrite1h, cacheRead: f.captain.cacheRead, output: f.captain.output }, crew: { input: f.crew.input, cacheWrite5m: f.crew.cacheWrite5m, cacheWrite1h: f.crew.cacheWrite1h, cacheRead: f.crew.cacheRead, output: f.crew.output }, total: tokenSum(f.captain) + tokenSum(f.crew), requests: f.captain.requests + f.crew.requests }
    : { measured: false, reason: e ? "LOGBOOK entry has no fuel" : "no LOGBOOK entry for this issue", captain: null, crew: null, total: null, requests: 0 };
  if (!tokens.measured) notes.push(tokens.reason!);

  const w = i.window;
  const mine = (flight: string | null | undefined) => flight === i.issue;
  const leakOpens = i.state.leaks.filter((l) => l.ev === "open" && mine(l.flight) && inRange(l.t, w.start, w.end)).length;
  const relays = i.state.relays.filter((r) => r.op === "create" && mine(r.flight) && inRange(r.at, w.start, w.end)).length;
  const ids = new Set(i.state.proposals.filter((p) => p.op === "create" && mine(p.flight)).map((p) => p.id));
  const approvals = i.state.proposals.filter((p) => p.op === "approve" && ids.has(p.id) && p.via !== "auto" && inRange(p.at, w.start, w.end)).length;
  const clearanceIds = i.state.clearances.filter((c) => c.op === "issue" && mine(c.flight) && inRange(c.at, w.start, w.end)).length;
  const interruptions: Interruptions = {
    count: leakOpens + relays + approvals,
    parts: { leakOpens, relays, approvals, clearancesIssued: clearanceIds }, // clearancesIssued는 TOWER→팀이라 합에 넣지 않는다
  };

  let mergeReady: string | null = i.mergeReadyAt ?? null;
  let basis = i.mergeReadyAt ? "given" : "none";
  if (!mergeReady && e?.pr && e.landingWaitMin != null) {
    // autoland는 CI와 MCC가 모두 통과하면 머지한다: 머지 시각 = PR을 연 시각 + 착륙 대기(에스컬레이션 시간 포함)
    mergeReady = new Date(ms(e.arrivedAt) + e.landingWaitMin * MIN).toISOString();
    basis = "merge time (arrivedAt + landingWaitMin; autoland merges when CI and MCC pass)";
  }
  if (!mergeReady) notes.push("no merge-ready time: PR not landed or no LOGBOOK entry");

  const control = controlShare(i.control, w, i.batchIssues);
  if (!i.control.length) notes.push("no control transcripts given: control tokens are 0");
  return {
    issue: i.issue,
    arm: "atc",
    start: i.start,
    mergeReady,
    mergeReadyBasis: basis,
    elapsedMin: mergeReady ? minutesBetween(i.start, mergeReady) : null,
    reworkRounds: e?.measured?.rework ?? null,
    interruptions,
    tokens,
    control,
    codexReviews: e ? e.codexFindings : null,
    codexTokens: "unmeasured",
    models: uniq(f ? Object.keys(f.models) : []),
    versions: [], // LOGBOOK는 CLI 버전을 적지 않는다
    notes,
  };
}

// 두 팔 비교용: 이슈 하나가 쓴 Claude 토큰(atc는 control 몫 포함). 모르면 null
export const claudeTokensOf = (r: ArmRecord): number | null => (r.tokens.total === null ? null : r.tokens.total + (r.control?.perIssue ?? 0));

export function formatRecords(rs: readonly ArmRecord[]): string {
  const rows = rs.map((r) => {
    const tok = claudeTokensOf(r);
    return `${r.issue} ${r.arm} elapsed ${r.elapsedMin ?? "?"} min · rework ${r.reworkRounds ?? "?"} · interruptions ${r.interruptions.count ?? "?"} · tokens ${tok ?? "unmeasured"} · codex reviews ${r.codexReviews ?? "?"} · codex tokens unmeasured`;
  });
  return rows.join("\n") + "\n";
}

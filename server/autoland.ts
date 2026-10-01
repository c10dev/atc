import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MainStatus } from "./atfm.ts";
import { config } from "./config.ts";
import { humanCheckExclusionOf, humanCheckStatusOf, uiChangeOf } from "./human-check.ts";
import { externalGateOf, migrationPathOf, pullKey } from "./landing.ts";
import type { LandingBlockCode, PullRequest } from "./model.ts";

// AUTOLAND(ATC-34). vocado main 규칙이 strict라 머지가 있을 때마다 다른 PR이 behind가 되고, SUPERVISOR가 PR마다
// Update branch → CI 대기 → 머지를 손으로 되풀이했다. ATC-31로 main 병합만 한 head가 리뷰를 이어받으니 그 대기는 기계 일이다.
// - update: CLEARED인데 behind만 남은 PR을 LANDING SEQUENCE 순서로 AIRPORT마다 하나씩 GitHub update-branch(expected_head_sha)로 갱신
// - merge: 위임된 PR(아래 제외 목록에 안 걸리는 CLEARED PR)은 정확한 head로 머지까지. 나머지는 update처럼
// - main의 post-merge Application Check가 빨가면 GROUND STOP: SUPERVISOR가 풀 때까지 두 모드 모두 멈춘다
// 스위치는 SUPERVISOR만 바꾼다(설정 창·API, 이 화면 Origin만). 관제 세션 CLI(atcctl)에는 명령이 없다.
// 이 파일은 설정·상태 읽기와 순수 계산, 실행(GitHub 쓰기)은 autoland-run.ts.

export type AutolandMode = "off" | "update" | "merge";
export const AUTOLAND_MODES: readonly AutolandMode[] = ["off", "update", "merge"];
export type MergeMethod = "squash" | "merge" | "rebase";
// reviewedSecurity(ATC-328): off(기본)면 보안 게이트 PR은 SUPERVISOR 몫(오늘과 같음). delegate면 이 head에 머지 리뷰 pass가 있는 PR의
// rating:SEC·보안 경로·보안 키워드 제외를 풀어 AUTOLAND가 머지한다. 비밀·키·마이그레이션·SQL 경로, Risk 라벨, FLIGHT 없음은 그대로 막는다
export type ReviewedSecurity = "off" | "delegate";
export const REVIEWED_SECURITY: readonly ReviewedSecurity[] = ["off", "delegate"];

export interface AutolandHold {
  repo: string; // AIRPORT 본 체크아웃 경로(PullRequest.repo)
  number: number;
  at: string;
}

// ~/.local/state/atc/autoland.json (원자적으로 바꿔 쓴다)
export interface AutolandConfig {
  mode: AutolandMode;
  airports: string[]; // AUTOLAND가 맡는 AIRPORT 코드. atc 저장소 자신의 착륙은 범위 밖이라 기본은 VCDO만
  mergeMethod: MergeMethod; // merge 모드의 머지 방식(vocado는 squash)
  applicationCheck: string; // GROUND STOP을 거는 main의 post-merge 체크 이름
  holds: AutolandHold[]; // SUPERVISOR가 HOLD한 PR: merge가 머지하지 않는다
  reviewedSecurity: ReviewedSecurity; // 머지 리뷰 pass가 보안 게이트 PR의 위임 근거가 되나(ATC-328). 설정 창에서만 바꾼다
}

export const DEFAULT_AUTOLAND: AutolandConfig = {
  mode: "off",
  airports: ["VCDO"],
  mergeMethod: "squash",
  applicationCheck: "Application Check",
  holds: [],
  reviewedSecurity: "off",
};

// 갱신하고 CI를 기다리는 PR. AIRPORT마다 하나
export interface InFlight {
  airport: string;
  repo: string;
  slug: string;
  number: number;
  fromHead: string; // 갱신 전 head(expected_head_sha)
  at: string;
}

// AUTOLAND GROUND STOP. SUPERVISOR가 풀 때까지 남는다(main이 다시 초록이 돼도)
export interface AutolandStop {
  airport: string;
  repo: string;
  sha: string; // 빨간 main head
  failing: string[];
  at: string;
}

// ~/.local/state/atc/autoland-state.json
export interface AutolandState {
  inflight: InFlight[];
  groundStops: AutolandStop[];
  clearedShas: string[]; // SUPERVISOR가 GROUND STOP을 푼 main SHA(같은 SHA로 다시 걸지 않는다)
  skip: string[]; // 실패한 시도 "repo#n@head": 같은 head로 다시 하지 않는다(head가 바뀌면 키가 바뀐다)
  merged: string[]; // 머지한 "repo#n@head"(같은 PR을 두 번 머지하지 않게)
  reviewRequests: ReviewRequest[]; // 갱신한 head에 리뷰가 이어지지 않아 atc가 낸 재리뷰 요청(ATC-38). head마다 하나
}

// 재리뷰 요청(ATC-38). via: codex(PR 댓글 `@codex review`) → 30분 무응답·한도면 deepseek(REVIEW 대기열. REVIEW가 Claude Sonnet이 된 뒤에도
// autoland 기록과 맞추려고 이름은 그대로 둔다). 외부 리뷰에서 빠지는 PR(ATC-27·30)은 REVIEW로 보내지 않고 supervisor(SUPERVISOR 리뷰 필요)
export type ReviewVia = "codex" | "deepseek" | "supervisor";
export interface ReviewRequest {
  repo: string;
  slug: string;
  number: number;
  head: string;
  at: string; // 요청한 시각
  via: ReviewVia;
  escalatedAt?: string; // codex → deepseek(REVIEW)·supervisor로 넘긴 시각
  reason?: string; // 한도, 30분 무응답, 외부 리뷰 제외 사유
}

export const EMPTY_STATE: AutolandState = { inflight: [], groundStops: [], clearedShas: [], skip: [], merged: [], reviewRequests: [] };

const CONFIG_FILE = () => join(config.stateDir, "autoland.json");
const STATE_FILE = () => join(config.stateDir, "autoland-state.json");
export const RECORD_FILE = () => join(config.stateDir, "autoland.jsonl");

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

// 모르는 값은 기본값(off)으로 — 깨진 파일이 무엇도 켜지 않게
export function parseAutoland(raw: unknown): AutolandConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_AUTOLAND;
  const airports = Array.isArray(r.airports) ? r.airports.filter((a): a is string => typeof a === "string").map((a) => a.toUpperCase()) : d.airports;
  const holds = (Array.isArray(r.holds) ? r.holds : [])
    .filter((h): h is AutolandHold => Boolean(h) && typeof h.repo === "string" && Number.isInteger(h.number) && typeof h.at === "string")
    .map((h) => ({ repo: h.repo, number: h.number, at: h.at }));
  return {
    mode: pick(r.mode, AUTOLAND_MODES, d.mode),
    airports,
    mergeMethod: pick(r.mergeMethod, ["squash", "merge", "rebase"] as const, d.mergeMethod),
    applicationCheck: typeof r.applicationCheck === "string" && r.applicationCheck.trim() ? r.applicationCheck.trim() : d.applicationCheck,
    holds,
    reviewedSecurity: pick(r.reviewedSecurity, REVIEWED_SECURITY, d.reviewedSecurity),
  };
}

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};
const writeJson = (file: string, value: unknown) => {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  renameSync(tmp, file);
};

export const loadAutoland = (file = CONFIG_FILE()) => parseAutoland(readJson(file));
// 사용자가 적어 둔 다른 키는 그대로 두고 바꾼 것만 쓴다
export function saveAutoland(next: AutolandConfig, file = CONFIG_FILE()) {
  const user = readJson(file);
  writeJson(file, { ...(user && typeof user === "object" ? user : {}), ...next });
}

const KEEP = 500;
export function loadAutolandState(file = STATE_FILE()): AutolandState {
  const r = (readJson(file) ?? {}) as Partial<AutolandState>;
  const arr = <T>(v: T[] | undefined) => (Array.isArray(v) ? v : []);
  return { inflight: arr(r.inflight), groundStops: arr(r.groundStops), clearedShas: arr(r.clearedShas), skip: arr(r.skip), merged: arr(r.merged), reviewRequests: arr(r.reviewRequests) };
}
export function saveAutolandState(st: AutolandState, file = STATE_FILE()) {
  const trim = (xs: string[]) => xs.slice(-KEEP);
  writeJson(file, { ...st, clearedShas: trim(st.clearedShas), skip: trim(st.skip), merged: trim(st.merged), reviewRequests: st.reviewRequests.slice(-200) });
}

// 기록 한 줄(autoland.jsonl, 추가만). 갱신·머지·결과·GROUND STOP·스위치·HOLD를 모두 남긴다
export interface AutolandRecord {
  at: string;
  op: "update" | "merge" | "settle" | "groundstop" | "groundstop-clear" | "mode" | "reviewed-security" | "merge-review" | "hold" | "unhold" | "skip" | "review-request";
  mode: AutolandMode;
  airport?: string;
  slug?: string;
  number?: number;
  head?: string;
  result?: string; // ok | rejected | failed | cleared | blocked | closed | timeout | excluded …
  detail?: string;
  via?: ReviewVia; // review-request: 누구에게 재리뷰를 요청했나(ATC-38)
}

// ── 재리뷰 요청(ATC-38) ──
// 2026-09-28 #401: AUTOLAND가 갱신한 head(36f36a0)에 리뷰가 이어지지 않았고(#403이 #401의 파일 둘을 바꿈), Codex는 update-branch의
// merge 커밋을 리뷰하지 않았다. DeepSeek 인계는 Codex가 6시간 조용해야 해서 팀이 손으로 `@codex review`를 달았다.
export const CODEX_WAIT_MS = 30 * 60_000;
const REVIEW_CODES: LandingBlockCode[] = ["no-review", "review-stale"];
// 리뷰가 이어지지 않아 새 리뷰가 필요한 head
export const needsReview = (p: Pick<PullRequest, "blocks">) => p.blocks.some((b) => REVIEW_CODES.includes(b.code));
const codexLimited = (p: Pick<PullRequest, "codexUnavailable">) => p.codexUnavailable?.why === "limit";
// Codex를 쓸 수 없을 때 가는 곳: 외부 리뷰에서 빠지면 SUPERVISOR, 아니면 REVIEW(via "deepseek")
const fallbackOf = (p: Pick<PullRequest, "externalExclusion">): { via: ReviewVia; reason?: string } =>
  p.externalExclusion === undefined ? { via: "supervisor", reason: "외부 리뷰 제외 여부 모름" } : p.externalExclusion ? { via: "supervisor", reason: `외부 리뷰 제외(${p.externalExclusion})` } : { via: "deepseek" };

// 갱신이 끝난(settle) PR에 재리뷰를 요청할까. 리뷰가 이어졌거나(막힘에 no-review·review-stale이 없음) 이 head에 이미 요청했으면 null
export function reviewRequestOf(p: PullRequest, slug: string, requests: readonly ReviewRequest[], now: string): ReviewRequest | null {
  if (!needsReview(p)) return null;
  if (requests.some((r) => r.repo === p.repo && r.number === p.number && r.head === p.head)) return null;
  const base = { repo: p.repo, slug, number: p.number, head: p.head, at: now };
  if (!codexLimited(p)) return { ...base, via: "codex" };
  const f = fallbackOf(p);
  return { ...base, via: f.via, reason: f.reason ? `Codex 한도 · ${f.reason}` : "Codex 한도" };
}

// codex로 요청한 뒤: 한도가 오거나 30분 안에 답이 없으면 REVIEW(제외 PR은 SUPERVISOR)로 넘긴다. 바꿀 것이 없으면 null.
// head가 바뀌었거나 PR이 닫혔거나 이미 리뷰가 붙었으면(needsReview 아님) 넘기지 않는다
export function escalateOf(r: ReviewRequest, p: PullRequest | undefined, now: number): ReviewRequest | null {
  if (r.via !== "codex" || !p || p.head !== r.head || !needsReview(p)) return null;
  const limited = codexLimited(p);
  if (!limited && now - Date.parse(r.at) < CODEX_WAIT_MS) return null;
  const f = fallbackOf(p);
  const why = limited ? "Codex 한도" : "Codex 30분 무응답";
  return { ...r, via: f.via, escalatedAt: new Date(now).toISOString(), reason: f.reason ? `${why} · ${f.reason}` : why };
}

// buildPulls의 fastTrack: AUTOLAND가 Codex 대신으로 넘긴 head면 그 시각. supervisor도 넘긴다 — 외부 리뷰 제외는 buildPulls가
// 지금 스위치로 다시 보고(ATC-27·30 그대로) 제외면 대기열에 넣지 않는다. 스위치가 deepseek으로 바뀌면 곧바로 대기열로 간다
export const fastTrackOf = (requests: readonly ReviewRequest[]) => (repo: string, number: number, head: string) => {
  const r = requests.find((x) => x.repo === repo && x.number === number && x.head === head && x.via !== "codex");
  return r ? (r.escalatedAt ?? r.at) : null;
};

// ── 순수 계산 ──

export const headKey = (p: Pick<PullRequest, "repo" | "number" | "head">) => `${pullKey(p)}@${p.head}`;
export const isHeld = (cfg: Pick<AutolandConfig, "holds">, p: Pick<PullRequest, "repo" | "number">) => cfg.holds.some((h) => h.repo === p.repo && h.number === p.number);

// 손대지 않는 PR: Draft, 쌓인 PR, 충돌, LOS
const NEVER: LandingBlockCode[] = ["draft", "stacked", "dirty", "los"];
export const neverTouched = (p: Pick<PullRequest, "draft" | "blocks">): LandingBlockCode | null =>
  p.draft ? "draft" : (NEVER.find((c) => p.blocks.some((b) => b.code === c)) ?? null);
// CLEARED인데 behind만 남은 PR
export const behindOnly = (p: Pick<PullRequest, "draft" | "blocks">) => !p.draft && p.blocks.length === 1 && p.blocks[0].code === "behind";

export interface MergeExclusionInput {
  held: boolean;
  flight: string | null;
  ticketLabels: readonly string[];
  prLabels: readonly string[];
  files: readonly string[] | null; // 못 읽었으면 null → 제외(모름을 통과로 보지 않는다)
  title: string;
  body: string | null | undefined;
  flightTitle?: string | null;
  head: string; // HUMAN CHECK는 이 head에 묶인다(ATC-37)
  carryFrom?: readonly string[]; // main 병합만 한 head의 이전 커밋(ATC-31). 거기 기록한 HUMAN CHECK를 잇는다
  reviewedSecurity?: ReviewedSecurity; // 없으면 off
  mergeReviewPass?: boolean; // 이 head(main 병합만 했으면 이전 커밋)에 atc에 기록된 머지 리뷰 pass가 있나(ATC-328)
}
const RISK_ANY = /^risk\b/i;
// merge 모드에서 AUTOLAND가 머지하지 않고 SUPERVISOR에게 남기는 까닭. null이면 위임된 PR
export function mergeExclusionOf(x: MergeExclusionInput): string | null {
  if (x.held) return "SUPERVISOR HOLD";
  if (!x.flight) return "FLIGHT 없음";
  // 위임(ATC-328): 스위치가 delegate이고 이 head에 머지 리뷰 pass가 있을 때만 rating:SEC·보안 게이트를 푼다. 마이그레이션·SQL 경로는 그래도 막는다
  const delegated = x.reviewedSecurity === "delegate" && x.mergeReviewPass === true;
  if (!delegated && x.ticketLabels.some((l) => l.toLowerCase() === "rating:sec")) return "rating:SEC";
  const risk = [...x.ticketLabels, ...x.prLabels].find((l) => RISK_ANY.test(l.trim()));
  if (risk) return risk.trim();
  if (!x.files) return "바뀐 파일을 아직 못 읽음";
  // ATC-27 보안 게이트: 비밀·키 경로, migration·SQL·auth·admission·RLS 등 보안 경로, 보안 키워드
  const gate = externalGateOf({ flight: x.flight, ticketLabels: x.ticketLabels, prLabels: x.prLabels, files: x.files, texts: [x.title, x.body, x.flightTitle] });
  if (gate.hard) return gate.hard;
  if (delegated) {
    const mig = migrationPathOf(x.files);
    if (mig) return `보안 게이트: 마이그레이션·SQL 경로 ${mig}(위임 안 함)`;
  } else if (gate.security) return `보안 게이트: ${gate.security}`;
  // HUMAN CHECK(ATC-37): `## UI change` class가 CHOICE·ACCOUNT·DEVICE면 이 head에 done일 때까지. 블록이 없으면 모름 → 머지하지 않는다
  const ui = uiChangeOf(x.body);
  return humanCheckExclusionOf(ui, humanCheckStatusOf(ui, x.head, x.carryFrom));
}

// GROUND STOP 걸기: 맡은 AIRPORT의 main head에서 applicationCheck가 실패했고, SUPERVISOR가 그 SHA로 푼 적이 없으면.
// 이미 걸린 AIRPORT는 그대로 둔다(풀릴 때까지 남는다)
export function latchGroundStops(
  cfg: Pick<AutolandConfig, "applicationCheck">,
  airports: readonly { code: string; repo: string }[],
  mains: readonly MainStatus[],
  st: Pick<AutolandState, "groundStops" | "clearedShas">,
  now: string,
): AutolandStop[] {
  const out = [...st.groundStops];
  const check = cfg.applicationCheck.toLowerCase();
  for (const a of airports) {
    if (out.some((s) => s.airport === a.code)) continue;
    const m = mains.find((x) => x.repo === a.repo);
    if (!m?.sha || st.clearedShas.includes(m.sha)) continue;
    if (m.failing.some((f) => f.toLowerCase() === check)) out.push({ airport: a.code, repo: a.repo, sha: m.sha, failing: m.failing, at: now });
  }
  return out;
}

const UPDATE_STUCK_MS = 10 * 60_000; // update-branch 뒤 head가 이만큼 안 바뀌면 포기
const CI_TIMEOUT_MS = 90 * 60_000; // 갱신한 head의 CI를 이만큼 넘게 기다리면 다음으로
const WAITING: LandingBlockCode[] = ["checks-pending", "merge-unknown", "no-checks"];
// 갱신한 PR이 끝났나. null이면 아직 비행 중
export function settleOf(f: InFlight, p: PullRequest | undefined, now: number): { result: string; detail: string; head?: string } | null {
  if (!p) return { result: "closed", detail: "PR이 닫히거나 머지됨" };
  const age = now - Date.parse(f.at);
  if (p.head === f.fromHead) return age > UPDATE_STUCK_MS ? { result: "timeout", detail: "update-branch 뒤 head가 바뀌지 않음" } : null;
  if (p.blocks.some((b) => WAITING.includes(b.code))) return age > CI_TIMEOUT_MS ? { result: "timeout", detail: "CI를 오래 기다림", head: p.head } : null;
  if (p.landing === "CLEARED") return { result: "cleared", detail: "CI 통과 — CLEARED", head: p.head };
  return { result: "blocked", detail: p.blocks.map((b) => b.code).join(","), head: p.head };
}

export type AutolandAirportStatus = "off" | "groundstop" | "inflight" | "merge" | "update" | "waiting" | "idle";
export interface AirportPlan {
  airport: string;
  repo: string;
  status: AutolandAirportStatus;
  number: number | null;
  head: string | null;
  text: string;
}
export type PullTagKind = "inflight" | "update" | "merge" | "queued" | "delegated" | "supervisor" | "excluded" | "waiting" | "review";
export interface PullTag {
  kind: PullTagKind;
  text: string;
}
export interface AutolandView {
  mode: AutolandMode;
  airports: AirportPlan[];
  pulls: Record<string, PullTag>; // pullKey → 표시
  holds: string[]; // HOLD한 pullKey
  exclusions: Record<string, string | null>; // merge 모드: CLEARED PR의 제외 사유(null이면 위임됨)
}

const sha7 = (s: string) => s.slice(0, 7);
const SHORT: Record<LandingBlockCode, string> = {
  draft: "DRAFT",
  stacked: "STACKED",
  dirty: "DIRTY(충돌)",
  los: "LOS",
  "checks-pending": "CI 진행 중",
  "checks-failed": "CI 실패",
  "no-checks": "CI 없음",
  "no-review": "리뷰 없음",
  "review-stale": "리뷰 옛 커밋",
  "review-findings": "리뷰 지적",
  "changes-requested": "변경 요청",
  behind: "BEHIND",
  blocked: "BLOCKED",
  "merge-unknown": "계산 중",
};

export interface PlanInput {
  cfg: AutolandConfig;
  airports: readonly { code: string; repo: string }[]; // 열린 AIRPORT 전부(코드 ↔ 저장소)
  pulls: readonly PullRequest[]; // orderPulls 순서(CLEARED는 readyAt 순, APPROACH는 연 순서)
  st: AutolandState;
  exclusionOf: (p: PullRequest) => string | null; // merge 모드의 제외 사유(HOLD 포함)
}

// AIRPORT마다 이번에 할 일 하나와 PR마다 표시. 한 AIRPORT에서 한 번에 하나만:
// GROUND STOP → 비행 중인 갱신 → (merge) 위임된 CLEARED 머지 → HOLD 안 한 CLEARED가 머지를 기다리면 대기 → behind만 남은 첫 PR 갱신
export function planAutoland({ cfg, airports, pulls, st, exclusionOf }: PlanInput): AutolandView {
  const view: AutolandView = { mode: cfg.mode, airports: [], pulls: {}, holds: cfg.holds.map((h) => pullKey(h)), exclusions: {} };
  if (cfg.mode === "off") return view;
  const skip = new Set([...st.skip, ...st.merged]);
  for (const code of cfg.airports) {
    const a = airports.find((x) => x.code === code);
    if (!a) continue;
    const all = pulls.filter((p) => p.repo === a.repo);
    const mine = all.filter((p) => !p.draft);
    const plan = (status: AutolandAirportStatus, text: string, p?: PullRequest): AirportPlan => ({ airport: code, repo: a.repo, status, number: p?.number ?? null, head: p?.head ?? null, text });
    const tag = (p: PullRequest, kind: PullTagKind, text: string) => void (view.pulls[pullKey(p)] = { kind, text });

    // PR마다 표시(아래에서 이번 할 일로 덮어쓴다)
    const queue = mine.filter(behindOnly);
    for (const p of all) {
      const never = neverTouched(p);
      if (never) tag(p, "excluded", `AUTOLAND 제외 — ${SHORT[never]}`);
      else if (behindOnly(p)) tag(p, "queued", `AUTOLAND update 대기 ${queue.indexOf(p) + 1}번째`);
      // behind지만 다른 막힘도 있다: 그것이 풀려야 갱신 후보가 된다
      else if (p.blocks.some((b) => b.code === "behind"))
        tag(p, "waiting", `AUTOLAND 대기 — ${p.blocks.filter((b) => b.code !== "behind").map((b) => SHORT[b.code]).join(", ")} 먼저`);
      else if (p.landing === "CLEARED" && cfg.mode === "merge") {
        const why = exclusionOf(p);
        view.exclusions[pullKey(p)] = why;
        tag(p, why ? "supervisor" : "delegated", why ? `SUPERVISOR 머지 — ${why}` : "AUTOLAND merge 대상");
      } else if (p.landing === "CLEARED" && isHeld(cfg, p)) tag(p, "supervisor", "HOLD");
      // 이 head에 낸 재리뷰 요청(ATC-38). 리뷰가 붙으면(needsReview 아님) 지운다
      const rr = st.reviewRequests.find((r) => r.repo === p.repo && r.number === p.number && r.head === p.head);
      if (rr && needsReview(p)) {
        // Codex 대신이면 지금 외부 리뷰 제외(스위치 반영)로 REVIEW·SUPERVISOR를 가른다
        const excluded = rr.via !== "codex" && p.externalExclusion !== null;
        if (excluded) tag(p, "supervisor", `AUTOLAND: SUPERVISOR 리뷰 필요 — 외부 리뷰 제외(${p.externalExclusion ?? "모름"})`);
        else tag(p, "review", `AUTOLAND: review requested (${rr.via === "codex" ? "codex" : "deepseek"})`);
      }
    }

    const stop = st.groundStops.find((s) => s.airport === code);
    if (stop) {
      view.airports.push(plan("groundstop", `AUTOLAND: GROUND STOP — main ${stop.failing.join(", ")} 실패(${sha7(stop.sha)}) · SUPERVISOR가 풀 때까지 멈춤`));
      continue;
    }
    const f = st.inflight.find((x) => x.airport === code);
    if (f) {
      const p = mine.find((x) => x.number === f.number);
      if (p) tag(p, "inflight", "AUTOLAND: updated — CI 대기");
      view.airports.push({ ...plan("inflight", `AUTOLAND: updating #${f.number} — CI 대기`), number: f.number, head: f.fromHead });
      continue;
    }
    const cleared = mine.filter((p) => p.landing === "CLEARED");
    if (cfg.mode === "merge") {
      const m = cleared.find((p) => !view.exclusions[pullKey(p)] && !skip.has(headKey(p)));
      if (m) {
        tag(m, "merge", "AUTOLAND: merging");
        view.airports.push(plan("merge", `AUTOLAND: merging #${m.number}`, m));
        continue;
      }
    }
    // runway: HOLD하지 않은 CLEARED PR이 있으면 그것이 먼저 머지돼야 한다(지금 갱신하면 그 머지 뒤 다시 behind가 된다)
    const waiting = cleared.find((p) => !isHeld(cfg, p));
    if (waiting) {
      view.airports.push(plan("waiting", `AUTOLAND: waiting — #${waiting.number} CLEARED, SUPERVISOR 머지 대기(머지하거나 HOLD하면 다음 PR을 갱신)`, waiting));
      continue;
    }
    const next = queue.find((p) => !skip.has(headKey(p)));
    if (next) {
      tag(next, "update", "AUTOLAND: updating");
      view.airports.push(plan("update", `AUTOLAND: updating #${next.number}`, next));
      continue;
    }
    view.airports.push(plan("idle", queue.length ? "AUTOLAND: 갱신 실패한 PR만 남음 — 새 push를 기다림" : "AUTOLAND: 갱신할 PR 없음"));
  }
  return view;
}

// GitHub 쓰기 오류 → 결과. update-branch 422 "expected head sha"는 head가 움직인 것(다음 주기에 새 head로 다시)
export function writeResultOf(stderr: string): { result: "rejected" | "failed"; detail: string } {
  const line = stderr.split("\n").map((l) => l.trim()).filter(Boolean).join(" ").slice(0, 300);
  if (/expected head sha|head (sha|branch) (was modified|didn't match|does not match)|Head branch was modified/i.test(stderr)) return { result: "rejected", detail: line || "head가 움직임" };
  return { result: "failed", detail: line || "알 수 없는 오류" };
}

import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Hono } from "hono";
import { writeResultOf } from "./autoland.ts";
import { config } from "./config.ts";
import { loadRecycle } from "./control-recycle.ts";
import { corePathOf, type KLanded, kApprovalOf, kLandDaysOf, type KVerdict } from "./k-approval.ts";
import { slugOfUrl } from "./landing.ts";
import { capText, sectionsOf } from "./landing-review.ts";
import {
  appendMccRecord,
  type CiState,
  escalationOf,
  inspectionComment,
  reviewOfHead,
  landBlocksOf,
  loadMcc,
  mccGateLine,
  mccDeploys,
  mccGateOf,
  mccLands,
  MCC_MODES,
  MccError,
  mccModelOf,
  type MccMode,
  type MccRecord,
  parseInspect,
  readJsonl,
  readMccRecords,
  type RtsRecord,
  RTS_FILE,
  rtsDueOf,
  rtsStopOf,
  spacingStartOf,
  rtsUnitGuard,
  saveMcc,
  tierOfFiles,
} from "./mcc.ts";
import type { MccLandInfo } from "./land-by.ts";
import { loadLogbook, prEntries } from "./logbook.ts";
import type { PullRequest, Snapshot } from "./model.ts";
import { isRevertPr, loadAutoRevert, readAutoRevertLines } from "./auto-revert.ts";
import { fromThisApp } from "./origin.ts";
import { assertGithubOn } from "./github-switch.ts";
import { fetchIssueDetail } from "./sources/linear.ts";

// MCC 실행부(docs/mcc.md). MCC 세션은 atcctl로 읽고 판단만 한다. GitHub 쓰기와 RTS 시작은 여기서만 한다:
// findings의 PR 댓글, 정확한 head 머지(sha, land·land+rts 모드), systemctl --user start --no-block atc-rts(rts·land+rts 모드).
// GraphQL 한도(2026-09-28)에 막히지 않게 GitHub은 모두 REST(gh api)로 읽고 쓴다.

const run = promisify(execFile);
export const gh = async (args: string[]) => {
  assertGithubOn();
  return (await run("gh", args, { timeout: 60_000, maxBuffer: 32 << 20 })).stdout;
};
export const errText = (e: unknown) => {
  const err = e as { stderr?: string; message?: string };
  return (err.stderr?.trim() || err.message || String(e)).split("\n")[0];
};

const DIFF_MAX = 80_000;
const BODY_MAX = 8_000;
const ISSUE_MAX = 6_000;
const QUEUE_MAX = 10; // 한 번에 보는 PR 수(오래된 순)

const INSPECT_GUIDE =
  "CI(테스트·타입·빌드)는 이미 돈다. CI가 못 보는 것을 본다: 순수 함수와 입출력 분리, 새 동작의 테스트, erasableSyntaxOnly, 화면 색·글꼴은 styles.css 토큰만, 항공 용어는 영어, " +
  "바뀐 동작은 CHANGELOG 조각 한 쌍(changelog.d/*.md·*.ko.md, CHANGELOG.md를 직접 고치면 P2), 설계 문서의 상태 표시(✅·Status 줄·Not built yet)는 ENGINEERING 몫(팀 PR이 고치면 P2), 짝 문서는 두 언어, 사용법이 바뀌면 docs/guide, 공개 저장소라 vocado 내부 사항·비밀·스크린샷 없음, 기록은 추가만 하는 JSONL·설정은 원자적 JSON. " +
  "user 등급이거나 ESCALATE할 PR은 본문에 Behavior change 절(글자 그림 하나, 또는 `Behavior change: none`)이 있어야 하고, 없거나 diff와 어긋나면 P1. diff가 잘렸으면(diffTruncated) 본 범위를 적고 pass하지 않는다. 운영 상태 형식을 바꾸거나 되돌리기 어려우면 ESCALATE. 지적은 P0(머지하면 안 됨)·P1(머지 전에 고칠 것)·P2(나중에). P0·P1이 없으면 pass.";

interface RestPull {
  number: number;
  state: string;
  draft: boolean;
  title: string;
  body: string | null;
  html_url: string;
  mergeable_state: string;
  head: { sha: string; ref: string; repo: { full_name: string } | null };
  base: { ref: string; repo: { full_name: string } };
  user: { login: string } | null;
}

export function setMccMode(mode: MccMode) {
  const cfg = loadMcc();
  if (cfg.mode === mode) return;
  saveMcc({ ...cfg, mode });
  appendMccRecord({ op: "mode", at: new Date().toISOString(), mode, detail: `${cfg.mode} → ${mode}` });
}

// K 승인 착륙 스위치(ATC-391): 설정 창에서 SUPERVISOR만(PUT /api/settings의 mccKApproval, fromThisApp). 바꾼 것은 mcc.jsonl에 mode 줄로 남긴다
export function setKApproval(mode: "on" | "off") {
  const cfg = loadMcc();
  if (cfg.kApproval === mode) return;
  saveMcc({ ...cfg, kApproval: mode });
  appendMccRecord({ op: "mode", at: new Date().toISOString(), mode: cfg.mode, kApproval: mode, detail: `kApproval ${cfg.kApproval} → ${mode}` });
}

// MCC가 맡은 AIRPORT: 저장소 경로, GitHub slug, 기본 브랜치와 그 CI
export function airportOf(s: Snapshot) {
  const cfg = loadMcc();
  const a = s.airports.find((x) => x.code === cfg.airport);
  if (!a?.repo) throw new MccError(`${cfg.airport} AIRPORT가 운항 중이 아님`, 404);
  const main = s.atfm.mains.find((m) => m.repo === a.repo) ?? null;
  const slug = main?.slug ?? slugOfUrl(s.pulls.find((p) => p.repo === a.repo)?.url ?? "");
  if (!slug) throw new MccError(`${cfg.airport}의 GitHub 저장소를 아직 모름 — atc가 GitHub을 읽은 뒤(90초 안) 다시`, 409);
  const mainCi: CiState = !main?.sha ? "none" : main.state === "success" ? "ok" : main.state === "pending" ? "pending" : main.state === "none" ? "none" : "failed";
  const stop = s.atfm.groundStops.find((g) => g.airport === cfg.airport && g.kind === "stop" && g.enforced && g.land !== false);
  return { cfg, repo: a.repo, slug, defaultBranch: main?.branch ?? "main", main: main?.sha ?? null, mainReadAt: main?.at ?? null, mainCi, groundStop: stop ? stop.text : null, groundStopTrigger: stop ? stop.trigger : null };
}

// 등급 캐시(PR 번호 + head → 등급). 등급은 바뀐 파일로만 정하므로 head가 같으면 같다. judge()와 landBy(ATC-151)가 함께 쓴다 — 등급을 두 갈래로 재지 않는다
// ATC-391: K 승인 판정에 바뀐 파일과 user 등급 파일도 필요해서 함께 둔다(같은 head면 같다)
interface TierEntry {
  tier: "auto" | "flagged" | "user";
  files: string[];
  userFiles: string[];
  checkPath: string | null; // k-approval.ts CHECK_CORE에 든 파일(ATC-391): 등급과 상관없이 SUPERVISOR 몫
}
const tierCache = new Map<string, TierEntry>();
const tierKey = (slug: string, n: number, head: string) => `${slug}#${n}@${head}`;
const tierEntryOf = (tier: { tier: "auto" | "flagged" | "user"; reasons: { file: string; tier: string }[] }, files: string[]): TierEntry => ({ tier: tier.tier, files, userFiles: tier.reasons.filter((r) => r.tier === "user").map((r) => r.file), checkPath: corePathOf(files) });
async function tierEntryCached(slug: string, n: number, head: string): Promise<TierEntry> {
  const k = tierKey(slug, n, head);
  const hit = tierCache.get(k);
  if (hit) return hit;
  const files = await fetchFiles(slug, n);
  const entry = tierEntryOf(await tierOfFiles(files), files);
  if (tierCache.size > 500) tierCache.clear();
  tierCache.set(k, entry);
  return entry;
}
const tierCached = async (slug: string, n: number, head: string) => (await tierEntryCached(slug, n, head)).tier;

// K 승인 판정(ATC-391, k-approval.ts): 이 PR의 FLIGHT 발권과 선언, 바뀐 파일로. 티켓·발권은 스냅샷에서 읽는다(GitHub 호출 없음)
export function kVerdictOf(s: Pick<Snapshot, "tickets" | "releases">, flight: string | null, e: TierEntry, mode: "on" | "off"): KVerdict {
  const t = flight ? s.tickets.find((x) => x.key === flight) : undefined;
  return kApprovalOf({ mode, flight, files: e.files, userFiles: e.userFiles, declared: t?.k3, unparsed: t?.k3Check?.unparsed ?? 0, stateType: t?.stateType, hash: t?.releaseHash, releases: s.releases });
}

// TOWER 브리핑의 landBy 자료(ATC-151): MCC AIRPORT의 저장소·모드·HOLD·ESCALATE와 열린 PR의 등급.
// MCC AIRPORT가 운항 중이 아니면 null(모든 AIRPORT가 holder). 등급을 못 읽은 PR은 tiers에서 빠져 landBy가 supervisor가 된다
export async function mccLandInfo(s: Snapshot): Promise<MccLandInfo | null> {
  const cfg = loadMcc();
  const a = s.airports.find((x) => x.code === cfg.airport);
  if (!a?.repo) return null;
  const records = readMccRecords();
  const escalated = [...new Set(records.filter((r) => r.op === "escalate").map((r) => (r as { pr: number }).pr))];
  const tiers = new Map<number, { head: string; tier: "auto" | "flagged" | "user"; k?: true; check?: true }>();
  let slug: string | null = null;
  try {
    slug = airportOf(s).slug;
  } catch {}
  if (slug) {
    for (const p of s.pulls.filter((x) => x.repo === a.repo && !x.draft)) {
      try {
        const e = await tierEntryCached(slug, p.number, p.head);
        tiers.set(p.number, { head: p.head, tier: e.tier, ...(e.checkPath ? { check: true as const } : e.tier === "user" && kVerdictOf(s, p.ticketKey, e, cfg.kApproval).ok ? { k: true as const } : {}) });
      } catch {}
    }
  }
  return { repo: a.repo, mode: cfg.mode, holds: cfg.holds, escalated, tiers };
}

// mccLandInfo와 같은 자료를 이미 캐시된 등급으로만 만든다(ATC-197): GitHub를 부르지 않아 5초마다 알림을 셀 때 쓸 수 있다.
// 캐시에 없는 PR은 tiers에서 빠져 landBy가 supervisor가 된다(등급을 모르면 SUPERVISOR가 본다). 등급 규칙은 landByOf와 tierOfFiles 그대로다
export function mccLandInfoCached(s: Snapshot): MccLandInfo | null {
  const cfg = loadMcc();
  const a = s.airports.find((x) => x.code === cfg.airport);
  if (!a?.repo) return null;
  const escalated = [...new Set(readMccRecords().filter((r) => r.op === "escalate").map((r) => (r as { pr: number }).pr))];
  const tiers = new Map<number, { head: string; tier: "auto" | "flagged" | "user"; k?: true; check?: true }>();
  let slug: string | null = null;
  try {
    slug = airportOf(s).slug;
  } catch {}
  if (slug) {
    for (const p of s.pulls.filter((x) => x.repo === a.repo && !x.draft)) {
      const e = tierCache.get(tierKey(slug, p.number, p.head));
      if (e) tiers.set(p.number, { head: p.head, tier: e.tier, ...(e.checkPath ? { check: true as const } : e.tier === "user" && kVerdictOf(s, p.ticketKey, e, cfg.kApproval).ok ? { k: true as const } : {}) });
    }
  }
  return { repo: a.repo, mode: cfg.mode, holds: cfg.holds, escalated, tiers };
}

const fetchPull = async (slug: string, n: number) => JSON.parse(await gh(["api", `repos/${slug}/pulls/${n}`])) as RestPull;
// 바뀐 파일 이름. 이름을 바꾼 파일은 옛 이름도 함께 준다(previous_filename): 목록에 든 파일을 옮겨도 옛 이름이 보인다. 지운 파일은 filename에 그대로 있다
const fetchFiles = async (slug: string, n: number) =>
  (await gh(["api", "--paginate", `repos/${slug}/pulls/${n}/files?per_page=100`, "--jq", ".[] | .filename, (.previous_filename // empty)"])).split("\n").filter(Boolean);
// 이 커밋의 CI 체크(이름이 ciCheck인 check run). 다시 돌았으면 마지막 것
async function fetchCi(slug: string, sha: string, name: string): Promise<CiState> {
  const rows = (await gh(["api", `repos/${slug}/commits/${sha}/check-runs?check_name=${encodeURIComponent(name)}&per_page=20`, "--jq", ".check_runs[] | [.status, (.conclusion // \"\"), (.started_at // \"\")] | @tsv"]))
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\t"))
    .sort((a, b) => (b[2] ?? "").localeCompare(a[2] ?? ""));
  if (!rows.length) return "none";
  const [status, conclusion] = rows[0];
  if (status !== "completed") return "pending";
  return ["success", "neutral", "skipped"].includes(conclusion) ? "ok" : "failed";
}

// 이 서버가 atc-rts 유닛을 시작해도 되나(시험 서버는 안 된다). 사유 또는 null
export const rtsGuard = () => rtsUnitGuard({ stateDir: config.stateDir, port: config.port, realStateDir: join(userInfo().homedir, ".local/state/atc") });
export const startRtsUnit = async () => {
  await run("systemctl", ["--user", "start", "--no-block", "atc-rts.service"], { timeout: 15_000 });
};

// 서비스가 시작한 커밋. index.ts가 넘긴다
let deployedHead: () => string | null = () => null;

export function rtsState(records: readonly MccRecord[]) {
  const rts = readJsonl<RtsRecord>(RTS_FILE());
  const last = rts.at(-1) ?? null;
  const lastMode = [...records].reverse().find((r) => r.op === "mode");
  const lastStart = [...records].reverse().find((r): r is Extract<MccRecord, { op: "rts" | "would-rts" }> => r.op === "rts" && r.result === "started");
  const lastLand = [...records].reverse().find((r) => r.op === "land" && r.result === "ok");
  // lastStartAt은 UPDATE 막대가 쓰는 그대로(거절도 포함). spacingAt은 MCC의 5분 간격용(거절된 시작은 뺀다, ATC-121)
  return { last, stop: rtsStopOf(last, lastMode?.at ?? null), lastStartAt: lastStart?.at ?? null, lastStartBy: lastStart?.by ?? null, spacingAt: spacingStartOf(records, rts), lastLandAt: lastLand?.at ?? null };
}

// PR 하나의 착륙 판단(머지 직전과 queue가 같이 쓴다). 자료는 모두 지금 GitHub에서 읽는다
async function judge(s: Snapshot, number: number, head?: string) {
  const ap = airportOf(s);
  const pr = await fetchPull(ap.slug, number);
  const want = head ?? pr.head.sha;
  const files = await fetchFiles(ap.slug, number);
  const tierResult = await tierOfFiles(files);
  const { tier, reasons } = tierResult;
  const entry = tierEntryOf(tierResult, files);
  tierCache.set(tierKey(ap.slug, number, pr.head.sha), entry); // landBy가 같은 등급을 쓴다(ATC-151)
  // K 승인(ATC-391): 같은 head의 user 등급 PR이 발권 때 승인한 K 효과 안에서 만들어졌나. ESCALATE(의심)는 landBlocksOf가 따로 막는다
  const flight = s.pulls.find((p) => p.repo === ap.repo && p.number === number)?.ticketKey ?? null;
  const kApproval = tier === "user" ? kVerdictOf(s, flight, entry, ap.cfg.kApproval) : null;
  const ci = await fetchCi(ap.slug, pr.head.sha, ap.cfg.ciCheck);
  const records = readMccRecords();
  const inspection = reviewOfHead(records, number, pr.head.sha); // ESCALATE한 head도 본 것으로 센다(ATC-390)
  const escalated = escalationOf(records, number);
  const rts = rtsState(records);
  const blocks = landBlocksOf({
    pr: { state: pr.state, draft: pr.draft, base: pr.base.ref, head: pr.head.sha, mergeableState: pr.mergeable_state, fork: pr.head.repo?.full_name !== pr.base.repo.full_name },
    defaultBranch: ap.defaultBranch,
    head: want,
    tier,
    tierReasons: [...new Set(reasons.map((r) => r.why))],
    escalated,
    checkPath: entry.checkPath,
    kApproval,
    ci,
    ciCheck: ap.cfg.ciCheck,
    inspection,
    held: ap.cfg.holds.includes(number),
    // 자동 되돌림(ATC-351)이 연 revert PR은 main 깨짐 stop을 푸는 길이라 그 stop에는 막히지 않는다(다른 stop·리뷰·CI는 그대로)
    groundStop: ap.groundStopTrigger === "main-broken" && loadAutoRevert().mode === "on" && isRevertPr(readAutoRevertLines(), ap.cfg.airport, number, pr.head.ref) ? null : ap.groundStop,
    rtsBlocked: rts.stop,
  });
  return { ap, pr, files, tier, reasons, ci, inspection, escalated, kApproval, blocks };
}

// ── SHADOW GATE(docs/mcc.md 9장) ──
// LOGBOOK에는 머지된 head가 없다(형식은 그대로 둔다). 닫힌 PR 목록(REST)에서 읽어 PR 번호별로 계속 둔다 — 머지된 head는 바뀌지 않는다
const mergedHeads = new Map<string, Map<number, string>>();
const headsReadAt = new Map<string, number>();
const HEADS_SPACING_MS = 5 * 60_000;
const HEADS_PAGES = 5;

async function readMergedHeads(slug: string, want: number[], since: number): Promise<Map<number, string>> {
  const heads = mergedHeads.get(slug) ?? new Map<number, string>();
  mergedHeads.set(slug, heads);
  const missing = () => want.some((n) => !heads.has(n));
  if (!missing() || Date.now() - (headsReadAt.get(slug) ?? 0) < HEADS_SPACING_MS) return heads;
  headsReadAt.set(slug, Date.now());
  // 최근에 바뀐 순. 머지는 updated_at을 올리므로 since보다 오래된 쪽에 닿으면 그친다
  for (let page = 1; page <= HEADS_PAGES && missing(); page++) {
    const rows = (await gh(["api", `repos/${slug}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`, "--jq", '.[] | [.number, (.merged_at // ""), .head.sha, .updated_at] | @tsv']))
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("\t"));
    for (const [n, mergedAt, sha] of rows) if (mergedAt && sha) heads.set(Number(n), sha);
    if (rows.length < 100 || Date.parse(rows.at(-1)![3]) < since) break;
  }
  return heads;
}

// MCC 기록과 LOGBOOK으로 gate를 잰다. GitHub을 못 읽으면 head 없이(머지 전 마지막 INSPECTION으로) 재고 error를 붙인다
async function gateOf(s: Snapshot) {
  const cfg = loadMcc();
  const records = readMccRecords();
  const entries = prEntries(loadLogbook());
  const now = Date.now();
  const draft = mccGateOf({ records, entries, airport: cfg.airport, heads: new Map(), now });
  let heads: ReadonlyMap<number, string> = new Map();
  let error: string | null = null;
  if (draft.merged) {
    try {
      heads = await readMergedHeads(airportOf(s).slug, draft.rows.map((r) => r.pr), Date.parse(draft.since!));
    } catch (e) {
      error = `머지된 head를 읽지 못함 — ${errText(e)}`;
    }
  }
  const gate = mccGateOf({ records, entries, airport: cfg.airport, heads, now });
  return { ...gate, line: mccGateLine(gate), error };
}

// 열린 PR 중 MCC가 맡은 저장소의 것(Draft 제외, 오래된 순)
const minePulls = (s: Snapshot, repo: string): PullRequest[] =>
  s.pulls.filter((p) => p.repo === repo && !p.draft).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, QUEUE_MAX);

export function mountMcc(app: Hono, getSnapshot: () => Promise<Snapshot>, head: () => string | null) {
  deployedHead = head;
  const fail = (e: unknown) => {
    if (e instanceof MccError) return { body: { error: e.message }, status: e.status };
    return { body: { error: errText(e) }, status: 502 as const };
  };
  const prNumber = (raw: string) => {
    const n = Number(raw.replace(/^#/, ""));
    if (!Number.isInteger(n) || n <= 0) throw new MccError("PR 번호가 필요함", 400);
    return n;
  };

  // MCC 세션의 할 일: 열린 PR마다 등급·CI·머지 상태·INSPECTION·막힌 조건, 서비스 커밋과 RTS
  app.get("/api/mcc/queue", async (c) => {
    try {
      const s = await getSnapshot();
      const ap = airportOf(s);
      const records = readMccRecords();
      const pulls = [];
      for (const p of minePulls(s, ap.repo)) {
        try {
          const j = await judge(s, p.number);
          pulls.push({
            pr: p.number,
            title: j.pr.title,
            url: j.pr.html_url,
            head: j.pr.head.sha.slice(0, 7),
            flight: p.ticketKey,
            tier: j.escalated ? "user" : j.tier,
            tierReasons: j.reasons.map((r) => `${r.tier} ${r.file} (${r.why})`),
            // K 승인 착륙(ATC-391): user 등급 PR이 발권 때 승인한 K 효과 안이면 ok(blocks에 L3가 없다). 아니면 이유. MCC는 이것이 ok가 아니어도 tier만으로 ESCALATE하지 않는다
            kApproval: j.kApproval ? (j.kApproval.ok ? { ok: true, release: j.kApproval.release, flight: j.kApproval.flight, channel: j.kApproval.channel } : { ok: false, code: j.kApproval.code, why: j.kApproval.why }) : null,
            escalated: j.escalated?.reason ?? null,
            ci: j.ci,
            mergeState: j.pr.mergeable_state,
            inspection: j.inspection ? { verdict: j.inspection.verdict, at: j.inspection.at, p0: j.inspection.p0, p1: j.inspection.p1, p2: j.inspection.p2 } : null,
            blocks: j.blocks.map((b) => `${b.code} ${b.text}`),
            landable: j.blocks.length === 0,
          });
        } catch (e) {
          pulls.push({ pr: p.number, title: p.title, url: p.url, error: errText(e) });
        }
      }
      const rts = rtsState(records);
      const deployed = deployedHead();
      // SHADOW GATE 한 줄(atcctl mcc queue 위쪽에 보이게)
      const gate = await gateOf(s).then((g) => g.line + (g.error ? ` (${g.error})` : "")).catch((e) => `SHADOW GATE 계산 실패 — ${errText(e)}`);
      return c.json({
        mode: ap.cfg.mode,
        airport: ap.cfg.airport,
        // CONTROL RECYCLE 스위치(ATC-166). MCC는 상태 폴더를 읽지 못해서 컨텍스트 CAP 안내를 어떻게 받을지 여기서 안다
        recycle: { mode: loadRecycle().mode },
        gate,
        repo: ap.slug,
        service: { head: deployed?.slice(0, 7) ?? null },
        main: { branch: ap.defaultBranch, head: ap.main?.slice(0, 7) ?? null, ci: ap.mainCi },
        rts: { ...rtsDueOf({ deployed, main: ap.main, mainCi: ap.mainCi, last: rts.last, lastStartAt: rts.spacingAt, mainReadAt: ap.mainReadAt, lastLandAt: rts.lastLandAt, now: Date.now() }, rts.stop), last: rts.last },
        groundStop: ap.groundStop,
        pulls,
        recent: records.slice(-10).reverse().map((r) => ({ op: r.op, at: r.at, ...("pr" in r ? { pr: r.pr } : {}), ...("result" in r ? { result: r.result } : {}), ...("verdict" in r ? { verdict: r.verdict } : {}) })),
      });
    } catch (e) {
      const f = fail(e);
      return c.json(f.body, f.status);
    }
  });

  // INSPECTION 자료: PR 제목·본문, 바뀐 파일과 등급 사유, 크기를 제한한 diff, ATC 이슈의 완료 기준·금지 사항(있으면)
  app.get("/api/mcc/packet/:pr", async (c) => {
    try {
      const s = await getSnapshot();
      const n = prNumber(c.req.param("pr"));
      const ap = airportOf(s);
      const pr = await fetchPull(ap.slug, n);
      const files = await fetchFiles(ap.slug, n);
      const { tier, reasons } = await tierOfFiles(files);
      const diff = capText(await gh(["api", `repos/${ap.slug}/pulls/${n}`, "-H", "Accept: application/vnd.github.diff"]), DIFF_MAX);
      const key = s.pulls.find((p) => p.repo === ap.repo && p.number === n)?.ticketKey ?? null;
      let flight: Record<string, unknown> | null = null;
      if (key) {
        try {
          const issue = (await fetchIssueDetail(key)) as { title?: string; url?: string; description?: string | null };
          const desc = issue.description ?? "";
          flight = { key, title: issue.title ?? null, url: issue.url ?? null, ...sectionsOf(desc), description: capText(desc, ISSUE_MAX) };
        } catch (e) {
          flight = { key, error: `이슈를 읽지 못함 — ${errText(e)}` };
        }
      }
      return c.json({
        pr: n,
        url: pr.html_url,
        head: pr.head.sha,
        branch: pr.head.ref,
        title: pr.title,
        body: capText(pr.body ?? "", BODY_MAX),
        tier,
        tierReasons: reasons,
        // K 승인(ATC-391): user 등급이면 이 PR이 발권 때 승인한 K 효과 안에서 만들어졌는지. ok면 tier만으로 ESCALATE하지 않는다
        kApproval: tier === "user" ? (() => { const v = kVerdictOf(s, key, tierEntryOf({ tier, reasons }, files), airportOf(s).cfg.kApproval); return v.ok ? { ok: true, release: v.release, flight: v.flight, channel: v.channel } : { ok: false, code: v.code, why: v.why }; })() : null,
        files,
        flight,
        diff: diff.text,
        diffTruncated: diff.truncated,
        diffChars: diff.chars,
        guide: INSPECT_GUIDE,
      });
    } catch (e) {
      const f = fail(e);
      return c.json(f.body, f.status);
    }
  });

  // INSPECTION 기록. 지금 head에만. model은 guard가 붙인 실제 모델(Claude만). findings는 PR 댓글로도 남긴다(모든 모드)
  app.post("/api/mcc/inspect/:pr", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const s = await getSnapshot();
      const n = prNumber(c.req.param("pr"));
      const ap = airportOf(s);
      const pr = await fetchPull(ap.slug, n);
      if (pr.state !== "open") throw new MccError(`#${n}는 열려 있지 않음`, 409);
      const r = parseInspect(body, n, pr.head.sha, new Date().toISOString());
      if (r.verdict === "findings") {
        try {
          await gh(["api", "-X", "POST", `repos/${ap.slug}/issues/${n}/comments`, "-f", `body=${inspectionComment(r)}`]);
          r.comment = "posted";
        } catch {
          r.comment = "failed";
        }
      }
      appendMccRecord(r);
      return c.json({ inspection: r });
    } catch (e) {
      const f = fail(e);
      return c.json(f.body, f.status);
    }
  });

  // ESCALATE: 사용자 등급으로 올린다(내릴 수는 없다)
  app.post("/api/mcc/escalate/:pr", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const model = mccModelOf(body);
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
      if (!reason) throw new MccError("reason(사유)이 필요함", 400);
      const s = await getSnapshot();
      const n = prNumber(c.req.param("pr"));
      const ap = airportOf(s);
      const pr = await fetchPull(ap.slug, n);
      const r: MccRecord = { op: "escalate", at: new Date().toISOString(), pr: n, head: pr.head.sha, reason, model };
      appendMccRecord(r);
      return c.json({ escalate: r });
    } catch (e) {
      const f = fail(e);
      return c.json(f.body, f.status);
    }
  });

  // 착륙. 조건(L2–L8)을 지금 GitHub 자료로 다시 보고, shadow면 would-land만 남긴다
  app.post("/api/mcc/land/:pr", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const model = mccModelOf(body);
      const head = typeof body.head === "string" ? body.head.trim().toLowerCase() : "";
      if (head.length < 7) throw new MccError("head(7자 이상)가 필요함", 400);
      const s = await getSnapshot();
      const n = prNumber(c.req.param("pr"));
      const j = await judge(s, n, head);
      if (j.blocks.length) return c.json({ landed: false, blocks: j.blocks }, 409);
      const at = new Date().toISOString();
      const base = { at, pr: n, head: j.pr.head.sha, tier: j.tier, model };
      if (!mccLands(j.ap.cfg.mode)) {
        appendMccRecord({ op: "would-land", ...base, result: "ok", detail: j.ap.cfg.mode });
        return c.json({ landed: false, would: true, tier: j.tier });
      }
      try {
        // 정확한 head만 머지한다(sha). atc는 merge 커밋을 쓴다. auto-merge를 켜지 않는다
        await gh(["api", "-X", "PUT", `repos/${j.ap.slug}/pulls/${n}/merge`, "-f", `sha=${j.pr.head.sha}`, "-f", "merge_method=merge"]);
        appendMccRecord({ op: "land", ...base, result: "ok", ...(j.tier === "user" && j.kApproval?.ok ? { k: { release: j.kApproval.release, flight: j.kApproval.flight, channel: j.kApproval.channel } } : {}) });
        return c.json({ landed: true, tier: j.tier, ...(j.tier === "user" && j.kApproval?.ok ? { kApproval: { release: j.kApproval.release, flight: j.kApproval.flight } } : {}), flagged: j.tier === "flagged" ? j.reasons.filter((r) => r.tier === "flagged").map((r) => r.file) : [] });
      } catch (e) {
        const r = writeResultOf(errText(e));
        appendMccRecord({ op: "land", ...base, ...r });
        return c.json({ landed: false, ...r }, 409);
      }
    } catch (e) {
      const f = fail(e);
      return c.json(f.body, f.status);
    }
  });

  // RETURN TO SERVICE. land+rts가 아니면 would-rts만. 실제 일은 서비스 밖의 systemd 유닛(deploy/rts.mjs)이 한다
  app.post("/api/mcc/rts", async (c) => {
    try {
      const model = mccModelOf((await c.req.json().catch(() => ({}))) as Record<string, unknown>);
      const s = await getSnapshot();
      const ap = airportOf(s);
      const records = readMccRecords();
      const rts = rtsState(records);
      const deployed = deployedHead();
      const due = rtsDueOf({ deployed, main: ap.main, mainCi: ap.mainCi, last: rts.last, lastStartAt: rts.spacingAt, mainReadAt: ap.mainReadAt, lastLandAt: rts.lastLandAt, now: Date.now() }, rts.stop);
      if (!due.due) {
        // rts·land+rts에서는 서버가 이미 시작했을 수 있다(ATC-84): 그렇다고 알린다
        const byServer = mccDeploys(ap.cfg.mode) && rts.lastStartBy === "server";
        return c.json({ started: false, ...(byServer ? { serverStarted: true } : {}), why: byServer ? `서버가 이미 RTS를 시작함(${rts.lastStartAt}) — ${due.why}` : due.why }, 409);
      }
      const base = { at: new Date().toISOString(), from: deployed, to: ap.main!, model };
      if (!mccDeploys(ap.cfg.mode)) {
        appendMccRecord({ op: "would-rts", ...base, result: "started", detail: ap.cfg.mode });
        return c.json({ started: false, would: true, why: due.why });
      }
      const blocked = rtsGuard();
      if (blocked) return c.json({ started: false, why: blocked }, 409);
      try {
        await startRtsUnit();
        appendMccRecord({ op: "rts", ...base, result: "started" });
        return c.json({ started: true, why: due.why });
      } catch (e) {
        appendMccRecord({ op: "rts", ...base, result: "failed", detail: errText(e) });
        return c.json({ started: false, error: errText(e) }, 502);
      }
    } catch (e) {
      const f = fail(e);
      return c.json(f.body, f.status);
    }
  });

  // SHADOW GATE: land로 올릴 근거(읽기만). 설정 창 MCC 줄 아래 패널
  app.get("/api/mcc/gate", async (c) => {
    try {
      return c.json(await gateOf(await getSnapshot()));
    } catch (e) {
      const f = fail(e);
      return c.json(f.body, f.status);
    }
  });

  // 기록과 설정 읽기(화면·SUPERVISOR)
  app.get("/api/mcc", (c) => c.json({ config: loadMcc(), modes: MCC_MODES, records: readMccRecords().slice(-50), rts: readJsonl<RtsRecord>(RTS_FILE()).slice(-20) }));

  // HOLD: SUPERVISOR만(이 화면 Origin)
  app.post("/api/mcc/hold", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다(SUPERVISOR 전용)" }, 403);
    const b = (await c.req.json().catch(() => null)) as { pr?: unknown; hold?: unknown } | null;
    if (!b || !Number.isInteger(b.pr) || typeof b.hold !== "boolean") return c.json({ error: "pr, hold(true|false)가 필요함" }, 400);
    const cfg = loadMcc();
    const pr = b.pr as number;
    const holds = cfg.holds.filter((h) => h !== pr);
    if (b.hold) holds.push(pr);
    saveMcc({ ...cfg, holds });
    appendMccRecord({ op: b.hold ? "hold" : "unhold", at: new Date().toISOString(), pr });
    return c.json({ holds });
  });
}

// K 승인으로 착륙한 PR의 날짜별 수(ATC-391): 설정 창 MCC 줄 아래. 기록만 읽는다
export function kLandDays(days = 7, now = Date.now()) {
  const lands: KLanded[] = [];
  for (const r of readMccRecords()) if (r.op === "land" && r.result === "ok" && r.k) lands.push({ at: r.at, pr: r.pr, release: r.k.release });
  return kLandDaysOf(lands, readAutoRevertLines(), readJsonl<RtsRecord>(RTS_FILE()), days, now);
}

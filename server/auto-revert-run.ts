import { loadAutoland } from "./autoland.ts";
import { readRecords as readAutolandRecords, setAutolandMode } from "./autoland-run.ts";
import {
  appendAutoRevertLine,
  type AutoRevertLine,
  fixTextOf,
  loadAutoRevert,
  lowerAutoland,
  lowerMcc,
  prOfSubject,
  readAutoRevertLines,
  type RevertCommit,
  revertBodyOf,
  revertDecisionOf,
  revertTitleOf,
  saveAutoRevert,
  type AutoRevertMode,
  stoppedOf,
} from "./auto-revert.ts";
import { loadMcc, readMccRecords, tierOfFiles } from "./mcc.ts";
import { errText, gh, setMccMode } from "./mcc-run.ts";
import { migrationPathOf } from "./landing.ts";
import type { Snapshot } from "./model.ts";
import { loadFleet } from "./fleet.ts";
import { append as appendRelayOp, lastAircraftSources, readRelayOps } from "./relay-run.ts";
import { lastAircraftOf, nextRelayId, relayInputOf } from "./relay.ts";
import { record } from "./recorder.ts";
import { readCommitState } from "./sources/github.ts";

// 자동 되돌림의 실행부(ATC-351, docs/autonomy.md C4). 규칙은 순수 함수(auto-revert.ts)가 정하고, 여기서는 읽고 쓰기만 한다.
// GitHub에 쓰는 것은 둘뿐이다: revert PR 하나(GraphQL revertPullRequest, Draft 아님)와 AIRPORT 사고마다 하나. force-push·브랜치 삭제·admin 우회·GitHub auto-merge는 없다.
// 스위치 off(기본)면 아무것도 읽지 않는다. shadow는 would-revert 줄만 쓴다. on은 revert PR과 breaker가 한다.

const EXISTING = (lines: readonly AutoRevertLine[], op: AutoRevertLine["op"], airport: string, head: string, pr?: number, detail?: string) =>
  lines.some((l) => l.op === op && l.airport === airport && l.head === head && (pr === undefined || l.pr === pr) && (detail === undefined || l.detail === detail));

let running = false;
let lastCycle: string | null = null;

// 스냅샷마다 부르지만 GitHub을 새로 읽었을 때만 한 주기를 돈다(AUTOLAND와 같다)
export function runAutoRevert(s: Snapshot) {
  if (running || !s.github.fetchedAt || s.github.fetchedAt === lastCycle) return;
  if (loadAutoRevert().mode === "off") return;
  lastCycle = s.github.fetchedAt;
  running = true;
  cycle(s)
    .catch((e) => console.error("[atc] auto-revert failed:", e))
    .finally(() => (running = false));
}

// 스위치(SUPERVISOR만: 설정 창 PUT /api/settings의 autoRevert). 바꾸면 breaker 래치가 풀린다(mode 줄)
export function setAutoRevertMode(mode: AutoRevertMode) {
  const cfg = loadAutoRevert();
  if (cfg.mode === mode) return;
  saveAutoRevert({ ...cfg, mode });
  appendAutoRevertLine({ op: "mode", detail: `${cfg.mode} → ${mode}` });
}

// lander가 이 AIRPORT에서 머지했다는 기록(PR 번호 → 누가). AUTOLAND는 airport 칸, MCC는 mcc.json의 AIRPORT
function landersOf(code: string): Map<number, "mcc" | "autoland"> {
  const out = new Map<number, "mcc" | "autoland">();
  for (const r of readAutolandRecords(2000)) if (r.op === "merge" && r.result === "ok" && r.airport === code && r.number != null) out.set(r.number, "autoland");
  if (loadMcc().airport === code) for (const r of readMccRecords()) if (r.op === "land" && r.result === "ok") out.set(r.pr, "mcc");
  return out;
}

interface GhCommit {
  sha: string;
  subject: string;
}

async function cycle(s: Snapshot) {
  const mode = loadAutoRevert().mode;
  const codes = new Set([...loadAutoland().airports, loadMcc().airport]);
  const now = Date.now();
  for (const code of codes) {
    const a = s.airports.find((x) => x.code === code);
    const main = a ? s.atfm.mains.find((m) => m.repo === a.repo) : undefined;
    if (!a || !main?.sha) continue;
    let lines = readAutoRevertLines();
    const slug = main.slug;
    const open = new Set(s.pulls.filter((p) => p.repo === a.repo).map((p) => p.number));

    // 연 revert PR이 머지된 것을 처음 본 때(on)
    if (mode === "on") {
      for (const l of lines.filter((x) => x.op === "revert-opened" && x.airport === code && x.revertPr != null)) {
        if (open.has(l.revertPr as number) || lines.some((x) => x.op === "revert-landed" && x.revertPr === l.revertPr)) continue;
        const merged = await gh(["api", `repos/${slug}/pulls/${l.revertPr}`, "--jq", ".merged"]).then((t) => t.trim() === "true").catch(() => false);
        if (merged) appendAutoRevertLine({ op: "revert-landed", airport: code, head: l.head, pr: l.pr, revertPr: l.revertPr });
      }
      lines = readAutoRevertLines();
    }
    if (main.state !== "failure") continue;

    const inflight = lines.some((l) => l.op === "revert-opened" && l.airport === code && l.revertPr != null && open.has(l.revertPr) && !lines.some((x) => x.op === "revert-landed" && x.revertPr === l.revertPr));
    // 열린 revert PR을 기다리는 중이거나 breaker가 멈췄으면 GitHub을 더 읽지 않는다(90초마다 커밋 열다섯 개를 읽지 않게)
    if (mode === "on" && (inflight || stoppedOf(lines, code))) continue;
    // 이미 이 head로 결정을 냈으면 다시 하지 않는다(shadow는 would-revert, on은 revert-opened·revert-failed·hold·stop)
    if (mode === "shadow" ? lines.some((l) => l.op === "would-revert" && l.airport === code && l.head === main.sha) : lines.some((l) => ["revert-opened", "revert-failed", "hold", "stop"].includes(l.op) && l.airport === code && l.head === main.sha)) continue;

    const commits = await commitsOf(code, a.repo, slug, main.sha, lines).catch((e) => {
      console.error(`[atc] auto-revert: ${code} 커밋을 읽지 못함 —`, errText(e));
      return null;
    });
    if (!commits) continue;
    const own = commits[0]?.revert === true;
    if (mode === "on" && !EXISTING(lines, "red", code, main.sha)) {
      appendAutoRevertLine({ op: "red", airport: code, head: main.sha, check: main.failing.join(", "), own });
      lines = readAutoRevertLines();
    }
    const d = revertDecisionOf({
      airport: code,
      head: { sha: main.sha, state: main.state, failing: [...new Set([...main.failing, ...(main.workflowsFailing ?? [])])] },
      commits,
      inflight,
      lines,
      now,
      migrationOf: (files) => migrationPathOf([...files]),
      userTierOf: tierSync,
    });
    await act(mode, code, a.repo, slug, main.sha, d, s);
  }
}

// user 등급 판정은 deploy/landing-tier.mjs(비동기 import)라 commitsOf가 미리 구해 둔 결과를 쓴다
const tierMemo = new Map<string, string | null>();
const tierKey = (files: readonly string[]) => [...files].sort().join("\n");
const tierSync = (files: readonly string[]): string | null => (tierMemo.has(tierKey(files)) ? (tierMemo.get(tierKey(files)) ?? null) : "등급을 계산하지 못함");

async function commitsOf(code: string, repo: string, slug: string, head: string, lines: readonly AutoRevertLine[]): Promise<RevertCommit[]> {
  const rows: GhCommit[] = (
    await gh(["api", `repos/${slug}/commits?sha=${head}&per_page=15`, "--jq", '.[] | [.sha, (.commit.message | split("\\n")[0])] | @tsv'])
  )
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [sha, ...rest] = l.split("\t");
      return { sha, subject: rest.join("\t") };
    });
  const landers = landersOf(code);
  const ours = new Set(lines.filter((l) => l.op === "revert-opened" && l.revertPr != null).map((l) => l.revertPr as number));
  const out: RevertCommit[] = [];
  let green = false;
  for (let i = 0; i < rows.length; i++) {
    const { sha, subject } = rows[i];
    let pr = prOfSubject(subject);
    // PR 번호가 맞는 머지 커밋인지 GitHub에서 확인한다(제목만 믿지 않는다)
    if (pr != null) {
      const ok = await gh(["api", `repos/${slug}/pulls/${pr}`, "--jq", "[.merged, .merge_commit_sha] | @tsv"]).then((t) => t.trim() === `true\t${sha}`).catch(() => false);
      if (!ok) pr = null;
    }
    const by = pr != null ? (landers.get(pr) ?? null) : null;
    const revert = pr != null && ours.has(pr);
    let files: string[] | null = null;
    if (pr != null && by !== null && !revert) {
      files = await gh(["api", "--paginate", `repos/${slug}/pulls/${pr}/files?per_page=100`, "--jq", ".[].filename"]).then((t) => t.split("\n").filter(Boolean)).catch(() => null);
      if (files) tierMemo.set(tierKey(files), await tierOfFiles(files).then((t) => (t.tier === "user" ? t.reasons.map((r) => r.why).join(", ") || "user" : null)).catch(() => "등급을 계산하지 못함"));
    }
    // 마지막 초록 head: head 다음 커밋부터 CI가 초록인 첫 커밋(여기서 그친다)
    if (i > 0 && !green) {
      const st = await readCommitState(repo, slug, sha).catch(() => null);
      green = st?.state === "success";
    }
    out.push({ sha, pr, by, revert, green: i > 0 && green, files });
    if (green) break;
  }
  return out;
}

async function act(mode: AutoRevertMode, code: string, repo: string, slug: string, head: string, d: ReturnType<typeof revertDecisionOf>, s: Snapshot) {
  if (d.act === "none") return;
  // 쓰기 직전에 스위치를 다시 본다(주기 사이에 SUPERVISOR가 끄거나 내렸으면 쓰지 않는다)
  const live = loadAutoRevert().mode;
  if (live === "off" || live !== mode) return;
  const failing = d.act === "revert" ? d.check : "";
  if (mode === "shadow") {
    if (d.act === "revert") appendAutoRevertLine({ op: "would-revert", airport: code, head, commit: d.commit, pr: d.pr, by: d.by, check: failing });
    return; // shadow는 would-revert 줄 말고는 쓰지 않는다
  }
  if (d.act === "hold") {
    appendAutoRevertLine({ op: "hold", airport: code, head, pr: d.pr, detail: d.why });
    return;
  }
  if (d.act === "stop") {
    // breaker: lane을 한 단계 낮춘다(AUTOLAND merge → update, MCC 착륙 끔). 올리는 것은 SUPERVISOR의 스위치다
    const lowered: string[] = [];
    const al = lowerAutoland(loadAutoland().mode);
    if (al) {
      setAutolandMode(al);
      lowered.push(`AUTOLAND merge → ${al}`);
    }
    const mc = lowerMcc(loadMcc().mode);
    if (mc) {
      setMccMode(mc);
      lowered.push(`MCC landing off (→ ${mc})`);
    }
    appendAutoRevertLine({ op: "stop", airport: code, head, detail: `${d.why}${lowered.length ? `; ${lowered.join(", ")}` : "; lanes already low"}` });
    return;
  }
  // revert: 열린 revert PR이 없고 breaker가 멈추지 않았을 때만 여기까지 온다
  try {
    const pr = JSON.parse(await gh(["pr", "view", String(d.pr), "--repo", slug, "--json", "id,url,title,headRefName"])) as { id: string; url: string; title: string; headRefName: string };
    const q = "mutation($id:ID!,$title:String!,$body:String!){revertPullRequest(input:{pullRequestId:$id,title:$title,body:$body,draft:false}){revertPullRequest{number url}}}";
    const out = JSON.parse(
      await gh(["api", "graphql", "-f", `query=${q}`, "-f", `id=${pr.id}`, "-f", `title=${revertTitleOf(d.pr)}`, "-f", `body=${revertBodyOf({ pr: d.pr, prUrl: pr.url, commit: d.commit, head, check: d.check, by: d.by })}`]),
    ) as { data?: { revertPullRequest?: { revertPullRequest?: { number: number; url: string } } } };
    const made = out.data?.revertPullRequest?.revertPullRequest;
    if (!made) throw new Error("GitHub이 revert PR을 돌려주지 않음");
    appendAutoRevertLine({ op: "revert-opened", airport: code, head, commit: d.commit, pr: d.pr, by: d.by, revertPr: made.number, check: d.check });
    fixOf(s, code, repo, d.pr, pr.url, pr.title, pr.headRefName, d.check, head, made.number);
  } catch (e) {
    appendAutoRevertLine({ op: "revert-failed", airport: code, head, commit: d.commit, pr: d.pr, check: d.check, detail: errText(e).slice(0, 300) });
  }
}

// 되돌린 PR의 FLIGHT를 맡은 AIRCRAFT에게 FIX(relay → TOWER가 CLEARANCE로 보낸다). 담당을 못 찾으면 줄만 남겨 DUTY가 본다
function fixOf(s: Snapshot, code: string, _repo: string, pr: number, prUrl: string, title: string, branch: string, check: string, head: string, revertPr: number) {
  const m = /\b([A-Za-z][A-Za-z0-9]*-\d+)\b/.exec(title) ?? /\b([A-Za-z][A-Za-z0-9]*-\d+)\b/.exec(branch);
  const flight = m ? m[1].toUpperCase() : null;
  const to = flight ? lastAircraftOf(flight, lastAircraftSources()) : null;
  const known = to ? new Set([...Object.keys(loadFleet().aircraft), ...s.sessions.map((x) => x.name)].map((n) => n.toUpperCase())).has(to.toUpperCase()) : false;
  if (!flight || !to || !known) {
    appendAutoRevertLine({ op: "fix", airport: code, head, pr, revertPr, detail: `no holder found${flight ? ` for ${flight}` : " (no FLIGHT key)"}; DUTY to move the issue back` });
    return;
  }
  const input = relayInputOf({ to, kind: "instruction", type: "FIX", pr, flight, text: fixTextOf({ pr, prUrl, flight, check, head, revertPr }) });
  if ("error" in input) {
    appendAutoRevertLine({ op: "fix", airport: code, head, pr, revertPr, detail: `FIX not created: ${input.error}` });
    return;
  }
  const at = new Date().toISOString();
  const id = nextRelayId(readRelayOps());
  appendRelayOp({ op: "create", id, at, ...input });
  record({ t: at, kind: "relay", op: "create", id, by: "auto-revert", to: input.to, relayKind: input.kind, flight: input.flight });
  appendAutoRevertLine({ op: "fix", airport: code, head, pr, revertPr, detail: `FIX relay ${id} to ${to} (${flight})` });
}

// 설정 창이 보일 한 줄: breaker가 멈춘 AIRPORT
export const stoppedAirports = (lines = readAutoRevertLines()) => [...new Set(lines.flatMap((l) => (l.op === "stop" && l.airport ? [l.airport] : [])))].flatMap((a) => (stoppedOf(lines, a) ? [stoppedOf(lines, a) as AutoRevertLine] : []));

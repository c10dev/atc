import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type MainStatus, mainStateOf, workflowNamesOf } from "../atfm.ts";
import { loadAutoland } from "../autoland.ts";
import { type CarryCandidate, type CodexSignal, codexFindings, codexThumbsPass, firstReach, fixesKeyOf, reachTargetsOf, mergeOnlyChain, sameChange, type GhPull, type GhThread, hasHeadReview, isCodexBot, type MergedElsewhere, needsCodexSignal } from "../landing.ts";
import type { GhCommit } from "../briefs.ts";
import { humanCheckStatusOf, uiChangeOf } from "../human-check.ts";
import { ticketKeyFromBranch, ticketKeyFromTitle } from "./git.ts";
import { assertGithubOn, githubSwitch } from "../github-switch.ts";

const run = promisify(execFile);

const POLL_MS = 90_000;
const FIELDS = [
  "number", "title", "url", "headRefName", "headRefOid", "baseRefName", "isDraft", "mergeStateStatus",
  "reviewDecision", "statusCheckRollup", "reviews", "author", "createdAt", "reactionGroups", "labels", "body",
].join(",");

export interface GithubState {
  enabled: boolean;
  // enabled가 false인 까닭(ATC_GITHUB=off 등). 오류가 아니다(ATC-161)
  reason: string | null;
  error: string | null;
  fetchedAt: string | null;
  // AIRPORT 본 체크아웃 경로별 마지막 결과. 실패한 저장소는 이전 결과를 그대로 둔다.
  byRepo: Map<string, GhPull[]>;
  // 기본 브랜치 head의 CI(ATFM "main 깨짐"). 실패한 저장소는 이전 결과를 그대로 둔다.
  mainByRepo: Map<string, MainStatus>;
  // 저장소의 기본 브랜치(쌓인 PR 판단, ATC-29)
  defaultByRepo: Map<string, string>;
  // 기본 브랜치가 아닌 곳으로 최근 머지된 PR과 그 커밋이 닿은 곳(STRANDED 판단, ATC-29). 실패한 저장소는 이전 결과를 둔다
  mergedElsewhereByRepo: Map<string, MergedElsewhere[]>;
}

const state: GithubState = { ...githubSwitch(), error: null, fetchedAt: null, byRepo: new Map(), mainByRepo: new Map(), defaultByRepo: new Map(), mergedElsewhereByRepo: new Map() };
let lastFetch = 0;
let inflight: Promise<void> | null = null;
let known = new Set<string>();
// 저장소별로 main에서 늘 도는 체크 이름(MCC AIRPORT의 ciCheck). 없는 저장소는 지금 그대로 본다(ATC-121)
let expectedChecks = new Map<string, string>();

// git remote URL → "owner/name". GitHub가 아니면 null.
export function githubSlug(url: string): string | null {
  const m = url.trim().match(/^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com(?::\d+)?\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

// origin을 먼저, 없으면 GitHub를 가리키는 첫 remote
export async function slugOf(repo: string): Promise<string | null> {
  const { stdout } = await run("git", ["-C", repo, "remote", "-v"], { timeout: 10_000 });
  const lines = stdout.split("\n").filter((l) => l.endsWith("(fetch)"));
  const sorted = [...lines.filter((l) => l.startsWith("origin\t")), ...lines];
  for (const l of sorted) {
    const slug = githubSlug(l.split("\t")[1]?.replace(/\s+\(fetch\)$/, "") ?? "");
    if (slug) return slug;
  }
  return null;
}

async function listPulls(slug: string): Promise<GhPull[]> {
  assertGithubOn();
  const { stdout } = await run(
    "gh",
    ["pr", "list", "--repo", slug, "--state", "open", "--limit", "100", "--json", FIELDS],
    { timeout: 30_000, maxBuffer: 32 << 20 },
  );
  return JSON.parse(stdout) as GhPull[];
}

const gh = async (args: string[]) => {
  assertGithubOn();
  return (await run("gh", args, { timeout: 30_000, maxBuffer: 16 << 20 })).stdout;
};
// --paginate + --jq @tsv: 쪽마다 한 줄씩 [로그인, 시각, …]
const tsv = (out: string) => out.split("\n").filter(Boolean).map((l) => l.split("\t"));

// 커밋 시각은 바뀌지 않으니 sha별로 계속 둔다. 이번 목록에 없는 sha는 지운다.
const headDates = new Map<string, string>();
// head에서 통과하는 Codex 👍를 이미 확인한 PR(키: 저장소#번호@sha)은 다시 읽지 않는다.
// 같은 head에 그 뒤 Codex 지적이 새로 달리면 캐시가 통과하지 않으니 다시 읽는다.
const thumbsOk = new Map<string, CodexSignal>();
// head에 Codex 리뷰가 없는 PR의 바뀐 파일 경로(키: 저장소#번호@sha). 외부 리뷰 제외(보안 경로) 판단에 쓴다(ATC-7·27)
const filesByHead = new Map<string, { path: string; status: string }[]>();

// 캐시 없이 읽은 바뀐 파일과 상태(added·modified·removed·renamed). AUTOLAND가 머지 직전에 마이그레이션 게이트를 다시 볼 때도 쓴다(GET만)
export async function listPullFiles(slug: string, number: number): Promise<{ path: string; status: string }[]> {
  return tsv(await gh(["api", "--paginate", `repos/${slug}/pulls/${number}/files?per_page=100`, "--jq", ".[] | [.filename, .status] | @tsv"])).map(([path, status]) => ({ path, status }));
}

async function filesWithStatusOf(slug: string, pr: GhPull) {
  const key = `${slug}#${pr.number}@${pr.headRefOid}`;
  let files = filesByHead.get(key);
  if (!files) {
    files = await listPullFiles(slug, pr.number);
    filesByHead.set(key, files);
  }
  return files;
}

const filesOf = async (slug: string, pr: GhPull): Promise<string[]> => (await filesWithStatusOf(slug, pr)).map((f) => f.path);

// head 리뷰가 없거나 head에 Codex 지적이 있는 PR의 Codex 신호: head committer 시각, Codex 👍 시각, Codex 마지막 댓글(한도 안내인지)
async function codexSignal(slug: string, pr: GhPull): Promise<CodexSignal> {
  const key = `${slug}#${pr.number}@${pr.headRefOid}`;
  const cached = thumbsOk.get(key);
  if (cached && codexThumbsPass(pr, cached)) return cached;
  let headAt = headDates.get(pr.headRefOid) ?? null;
  if (!headAt) {
    headAt = (await gh(["api", `repos/${slug}/commits/${pr.headRefOid}`, "--jq", ".commit.committer.date"])).trim() || null;
    if (headAt) headDates.set(pr.headRefOid, headAt);
  }
  let thumbsAt: string | null = null;
  if ((pr.reactionGroups ?? []).some((g) => g.content === "THUMBS_UP" && g.users.totalCount > 0)) {
    const rows = tsv(await gh(["api", "--paginate", `repos/${slug}/issues/${pr.number}/reactions?per_page=100`, "--jq", '.[] | select(.content == "+1") | [.user.login, .created_at] | @tsv']));
    thumbsAt = rows.filter(([login]) => isCodexBot(login)).map(([, at]) => at).sort().at(-1) ?? null;
  }
  const signal: CodexSignal = { headAt, thumbsAt, lastComment: null };
  if (codexThumbsPass(pr, signal)) {
    thumbsOk.set(key, signal);
    return signal;
  }
  const rows = tsv(await gh(["api", "--paginate", `repos/${slug}/issues/${pr.number}/comments?per_page=100`, "--jq", '.[] | [.user.login, .created_at, (.body | test("usage limits?"; "i"))] | @tsv']));
  const last = rows.filter(([login]) => isCodexBot(login)).sort((a, b) => a[1].localeCompare(b[1])).at(-1);
  signal.lastComment = last ? { at: last[1], limit: last[2] === "true" } : null;
  return signal;
}

// 리뷰 스레드(해결 여부, 댓글 작성자·원래 커밋·본문). Codex 지적의 등급(P0~P3)과 "스레드 해결 필수"로 막힌 까닭을 본다(ATC-28).
// 해결 여부는 수시로 바뀌므로 캐시하지 않는다(대상 PR만, 90초마다)
const THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviewThreads(first: 100) { nodes {
    isResolved isOutdated path
    comments(first: 20) { nodes { author { login } createdAt originalCommit { oid } body } }
  } } } }
}`;
export async function threadsOf(slug: string, number: number): Promise<GhThread[]> {
  const [owner, name] = slug.split("/");
  const out = await gh(["api", "graphql", "-f", `query=${THREADS_QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `number=${number}`]);
  type Node = { isResolved: boolean; isOutdated: boolean; path: string | null; comments: { nodes: { author: { login: string } | null; createdAt: string; originalCommit: { oid: string } | null; body: string }[] } };
  const nodes = (JSON.parse(out).data?.repository?.pullRequest?.reviewThreads?.nodes ?? []) as Node[];
  return nodes.map((t) => ({
    resolved: t.isResolved,
    outdated: t.isOutdated,
    path: t.path,
    // 본문은 등급 배지만 보면 되니 앞부분만 둔다
    comments: t.comments.nodes.map((c) => ({ author: c.author?.login ?? null, at: c.createdAt, commit: c.originalCommit?.oid ?? null, body: c.body.slice(0, 600) })),
  }));
}

// Draft가 아니고 head 리뷰가 없거나 head에 Codex 지적이 있는 PR에만 Codex 신호를 붙인다.
// 실패한 PR은 신호 없이(리뷰 없음·Codex 지적으로) 둔다.
async function attachCodex(slug: string, pulls: GhPull[], errors: string[], mainSha: string | null = null) {
  const need = pulls.filter((p) => !p.isDraft && needsCodexSignal(p));
  for (let i = 0; i < need.length; i += 4) {
    await Promise.all(
      need.slice(i, i + 4).map(async (p) => {
        try {
          p.codex = await codexSignal(slug, p);
          // Codex 리뷰도 사람 리뷰도 head에 없으면 착륙 리뷰로 갈 수 있다: 바뀐 파일을 읽어 둔다
          if (!hasHeadReview(p) && !codexFindings(p) && !codexThumbsPass(p)) {
            p.files = await filesOf(slug, p);
            // main 병합만 한 head면 이전 커밋의 리뷰를 이을 수 있다(ATC-31)
            if (mainSha) p.carryFrom = await carryCandidates(slug, p, mainSha);
          }
          if (codexFindings(p)) p.threads = await threadsOf(slug, p.number);
        } catch (e) {
          const err = e as Error & { stderr?: string };
          errors.push(`${slug}#${p.number} Codex 확인: ${(err.stderr?.trim() || err.message).split("\n")[0]}`);
        }
      }),
    );
  }
}

// HUMAN CHECK(ATC-37): class PR인데 기록한 SHA가 head가 아니면, main 병합만 한 이전 커밋을 읽어 그 기록을 이을 수 있나 본다
async function attachHumanCarry(slug: string, pulls: GhPull[], errors: string[], mainSha: string | null) {
  if (!mainSha) return;
  const need = pulls.filter((p) => !p.isDraft && humanCheckStatusOf(uiChangeOf(p.body), p.headRefOid)?.state === "stale");
  for (const p of need) {
    try {
      p.humanCarryFrom = (p.carryFrom ?? (await carryCandidates(slug, p, mainSha))).map((c) => c.sha);
    } catch (e) {
      const err = e as Error & { stderr?: string };
      errors.push(`${slug}#${p.number} HUMAN CHECK 잇기: ${(err.stderr?.trim() || err.message).split("\n")[0]}`);
    }
  }
}

// BLOCKED인 PR(Draft 아님) 중 아직 스레드를 안 읽은 것: 해결 안 된 스레드 수로 막힌 까닭을 보인다
async function attachThreads(slug: string, pulls: GhPull[], errors: string[]) {
  const need = pulls.filter((p) => !p.isDraft && !p.threads && p.mergeStateStatus === "BLOCKED");
  for (let i = 0; i < need.length; i += 4) {
    await Promise.all(
      need.slice(i, i + 4).map(async (p) => {
        try {
          p.threads = await threadsOf(slug, p.number);
        } catch (e) {
          const err = e as Error & { stderr?: string };
          errors.push(`${slug}#${p.number} 리뷰 스레드: ${(err.stderr?.trim() || err.message).split("\n")[0]}`);
        }
      }),
    );
  }
}

// Draft·충돌이 아닌 PR 중 아직 파일을 안 읽은 것(head별 캐시)
async function attachFiles(slug: string, pulls: GhPull[], errors: string[]) {
  const need = pulls.filter((p) => !p.isDraft && !p.files && p.mergeStateStatus !== "DIRTY");
  for (let i = 0; i < need.length; i += 4) {
    await Promise.all(
      need.slice(i, i + 4).map(async (p) => {
        try {
          p.files = await filesOf(slug, p);
        } catch (e) {
          const err = e as Error & { stderr?: string };
          errors.push(`${slug}#${p.number} 바뀐 파일: ${(err.stderr?.trim() || err.message).split("\n")[0]}`);
        }
      }),
    );
  }
}

// 파일 겹침(ATC-71)·DIRTY 기록: 열린 PR 모두의 바뀐 파일(head별 캐시라 새 head마다 gh 한 번). files와 따로 둬 다른 판단을 바꾸지 않는다
async function attachChanged(slug: string, pulls: GhPull[], errors: string[]) {
  for (let i = 0; i < pulls.length; i += 4) {
    await Promise.all(
      pulls.slice(i, i + 4).map(async (p) => {
        try {
          const rows = await filesWithStatusOf(slug, p);
          p.changed = rows.map((f) => f.path);
          p.added = rows.filter((f) => f.status === "added").map((f) => f.path);
        } catch (e) {
          const err = e as Error & { stderr?: string };
          errors.push(`${slug}#${p.number} 겹침용 파일: ${(err.stderr?.trim() || err.message).split("\n")[0]}`);
        }
      }),
    );
  }
}

async function fetchAll(repos: string[]) {
  const errors: string[] = [];
  let ok = 0;
  await Promise.all(
    repos.map(async (repo) => {
      let slug: string | null = null;
      try {
        slug = await slugOf(repo);
        if (!slug) {
          state.byRepo.delete(repo); // GitHub remote 없는 AIRPORT
          ok++;
          return;
        }
        const pulls = await listPulls(slug);
        const base = await defaultBranchOf(slug);
        state.defaultByRepo.set(repo, base);
        // 기본 브랜치 head(리뷰 이어받기의 main 병합 확인·비교 기준, ATC-31)
        const mainSha = (await gh(["api", `repos/${slug}/commits/${base}`, "--jq", ".sha"]).catch(() => "")).trim() || null;
        await attachCodex(slug, pulls, errors, mainSha);
        await attachThreads(slug, pulls, errors);
        await attachHumanCarry(slug, pulls, errors, mainSha);
        // AUTOLAND merge 모드(ATC-34): 머지 후보의 바뀐 파일로 보안 게이트를 본다(못 읽으면 머지하지 않는다)
        if (loadAutoland().mode === "merge") await attachFiles(slug, pulls, errors);
        await attachChanged(slug, pulls, errors);
        state.byRepo.set(repo, pulls);
        ok++;
        try {
          state.mainByRepo.set(repo, await readMain(repo, slug, mainSha, expectedChecks.get(repo) ?? null));
        } catch (e) {
          const err = e as { stderr?: string; message?: string };
          errors.push(`${slug} main CI: ${(err.stderr?.trim() || err.message || String(e)).split("\n")[0]}`);
        }
        try {
          state.mergedElsewhereByRepo.set(repo, await mergedElsewhere(repo, slug, base, pulls, state.mainByRepo.get(repo)?.sha ?? null, errors));
        } catch (e) {
          const err = e as { stderr?: string; message?: string };
          errors.push(`${slug} 쌓인 머지: ${(err.stderr?.trim() || err.message || String(e)).split("\n")[0]}`);
        }
      } catch (e) {
        const err = e as NodeJS.ErrnoException & { stderr?: string };
        if (err.code === "ENOENT" && err.path === "gh") {
          state.enabled = false;
          state.reason = "gh CLI가 없음";
          errors.push("gh CLI가 없음");
          return;
        }
        const msg = (err.stderr?.trim() || err.message || String(e)).split("\n")[0];
        errors.push(`${slug ?? repo}: ${msg}`);
      }
    }),
  );
  for (const repo of state.byRepo.keys()) if (!repos.includes(repo)) state.byRepo.delete(repo);
  for (const repo of state.mainByRepo.keys()) if (!repos.includes(repo)) state.mainByRepo.delete(repo);
  for (const repo of state.defaultByRepo.keys()) if (!repos.includes(repo)) state.defaultByRepo.delete(repo);
  for (const repo of state.mergedElsewhereByRepo.keys()) if (!repos.includes(repo)) state.mergedElsewhereByRepo.delete(repo);
  const heads = new Set([...state.byRepo.values()].flat().map((p) => p.headRefOid));
  for (const sha of headDates.keys()) if (!heads.has(sha)) headDates.delete(sha);
  for (const key of thumbsOk.keys()) if (!heads.has(key.split("@")[1])) thumbsOk.delete(key);
  for (const key of filesByHead.keys()) if (!heads.has(key.split("@")[1])) filesByHead.delete(key);
  // 한 저장소라도 읽었으면 fetchedAt을 넘긴다(landing 이벤트 비교 기준). 오류는 저장소별로 모아 둔다.
  if (ok || !repos.length) state.fetchedAt = new Date().toISOString();
  state.error = errors.length ? [...new Set(errors)].join(" · ") : null;
}

// ── STRANDED(ATC-29): 기본 브랜치가 아닌 곳으로 머지된 PR의 커밋이 기본 브랜치나 그리로 가는 열린 PR에 닿았나 ──
const STRANDED_WINDOW_MS = 14 * 86_400_000;
const ELSEWHERE_FIELDS = "number,title,url,headRefName,headRefOid,baseRefName,mergedAt,mergeCommit,body";
// "target|commit" → commit이 target의 조상(또는 같음)인가. 둘 다 SHA면 결과가 바뀌지 않아 계속 둔다
const containsCache = new Map<string, boolean>();
const isSha = (x: string) => /^[0-9a-f]{40}$/.test(x);
async function contains(slug: string, target: string, commit: string): Promise<boolean> {
  const key = `${slug}|${target}|${commit}`;
  const hit = containsCache.get(key);
  if (hit !== undefined) return hit;
  const status = (await gh(["api", `repos/${slug}/compare/${target}...${commit}`, "--jq", ".status"])).trim();
  const ok = status === "behind" || status === "identical";
  if (isSha(target)) {
    if (containsCache.size > 5000) containsCache.clear();
    containsCache.set(key, ok);
  }
  return ok;
}
async function mergedElsewhere(repo: string, slug: string, base: string, open: GhPull[], mainSha: string | null, errors: string[]): Promise<MergedElsewhere[]> {
  type Row = { number: number; title: string; url: string; headRefName: string; headRefOid: string; baseRefName: string; mergedAt: string | null; mergeCommit: { oid: string } | null; body: string };
  const rows = JSON.parse(await gh(["pr", "list", "--repo", slug, "--state", "merged", "--limit", "60", "--json", ELSEWHERE_FIELDS])) as Row[];
  const now = Date.now();
  const cands = rows.filter((r) => r.baseRefName !== base && r.mergedAt && now - Date.parse(r.mergedAt) < STRANDED_WINDOW_MS);
  // 닿을 수 있는 곳: 기본 브랜치, 기본 브랜치로 가는 열린 PR의 head, 그리고 이 PR 뒤에 기본 브랜치로 머지된 PR의 head(같은 목록에서 이미 읽었다, ATC-216).
  // 이 PR의 base 브랜치를 head로 가진 PR을 먼저 본다(reachTargetsOf)
  const intoBase = open.filter((p) => p.baseRefName === base);
  const mergedIntoBase = rows.filter((r) => r.baseRefName === base);
  const out: MergedElsewhere[] = [];
  for (const r of cands) {
    const flight = ticketKeyFromBranch(r.headRefName) ?? ticketKeyFromTitle(r.title) ?? fixesKeyOf(r.body);
    const row: MergedElsewhere = { repo, number: r.number, title: r.title, url: r.url, base: r.baseRefName, mergedAt: r.mergedAt!, mergeCommit: r.mergeCommit?.oid ?? null, head: r.headRefOid, flight, reached: null };
    if (!flight) {
      out.push(row); // FLIGHT가 없으면 경보 대상이 아니다(닿았는지 보지 않는다)
      continue;
    }
    const targets = reachTargetsOf({ base, mainSha, open: intoBase, merged: mergedIntoBase, prBaseRef: r.baseRefName, prMergedAt: r.mergedAt!, selfNumber: r.number });
    const commits = [row.mergeCommit, row.head].filter((c): c is string => Boolean(c));
    try {
      row.reached = await firstReach(commits, targets, (target, commit) => contains(slug, target, commit));
      out.push(row);
    } catch (e) {
      // 확인하지 못하면 경보를 내지 않는다(모름을 STRANDED로 보지 않는다)
      const err = e as { stderr?: string; message?: string };
      errors.push(`${slug}#${r.number} STRANDED 확인: ${(err.stderr?.trim() || err.message || String(e)).split("\n")[0]}`);
    }
  }
  return out;
}

// ── 리뷰 이어받기(ATC-31): head에서 거꾸로, main 병합(둘째 부모가 기본 브랜치에 있음)만 이어진 동안의 이전 커밋 R 중
// PR 자신의 변경(merge-base 대비 바뀐 파일과 blob)이 head와 같은 것. 읽기 전용 GitHub API(PR 커밋 목록, compare)
const commitsByHead = new Map<string, { sha: string; parents: string[]; at: string | null }[]>();
async function prCommits(slug: string, pr: GhPull) {
  const key = `${slug}#${pr.number}@${pr.headRefOid}`;
  let list = commitsByHead.get(key);
  if (!list) {
    list = tsv(await gh(["api", "--paginate", `repos/${slug}/pulls/${pr.number}/commits?per_page=100`, "--jq", '.[] | [.sha, (.parents | map(.sha) | join(",")), (.commit.committer.date // "")] | @tsv'])).map(([sha, parents, at]) => ({ sha, parents: parents ? parents.split(",") : [], at: at || null }));
    if (commitsByHead.size > 500) commitsByHead.clear();
    commitsByHead.set(key, list);
  }
  return list;
}
// merge-base(main, sha)..sha의 바뀐 파일 → "상태:blob". 300개(한도)면 null(다 못 봤으니 잇지 않는다). main SHA와 커밋이 고정이라 캐시한다
const changeCache = new Map<string, Map<string, string> | null>();
async function changeOf(slug: string, mainSha: string, sha: string): Promise<Map<string, string> | null> {
  const key = `${slug}|${mainSha}|${sha}`;
  if (changeCache.has(key)) return changeCache.get(key)!;
  const rows = tsv(await gh(["api", `repos/${slug}/compare/${mainSha}...${sha}`, "--jq", '.files[] | [.filename, .status, (.sha // "")] | @tsv']));
  const out = rows.length >= 300 ? null : new Map(rows.map(([f, st, blob]) => [f, `${st}:${blob}`]));
  if (changeCache.size > 2000) changeCache.clear();
  changeCache.set(key, out);
  return out;
}
async function carryCandidates(slug: string, pr: GhPull, mainSha: string): Promise<CarryCandidate[]> {
  const chain = await mergeOnlyChain(await prCommits(slug, pr), pr.headRefOid, (sha) => contains(slug, mainSha, sha));
  if (!chain.length) return [];
  const head = await changeOf(slug, mainSha, pr.headRefOid);
  const out: CarryCandidate[] = [];
  for (const r of chain) if (sameChange(await changeOf(slug, mainSha, r.sha), head)) out.push(r);
  return out;
}

// LOGBOOK용: 기본 브랜치에 머지된 최근 PR. 열린 PR 읽기와 따로, 필요한 필드만 가볍게 읽는다.
export interface GhMerged {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  createdAt: string;
  mergedAt: string;
  body: string;
  reviews?: GhPull["reviews"]; // 목록에는 없다. mergedDetails로 필요한 PR만 채운다(ATC-160)
  commits?: GhCommit[]; // PR 뒤 수정 커밋을 셀 때(ATC-32). 위와 같다
}

const MERGED_FIELDS = "number,title,url,headRefName,baseRefName,createdAt,mergedAt,body" // reviews·commits는 GraphQL 점수를 많이 써서 목록에서 뺀다(ATC-160);
const defaultBranches = new Map<string, string>();

async function defaultBranchOf(slug: string): Promise<string> {
  let base = defaultBranches.get(slug);
  if (!base) {
    base = (await gh(["repo", "view", slug, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"])).trim() || "main";
    defaultBranches.set(slug, base);
  }
  return base;
}

// 기본 브랜치 head의 check-runs와 commit status(읽기 전용 gh api). head SHA를 먼저 정하고(이미 읽은 mainSha가 있으면 그것, 없으면 한 번 더)
// 그 SHA로 check-runs와 status를 읽는다 — 브랜치 이름으로 읽으면 두 호출 사이에 head가 바뀌어 서로 다른 커밋의 상태가 섞인다(ATC-121)
async function readMain(repo: string, slug: string, knownSha: string | null, expectCheck: string | null): Promise<MainStatus> {
  const branch = await defaultBranchOf(slug);
  const sha = knownSha ?? (await gh(["api", `repos/${slug}/commits/${branch}`, "--jq", ".sha"])).trim();
  if (!sha) throw new Error("기본 브랜치 head를 모름");
  const runs = tsv(await gh(["api", `repos/${slug}/commits/${sha}/check-runs?per_page=100`, "--jq", '.check_runs[] | [.name, .status, (.conclusion // ""), (.check_suite.id // "")] | @tsv']))
    .map(([name, status, conclusion, suite]) => ({ name, status, conclusion: conclusion || null, suite: suite ? Number(suite) : null }));
  const combined = JSON.parse(await gh(["api", `repos/${slug}/commits/${sha}/status`, "--jq", "{statuses: [.statuses[] | {context, state}]}"])) as { statuses: { context: string; state: string }[] };
  const suites = await readWorkflows(slug, sha, runs.flatMap((r) => (r.suite == null ? [] : [r.suite])));
  return { repo, slug, branch, sha, ...mainStateOf(runs, combined.statuses, expectCheck), ...workflowNamesOf(runs, combined.statuses, suites), at: new Date().toISOString() };
}

// check suite → 워크플로 이름(ATC-330, 읽기 전용 gh api). 저장소마다 최신 main head의 것만 둔다. 새 head면 Actions runs를 한 번 읽고,
// 같은 head에 아직 모르는 suite가 나타났을 때(늦게 뜬 워크플로)만 다시 읽는다 — 매 폴링마다 부르지 않는다. 실패하면 5분 동안 다시 부르지 않고 null(모름)
const WORKFLOW_RETRY_MS = 5 * 60_000;
const workflowCache = new Map<string, { sha: string; suites: Map<number, string | null>; failedAt: number }>();
async function readWorkflows(slug: string, sha: string, suiteIds: number[]): Promise<ReadonlyMap<number, string | null> | null> {
  let c = workflowCache.get(slug);
  if (!c || c.sha !== sha) {
    c = { sha, suites: new Map(), failedAt: 0 };
    workflowCache.set(slug, c);
  }
  if (suiteIds.some((id) => !c.suites.has(id))) {
    if (Date.now() - c.failedAt < WORKFLOW_RETRY_MS) return null;
    try {
      const byId = new Map(tsv(await gh(["api", `repos/${slug}/actions/runs?head_sha=${sha}&per_page=100`, "--jq", ".workflow_runs[] | [.check_suite_id, .name] | @tsv"])).map(([id, name]) => [Number(id), name] as const));
      for (const id of suiteIds) c.suites.set(id, byId.get(id) ?? null);
    } catch {
      c.failedAt = Date.now();
      return null;
    }
  }
  return c.suites;
}

export async function listMerged(repo: string, limit = 30): Promise<{ slug: string; pulls: GhMerged[] } | null> {
  const slug = await slugOf(repo);
  if (!slug) return null;
  const base = await defaultBranchOf(slug);
  const out = await gh(["pr", "list", "--repo", slug, "--state", "merged", "--base", base, "--limit", String(limit), "--json", MERGED_FIELDS]);
  return { slug, pulls: (JSON.parse(out) as GhMerged[]).filter((p) => p.mergedAt) };
}

// LOGBOOK용: 머지된 PR의 리뷰와 커밋(REST, 별도 한도). 머지된 PR은 바뀌지 않아 "owner/repo#N"별로 계속 둔다(ATC-160)
const mergedDetails = new Map<string, { reviews: NonNullable<GhMerged["reviews"]>; commits: GhCommit[] }>();
export async function fetchMergedDetails(slug: string, number: number) {
  const key = `${slug}#${number}`;
  let d = mergedDetails.get(key);
  if (!d) {
    const reviews = tsv(await gh(["api", "--paginate", `repos/${slug}/pulls/${number}/reviews?per_page=100`, "--jq", '.[] | [(.user.login // ""), .state, (.submitted_at // ""), (.commit_id // "")] | @tsv']))
      .map(([login, state, submittedAt, oid]) => ({ author: login ? { login } : null, state, submittedAt: submittedAt || null, commit: oid ? { oid } : null }));
    const commits = tsv(await gh(["api", "--paginate", `repos/${slug}/pulls/${number}/commits?per_page=100`, "--jq", '.[] | [(.commit.author.date // ""), (.commit.message | split("\n")[0])] | @tsv']))
      .map(([authoredDate, messageHeadline]) => ({ authoredDate, messageHeadline: messageHeadline ?? "" }));
    d = { reviews, commits };
    if (mergedDetails.size > 2000) mergedDetails.clear();
    mergedDetails.set(key, d);
  }
  return d;
}

// SCHEDULE CLOSE용: 머지된 PR 본문(읽기 전용). 머지 뒤 본문은 거의 바뀌지 않아 "owner/repo#N"별로 계속 둔다.
const prBodies = new Map<string, string>();
const prBodyInflight = new Map<string, Promise<string | null>>();
export const cachedPrBody = (key: string) => prBodies.get(key);
export function fetchPrBody(key: string): Promise<string | null> {
  if (prBodies.has(key)) return Promise.resolve(prBodies.get(key)!);
  const m = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(key);
  if (!m) return Promise.resolve(null);
  let p = prBodyInflight.get(key);
  if (!p) {
    p = gh(["pr", "view", m[2], "--repo", m[1], "--json", "body", "--jq", ".body"])
      .then((out) => {
        prBodies.set(key, out.replace(/\n$/, ""));
        return prBodies.get(key)!;
      })
      .catch(() => null)
      .finally(() => prBodyInflight.delete(key));
    prBodyInflight.set(key, p);
  }
  return p;
}

// 90초마다 백그라운드로 갱신하고, 호출 시점에는 마지막 결과를 바로 돌려준다(스냅샷을 막지 않는다).
export function readGithub(repos: string[], expected: Map<string, string> = new Map()): GithubState {
  if (!state.enabled) return state;
  expectedChecks = expected;
  const grew = repos.some((r) => !known.has(r));
  known = new Set(repos);
  if (!inflight && (grew || Date.now() - lastFetch > POLL_MS)) {
    lastFetch = Date.now();
    inflight = fetchAll(repos)
      .catch((e) => void (state.error = String((e as Error).message ?? e)))
      .finally(() => (inflight = null));
  }
  return state;
}

// 착륙 리뷰 자료(ATC-7): PR 제목·본문·head·바뀐 파일·라벨과 diff(읽기 전용 gh). REVIEW 세션은 gh를 못 쓰니 atc가 읽어 준다
export interface ReviewSource {
  title: string;
  body: string;
  headRefOid: string;
  files: string[];
  labels: string[];
  diff: string;
}
export async function fetchReviewSource(slug: string, number: number): Promise<ReviewSource> {
  const view = JSON.parse(await gh(["pr", "view", String(number), "--repo", slug, "--json", "title,body,headRefOid,files,labels"])) as {
    title: string;
    body: string;
    headRefOid: string;
    files: { path: string }[] | null;
    labels: { name: string }[] | null;
  };
  const diff = await gh(["pr", "diff", String(number), "--repo", slug]);
  return { title: view.title, body: view.body ?? "", headRefOid: view.headRefOid, files: (view.files ?? []).map((f) => f.path), labels: (view.labels ?? []).map((l) => l.name), diff };
}

// PR drawer(DUTY G1): 열 때 한 번 읽는 PR 한 건(읽기 전용 gh pr view, 호출은 detail-run.ts가 60초 캐시)
export async function fetchPrView(slug: string, number: number): Promise<unknown> {
  const fields = "number,title,url,state,isDraft,headRefName,headRefOid,baseRefName,author,createdAt,labels,body,reviewDecision,mergeStateStatus,statusCheckRollup,files,isCrossRepository";
  return JSON.parse(await gh(["pr", "view", String(number), "--repo", slug, "--json", fields]));
}

// IDEAS 서랍(DUTY G4): atc 저장소의 열린 idea 이슈. 읽기 전용 gh issue list·view. 저장소는 호출하는 쪽(ideas-run.ts)이 고정한다
export async function fetchIdeaList(slug: string, label: string): Promise<unknown> {
  return JSON.parse(await gh(["issue", "list", "--repo", slug, "--label", label, "--state", "open", "--limit", "100", "--json", "number,title,labels,updatedAt,comments,body"]));
}
export async function fetchIdeaView(slug: string, number: number): Promise<unknown> {
  return JSON.parse(await gh(["issue", "view", String(number), "--repo", slug, "--json", "number,title,url,state,labels,author,createdAt,updatedAt,body,comments"]));
}

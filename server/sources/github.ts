import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type MainStatus, mainStateOf } from "../atfm.ts";
import { type CodexSignal, codexFindings, codexThumbsPass, type GhPull, hasHeadReview, isCodexBot, needsCodexSignal } from "../landing.ts";

const run = promisify(execFile);

const POLL_MS = 90_000;
const FIELDS = [
  "number", "title", "url", "headRefName", "headRefOid", "baseRefName", "isDraft", "mergeStateStatus",
  "reviewDecision", "statusCheckRollup", "reviews", "author", "createdAt", "reactionGroups", "labels", "body",
].join(",");

export interface GithubState {
  enabled: boolean;
  error: string | null;
  fetchedAt: string | null;
  // AIRPORT 본 체크아웃 경로별 마지막 결과. 실패한 저장소는 이전 결과를 그대로 둔다.
  byRepo: Map<string, GhPull[]>;
  // 기본 브랜치 head의 CI(ATFM "main 깨짐"). 실패한 저장소는 이전 결과를 그대로 둔다.
  mainByRepo: Map<string, MainStatus>;
}

const state: GithubState = { enabled: true, error: null, fetchedAt: null, byRepo: new Map(), mainByRepo: new Map() };
let lastFetch = 0;
let inflight: Promise<void> | null = null;
let known = new Set<string>();

// git remote URL → "owner/name". GitHub가 아니면 null.
export function githubSlug(url: string): string | null {
  const m = url.trim().match(/^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com(?::\d+)?\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

// origin을 먼저, 없으면 GitHub를 가리키는 첫 remote
async function slugOf(repo: string): Promise<string | null> {
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
  const { stdout } = await run(
    "gh",
    ["pr", "list", "--repo", slug, "--state", "open", "--limit", "100", "--json", FIELDS],
    { timeout: 30_000, maxBuffer: 32 << 20 },
  );
  return JSON.parse(stdout) as GhPull[];
}

const gh = async (args: string[]) => (await run("gh", args, { timeout: 30_000, maxBuffer: 16 << 20 })).stdout;
// --paginate + --jq @tsv: 쪽마다 한 줄씩 [로그인, 시각, …]
const tsv = (out: string) => out.split("\n").filter(Boolean).map((l) => l.split("\t"));

// 커밋 시각은 바뀌지 않으니 sha별로 계속 둔다. 이번 목록에 없는 sha는 지운다.
const headDates = new Map<string, string>();
// head에서 통과하는 Codex 👍를 이미 확인한 PR(키: 저장소#번호@sha)은 다시 읽지 않는다.
// 같은 head에 그 뒤 Codex 지적이 새로 달리면 캐시가 통과하지 않으니 다시 읽는다.
const thumbsOk = new Map<string, CodexSignal>();
// head에 Codex 리뷰가 없는 PR의 바뀐 파일 경로(키: 저장소#번호@sha). 외부 리뷰 제외(보안 경로) 판단에 쓴다(ATC-7·27)
const filesByHead = new Map<string, string[]>();

async function filesOf(slug: string, pr: GhPull): Promise<string[]> {
  const key = `${slug}#${pr.number}@${pr.headRefOid}`;
  let files = filesByHead.get(key);
  if (!files) {
    files = tsv(await gh(["api", "--paginate", `repos/${slug}/pulls/${pr.number}/files?per_page=100`, "--jq", ".[] | [.filename] | @tsv"])).map(([f]) => f);
    filesByHead.set(key, files);
  }
  return files;
}

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

// Draft가 아니고 head 리뷰가 없거나 head에 Codex 지적이 있는 PR에만 Codex 신호를 붙인다.
// 실패한 PR은 신호 없이(리뷰 없음·Codex 지적으로) 둔다.
async function attachCodex(slug: string, pulls: GhPull[], errors: string[]) {
  const need = pulls.filter((p) => !p.isDraft && needsCodexSignal(p));
  for (let i = 0; i < need.length; i += 4) {
    await Promise.all(
      need.slice(i, i + 4).map(async (p) => {
        try {
          p.codex = await codexSignal(slug, p);
          // Codex 리뷰도 사람 리뷰도 head에 없으면 착륙 리뷰로 갈 수 있다: 바뀐 파일을 읽어 둔다
          if (!hasHeadReview(p) && !codexFindings(p) && !codexThumbsPass(p)) p.files = await filesOf(slug, p);
        } catch (e) {
          const err = e as Error & { stderr?: string };
          errors.push(`${slug}#${p.number} Codex 확인: ${(err.stderr?.trim() || err.message).split("\n")[0]}`);
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
        await attachCodex(slug, pulls, errors);
        state.byRepo.set(repo, pulls);
        ok++;
        try {
          state.mainByRepo.set(repo, await readMain(repo, slug));
        } catch (e) {
          const err = e as { stderr?: string; message?: string };
          errors.push(`${slug} main CI: ${(err.stderr?.trim() || err.message || String(e)).split("\n")[0]}`);
        }
      } catch (e) {
        const err = e as NodeJS.ErrnoException & { stderr?: string };
        if (err.code === "ENOENT" && err.path === "gh") {
          state.enabled = false;
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
  const heads = new Set([...state.byRepo.values()].flat().map((p) => p.headRefOid));
  for (const sha of headDates.keys()) if (!heads.has(sha)) headDates.delete(sha);
  for (const key of thumbsOk.keys()) if (!heads.has(key.split("@")[1])) thumbsOk.delete(key);
  for (const key of filesByHead.keys()) if (!heads.has(key.split("@")[1])) filesByHead.delete(key);
  // 한 저장소라도 읽었으면 fetchedAt을 넘긴다(landing 이벤트 비교 기준). 오류는 저장소별로 모아 둔다.
  if (ok || !repos.length) state.fetchedAt = new Date().toISOString();
  state.error = errors.length ? [...new Set(errors)].join(" · ") : null;
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
  reviews: GhPull["reviews"];
}

const MERGED_FIELDS = "number,title,url,headRefName,baseRefName,createdAt,mergedAt,body,reviews";
const defaultBranches = new Map<string, string>();

async function defaultBranchOf(slug: string): Promise<string> {
  let base = defaultBranches.get(slug);
  if (!base) {
    base = (await gh(["repo", "view", slug, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"])).trim() || "main";
    defaultBranches.set(slug, base);
  }
  return base;
}

// 기본 브랜치 head의 check-runs와 commit status(읽기 전용 gh api)
async function readMain(repo: string, slug: string): Promise<MainStatus> {
  const branch = await defaultBranchOf(slug);
  const runs = tsv(await gh(["api", `repos/${slug}/commits/${branch}/check-runs?per_page=100`, "--jq", '.check_runs[] | [.name, .status, (.conclusion // "")] | @tsv']))
    .map(([name, status, conclusion]) => ({ name, status, conclusion: conclusion || null }));
  const combined = JSON.parse(await gh(["api", `repos/${slug}/commits/${branch}/status`, "--jq", "{sha, statuses: [.statuses[] | {context, state}]}"])) as { sha: string | null; statuses: { context: string; state: string }[] };
  return { repo, slug, branch, sha: combined.sha, ...mainStateOf(runs, combined.statuses), at: new Date().toISOString() };
}

// GitHub remote가 없으면 null
export async function listMerged(repo: string, limit = 30): Promise<{ slug: string; pulls: GhMerged[] } | null> {
  const slug = await slugOf(repo);
  if (!slug) return null;
  const base = await defaultBranchOf(slug);
  const out = await gh(["pr", "list", "--repo", slug, "--state", "merged", "--base", base, "--limit", String(limit), "--json", MERGED_FIELDS]);
  return { slug, pulls: (JSON.parse(out) as GhMerged[]).filter((p) => p.mergedAt) };
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
export function readGithub(repos: string[]): GithubState {
  if (!state.enabled) return state;
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

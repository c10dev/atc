import { execFile, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, join, sep } from "node:path";
import { promisify } from "node:util";
import type { Context, Hono } from "hono";
import { config } from "./config.ts";
import {
  checkRequestOf,
  checkValueOf,
  commentOf,
  HumanCheckError,
  imagesOf,
  insideDir,
  pickRunup,
  type RunupReport,
  type RunupView,
  runupViewOf,
  setHumanCheckLine,
  waitsOnHuman,
} from "./human-check.ts";
import { slugOfUrl } from "./landing.ts";
import type { PullRequest, Snapshot } from "./model.ts";
import { fromThisApp } from "./origin.ts";
import { assertGithubOn } from "./github-switch.ts";

// HUMAN CHECK(ATC-37) 입출력: 증거(PR 댓글 이미지, RUN-UP 보고서)를 읽고, SUPERVISOR의 PASS·FAIL을 GitHub에 쓴다.
// GitHub에 쓰는 것은 둘뿐이다: PR 본문 `Human check:` 줄 하나와 PR 댓글 하나. Vercel 공유 토큰은 만들지도 두지도 않는다

const run = promisify(execFile);
const gh = async (args: string[]) => {
  assertGithubOn();
  return (await run("gh", args, { timeout: 30_000, maxBuffer: 16 << 20 })).stdout;
};
// 긴 본문은 인자 대신 stdin(JSON)으로 보낸다
function ghInput(args: string[], input: string): Promise<string> {
  assertGithubOn();
  return new Promise((resolve, reject) => {
    const p = spawn("gh", [...args, "--input", "-"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => p.kill(), 30_000);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(Object.assign(new Error(`gh 실패(${code})`), { stderr: err }));
    });
    p.stdin.end(input);
  });
}
const errText = (e: unknown) => {
  const err = e as { stderr?: string; message?: string };
  return (err.stderr?.trim() || err.message || String(e)).split("\n")[0].slice(0, 300);
};

// 기록(추가만): ~/.local/state/atc/human-checks.jsonl
export const RECORD_FILE = () => join(config.stateDir, "human-checks.jsonl");
export interface HumanCheckRecord {
  at: string;
  slug: string;
  number: number;
  head: string;
  result: "pass" | "fail";
  classes: string[];
  note: string;
  by: string;
  ok: boolean;
  line: boolean; // Human check 줄을 고쳤나
  comment: string | null; // 단 댓글 URL
  error?: string;
}
function appendRecord(r: HumanCheckRecord) {
  mkdirSync(config.stateDir, { recursive: true });
  appendFileSync(RECORD_FILE(), JSON.stringify(r) + "\n");
}
export function readRecords(file = RECORD_FILE()): HumanCheckRecord[] {
  try {
    return readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as HumanCheckRecord);
  } catch {
    return [];
  }
}

// 스냅숏의 열린 PR(slug·번호). 증거·기록은 atc가 아는 PR에만
function pullOf(s: Snapshot, slug: string, number: number): PullRequest | null {
  return s.pulls.find((p) => p.number === number && slugOfUrl(p.url)?.toLowerCase() === slug.toLowerCase()) ?? null;
}

// ── 증거: PR 댓글의 이미지 ──
// private 저장소 이미지는 브라우저 쿠키로 열리지 않으니 GitHub가 서명한 주소(body_html)를 쓴다. 몇 분이면 만료돼 잠깐만 둔다
const IMAGE_TTL_MS = 3 * 60_000;
const imageCache = new Map<string, { at: number; images: string[]; url: string | null; error: string | null }>();
async function evidenceImages(slug: string, number: number, id: number) {
  const key = `${slug}#${id}`;
  const hit = imageCache.get(key);
  if (hit && Date.now() - hit.at < IMAGE_TTL_MS) return hit;
  let v: { at: number; images: string[]; url: string | null; error: string | null };
  try {
    const c = JSON.parse(await gh(["api", `repos/${slug}/issues/comments/${id}`, "-H", "Accept: application/vnd.github.html+json"])) as { body_html?: string; html_url?: string; issue_url?: string };
    // 다른 PR의 댓글은 이 PR의 증거로 보이지 않는다
    if (!c.issue_url?.endsWith(`/issues/${number}`)) v = { at: Date.now(), images: [], url: c.html_url ?? null, error: "Evidence pack 링크가 이 PR의 댓글이 아님" };
    else v = { at: Date.now(), images: imagesOf(c.body_html), url: c.html_url ?? null, error: null };
  } catch (e) {
    v = { at: Date.now(), images: [], url: null, error: `증거 댓글을 읽지 못함: ${errText(e)}` };
  }
  imageCache.set(key, v);
  for (const [k, x] of imageCache) if (Date.now() - x.at > IMAGE_TTL_MS) imageCache.delete(k);
  return v;
}

// ── 증거: RUN-UP 보고서(ATC-41) ──
// 저장소 본 체크아웃과 그 STAND(워크트리)의 `.runup/<base>-<head>/report.json` 중 이 head의 것
interface FoundRunup {
  run: string;
  dir: string;
  mtime: number;
  report: RunupReport;
}
function runupsIn(checkout: string, head: string): FoundRunup[] {
  const root = join(checkout, ".runup");
  const out: FoundRunup[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(root).filter((n) => n.endsWith(`-${head.slice(0, 7)}`));
  } catch {
    return out;
  }
  for (const run of names) {
    try {
      const dir = realpathSync(join(root, run));
      const file = join(dir, "report.json");
      out.push({ run, dir, mtime: statSync(file).mtimeMs, report: JSON.parse(readFileSync(file, "utf8")) as RunupReport });
    } catch {}
  }
  return out;
}
export function runupFor(s: Snapshot, p: PullRequest): FoundRunup | null {
  const checkouts = [p.repo, ...s.workspaces.filter((w) => w.repo === p.repo).map((w) => w.path)];
  return pickRunup([...new Set(checkouts)].flatMap((c) => runupsIn(c, p.head)), p.head);
}

export interface EvidenceView {
  comment: { url: string | null; images: string[]; error: string | null } | null;
  runup: (RunupView & { base: string }) | null; // base: 보고서 파일 주소의 앞부분
}
export async function evidenceOf(s: Snapshot, p: PullRequest): Promise<EvidenceView> {
  const slug = slugOfUrl(p.url)!;
  const ev = p.uiChange?.evidenceComment;
  const comment = ev && ev.slug.toLowerCase() === slug.toLowerCase() && ev.number === p.number ? await evidenceImages(slug, p.number, ev.id) : null;
  const found = runupFor(s, p);
  return {
    comment: comment ? { url: comment.url, images: comment.images, error: comment.error } : ev ? { url: null, images: [], error: "Evidence pack 링크가 이 PR의 댓글이 아님" } : null,
    runup: found ? { ...runupViewOf(found.run, found.report), base: `/api/human-check/${slug}/${p.number}/runup/${encodeURIComponent(found.run)}/` } : null,
  };
}

// RUN-UP 보고서 파일을 atc가 대신 보낸다(원격 SUPERVISOR도 열 수 있게). 보고서 폴더 안의 정해진 형식만,
// 그리고 sandbox로(보고서의 스크립트가 atc 출처로 돌며 SUPERVISOR 전용 API를 부르지 못하게)
const RUNUP_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".css": "text/css",
  ".js": "text/javascript",
};

// ── PASS·FAIL ──
export async function recordHumanCheck(s: Snapshot, slug: string, number: number, input: { result?: unknown; note?: unknown; head?: unknown }, by: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const p = pullOf(s, slug, number);
  if (!p) return { status: 404, body: { error: `열린 PR이 아님: ${slug}#${number}` } };
  // 쓰기 직전에 PR을 다시 읽는다: 화면이 본 head가 지금 head인지, 지금 본문으로 그 줄 하나만 바꾼다
  let fresh: { head: { sha: string }; body: string | null; draft: boolean; state: string };
  try {
    fresh = JSON.parse(await gh(["api", `repos/${slug}/pulls/${number}`, "--jq", "{head: {sha: .head.sha}, body, draft, state}"]));
  } catch (e) {
    return { status: 502, body: { error: `PR을 읽지 못함: ${errText(e)}` } };
  }
  if (fresh.state !== "open") return { status: 409, body: { error: "PR이 열려 있지 않음" } };
  let req: ReturnType<typeof checkRequestOf>;
  let nextBody: string;
  const at = new Date().toISOString();
  const date = at.slice(0, 10);
  try {
    req = checkRequestOf(input, { head: fresh.head.sha, body: fresh.body, draft: fresh.draft });
    nextBody = setHumanCheckLine(fresh.body ?? "", checkValueOf(req.result, date, fresh.head.sha, req.note));
  } catch (e) {
    if (e instanceof HumanCheckError) return { status: e.status, body: { error: e.message } };
    throw e;
  }
  const head = fresh.head.sha;
  const base = { at, slug, number, head, result: req.result, classes: req.ui.classes, note: req.note, by };
  // 1) Human check 줄. 실패하면 댓글도 달지 않는다
  try {
    await ghInput(["api", "-X", "PATCH", `repos/${slug}/pulls/${number}`], JSON.stringify({ body: nextBody }));
  } catch (e) {
    const error = `Human check 줄을 쓰지 못함: ${errText(e)}`;
    appendRecord({ ...base, ok: false, line: false, comment: null, error });
    return { status: 502, body: { error } };
  }
  // 2) 댓글 하나
  let comment: string | null = null;
  try {
    comment = (await ghInput(["api", "-X", "POST", `repos/${slug}/issues/${number}/comments`, "--jq", ".html_url"], JSON.stringify({ body: commentOf(req.result, head, req.ui.classes, req.note, date) }))).trim() || null;
  } catch (e) {
    const error = `줄은 썼지만 댓글을 달지 못함: ${errText(e)}`;
    appendRecord({ ...base, ok: false, line: true, comment: null, error });
    return { status: 502, body: { error, line: true } };
  }
  appendRecord({ ...base, ok: true, line: true, comment });
  console.log(`[atc] human check: ${slug}#${number}@${head.slice(0, 7)} ${req.result} by ${by}`);
  return { status: 200, body: { ok: true, result: req.result, head, comment } };
}

export function mountHumanCheck(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  // 대기열: class PR 중 이 head에 done이 아닌 것. 줄의 나머지(FLIGHT, 팀, class, Preview, 단계)는 스냅숏에 있다
  app.get("/api/human-check", async (c) => {
    const s = await getSnapshot();
    const queue = s.pulls.filter((p) => !p.draft && waitsOnHuman(p.humanCheck));
    return c.json({ queue: queue.map((p) => ({ repo: p.repo, number: p.number, url: p.url, head: p.head, ticketKey: p.ticketKey, humanCheck: p.humanCheck, uiChange: p.uiChange })), records: readRecords().slice(-50) });
  });
  app.get("/api/human-check/:owner/:name/:number/evidence", async (c) => {
    const s = await getSnapshot();
    const p = pullOf(s, `${c.req.param("owner")}/${c.req.param("name")}`, Number(c.req.param("number")));
    if (!p || !p.uiChange) return c.json({ error: "HUMAN CHECK 대상 PR이 아님" }, 404);
    return c.json(await evidenceOf(s, p));
  });
  app.get("/api/human-check/:owner/:name/:number/runup/:run/*", async (c) => {
    const s = await getSnapshot();
    const p = pullOf(s, `${c.req.param("owner")}/${c.req.param("name")}`, Number(c.req.param("number")));
    const found = p ? runupFor(s, p) : null;
    if (!found || found.run !== c.req.param("run")) return c.text("보고서 없음", 404);
    const path = decodeURIComponent(new URL(c.req.url).pathname);
    const marker = `/runup/${found.run}/`;
    const rel = path.slice(path.indexOf(marker) + marker.length) || "index.html";
    const file = insideDir(found.dir, rel);
    const type = file ? RUNUP_TYPES[extname(file).toLowerCase()] : undefined;
    if (!file || !type) return c.text("없음", 404);
    let real: string;
    try {
      real = realpathSync(file);
    } catch {
      return c.text("없음", 404);
    }
    // 링크로 보고서 폴더 밖을 가리키면 거절
    if (!real.startsWith(found.dir + sep)) return c.text("없음", 404);
    return new Response(readFileSync(real), {
      headers: { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox allow-scripts; default-src 'self' 'unsafe-inline' data: blob:", "Cache-Control": "no-store" },
    });
  });
  // SUPERVISOR만: 이 화면 Origin이 있어야 받는다(ATC-34 스위치와 같은 규칙)
  app.post("/api/human-check/:owner/:name/:number", async (c: Context) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const body = (await c.req.json().catch(() => ({}))) as { result?: unknown; note?: unknown; head?: unknown };
    const r = await recordHumanCheck(await getSnapshot(), `${c.req.param("owner")}/${c.req.param("name")}`, Number(c.req.param("number")), body, "SUPERVISOR");
    return c.json(r.body, r.status as 200);
  });
}

import { appendFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { loadAutoland } from "./autoland.ts";
import { appendRecord } from "./autoland-record.ts";
import { loadDispatchConfig } from "./dispatch.ts";
import { modelFamily } from "./crosscheck.ts";
import { type LandingReview, type MergeReview, externalGateOf, severityOf, slugOfUrl } from "./landing.ts";
import type { PullRequest, Snapshot } from "./model.ts";
import { record } from "./recorder.ts";
import { fetchReviewSource, type ReviewSource } from "./sources/github.ts";
import { fetchIssueDetail } from "./sources/linear.ts";

// Codex 한도 때 착륙 리뷰(ATC-7, ATC-27, docs/occ.md 9.2). REVIEW 세션(Claude Sonnet, 2026-09-29)이 자료를 읽고(GET) 리뷰를 남긴다(POST).
// 기록은 추가만 하는 landing-reviews.jsonl. CLEARED TO LAND 판단은 landing.ts(extReviewStateOf)가 한다.

const FILE = () => join(config.stateDir, "landing-reviews.jsonl"); // 쓸 때마다 읽는다(ATC-564)
export const REVIEW_TEXT_MAX = 4000;
export const DIFF_MAX = 80_000; // 자료에 넣는 diff 글자 수(넘으면 자르고 알린다)
const BODY_MAX = 8_000;
const ISSUE_MAX = 6_000;

// 파일이 바뀌었을 때만 다시 읽는다(스냅샷마다 부른다)
const caches = new Map<string, { key: string; reviews: LandingReview[] }>();
function readReviewsFile(file: string): LandingReview[] {
  let key = "";
  try {
    const st = statSync(file);
    key = `${st.size}:${st.mtimeMs}`;
  } catch {
    return [];
  }
  const cache = caches.get(file);
  if (cache?.key === key) return cache.reviews;
  const reviews: LandingReview[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    try {
      reviews.push(JSON.parse(line));
    } catch {}
  }
  caches.set(file, { key, reviews });
  return reviews;
}
export const readLandingReviews = (file = FILE()): LandingReview[] => readReviewsFile(file);
// AUTOLAND AIRPORT의 머지 리뷰(ATC-328). 추가만 하는 JSONL. 파일은 호출 때 정한다(config.stateDir가 시험에서 바뀐다)
export const mergeReviewsFile = () => join(config.stateDir, "autoland-reviews.jsonl");
export const readMergeReviews = (file = mergeReviewsFile()): MergeReview[] => readReviewsFile(file);

function appendReview(r: LandingReview, file = FILE(), op = "landing-review") {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(r)}\n`);
  record({ t: r.at, kind: "landing", op: `${op}:${r.verdict}`, id: `${r.repo}#${r.number}` });
}

export class ReviewError extends Error {
  status: 400 | 403 | 404 | 409 | 502;
  constructor(message: string, status: 400 | 403 | 404 | 409 | 502) {
    super(message);
    this.status = status;
  }
}

// "vocado_nextjs" 또는 "owner/vocado_nextjs"와 번호로 열린 PR 찾기
export function findPull(pulls: readonly PullRequest[], repo: string, number: number): PullRequest {
  const want = repo.toLowerCase();
  const hits = pulls.filter((p) => {
    const slug = slugOfUrl(p.url)?.toLowerCase();
    return p.number === number && slug && (slug === want || slug.split("/")[1] === want);
  });
  if (!hits.length) throw new ReviewError(`열린 PR ${repo}#${number}가 없음`, 404);
  if (hits.length > 1) throw new ReviewError(`${repo}#${number}가 여럿 — owner/name으로 적는다`, 400);
  return hits[0];
}

// 착륙 리뷰를 남길 수 있는 모델: Claude Sonnet(SUPERVISOR 결정 2026-09-29, 전에는 ocx의 DeepSeek V4.1 Flash, ATC-27).
// guard(--review)가 세션 기록의 실제 모델을 붙인다. controller/guard.mjs REVIEW_MODELS와 같다
export const LANDING_REVIEW_MODELS = /^claude-sonnet-/i;

// 외부 리뷰에 보낼 수 있는 PR인가: Codex를 쓸 수 없고(CODEX UNAVAILABLE), 제외 사유가 없음
export function assertReviewTarget(p: PullRequest) {
  if (p.draft) throw new ReviewError(`#${p.number}는 Draft — 착륙 리뷰 대상 아님`, 409);
  if (!p.extReview) throw new ReviewError(`#${p.number}는 Codex를 쓸 수 있음(또는 이미 리뷰됨) — 착륙 리뷰 대상 아님`, 409);
  if (p.extReview.status === "excluded") throw new ReviewError(`외부 리뷰 제외 — ${p.extReview.reason}`, 403);
}

// AUTOLAND가 맡은 AIRPORT의 열린 PR이면 그 AIRPORT 코드(ATC-328). 거기서는 이 head의 머지 리뷰가 착륙 리뷰라 Codex 상태와 상관없이 남긴다
export function autolandAirportOf(s: Pick<Snapshot, "airports">, p: Pick<PullRequest, "repo" | "draft" | "mergeReviewTarget">): string | null {
  // buildPulls가 정한 같은 조건(mergeReviewGateOk): 아니면 옛 경로(assertReviewTarget, landing-reviews.jsonl)
  if (p.draft || !p.mergeReviewTarget) return null;
  const code = s.airports.find((a) => a.repo === p.repo)?.code;
  return code && loadAutoland().airports.includes(code) ? code : null;
}

// 리뷰 입력 검사: head는 지금 head(짧은 SHA도 됨), verdict pass|findings, text 필수.
// 지적 등급은 Codex처럼 P0·P1·P2 — pass에는 P0·P1을 적지 않고, findings에는 등급이 하나 이상 있어야 한다
export function parseReview(body: Record<string, unknown>, p: Pick<PullRequest, "url" | "number" | "head"> & Partial<Pick<PullRequest, "extReview">>, at: string): LandingReview {
  const head = typeof body.head === "string" ? body.head.trim().toLowerCase() : "";
  if (head.length < 7 || !p.head.startsWith(head)) throw new ReviewError(`head가 지금 head(${p.head.slice(0, 7)})와 다름 — 새 head는 새 리뷰가 필요하다`, 409);
  if (body.verdict !== "pass" && body.verdict !== "findings") throw new ReviewError("verdict는 pass|findings", 400);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) throw new ReviewError("text(리뷰 내용)가 필요함", 400);
  if (text.length > REVIEW_TEXT_MAX) throw new ReviewError(`text는 ${REVIEW_TEXT_MAX}자 이내 (지금 ${text.length}자)`, 400);
  const sev = severityOf(text);
  if (body.verdict === "pass" && (sev.p0 || sev.p1)) throw new ReviewError("pass에는 P0·P1 지적을 적지 않는다 — 있으면 findings", 400);
  if (body.verdict === "findings" && !sev.p0 && !sev.p1 && !sev.p2) throw new ReviewError("findings에는 P0·P1·P2 등급을 하나 이상 적는다", 400);
  const model = typeof body.model === "string" ? body.model.trim().slice(0, 120) : "";
  if (!model) throw new ReviewError("model이 없음 — REVIEW 세션에서만 남긴다(guard가 실제 모델을 붙인다)", 400);
  if (!LANDING_REVIEW_MODELS.test(model)) throw new ReviewError(`착륙 리뷰는 Claude Sonnet만 남긴다 — 지금 ${model}`, 400);
  const by = typeof body.by === "string" && body.by.trim() ? body.by.trim().slice(0, 40) : "REVIEW";
  // 보안 규칙에 걸렸지만 스위치로 보낸 PR의 리뷰는 security: true로 남긴다(ATC-30)
  return { at, repo: slugOfUrl(p.url)!, number: p.number, head: p.head, verdict: body.verdict, text, by, model, family: modelFamily(model), ...sev, ...(p.extReview?.security ? { security: true as const } : {}) };
}

// 이슈 본문에서 완료 기준과 금지 사항 절을 찾는다(머리글 아래 다음 같은 급 머리글까지). 없으면 null
const ACCEPT = /완료\s*기준|수용\s*기준|acceptance|exit criteria|done when|definition of done/i;
const FORBID = /금지|하지\s*말|forbidden|do not|don't|must not|out of scope|non-goals?|범위\s*밖/i;
export function sectionsOf(md: string): { acceptance: string | null; forbidden: string | null } {
  const lines = md.split("\n");
  const heads = lines.map((l, i) => {
    const m = /^(#{1,6})\s+(.*)$/.exec(l) ?? /^\*\*(.+?)\*\*:?\s*$/.exec(l);
    return m ? { i, level: m[1].startsWith("#") ? m[1].length : 7, title: m[m.length - 1] } : null;
  }).filter((h) => h !== null);
  const take = (re: RegExp) => {
    const h = heads.find((x) => re.test(x.title));
    if (!h) return null;
    const next = heads.find((x) => x.i > h.i && x.level <= h.level);
    const text = lines.slice(h.i + 1, next?.i ?? lines.length).join("\n").trim();
    return text || null;
  };
  return { acceptance: take(ACCEPT), forbidden: take(FORBID) };
}

// 긴 글은 줄 경계에서 자르고 잘랐다고 알린다
export function capText(text: string, max: number): { text: string; truncated: boolean; chars: number } {
  if (text.length <= max) return { text, truncated: false, chars: text.length };
  const cut = text.lastIndexOf("\n", max);
  return { text: text.slice(0, cut > max / 2 ? cut : max), truncated: true, chars: text.length };
}

// diff를 DIFF_MAX 이하의 쪽으로 나눈다(ATC-489). 쪽을 이어 붙이면 원래 diff와 글자까지 같다. 파일 경계(`diff --git`)에서 먼저 끊고,
// 한 파일이 max보다 크면 줄 경계에서, 줄 하나가 max보다 길면 max 글자에서 끊는다. files는 그 쪽에 글이 있는 파일 이름(이어지는 쪽은 이어지는 파일부터)
export function splitDiff(diff: string, max: number): { text: string; files: string[] }[] {
  if (diff === "") return [{ text: "", files: [] }];
  const chunks = diff.split(/^(?=diff --git )/m).filter((x) => x !== "");
  const parts: { text: string; files: string[] }[] = [];
  let cur = { text: "", files: [] as string[] };
  const flush = () => {
    if (cur.text) parts.push(cur);
    cur = { text: "", files: [] };
  };
  const nameOf = (chunk: string) => /^diff --git a\/\S+ b\/(\S+)/.exec(chunk)?.[1] ?? "(머리 앞)";
  for (const chunk of chunks) {
    const name = nameOf(chunk);
    if (cur.text && cur.text.length + chunk.length > max) flush();
    if (chunk.length <= max) {
      cur.text += chunk;
      if (!cur.files.includes(name)) cur.files.push(name);
      continue;
    }
    // 한 파일이 한 쪽보다 크다: 새 쪽에서 시작해 줄 단위로 채운다
    flush();
    let rest = chunk;
    while (rest.length > 0) {
      let take = rest.length;
      if (take > max) {
        const nl = rest.lastIndexOf("\n", max - 1);
        take = nl >= 0 ? nl + 1 : max;
      }
      parts.push({ text: rest.slice(0, take), files: [name] });
      rest = rest.slice(take);
    }
  }
  flush();
  return parts;
}

// 리뷰 자료의 diff 쪽(ATC-489). part가 없으면 1쪽. 쪽 번호가 범위 밖이면 400.
// diffTruncated는 어느 쪽으로도 읽을 수 없는 글이 있을 때만 true: files API 자료에서 patch가 빠진 파일(너무 큼·이진·지워짐)이다(ATC-449)
export function diffPacketOf(
  src: Pick<ReviewSource, "diff" | "diffSource" | "removedFiles" | "unreadFiles">,
  partParam: string | undefined,
  max = DIFF_MAX,
) {
  const all = splitDiff(src.diff, max);
  const part = partParam === undefined ? 1 : /^\d+$/.test(partParam) ? Number(partParam) : 0;
  if (part < 1 || part > all.length) throw new ReviewError(`part는 1~${all.length}의 정수`, 400);
  const cur = all[part - 1]!;
  return {
    part,
    parts: all.length,
    partFiles: cur.files,
    diff: cur.text,
    diffSource: src.diffSource,
    diffTruncated: src.unreadFiles.length > 0,
    ...(src.unreadFiles.length ? { unreadFiles: src.unreadFiles } : {}),
    ...(src.removedFiles.length ? { removedFiles: src.removedFiles } : {}),
    diffChars: src.diff.length,
  };
}

const REVIEW_GUIDE =
  "diff가 FLIGHT의 완료 기준을 채우는지, 금지 사항을 어기지 않는지, 버그·보안·데이터 손상 위험이 없는지 본다. 지적은 Codex처럼 P0(머지하면 안 됨)·P1(머지 전에 고칠 것)·P2(나중에)로 적는다. P0·P1이 없으면 pass. diff가 여러 쪽(parts)이면 `--part <n>`으로 모든 쪽을 읽은 뒤에 판정하고, 읽은 쪽을 리뷰 글에 적는다. diffTruncated(unreadFiles의 내용을 못 읽음)이면 본 범위를 적고, 못 읽은 파일에 위험이 있을 수 있으면 findings(P1)로 남긴다.";

// 오류의 첫 줄(stderr가 있으면 그것)
export const firstLine = (e: unknown) => String(((e as { stderr?: string }).stderr || (e as Error)?.message || e) ?? "").trim().split("\n")[0].slice(0, 300) || "원인 모름";

export function mountLandingReview(app: Hono, getSnapshot: () => Promise<Snapshot>, readGh?: (args: string[]) => Promise<string>) {
  const fail = (e: unknown) => {
    if (e instanceof ReviewError) return { body: { error: e.message }, status: e.status };
    throw e;
  };

  // REVIEW 세션이 할 일: 착륙 리뷰를 기다리는 PR, 외부 리뷰에서 뺀 PR, 최근 리뷰
  app.get("/api/landing/reviews", async (c) => {
    const s = await getSnapshot();
    const item = (p: PullRequest) => ({
      pr: `${slugOfUrl(p.url)}#${p.number}`,
      title: p.title,
      url: p.url,
      head: p.head.slice(0, 7),
      flight: p.ticketKey,
      codex: p.codexUnavailable,
      ...(p.extReview?.reason ? { reason: p.extReview.reason } : {}),
    });
    const mine = s.pulls.filter((p) => p.extReview);
    return c.json({
      silentHours: config.codexSilentMs / 3_600_000,
      pending: mine.filter((p) => p.extReview!.status === "waiting").map(item),
      excluded: mine.filter((p) => p.extReview!.status === "excluded").map(item),
      recent: readLandingReviews().slice(-10).reverse().map((r) => ({ pr: `${r.repo}#${r.number}`, head: r.head.slice(0, 7), verdict: r.verdict, family: r.family, at: r.at })),
    });
  });

  // 리뷰 자료: PR 제목·본문, FLIGHT의 완료 기준·금지 사항, head SHA, 크기를 제한한 diff
  app.get("/api/landing/review/:repo/:pr", async (c) => {
    try {
      const s = await getSnapshot();
      const p = findPull(s.pulls, c.req.param("repo"), Number(c.req.param("pr")));
      const al = autolandAirportOf(s, p);
      if (!al) assertReviewTarget(p);
      const slug = slugOfUrl(p.url)!;
      // GitHub 읽기 실패는 500이 아니라 502와 stderr 첫 줄(ATC-449). 너무 큰 diff는 fetchReviewSource가 files API로 돌아간다
      const src = await fetchReviewSource(slug, p.number, readGh).catch((e) => {
        throw new ReviewError(`GitHub 읽기 실패 — ${firstLine(e)}`, 502);
      });
      if (src.headRefOid !== p.head) throw new ReviewError(`head가 바뀜(${src.headRefOid.slice(0, 7)}) — atc가 다시 읽은 뒤(90초 안) 리뷰한다`, 409);
      // FLIGHT 본문도 보안 키워드를 본다. 읽지 못하면 확인할 수 없으니 보내지 않는다
      let issue: { title?: string; url?: string; description?: string | null };
      try {
        issue = (await fetchIssueDetail(p.ticketKey!)) as typeof issue;
      } catch (e) {
        throw new ReviewError(`FLIGHT ${p.ticketKey} 본문을 읽지 못해 보안 여부를 확인할 수 없음 — 다음 바퀴에 (${String((e as Error).message ?? e)})`, 409);
      }
      const desc = issue.description ?? "";
      // 보내기 직전에 한 번 더: 실제 diff의 파일, 라벨, PR·FLIGHT 제목과 본문으로 제외 사유를 본다
      const ticket = s.tickets.find((t) => t.key === p.ticketKey);
      const diffFiles = [...src.diff.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].flatMap((m) => [m[1], m[2]]);
      const gate = externalGateOf({
        flight: p.ticketKey,
        ticketLabels: ticket?.labels ?? [],
        prLabels: src.labels,
        files: [...src.files, ...diffFiles],
        texts: [src.title, src.body, issue.title, desc],
      });
      // 비밀·키 경로와 FLIGHT 없음은 어느 모드에서든, 보안 규칙은 스위치가 "deepseek"(옛 이름: 보안 PR도 REVIEW에 보냄)이 아니면 보내지 않는다(ATC-30)
      // AUTOLAND AIRPORT는 reviewedSecurity가 delegate여도 보안 게이트 PR의 자료를 준다(ATC-328). 비밀·키 경로는 그래도 막는다
      const allowSecurity = loadDispatchConfig().externalReview.security === "deepseek" || (Boolean(al) && loadAutoland().reviewedSecurity === "delegate");
      const exclusion = gate.hard ?? (allowSecurity ? null : gate.security);
      if (exclusion) throw new ReviewError(`외부 리뷰 제외 — ${exclusion}`, 403);
      const flight = { key: p.ticketKey, title: issue.title ?? null, url: issue.url ?? null, ...sectionsOf(desc), description: capText(desc, ISSUE_MAX) };
      const dp = diffPacketOf(src, c.req.query("part"));
      return c.json({
        pr: `${slug}#${p.number}`,
        url: p.url,
        head: p.head,
        codex: p.codexUnavailable,
        title: src.title,
        body: capText(src.body, BODY_MAX),
        flight,
        files: src.files,
        ...dp,
        // 보안 PR(스위치로 보냄): 사유. 리뷰어는 권한·RLS·인증·마이그레이션을 더 엄격히 본다(review/CLAUDE.md)
        security: gate.security,
        guide: gate.security ? `${REVIEW_GUIDE} 보안 PR이다(${gate.security}): 권한·RLS·GRANT/REVOKE·인증·세션·마이그레이션 되돌림을 특히 본다. 확신이 없으면 pass하지 않는다.` : REVIEW_GUIDE,
      });
    } catch (e) {
      const f = fail(e);
      return c.json(f.body, f.status);
    }
  });

  // 리뷰 기록. 현재 head에만, 외부 리뷰 대상 PR에만. model은 guard가 붙인 실제 모델(Claude Sonnet만)
  app.post("/api/landing/review/:repo/:pr", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const s = await getSnapshot();
      const p = findPull(s.pulls, c.req.param("repo"), Number(c.req.param("pr")));
      const al = autolandAirportOf(s, p);
      if (!al) assertReviewTarget(p);
      const r = parseReview(body, p, new Date().toISOString());
      if (al) {
        // AUTOLAND AIRPORT의 머지 리뷰(ATC-328): autoland-reviews.jsonl. by는 받지 않고 REVIEW로 고정한다
        const m: MergeReview = { ...r, by: "REVIEW" };
        appendReview(m, mergeReviewsFile(), "merge-review");
        appendRecord({ op: "merge-review", mode: loadAutoland().mode, airport: al, slug: m.repo, number: m.number, head: m.head, result: m.verdict, detail: `${m.by} · P0 ${m.p0} · P1 ${m.p1} · P2 ${m.p2}` });
        return c.json({ review: m });
      }
      appendReview(r);
      return c.json({ review: r });
    } catch (e) {
      const f = fail(e);
      return c.json(f.body, f.status);
    }
  });
}

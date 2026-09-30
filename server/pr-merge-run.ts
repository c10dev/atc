// MERGE 버튼의 쓰기 길(DUTY G2, 외부 부작용: GitHub에 머지한다). POST /api/pr/:airport/:number/merge {head}.
// - 이 화면에서 온 JSON 요청만(fromThisApp, 아니면 403). 세션·CLI·curl은 Origin이 없어 못 지나간다. atcctl에는 이 명령이 없다
// - 서버는 스스로 머지하지 않는다: 부르는 것은 SUPERVISOR의 클릭뿐이고, 스케줄러·주기·후크가 이 길을 부르지 않는다
// - user 등급(또는 MCC가 ESCALATE한)이고 CLEARED인 PR만, 화면이 보여 준 head 그대로일 때만(sha가 다르면 GitHub도 거절한다). auto·flagged는 MCC의 몫(pr-merge.ts)
// - auto-merge는 켜지 않는다. 머지 방식은 AIRPORT의 것(MCC AIRPORT는 merge). 시도마다 FLIGHT RECORDER 한 줄(거절·실패도)
import type { Hono } from "hono";
import { loadAutoland, writeResultOf } from "./autoland.ts";
import { GithubOffError } from "./github-switch.ts";
import { prRefOf } from "./detail.ts";
import { forgetPr } from "./detail-run.ts";
import { errText, gh } from "./mcc-run.ts";
import { escalationOf, loadMcc, readMccRecords, tierOfFiles } from "./mcc.ts";
import type { Snapshot } from "./model.ts";
import { fromThisApp } from "./origin.ts";
import { type MergeFacts, mergeMethodOf, mergeVerdictOf, parseMergeBody, type Tier } from "./pr-merge.ts";
import { record } from "./recorder.ts";
import { slugOf } from "./sources/github.ts";

export interface MergeDeps {
  gh: (args: string[]) => Promise<string>;
  slugOf: (repo: string) => Promise<string | null>;
  mccAirport: () => string;
  holds: () => readonly number[];
  escalated: (n: number) => boolean;
  autolandMethod: () => "merge" | "squash" | "rebase";
  tierOf: (files: string[]) => Promise<Tier>;
  record: typeof record;
  forget: (repo: string, n: number) => void;
  now: () => Date;
}
const defaultDeps: MergeDeps = {
  gh,
  slugOf,
  mccAirport: () => loadMcc().airport,
  holds: () => loadMcc().holds,
  escalated: (n) => escalationOf(readMccRecords(), n) !== null,
  autolandMethod: () => loadAutoland().mergeMethod,
  tierOf: async (files) => (await tierOfFiles(files)).tier,
  record,
  forget: forgetPr,
  now: () => new Date(),
};

interface RestPull {
  state: string;
  draft: boolean;
  head: { sha: string; repo: { full_name: string } | null };
  base: { ref: string; repo: { full_name: string } };
}

export function mountPrMerge(app: Hono, getSnapshot: () => Promise<Snapshot>, deps: MergeDeps = defaultDeps) {
  app.post("/api/pr/:airport/:number/merge", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다(SUPERVISOR 전용)" }, 403);
    const ref = prRefOf(c.req.param("airport"), c.req.param("number"));
    if (!ref) return c.json({ error: "주소는 /api/pr/<AIRPORT>/<번호>/merge" }, 400);
    const body = parseMergeBody(await c.req.json().catch(() => null));
    if (!body.ok) return c.json({ error: body.error }, 400);
    const snap = await getSnapshot();
    const airport = snap.airports.find((a) => a.code === ref.airport);
    if (!airport) return c.json({ error: `AIRPORT ${ref.airport}를 찾을 수 없음` }, 404);

    const log = (ok: boolean, result: string, extra: { method?: string; error?: string } = {}) =>
      deps.record({ t: deps.now().toISOString(), kind: "pr", op: "merge", by: "supervisor", airport: airport.code, number: ref.number, head: body.head, ok, result, ...extra });
    try {
      const slug = await deps.slugOf(airport.repo);
      if (!slug) {
        log(false, "refused", { error: "GitHub 저장소가 아님" });
        return c.json({ error: "이 AIRPORT는 GitHub 저장소가 아님" }, 409);
      }
      // 머지 직전에 PR과 바뀐 파일을 지금 GitHub에서 다시 읽는다(화면의 자료로 머지하지 않는다)
      const pr = JSON.parse(await deps.gh(["api", `repos/${slug}/pulls/${ref.number}`])) as RestPull;
      const files = (await deps.gh(["api", "--paginate", `repos/${slug}/pulls/${ref.number}/files?per_page=100`, "--jq", ".[].filename"])).split("\n").filter(Boolean);
      const tier = files.length ? await deps.tierOf(files).catch(() => null) : null;
      const polled = snap.pulls.find((p) => p.repo === airport.repo && p.number === ref.number) ?? null;
      const facts: MergeFacts = {
        isMccAirport: airport.code === deps.mccAirport(),
        live: { state: pr.state, draft: pr.draft, head: pr.head.sha, base: pr.base.ref, fork: pr.head.repo?.full_name !== pr.base.repo.full_name },
        defaultBranch: snap.atfm.mains.find((m) => m.repo === airport.repo)?.branch ?? "main",
        tier,
        escalated: deps.escalated(ref.number),
        held: deps.holds().includes(ref.number),
        polled: polled ? { head: polled.head, landing: polled.landing, blocks: polled.blocks.map((b) => b.en) } : null,
      };
      const v = mergeVerdictOf(body.head, facts);
      if (!v.ok) {
        log(false, v.currentHead ? "rejected" : "refused", { error: v.error });
        return c.json({ error: v.error, ...(v.currentHead ? { currentHead: v.currentHead } : {}), ...(v.blocks ? { blocks: v.blocks } : {}) }, v.status);
      }
      const method = mergeMethodOf(airport.code, deps.mccAirport(), deps.autolandMethod());
      try {
        // 정확한 head만 머지한다(sha: gh pr merge --match-head-commit과 같은 조건). auto-merge를 켜지 않는다
        await deps.gh(["api", "-X", "PUT", `repos/${slug}/pulls/${ref.number}/merge`, "-f", `sha=${body.head}`, "-f", `merge_method=${method}`]);
      } catch (e) {
        const r = writeResultOf(errText(e));
        log(false, r.result, { method, error: r.detail });
        return c.json({ error: r.detail, result: r.result }, 409);
      }
      deps.forget(airport.repo, ref.number);
      log(true, "merged", { method });
      return c.json({ merged: true, head: body.head, method, tier: facts.tier, escalated: facts.escalated });
    } catch (e) {
      const msg = e instanceof GithubOffError ? e.message : errText(e);
      log(false, "failed", { error: msg });
      return c.json({ error: msg, ...(e instanceof GithubOffError ? { off: true } : {}) }, e instanceof GithubOffError ? 503 : 502);
    }
  });
}

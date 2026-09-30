// FLIGHT drawer·PR drawer 읽기 경로(DUTY G1). 새 gh·Linear 호출은 열 때 한 번씩이고 60초 캐시다(백그라운드 폴링 없음).
// 쓰기 경로는 없다(MERGE·state는 G2·G3). 토큰은 서버 안에만 있다. 명령·API 호출은 sources/*.ts가 한다.
import type { Hono } from "hono";
import { GithubOffError } from "./github-switch.ts";
import { flightKeyOf, makeCache, prRefOf, shapeIssue, shapePr, type IssueDetail, type PrDetail } from "./detail.ts";
import { loadAutoland } from "./autoland.ts";
import { escalationOf, inspectionOf, loadMcc, readMccRecords, tierOfFiles } from "./mcc.ts";
import { type MergeInfo, mergeInfoOf, mergeMethodOf } from "./pr-merge.ts";
import type { Snapshot } from "./model.ts";
import { fetchPrView, slugOf } from "./sources/github.ts";
import { ticketKeyFromBranch, ticketKeyFromTitle } from "./sources/git.ts";
import { fetchIssueDrawer } from "./sources/linear.ts";

const TTL_MS = 60_000;
const issueCache = makeCache<IssueDetail>(TTL_MS);
const prCache = makeCache<PrDetail>(TTL_MS);

// 상태를 옮긴 뒤 그 FLIGHT의 캐시를 버린다(flight-state-run.ts)
export const forgetIssue = (key: string) => issueCache.forget(key);
// 머지한 뒤 그 PR의 캐시를 버린다(pr-merge-run.ts)
export const forgetPr = (repo: string, n: number) => prCache.forget(`${repo}#${n}`);

export function mountDetail(app: Hono, getSnapshot: () => Promise<Snapshot>) {
  app.get("/api/flight/:key/detail", async (c) => {
    const key = flightKeyOf(c.req.param("key"));
    if (!key) return c.json({ error: "FLIGHT key 형식이 아님" }, 400);
    try {
      return c.json(await issueCache(key, async () => shapeIssue(await fetchIssueDrawer(key))));
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      return c.json({ error: msg }, /찾을 수 없음/.test(msg) ? 404 : 502);
    }
  });

  app.get("/api/pr/:airport/:number/detail", async (c) => {
    const ref = prRefOf(c.req.param("airport"), c.req.param("number"));
    if (!ref) return c.json({ error: "주소는 #pr/<AIRPORT>/<번호>" }, 400);
    const snap = await getSnapshot();
    const airport = snap.airports.find((a) => a.code === ref.airport);
    if (!airport) return c.json({ error: `AIRPORT ${ref.airport}를 찾을 수 없음` }, 404);
    try {
      const d = await prCache(`${airport.repo}#${ref.number}`, async () => {
        const slug = await slugOf(airport.repo);
        if (!slug) throw new Error("이 AIRPORT는 GitHub 저장소가 아님");
        return shapePr(await fetchPrView(slug, ref.number), (branch, title) => ticketKeyFromBranch(branch) ?? ticketKeyFromTitle(title));
      });
      // atc가 폴링해 아는 것은 캐시 밖에서 붙인다(항상 최신)
      const polled = snap.pulls.find((p) => p.repo === airport.repo && p.number === ref.number && p.head === d.head);
      let landing: PrDetail["landing"] = null;
      if (polled) {
        const tier = await tierOfFiles(polled.changed ?? d.files.map((f) => f.path)).then((t) => t.tier).catch(() => null);
        const ins = loadMcc().airport === airport.code ? inspectionOf(readMccRecords(), polled.number, polled.head) : null;
        landing = {
          state: polled.landing,
          blocks: polled.blocks.map((b) => b.en),
          tier,
          inspection: ins ? { verdict: ins.verdict, p0: ins.p0, p1: ins.p1, p2: ins.p2, at: ins.at } : null,
        };
      }
      // MERGE 버튼을 보일지(캐시된 자료로). 누르면 pr-merge-run.ts가 지금 GitHub 자료로 다시 판정한다
      const cfg = loadMcc();
      const merge: MergeInfo | null =
        d.head && d.base
          ? mergeInfoOf(
              {
                isMccAirport: airport.code === cfg.airport,
                live: { state: d.state.toLowerCase(), draft: d.draft, head: d.head, base: d.base, fork: d.fork },
                defaultBranch: snap.atfm.mains.find((m) => m.repo === airport.repo)?.branch ?? "main",
                tier: landing?.tier ?? null,
                escalated: escalationOf(readMccRecords(), ref.number) !== null,
                held: cfg.holds.includes(ref.number),
                polled: polled ? { head: polled.head, landing: polled.landing, blocks: polled.blocks.map((b) => b.en) } : null,
              },
              mergeMethodOf(airport.code, cfg.airport, loadAutoland().mergeMethod),
            )
          : null;
      return c.json({ ...d, airport: airport.code, landing, merge });
    } catch (e) {
      if (e instanceof GithubOffError) return c.json({ error: e.message, off: true }, 503);
      return c.json({ error: String((e as Error).message ?? e) }, 502);
    }
  });
}

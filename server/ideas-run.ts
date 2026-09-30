// IDEAS 서랍 읽기 경로(DUTY G4). 열 때 한 번씩 gh를 부르고 60초 캐시다(백그라운드 폴링 없음). 쓰기 경로는 없다: 라벨·댓글·닫기 없음.
// 읽는 저장소는 IDEAS_REPO 하나로 고정이다(요청이 저장소를 정하지 못한다). 명령은 sources/github.ts가 한다.
import type { Hono } from "hono";
import { GithubOffError } from "./github-switch.ts";
import { makeCache } from "./detail.ts";
import { IDEA_LABEL, IDEAS_REPO, type IdeaDetail, type IdeaRow, ideaNumberOf, shapeIdea, shapeIdeaList } from "./ideas.ts";
import { fetchIdeaList, fetchIdeaView } from "./sources/github.ts";

const TTL_MS = 60_000;
const listCache = makeCache<IdeaRow[]>(TTL_MS);
const ideaCache = makeCache<IdeaDetail>(TTL_MS);

class NotIdea extends Error {}

export function mountIdeas(app: Hono) {
  app.get("/api/ideas", async (c) => {
    try {
      const ideas = await listCache("list", async () => shapeIdeaList(await fetchIdeaList(IDEAS_REPO, IDEA_LABEL)));
      return c.json({ repo: IDEAS_REPO, ideas });
    } catch (e) {
      if (e instanceof GithubOffError) return c.json({ error: e.message, off: true }, 503);
      return c.json({ error: String((e as Error).message ?? e) }, 502);
    }
  });

  app.get("/api/ideas/:n", async (c) => {
    const n = ideaNumberOf(c.req.param("n"));
    if (!n) return c.json({ error: "번호는 자연수" }, 400);
    try {
      const d = await ideaCache(String(n), async () => {
        const v = shapeIdea(await fetchIdeaView(IDEAS_REPO, n));
        if (!v) throw new NotIdea();
        return v;
      });
      return c.json(d);
    } catch (e) {
      if (e instanceof NotIdea) return c.json({ error: `#${n}은 열린 idea 이슈가 아님` }, 404);
      if (e instanceof GithubOffError) return c.json({ error: e.message, off: true }, 503);
      const msg = String((e as Error).message ?? e);
      return c.json({ error: msg }, /Could not resolve|not found/i.test(msg) ? 404 : 502);
    }
  });
}

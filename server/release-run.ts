// 발권 기록의 길(ATC-362, docs/autonomy.md 원칙 1·10). 판정은 release.ts(순수), 파일은 release-store.ts.
// - GET  /api/releases              기록, gate 상태, 발권 없는 FLIGHT 목록, 세션별 attested 수(읽기만)
// - POST /api/releases              {flight, hash?}  화면 클릭 한 건. 이 화면에서 온 요청만(fromThisApp, 아니면 403): agent·CLI·curl은 Origin이 없어 만들 수 없다
// - POST /api/releases/bulk         {flights: [{key, hash}]}  일괄 확인(이미 Todo에 있는 FLIGHT). 같은 Origin 검사. 이 줄부터 gate가 켜진다(arm)
// - POST /api/releases/attest       {flight, session, words}  다른 세션에 한 SUPERVISOR의 말을 그 세션이 증언. attested로 표시한다
// - releaseFromChat(text)           DUTY 채팅에 SUPERVISOR가 직접 쓴 글(Origin 검사를 거친 /api/duty/message)에서 `RELEASE ATC-n`·`발권 ATC-n` 줄을 읽는다
// 서버는 스스로 발권하지 않는다: 스케줄러·주기·후크는 이 길을 부르지 않는다.
import type { Context, Hono } from "hono";
import { candidateTeamsOf, isCandidateTicket, loadDispatchConfig } from "./dispatch.ts";
import { type Snapshot, parentKeysOf } from "./model.ts";
import { fromThisApp } from "./origin.ts";
import {
  attestedCounts,
  attestedRelease,
  bulkTargets,
  chatRelease,
  chatReleaseKeys,
  foldReleases,
  releaseGateOn,
  releaseStateOf,
  screenRelease,
  type ReleaseGateMode,
  type ReleaseLine,
} from "./release.ts";
import { appendReleaseLines, readReleaseLines } from "./release-store.ts";

const BODY_MAX = 64 * 1024;

export interface ReleaseDeps {
  snapshot: () => Promise<Snapshot>;
  lines: () => ReleaseLine[];
  append: (lines: readonly ReleaseLine[]) => void;
  now: () => Date;
  gateMode: () => ReleaseGateMode;
  teams: () => Set<string>;
}
const defaultDeps = (snapshot: () => Promise<Snapshot>): ReleaseDeps => ({
  snapshot,
  lines: () => readReleaseLines(),
  append: (l) => appendReleaseLines(l),
  now: () => new Date(),
  gateMode: () => loadDispatchConfig().releaseGate,
  teams: () => candidateTeamsOf(loadDispatchConfig()),
});

// 발권할 수 있는 후보: 후보 팀의 Todo(시작 전)이고 상위 이슈가 아닌 FLIGHT
const candidatesOf = (s: Snapshot, teams: Set<string>) => {
  const parents = parentKeysOf(s.tickets);
  return s.tickets.filter((t) => t.stateType === "unstarted" && isCandidateTicket(t, teams) && !parents.has(t.key));
};

export function releaseView(s: Snapshot, d: ReleaseDeps) {
  const lines = d.lines();
  const view = foldReleases(lines);
  const cands = candidatesOf(s, d.teams());
  const unreleased = bulkTargets(cands, view).map((t) => {
    const full = cands.find((c) => c.key === t.key)!;
    return { key: t.key, title: full.title, hash: full.releaseHash ?? null, priority: full.priority, state: releaseStateOf(t.key, t.releaseHash, view) as "unreleased" | "stale" };
  });
  const released = cands.filter((t) => releaseStateOf(t.key, t.releaseHash, view) === "released").map((t) => ({ key: t.key, ...view.records[t.key]! }));
  return { gate: { mode: d.gateMode(), on: releaseGateOn(d.gateMode(), view.armedAt), armedAt: view.armedAt }, unreleased, released, attested: attestedCounts(lines) };
}

export function mountReleases(app: Hono, snapshot: () => Promise<Snapshot>, deps: ReleaseDeps = defaultDeps(snapshot)) {
  const readBody = async (c: Context): Promise<Record<string, unknown> | null> => {
    const raw = await c.req.text();
    if (raw.length > BODY_MAX) return null;
    try {
      const p = JSON.parse(raw || "{}");
      return p && typeof p === "object" && !Array.isArray(p) ? p : {};
    } catch {
      return null;
    }
  };

  app.get("/api/releases", async (c) => c.json(releaseView(await deps.snapshot(), deps)));

  app.post("/api/releases", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "화면 발권은 이 화면에서 보낸 요청만 받습니다(SUPERVISOR 전용). 다른 길은 /api/releases/attest" }, 403);
    const body = await readBody(c);
    if (!body || typeof body.flight !== "string") return c.json({ error: "flight(FLIGHT key)가 필요함" }, 400);
    const s = await deps.snapshot();
    const r = screenRelease(s.tickets.find((t) => t.key === body.flight), body.flight, body.hash, "click", deps.now());
    if (!r.ok) return c.json({ error: r.error }, r.status);
    deps.append([r.value]);
    return c.json({ release: r.value });
  });

  app.post("/api/releases/bulk", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "일괄 확인은 이 화면에서 보낸 요청만 받습니다(SUPERVISOR 전용)" }, 403);
    const body = await readBody(c);
    const list = body && Array.isArray(body.flights) ? body.flights : null;
    if (!list || !list.length) return c.json({ error: "flights([{key, hash}])가 필요함 — 화면이 보여 준 목록" }, 400);
    const s = await deps.snapshot();
    const cands = new Map(candidatesOf(s, deps.teams()).map((t) => [t.key, t]));
    const at = deps.now();
    const lines: ReleaseLine[] = [];
    const skipped: { key: string; error: string }[] = [];
    for (const f of list) {
      const item = f && typeof f === "object" ? (f as { key?: unknown; hash?: unknown }) : {};
      const key = typeof item.key === "string" ? item.key : "";
      if (!cands.has(key)) {
        skipped.push({ key, error: `${key || "?"}는 발권할 수 있는 Todo FLIGHT가 아님` });
        continue;
      }
      const r = screenRelease(cands.get(key), key, item.hash, "bulk", at);
      if (r.ok) lines.push(r.value);
      else skipped.push({ key, error: r.error });
    }
    if (!lines.length) return c.json({ error: "발권한 FLIGHT가 없음", skipped }, 409);
    deps.append([...lines, { op: "arm", at: at.toISOString(), flights: lines.length }]);
    return c.json({ released: lines.length, skipped });
  });

  app.post("/api/releases/attest", async (c) => {
    const body = await readBody(c);
    if (!body) return c.json({ error: "본문은 JSON이어야 합니다" }, 400);
    const s = await deps.snapshot();
    const key = typeof body.flight === "string" ? body.flight : "";
    const r = attestedRelease(s.tickets.find((t) => t.key === key), body, deps.now());
    if (!r.ok) return c.json({ error: r.error }, r.status);
    deps.append([r.value]);
    return c.json({ release: r.value });
  });
}

// DUTY 채팅의 SUPERVISOR 글. 호출하는 곳은 Origin 검사를 거친 /api/duty/message뿐이다. 발권한 key를 돌려준다(없으면 빈 배열)
export async function releaseFromChat(text: string, snapshot: () => Promise<Snapshot>, deps: ReleaseDeps = defaultDeps(snapshot)): Promise<string[]> {
  const keys = chatReleaseKeys(text);
  if (!keys.length) return [];
  const s = await deps.snapshot();
  const lines: ReleaseLine[] = [];
  for (const key of keys) {
    const r = chatRelease(s.tickets.find((t) => t.key === key), key, text, deps.now());
    if (r.ok) lines.push(r.value);
  }
  deps.append(lines);
  return lines.flatMap((l) => (l.op === "release" ? [l.flight] : []));
}

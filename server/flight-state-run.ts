// FLIGHT 상태 버튼의 쓰기 길(DUTY G3, 외부 부작용: Linear에 쓴다). POST /api/flight/:key/state {from, to}.
// - 이 화면에서 온 JSON 요청만(fromThisApp, 아니면 403). 세션·CLI·curl은 Origin이 없어 못 지나간다. atcctl에는 이 명령이 없다
// - 서버는 스스로 Linear를 쓰지 않는다: 부르는 것은 SUPERVISOR의 클릭뿐이고, 스케줄러·주기·후크가 이 길을 부르지 않는다
// - 지금 상태가 아직 from일 때만(아니면 409), to는 이 팀의 Backlog·Todo·Canceled만(flight-state.ts). 토큰은 서버 안에만 있다
// - 한 번 옮길 때마다 FLIGHT RECORDER 한 줄(실패도)
import type { Hono } from "hono";
import { config } from "./config.ts";
import { flightKeyOf } from "./detail.ts";
import { forgetIssue } from "./detail-run.ts";
import { type MoveIssue, moveVerdict, parseMoveBody } from "./flight-state.ts";
import { fromThisApp } from "./origin.ts";
import { record } from "./recorder.ts";
import { applyIssueState, fetchMoveIssue } from "./sources/linear-write.ts";

export interface StateDeps {
  fetchIssue: (key: string) => Promise<MoveIssue | null>;
  apply: (id: string, stateId: string) => Promise<{ name: string; type: string }>;
  record: typeof record;
  forget: (key: string) => void;
  teams: readonly string[];
  now: () => Date;
}
const defaultDeps: StateDeps = { fetchIssue: fetchMoveIssue, apply: applyIssueState, record, forget: forgetIssue, teams: config.linearTeamKeys, now: () => new Date() };

export function mountFlightState(app: Hono, deps: StateDeps = defaultDeps) {
  app.post("/api/flight/:key/state", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다(SUPERVISOR 전용)" }, 403);
    const key = flightKeyOf(c.req.param("key"));
    if (!key) return c.json({ error: "FLIGHT key 형식이 아님" }, 400);
    const parsed = parseMoveBody(await c.req.json().catch(() => null));
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const { from, to } = parsed.move;
    const log = (ok: boolean, error?: string) => deps.record({ t: deps.now().toISOString(), kind: "flight", op: "state", flight: key, by: "SUPERVISOR", ok, from, to, ...(error ? { error } : {}) });
    try {
      const issue = await deps.fetchIssue(key);
      if (!issue) return c.json({ error: `${key}를 찾을 수 없음` }, 404);
      const v = moveVerdict(issue, parsed.move, deps.teams);
      if (!v.ok) {
        log(false, v.error);
        return c.json({ error: v.error }, v.status);
      }
      const now = await deps.apply(issue.id, v.stateId);
      deps.forget(key);
      log(true);
      return c.json({ ok: true, key, from, to: now.name, type: now.type });
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      log(false, msg);
      return c.json({ error: msg }, /미연결/.test(msg) ? 503 : 502);
    }
  });
}

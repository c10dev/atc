import type { Hono } from "hono";
import { isRole, ROLES } from "./squelch.ts";
import { type Fetcher, gatherInputs } from "./squelch-run.ts";
import { actionable } from "./tick.ts";

// GET /api/tick/:role (ATC-297): 그 역할의 /tick이 읽는 브리핑과, 거기에 할 일이 있는지(`actionable`). 읽기만 한다.
// `atcctl tick <role>`이 manual check 뒤에 부른다. 어떤 오류든 act: true로 답한다(조용하다고 잘못 말하지 않는다).
export function mountTick(app: Hono, deps: { get?: Fetcher } = {}) {
  const get: Fetcher =
    deps.get ??
    (async (path) => {
      const r = await app.request(path);
      if (!r.ok) throw new Error(`${path} → ${r.status}`);
      return r.json();
    });
  app.get("/api/tick/:role", async (c) => {
    const role = c.req.param("role") ?? "";
    if (!isRole(role)) return c.json({ error: `알 수 없는 역할 ${role} — ${ROLES.join("|")}` }, 404);
    try {
      const inputs = await gatherInputs(role, get);
      const a = actionable(role, inputs);
      // 세션이 읽을 브리핑: TOWER는 brief 그대로(cursor 포함), 나머지는 역할이 읽는 것들
      return c.json({ role, ...a, brief: role === "tower" ? inputs.brief : inputs });
    } catch (e) {
      return c.json({ role, act: true, reasons: ["error"], info: 0, brief: null, error: e instanceof Error ? e.message : String(e) });
    }
  });
}

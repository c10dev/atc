import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { isRole, ROLES } from "./squelch.ts";
import { type Fetcher, gatherInputs } from "./squelch-run.ts";
import { actionable, occKeysOf, persistentKeysOf } from "./tick.ts";

// GET /api/tick/:role (ATC-297): 그 역할의 /tick이 읽는 브리핑과, 거기에 할 일이 있는지(`actionable`).
// `atcctl tick <역할>`이 manual check 뒤에 부른다. 어떤 오류든 act: true로 답한다(조용하다고 잘못 말하지 않는다).
// TOWER·OCC의 "새로 보이면 한 번 알린다" 줄(FUEL, GitHub 오류, 외부 리뷰 제외, STRANDED …)은 상태에서 오므로, 세션에 이미 보인 항목의 key를
// state 폴더의 tick-seen.json에 적어 둔다. 이 파일은 이 라우트만 쓰고, 읽지 못하면 빈 것으로 본다(그러면 더 자주 act할 뿐이다).

const seenFile = () => join(config.stateDir, "tick-seen.json");

export function readSeen(file = seenFile()): Record<string, string[]> {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const out: Record<string, string[]> = {};
    for (const [role, v] of Object.entries(raw ?? {})) if (isRole(role) && Array.isArray(v)) out[role] = v.filter((x): x is string => typeof x === "string");
    return out;
  } catch {
    return {};
  }
}
function writeSeen(all: Record<string, string[]>, file = seenFile()) {
  mkdirSync(config.stateDir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(all)}\n`);
  renameSync(tmp, file);
}

// 다음 seen: 할 일로 답했으면 지금 있는 상태 항목 모두(세션이 브리핑으로 봤다), 조용했으면 사라진 것을 뺀 나머지(다시 생기면 새 것이다)
export function nextSeen(seen: readonly string[], keys: readonly string[], act: boolean): string[] {
  const now = new Set(keys);
  return act ? [...now].sort() : seen.filter((k) => now.has(k)).sort();
}

export function mountTick(app: Hono, deps: { get?: Fetcher; seenFile?: () => string } = {}) {
  const get: Fetcher =
    deps.get ??
    (async (path) => {
      const r = await app.request(path);
      if (!r.ok) throw new Error(`${path} → ${r.status}`);
      return r.json();
    });
  const file = deps.seenFile ?? seenFile;
  app.get("/api/tick/:role", async (c) => {
    const role = c.req.param("role") ?? "";
    if (!isRole(role)) return c.json({ error: `알 수 없는 역할 ${role} — ${ROLES.join("|")}` }, 404);
    try {
      const inputs = await gatherInputs(role, get);
      const all = readSeen(file());
      const seen = all[role] ?? [];
      const now = Date.now();
      const a = actionable(role, inputs, new Set(seen), now);
      if (role === "tower" || role === "occ") {
        const next = nextSeen(seen, role === "tower" ? persistentKeysOf(inputs.brief) : occKeysOf(inputs, now), a.act);
        if (next.join("\n") !== [...seen].sort().join("\n")) {
          try {
            writeSeen({ ...all, [role]: next }, file());
          } catch {}
        }
      }
      // 세션이 읽을 브리핑: TOWER는 brief 그대로(cursor 포함), 나머지는 역할이 읽는 것들
      return c.json({ role, ...a, brief: role === "tower" ? inputs.brief : inputs });
    } catch (e) {
      return c.json({ role, act: true, reasons: ["error"], info: 0, brief: null, error: e instanceof Error ? e.message : String(e) });
    }
  });
}

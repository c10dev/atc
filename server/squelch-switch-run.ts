import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { fromThisApp } from "./origin.ts";
import { isRole, modeOf, ROLES } from "./squelch.ts";
import { readState, writeState } from "./squelch-run.ts";
import { applyPatch, asChangeLine, type Change, type ChangeLine, changesThisWeek, lastChanges, parsePatch, resetAll } from "./squelch-switch.ts";

// SQUELCH 스위치 I/O(ATC-552, docs/squelch.md "Switch as built"). SUPERVISOR 화면(설정 창 CONTROL 블록)만 쓴다: Origin이 없거나 다른 사이트면 403.
// 관제 세션의 atcctl은 Origin을 보내지 않으니 이 길로 설정을 바꿀 수 없다. 읽기는 누구나. 바꾼 것은 모두 squelch-changes.jsonl에 덧붙인다.

const changesFile = () => join(config.stateDir, "squelch-changes.jsonl");

export function readChanges(): ChangeLine[] {
  try {
    return readFileSync(changesFile(), "utf8")
      .split("\n")
      .flatMap((l) => {
        try {
          const x = asChangeLine(JSON.parse(l));
          return x ? [x] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function appendChanges(changes: readonly Change[], by: string, now: number) {
  if (!changes.length) return;
  mkdirSync(config.stateDir, { recursive: true });
  const t = new Date(now).toISOString();
  appendFileSync(changesFile(), changes.map((c) => `${JSON.stringify({ t, by, ...c })}\n`).join(""));
}

// 화면이 그리는 모양: 역할마다 지금 값(읽을 때 틀린 값은 이미 기본값), 그 값이 역할 것인지 전체 것인지, 마지막 바뀜. 이 주의 바뀐 횟수
export function switchView(now = Date.now()) {
  const f = readState();
  const lines = readChanges();
  const last = lastChanges(lines);
  return {
    globalMode: f.config.mode,
    roles: Object.fromEntries(
      ROLES.map((r) => [
        r,
        {
          mode: modeOf(f.config, r),
          modeOwn: f.config.roles[r] !== undefined,
          heartbeatMin: f.config.heartbeatMin[r],
          fingerprint: f.config.fingerprint[r],
          last: last[r] ?? {},
        },
      ]),
    ),
    changes7d: changesThisWeek(lines, now),
    recent: lines.slice(-10).reverse(),
  };
}

const refused = { error: "이 화면에서 보낸 요청만 받습니다(SUPERVISOR 전용)" };

export function mountSquelchSwitch(app: Hono, now: () => number = Date.now) {
  app.get("/api/squelch-switch", (c) => c.json(switchView(now())));

  app.put("/api/squelch-switch/:role", async (c) => {
    if (!fromThisApp(c)) return c.json(refused, 403);
    const role = c.req.param("role") ?? "";
    if (!isRole(role)) return c.json({ error: `알 수 없는 역할 ${role} — ${ROLES.join("|")}` }, 404);
    const p = parsePatch(await c.req.json().catch(() => null));
    if (!p.ok) return c.json({ error: p.error }, 400);
    try {
      const file = readState();
      const { config: next, changes } = applyPatch(file.config, role, p.patch);
      file.config = { ...file.config, ...next };
      writeState(file);
      appendChanges(changes, "SUPERVISOR", now());
      return c.json({ ok: true, changes: changes.length, ...switchView(now()) });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  // 끄기: 모든 역할을 shadow·v1로 한 번에
  app.post("/api/squelch-switch/off", async (c) => {
    if (!fromThisApp(c)) return c.json(refused, 403);
    try {
      const file = readState();
      const { config: next, changes } = resetAll(file.config);
      file.config = { ...file.config, ...next };
      writeState(file);
      appendChanges(changes, "SUPERVISOR", now());
      return c.json({ ok: true, changes: changes.length, ...switchView(now()) });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });
}

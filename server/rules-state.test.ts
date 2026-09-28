import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { RulesRecord } from "../hooks/rules-drift.mjs";
import { rulesOfAircraft } from "./rules-state.ts";

const h = (t: string) => createHash("sha256").update(t).digest("hex");
const files: Record<string, string | null> = { "CLAUDE.md": "v2", "AGENTS.md": "a1" };
const read = (_root: string, _ref: string | null, f: string) => files[f] ?? null;
const since = (_root: string, _ref: string | null, f: string) => (f === "CLAUDE.md" ? "2026-09-28T03:00:00.000Z" : "2026-09-28T01:00:00.000Z");
const rec = (sessionId: string, acked: Record<string, string | null>): RulesRecord => ({
  v: 1,
  sessionId,
  root: "/repo",
  ref: "origin/main",
  files: ["CLAUDE.md", "AGENTS.md"],
  startedAt: "2026-09-28T00:00:00Z",
  checkedAt: "2026-09-28T00:00:00Z",
  acked,
});

test("RULES: 기록 없는 AIRCRAFT는 null(hook 없음), 모두 확인했으면 current", () => {
  assert.equal(rulesOfAircraft([{ id: "s1" }], [], read, since), null);
  assert.deepEqual(rulesOfAircraft([{ id: "s1" }], [rec("s1", { "CLAUDE.md": h("v2"), "AGENTS.md": h("a1") })], read, since), { current: true, behind: [], since: null, sessions: 1 });
});

test("RULES: 세션 하나라도 뒤처지면 미확인. 파일과 가장 이른 변경 시각", () => {
  const records = [rec("s1", { "CLAUDE.md": h("v2"), "AGENTS.md": h("a1") }), rec("s2", { "CLAUDE.md": h("v1"), "AGENTS.md": h("a0") }), rec("other", { "CLAUDE.md": null, "AGENTS.md": null })];
  assert.deepEqual(rulesOfAircraft([{ id: "s1" }, { id: "s2" }], records, read, since), { current: false, behind: ["AGENTS.md", "CLAUDE.md"], since: "2026-09-28T01:00:00.000Z", sessions: 2 });
});

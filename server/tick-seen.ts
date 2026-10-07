import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { isRole } from "./squelch.ts";

// tick-seen.json(ATC-297): 세션에 이미 한 번 보인 상태 항목의 key. GET /api/tick이 쓰고 CONTROL WAKE(ATC-557)가 읽는다(순환 없이 두 곳이 같이 쓰게 따로 둔다)
export const seenFile = () => join(config.stateDir, "tick-seen.json");

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
export function writeSeen(all: Record<string, string[]>, file = seenFile()) {
  mkdirSync(config.stateDir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(all)}\n`);
  renameSync(tmp, file);
}


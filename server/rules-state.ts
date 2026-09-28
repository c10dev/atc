import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import { readRecords, readSource, type RulesRecord, statusOf } from "../hooks/rules-drift.mjs";
import { config } from "./config.ts";
import type { Session } from "./model.ts";

// FLEET 카드의 RULES 줄(ATC-42). hooks/rules-drift.mjs가 세션마다 남긴 확인 해시(~/.local/state/atc/rules-ack/)를
// 지금 규칙 파일과 비교한다. 세션이 쉬고 있어 hook이 돌지 않아도 여기서 뒤처진 것이 보인다. 읽기만 한다.

export interface RulesView {
  current: boolean;
  behind: string[]; // 아직 확인하지 않은 규칙 파일
  since: string | null; // 그 파일이 바뀐 시각(가장 이른 것). 모르면 null
  sessions: number; // 기록이 있는 살아 있는 세션 수
}

type Reader = (root: string, ref: string | null, file: string) => string | null;
type SinceOf = (root: string, ref: string | null, file: string) => string | null;

// 한 AIRCRAFT의 살아 있는 세션들 → RULES 상태. 기록이 있는 세션이 없으면 null(hook이 없거나 아직 안 돎)
export function rulesOfAircraft(sessions: Pick<Session, "id">[], records: RulesRecord[], read: Reader = readSource, sinceOf: SinceOf = changedAt): RulesView | null {
  const byId = new Map(records.map((r) => [r.sessionId, r]));
  const mine = sessions.map((s) => byId.get(s.id)).filter((r): r is RulesRecord => Boolean(r));
  if (!mine.length) return null;
  const behind = new Map<string, string | null>(); // 파일 → 바뀐 시각
  for (const r of mine) {
    for (const f of statusOf(r, read).behind) if (!behind.has(f)) behind.set(f, sinceOf(r.root, r.ref ?? null, f));
  }
  const times = [...behind.values()].filter((t): t is string => Boolean(t)).sort();
  return { current: behind.size === 0, behind: [...behind.keys()].sort(), since: times[0] ?? null, sessions: mine.length };
}

// 규칙 파일이 마지막으로 바뀐 시각: ref에 있는 파일이면 그 ref의 마지막 커밋, 아니면(작업 트리에서 읽는 파일) mtime
export function changedAt(root: string, ref: string | null, file: string): string | null {
  try {
    if (ref) {
      const out = execFileSync("git", ["-C", root, "log", "-1", "--format=%cI", ref, "--", file], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (out) return new Date(out).toISOString();
    }
    return statSync(join(root, file)).mtime.toISOString();
  } catch {
    return null;
  }
}

export const loadRulesRecords = () => readRecords(join(config.stateDir, "rules-ack"));

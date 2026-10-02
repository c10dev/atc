import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.ts";

// AIRCRAFT policy hook(ATC-369): 모든 AIRCRAFT LAUNCH는 `--settings`로 PermissionRequest hook(hooks/policy.mjs)을 싣는다.
// 프롬프트가 뜰 호출은 이 hook이 정한다 — STAND 안의 알려진 안전한 동작은 허용, 나머지는 거절하고 `policy-denials.jsonl`에 분류만 남긴다.
// 여기는 settings JSON을 만들고 거절 기록을 읽어 세는 순수 함수와 얇은 파일 읽기. 기존 guard·hook은 건드리지 않는다(--settings는 더해진다).
// 관제 세션(TOWER·OCC·MCC·CROSSCHECK·REVIEW)과 DUTY는 이 hook을 받지 않는다 — 폴더의 CLAUDE.md와 guard가 정한다.

export const DENIAL_FILE = "policy-denials.jsonl";
export const HOOK_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "hooks", "policy.mjs");
const DAY_MS = 86_400_000;

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// 세션이 부르는 명령: node <hook> --state <상태 폴더> --aircraft <REGISTRATION>
export function hookCommandOf(aircraft: string, stateDir = config.stateDir, hookFile = HOOK_FILE): string {
  return `node ${sq(hookFile)} --state ${sq(stateDir)} --aircraft ${sq(aircraft)}`;
}

// `claude --bg --settings <이 문자열>`. hooks는 사용자·프로젝트의 hooks에 더해진다
export function policySettingsOf(aircraft: string, stateDir = config.stateDir, hookFile = HOOK_FILE): string {
  return JSON.stringify({ hooks: { PermissionRequest: [{ hooks: [{ type: "command", command: hookCommandOf(aircraft, stateDir, hookFile), timeout: 10 }] }] } });
}

export interface Denial {
  t: string;
  aircraft: string | null;
  session: string | null;
  tool: string | null;
  cls: string;
}

export function readDenials(file = join(config.stateDir, DENIAL_FILE)): Denial[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: Denial[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const d = JSON.parse(line) as Denial;
      if (typeof d.t === "string" && typeof d.cls === "string") out.push(d);
    } catch {}
  }
  return out;
}

// 최근 windowMs 안의 거절을 class별·AIRCRAFT별로 센다(화면 DENIALS 줄)
export interface DenialSummary {
  windowH: number;
  total: number;
  byClass: { cls: string; n: number }[]; // 많은 순
  byAircraft: { aircraft: string; n: number }[];
  lastAt: string | null;
}

export function summarizeDenials(lines: readonly Denial[], now: number, windowMs = DAY_MS): DenialSummary {
  const recent = lines.filter((d) => {
    const t = Date.parse(d.t);
    return Number.isFinite(t) && now - t <= windowMs && t <= now + 60_000;
  });
  const count = (key: (d: Denial) => string | null) => {
    const m = new Map<string, number>();
    for (const d of recent) {
      const k = key(d);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  return {
    windowH: Math.round(windowMs / 3_600_000),
    total: recent.length,
    byClass: count((d) => d.cls).map(([cls, n]) => ({ cls, n })),
    byAircraft: count((d) => d.aircraft).map(([aircraft, n]) => ({ aircraft, n })),
    lastAt: recent.length ? recent.map((d) => d.t).sort().at(-1)! : null,
  };
}

// ── 화면: AIRCRAFT PENDING 수(0이어야 한다)와 거절 ──
export interface PolicyView {
  pending: { count: number; aircraft: string[] }; // PENDING approval에 선 AIRCRAFT. 정상이면 0
  denials: DenialSummary;
  staleStop: { mode: "on" | "off"; stopped24h: number; failed24h: number };
}

export function pendingAircraftOf(sessions: readonly { name: string; status: string; health?: { code: string } | null }[], teamPattern: string): string[] {
  const team = new RegExp(teamPattern, "i");
  return sessions.filter((x) => x.status !== "dead" && team.test(x.name) && x.health?.code === "PENDING").map((x) => x.name).sort();
}

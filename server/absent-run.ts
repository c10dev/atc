import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import type { FleetFile } from "./crew.ts";
import { type AbsentAircraft, absentOf, type CutInfo, cutAtOfText, lastReportLineOf } from "./dispatch-launch.ts";
import type { Session } from "./model.ts";
import { readRecords } from "./recorder.ts";
import { regKey } from "./registration.ts";
import type { Restarting } from "./restarting.ts";

// 세션이 없는 백그라운드 AIRCRAFT 읽기(ATC-129). 계산은 dispatch-launch.ts의 순수 함수, 여기는 읽기만(쓰기 없음).
// - 백그라운드 출처: FLIGHT RECORDER의 성공한 atc LAUNCH(14일). 그 LAUNCH의 job id로 대화 기록을 찾는다
// - cut: 그 대화 기록 끝(96KB)이 한도로 잘린 턴으로 끝났나(ATC-86). reset은 부르는 쪽(snapshot.ts)이 ACCOUNT의 FUEL 기록에서 되짚는다

const LAUNCH_DAYS = 14;
const LAUNCH_TTL_MS = 60_000; // FLIGHT RECORDER는 크니 1분에 한 번만 읽는다
const PATH_TTL_MS = 60_000;
const TAIL = 96 * 1024;

type LaunchRow = { t: string; jobId?: string; permissionMode?: string; model?: string };
let launchCache: { at: number; rows: Map<string, LaunchRow> } | null = null;

// REGISTRATION → 마지막으로 성공한 atc LAUNCH
function lastLaunches(now: number, teamPattern: string): Map<string, LaunchRow> {
  if (launchCache && now - launchCache.at < LAUNCH_TTL_MS) return launchCache.rows;
  const rows = new Map<string, LaunchRow>();
  const sorted = readRecords(now - LAUNCH_DAYS * 86_400_000)
    .filter((r) => r.kind === "fleet" && r.op === "launch" && r.ok)
    .sort((a, b) => a.t.localeCompare(b.t));
  for (const r of sorted) {
    if (r.kind !== "fleet") continue;
    rows.set(regKey(r.aircraft, teamPattern), { t: r.t, ...(r.jobId ? { jobId: r.jobId } : {}), ...(r.permissionMode ? { permissionMode: r.permissionMode } : {}), ...(r.model ? { model: r.model } : {}) });
  }
  launchCache = { at: now, rows };
  return rows;
}

// job id(세션 id 앞자리)로 대화 기록 찾기: ~/.claude/projects/*/<jobId>-….jsonl. 워크트리로 옮긴 세션은 그 폴더에 있다
const pathCache = new Map<string, { at: number; path: string | null }>();
function transcriptOf(jobId: string, now: number, root = join(config.claudeDir, "projects")): string | null {
  if (!/^[0-9a-f]{6,}$/.test(jobId)) return null;
  const hit = pathCache.get(jobId);
  if (hit && (hit.path || now - hit.at < PATH_TTL_MS)) return hit.path;
  let found: string | null = null;
  try {
    for (const proj of readdirSync(root)) {
      let names: string[] = [];
      try {
        names = readdirSync(join(root, proj));
      } catch {
        continue;
      }
      const f = names.find((n) => n.startsWith(`${jobId}-`) && n.endsWith(".jsonl"));
      if (f) {
        found = join(root, proj, f);
        break;
      }
    }
  } catch {}
  pathCache.set(jobId, { at: now, path: found });
  return found;
}

// 대화 기록 끝 → cut(시각, 마지막 보고 줄). 크기·mtime으로 캐시
const cutCache = new Map<string, { key: string; cut: { cutAt: number; report: string | null } | null }>();
function cutOfTranscript(path: string): { cutAt: number; report: string | null } | null {
  let st;
  try {
    st = statSync(path);
  } catch {
    return null;
  }
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = cutCache.get(path);
  if (hit?.key === key) return hit.cut;
  let cut: { cutAt: number; report: string | null } | null = null;
  try {
    const fd = openSync(path, "r");
    try {
      const len = Math.min(st.size, TAIL);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, st.size - len);
      let text = buf.toString("utf8");
      if (len < st.size) text = text.slice(text.indexOf("\n") + 1);
      const at = cutAtOfText(text);
      cut = at === null ? null : { cutAt: at, report: lastReportLineOf(text) };
    } finally {
      closeSync(fd);
    }
  } catch {}
  cutCache.set(path, { key, cut });
  return cut;
}

export interface AbsentInput {
  sessions: readonly Pick<Session, "name" | "status">[];
  restarting: readonly Pick<Restarting, "registration">[];
  fleet: FleetFile;
  teamPattern: string;
  now: number;
  // cut 시각과 그 세션 id → reset(ACCOUNT의 FUEL 기록, health.ts cutResetOf). 모르면 null
  resetOf: (cutAt: number, sessionId: string, registration: string) => { resetsAt: number; weekly: boolean } | null;
}

export function readAbsent(i: AbsentInput): AbsentAircraft[] {
  const reg = (name: string) => regKey(name, i.teamPattern);
  const keys = Object.keys(i.fleet.aircraft);
  return absentOf(
    lastLaunches(i.now, i.teamPattern),
    {
      liveRegs: new Set(i.sessions.filter((x) => x.status !== "dead").map((x) => reg(x.name))),
      restarting: new Set(i.restarting.map((r) => r.registration)),
      registered: new Set(keys.map(reg)),
      retired: new Set(keys.filter((k) => i.fleet.aircraft[k]?.retired).map(reg)),
    },
    (registration, jobId): CutInfo | null => {
      const path = jobId ? transcriptOf(jobId, i.now) : null;
      const cut = path ? cutOfTranscript(path) : null;
      if (!path || !cut) return null;
      const sessionId = path.slice(path.lastIndexOf("/") + 1, -".jsonl".length);
      const reset = i.resetOf(cut.cutAt, sessionId, registration);
      return {
        sessionId,
        cutAt: new Date(cut.cutAt).toISOString(),
        resetsAt: reset ? new Date(reset.resetsAt).toISOString() : null,
        ...(reset?.weekly ? { weekly: true } : {}),
        report: cut.report,
      };
    },
  );
}

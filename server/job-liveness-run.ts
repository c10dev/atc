import type { Hono } from "hono";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { accountFolders } from "./accounts.ts";
import { config } from "./config.ts";
import { dropLivenessSwitchCache, loadLivenessSwitch } from "./job-liveness-io.ts";
import { countsOf, initDeathHoldOf, initDeathOf, type LaunchTry, type LivenessCounts, type LivenessLine, type LivenessOp, type LivenessSwitch } from "./job-liveness.ts";
import { readJob } from "./job-state.ts";
import type { Snapshot } from "./model.ts";
import { readRecords, type RecordLine, record } from "./recorder.ts";
import { regKey } from "./registration.ts";

// JOB LIVENESS의 기록과 화면 자료(ATC-534). 판정은 job-liveness.ts(순수), 프로세스·roster 읽기는 job-liveness-io.ts.
// 결정은 새 파일 없이 FLIGHT RECORDER(kind "job-liveness")에 남고, 오작동 수(이 검사 때문에 카드를 다시 띄우거나 넘긴 수)는 거기서 센다.

const SWITCH_FILE = () => join(config.stateDir, "job-liveness.json");
const DAY = 86_400_000;
const LOOKBACK_MS = 30 * DAY;
const LAUNCH_LOOKBACK_MS = 14 * DAY;

// 바뀐 것만 FLIGHT RECORDER에 남긴다. 임시 파일을 넘기면(시험) 운영 기록에 쓰지 않는다
export function saveLivenessSwitch(v: LivenessSwitch, by = "SUPERVISOR", file = SWITCH_FILE()) {
  const from = loadLivenessSwitch(file);
  if (from === v) return;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ mode: v }, null, 2) + "\n");
  renameSync(tmp, file);
  dropLivenessSwitchCache();
  if (file === SWITCH_FILE()) record({ t: new Date().toISOString(), kind: "policy", op: "job-liveness-mode", by, from, to: v });
}

const livenessOf = (recs: readonly RecordLine[]): LivenessLine[] => recs.flatMap((r) => (r.kind === "job-liveness" ? [r] : []));
export const livenessLines = (sinceMs = Date.now() - LOOKBACK_MS): LivenessLine[] => livenessOf(readRecords(sinceMs));

export function noteLiveness(op: LivenessOp, registration: string, extra: Partial<Pick<LivenessLine, "jobId" | "proposal" | "detail">> = {}, now = new Date()) {
  record({ t: now.toISOString(), kind: "job-liveness", op, registration, ...extra });
}

// 설정 창과 METRICS가 읽는 자료
export interface LivenessData {
  mode: LivenessSwitch;
  last7d: LivenessCounts;
  last30d: LivenessCounts;
  recent: LivenessLine[]; // 최근 다섯 줄(새것 먼저)
}
export function livenessData(now = Date.now(), lines = livenessLines(now - LOOKBACK_MS), mode = loadLivenessSwitch()): LivenessData {
  return { mode, last7d: countsOf(lines, now - 7 * DAY, now + 1), last30d: countsOf(lines, now - LOOKBACK_MS, now + 1), recent: [...lines].sort((a, b) => b.t.localeCompare(a.t)).slice(0, 5) };
}

// timeline.jsonl의 줄 수(job이 상태를 몇 번 적었나). 못 읽으면 null
export function timelineEntries(jobId: string, dirs: readonly string[] = accountFolders().map((f) => join(f.dir, "jobs"))): number | null {
  if (!/^[0-9a-f]{6,}$/.test(jobId)) return null;
  for (const d of dirs) {
    const p = join(d, jobId, "timeline.jsonl");
    if (!existsSync(p)) continue;
    try {
      return readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).length;
    } catch {}
  }
  return null;
}

// 그 REGISTRATION의 성공한 LAUNCH(오래된 것부터)
export function launchTriesOf(reg: string, recs: readonly RecordLine[], teamPattern?: string): LaunchTry[] {
  const out: LaunchTry[] = [];
  for (const r of [...recs].sort((a, b) => a.t.localeCompare(b.t))) {
    if (r.kind === "fleet" && r.op === "launch" && r.ok && regKey(r.aircraft, teamPattern) === reg) out.push({ t: r.t, ...(r.jobId ? { jobId: r.jobId } : {}), by: r.by });
  }
  return out;
}
export const deadJobsOf = (lines: readonly LivenessLine[]): Set<string> => new Set(lines.flatMap((l) => (l.op === "init-death" && l.jobId ? [l.jobId] : [])));

// 서버가 이 REGISTRATION을 또 자동으로 띄우면 안 되는가(init에서 연달아 죽었다)
export function initHoldOf(reg: string, teamPattern?: string, now = Date.now()): boolean {
  const recs = readRecords(now - 14 * DAY);
  return initDeathHoldOf(launchTriesOf(reg, recs, teamPattern), deadJobsOf(livenessOf(recs)));
}

// 이미 적은 (op|job). 처음 부를 때 한 번 읽고 그 뒤로는 메모리로 센다(서버를 다시 켜면 기록에서 되살린다). 시험이 비운다
let seenMem: Set<string> | null = null;
export const resetLivenessSeen = () => {
  seenMem = null;
};

// 1분마다: 사라진 job을 한 번씩 적고, init에서 죽은 LAUNCH를 한 번씩 적는다(job마다 한 줄). 읽고 적을 뿐 아무것도 멈추거나 띄우지 않는다
export function trackLiveness(s: Pick<Snapshot, "sessions">, now = Date.now(), teamPattern?: string): { gone: number; initDeath: number } {
  const out = { gone: 0, initDeath: 0 };
  if (loadLivenessSwitch() === "off") return out;
  const gone = s.sessions.filter((x) => x.status === "dead" && x.jobGone && x.jobId);
  if (!gone.length) return out;
  const recs = readRecords(now - LAUNCH_LOOKBACK_MS);
  seenMem ??= new Set(livenessOf(recs).flatMap((r) => ((r.op === "gone" || r.op === "init-death") && r.jobId ? [`${r.op}|${r.jobId}`] : [])));
  const seen = seenMem;
  for (const x of gone) {
    const jobId = x.jobId!;
    const reg = regKey(x.name, teamPattern);
    if (!seen.has(`gone|${jobId}`)) {
      noteLiveness("gone", reg, { jobId, detail: x.jobGone! }, new Date(now));
      seen.add(`gone|${jobId}`);
      out.gone++;
    }
    if (seen.has(`init-death|${jobId}`)) continue;
    const launch = launchTriesOf(reg, recs, teamPattern).find((l) => l.jobId === jobId);
    if (!launch) continue; // atc가 띄운 job이 아니다
    const lastWrite = Date.parse(readJob(jobId)?.writtenAt ?? "");
    if (initDeathOf({ launchedAt: Date.parse(launch.t), entries: timelineEntries(jobId) ?? Infinity, lastWriteAt: Number.isFinite(lastWrite) ? lastWrite : null, gone: true })) {
      noteLiveness("init-death", reg, { jobId, detail: "LAUNCH가 첫 IN SERVICE 뒤로 아무것도 쓰지 못하고 프로세스가 없어짐" }, new Date(now));
      seen.add(`init-death|${jobId}`);
      out.initDeath++;
    }
  }
  return out;
}

// GET /api/job-liveness: 스위치·7일·30일 수·최근 줄(읽기만). 스위치를 바꾸는 길은 설정 창(PUT /api/settings)뿐이다
export function mountJobLiveness(app: Hono) {
  app.get("/api/job-liveness", (c) => c.json(livenessData()));
}

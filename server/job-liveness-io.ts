import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { jobProofOf, type LivenessSwitch, parseLivenessSwitch, type Proof, type Roster, rosterOf } from "./job-liveness.ts";

// JOB LIVENESS의 읽기(ATC-534): 프로세스 확인, daemon roster, 스위치 파일. 기록과 화면 자료는 job-liveness-run.ts. 읽기만 한다.

// pid 재사용을 피하려고 /proc/<pid>/stat의 starttime(22번째 필드)까지 맞춘다. procStart가 없으면 pid만 본다
export function procAlive(pid: number, procStart?: string | null): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    if (!procStart) return true;
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] === procStart;
  } catch {
    return false;
  }
}

const SWITCH_FILE = () => join(config.stateDir, "job-liveness.json");
let switchHit: { at: number; v: LivenessSwitch } | null = null;
// 스냅샷마다 부르므로 짧게 아낀다. 저장하면 바로 비운다
export function loadLivenessSwitch(file = SWITCH_FILE(), now = Date.now()): LivenessSwitch {
  const real = file === SWITCH_FILE();
  if (real && switchHit && now - switchHit.at < 5_000) return switchHit.v;
  let v: LivenessSwitch = "on";
  try {
    v = parseLivenessSwitch(JSON.parse(readFileSync(file, "utf8")).mode);
  } catch {}
  if (real) switchHit = { at: now, v };
  return v;
}
export const dropLivenessSwitchCache = () => {
  switchHit = null;
};

// 폴더(ACCOUNT)마다 daemon/roster.json. 크기·mtime으로 캐시. daemon(supervisor)이 죽어 있으면 roster는 믿을 수 없어 null
const rosterCache = new Map<string, { key: string; roster: Roster | null }>();
export function readRoster(configDir: string): Roster | null {
  const file = join(configDir, "daemon", "roster.json");
  let key = "-";
  try {
    const st = statSync(file);
    key = `${st.mtimeMs}:${st.size}`;
  } catch {
    return null;
  }
  const hit = rosterCache.get(file);
  let roster: Roster | null;
  if (hit?.key === key) roster = hit.roster;
  else {
    try {
      roster = rosterOf(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      roster = null;
    }
    rosterCache.set(file, { key, roster });
  }
  if (roster && (roster.supervisorPid === null || !procAlive(roster.supervisorPid))) return null; // daemon이 없는데 roster만 남았다
  return roster;
}

// 세션 파일 하나의 증거. 세션이 bg가 아니거나 jobId가 없으면 unknown(지금 규칙)
export function proofOfSession(s: { kind?: string; jobId?: string; pid: number; procStart?: string }, configDir: string): Proof {
  if ((s.kind !== "bg" && s.kind !== "background") || !s.jobId) return "unknown";
  return jobProofOf({
    jobId: s.jobId,
    roster: readRoster(configDir),
    workerAlive: (w) => procAlive(w.pid, w.procStart),
    sessionVerified: Boolean(s.procStart) && procAlive(s.pid, s.procStart),
  });
}

// JOB LIVENESS(ATC-534, docs/fleet.md "as built (ATC-534)"): 백그라운드 AIRCRAFT의 job에 살아 있는 프로세스가 있다는 증거를 본다. 순수 함수만 둔다(읽기·기록은 job-liveness-run.ts).
// 사건(2026-10-04): TEAM_B(job c528fe7b)는 IN SERVICE 한 줄만 쓰고 죽었는데 FLEET는 idle로 보였고, 승인된 VOC-379 카드는 보낼 곳 없이 기다렸다(approvedNoSession이 0).
// state.json만으로는 살았는지 알 수 없다: 증거는 프로세스다(daemon의 roster.json이 job마다 pid와 procStart를 적는다).
// 스위치는 SUPERVISOR만 바꾼다(설정 창). 끄면 지금 규칙(세션 파일의 pid)으로 돌아간다.

export type LivenessSwitch = "off" | "on";
export const LIVENESS_SWITCHES: readonly LivenessSwitch[] = ["off", "on"];
// 파일에 없거나 모르는 값이면 on(live first). 끄는 것은 SUPERVISOR가 쓴 off뿐이다
export const parseLivenessSwitch = (v: unknown): LivenessSwitch => (v === "off" ? "off" : "on");

// ── daemon roster ──
export interface Worker {
  pid: number;
  procStart: string | null;
}
export interface Roster {
  supervisorPid: number | null;
  workers: ReadonlyMap<string, Worker>; // job id → worker
}
// ~/.claude/daemon/roster.json(파싱한 값) → Roster. 모르는 모양이면 null(그때는 증거가 없는 것이지 "없음"이 아니다)
export function rosterOf(raw: unknown): Roster | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!r.workers || typeof r.workers !== "object" || Array.isArray(r.workers)) return null;
  const workers = new Map<string, Worker>();
  for (const [id, w] of Object.entries(r.workers as Record<string, unknown>)) {
    if (!w || typeof w !== "object") continue;
    const o = w as Record<string, unknown>;
    if (typeof o.pid !== "number" || !Number.isInteger(o.pid)) continue;
    workers.set(id, { pid: o.pid, procStart: typeof o.procStart === "string" ? o.procStart : null });
  }
  return { supervisorPid: typeof r.supervisorPid === "number" ? r.supervisorPid : null, workers };
}

export type Proof = "live" | "gone" | "unknown";
export interface ProofInput {
  jobId: string;
  roster: Roster | null; // 그 ACCOUNT 폴더의 roster. 못 읽었거나 daemon이 죽어 있으면 null
  workerAlive: (w: Worker) => boolean; // pid가 살아 있고 procStart까지 맞다
  sessionVerified: boolean; // 세션 파일의 pid가 살아 있고 procStart까지 맞다(pid 재사용이 아니다)
}
// 살아 있다는 증거가 하나라도 있으면 live. 둘 다 없고 roster를 믿을 수 있으면 gone. roster를 못 믿으면 unknown(지금 규칙)
// 잘못 gone이라 하면 같은 AIRCRAFT를 두 번 띄우므로 증거가 있는 쪽으로 기운다
export function jobProofOf(i: ProofInput): Proof {
  const w = i.roster?.workers.get(i.jobId);
  if (w && i.workerAlive(w)) return "live";
  if (i.sessionVerified) return "live";
  return i.roster ? "gone" : "unknown";
}

const hhmm = (iso: string) => `${iso.slice(11, 16)}Z`;
// `job gone (last state 13:16Z)`. 마지막 기록 시각을 모르면 시각 없이
export const jobGoneWhyOf = (lastStateAt: string | null | undefined): string => (lastStateAt && !Number.isNaN(Date.parse(lastStateAt)) ? `job gone (last state ${hhmm(new Date(lastStateAt).toISOString())})` : "job gone");

// ── init에서 죽은 LAUNCH ──
export const INIT_DEATH_MIN = 10; // LAUNCH 뒤 이 분 안에 마지막으로 쓰고 프로세스가 없어진 job
export interface InitDeathInput {
  launchedAt: number; // ms
  entries: number; // timeline.jsonl의 줄 수
  lastWriteAt: number | null; // state.json을 마지막으로 쓴 시각(ms)
  gone: boolean; // 프로세스 증거가 gone
  windowMin?: number;
}
// 첫 IN SERVICE 줄 뒤로 아무것도 쓰지 못하고(줄 하나 이하), 그 쓴 시각이 LAUNCH 뒤 windowMin 안이고, 프로세스가 없다
export function initDeathOf(i: InitDeathInput): boolean {
  if (!i.gone || i.entries > 1 || i.lastWriteAt === null) return false;
  const dt = i.lastWriteAt - i.launchedAt;
  return dt >= 0 && dt <= (i.windowMin ?? INIT_DEATH_MIN) * 60_000;
}

export interface LaunchTry {
  t: string;
  jobId?: string;
  by: string;
}
// 사람이 띄운 LAUNCH의 by(FLEET 카드의 LAUNCH 버튼). 그 밖(DISPATCH 자동 승인, FLEET PLAN …)은 서버가 띄운 것이다
export const MANUAL_LAUNCH_BY = "SUPERVISOR";
const isAuto = (by: string) => by !== MANUAL_LAUNCH_BY;
// 같은 REGISTRATION의 성공한 LAUNCH(오래된 것부터)와 init에서 죽은 job들 → 서버가 또 자동으로 띄우면 안 되는가.
// 가장 최근 둘이 모두 init에서 죽었고 가장 최근이 서버가 띄운 것이면 막는다. 사람이 띄운 LAUNCH(SUPERVISOR)는 막지 않고, 그 뒤 또 죽으면 다시 센다
export function initDeathHoldOf(tries: readonly LaunchTry[], dead: ReadonlySet<string>): boolean {
  const last = tries.slice(-2);
  if (last.length < 2) return false;
  if (!last.every((x) => x.jobId && dead.has(x.jobId))) return false;
  return isAuto(last[1]!.by);
}

// ── 기록 줄(FLIGHT RECORDER kind "job-liveness") ──
export type LivenessOp = "gone" | "init-death" | "relaunch" | "handoff" | "hold";
export interface LivenessLine {
  t: string;
  kind: "job-liveness";
  op: LivenessOp;
  registration: string;
  jobId?: string;
  proposal?: string;
  detail?: string;
}

export interface LivenessCounts {
  gone: number;
  initDeath: number;
  relaunch: number;
  handoff: number;
  hold: number;
  misfires: number; // 이 검사 때문에 카드를 다시 띄우거나 넘긴 수(relaunch + handoff)
}
export function countsOf(lines: readonly LivenessLine[], from: number, to: number): LivenessCounts {
  const c: LivenessCounts = { gone: 0, initDeath: 0, relaunch: 0, handoff: 0, hold: 0, misfires: 0 };
  for (const l of lines) {
    const t = Date.parse(l.t);
    if (!(t >= from && t < to)) continue;
    if (l.op === "gone") c.gone++;
    else if (l.op === "init-death") c.initDeath++;
    else if (l.op === "relaunch") c.relaunch++;
    else if (l.op === "handoff") c.handoff++;
    else if (l.op === "hold") c.hold++;
  }
  c.misfires = c.relaunch + c.handoff;
  return c;
}

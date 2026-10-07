// CONTROL ABSENT(ATC-532, docs/control-recycle.md "As built: CONTROL ABSENT"): 관제 세션이 한도보다 오래 없으면 atc가 스스로 다시 띄우거나(이전 job이 사라졌다는 증거가 있을 때),
// 화면이 열려 있지 않아도 SUPERVISOR에게 닿는 WARNING을 올린다. 순수 함수만 — 읽기·기록·LAUNCH는 control-absent-run.ts.
// 사건: 2026-10-03/04 TOWER 약 5.5시간·MCC 약 4시간 없음(ATC-531), 2026-10-07 03:23Z 호스트 재부팅 뒤 TOWER·MCC·OCC·REVIEW가 SUPERVISOR가 손으로 띄울 때까지 없음.
// 스위치(다시 띄우기·알림·조용한 시간 통과·한도)는 SUPERVISOR만 바꾼다(설정 창). 관제 세션은 못 바꾼다.

const MIN = 60_000;
const DAY = 86_400_000;

export type OnOff = "off" | "on";
export const ON_OFF: readonly OnOff[] = ["off", "on"];
// 한도(분). 설정 창에서 고른다. 10~60, 기본 20
export const ABSENT_LIMITS = ["10", "15", "20", "30", "45", "60"] as const;
export type AbsentLimit = (typeof ABSENT_LIMITS)[number];
export const DEFAULT_LIMIT_MIN = 20;

export interface AbsentSettings {
  relaunch: OnOff; // 증거가 있으면 atc가 다시 띄운다
  escalate: OnOff; // 못 띄우면 WARNING을 올리고 되풀이한다
  quietPass: OnOff; // 그 WARNING은 조용한 시간에도 소리를 낸다(passQuiet)
  limitMin: number;
}
// 파일에 없거나 모르는 값이면 기본(모두 on, 20분). 끄는 것은 SUPERVISOR가 쓴 off뿐이다(live first)
export function parseAbsentSettings(raw: unknown): AbsentSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sw = (v: unknown): OnOff => (v === "off" ? "off" : "on");
  const lim = typeof o.limitMin === "number" && (ABSENT_LIMITS as readonly string[]).includes(String(o.limitMin)) ? o.limitMin : DEFAULT_LIMIT_MIN;
  return { relaunch: sw(o.relaunch), escalate: sw(o.escalate), quietPass: sw(o.quietPass), limitMin: lim };
}

// 서버가 (다시) 뜬 뒤 첫 스냅샷부터 이만큼 기다리고, 그때도 없는 역할은 20분을 기다리지 않고 판단한다.
// 2분인 까닭: 막 뜨거나 멈춘 세션의 행이 나타나기까지의 유예(CONTROL_DOWN_GRACE_MS)와 STALE 판정 나이(STALE_MIN_AGE_MS)가 2분이다.
// 그 안에는 claude agents 목록과 세션 파일이 아직 자리를 잡지 않았을 수 있고, 같은 때 SUPERVISOR나 RTS가 띄운 세션이 보일 시간이다
export const STARTUP_SETTLE_MS = 2 * MIN;
export const ESCALATE_REPEAT_MS = 30 * MIN; // WARNING을 새 key로 다시 올리는 간격(한도보다 느리게)
export const RELAUNCH_COOLDOWN_MS = 60 * MIN; // 한 역할을 자동으로 다시 띄우는 것은 한 시간에 한 번(init에서 죽는 세션을 되풀이해 띄우지 않게). 서버가 뜬 직후는 예외
export const DUP_WINDOW_MS = 60 * MIN; // 다시 띄운 뒤 이 안에 같은 이름의 job 중복 경고(ATC-521)가 뜨면 오작동

// ── 증거: 이전 job이 사라졌나 ──
export type Proof = "live" | "gone" | "unknown";
export interface ProofFacts {
  liveRows: readonly string[]; // claude agents의 살아 있는(STALE 아닌) 그 역할 줄(id나 이름)
  cwdPids: readonly number[]; // cwd가 그 관제 폴더인 프로세스
  lastJob: { id: string; launchedAt: number } | null; // FLIGHT RECORDER의 마지막 성공한 control launch
  jobState: string | null; // 그 job의 state.json
  workerLive: boolean | null; // daemon roster(믿을 수 있을 때)에 그 job의 worker가 살아 있나. roster를 못 믿으면 null
  bootAt: number | null; // /proc/stat btime(ms)
}
export interface ProofResult {
  proof: Proof;
  why: string;
}
const hhmm = (ms: number) => `${new Date(ms).toISOString().slice(11, 16)}Z`;
// 살아 있다는 증거가 하나라도 있으면 live. 사라졌다는 증거는 셋 중 하나(재부팅·state.json의 끝·믿을 수 있는 roster에 worker 없음)이고, 그때도 관제 폴더에 프로세스가 없어야 한다.
// 잘못 gone이라 하면 같은 관제 세션을 두 번 띄우므로 증거가 있는 쪽으로 기운다
export function absentProofOf(f: ProofFacts): ProofResult {
  if (f.liveRows.length) return { proof: "live", why: `claude agents에 살아 있는 줄 ${f.liveRows.join(", ")}` };
  if (f.cwdPids.length) return { proof: "live", why: `관제 폴더에서 도는 프로세스 pid ${f.cwdPids.slice(0, 3).join(", ")}` };
  const job = f.lastJob;
  if (job && f.workerLive === true) return { proof: "live", why: `daemon roster에 job ${job.id}의 worker가 살아 있음` };
  if (job && f.bootAt !== null && job.launchedAt < f.bootAt) return { proof: "gone", why: `호스트가 ${hhmm(f.bootAt)}에 다시 켜짐(job ${job.id}는 그 전에 뜸)` };
  if (job && (f.jobState === "stopped" || f.jobState === "failed")) return { proof: "gone", why: `job ${job.id}의 state.json이 ${f.jobState}` };
  // 띄운 기록이 없으면(14일 안에 atc가 띄운 적이 없거나 SUPERVISOR STOP이 기록 창 밖으로 밀려남) 일부러 내려 둔 것일 수 있어 띄우지 않는다
  if (!job) return { proof: "unknown", why: "최근 14일에 이 역할을 띄운 기록이 없음 — 일부러 내려 둔 것일 수 있다" };
  if (f.workerLive === false) return { proof: "gone", why: `daemon roster에 job ${job.id}의 worker가 없음` };
  return { proof: "unknown", why: `daemon이 없어 job ${job.id}가 사라졌는지 확인하지 못함` };
}

// ── 한 역할의 한 번 판단 ──
export interface StepInput {
  absentSince: number; // 이번 없음이 시작된 때(처음 본 때)
  startup: boolean; // 서버가 뜬 뒤 첫 판단 때부터 없던 역할
  firstPassAt: number; // 서버가 뜬 뒤 첫 판단(첫 스냅샷)
  now: number;
  settings: AbsentSettings;
  auto: boolean; // control-recycle.json auto[이름](OCC 기본 false: 알림만)
  production: boolean; // 운영 서버(7700, 운영 상태 폴더, node --test 아님)
  proof: () => ProofResult; // 증거는 다른 막음이 없을 때만 읽는다(/proc를 훑는다)
  attempted: string | null; // 이번 없음에 이미 다시 띄우려 했으면 그 결과 글
  lastRelaunchAt: number | null;
  escalation: { n: number; at: number } | null;
  acked: boolean;
}
export type Step = { do: "wait"; why: string } | { do: "relaunch"; proof: ProofResult } | { do: "escalate"; n: number; why: string } | { do: "hold"; why: string };

export const dueAtOf = (i: Pick<StepInput, "absentSince" | "startup" | "firstPassAt" | "settings">): number => {
  const byLimit = i.absentSince + i.settings.limitMin * MIN;
  return i.startup ? Math.min(byLimit, i.firstPassAt + STARTUP_SETTLE_MS) : byLimit;
};

// 다시 띄우지 않는 이유(없으면 null = 띄운다)와 쓴 증거
export function relaunchBlockOf(i: StepInput, name: string): { block: string | null; proof?: ProofResult } {
  if (i.settings.relaunch === "off") return { block: "자동 다시 띄우기 스위치 off" };
  if (i.attempted !== null) return { block: i.attempted };
  if (!i.auto) return { block: `control-recycle.json auto.${name}가 false — 알림만` };
  if (!i.production) return { block: "운영 서버가 아님(7700·운영 상태 폴더만 띄운다)" };
  if (!i.startup && i.lastRelaunchAt !== null && i.now - i.lastRelaunchAt < RELAUNCH_COOLDOWN_MS) return { block: `${hhmm(i.lastRelaunchAt)}에 이미 다시 띄움 — 한 시간에 한 번` };
  const proof = i.proof();
  return { block: proof.proof === "gone" ? null : `${proof.proof === "live" ? "살아 있는 증거" : "증거 없음"}: ${proof.why}`, proof };
}

export function stepOf(i: StepInput, name: string): Step {
  const due = dueAtOf(i);
  if (i.now < due) return { do: "wait", why: `한도 전(${Math.ceil((due - i.now) / MIN)}분 남음)` };
  const { block, proof } = relaunchBlockOf(i, name);
  if (block === null) return { do: "relaunch", proof: proof! };
  if (i.settings.escalate === "off") return { do: "hold", why: `알림 스위치 off · ${block}` };
  if (i.acked) return { do: "hold", why: "SUPERVISOR가 확인함" };
  if (!i.escalation) return { do: "escalate", n: 1, why: block };
  if (i.now - i.escalation.at >= ESCALATE_REPEAT_MS) return { do: "escalate", n: i.escalation.n + 1, why: block };
  return { do: "hold", why: block };
}

// ── FLIGHT RECORDER 줄(kind control, op absent) ──
export type AbsentEvent = "start" | "end" | "relaunch" | "escalate" | "ack" | "false";
export interface AbsentLine {
  t: string;
  kind: "control";
  op: "absent";
  event: AbsentEvent;
  session: string;
  by: string;
  minutes?: number; // end·escalate: 그때까지 없던 분
  lastJobId?: string; // 마지막으로 알던 job
  jobId?: string; // relaunch: 새 job
  ok?: boolean; // relaunch
  proof?: string; // relaunch: 쓴 증거(gone의 이유)
  why?: string; // escalate: 다시 띄우지 않은 이유. relaunch 실패: 오류. end: 끝난 까닭
  n?: number; // escalate: 몇 번째 알림
  of?: string; // false: 어느 escalate 줄(t)
  startup?: true; // 서버가 뜬 직후 규칙으로 판단
}

export interface AbsentCounts {
  relaunches: number; // 다시 띄운 수(성공)
  relaunchFailed: number; // 띄우려 했지만 거절·실패
  escalations: number; // 알림을 올린 없음(첫 알림만)
  repeats: number; // 되풀이한 알림
  duplicates: number; // 오작동: 다시 띄운 뒤 한 시간 안에 같은 이름 job 중복 경고(ATC-521)
  falseEscalations: number; // 오작동: SUPERVISOR가 틀린 알림으로 표시
  absentMin: number; // 없던 분(모든 역할 합)
  bySession: Record<string, { relaunches: number; escalations: number; absentMin: number }>;
}
type DupLine = { t: string; kind: string; op?: string; event?: string; session?: string };
const isDup = (l: DupLine) => l.kind === "control" && l.op === "stop-check" && l.event === "duplicate";

// 없던 구간(start → end, 열려 있으면 now까지)
export function absentIntervalsOf(lines: readonly AbsentLine[], now: number): { session: string; from: number; to: number; open: boolean }[] {
  const out: { session: string; from: number; to: number; open: boolean }[] = [];
  const open = new Map<string, number>();
  for (const l of [...lines].sort((a, b) => a.t.localeCompare(b.t))) {
    if (l.event === "start" && !open.has(l.session)) open.set(l.session, Date.parse(l.t));
    else if (l.event === "end" && open.has(l.session)) {
      out.push({ session: l.session, from: open.get(l.session)!, to: Date.parse(l.t), open: false });
      open.delete(l.session);
    }
  }
  for (const [session, from] of open) out.push({ session, from, to: now, open: true });
  return out;
}

const overlapMin = (a: number, b: number, from: number, to: number) => Math.max(0, Math.min(b, to) - Math.max(a, from)) / MIN;

export function absentCountsOf(lines: readonly AbsentLine[], others: readonly DupLine[], from: number, to: number): AbsentCounts {
  const c: AbsentCounts = { relaunches: 0, relaunchFailed: 0, escalations: 0, repeats: 0, duplicates: 0, falseEscalations: 0, absentMin: 0, bySession: {} };
  const by = (s: string) => (c.bySession[s] ??= { relaunches: 0, escalations: 0, absentMin: 0 });
  const dups = others.filter(isDup);
  for (const l of lines) {
    const t = Date.parse(l.t);
    if (!(t >= from && t < to)) continue;
    if (l.event === "relaunch") {
      if (l.ok) {
        c.relaunches++;
        by(l.session).relaunches++;
        if (dups.some((d) => d.session === l.session && Date.parse(d.t) >= t && Date.parse(d.t) - t <= DUP_WINDOW_MS)) c.duplicates++;
      } else c.relaunchFailed++;
    } else if (l.event === "escalate") {
      if ((l.n ?? 1) <= 1) {
        c.escalations++;
        by(l.session).escalations++;
      } else c.repeats++;
    } else if (l.event === "false") c.falseEscalations++;
  }
  for (const iv of absentIntervalsOf(lines, to)) {
    const m = overlapMin(iv.from, iv.to, from, to);
    if (m <= 0) continue;
    c.absentMin += m;
    by(iv.session).absentMin += m;
  }
  c.absentMin = Math.round(c.absentMin);
  for (const s of Object.values(c.bySession)) s.absentMin = Math.round(s.absentMin);
  return c;
}

// 날마다(UTC) 역할별 없던 분. 나중의 Measure가 읽을 수 있게 GET /api/control-absent가 싣는다
export function absentMinutesByDay(lines: readonly AbsentLine[], now: number, days: number): { day: string; minutes: Record<string, number> }[] {
  const ivs = absentIntervalsOf(lines, now);
  const today = Math.floor(now / DAY) * DAY;
  const out: { day: string; minutes: Record<string, number> }[] = [];
  for (let d = today - (days - 1) * DAY; d <= today; d += DAY) {
    const minutes: Record<string, number> = {};
    for (const iv of ivs) {
      const m = Math.round(overlapMin(iv.from, iv.to, d, Math.min(d + DAY, now)));
      if (m > 0) minutes[iv.session] = (minutes[iv.session] ?? 0) + m;
    }
    out.push({ day: new Date(d).toISOString().slice(0, 10), minutes });
  }
  return out;
}

// ── 알림(SUPERVISOR alerts의 control|absent|<세션>|<n>) ──
export interface AbsentEscalation {
  session: string;
  n: number; // 몇 번째 알림. key에 들어가 되풀이마다 새 key가 된다(ANNUNCIATOR·브라우저는 새 key에만 알린다)
  since: string; // 없음이 시작된 때
  at: string; // 이 알림을 올린 때
  minutes: number; // 올릴 때까지 없던 분
  lastJobId: string | null;
  why: string; // 다시 띄우지 않은 이유
  passQuiet: boolean; // 조용한 시간 통과 스위치
}
export const escalationKeyOf = (e: Pick<AbsentEscalation, "session" | "n">) => `control|absent|${e.session}|${e.n}`;
export const escalationTextOf = (e: AbsentEscalation) =>
  `관제 세션 ${e.session} ${e.minutes}분째 없음 — 마지막 job ${e.lastJobId ?? "모름"} · atc가 다시 띄우지 않은 이유: ${e.why}${e.n > 1 ? ` (${e.n}번째 알림)` : ""}`;

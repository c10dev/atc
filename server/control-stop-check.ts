// CONTROL STOP CHECK(ATC-521, docs/control-recycle.md): 관제 세션을 멈췄다고 믿는 것과 실제로 멈춘 것을 가른다. 순수 함수만 — 읽고 쓰는 것은 control-stop-check-run.ts.
// 사건: MCC job 4d8c68ae(acct-1)는 2026-10-02 22:26 RECYCLE에서 `claude stop`이 종료 코드 0이라 `ok: true`로 기록됐지만 state.json은 끝내 stopped가 되지 않았고(마지막 줄 22:22 done),
// 10-03 08:45에 깨어나 PR #527을 착륙시킨 뒤 공식 MCC와 나란히 tick했다. 둘째 일: 같은 관제 이름의 job이 둘 살아 있어도 atc는 몰랐다.
// 스위치는 SUPERVISOR만 바꾼다(설정 창). 꺼도 사실(옛 `claude stop` 종료 코드 판정)이 바뀌는 것은 없다 — 확인과 경고만 뺀다.

const MIN = 60_000;
const DAY = 86_400_000;

export type StopCheckSwitch = "off" | "on";
export const STOP_CHECK_SWITCHES: readonly StopCheckSwitch[] = ["off", "on"];
// 파일에 없거나 모르는 값이면 on(live first). 끄는 것은 SUPERVISOR가 쓴 off뿐이다
export const parseStopCheckSwitch = (v: unknown): StopCheckSwitch => (v === "off" ? "off" : "on");

// `claude stop`이 돌아온 뒤 state.json이 stopped가 되기를 기다리는 한도와 간격
export const STOP_VERIFY_WAIT_MS = 20_000;
export const STOP_VERIFY_STEP_MS = 1_000;
// 같은 이름의 job 둘이 "살아 있다"고 보는 기준: 상태가 stopped가 아니고 이 분 안에 활동이 있었다(오래 조용한 유령 줄은 세지 않는다)
export const DUP_RECENT_MIN = 60;

export type StopVerdict = { ok: true } | { ok: false; code: "exit-failed" | "unverified"; reason: string };

// `claude stop`의 종료 코드와 그 job의 state.json 값(없거나 못 읽으면 null)으로 판정. ok는 stopped일 때만이다
export function stopVerdictOf(exitOk: boolean, state: string | null): StopVerdict {
  if (!exitOk) return { ok: false, code: "exit-failed", reason: "claude stop 실패" };
  if (state === "stopped") return { ok: true };
  return { ok: false, code: "unverified", reason: `claude stop은 종료 코드 0이었지만 job state.json이 ${state ?? "읽히지 않음"}이라 멈췄는지 확인하지 못함 — 옛 세션이 계속 돌 수 있다` };
}

export interface WaitDeps {
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

// state.json이 stopped가 될 때까지 한도 안에서 다시 읽는다. 마지막으로 읽은 값을 돌려준다(주입된 읽기·잠. 실제 상태 폴더를 읽지 않고 시험할 수 있다)
export async function waitStopped(read: () => string | null, d: WaitDeps, waitMs = STOP_VERIFY_WAIT_MS, stepMs = STOP_VERIFY_STEP_MS): Promise<string | null> {
  const deadline = d.now() + waitMs;
  let state = read();
  while (state !== "stopped" && d.now() < deadline) {
    await d.sleep(stepMs);
    state = read();
  }
  return state;
}

// ── 같은 관제 이름의 살아 있는 job 둘 이상 ──
export interface LiveJob {
  control: string; // 관제 세션 이름(TOWER, OCC, MCC …)
  id: string;
  account: string | null;
  state: string | null; // state.json
  activeAt: string | null; // 마지막 활동(state.json writtenAt 또는 대화 기록)
  stale: boolean; // Claude Code가 멈춘 job을 목록에 둔 줄(STALE, 세지 않는다)
}
export interface Duplicate {
  control: string;
  jobs: { id: string; account: string | null; state: string | null }[];
}

const liveOf = (j: LiveJob, now: number, recentMin: number): boolean => {
  if (j.stale || j.state === "stopped") return false;
  const at = j.activeAt ? Date.parse(j.activeAt) : NaN;
  return Number.isFinite(at) && now - at <= recentMin * MIN;
};

// 관제 이름마다 살아 있는 job이 둘 이상이면 그 이름과 job들
export function duplicateLiveOf(jobs: readonly LiveJob[], now: number, recentMin = DUP_RECENT_MIN): Duplicate[] {
  const by = new Map<string, LiveJob[]>();
  for (const j of jobs) if (liveOf(j, now, recentMin)) by.set(j.control, [...(by.get(j.control) ?? []), j]);
  return [...by.entries()]
    .filter(([, js]) => js.length >= 2)
    .map(([control, js]) => ({ control, jobs: js.map((j) => ({ id: j.id, account: j.account, state: j.state })).sort((a, b) => a.id.localeCompare(b.id)) }))
    .sort((a, b) => a.control.localeCompare(b.control));
}

// 열린 경고의 정체성: 같은 이름에 같은 job들이면 같은 경고(job이 바뀌면 새 경고)
export const duplicateKeyOf = (d: Duplicate): string => `${d.control}|${d.jobs.map((j) => j.id).join(",")}`;

export function duplicateTextOf(d: Duplicate): string {
  const jobs = d.jobs.map((j) => `${j.id}(${j.account ?? "ACCOUNT 없음"}, ${j.state ?? "?"})`).join(", ");
  return `관제 세션 ${d.control}이 둘 이상 살아 있음: job ${jobs}`;
}

export function unverifiedTextOf(u: { session: string; jobId: string; account?: string | null; state: string | null }): string {
  return `관제 세션 ${u.session}: claude stop은 성공했지만 job ${u.jobId}(${u.account ?? "ACCOUNT 없음"})의 state.json이 ${u.state ?? "읽히지 않음"} — 멈췄는지 확인하지 못함`;
}

// ── FLIGHT RECORDER의 결정 줄과 오작동 수 ──
export type StopCheckEvent = "blocked" | "duplicate" | "contradicted" | "dismissed";
export interface StopCheckLine {
  t: string;
  kind: "control";
  op: "stop-check";
  event: StopCheckEvent;
  session: string;
  by: string;
  jobIds: string[];
  account?: string | null;
  state?: string | null; // blocked: 막을 때 읽은 state.json 값
  of?: string; // contradicted·dismissed: 어느 줄(그 줄의 t)을 두고 한 말인가
  detail?: string;
}

// 알림이 되는 "확인 못 한 STOP"(control|unverified): 최근 blocked 줄 가운데 그 job이 지금도 stopped가 아니고 오탐 표시(dismissed)도 없는 것.
// readState는 job의 지금 state.json(주입). 알림은 상태에서 만든다: job이 stopped가 되면 저절로 사라진다
export interface Unverified {
  session: string;
  jobId: string;
  account: string | null;
  since: string;
  state: string | null;
}
export function unverifiedOf(lines: readonly StopCheckLine[], readState: (jobId: string) => string | null, now: number, windowMs = 6 * 3_600_000): Unverified[] {
  const dismissed = new Set(lines.filter((l) => l.event === "dismissed" && l.of).map((l) => l.of));
  const out = new Map<string, Unverified>();
  for (const l of lines) {
    const jobId = l.jobIds[0];
    if (l.event !== "blocked" || !jobId || now - Date.parse(l.t) > windowMs || dismissed.has(l.t)) continue;
    const state = readState(jobId);
    if (state === "stopped") continue;
    out.set(jobId, { session: l.session, jobId, account: l.account ?? null, since: l.t, state });
  }
  return [...out.values()].sort((a, b) => a.session.localeCompare(b.session) || a.jobId.localeCompare(b.jobId));
}

export interface StopCheckCounter {
  blocked: number; // 확인이 ok를 막은 횟수
  duplicates: number; // 중복 WARNING이 뜬 횟수
  dismissed: number; // SUPERVISOR가 오탐으로 표시한 줄
  contradicted: number; // 검사가 나중에 틀렸다고 드러난 줄(막은 job이 뒤늦게 stopped가 됨 · 경고가 곧 스스로 풀림)
  falseAlarms: number; // dismissed ∪ contradicted의 서로 다른 원래 줄
  share: number | null; // falseAlarms / (blocked + duplicates)
}

export function stopCheckCounterOf(lines: readonly Pick<StopCheckLine, "t" | "event" | "of">[], now: number, days = 7): StopCheckCounter {
  const since = now - days * DAY;
  const inWin = lines.filter((l) => Date.parse(l.t) >= since);
  const n = (e: StopCheckEvent) => inWin.filter((l) => l.event === e).length;
  const bad = new Set(inWin.filter((l) => (l.event === "dismissed" || l.event === "contradicted") && l.of).map((l) => l.of));
  const acts = n("blocked") + n("duplicate");
  return { blocked: n("blocked"), duplicates: n("duplicate"), dismissed: n("dismissed"), contradicted: n("contradicted"), falseAlarms: bad.size, share: acts ? bad.size / acts : null };
}

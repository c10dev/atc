import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import {
  type Duplicate,
  duplicateKeyOf,
  duplicateLiveOf,
  type LiveJob,
  parseStopCheckSwitch,
  STOP_VERIFY_STEP_MS,
  STOP_VERIFY_WAIT_MS,
  type StopCheckLine,
  type StopCheckSwitch,
  stopCheckCounterOf,
  stopVerdictOf,
  type StopVerdict,
  waitStopped,
  type WaitDeps,
} from "./control-stop-check.ts";
import { fromThisApp } from "./origin.ts";
import { readRecords, record } from "./recorder.ts";

// CONTROL STOP CHECK의 읽고 쓰기(ATC-521). 판정은 control-stop-check.ts(순수). 스위치는 control-stop-check.json(원자적 JSON, 기본 on)이고 설정 창에서만 바꾼다 — atcctl 명령은 없다.
// 결정(막음·중복 경고·오탐 표시)은 새 파일 없이 FLIGHT RECORDER(`control stop-check`)에 남고, 오작동 수는 거기서 센다. session-control.ts를 가져오지 않는다(순환): 상태 읽기는 부르는 쪽이 넘긴다.

const SWITCH_FILE = () => join(config.stateDir, "control-stop-check.json");
const LOOKBACK_MS = 30 * 86_400_000;
const SIX_H = 6 * 3_600_000;

export function loadStopCheckSwitch(file = SWITCH_FILE()): StopCheckSwitch {
  try {
    return parseStopCheckSwitch(JSON.parse(readFileSync(file, "utf8")).mode);
  } catch {
    return "on";
  }
}

// 바뀐 것만 FLIGHT RECORDER에 남긴다. 임시 파일을 넘기면(시험) 운영 기록에 쓰지 않는다
export function saveStopCheckSwitch(v: StopCheckSwitch, by = "SUPERVISOR", file = SWITCH_FILE()) {
  const from = loadStopCheckSwitch(file);
  if (from === v) return;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ mode: v }, null, 2) + "\n");
  renameSync(tmp, file);
  if (file === SWITCH_FILE()) record({ t: new Date().toISOString(), kind: "policy", op: "control-stop-check-mode", by, from, to: v });
}

export const stopCheckLines = (sinceMs = Date.now() - LOOKBACK_MS): StopCheckLine[] => readRecords(sinceMs).flatMap((r) => (r.kind === "control" && r.op === "stop-check" ? [r as unknown as StopCheckLine] : []));

const realWait: WaitDeps = { sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now() };

// 막힌 STOP의 다시 읽기 대상. 서버를 켠 뒤 처음 tick에서 기록에서 되살린다
const pending = new Map<string, { t: string; session: string }>();
let restored = false;
const openDup = new Map<string, { t: string; at: number }>();
let dups: Duplicate[] = [];
export const duplicatesNow = (): readonly Duplicate[] => dups;
// 시험이 기억을 비운다
export const resetStopCheck = () => {
  pending.clear();
  openDup.clear();
  dups = [];
  restored = false;
};

export interface ConfirmInput {
  session: string;
  jobId: string;
  account?: string | null | undefined;
  readState: (jobId: string) => string | null;
  deps?: WaitDeps;
  waitMs?: number;
  stepMs?: number;
  sw?: StopCheckSwitch;
}

// `claude stop`이 종료 코드 0으로 돌아온 뒤 호출한다: job의 state.json이 한도 안에 stopped가 되면 ok, 아니면 not-ok와 읽을 수 있는 사유. 스위치가 꺼져 있으면 확인하지 않는다(ok).
// not-ok는 막음(blocked)으로 FLIGHT RECORDER에 남고, 알림은 그 기록과 job의 지금 상태에서 만들어진다
export async function confirmStopped(i: ConfirmInput): Promise<StopVerdict> {
  if ((i.sw ?? loadStopCheckSwitch()) === "off") return { ok: true };
  const state = await waitStopped(() => i.readState(i.jobId), i.deps ?? realWait, i.waitMs ?? STOP_VERIFY_WAIT_MS, i.stepMs ?? STOP_VERIFY_STEP_MS);
  const v = stopVerdictOf(true, state);
  if (!v.ok) {
    const t = new Date().toISOString();
    record({ t, kind: "control", op: "stop-check", event: "blocked", session: i.session, by: "atc", jobIds: [i.jobId], account: i.account ?? null, state, detail: v.reason });
    pending.set(i.jobId, { t, session: i.session });
  }
  return v;
}

const event = (e: StopCheckLine["event"], session: string, jobIds: string[], extra: Partial<StopCheckLine> = {}) =>
  record({ t: new Date().toISOString(), kind: "control", op: "stop-check", event: e, session, by: "atc", jobIds, ...extra });

// 1분 일: 막은 STOP이 뒤늦게 stopped가 되었는지(검사가 틀렸다), 같은 이름의 살아 있는 job이 둘 이상인지. 끄면 열린 경고를 모두 걷는다
export function trackChecks(jobs: readonly LiveJob[], readState: (jobId: string) => string | null, now = Date.now(), sw = loadStopCheckSwitch()) {
  if (!restored) {
    restored = true;
    const lines = stopCheckLines(now - SIX_H);
    const done = new Set(lines.filter((l) => l.event === "contradicted" || l.event === "dismissed").map((l) => l.of));
    for (const l of lines) if (l.event === "blocked" && l.jobIds[0] && !done.has(l.t)) pending.set(l.jobIds[0], { t: l.t, session: l.session });
  }
  if (sw === "off") {
    dups = [];
    openDup.clear();
    return;
  }
  for (const [jobId, p] of [...pending]) {
    if (readState(jobId) === "stopped") {
      event("contradicted", p.session, [jobId], { of: p.t, detail: "막은 STOP의 job이 뒤늦게 stopped가 됨" });
      pending.delete(jobId);
    } else if (now - Date.parse(p.t) > SIX_H) pending.delete(jobId);
  }
  dups = duplicateLiveOf(jobs, now);
  const keys = new Map(dups.map((d) => [duplicateKeyOf(d), d]));
  for (const [k, d] of keys) {
    if (openDup.has(k)) continue;
    event("duplicate", d.control, d.jobs.map((j) => j.id), { detail: d.jobs.map((j) => `${j.id}:${j.account ?? "-"}:${j.state ?? "?"}`).join(" ") });
    openDup.set(k, { t: new Date().toISOString(), at: now });
  }
  for (const [k, o] of [...openDup]) {
    if (keys.has(k)) continue;
    openDup.delete(k);
    // 2분 안에 스스로 풀린 경고는 틀린 경고였을 수 있다(막 뜬 job이 목록에 겹쳐 보인 것 …)
    const [control = "", ids = ""] = k.split("|");
    if (now - o.at <= 2 * 60_000) event("contradicted", control, ids.split(","), { of: o.t, detail: "중복 경고가 2분 안에 스스로 풀림" });
  }
}

// 설정 창이 그릴 자료: 최근 7일과 30일 수, 열린 중복, 최근 결정 몇 줄(오탐 표시 단추용)
export function stopCheckData(now = Date.now()) {
  const lines = stopCheckLines(now - LOOKBACK_MS);
  const marked = new Set(lines.filter((l) => l.event === "dismissed" || l.event === "contradicted").map((l) => l.of));
  return {
    last7d: stopCheckCounterOf(lines, now, 7),
    last30d: stopCheckCounterOf(lines, now, 30),
    open: duplicatesNow().map((d) => ({ control: d.control, jobs: d.jobs })),
    recent: lines
      .filter((l) => l.event === "blocked" || l.event === "duplicate")
      .slice(-5)
      .reverse()
      .map((l) => ({ t: l.t, event: l.event, session: l.session, jobIds: l.jobIds, ...(l.detail ? { detail: l.detail } : {}), marked: marked.has(l.t) })),
  };
}

export function dismissCheck(t: string, by = "SUPERVISOR"): boolean {
  const l = stopCheckLines().find((x) => x.t === t && (x.event === "blocked" || x.event === "duplicate"));
  if (!l) return false;
  record({ t: new Date().toISOString(), kind: "control", op: "stop-check", event: "dismissed", session: l.session, by, jobIds: l.jobIds, of: t });
  pending.delete(l.jobIds[0] ?? "");
  return true;
}

export function mountStopCheck(app: Hono) {
  // 읽기: 스위치·수·열린 중복·최근 결정. 스위치는 설정 창(PUT /api/settings)에서만 바꾼다
  app.get("/api/control-stop-check", (c) => c.json({ switch: loadStopCheckSwitch(), ...stopCheckData() }));
  // 오탐 표시: SUPERVISOR 화면에서만. 줄을 지우지 않고 `dismissed`를 덧붙인다
  app.post("/api/control-stop-check/dismiss", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const body = (await c.req.json().catch(() => null)) as { t?: unknown } | null;
    if (typeof body?.t !== "string" || !dismissCheck(body.t)) return c.json({ error: "그런 결정 줄이 없음" }, 404);
    return c.json({ ok: true });
  });
}

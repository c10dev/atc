import type { Departure } from "./departures.ts";
import type { AssignPlan, Factor, Landed } from "./dispatch.ts";
import { type Fact, factsOf, hhmm } from "./health.ts";
import { isControlName } from "./crew.ts";
import type { Session, Snapshot, Ticket } from "./model.ts";
import type { Op, Proposal } from "./proposals.ts";
import { regKey } from "./registration.ts";
import { CAP_IDLE_MIN, type CapIdleHint, capHoldersOf, capHoldersText, capIdleHintsOf, isAircraftName } from "./other-background.ts";

// LAUNCH on approve와 RESUME 카드(ATC-129, docs/dispatch.md·docs/fleet.md "as built (ATC-129)").
// 백그라운드 세션은 마지막 턴 뒤 60분쯤 쉬면 Claude Code daemon이 거둔다(bg retire, idle 60m). 그래도 그 AIRCRAFT는 DISPATCH 후보로 남고,
// 카드를 SUPERVISOR가 승인하면 FLEET LAUNCH와 같은 길(launchAircraft)로 띄운 뒤 OCC가 FLIGHT PLAN을 보낸다.
// 사용 한도로 끊긴 FLIGHT는 reset 뒤 같은 REGISTRATION의 RESUME 카드로 돌아온다. 여기는 순수 함수만. 읽기는 absent-run.ts

// 세션이 없는 백그라운드 AIRCRAFT(스냅샷 absent). atc가 띄운 적이 있는 것만(FLIGHT RECORDER의 LAUNCH) — 데스크톱·터미널 세션은 띄우지 않는다
export interface AbsentAircraft {
  registration: string;
  launchedAt: string; // 마지막으로 성공한 atc LAUNCH
  jobId: string | null; // 그 LAUNCH의 job(대화 기록을 찾는다)
  permissionMode?: string; // 다시 띄울 때 같은 옵션
  model?: string;
  account?: string; // 그 LAUNCH의 ACCOUNT(ATC-147). RESUME은 같은 ACCOUNT에서
  cut: CutInfo | null; // 그 세션의 마지막 턴이 사용 한도로 잘렸고 그 뒤 새 턴이 없다(ATC-86 cut)
  jobGone?: string; // 그 LAUNCH의 job이 프로세스 없이 사라졌다(ATC-534): `job gone (last state 13:16Z)`. 세션 파일은 남았지만 absent로 본다
  stuck?: StuckLaunch; // 마지막 LAUNCH가 "이미 떠 있음"으로 거절됐고 그 job 줄이 아직 남아 있다(ATC-213). 카드를 다시 내지 않는다
}

// LAUNCH가 "이미 떠 있음(bg <id>)"으로 거절한 뒤 그 job이 아직 끝나지 않았다(ATC-213).
// 같은 카드를 다시 내 봐야 같은 이유로 또 실패한다(2026-09-30: TEAM_F·TEAM_K 카드 11건). SUPERVISOR가 그 job을 정리해야 풀린다
export interface StuckLaunch {
  jobId: string;
  at: string; // 거절된 LAUNCH의 시각
  state: string; // 지금 그 job의 state.json state
}
export const ALREADY_UP_RE = /이미 떠 있음\(bg ([0-9a-f]{6,})\)/;
const JOB_ENDED = new Set(["done", "stopped", "failed"]);
// 그 REGISTRATION의 마지막 LAUNCH 시도(성공이든 실패든) 하나만 본다: 뒤에 성공했거나 다른 이유로 실패했으면 막힌 것이 아니다.
// jobState: job의 지금 state(job 파일을 못 읽으면 null → 막힌 것으로 보지 않는다)
export function stuckLaunchOf(last: { t: string; ok: boolean; error?: string } | undefined, jobState: (jobId: string) => string | null): StuckLaunch | null {
  if (!last || last.ok) return null;
  const jobId = ALREADY_UP_RE.exec(last.error ?? "")?.[1];
  if (!jobId) return null;
  const state = jobState(jobId);
  if (state === null || JOB_ENDED.has(state)) return null;
  return { jobId, at: last.t, state };
}
// 사람에게 할 일을 말하는 한 줄(FOLLOWING launch 이슈와 후보 사유가 함께 쓴다)
export const stuckHintOf = (jobId: string) => `bg ${jobId}가 아직 목록에 남아 있음 — FLEET에서 그 세션을 STOP하거나 그 안에서 답한다(atc는 스스로 멈추지 않는다)`;

export interface CutInfo {
  sessionId: string;
  cutAt: string;
  resetsAt: string | null; // ACCOUNT의 FUEL 기록에서 되짚은 reset. 모르면 null(풀릴 때까지 HOLD)
  weekly?: boolean;
  report: string | null; // CAPTAIN의 마지막 보고 한 줄
}

// RESUME 카드가 싣는 것: 어디서 이어서 하나
export interface ResumeInfo {
  cutAt: string;
  resetsAt: string;
  stand: string | null; // DEPARTURE LOG의 STAND(워크트리)
  branch: string | null;
  commit: { sha: string; at: string | null; pushed: boolean | null } | null; // 그 STAND의 마지막 커밋(WIP), 워크트리가 없으면 null
  report: string | null;
}

// 카드에 붙는 LAUNCH 결과(op launch)
export interface LaunchResult {
  at: string;
  ok: boolean;
  by: string;
  jobId?: string;
  error?: string;
}

export const LAUNCH_TEXT = "LAUNCH on approve";
export const LAUNCHING_TEXT = "LAUNCHING — 새 세션을 기다림";
// SUPERSEDED 사유의 앞머리: LAUNCH가 실패했거나 새 세션이 뜨지 않음. 판정이 아니라 24시간 짝 규칙을 시작하지 않는다
export const LAUNCH_FAILED_WHY = "LAUNCH 실패";
export const ABSENT_REASON = "ABSENT — 세션 없음, 승인하면 LAUNCH";

// ── cut: 대화 기록 끝의 사실 → 한도로 잘린 뒤 새 턴이 없나 ──
// health.ts healthOf의 2b와 같은 규칙에서 end_turn 예외(ATC-167)만 뺐다: 마지막 지시 뒤에 wrap_up 안내가 있고 그 뒤 release가 없다. 세션이 없어 healthOf는 이것을 보지 않는다. 세션이 사라진 AIRCRAFT는 마무리한 턴도 일이 남았을 수 있어 RESUME 카드를 그대로 낸다
export function cutAtOf(facts: readonly Fact[]): number | null {
  let prompt = -1;
  let wrap = -1;
  let release = -1;
  facts.forEach((f, i) => {
    if (f.kind === "prompt") prompt = i;
    if (f.kind === "limit-note" && f.note === "wrap_up") wrap = i;
    if (f.kind === "limit-note" && f.note === "release") release = i;
  });
  return wrap >= 0 && wrap > prompt && wrap > release ? facts[wrap]!.t : null;
}
export const cutAtOfText = (text: string) => cutAtOf(factsOf(text));

// CAPTAIN의 마지막 보고 한 줄: 대화 기록 끝에서 마지막 assistant 글의 마지막 줄(200자). 없으면 null
export function lastReportLineOf(text: string): string | null {
  let last: string | null = null;
  for (const line of text.split("\n")) {
    if (!line.includes('"type":"assistant"')) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.type !== "assistant" || d.isSidechain || d.isApiErrorMessage) continue;
    const content = d.message?.content;
    const body = typeof content === "string" ? content : Array.isArray(content) ? content.filter((b) => b?.type === "text").map((b) => String(b.text ?? "")).join("\n") : "";
    const lines = body.split("\n").map((l: string) => l.trim()).filter(Boolean);
    if (lines.length) last = lines.at(-1)!.slice(0, 200);
  }
  return last;
}

// ── 후보 ──

// 세션이 없는 백그라운드 AIRCRAFT(순수). launches: REGISTRATION → 마지막 성공한 atc LAUNCH. 살아 있는 세션·RESTARTING·등록부에 없음·RETIRED는 뺀다
export function absentOf(
  launches: ReadonlyMap<string, { t: string; jobId?: string; permissionMode?: string; model?: string; account?: string }>,
  input: { liveRegs: ReadonlySet<string>; restarting: ReadonlySet<string>; registered: ReadonlySet<string>; retired: ReadonlySet<string> },
  cutOf: (reg: string, jobId: string | null) => CutInfo | null = () => null,
  stuckOf: (reg: string) => StuckLaunch | null = () => null,
  goneOf: (reg: string, jobId: string | null) => string | null = () => null,
): AbsentAircraft[] {
  const out: AbsentAircraft[] = [];
  for (const [reg, l] of [...launches].sort(([a], [b]) => a.localeCompare(b))) {
    if (input.liveRegs.has(reg) || input.restarting.has(reg) || !input.registered.has(reg) || input.retired.has(reg)) continue;
    const stuck = stuckOf(reg);
    const jobGone = goneOf(reg, l.jobId ?? null);
    out.push({
      registration: reg,
      launchedAt: l.t,
      jobId: l.jobId ?? null,
      ...(l.permissionMode ? { permissionMode: l.permissionMode } : {}),
      ...(l.model ? { model: l.model } : {}),
      ...(l.account ? { account: l.account } : {}),
      cut: cutOf(reg, l.jobId ?? null),
      ...(stuck ? { stuck } : {}),
      ...(jobGone ? { jobGone } : {}),
    });
  }
  return out;
}

// cut 뒤 reset 전이면 HOLD 사유, 아니면 null
export function cutHoldWhy(cut: CutInfo | null, now: number): string | null {
  if (!cut) return null;
  const tag = `cut ${hhmm(Date.parse(cut.cutAt), now)}${cut.weekly ? ", weekly" : ""}`;
  if (!cut.resetsAt) return `HOLD · LIMIT (${tag}) — reset 모름`;
  return now < Date.parse(cut.resetsAt) ? `HOLD · LIMIT (${tag}) until ${hhmm(Date.parse(cut.resetsAt), now)}` : null;
}

// ── 상한: 살아 있는 백그라운드 세션 + 승인됐지만 아직 세션이 없는 launch 카드 ≤ MAX_LAUNCHED ──
export interface LaunchCap {
  launched: number;
  pending: number;
  max: number;
  full: boolean;
  holders?: string; // 자리를 쥔 쪽(ATC-184): `AIRCRAFT 6 · 그 밖 1 (ENGINEERING-NIGHT, 6h idle)`
}
const liveRegsOf = (sessions: readonly Pick<Session, "name" | "status">[], teamPattern?: string) =>
  new Set(sessions.filter((x) => x.status !== "dead").map((x) => regKey(x.name, teamPattern)));
// 관제 세션(REVIEW 포함)은 세지 않는다(session-control.ts isControlRow와 같은 뜻)
const isControlSession = (name: string) => isControlName(name) || name.trim().toUpperCase() === "REVIEW";

export function launchCapOf(
  sessions: readonly (Pick<Session, "name" | "status" | "origin"> & Partial<Pick<Session, "lastActiveAt">>)[],
  proposals: readonly Pick<Proposal, "kind" | "status" | "launch" | "launched" | "registration" | "aircraftName">[],
  max: number,
  teamPattern?: string,
  now = Date.now(),
): LaunchCap {
  const holding = sessions.filter((x) => x.status !== "dead" && x.origin === "background" && !isControlSession(x.name));
  const launched = holding.length;
  const holders = capHoldersText(
    capHoldersOf(holding.map((x) => ({ name: x.name, kind: "background", idle: x.lastActiveAt ? Math.max(0, Math.floor((now - Date.parse(x.lastActiveAt)) / 60_000)) : null })), [], (r) => r.idle, teamPattern),
  );
  const live = liveRegsOf(sessions, teamPattern);
  const pending = proposals.filter(
    (p) => p.kind === "ASSIGN" && p.launch && p.status === "approved" && p.launched?.ok !== false && !live.has(p.registration ?? regKey(p.aircraftName, teamPattern)),
  ).length;
  return { launched, pending, max, full: launched + pending >= max, holders };
}
// 놀고 있는 자리 힌트(ATC-184, ADVISORY 알림용): 상한이 찬 채 launch 카드가 기다리는 동안, 120분 넘게 논 그 밖의 백그라운드 세션. 알리기만 한다
export function capIdleNow(
  sessions: readonly (Pick<Session, "name" | "status" | "origin"> & Partial<Pick<Session, "lastActiveAt" | "jobId" | "id">>)[],
  proposals: readonly Pick<Proposal, "kind" | "status" | "launch" | "launched" | "registration" | "aircraftName" | "flight">[],
  max: number,
  teamPattern?: string,
  now = Date.now(),
): CapIdleHint[] {
  if (max <= 0) return [];
  const cap = launchCapOf(sessions, proposals, max, teamPattern, now);
  if (!cap.full) return [];
  const refused = proposals.filter((p) => p.kind === "ASSIGN" && p.launch && p.status === "proposed").map((p) => p.registration ?? regKey(p.aircraftName, teamPattern) ?? p.flight);
  const others = sessions
    .filter((x) => x.status !== "dead" && x.origin === "background" && !isControlSession(x.name) && !isAircraftName(x.name, [], teamPattern))
    .map((x) => ({ id: x.jobId ?? x.id ?? x.name, name: x.name, idleMin: x.lastActiveAt ? Math.max(0, Math.floor((now - Date.parse(x.lastActiveAt)) / 60_000)) : null }));
  return capIdleHintsOf(others, refused, CAP_IDLE_MIN);
}
export const launchFullWhy = (cap: LaunchCap) => `LAUNCH 대기 — 백그라운드 ${cap.launched}${cap.pending ? ` + 승인된 LAUNCH ${cap.pending}` : ""} / 상한 ${cap.max}(ATC_MAX_LAUNCHED)${cap.holders ? ` · ${cap.holders}` : ""} — 자리가 나면 승인한다`;

// 카드마다 LAUNCH 표시(열린·HELD·승인된 launch 카드). 상한이 찼으면 열린 카드는 기다린다고 적는다
export function launchViewOf(proposals: readonly Proposal[], cap: LaunchCap, k3Waits: ReadonlyMap<string, string> = new Map()): Record<string, string> {
  return Object.fromEntries(
    proposals
      .filter((p) => p.kind === "ASSIGN" && p.launch && (p.status === "proposed" || p.status === "approved"))
      .map((p) => [p.id, p.status === "proposed" && cap.full ? launchFullWhy(cap) : p.status === "approved" && !p.launched && k3Waits.has(p.id) ? k3Waits.get(p.id)! : LAUNCH_TEXT]),
  );
}

// ── 보내기 전: launch 카드의 새 세션이 떴나(RESTARTING과 같은 기다림, ATC-91) ──
export function launchReleaseWhyOf(p: Pick<Proposal, "launch" | "launched" | "registration" | "aircraftName">, s: Pick<Snapshot, "sessions">, teamPattern?: string): string | null {
  if (!p.launch) return null;
  const reg = p.registration ?? regKey(p.aircraftName, teamPattern);
  if (liveRegsOf(s.sessions, teamPattern).has(reg)) return null;
  const who = p.aircraftName ?? reg;
  if (p.launched && !p.launched.ok) return `${who}: ${LAUNCH_FAILED_WHY} — ${p.launched.error ?? "원인 모름"} — 보내지 않는다`;
  if (p.launched?.ok) return `${who}: ${LAUNCHING_TEXT} — 새 세션이 뜬 뒤에 보낸다(승인은 그대로다)`;
  return `${who}: 세션 없음 — LAUNCH 기록이 없어 보내지 않는다`;
}

// launch 카드가 LAUNCH 뒤 새 세션을 기다리는 중(유예 안)
export const launchWaiting = (p: Pick<Proposal, "launch" | "launched">, now: number, timeoutMin: number) =>
  Boolean(p.launch && p.launched?.ok && now - Date.parse(p.launched.at) < timeoutMin * 60_000);
// 유예가 지나도 새 세션이 없음
export const launchTimedOut = (p: Pick<Proposal, "launch" | "launched">, now: number, timeoutMin: number) =>
  Boolean(p.launch && p.launched?.ok && now - Date.parse(p.launched.at) >= timeoutMin * 60_000);
export const launchTimeoutWhy = (timeoutMin: number) => `${LAUNCH_FAILED_WHY} — LAUNCH 뒤 ${timeoutMin}분 동안 새 세션이 뜨지 않음`;
// 승인은 적혔는데 LAUNCH 결과가 없다(승인과 LAUNCH 사이에 서버가 멈춤). 유예가 지나면 닫는다 — 스스로 다시 띄우지 않는다
export const launchMissing = (p: Pick<Proposal, "launch" | "launched" | "timeline">, now: number, timeoutMin: number) =>
  Boolean(p.launch && !p.launched && p.timeline.approved && now - Date.parse(p.timeline.approved) >= timeoutMin * 60_000);
export const launchMissingWhy = (timeoutMin: number, k3Wait?: string) =>
  k3Wait
    ? `${LAUNCH_FAILED_WHY} — 승인 뒤 ${timeoutMin}분 동안 LAUNCH하지 못함: ${k3Wait}. 발권·선언이 갖춰지지 않아 K3 entries 없이 띄우지 않았다 — 갖춘 뒤 다시 승인한다`
    : `${LAUNCH_FAILED_WHY} — 승인 뒤 ${timeoutMin}분 동안 LAUNCH 기록이 없음(승인 중 서버가 멈췄을 수 있음). 스스로 다시 띄우지 않는다 — 다시 승인한다`;

// ── 승인 + LAUNCH(순서만, 입출력은 주입). 상한이 찼으면 아무것도 적지 않는다. 승인을 먼저 적고 띄운다.
// 실패하면 LAUNCH 결과와 SUPERSEDED를 적어 OCC가 보내지 않는다. 이미 세션이 떠 있으면 띄우지 않고 승인만 ──
export interface ApproveLaunchDeps {
  live: boolean;
  cap: LaunchCap;
  approve: Op;
  append: (ops: Op[]) => void;
  launch: () => Promise<{ ok: boolean; jobId?: string; error?: string; wait?: string }>; // wait(ATC-506): K3 entries가 아직 없어 띄우지 않았다 — 아무것도 적지 않고 카드는 approved로 남는다
  now: () => string;
  by?: string; // launch 줄의 by. 화면에서 승인하면 SUPERVISOR(기본), 서버의 자동 승인(ATC-334)이면 "auto"
}
export async function approveLaunch(id: string, d: ApproveLaunchDeps): Promise<{ ok: boolean; status: 200 | 409 | 502; error?: string; wait?: string }> {
  if (!d.live && d.cap.full) return { ok: false, status: 409, error: launchFullWhy(d.cap) };
  d.append([d.approve]);
  if (d.live) return { ok: true, status: 200 };
  let r: { ok: boolean; jobId?: string; error?: string; wait?: string };
  try {
    r = await d.launch();
  } catch (e) {
    r = { ok: false, error: (e as Error).message };
  }
  if (r.wait) return { ok: true, status: 200, wait: r.wait };
  const at = d.now();
  const result: Op = { op: "launch", id, at, ok: r.ok, by: d.by ?? "SUPERVISOR", ...(r.jobId ? { jobId: r.jobId } : {}), ...(r.error ? { error: r.error } : {}) };
  if (r.ok) {
    d.append([result]);
    return { ok: true, status: 200 };
  }
  d.append([result, { op: "supersede", id, at, reason: `${LAUNCH_FAILED_WHY} — ${r.error ?? "원인 모름"}` }]);
  return { ok: false, status: 502, error: `${LAUNCH_FAILED_WHY} — ${r.error ?? "원인 모름"}` };
}

// FOLLOWING(ATC-129): 최근 LAUNCH 실패(하루)
export interface LaunchFail {
  flight: string;
  id: string;
  aircraft: string | null;
  reason: string;
  at: string;
}
export function launchFailsOf(proposals: readonly Pick<Proposal, "id" | "flight" | "kind" | "status" | "statusAt" | "reason" | "aircraftName">[], now: number): LaunchFail[] {
  return proposals
    .filter((p) => p.kind === "ASSIGN" && p.status === "superseded" && (p.reason ?? "").startsWith(LAUNCH_FAILED_WHY) && now - Date.parse(p.statusAt) < 86_400_000)
    .map((p) => ({ flight: p.flight, id: p.id, aircraft: p.aircraftName, reason: p.reason!, at: p.statusAt }));
}

// ── RESUME(ATC-129): cut된 AIRCRAFT가 쥐던 FLIGHT, reset이 지났고 새 턴이 없다 → 같은 FLIGHT·REGISTRATION의 RESUME 카드 ──
// 세션이 없는(absent) 백그라운드 AIRCRAFT만. 살아 있는 세션의 RESUME은 ATC-86대로 SUPERVISOR가 "계속"을 보낸다
export function resumePlansOf(
  s: Pick<Snapshot, "tickets" | "workspaces" | "airports"> & Partial<Pick<Snapshot, "absent">>,
  departures: readonly Departure[],
  landed: Landed,
  now: number,
  baseOf: (registration: string) => string | null = () => null, // 등록부의 base AIRPORT(착수 기록이 없는 tail: FLIGHT)
): AssignPlan[] {
  const out: AssignPlan[] = [];
  const byKey = new Map(s.tickets.map((t) => [t.key, t]));
  const open = (k: string) => byKey.get(k)?.stateType === "started" && !landed.has(k);
  for (const a of s.absent ?? []) {
    const cut = a.cut;
    if (!cut?.resetsAt || now < Date.parse(cut.resetsAt)) continue;
    const reg = a.registration;
    // 그 AIRCRAFT가 쥐던 FLIGHT: 마지막 착수 기록(claim·HANDOFF)의 AIRCRAFT가 이 REGISTRATION인 FLIGHT, 그다음 tail: 라벨. 가장 최근 하나
    const lastOf = new Map<string, Departure>();
    for (const d of [...departures].sort((x, y) => x.t.localeCompare(y.t))) if (d.flight && d.aircraft && d.t <= cut.cutAt) lastOf.set(d.flight, d);
    const held = [...lastOf.values()].filter((d) => regKey(d.aircraft) === reg && open(d.flight!)).sort((x, y) => y.t.localeCompare(x.t));
    const tail = s.tickets.filter((t) => open(t.key) && tailsOf(t, now).has(reg)).sort((x, y) => (y.startedAt ?? "").localeCompare(x.startedAt ?? ""));
    const flight = held[0]?.flight ?? tail[0]?.key;
    if (!flight) continue;
    const dep = [...departures].filter((d) => d.flight === flight && d.stand).sort((x, y) => x.t.localeCompare(y.t)).at(-1) ?? null;
    const ws = dep?.stand ? s.workspaces.find((w) => w.path === dep.stand) : undefined;
    const resume: ResumeInfo = {
      cutAt: cut.cutAt,
      resetsAt: cut.resetsAt,
      stand: dep?.stand ?? null,
      branch: ws?.branch ?? dep?.branch ?? null,
      commit: ws?.head ? { sha: ws.head.slice(0, 7), at: ws.lastCommitAt, pushed: ws.pushed ?? null } : null,
      report: cut.report,
    };
    // AIRPORT를 모르면 카드를 만들지 않는다(어느 AIRPORT인지 모르는 FLIGHT PLAN이 된다)
    const airport = dep ? (s.airports.find((x) => x.repo === dep.repo)?.code ?? null) : (s.airports.find((x) => x.code === baseOf(reg))?.code ?? null);
    if (!airport) continue;
    const factor: Factor = { id: "resume", label: "RESUME", value: 1, weight: 0, points: 0, detail: `cut ${hhmm(Date.parse(cut.cutAt), now)} · reset ${hhmm(Date.parse(cut.resetsAt), now)} 지남 · 새 턴 없음` };
    out.push({ kind: "ASSIGN", flight, aircraft: `absent:${reg}`, aircraftName: reg, registration: reg, airport, score: 0, factors: [factor], launch: true, resume });
  }
  return out;
}

// RESUME 카드가 이미 있던 cut인가(한 cut에 한 번). LAUNCH 실패로 닫힌 카드는 세지 않는다 — 다시 나와 SUPERVISOR가 다시 승인할 수 있다
export const resumeKey = (flight: string, cutAt: string) => `${flight}|${cutAt}`;
export function resumedOf(existing: readonly Pick<Proposal, "flight" | "resume" | "status" | "reason">[]): Set<string> {
  return new Set(
    existing.filter((p) => p.resume && !(p.status === "superseded" && (p.reason ?? "").startsWith(LAUNCH_FAILED_WHY))).map((p) => resumeKey(p.flight, p.resume!.cutAt)),
  );
}

// FLIGHT PLAN에 넣는 RESUME 줄. "resume, don't restart"
export function resumeLines(r: ResumeInfo, now: number): string[] {
  // 세션끼리 주고받는 글은 영어(ATC-126). CAPTAIN 보고 줄은 쓴 그대로
  const commit = r.commit ? `last commit ${r.commit.sha}${r.commit.at ? ` (${hhmm(Date.parse(r.commit.at), now)})` : ""}${r.commit.pushed === false ? " — not on origin yet" : ""}` : "no last commit (worktree not found)";
  return [
    `RESUME — This FLIGHT was cut by a usage LIMIT at ${hhmm(Date.parse(r.cutAt), now)}. Resume, don't restart — continue from the remaining work.`,
    `STAND ${r.stand ?? "unknown"} · branch ${r.branch ?? "unknown"} · ${commit}`,
    r.report ? `CAPTAIN's last report: ${r.report}` : null,
  ].filter((l): l is string => Boolean(l));
}

// `tail:`(옛 `lane:`) 라벨이 가리키는 REGISTRATION들. dispatch.ts에서 옮겼다(ATC-338): dispatch.ts가 이 파일을 가져오고 이 파일은 dispatch.ts를 값으로 가져오지 않는다.
export const LANE_CUTOFF = Date.parse("2026-10-10T00:00:00+09:00");
const TAIL_LABEL = /^(tail|lane):\s*(\S+)$/i;
const TAIL_ONLY = /^(tail):\s*(\S+)$/i;
export function tailsOf(t: Pick<Ticket, "labels">, now = Date.now()): Set<string> {
  const re = now < LANE_CUTOFF ? TAIL_LABEL : TAIL_ONLY;
  const regs = t.labels.map((l) => re.exec(l.trim())?.[2]).filter(Boolean) as string[];
  return new Set(regs.map((r) => regKey(r))); // `tail:team-g`도 TEAM_G(ATC-67)
}

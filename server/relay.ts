import { causeOf, resolveRecipient } from "./address.ts";
import type { Clearance, ClearanceType, Session } from "./model.ts";

// SUPERVISOR RELAY(ATC-271): SUPERVISOR가 화면에서 AIRCRAFT에게 짧은 글을 보내는 길. 순수 함수만(파일은 relay-run.ts).
// 글은 TOWER가 CLEARANCE로 그대로 보낸다(INFO·FIX). 닿지 못하면 조용히 닫지 않고 SUPERVISOR QUEUE에 손으로 전하는 카드를 둔다.
// 만드는 길은 화면의 클릭(fromThisApp)뿐이다. atcctl에는 만드는 명령이 없다(표시하는 relay issued·undeliverable만).

export const RELAY_KINDS = ["info", "instruction"] as const;
export type RelayKind = (typeof RELAY_KINDS)[number];
export const RELAY_MAX_CHARS = 2000;
// GO AROUND·FIX를 지시할 STAND 잡은 세션이 없을 때 SUPERVISOR가 TOWER의 글을 그대로 전하는 길(ATC-308). 이 길로 만든 relay만 type과 stand를 가진다
export const RELAY_TYPES = ["GO AROUND", "FIX"] as const;
export type RelayType = (typeof RELAY_TYPES)[number];

export interface Relay {
  id: string; // "R-0001"
  at: string;
  to: string; // AIRCRAFT의 REGISTRATION(세션 이름, TEAM_G)
  kind: RelayKind;
  text: string; // 영어(ATC-126). TOWER는 고치지 않고 그대로 보낸다
  flight: string | null; // "ATC-271"
  pr: number | null;
  type?: RelayType; // ATC-308: GO AROUND·FIX relay(instruction). 있으면 CLEARANCE 종류가 이것이다. 옛 기록엔 없다
  stand?: string | null; // ATC-308: 그 PR의 STAND(워크트리 경로). TOWER가 `--stand`로 붙여 이미 나간 GO AROUND·FIX로 보이게 한다
  status: "queued" | "issued" | "delivered" | "undeliverable" | "hand";
  statusAt: string;
  clearance: string | null; // "C-0301"
  reason: string | null; // undeliverable의 사유
  cause?: string | null; // undeliverable의 원인 분류(ATC-353, address.ts CAUSES). 옛 기록에는 없다
  toSessionId?: string; // 만들 때 찾은 받는 세션(ATC-353). 이름은 바뀌어도 id는 남는다
  toJobId?: string;
  toAccount?: string;
  answer: string | null; // delivered일 때 CAPTAIN의 답: "READBACK" | "ROGER" | "UNABLE — <사유>"
}

type CreateOp = Omit<Relay, "status" | "statusAt" | "clearance" | "reason" | "answer" | "cause">;
export type RelayOp =
  | ({ op: "create" } & CreateOp)
  | { op: "issued"; id: string; at: string; clearance: string }
  | { op: "undeliverable"; id: string; at: string; reason: string; cause?: string }
  | { op: "hand"; id: string; at: string }; // SUPERVISOR가 손으로 전했다고 표시(카드를 닫는다)

// 글자에 일본어·중국어·한국어가 있으면 거절(팀은 영어를 읽는다, ATC-126). 화면도 같은 말을 한다
const NON_ENGLISH = /[ᄀ-ᇿ㄰-㆏가-힯぀-ヿ㐀-䶿一-鿿]/;
// 줄바꿈과 탭 말고 제어 문자는 받지 않는다
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const REG = /^[A-Za-z0-9_-]{1,40}$/;
const FLIGHT = /^[A-Z][A-Z0-9]*-\d+$/;

export interface RelayInput {
  to: string;
  kind: RelayKind;
  text: string;
  flight: string | null;
  pr: number | null;
  type?: RelayType;
  stand?: string | null;
}

// 요청 본문 검사(순수). 틀리면 사유 하나(한국어, 화면에 그대로), 맞으면 정리한 입력
export function relayInputOf(body: unknown): RelayInput | { error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const to = typeof b.to === "string" ? b.to.trim() : "";
  if (!REG.test(to)) return { error: "to는 AIRCRAFT의 REGISTRATION(예: TEAM_G)" };
  if (!RELAY_KINDS.includes(b.kind as RelayKind)) return { error: `kind는 ${RELAY_KINDS.join("|")} 중 하나` };
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return { error: "text가 필요함" };
  if (text.length > RELAY_MAX_CHARS) return { error: `text는 ${RELAY_MAX_CHARS}자 이내(지금 ${text.length}자)` };
  if (CONTROL.test(text)) return { error: "text에 제어 문자가 있음" };
  if (NON_ENGLISH.test(text)) return { error: "text는 영어로 쓴다(세션끼리 주고받는 글은 영어, ATC-126). 한국어·일본어·중국어 글자가 있음" };
  let flight: string | null = null;
  if (b.flight != null && b.flight !== "") {
    flight = typeof b.flight === "string" ? b.flight.trim().toUpperCase() : "";
    if (!FLIGHT.test(flight)) return { error: "flight는 ATC-271 같은 FLIGHT key" };
  }
  let pr: number | null = null;
  if (b.pr != null && b.pr !== "") {
    pr = typeof b.pr === "number" ? b.pr : NaN;
    if (!Number.isInteger(pr) || pr <= 0) return { error: "pr은 양의 정수" };
  }
  let type: RelayType | undefined;
  if (b.type != null && b.type !== "") {
    if (!RELAY_TYPES.includes(b.type as RelayType)) return { error: `type은 ${RELAY_TYPES.join("|")} 중 하나` };
    type = b.type as RelayType;
    if (b.kind !== "instruction") return { error: `type ${type}은 instruction(지시)만` };
    if (pr == null || !flight) return { error: `type ${type}에는 PR 번호(pr)와 FLIGHT(flight)가 필요함` };
  }
  let stand: string | null | undefined;
  if (b.stand != null && b.stand !== "") {
    if (!type) return { error: "stand는 type(GO AROUND·FIX)과 함께만" };
    stand = typeof b.stand === "string" ? b.stand.trim() : "";
    if (!stand || stand.length > 400 || CONTROL.test(stand)) return { error: "stand는 STAND(워크트리) 경로나 이름" };
  }
  return { to, kind: b.kind as RelayKind, text, flight, pr, ...(type ? { type } : {}), ...(stand ? { stand } : {}) };
}

// relay가 쓸 CLEARANCE 종류: 알림은 INFO(ROGER). 지시는 PR이 있으면 FIX, 없으면 CONTINUE. 둘 다 CAPTAIN이 READBACK·UNABLE로 닫는 지시다(response.ts)
// ATC-308: GO AROUND·FIX relay는 그 type 그대로(GO AROUND의 응답도 READBACK·UNABLE이다)
export const clearanceTypeOf = (r: Pick<Relay, "kind" | "pr"> & { type?: RelayType }): ClearanceType => (r.type ? r.type : r.kind === "info" ? "INFO" : r.pr != null ? "FIX" : "CONTINUE");

// 기록(ops)을 접어 지금 상태를 만든다. clearances를 주면 issued를 CAPTAIN의 답에 따라 delivered·undeliverable로 바꿔 보인다
export function foldRelays(ops: readonly RelayOp[], clearances: readonly Pick<Clearance, "id" | "readbackAt" | "ackWord" | "unableAt" | "unableReason" | "cancelledAt" | "undeliverableAt" | "undeliverableReason" | "undeliverableCause">[] = []): Relay[] {
  const byId = new Map<string, Relay>();
  for (const o of ops) {
    if (o.op === "create") {
      const { op: _op, ...rest } = o;
      byId.set(o.id, { ...rest, status: "queued", statusAt: o.at, clearance: null, reason: null, answer: null });
      continue;
    }
    const r = byId.get(o.id);
    if (!r) continue;
    if (o.op === "issued" && r.status === "queued") Object.assign(r, { status: "issued", statusAt: o.at, clearance: o.clearance });
    else if (o.op === "undeliverable" && (r.status === "queued" || r.status === "issued")) Object.assign(r, { status: "undeliverable", statusAt: o.at, reason: o.reason, cause: causeOf(o.reason, o.cause) });
    else if (o.op === "hand" && r.status === "undeliverable") Object.assign(r, { status: "hand", statusAt: o.at });
  }
  const cl = new Map(clearances.map((c) => [c.id, c]));
  for (const r of byId.values()) {
    const c = r.clearance ? cl.get(r.clearance) : undefined;
    if (r.status !== "issued" || !c) continue;
    if (c.undeliverableAt) Object.assign(r, { status: "undeliverable", statusAt: c.undeliverableAt, reason: c.undeliverableReason ?? `${c.id} could not be delivered`, cause: causeOf(c.undeliverableReason, c.undeliverableCause) });
    else if (c.readbackAt) Object.assign(r, { status: "delivered", statusAt: c.readbackAt, answer: c.ackWord ?? "READBACK" });
    else if (c.unableAt) Object.assign(r, { status: "delivered", statusAt: c.unableAt, answer: `UNABLE — ${c.unableReason ?? "no reason"}` });
    else if (c.cancelledAt) Object.assign(r, { status: "undeliverable", statusAt: c.cancelledAt, reason: `${c.id} was cancelled before an answer` });
  }
  return [...byId.values()];
}

export const nextRelayId = (ops: readonly RelayOp[]) => `R-${String(ops.filter((o) => o.op === "create").length + 1).padStart(4, "0")}`;

// ── 손으로 전하는 카드 ──────────────────────────────────────────────

export type HandStep = "attach" | "launch" | "desktop";
export interface HandCard {
  step: HandStep;
  title: string; // 한 줄(한국어): 무엇이 왜 못 닿았나
  how: string; // 한 줄(한국어): 할 일 하나
  command: string | null; // attach: 복사해서 쓰는 명령
  folder: string | null; // attach: 그 세션이 있는 폴더
  jobId: string | null;
  session: string | null; // 받을 세션 이름
}

export interface HandTarget {
  session: Pick<Session, "name" | "status" | "origin" | "jobId" | "account"> | null;
  folderDir: string | null; // 그 세션의 ACCOUNT 폴더(등록부). 모르면 null
  defaultDir: string; // ~/.claude
}

// claude attach 명령. 기본 폴더가 아니면 CLAUDE_CONFIG_DIR를 붙인다(ATC-301과 같은 모양). 경로는 셸에 안전한 글자만 그대로, 아니면 작은따옴표로 감싼다
export function attachCommandIn(jobId: string, dir: string | null, defaultDir: string): string {
  const safe = (s: string) => (/^[\w@%+=:,./~-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  return dir && dir !== defaultDir ? `CLAUDE_CONFIG_DIR=${safe(dir)} claude attach ${jobId}` : `claude attach ${jobId}`;
}

// 닿지 못한 글을 SUPERVISOR가 한 걸음으로 전하는 길(순수).
//   살아 있는 백그라운드 세션(jobId가 있음): 그 폴더에서 claude attach
//   살아 있는 데스크톱·터미널 세션: 그 창에서 붙여 넣기
//   세션이 없거나 끝났다: FLEET에서 그 AIRCRAFT를 LAUNCH하고 글을 첫 프롬프트로
export function handCardOf(to: string, reason: string, t: HandTarget): HandCard {
  const s = t.session && t.session.status !== "dead" ? t.session : null;
  const title = `${to}에 닿지 못함 — ${reason}`;
  if (s && s.origin === "background" && s.jobId) {
    const command = attachCommandIn(s.jobId, t.folderDir, t.defaultDir);
    return { step: "attach", title, how: `${t.folderDir && t.folderDir !== t.defaultDir ? `폴더 ${t.folderDir}에서 ` : ""}아래 명령으로 세션을 열고 글을 붙여 넣는다`, command, folder: t.folderDir, jobId: s.jobId, session: s.name };
  }
  if (s) return { step: "desktop", title, how: `${s.origin === "desktop" ? "Claude 데스크톱" : "그 터미널"}에서 ${s.name} 세션을 열고 글을 붙여 넣는다`, command: null, folder: null, jobId: null, session: s.name };
  return { step: "launch", title, how: `FLEET에서 ${to}를 LAUNCH하고 이 글을 첫 프롬프트로 붙여 넣는다`, command: null, folder: null, jobId: null, session: null };
}

// 세션 목록에서 이 REGISTRATION의 살아 있는 세션 하나(이름이 겹치면 가장 최근 활동)
export function liveSessionOf<T extends Pick<Session, "name" | "status" | "lastActiveAt">>(sessions: readonly T[], to: string): T | null {
  const live = sessions.filter((x) => x.status !== "dead" && x.name.toUpperCase() === to.toUpperCase());
  return live.sort((a, b) => String(b.lastActiveAt ?? "").localeCompare(String(a.lastActiveAt ?? "")))[0] ?? null;
}

// 만들 때 이미 못 닿는 줄 아는 경우의 사유(순수). 닿을 수 있으면 null → TOWER가 보낸다
//   TOWER 세션이 없다: 보낼 관제 세션이 없음. 받을 세션이 없다: 세션 없음. 다른 ACCOUNT 폴더: SendMessage가 같은 폴더 안에서만 이름을 찾는다(ATC-251)
export function unreachableWhy(target: Pick<Session, "name" | "account"> | null, tower: Pick<Session, "account"> | null): string | null {
  if (!target) return "no live session by that name";
  if (!tower) return "TOWER is not running";
  if (target.account && tower.account && target.account !== tower.account) return `cross-ACCOUNT (${tower.account} → ${target.account}): TOWER cannot reach it (ATC-251)`;
  return null;
}

// TOWER의 brief에 실리는 줄: 아직 보내지 않은 relay. text는 고치지 않고 그대로 CLEARANCE로
// sessions를 주면 보낼 때의 살아 있는 세션(id·job id·ACCOUNT)을 덧붙인다(ATC-353, 선택 필드). 이름이 바뀌었어도 만들 때 저장한 id로 찾는다
export function relayBriefOf(relays: readonly Relay[], now = Date.now(), sessions: readonly Pick<Session, "id" | "name" | "status" | "jobId" | "account" | "lastActiveAt">[] = [], teamPattern?: string) {
  return relays
    .filter((r) => r.status === "queued")
    .map((r) => ({ ...relaySendAddressOf(r, sessions, teamPattern), id: r.id, to: r.to, kind: r.kind, type: clearanceTypeOf(r), flight: r.flight, pr: r.pr, ...(r.stand ? { stand: r.stand } : {}), text: r.text, ageMin: Math.round((now - Date.parse(r.at)) / 60_000) }));
}

// ── 받을 AIRCRAFT 제안(ATC-308, 순수) ──────────────────────────────────
// STAND를 쥔 세션이 없는 PR의 GO AROUND·FIX는 그 FLIGHT를 마지막으로 난 AIRCRAFT에게 보낸다. 순서(첫 번째로 아는 것):
//   1. DEPARTURE LOG에서 이 FLIGHT의 가장 늦은 줄의 AIRCRAFT(HANDOFF로 바뀐 뒤의 것이 가장 늦다)
//   2. 가장 늦게 DEPARTED(또는 ARRIVED)한 DISPATCH 제안의 REGISTRATION
//   3. 마지막 도착 보고(`dispatch report`)가 가리키는 제안의 REGISTRATION
//   없으면 null — SUPERVISOR가 직접 고른다
export interface LastAircraftInput {
  departures: readonly { t: string; flight: string | null; aircraft: string | null }[];
  proposals: readonly { id: string; kind: string; flight: string; status: string; registration?: string | null; aircraftName: string | null; statusAt: string; timeline: Partial<Record<string, string>> }[];
  reports: readonly { flight: string; at: string; proposal: string | null }[];
  regOf: (name: string | null | undefined) => string | null; // 세션 이름 → REGISTRATION(registrationOf)
}
export function lastAircraftOf(flight: string | null, x: LastAircraftInput): string | null {
  if (!flight) return null;
  const dep = x.departures.filter((d) => d.flight === flight && d.aircraft).sort((a, b) => a.t.localeCompare(b.t)).at(-1);
  if (dep?.aircraft) return dep.aircraft.toUpperCase();
  const regOfProposal = (p: LastAircraftInput["proposals"][number]) => (p.registration ?? x.regOf(p.aircraftName))?.toUpperCase() ?? null;
  const flown = x.proposals
    .filter((p) => p.kind === "ASSIGN" && p.flight === flight && (p.timeline.departed || p.timeline.arrived))
    .sort((a, b) => String(a.timeline.departed ?? a.timeline.arrived).localeCompare(String(b.timeline.departed ?? b.timeline.arrived)))
    .at(-1);
  const flownReg = flown ? regOfProposal(flown) : null;
  if (flownReg) return flownReg;
  const rep = x.reports.filter((r) => r.flight === flight && r.proposal).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  const p = rep ? x.proposals.find((q) => q.id === rep.proposal) : undefined;
  return p ? regOfProposal(p) : null;
}

// relay의 보낼 때 받는 이: 만들 때 저장한 세션 id → job id → REGISTRATION 순으로 찾는다. 못 찾으면 필드 없음(TOWER가 그대로 `to`로 보내고 실패하면 undeliverable)
export interface SendAddress { sendTo?: string; sendToId?: string; sendToJobId?: string; sendToAccount?: string }
export function relaySendAddressOf(r: Pick<Relay, "to" | "toSessionId" | "toJobId">, sessions: readonly Pick<Session, "id" | "name" | "status" | "jobId" | "account" | "lastActiveAt">[], teamPattern?: string): SendAddress {
  if (!sessions.length) return {};
  const x = resolveRecipient(sessions, { sessionId: r.toSessionId, jobId: r.toJobId, registration: r.to }, teamPattern);
  return x.ok ? { sendTo: x.session.name, sendToId: x.session.id, ...(x.session.jobId ? { sendToJobId: x.session.jobId } : {}), ...(x.session.account ? { sendToAccount: x.session.account } : {}) } : {};
}

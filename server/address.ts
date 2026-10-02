import type { Session } from "./model.ts";
import { regKey } from "./registration.ts";

// FLIGHT PLAN·CLEARANCE·RELAY의 받는 이를 보낼 때 살아 있는 세션으로 정한다(ATC-353). 순수.
// 이름은 재시작·이름 바꾸기·ACCOUNT 이동으로 바뀐다. 그래서 STAND를 쥔 세션이나 FLIGHT의 주인(REGISTRATION)에서 출발해 그 순간의 세션(id·job id·ACCOUNT)을 찾고,
// PR·FLIGHT 제목은 주소로 받지 않는다. 글(문구)과 guard가 읽는 머리는 건드리지 않는다.

export type AddressSession = Pick<Session, "id" | "name" | "status"> & Partial<Pick<Session, "jobId" | "account" | "origin" | "lastActiveAt" | "workspacePath">>;

export interface RecipientRef {
  sessionId?: string | null; // 저장해 둔 세션 id: 이름이 바뀌어도 같은 세션을 찾는다
  jobId?: string | null; // 백그라운드 job id
  registration?: string | null; // AIRCRAFT REGISTRATION(TEAM_A → ALPHA 가 아니라 regKey가 읽는 키)
  name?: string | null; // 세션 이름(SendMessage 주소). 제목 꼴이면 거절한다
}

export const CAUSES = ["absent", "cross-account", "tower-down", "restarting", "bad-recipient", "stale-address", "other"] as const;
export type UndeliveredCause = (typeof CAUSES)[number];
export const isCause = (v: unknown): v is UndeliveredCause => typeof v === "string" && (CAUSES as readonly string[]).includes(v);

export type Resolved =
  | { ok: true; session: AddressSession; via: "id" | "job" | "registration" | "name" }
  | { ok: false; cause: UndeliveredCause; why: string };

// 이름 자리에 들어온 글이 제목(PR 제목·FLIGHT 제목·이슈 키)이면 true. 세션 이름·REGISTRATION은 공백도 `#`도 없는 한 낱말이다
export function looksLikeTitle(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (/\s/.test(t) || /[#"'`:()[\]]/.test(t)) return true;
  if (/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(t) && !/^(TEAM|CC|D|C|R)-/i.test(t)) return true; // ATC-353 같은 이슈·FLIGHT 키
  return t.length > 40;
}

const live = (x: AddressSession) => x.status !== "dead";
const freshest = <T extends AddressSession>(list: T[]) => [...list].sort((a, b) => String(b.lastActiveAt ?? "").localeCompare(String(a.lastActiveAt ?? "")))[0] ?? null;

// 받는 이 하나를 살아 있는 세션으로. 순서: id → job id → REGISTRATION → 이름(제목 꼴이면 거절). 없으면 cause absent
export function resolveRecipient(sessions: readonly AddressSession[], ref: RecipientRef, teamPattern?: string): Resolved {
  if (ref.sessionId) {
    const s = sessions.find((x) => x.id === ref.sessionId && live(x));
    if (s) return { ok: true, session: s, via: "id" };
  }
  if (ref.jobId) {
    const s = sessions.find((x) => x.jobId === ref.jobId && live(x));
    if (s) return { ok: true, session: s, via: "job" };
  }
  if (ref.registration) {
    const reg = ref.registration.toUpperCase();
    const s = freshest(sessions.filter((x) => live(x) && regKey(x.name, teamPattern)?.toUpperCase() === reg));
    if (s) return { ok: true, session: s, via: "registration" };
  }
  const name = ref.name?.trim();
  if (name && !ref.sessionId && !ref.jobId && !ref.registration) {
    if (looksLikeTitle(name)) return { ok: false, cause: "bad-recipient", why: `"${name.slice(0, 60)}" is a title, not a session: address by session id or REGISTRATION (ATC-353)` };
    const s = freshest(sessions.filter((x) => live(x) && x.name.toUpperCase() === name.toUpperCase()));
    if (s) return { ok: true, session: s, via: "name" };
  }
  const who = ref.registration ?? ref.name ?? ref.sessionId ?? ref.jobId ?? "recipient";
  return { ok: false, cause: "absent", why: `no live session for ${who}` };
}

// STAND를 쥔 세션(그 워크스페이스 경로가 cwd의 워크스페이스인 살아 있는 세션). 본 체크아웃을 쥔 관제 세션은 쥔 것이 아니다
export function standHolderOf(sessions: readonly AddressSession[], standPath: string | null | undefined): AddressSession | null {
  if (!standPath) return null;
  return freshest(sessions.filter((x) => live(x) && x.workspacePath === standPath));
}

// 실패 사유 글 → 원인 분류. 명시한 cause가 있으면 그것을 쓴다
export function causeOf(reason: string | null | undefined, explicit?: string | null): UndeliveredCause {
  if (isCause(explicit)) return explicit;
  const r = reason ?? "";
  if (/\bis a title\b|bad recipient|not a (?:session|recipient)/i.test(r)) return "bad-recipient";
  if (/cross-?ACCOUNT|ACCOUNT 불일치|different ACCOUNT|ATC-251/i.test(r)) return "cross-account";
  if (/TOWER is not running|OCC is not running|control session (?:is )?(?:down|not running)/i.test(r)) return "tower-down";
  if (/RESTARTING|restart|새 세션이 뜬 뒤/i.test(r)) return "restarting";
  if (/ENOENT|stale address|old address|renamed/i.test(r)) return "stale-address";
  if (/no live session|세션 없음|세션이 없|not running|absent|no such session|not found/i.test(r)) return "absent";
  return "other";
}

// ── 실패한 뒤의 길 ──
// 1) retry: 그 AIRCRAFT의 다음 CHECK IN이나 relaunch 뒤에 한 번 다시 보낸다
// 2) dispatch: 세션이 없다 → DISPATCH가 RESUME이나 LAUNCH 카드를 제안한다
// 3) duty: DUTY 카드
// 4) supervisor: DUTY도 못 전했을 때만 SUPERVISOR의 손으로 전하는 카드
// 단계는 시각으로 정해진다(기본값: 재시도 5분, DISPATCH 10분, DUTY 20분 — 실패 시각부터의 누적). 시각은 ATC-353 PILOT'S DISCRETION
export type Stage = "retry" | "dispatch" | "duty" | "supervisor";
export const STAGE_ORDER: readonly Stage[] = ["retry", "dispatch", "duty", "supervisor"];
export const STAGE_MIN = { retry: 5, dispatch: 10, duty: 20 } as const;

export interface FailureInput {
  at: string; // 실패 알림 시각
  cause: UndeliveredCause;
  attempts: number; // 이 글의 실패 횟수(첫 실패 = 1)
  sessionLive: boolean; // 지금 받는 이의 세션이 살아 있다(CHECK IN·relaunch가 있었다)
  dutyOn: boolean; // DUTY(L1)가 켜져 있다. 꺼져 있으면 duty 단계는 건너뛴다
}
export interface FailureRoute {
  stage: Stage;
  action: "retry" | "propose-resume-or-launch" | "duty-card" | "supervisor-card";
}

export function failureRouteOf(f: FailureInput, now: number): FailureRoute {
  const age = (now - Date.parse(f.at)) / 60_000;
  const absent = f.cause === "absent" && !f.sessionLive;
  // 한 번만 다시 보낸다: 첫 실패이고, 받는 이가 있거나 곧 돌아올 때(세션이 없는 absent는 DISPATCH로)
  if (f.attempts < 2 && !absent && age < STAGE_MIN.retry) return { stage: "retry", action: "retry" };
  if (absent && age < STAGE_MIN.dispatch) return { stage: "dispatch", action: "propose-resume-or-launch" };
  if (f.dutyOn && age < STAGE_MIN.duty) return { stage: "duty", action: "duty-card" };
  return { stage: "supervisor", action: "supervisor-card" };
}

// 시각 기준 지금의 단계. SUPERVISOR 카드는 supervisor 단계가 되어서야 뜬다
export const surfacesToSupervisor = (f: FailureInput, now: number) => failureRouteOf(f, now).stage === "supervisor";

import { DEFAULT_FINGERPRINT, DEFAULT_MODE, type Fingerprint, FINGERPRINTS, type Mode, MODES, modeOf, type Role, ROLES } from "./squelch.ts";

// SQUELCH 스위치(ATC-552, docs/squelch.md "Switch as built"): SUPERVISOR가 역할 하나의 mode·heartbeatMin·fingerprint를 고친다.
// 여기는 순수 함수만 둔다(파일과 route는 squelch-switch-run.ts). 틀린 값은 쓰기를 거절하고, 저장된 틀린 값은 읽을 때 기본값(shadow·50·v1)이라 tick은 늘 돈다.

export const FIELDS = ["mode", "heartbeatMin", "fingerprint"] as const;
export type Field = (typeof FIELDS)[number];
export const HEARTBEAT_MAX_MIN = 720;

export interface RoleSwitch {
  mode?: Mode;
  heartbeatMin?: number;
  fingerprint?: Fingerprint;
}
// 설정 중 이 스위치가 만지는 부분(squelch-run의 SquelchConfig와 모양이 같다)
export interface SwitchConfig {
  mode: Mode;
  roles: Partial<Record<Role, { mode: Mode }>>;
  heartbeatMin: Record<Role, number>;
  fingerprint: Record<Role, Fingerprint>;
}
export interface Change {
  role: Role;
  field: Field;
  from: string | number;
  to: string | number;
}
export interface ChangeLine extends Change {
  t: string;
  by: string;
}

// 본문 → 검사한 값. 모르는 필드·값은 오류 문구(쓰지 않는다). 필드가 하나도 없어도 오류
export function parsePatch(body: unknown): { ok: true; patch: RoleSwitch } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "본문이 객체가 아님" };
  const b = body as Record<string, unknown>;
  const unknown = Object.keys(b).filter((k) => !(FIELDS as readonly string[]).includes(k));
  if (unknown.length) return { ok: false, error: `모르는 필드 ${unknown.join(", ")} — ${FIELDS.join("|")}` };
  const patch: RoleSwitch = {};
  if (b.mode !== undefined) {
    if (!MODES.includes(b.mode as Mode)) return { ok: false, error: `mode는 ${MODES.join("|")} 중 하나` };
    patch.mode = b.mode as Mode;
  }
  if (b.heartbeatMin !== undefined) {
    const m = b.heartbeatMin;
    if (typeof m !== "number" || !Number.isInteger(m) || m < 1 || m > HEARTBEAT_MAX_MIN) return { ok: false, error: `heartbeatMin은 1–${HEARTBEAT_MAX_MIN} 정수(분)` };
    patch.heartbeatMin = m;
  }
  if (b.fingerprint !== undefined) {
    if (!FINGERPRINTS.includes(b.fingerprint as Fingerprint)) return { ok: false, error: `fingerprint는 ${FINGERPRINTS.join("|")} 중 하나` };
    patch.fingerprint = b.fingerprint as Fingerprint;
  }
  return Object.keys(patch).length ? { ok: true, patch } : { ok: false, error: `바꿀 필드가 없음 — ${FIELDS.join("|")}` };
}

// 한 역할에 patch를 얹은 설정과 실제로 바뀐 것(같은 값이면 바뀐 것이 아니라 기록하지 않는다).
// mode를 정하면 값이 전체 모드와 같아도 역할 칸에 적는다(전체 모드가 나중에 바뀌어도 이 역할은 그대로)
export function applyPatch(cfg: SwitchConfig, role: Role, patch: RoleSwitch): { config: SwitchConfig; changes: Change[] } {
  const config: SwitchConfig = { ...cfg, roles: { ...cfg.roles }, heartbeatMin: { ...cfg.heartbeatMin }, fingerprint: { ...cfg.fingerprint } };
  const changes: Change[] = [];
  if (patch.mode !== undefined) {
    const from = modeOf(cfg, role);
    config.roles[role] = { mode: patch.mode };
    if (from !== patch.mode) changes.push({ role, field: "mode", from, to: patch.mode });
  }
  if (patch.heartbeatMin !== undefined) {
    const from = cfg.heartbeatMin[role];
    config.heartbeatMin[role] = patch.heartbeatMin;
    if (from !== patch.heartbeatMin) changes.push({ role, field: "heartbeatMin", from, to: patch.heartbeatMin });
  }
  if (patch.fingerprint !== undefined) {
    const from = cfg.fingerprint[role];
    config.fingerprint[role] = patch.fingerprint;
    if (from !== patch.fingerprint) changes.push({ role, field: "fingerprint", from, to: patch.fingerprint });
  }
  return { config, changes };
}

// 끄기: 모든 역할의 모드를 shadow로(역할 칸은 지우고 전체 모드도 shadow), 지문을 v1으로. heartbeatMin은 그대로(shadow에서는 늘 열려 영향이 없다)
export function resetAll(cfg: SwitchConfig): { config: SwitchConfig; changes: Change[] } {
  const config: SwitchConfig = { ...cfg, mode: DEFAULT_MODE, roles: {}, heartbeatMin: { ...cfg.heartbeatMin }, fingerprint: { ...cfg.fingerprint } };
  const changes: Change[] = [];
  for (const role of ROLES) {
    const from = modeOf(cfg, role);
    if (from !== DEFAULT_MODE) changes.push({ role, field: "mode", from, to: DEFAULT_MODE });
    if (cfg.fingerprint[role] !== DEFAULT_FINGERPRINT) changes.push({ role, field: "fingerprint", from: cfg.fingerprint[role], to: DEFAULT_FINGERPRINT });
    config.fingerprint[role] = DEFAULT_FINGERPRINT;
  }
  return { config, changes };
}

// 역할마다, 필드마다 마지막으로 바뀐 줄
export function lastChanges(lines: readonly ChangeLine[]): Partial<Record<Role, Partial<Record<Field, ChangeLine>>>> {
  const out: Partial<Record<Role, Partial<Record<Field, ChangeLine>>>> = {};
  for (const l of lines) {
    const r = (out[l.role] ??= {});
    const cur = r[l.field];
    if (!cur || Date.parse(l.t) >= Date.parse(cur.t)) r[l.field] = l;
  }
  return out;
}

// 최근 7일에 바뀐 횟수(줄 수. 한 요청이 필드 둘을 바꾸면 둘)
export const WEEK_MS = 7 * 86_400_000;
export const changesThisWeek = (lines: readonly ChangeLine[], now: number): number => lines.filter((l) => now - Date.parse(l.t) <= WEEK_MS).length;

// 읽은 줄이 이 모양인지(깨진 줄은 버린다)
export function asChangeLine(x: unknown): ChangeLine | null {
  const l = x as Partial<ChangeLine> | null;
  if (!l || typeof l.t !== "string" || !Number.isFinite(Date.parse(l.t)) || typeof l.by !== "string") return null;
  if (!ROLES.includes(l.role as Role) || !(FIELDS as readonly string[]).includes(l.field as string)) return null;
  if (!["string", "number"].includes(typeof l.from) || !["string", "number"].includes(typeof l.to)) return null;
  return l as ChangeLine;
}

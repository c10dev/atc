import type { AlertEvent, AlertGroup, SupervisorAlert } from "../../server/supervisor-alerts.ts";

// SUPERVISOR alerts(ATC-87)의 화면 쪽 순수 계산: 설정, key 차이(한 번만 알림), 종류 필터, 소리 고르기, 조용한 시간.
// DOM(Notification·Web Audio·localStorage)은 alerts-runtime.ts와 sound.ts가 맡는다.
export { ALERT_GROUPS } from "../../server/supervisor-alerts.ts";
export type { AlertEvent, AlertGroup, SupervisorAlert };

export const FLAP_MS = 10 * 60_000; // 사라졌다 돌아온 같은 key는 이 시간 안에는 다시 알리지도, 울리지도 않는다
export const BURST_MS = 2_000; // 이 안에 함께 오는 key는 가장 높은 등급 소리 하나

// ── 설정(이 브라우저에만, 기본은 모두 꺼짐) ──
export type SoundName = "warning" | "caution" | "call" | "done";
export const SOUND_NAMES: readonly SoundName[] = ["warning", "caution", "call", "done"];

export const GROUP_LABEL: Record<AlertGroup, string> = {
  health: "AIRCRAFT health (LIMIT·RESUME·STALLED…)",
  alert: "ALERT (CONTACT·STAND·충돌)",
  following: "FLIGHT FOLLOWING",
  pending: "SUPERVISOR 대기 (PENDING·제안·HUMAN CHECK)",
  land: "PR 착륙 가능",
  rts: "RTS 결과",
};
export const SOUND_LABEL: Record<SoundName, string> = { warning: "WARNING", caution: "CAUTION", call: "CALL (대기 항목)", done: "DONE (RTS 결과)" };

export interface AlertPrefs {
  notify: boolean; // 브라우저 알림
  groups: Record<AlertGroup, boolean>; // 알림을 받을 종류
  sound: boolean; // 소리(알림과 따로)
  sounds: Record<SoundName, boolean>; // 소리별 켜기. DONE은 기본 꺼짐
  volume: number; // 0..1
  quiet: { on: boolean; from: string; to: string }; // 조용한 시간(현지). "HH:MM"
}

export const DEFAULT_PREFS: AlertPrefs = {
  notify: false,
  groups: { health: true, alert: true, following: true, pending: true, land: true, rts: true },
  sound: false,
  sounds: { warning: true, caution: true, call: true, done: false },
  volume: 0.6,
  quiet: { on: false, from: "22:00", to: "08:00" },
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

// 저장된 값(믿을 수 없다)을 설정으로. 모르는 필드는 버리고 빠진 것은 기본값
export function parsePrefs(raw: unknown): AlertPrefs {
  const d = DEFAULT_PREFS;
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const g = obj(o.groups);
  const s = obj(o.sounds);
  const q = obj(o.quiet);
  const vol = typeof o.volume === "number" && Number.isFinite(o.volume) ? Math.min(1, Math.max(0, o.volume)) : d.volume;
  return {
    notify: bool(o.notify, d.notify),
    groups: Object.fromEntries(Object.entries(d.groups).map(([k, v]) => [k, bool(g[k], v)])) as AlertPrefs["groups"],
    sound: bool(o.sound, d.sound),
    sounds: Object.fromEntries(Object.entries(d.sounds).map(([k, v]) => [k, bool(s[k], v)])) as AlertPrefs["sounds"],
    volume: vol,
    quiet: { on: bool(q.on, d.quiet.on), from: typeof q.from === "string" && HHMM.test(q.from) ? q.from : d.quiet.from, to: typeof q.to === "string" && HHMM.test(q.to) ? q.to : d.quiet.to },
  };
}

// ── 한 번만 알리기 ──
// key마다: 지금 있는 중이면 clearedAt null, 사라졌으면 그 시각. seeded는 이 브라우저가 기준선을 한 번이라도 잡았나(처음 연결이 알림 폭탄이 되지 않게)
export interface SeenState {
  seeded: boolean;
  keys: Record<string, { clearedAt: number | null }>;
}
export const EMPTY_SEEN: SeenState = { seeded: false, keys: {} };

const KEEP_CLEARED_MS = 60 * 60_000;

export function parseSeen(raw: unknown): SeenState {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const keys: SeenState["keys"] = {};
  if (o.keys && typeof o.keys === "object") {
    for (const [k, v] of Object.entries(o.keys as Record<string, any>)) {
      if (v && typeof v === "object" && (v.clearedAt === null || typeof v.clearedAt === "number")) keys[k] = { clearedAt: v.clearedAt };
    }
  }
  return { seeded: o.seeded === true, keys };
}

// 서버의 `alert` 이벤트를 적용한다(순수). fresh: 이번에 알릴 key(설정으로 거르기 전), state: 다음 상태
export function applyAlertEvent(state: SeenState, ev: AlertEvent, now: number): { state: SeenState; fresh: SupervisorAlert[] } {
  const keys: SeenState["keys"] = { ...state.keys };
  const fresh: SupervisorAlert[] = [];
  const isFlap = (k: string) => {
    const c = keys[k]?.clearedAt;
    return typeof c === "number" && now - c < FLAP_MS;
  };
  const present = new Set(ev.items.map((a) => a.key));
  // 사라진 key: 이벤트가 알려 준 것, initial이면 우리가 있다고 적어 둔 것 가운데 지금 없는 것
  const gone = ev.initial ? Object.keys(keys).filter((k) => keys[k].clearedAt === null && !present.has(k)) : ev.cleared;
  for (const k of gone) if (k in keys && keys[k].clearedAt === null) keys[k] = { clearedAt: now };
  const candidates = ev.initial ? ev.items : ev.raised;
  for (const a of candidates) {
    const known = keys[a.key];
    if (known && known.clearedAt === null) continue; // 이미 알린(또는 기준선인) key
    const silent = ev.initial && !state.seeded; // 이 브라우저의 첫 기준선
    if (!silent && !isFlap(a.key)) fresh.push(a);
    keys[a.key] = { clearedAt: null };
  }
  for (const [k, v] of Object.entries(keys)) if (v.clearedAt !== null && now - v.clearedAt > KEEP_CLEARED_MS) delete keys[k];
  return { state: { seeded: state.seeded || ev.initial, keys }, fresh };
}

// ── 종류 필터 ──
export const kindFilter = (items: readonly SupervisorAlert[], prefs: Pick<AlertPrefs, "groups">) => items.filter((a) => prefs.groups[a.group]);

// 조치가 필요한 것: WARNING·CAUTION이거나 SUPERVISOR를 기다리는 것. 탭 제목·종 숫자는 이것만 센다
export const needsAction = (a: Pick<SupervisorAlert, "level" | "cue">) => a.level === "warning" || a.level === "caution" || a.cue === "call";

// ── 조용한 시간(현지). 자정을 넘는 구간도 ──
export function inQuiet(q: AlertPrefs["quiet"], at: Date): boolean {
  if (!q.on) return false;
  const min = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const from = min(q.from);
  const to = min(q.to);
  const cur = at.getHours() * 60 + at.getMinutes();
  if (from === to) return false;
  return from < to ? cur >= from && cur < to : cur >= from || cur < to;
}

// ── 소리 고르기 ──
// 순위: WARNING이 가장 높고, 아래로 CAUTION, CALL, DONE
export const SOUND_RANK: Record<SoundName, number> = { warning: 4, caution: 3, call: 2, done: 1 };

// 한 항목이 내는 소리(설정 전). 등급도 cue도 없으면 null(옛 서버: 짐작하지 않는다)
export function soundOfAlert(a: Pick<SupervisorAlert, "level" | "cue">): SoundName | null {
  if (a.cue === "call") return "call";
  if (a.cue === "done") return "done";
  if (a.level === "warning") return "warning";
  if (a.level === "caution") return "caution";
  return null; // ADVISORY와 등급 없음은 조용하다
}

export interface SoundContext {
  lastSounded: Readonly<Record<string, number>>; // key → 마지막으로 울린 시각
  playing: SoundName | null; // 지금 울리는 소리
}
export interface SoundDecision {
  sound: SoundName | null;
  repeat: boolean; // WARNING은 ACK할 때까지 되풀이
  interrupt: boolean; // 지금 울리는 낮은 소리를 끊는다
  keys: string[]; // 이 결정에 든 key(울린 시각을 적는다)
}
const NONE: SoundDecision = { sound: null, repeat: false, interrupt: false, keys: [] };

// changes: 2초 안에 함께 온 알림들(이미 한 번만 알림을 통과한 것). 소리 하나만 고른다
export function soundFor(changes: readonly SupervisorAlert[], prefs: AlertPrefs, now: number, ctx: SoundContext): SoundDecision {
  if (!prefs.sound || inQuiet(prefs.quiet, new Date(now))) return NONE;
  const eligible = changes
    .filter((a) => now - (ctx.lastSounded[a.key] ?? -Infinity) >= FLAP_MS)
    .map((a) => ({ a, s: soundOfAlert(a) }))
    .filter((x): x is { a: SupervisorAlert; s: SoundName } => x.s !== null && prefs.sounds[x.s]);
  if (!eligible.length) return NONE;
  const top = eligible.reduce((m, x) => (SOUND_RANK[x.s] > SOUND_RANK[m.s] ? x : m));
  // 한 번에 하나: 울리는 소리가 같거나 높으면 새 소리는 내지 않는다. 더 높으면 끊는다
  if (ctx.playing && SOUND_RANK[top.s] <= SOUND_RANK[ctx.playing]) return NONE;
  return { sound: top.s, repeat: top.s === "warning", interrupt: ctx.playing !== null, keys: eligible.map((x) => x.a.key) };
}

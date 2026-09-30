import type { Transmission } from "../../server/radio.ts";

// RADIO 듣기(ATC-172)의 순수 계산: 무엇을 들을지, 큐, 설정 저장. 재생은 views/Radio.tsx가 alerts-runtime의 무전 체인으로 한다.

export type ListenMode = "calls" | "unanswered" | "all";
export const LISTEN_MODES: readonly { id: ListenMode; label: string }[] = [
  { id: "calls", label: "호출만" },
  { id: "unanswered", label: "답 없는 호출만" },
  { id: "all", label: "전부" },
];
export const RATES = [1, 1.5] as const;
export type Rate = (typeof RATES)[number];
export const QUEUE_CAP = 5; // 이만큼 밀리면 오래된 것부터 버린다

// 소음 고르기: 호출만(답은 빼고) · 답 없는 호출만(지금 열려 있는 호출) · 전부
export function wantsToHear(t: Pick<Transmission, "replyTo" | "open">, mode: ListenMode): boolean {
  if (mode === "all") return true;
  if (mode === "calls") return !t.replyTo;
  return !t.replyTo && Boolean(t.open);
}

// 큐에 더한다. cap을 넘으면 가장 오래된 것부터 버리고 몇 건 버렸는지 돌려준다
export function enqueue<T>(queue: readonly T[], incoming: readonly T[], cap = QUEUE_CAP): { queue: T[]; skipped: number } {
  const all = [...queue, ...incoming];
  const skipped = Math.max(0, all.length - cap);
  return { queue: all.slice(skipped), skipped };
}

// GET /api/radio/<id>.wav의 주소. 자리별 목소리 지정은 ?voices=TOWER:name,…
export function wavUrlOf(id: string, voices: Readonly<Record<string, string>>): string {
  const v = Object.entries(voices).filter(([, name]) => name).map(([role, name]) => `${role}:${name}`).join(",");
  return `/api/radio/${encodeURIComponent(id)}.wav${v ? `?voices=${encodeURIComponent(v)}` : ""}`;
}

// ── 이 브라우저에만 저장(atc.radio.listen*): 꺼짐이 기본, 못 읽으면 꺼짐 ──
export interface ListenPrefs {
  on: boolean;
  mode: ListenMode;
  rate: Rate;
  voices: Record<string, string>; // 자리(TOWER·DELIVERY·GROUND·COMPANY) → 목소리 이름. 없으면 서버 기본
}
export const DEFAULT_LISTEN: ListenPrefs = { on: false, mode: "calls", rate: 1, voices: {} };
const KEY = "atc.radio.listen";
const ROLES = ["TOWER", "DELIVERY", "GROUND", "COMPANY"];

export function parseListen(raw: unknown): ListenPrefs {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const voices: Record<string, string> = {};
  if (o.voices && typeof o.voices === "object") {
    for (const [role, name] of Object.entries(o.voices as Record<string, unknown>)) if (ROLES.includes(role) && typeof name === "string" && /^[\w.-]{1,80}$/.test(name)) voices[role] = name;
  }
  return {
    on: o.on === true,
    mode: LISTEN_MODES.some((m) => m.id === o.mode) ? (o.mode as ListenMode) : DEFAULT_LISTEN.mode,
    rate: o.rate === 1.5 ? 1.5 : 1,
    voices,
  };
}

export function loadListen(storage: Pick<Storage, "getItem"> | null): ListenPrefs {
  try {
    return storage ? parseListen(JSON.parse(storage.getItem(KEY) ?? "null")) : DEFAULT_LISTEN;
  } catch {
    return DEFAULT_LISTEN;
  }
}
export function saveListen(storage: Pick<Storage, "setItem"> | null, p: ListenPrefs) {
  try {
    storage?.setItem(KEY, JSON.stringify(p));
  } catch {}
}

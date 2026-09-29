import { useSyncExternalStore } from "react";
import { createPlayer, type AudioState } from "./sound.ts";
import {
  type AlertEvent,
  type AlertPrefs,
  applyAlertEvent,
  BURST_MS,
  DEFAULT_PREFS,
  EMPTY_SEEN,
  kindFilter,
  needsAction,
  parsePrefs,
  parseSeen,
  type SeenState,
  soundFor,
  type SupervisorAlert,
} from "./supervisor-alerts.ts";

// SUPERVISOR alerts(ATC-87)의 브라우저 쪽: SSE `alert` 이벤트를 받아 알림(Notification)과 소리(Web Audio)를 내고, 종 목록을 든다.
// 계산은 supervisor-alerts.ts(순수). 여기는 localStorage·Notification·BroadcastChannel·Web Locks를 부르는 얇은 층이다.
// 여러 탭: 이벤트마다 Web Locks 안에서 저장된 "이미 본 key"를 읽고 고쳐 쓰므로, 같은 key는 먼저 잡은 탭 하나만 알리고 울린다.

const PREFS_KEY = "atc.alerts.prefs";
const SEEN_KEY = "atc.alerts.seen";
const ACKED_KEY = "atc.alerts.acked";

const read = (key: string): unknown => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null; // 저장소를 못 쓰는 창이면 기본값
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

interface View {
  prefs: AlertPrefs;
  items: SupervisorAlert[]; // 지금 있는 알림 전체
  acked: string[]; // 확인(ACK)한 key
  permission: NotificationPermission | "unsupported";
  audio: AudioState;
  playing: string | null;
}

const permissionNow = (): View["permission"] => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);

// 확인(ACK)한 key는 새로고침·다른 탭에서도 이어진다
function ackedStored(): string[] {
  const v = read(ACKED_KEY);
  return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : [];
}

let view: View = { prefs: parsePrefs(read(PREFS_KEY)), items: [], acked: ackedStored(), permission: permissionNow(), audio: "off", playing: null };
const subs = new Set<() => void>();
const emit = (patch: Partial<View> = {}) => {
  view = { ...view, ...patch, audio: player.state(), playing: player.playing(), permission: permissionNow() };
  updateTitle();
  for (const s of subs) s();
};

const player = createPlayer(undefined, () => emit());
const lastSounded: Record<string, number> = {};
let burst: SupervisorAlert[] = [];
let burstTimer: ReturnType<typeof setTimeout> | null = null;

const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("atc-alerts");

// ── 탭 제목: 알림이 꺼져 있거나 거부됐을 때 조치할 항목 수를 제목에 ──
let baseTitle: string | null = null;
function updateTitle() {
  if (typeof document === "undefined") return;
  baseTitle ??= document.title.replace(/^\(\d+\) /, "");
  const fallback = !view.prefs.notify || view.permission !== "granted";
  const n = view.items.filter((a) => needsAction(a) && !view.acked.includes(a.key)).length;
  document.title = fallback && n ? `(${n}) ${baseTitle}` : baseTitle;
}

// ── 이벤트 ──
async function claim(ev: AlertEvent): Promise<SupervisorAlert[]> {
  const step = () => {
    const seen: SeenState = parseSeen(read(SEEN_KEY) ?? EMPTY_SEEN);
    const r = applyAlertEvent(seen, ev, Date.now());
    write(SEEN_KEY, r.state);
    return r.fresh;
  };
  const locks = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { locks?: LockManager }).locks;
  return locks ? locks.request("atc-alerts-seen", async () => step()) : step();
}

function itemsAfter(cur: SupervisorAlert[], ev: AlertEvent): SupervisorAlert[] {
  if (ev.initial) return ev.items;
  const gone = new Set(ev.cleared);
  const have = new Set(cur.map((a) => a.key));
  return [...cur.filter((a) => !gone.has(a.key)), ...ev.raised.filter((a) => !have.has(a.key))];
}

function show(a: SupervisorAlert) {
  if (!view.prefs.notify || view.permission !== "granted") return;
  const title = `${a.aircraft ?? "atc"}${a.flight ? ` · ${a.flight}` : ""}`;
  try {
    const n = new Notification(title, { body: `${a.text}${a.next ? `\n→ ${a.next}` : ""}`, tag: a.key });
    n.onclick = () => {
      window.focus();
      openAlert(a);
      n.close();
    };
  } catch {}
}

export function openAlert(a: Pick<SupervisorAlert, "key" | "link">) {
  ack([a.key]);
  if (location.hash !== a.link) location.hash = a.link;
}

export async function handleAlertEvent(ev: AlertEvent) {
  const fresh = kindFilter(await claim(ev), view.prefs);
  const acked = view.acked.filter((k) => ev.items.some((a) => a.key === k)); // 사라진 key의 확인은 잊는다
  write(ACKED_KEY, acked);
  emit({ items: itemsAfter(view.items, ev), acked });
  for (const a of fresh) show(a);
  if (!fresh.length) return;
  burst.push(...fresh);
  burstTimer ??= setTimeout(flushBurst, BURST_MS);
}

function flushBurst() {
  const batch = burst;
  burst = [];
  burstTimer = null;
  const now = Date.now();
  const d = soundFor(batch, view.prefs, now, { lastSounded, playing: player.playing() });
  if (!d.sound) return;
  for (const k of d.keys) lastSounded[k] = now;
  player.play(d.sound, view.prefs.volume, d.repeat);
}

// ── 확인(ACK): WARNING 되풀이를 그친다. 다른 탭에도 알린다 ──
export function ack(keys: string[], fromChannel = false) {
  const acked = [...new Set([...view.acked, ...keys])];
  const warningLeft = view.items.some((a) => a.level === "warning" && !acked.includes(a.key));
  if (!warningLeft && player.playing() === "warning") player.stop();
  if (!fromChannel) write(ACKED_KEY, acked);
  emit({ acked });
  if (!fromChannel) channel?.postMessage({ type: "ack", keys });
}
channel?.addEventListener("message", (e) => {
  const d = e.data as { type?: string; keys?: unknown };
  if (d?.type === "ack" && Array.isArray(d.keys)) ack(d.keys.map(String), true);
});
// 탭을 다시 보면 그 WARNING을 본 것으로 친다
if (typeof document !== "undefined") {
  const seen = () => {
    if (document.visibilityState === "visible") ack(view.items.filter((a) => a.level === "warning").map((a) => a.key));
  };
  document.addEventListener("visibilitychange", seen);
  addEventListener("focus", seen);
}

// ── 설정 ──
export function updatePrefs(patch: Partial<AlertPrefs> | ((p: AlertPrefs) => AlertPrefs)) {
  const prefs = typeof patch === "function" ? patch(view.prefs) : { ...view.prefs, ...patch };
  write(PREFS_KEY, prefs);
  emit({ prefs });
}
// storage 이벤트: 다른 탭에서 바꾼 설정을 따른다
if (typeof addEventListener === "function") {
  addEventListener("storage", (e) => {
    if (e.key === PREFS_KEY) emit({ prefs: parsePrefs(read(PREFS_KEY)) });
    if (e.key === ACKED_KEY) emit({ acked: ackedStored() });
  });
}

// 알림 켜기: 권한을 물은 결과가 granted일 때만 켠다(클릭 안에서 부른다)
export async function enableNotify(): Promise<NotificationPermission | "unsupported"> {
  if (typeof Notification === "undefined") return "unsupported";
  const p = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  updatePrefs({ notify: p === "granted" });
  return p;
}
// 소리 켜기: 이 클릭이 AudioContext를 푼다. 켜면 확인용으로 CAUTION 소리를 한 번 낸다
export async function enableSound() {
  await player.unlock();
  updatePrefs({ sound: true });
  if (player.state() === "running") player.play("caution", view.prefs.volume, false);
}
export const disableSound = () => {
  player.stop();
  updatePrefs({ sound: false });
};
// 소리가 멈춘 것(브라우저가 멈춤): 눌러서 다시 켠다
export const resumeSound = async () => {
  await player.unlock();
  emit();
};
export const previewSound = (sound: Parameters<typeof player.play>[0]) => player.play(sound, view.prefs.volume, false);
export const stopSound = () => player.stop();

const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => void subs.delete(fn);
};
export const useAlerts = () => useSyncExternalStore(subscribe, () => view);
export const alertPrefsDefault = DEFAULT_PREFS;

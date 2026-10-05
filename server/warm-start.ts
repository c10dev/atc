import { isWarm } from "./events.ts";
import type { Snapshot } from "./model.ts";

// WARM START(ATC-539): 재시작 직후 화면이 마지막으로 알던 상태를 바로 보이게 한다. 표시 전용이다.
// 복원본은 `current`(살아 있는 스냅샷)에 넣지 않고 이 클래스에만 둔다: isWarm·diffSnapshots·잡·DISPATCH·AUTOLAND·MCC·알림은 늘 살아 있는 데이터만 읽는다.
// 이 파일은 순수하다(파일 입출력은 warm-start-run.ts).
export const SAVE_EVERY_MS = 60_000;
export const DEFAULT_MAX_AGE_MIN = 10;

export interface WarmCache {
  savedAt: string;
  snapshot: Snapshot;
}

const LISTS = ["sessions", "workspaces", "tickets", "pulls", "alerts"] as const;

// 캐시 파일 본문 → 복원본. 깨졌거나 너무 오래됐거나 미래 시각이면 null(= 보통의 콜드 스타트)
export function parseCache(text: string, nowMs: number, maxAgeMs: number): WarmCache | null {
  try {
    const raw = JSON.parse(text) as Partial<WarmCache> | null;
    const snap = raw?.snapshot as unknown as Record<string, unknown> | undefined;
    if (!raw || typeof raw.savedAt !== "string" || !snap || typeof snap !== "object") return null;
    const age = nowMs - Date.parse(raw.savedAt);
    if (!Number.isFinite(age) || age < -5_000 || age > maxAgeMs) return null;
    if (!LISTS.every((k) => Array.isArray(snap[k]))) return null;
    return { savedAt: raw.savedAt, snapshot: raw.snapshot as Snapshot };
  } catch {
    return null;
  }
}

export class WarmStart {
  private restored: WarmCache | null = null;
  private maxAgeMs = DEFAULT_MAX_AGE_MIN * 60_000;
  private lastSaveMs = 0;

  restore(cache: WarmCache | null, maxAgeMs: number) {
    this.restored = cache;
    this.maxAgeMs = maxAgeMs;
  }

  active(): boolean {
    return this.restored !== null;
  }

  // 화면과 /api/snapshot이 보는 것. 복원본이 살아 있는 동안은 복원 표시(restored)를 단 복사본, 아니면 살아 있는 스냅샷
  display(live: Snapshot | null, nowMs: number): Snapshot | null {
    const r = this.restored;
    if (!r) return live;
    const ageSec = Math.max(0, Math.round((nowMs - Date.parse(r.savedAt)) / 1000));
    return { ...r.snapshot, restored: { savedAt: r.savedAt, ageSec } };
  }

  // 살아 있는 스냅샷이 따뜻해졌거나 복원본이 최대 나이를 넘으면 복원본을 버린다. 이번에 막 버렸으면 true(화면에 살아 있는 것을 보내야 한다)
  settle(live: Snapshot, nowMs: number): boolean {
    const r = this.restored;
    if (!r) return false;
    if (!isWarm(live) && nowMs - Date.parse(r.savedAt) <= this.maxAgeMs) return false;
    this.restored = null;
    return true;
  }

  // 스냅샷 한 바퀴마다 한 번(서버 tick). 스위치 값은 필요할 때만 읽는다(getMode): 복원본을 보이는 중이거나 저장할 때가 됐을 때.
  // off면 복원본을 바로 버리고 아무것도 저장하지 않는다. save는 저장할 본문, ended는 복원본이 막 끝났다(화면에 살아 있는 것을 보내야 한다)
  tick(live: Snapshot, nowMs: number, getMode: () => "on" | "off"): { save: string | null; ended: boolean } {
    if (!this.active() && !this.saveDue(live, nowMs)) return { save: null, ended: false };
    if (getMode() === "off") {
      const ended = this.restored !== null;
      this.restored = null;
      return { save: null, ended };
    }
    return { save: this.saveText(live, nowMs), ended: this.settle(live, nowMs) };
  }

  private saveDue(live: Snapshot, nowMs: number): boolean {
    return isWarm(live) && nowMs - this.lastSaveMs >= SAVE_EVERY_MS;
  }

  // 따뜻한 살아 있는 스냅샷을 최대 1분에 한 번 저장할 본문으로. 아니면 null
  saveText(live: Snapshot, nowMs: number): string | null {
    if (!isWarm(live) || nowMs - this.lastSaveMs < SAVE_EVERY_MS) return null;
    this.lastSaveMs = nowMs;
    return JSON.stringify({ savedAt: new Date(nowMs).toISOString(), snapshot: live } satisfies WarmCache);
  }
}

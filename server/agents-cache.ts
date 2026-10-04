// `claude agents --json`를 30초 아끼는 캐시(ATC-127). 헤더 CONTROL 띠와 FLEET의 CONTROL SESSIONS가 같은 GET을 쓰므로 명령이 한 번만 돈다.
// 값을 만드는 함수(fn)는 그대로 부르기만 한다: 명령 실행·LAUNCH·STOP은 건드리지 않는다. 실패는 캐시하지 않고, 동시에 온 읽기는 한 번의 실행을 나눠 쓴다.
import { timed } from "./job-timing.ts";

export const AGENTS_TTL_MS = 30_000;

export function ttlCache<T>(fn: () => Promise<T>, ttlMs = AGENTS_TTL_MS, nowFn: () => number = Date.now) {
  let hit: { at: number; value: T } | null = null;
  let inflight: Promise<T> | null = null;
  return {
    // fresh: 동작(LAUNCH·STOP) 뒤 화면이 곧장 새로 읽을 때. 캐시를 건너뛰고 그 값으로 캐시를 바꾼다
    get(fresh = false): Promise<T> {
      if (!fresh && hit && nowFn() - hit.at < ttlMs) return Promise.resolve(hit.value);
      if (inflight) return inflight;
      const p = timed("agents-json", fn) // `claude agents --json` 한 번 = 자식 프로세스 하나(ATC-525: 횟수와 시계 시간. 자식의 CPU는 서버 CPU가 아니다)
        .then((value) => {
          hit = { at: nowFn(), value };
          return value;
        })
        .finally(() => {
          inflight = null;
        });
      inflight = p;
      return p;
    },
  };
}

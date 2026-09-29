import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// 음성 캐시(ATC-140): 만든 WAV를 hash(엔진, 목소리, 문구)로 상태 폴더의 voice-cache/에 둔다. 버려도 되는 캐시라 지우면 다시 만들 뿐이다.
// 200개 또는 20 MB를 넘으면 가장 오래 안 쓴 것부터 지운다. 저장소에는 들어가지 않는다(상태 폴더).

export const CACHE_MAX_FILES = 200;
export const CACHE_MAX_BYTES = 20 * 1024 * 1024;

export const cacheKey = (engine: string, voice: string, phrase: string) => createHash("sha256").update(`${engine}\n${voice}\n${phrase}`).digest("hex").slice(0, 40);

const fileOf = (dir: string, key: string) => join(dir, `${key}.wav`);

export function getCached(dir: string, key: string): Buffer | null {
  try {
    const f = fileOf(dir, key);
    const wav = readFileSync(f);
    const now = new Date();
    utimesSync(f, now, now); // 쓴 시각을 갱신해 자주 쓰는 것이 남게 한다
    return wav;
  } catch {
    return null;
  }
}

export function putCached(dir: string, key: string, wav: Buffer, maxFiles = CACHE_MAX_FILES, maxBytes = CACHE_MAX_BYTES): void {
  try {
    mkdirSync(dir, { recursive: true });
    const f = fileOf(dir, key);
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, wav);
    renameSync(tmp, f);
    pruneCache(dir, maxFiles, maxBytes);
  } catch {} // 캐시를 못 써도 소리는 난다
}

// 오래된 것부터 지워 개수와 크기 안으로. 지운 수를 돌려준다
export function pruneCache(dir: string, maxFiles = CACHE_MAX_FILES, maxBytes = CACHE_MAX_BYTES): number {
  let entries: { f: string; size: number; at: number }[] = [];
  try {
    entries = readdirSync(dir)
      .filter((n) => n.endsWith(".wav"))
      .map((n) => {
        const st = statSync(join(dir, n));
        return { f: n, size: st.size, at: st.mtimeMs };
      });
  } catch {
    return 0;
  }
  entries.sort((a, b) => a.at - b.at || a.f.localeCompare(b.f));
  let total = entries.reduce((s, e) => s + e.size, 0);
  let count = entries.length;
  let removed = 0;
  for (const e of entries) {
    if (count <= maxFiles && total <= maxBytes) break;
    try {
      rmSync(join(dir, e.f));
      removed++;
    } catch {}
    count--;
    total -= e.size;
  }
  return removed;
}

import { loadDispatchConfig } from "./dispatch.ts";
import type { Snapshot } from "./model.ts";
import { readRecords } from "./recorder.ts";
import { type DuplicateCounts, duplicateCountsOf, openDuplicateOf } from "./title-dup.ts";

// 비슷한 제목 검사의 읽는 길(ATC-488, 계산은 title-dup.ts). L1 길(duty-l1-run.ts)에 꽂는 훅과 RELEASE 화면의 세기.
export const duplicateTitleOn = () => loadDispatchConfig().duplicateTitle !== "off";

export function duplicateHooks(snapshot: () => Promise<Snapshot>) {
  return {
    duplicateOn: duplicateTitleOn,
    duplicateOpen: async (title: string) => openDuplicateOf(title, (await snapshot()).tickets, Date.now()),
  };
}

// 지난 7일 기록에서 센 수. 화면이 자주 읽으므로 30초 동안은 지난 값을 그대로 준다
let cache: { at: number; value: DuplicateCounts } | null = null;
export function duplicateCountsNow(now = Date.now()): DuplicateCounts {
  if (cache && now - cache.at < 30_000) return cache.value;
  const value = duplicateCountsOf(readRecords(now - 7 * 86_400_000), now);
  cache = { at: now, value };
  return value;
}

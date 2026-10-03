import { landedOf, loadDispatchConfig } from "../dispatch.ts";
import { defineJob } from "../job-def.ts";
import { loadLogbook } from "../logbook.ts";
import { trackOrphans } from "../orphan-flight-run.ts";
import { allProposals } from "../proposals.ts";
import { allRelays } from "../relay-run.ts";

// ORPHAN FLIGHT 에피소드 기록(ATC-516): 열고(open)·알림이 나올 때(alert)·닫을 때(close, MISFIRE 표시). 1분에 한 번, 읽기만 하고 상태 폴더의 JSONL에 덧붙인다
export default defineJob({
  name: "orphan-flight",
  every: 60_000,
  run: (ctx) => {
    const s = ctx.current();
    if (!s) return;
    try {
      trackOrphans(s, { proposals: allProposals(), landed: landedOf(loadLogbook()), relays: allRelays(), teamPattern: loadDispatchConfig().teamPattern }, ctx.now());
    } catch (e) {
      console.error("[atc] orphan flight failed:", e);
    }
  },
});

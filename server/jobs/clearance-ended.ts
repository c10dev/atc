import { trackEnded } from "../clearance-ended-run.ts";
import { defineJob } from "../job-def.ts";

// 받는 세션이 끝난 CLEARANCE(ATC-567): 1분에 한 번 닫을 것을 닫고(clearances.jsonl에 undeliverable 줄을 덧붙임) 닫은 세션이 돌아왔는지 본다
export default defineJob({
  name: "clearance-ended",
  every: 60_000,
  run: (ctx) => {
    const s = ctx.current();
    if (!s) return;
    try {
      trackEnded(s, ctx.now());
    } catch (e) {
      console.error("[atc] clearance ended failed:", e);
    }
  },
});

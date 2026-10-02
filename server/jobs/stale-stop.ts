import { defineJob } from "../job-def.ts";
import { runStaleStop } from "../stale-stop-run.ts";

// STALE STOP(ATC-369): FLIGHT가 끝났는데 PENDING·HUNG으로 30분 남은 AIRCRAFT를 멈춘다. 스위치(dispatch.json staleStop)는 기본 on, SUPERVISOR만 끈다. 1분에 한 번
export default defineJob({
  name: "stale-stop",
  every: 60_000,
  run: async (ctx) => {
    const s = ctx.current();
    if (!s) return;
    await runStaleStop(s).catch((e) => console.error("[atc] stale stop failed:", e));
  },
});

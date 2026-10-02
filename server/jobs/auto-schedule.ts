import { runAutoSchedule, scheduleMisfires } from "../autonomy-auto-run.ts";
import { defineJob } from "../job-def.ts";

// SCHEDULE 초안 자동 적용(ATC-370, docs/autonomy.md P5): 스위치 schedule.json auto(기본 on)가 켜져 있으면 CLASSIFY·TAIL·CLOSE·WAYPOINT·NEW 초안을 사람 판정 없이 승인한다. 1분에 한 번
export default defineJob({
  name: "auto-schedule",
  every: 60_000,
  run: (ctx) => {
    const s = ctx.current();
    if (!s) return;
    try {
      runAutoSchedule();
      scheduleMisfires(s);
    } catch (e) {
      console.error("[atc] auto schedule failed:", e);
    }
  },
});

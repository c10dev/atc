import { trackMoot } from "../clearance-moot-run.ts";
import { defineJob } from "../job-def.ts";

// 이유를 잃은 CLEARANCE의 MISFIRE 기록(ATC-515): 올렸다가 취소된 CLEARANCE가 틀렸다고 드러났는지 1분에 한 번 본다. 읽기만 하고 상태 폴더의 JSONL에 덧붙인다
export default defineJob({
  name: "clearance-moot",
  every: 60_000,
  run: (ctx) => {
    const s = ctx.current();
    if (!s) return;
    try {
      trackMoot(s, ctx.now());
    } catch (e) {
      console.error("[atc] clearance moot failed:", e);
    }
  },
});

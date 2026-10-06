import { loadDispatchConfig } from "../dispatch.ts";
import { defineJob } from "../job-def.ts";
import { trackLiveness } from "../job-liveness-run.ts";

// JOB LIVENESS(ATC-534): 1분에 한 번 프로세스 없이 사라진 job과 init에서 죽은 LAUNCH를 FLIGHT RECORDER에 한 번씩 적는다. 읽고 적기만 하고 아무것도 멈추거나 띄우지 않는다(스위치가 off면 적지 않는다)
export default defineJob({
  name: "job-liveness",
  every: 60_000,
  run: (ctx) => {
    const s = ctx.current();
    if (!s) return;
    try {
      trackLiveness(s, ctx.now(), loadDispatchConfig().teamPattern);
    } catch (e) {
      console.error("[atc] job liveness failed:", e);
    }
  },
});

import { defineJob } from "../job-def.ts";
import { record, SAMPLE_MS, sampleOf } from "../recorder.ts";

// 샘플 기록: 스냅샷의 한 줄 요약을 FLIGHT RECORDER에(SAMPLE_MS마다)
export default defineJob({
  name: "sample",
  tick: { everyMs: SAMPLE_MS },
  order: 10,
  run: (_ctx, s) => {
    record({ t: s!.at, kind: "sample", ...sampleOf(s!) });
  },
});

import { factsNow } from "../flow-facts.ts";
import { defineJob } from "../job-def.ts";
import { record, SAMPLE_MS, sampleOf } from "../recorder.ts";

// 샘플 기록: 스냅샷의 한 줄 요약을 FLIGHT RECORDER에(SAMPLE_MS마다). 순서는 DISPATCH(20) 뒤라 같은 주기에 세운 계획의 두 사실을 싣는다(ATC-468)
export default defineJob({
  name: "sample",
  tick: { everyMs: SAMPLE_MS },
  order: 22,
  run: (_ctx, s) => {
    record({ t: s!.at, kind: "sample", ...sampleOf(s!), ...(factsNow(Date.parse(s!.at)) ?? {}) });
  },
});

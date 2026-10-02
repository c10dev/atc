import { defineJob } from "../job-def.ts";
import { runJudges } from "../judges/run.ts";

// 판정 계열(ATC-36): 스위치가 off가 아닐 때만 1분에 한 번, CLASSIFY 초안 몇 건
export default defineJob({
  name: "judges",
  tick: {},
  order: 90,
  run: (_ctx, s) => {
    runJudges(s!);
  },
});

import { defineJob } from "../job-def.ts";
import { runMilestones } from "../milestones-run.ts";

// OOOI(ATC-123): 처음 본 이정표를 FLIGHT RECORDER에 한 번(1분에 한 번, 이미 있는 기록만 읽는다)
export default defineJob({
  name: "milestones",
  tick: {},
  order: 50,
  run: (_ctx, s) => {
    runMilestones(s!);
  },
});

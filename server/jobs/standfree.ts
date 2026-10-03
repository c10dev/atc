import { defineJob } from "../job-def.ts";
import { runStandFree } from "../standfree-run.ts";

// 5분마다 STAND 없는 FLIGHT의 ARRIVED 후보(ATC-72). ARRIVED는 OCC가 확인해 적는다
export default defineJob({
  name: "standfree",
  tick: {},
  order: 60,
  run: (_ctx, s) => {
    runStandFree(s!);
  },
});

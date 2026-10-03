import { defineJob } from "../job-def.ts";
import { addLogbookFuel } from "../fuel-run.ts";
import { runLogbook } from "../logbook.ts";

// 10분마다 머지된 PR을 LOGBOOK에 적는다
export default defineJob({
  name: "logbook",
  tick: {},
  order: 40,
  run: (_ctx, s) => {
    runLogbook(s!, addLogbookFuel);
  },
});

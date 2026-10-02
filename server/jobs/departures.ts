import { recordDepartures } from "../departures.ts";
import { defineJob } from "../job-def.ts";

// FLIGHT의 첫 STAND·claim과 HANDOFF를 착수 기록에(바뀔 때만). 첫 번은 기준선
export default defineJob({
  name: "departures",
  tick: {},
  order: 30,
  run: (_ctx, s) => {
    recordDepartures(s!);
  },
});

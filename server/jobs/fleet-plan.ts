import { runFleetPlan } from "../fleet-plan-run.ts";
import { defineJob } from "../job-def.ts";
import { DISPATCH_MS } from "../proposals.ts";

// FLEET PLAN(docs/fleet.md 8.6): DISPATCH와 같은 주기에 그림자 제안. claude agents를 읽어 기다리지 않는다
export default defineJob({
  name: "fleet-plan",
  tick: { everyMs: DISPATCH_MS },
  order: 21,
  run: (_ctx, s) => {
    runFleetPlan(s!);
  },
});

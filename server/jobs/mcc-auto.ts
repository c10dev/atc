import { defineJob } from "../job-def.ts";
import type { mountMcc } from "../mcc-run.ts";

// 서버 자동 착륙(ATC-556): mcc.json의 serverAuto가 on(기본)이면 auto 등급 PR을 MCC 세션의 /tick 없이 착륙시키고, 착륙한 PR을 몇 분 뒤 다시 읽어 오작동을 센다. 30초마다
export default defineJob({
  name: "mcc-auto",
  every: 30_000,
  run: async (ctx, snapshot) => {
    const s = snapshot ?? ctx.current();
    if (!s) return;
    await ctx.service<ReturnType<typeof mountMcc>>("mcc").autoPass(s);
  },
});

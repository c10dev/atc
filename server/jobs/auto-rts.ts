import { defineJob } from "../job-def.ts";
import type { mountUpdate } from "../update-run.ts";

// 자동 RTS(ATC-84): mcc 모드가 rts·land+rts일 때만 일한다. 그 밖의 모드나 시험 서버는 아무것도 하지 않는다. 30초마다
export default defineJob({
  name: "auto-rts",
  every: 30_000,
  run: async (ctx) => {
    try {
      const r = await ctx.service<ReturnType<typeof mountUpdate>>("update").pass();
      if (r.started) console.log(`[atc] auto RTS started: ${r.why}`);
    } catch {}
  },
});

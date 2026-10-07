import { defineJob } from "../job-def.ts";
import type { PassDeps } from "../server-send-run.ts";

// SERVER SEND(ATC-562): 30초마다 서버가 FLIGHT PLAN의 첫 발송·overdue 재송신·닿지 않은 것의 재시도를 하고, 쓴 발송이 받는 세션에 보이는지 확인한다.
// 자동 FRESH START 게이트(ATC-560)는 index.ts가 release와 같은 것을 넘긴다
export default defineJob({
  name: "server-send",
  every: 30_000,
  run: async (ctx, snapshot) => {
    const s = snapshot ?? ctx.current();
    if (!s) return;
    const { pass } = ctx.service<{ pass: (s: NonNullable<typeof snapshot>, deps?: PassDeps) => Promise<unknown> }>("serverSend");
    await pass(s);
  },
});

import { defineJob } from "../job-def.ts";

// SERVER CLEARANCE(ATC-557 b): 30초마다 TOWER 브리핑이 서버 몫으로 표시한 CLEARANCE(LAND·INFO·GO AROUND·FIX·첫 RESEND·RELAY)를 TOWER와 같은 길로 적고
// 받는 세션 소켓에 쓴다. 쓴 글의 확인·재시도·넘김도 여기서 한다. 브리핑 읽기와 기록 라우트는 index.ts가 넘긴다
export default defineJob({
  name: "server-clearance",
  every: 30_000,
  run: async (ctx, snapshot) => {
    const s = snapshot ?? ctx.current();
    if (!s) return;
    const { pass } = ctx.service<{ pass: (s: NonNullable<typeof snapshot>) => Promise<unknown> }>("serverClearance");
    await pass(s);
  },
});

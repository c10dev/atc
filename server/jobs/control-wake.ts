import type { WakeDeps } from "../control-wake-run.ts";
import { defineJob } from "../job-def.ts";

// CONTROL WAKE(ATC-557 a): 30초마다 TOWER·OCC·MCC에 판단할 일이 새로 생겼는지 보고, 있으면 그 세션을 글 하나로 깨운다(스위치 wake, 기본).
// 깨움의 확인·결과 줄, /loop로 뜬 세션을 깨움 모드로 한 번 다시 띄우기도 여기서 한다. 브리핑 읽기·ack·재시작 길은 index.ts가 넘긴다
export default defineJob({
  name: "control-wake",
  every: 30_000,
  run: async (ctx, snapshot) => {
    const s = snapshot ?? ctx.current();
    if (!s) return;
    const { pass } = ctx.service<{ pass: (s: NonNullable<typeof snapshot>, deps?: Partial<WakeDeps>) => Promise<unknown> }>("controlWake");
    await pass(s);
  },
});

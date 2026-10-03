import { defineJob } from "../job-def.ts";
import { flowViewOf } from "../home-flow.ts";
import { type FlowDeps, flowInputNow } from "../home-flow-run.ts";
import { loadGapSwitch, trackEpisodes } from "../landing-gap-run.ts";

// 착륙 간격 규칙의 에피소드 기록(ATC-501): 흐름판 판정이 "착륙 없음"으로 막힘을 낸 구간을 열고 닫는다. 1분에 한 번, 읽기만 하고 상태 폴더의 JSONL에 덧붙인다
export default defineJob({
  name: "landing-gap",
  every: 60_000,
  run: async (ctx) => {
    const s = ctx.current();
    if (!s) return;
    try {
      const d = ctx.service<FlowDeps>("flowDeps");
      trackEpisodes(flowViewOf(await flowInputNow(s, d.updateStatus, d.alerts, ctx.now())), loadGapSwitch(), ctx.now());
    } catch (e) {
      console.error("[atc] landing gap failed:", e);
    }
  },
});

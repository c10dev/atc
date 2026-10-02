import type { mountApplyNow } from "../apply-now-run.ts";
import { type ActDeps, type FactDeps, runControlRecycle } from "../control-recycle-run.ts";
import { defineJob } from "../job-def.ts";

// CONTROL RECYCLE(ATC-166): 스위치가 off(기본)면 아무것도 하지 않는다. shadow는 "재시작했을 것"만 FLIGHT RECORDER에 남긴다. 1분에 한 번.
// 기다리는 LAUNCH ACCOUNT APPLY NOW(ATC-244)는 같은 주기에 이어 간다
export default defineJob({
  name: "control-recycle",
  every: 60_000,
  run: (ctx) => {
    const s = ctx.current();
    if (!s) return;
    const { facts, act } = ctx.service<{ facts: FactDeps; act: ActDeps }>("recycleDeps");
    void runControlRecycle(s, { ...facts, act }).catch((e) => console.error("[atc] control recycle failed:", e));
    void ctx.service<ReturnType<typeof mountApplyNow>>("applyNow").tick();
  },
});

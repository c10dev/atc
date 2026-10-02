import { runAutoApprove } from "../auto-approve-run.ts";
import { defineJob } from "../job-def.ts";
import { launchForCard, MAX_LAUNCHED } from "../session-control.ts";

// 일치 기반 자동 승인(ATC-334, docs/autonomy.md C14): 스위치 autoApprove·autoApproveLaunch가 off(기본)면 아무것도 하지 않는다. shadow는 would-* 줄만, on은 승인.
// 서버 안에서만 돈다(HTTP 길도 atcctl 명령도 없다). 1분에 한 번
export default defineJob({
  name: "auto-approve",
  every: 60_000,
  run: async (ctx) => {
    const s = ctx.current();
    if (!s) return;
    await runAutoApprove(s, { max: MAX_LAUNCHED, launch: (snap, reg, proposal, resume, flight) => launchForCard(snap, reg, proposal, resume, "auto", flight) }).catch((e) => console.error("[atc] auto approve failed:", e));
  },
});

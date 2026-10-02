import { runApprovedRelaunch, runAutoApprove } from "../auto-approve-run.ts";
import { defineJob } from "../job-def.ts";
import type { Snapshot } from "../model.ts";
import { launchForCard, MAX_LAUNCHED } from "../session-control.ts";

// 일치 기반 자동 승인(ATC-334, docs/autonomy.md C14): 스위치 autoApprove·autoApproveLaunch가 off(기본)면 아무것도 하지 않는다. shadow는 would-* 줄만, on은 승인.
// 서버 안에서만 돈다(HTTP 길도 atcctl 명령도 없다). 1분에 한 번
export default defineJob({
  name: "auto-approve",
  every: 60_000,
  run: async (ctx) => {
    const s = ctx.current();
    if (!s) return;
    const deps = { max: MAX_LAUNCHED, launch: (snap: Snapshot, reg: string, proposal: string, resume: boolean, flight: string) => launchForCard(snap, reg, proposal, resume, "auto", flight) };
    await runAutoApprove(s, deps).catch((e) => console.error("[atc] auto approve failed:", e));
    // 승인됐는데 세션이 없는 ASSIGN 카드(ATC-388): LAUNCH하거나 닫는다. 스위치와 상관없다(SUPERVISOR 승인이 이미 있다)
    await runApprovedRelaunch(s, deps).catch((e) => console.error("[atc] approved relaunch failed:", e));
  },
});

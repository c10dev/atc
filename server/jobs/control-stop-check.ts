import { loadStopCheckSwitch, trackChecks } from "../control-stop-check-run.ts";
import type { LiveJob } from "../control-stop-check.ts";
import { defineJob } from "../job-def.ts";
import { readJob } from "../job-state.ts";
import { agentRows, CONTROL_SESSIONS, controlDirOf, controlRowsOf, jobStateOf } from "../session-control.ts";

// CONTROL STOP CHECK(ATC-521): 1분에 한 번 같은 관제 이름의 살아 있는 job이 둘 이상인지 보고, 막은 STOP이 뒤늦게 stopped가 되었는지 다시 읽는다. 읽기만 하고 아무것도 멈추거나 띄우지 않는다(스위치가 off면 경고를 걷는다)
export default defineJob({
  name: "control-stop-check",
  every: 60_000,
  run: async (ctx) => {
    try {
      const sw = loadStopCheckSwitch();
      const rows = sw === "off" ? [] : await agentRows();
      const jobs: LiveJob[] = [];
      for (const spec of CONTROL_SESSIONS) {
        if (spec.launch !== "bg") continue;
        for (const r of controlRowsOf(spec, rows, controlDirOf(spec))) {
          if (r.kind !== "background" || !r.id) continue;
          jobs.push({ control: spec.name, id: r.id, account: r.account ?? null, state: jobStateOf(r.id), activeAt: readJob(r.id)?.writtenAt ?? null, stale: false });
        }
      }
      trackChecks(jobs, (id) => jobStateOf(id), ctx.now(), sw);
    } catch (e) {
      console.error("[atc] control stop check failed:", e);
    }
  },
});

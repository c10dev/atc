import { controlAbsentPass, lastJobsNow, loadAbsentSettings, realProofFacts } from "../control-absent-run.ts";
import { realDir } from "../control-realdir.ts";
import { loadRecycle } from "../control-recycle.ts";
import { recyclingNow } from "../control-recycle-run.ts";
import { defineJob } from "../job-def.ts";
import { CONTROL_SESSIONS, cachedAgentRows, controlDirOf, controlRowsOf, jobStateOf, launchControl } from "../session-control.ts";
import { writerModeOf, writerPlaceNow } from "../session-socket.ts";
import { controlPresentOf } from "../supervisor-alerts.ts";
import { controlOpsNow } from "../supervisor-alerts-run.ts";

// CONTROL ABSENT(ATC-532): 1분에 한 번 띄우는 관제 세션(TOWER·OCC·MCC·REVIEW)이 없는지 본다. 한도(기본 20분, 서버가 뜬 직후는 2분)를 넘으면
// 이전 job이 사라졌다는 증거가 있을 때 FLEET LAUNCH와 같은 launchControl로 다시 띄우고(운영 서버만), 아니면 SUPERVISOR에게 WARNING을 올린다.
// 은퇴한 CROSSCHECK(ATC-371)와 배지만인 ENGINEERING은 띄우지 않으므로 보지 않는다
const ROLES = CONTROL_SESSIONS.filter((c) => c.launch === "bg" && !c.retired);

export default defineJob({
  name: "control-absent",
  every: 60_000,
  run: async (ctx) => {
    const s = ctx.current();
    if (!s) return; // 첫 스냅샷 전에는 판단하지 않는다(서버가 뜬 직후 규칙은 첫 판단부터 2분을 센다)
    try {
      await controlAbsentPass(s, {
        now: () => ctx.now(),
        roles: ROLES.map((c) => ({ name: c.name, dir: controlDirOf(c) })),
        present: (snap) => controlPresentOf(CONTROL_SESSIONS.map((c) => ({ name: c.name, dir: controlDirOf(c) })), snap.sessions, realDir),
        liveRows: async () => {
          const rows = await cachedAgentRows.get();
          return (name) => {
            const spec = ROLES.find((c) => c.name === name);
            return spec ? controlRowsOf(spec, rows, controlDirOf(spec)).map((r) => r.id ?? r.name ?? r.sessionId) : [];
          };
        },
        lastOps: (now) => controlOpsNow(now),
        lastJobs: (now) => lastJobsNow(now),
        facts: (dir, job) => realProofFacts(dir, job, (id) => jobStateOf(id)),
        launch: async (name) => {
          const r = await launchControl(name, "ABSENT", undefined, ctx.current()?.fuelAccounts);
          return { ok: r.ok, ...(r.jobId ? { jobId: r.jobId } : {}), ...(r.error ? { error: r.error } : {}) };
        },
        recycling: () => recyclingNow(),
        production: () => writerModeOf(writerPlaceNow()) === "production",
        auto: () => loadRecycle().auto,
        settings: () => loadAbsentSettings(),
      });
    } catch (e) {
      console.error("[atc] control absent failed:", e);
    }
  },
});

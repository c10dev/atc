import { defineJob } from "../job-def.ts";
import { record } from "../recorder.ts";
import { scopeOomRecordsNow } from "../scope-oom-run.ts";

// SCOPE OOM 세기(ATC-505): 1분마다 atc-claude-*.scope의 memory.events oom_kill를 읽고, 늘어난 만큼 recorder에 한 줄(scope-oom)씩 남긴다.
// 읽기와 한 줄 기록뿐이다: 아무 scope도 건드리지 않는다. 상한이 너무 낮으면 이 수로 드러난다
export default defineJob({
  name: "scope-oom",
  every: 60_000,
  run: () => {
    for (const r of scopeOomRecordsNow()) record(r);
  },
});

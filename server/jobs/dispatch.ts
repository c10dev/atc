import type { EventLog } from "../events.ts";
import { defineJob } from "../job-def.ts";
import { refreshOverlap } from "../overlap-run.ts";
import { DISPATCH_MS, runDispatch } from "../proposals.ts";

// DISPATCH(docs/dispatch.md): 5분마다 계획을 세워 제안을 동기화한다. 파일 겹침(ATC-71)은 이번 주기에 읽은 것을 다음 계획부터 쓴다.
// PR HOLDER(ATC-354)가 GO AROUND 글을 만들 때 TOWER와 같은 사건을 본다
export default defineJob({
  name: "dispatch",
  tick: { everyMs: DISPATCH_MS },
  order: 20,
  run: (ctx, s) => {
    void refreshOverlap(s!);
    runDispatch(s!, Date.now(), () => ctx.service<EventLog>("eventLog").since(null).events);
  },
});

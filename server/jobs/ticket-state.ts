import { defineJob } from "../job-def.ts";
import { stateChangesOf } from "../flow.ts";
import { record } from "../recorder.ts";

// FLOW(ATC-468): 서버가 본 Linear 상태 변화를 FLIGHT RECORDER에 한 줄씩(`ticket` 줄). created → Todo를 재는 유일한 출처다.
// 지난 상태는 메모리에만 둔다: 서버가 꺼진 동안의 변화는 못 보고, 다시 뜬 뒤 처음 보는 이슈는 만든 지 10분 안일 때만 적는다(flow.ts)
let prev = new Map<string, string>();

export default defineJob({
  name: "ticket-state",
  tick: {},
  order: 25,
  run: (_ctx, s) => {
    const { lines, next } = stateChangesOf(prev, s!.tickets, Date.parse(s!.at));
    prev = next;
    for (const l of lines) record(l);
  },
});

import { runAutoland } from "../autoland-run.ts";
import { defineJob } from "../job-def.ts";

// AUTOLAND(ATC-34): GitHub을 새로 읽을 때마다 갱신·머지 한 주기(스위치가 off면 GROUND STOP만 본다)
export default defineJob({
  name: "autoland",
  tick: {},
  order: 80,
  run: (_ctx, s) => {
    runAutoland(s!);
  },
});

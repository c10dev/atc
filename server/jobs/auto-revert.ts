import { runAutoRevert } from "../auto-revert-run.ts";
import { defineJob } from "../job-def.ts";

// 자동 되돌림(ATC-351): 스위치 off면 아무것도 읽지 않는다(기본은 on, ATC-394). AUTOLAND보다 먼저 돌아 같은 주기의 GROUND STOP을 본다
export default defineJob({
  name: "auto-revert",
  tick: {},
  order: 75,
  run: (_ctx, s) => {
    runAutoRevert(s!);
  },
});

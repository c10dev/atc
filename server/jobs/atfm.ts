import { runAtfm } from "../atfm-run.ts";
import { defineJob } from "../job-def.ts";

// 출발 중지 시작·끝, 1분마다 ATFM 데이터와 그림자 판정(docs/atfm.md)
export default defineJob({
  name: "atfm",
  tick: {},
  order: 70,
  run: (_ctx, s) => {
    runAtfm(s!);
  },
});

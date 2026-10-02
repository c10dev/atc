import { defineJob } from "../job-def.ts";
import { runQrh } from "../qrh-run.ts";

// QRH shadow(ATC-288): 서버가 체크리스트를 부를 조건을 처음 본 때만 FLIGHT RECORDER에 한 줄. 보내는 글은 바뀌지 않는다
export default defineJob({
  name: "qrh",
  tick: {},
  order: 100,
  run: (_ctx, s) => {
    runQrh(s!);
  },
});

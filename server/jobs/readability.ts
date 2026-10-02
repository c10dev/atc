import { defineJob } from "../job-def.ts";
import { startReadability } from "../readability-run.ts";

// READABILITY R0(ATC-176): 교신 질의 하루 기록(readability.jsonl)을 모으는 주기. 서버가 뜰 때 한 번 시작한다
export default defineJob({
  name: "readability",
  start: true,
  run: () => {
    startReadability();
  },
});

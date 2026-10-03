import { defineJob } from "../job-def.ts";
import { startSkillUsage } from "../skill-calls-run.ts";

// SKILL-CALL READER(ATC-289): Skill·sub-agent 호출 수와 qrh.named → opened(skill-usage.jsonl)를 모으는 주기. 서버가 뜰 때 한 번 시작한다
export default defineJob({
  name: "skill-usage",
  start: true,
  run: () => {
    startSkillUsage();
  },
});

import { homedir } from "node:os";
import { join } from "node:path";

try {
  process.loadEnvFile(new URL("../.env.local", import.meta.url));
} catch {}

const HOME = homedir();
const env = process.env;

export const config = {
  port: Number(env.ATC_PORT || 7700),
  home: HOME,
  // 이 폴더 아래 git 저장소(본 체크아웃)를 찾는다. 워크트리는 git worktree list로 따라간다.
  projectsDir: env.ATC_PROJECTS_DIR || join(HOME, "projects"),
  claudeDir: join(HOME, ".claude"),
  codexDir: join(HOME, ".codex"),
  stateDir: env.ATC_STATE_DIR || join(HOME, ".local/state/atc"),
  // 마지막으로 건드린 뒤 이 시간이 지나면 점유가 끝난 것으로 본다.
  claimTtlMs: Number(env.ATC_CLAIM_TTL_MIN || 180) * 60_000,
  // 앞 세션이 이만큼 안에서 손을 떼면 이양, 둘이 이보다 오래 겹치면 충돌.
  handoffGraceMs: Number(env.ATC_HANDOFF_GRACE_MIN || 5) * 60_000,
  // 이 Linear 상태에 들어온 티켓이 착륙(머지) 대기열이 된다.
  landingState: env.ATC_LANDING_STATE || "Ready to Merge",
  linearApiKey: env.LINEAR_API_KEY || "",
  linearTeamKey: (env.LINEAR_TEAM_KEY || "VOC").toUpperCase(),
};

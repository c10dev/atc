import { homedir } from "node:os";
import { join } from "node:path";
import { parseTeamKeys } from "./linear-keys.ts";

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
  airportsFile: env.ATC_AIRPORTS_FILE || join(env.ATC_STATE_DIR || join(HOME, ".local/state/atc"), "airports.json"),
  // 마지막으로 건드린 뒤 이 시간이 지나면 점유가 끝난 것으로 본다.
  claimTtlMs: Number(env.ATC_CLAIM_TTL_MIN || 180) * 60_000,
  // 앞 세션이 이만큼 안에서 손을 떼면 HANDOFF, 둘이 이보다 오래 겹치면 충돌.
  handoffGraceMs: Number(env.ATC_HANDOFF_GRACE_MIN || 5) * 60_000,
  linearApiKey: env.LINEAR_API_KEY || "",
  linearTeamKey: (env.LINEAR_TEAM_KEY || "VOC").toUpperCase(), // 주 팀
  // 읽는 팀 전부(주 팀이 맨 앞). LINEAR_TEAM_KEYS=VOC,ATC. 없으면 주 팀 하나
  linearTeamKeys: parseTeamKeys(env.LINEAR_TEAM_KEY || "VOC", env.LINEAR_TEAM_KEYS),
  // Codex 신호 없이 이 시간이 지나면 CODEX UNAVAILABLE로 보고 Muse 리뷰로 넘긴다(ATC-7)
  codexSilentMs: Number(env.ATC_CODEX_SILENT_HOURS || 6) * 3_600_000,
  linearTeamName: env.LINEAR_TEAM_NAME || "Vocado", // S2에서 새 이슈를 만들 Linear 팀 이름(MCP save_issue의 team)
};

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
  // AIRCRAFT 세션을 띄우고 멈출 때 쓰는 claude CLI(docs/fleet.md 8.5). 서비스 PATH에 없어서 경로로 둔다
  claudeBin: env.ATC_CLAUDE_BIN || join(HOME, ".local/bin/claude"),
  codexDir: join(HOME, ".codex"),
  // 버려도 되는 캐시(FUEL 읽기 캐시 등, ATC-83). 상태 폴더가 아니다. 지워도 한 번 다시 읽을 뿐
  cacheDir: join(env.XDG_CACHE_HOME || join(HOME, ".cache"), "atc"),
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
  // Codex 신호 없이 이 시간이 지나면 CODEX UNAVAILABLE로 보고 REVIEW 세션 리뷰로 넘긴다(ATC-7)
  codexSilentMs: Number(env.ATC_CODEX_SILENT_HOURS || 6) * 3_600_000,
  linearTeamName: env.LINEAR_TEAM_NAME || "Vocado", // S2에서 새 이슈를 만들 Linear 팀 이름(MCP save_issue의 team)
  // 판정 계열 Jev(ATC-36): TypeSafe API 키. 로그·출력·기록에 쓰지 않는다. ATC_JUDGE_ENGINE=stub이면 녹화 응답(네트워크 없음)
  typesafeApiKey: env.TYPESAFE_API_KEY || "",
  judgeEngine: env.ATC_JUDGE_ENGINE === "stub" ? "stub" : "jev",
  // 음성 콜아웃(ATC-140, docs/guide/voice.md): 로컬 TTS 엔진. 서버는 WAV만 만들고 소리는 브라우저가 낸다. 기본 engine은 none(설치하고 ATC_TTS_ENGINE=piper로 켠다. 엔진이 없으면 "TTS 엔진 없음")
  ttsEngine: env.ATC_TTS_ENGINE || "none",
  ttsPiper: env.ATC_TTS_PIPER || join(HOME, ".local/bin/piper"),
  ttsVoices: env.ATC_TTS_VOICES || join(HOME, ".local/share/piper/voices"),
  ttsVoice: env.ATC_TTS_VOICE || "",
  // ATC-143: 다른 엔진. 경로는 .env.local에서만 온다(화면은 고르지 못한다)
  ttsEspeak: env.ATC_TTS_ESPEAK || "/usr/bin/espeak-ng",
  ttsKokoro: env.ATC_TTS_KOKORO || join(HOME, ".local/bin/kokoro-say"),
  ttsKokoroModel: env.ATC_TTS_KOKORO_MODEL || join(HOME, ".local/share/kokoro/model"),
  // AIRCRAFT health 임계값(ATC-45, 분). 기본은 server/health.ts DEFAULT_HEALTH
  health: {
    unansweredMin: Number(env.ATC_HEALTH_UNANSWERED_MIN || 10),
    hungMin: Number(env.ATC_HEALTH_HUNG_MIN || 30),
    hungAlertMin: Number(env.ATC_HEALTH_HUNG_ALERT_MIN || 60),
    throttleAlertCount: Number(env.ATC_HEALTH_THROTTLE_ALERT_COUNT || 3),
    throttleWindowMin: Number(env.ATC_HEALTH_THROTTLE_WINDOW_MIN || 30),
    deniedCount: Number(env.ATC_HEALTH_DENIED_COUNT || 3),
    deniedWindowMin: Number(env.ATC_HEALTH_DENIED_WINDOW_MIN || 10),
    stalledMin: Number(env.ATC_HEALTH_STALLED_MIN || 60),
    blockedMin: Number(env.ATC_HEALTH_BLOCKED_MIN || 3),
  },
};

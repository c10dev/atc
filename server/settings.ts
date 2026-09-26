import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";

// 설정 창(LINEAR, AGENTS 탭)이 읽는 서버 설정. 읽기 전용이고 비밀 값은 내보내지 않는다(API 키는 있는지만).
// 값은 .env.local과 환경 변수에서 오며 서버를 다시 시작해야 바뀐다.
export interface ServerSettings {
  linear: {
    apiKeySet: boolean;
    teamKey: string;
    landingState: string;
  };
  agents: {
    claude: { sessionsDir: string; present: boolean; claimHook: boolean };
    codex: { sessionsDir: string; present: boolean };
    claimTtlMin: number;
    handoffGraceMin: number;
    projectsDir: string;
  };
}

// ~/.claude/settings.json의 hook 목록에 atc의 claim.mjs가 걸려 있는지
function claimHookInstalled(): boolean {
  try {
    return readFileSync(join(config.claudeDir, "settings.json"), "utf8").includes("claim.mjs");
  } catch {
    return false;
  }
}

export function readServerSettings(): ServerSettings {
  const claudeSessions = join(config.claudeDir, "sessions");
  const codexSessions = join(config.codexDir, "sessions");
  return {
    linear: {
      apiKeySet: Boolean(config.linearApiKey),
      teamKey: config.linearTeamKey,
      landingState: config.landingState,
    },
    agents: {
      claude: { sessionsDir: claudeSessions, present: existsSync(claudeSessions), claimHook: claimHookInstalled() },
      codex: { sessionsDir: codexSessions, present: existsSync(codexSessions) },
      claimTtlMin: Math.round(config.claimTtlMs / 60_000),
      handoffGraceMin: Math.round(config.handoffGraceMs / 60_000),
      projectsDir: config.projectsDir,
    },
  };
}

export function mountSettings(app: Hono) {
  app.get("/api/settings", (c) => c.json(readServerSettings()));
}

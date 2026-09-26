import { chmodSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { Context, Hono } from "hono";
import { config } from "./config.ts";
import { resetTicketPattern } from "./sources/git.ts";
import { resetLinear } from "./sources/linear.ts";

// 설정 창(LINEAR, AGENTS 탭)이 읽고 고치는 서버 설정.
// 읽을 때 비밀 값은 내보내지 않는다(API 키는 있는지만). 고치면 .env.local에 쓰고 실행 중인 서버에도 바로 반영한다.
export interface ServerSettings {
  linear: {
    apiKeySet: boolean;
    teamKey: string;
  };
  agents: {
    claude: { sessionsDir: string; present: boolean; claimHook: boolean };
    codex: { sessionsDir: string; present: boolean };
    claimTtlMin: number;
    handoffGraceMin: number;
    projectsDir: string;
  };
}

// 고칠 수 있는 항목. apiKey는 null이면 지운다.
export interface SettingsPatch {
  apiKey?: string | null;
  teamKey?: string;
  claimTtlMin?: number;
  handoffGraceMin?: number;
  projectsDir?: string;
}
export type SettingsErrors = Partial<Record<keyof SettingsPatch, string>>;

const ENV_FILE = new URL("../.env.local", import.meta.url).pathname;

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

const intIn = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

// 값을 검사하고 .env.local에 쓸 환경 변수로 바꾼다. 따옴표·역슬래시·줄바꿈은 받지 않는다(.env 해석이 어긋나지 않게).
export function validatePatch(patch: Record<string, unknown>): { env: Record<string, string | null>; errors: SettingsErrors } {
  const env: Record<string, string | null> = {};
  const errors: SettingsErrors = {};
  const plain = (v: string) => !/["\\\n\r]/.test(v);
  for (const [key, raw] of Object.entries(patch)) {
    switch (key) {
      case "apiKey":
        if (raw === null) env.LINEAR_API_KEY = null;
        else if (typeof raw === "string" && /^\S{8,200}$/.test(raw.trim())) env.LINEAR_API_KEY = raw.trim();
        else errors.apiKey = "공백 없이 8–200자";
        break;
      case "teamKey": {
        const v = typeof raw === "string" ? raw.trim().toUpperCase() : "";
        if (/^[A-Z][A-Z0-9]{1,9}$/.test(v)) env.LINEAR_TEAM_KEY = v;
        else errors.teamKey = "영문 대문자로 시작하는 2–10자(예: VOC)";
        break;
      }
      case "claimTtlMin":
        if (intIn(raw, 5, 1440)) env.ATC_CLAIM_TTL_MIN = String(raw);
        else errors.claimTtlMin = "5–1440분 사이의 정수";
        break;
      case "handoffGraceMin":
        if (intIn(raw, 0, 120)) env.ATC_HANDOFF_GRACE_MIN = String(raw);
        else errors.handoffGraceMin = "0–120분 사이의 정수";
        break;
      case "projectsDir": {
        let v = typeof raw === "string" ? raw.trim() : "";
        if (v === "~" || v.startsWith("~/")) v = join(homedir(), v.slice(1));
        let isDir = false;
        try {
          isDir = statSync(v).isDirectory();
        } catch {}
        if (isAbsolute(v) && isDir && plain(v)) env.ATC_PROJECTS_DIR = v.replace(/\/+$/, "") || "/";
        else errors.projectsDir = "있는 폴더의 절대 경로";
        break;
      }
      default:
        (errors as Record<string, string>)[key] = "고칠 수 없는 항목";
    }
  }
  return { env, errors };
}

// KEY=값 줄을 바꾸거나 끝에 붙이고, null이면 지운다. 다른 줄과 주석은 그대로 둔다.
export function mergeEnv(text: string, changes: Record<string, string | null>): string {
  const lines = text ? text.replace(/\n+$/, "").split("\n") : [];
  for (const [key, value] of Object.entries(changes)) {
    const at = lines.findIndex((l) => new RegExp(`^\\s*(export\\s+)?${key}\\s*=`).test(l));
    const line = value === null ? null : `${key}=${/^[\w@%+=:,./-]*$/.test(value) ? value : `"${value}"`}`;
    if (at >= 0) {
      if (line === null) lines.splice(at, 1);
      else lines[at] = line;
    } else if (line !== null) lines.push(line);
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}

function writeEnvFile(changes: Record<string, string | null>) {
  const text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const tmp = `${ENV_FILE}.tmp`;
  writeFileSync(tmp, mergeEnv(text, changes), { mode: 0o600 });
  renameSync(tmp, ENV_FILE);
  chmodSync(ENV_FILE, 0o600); // API 키가 들어 있으니 본인만 읽게
}

function applyToConfig(env: Record<string, string | null>) {
  if ("LINEAR_API_KEY" in env) config.linearApiKey = env.LINEAR_API_KEY ?? "";
  if (env.LINEAR_TEAM_KEY) config.linearTeamKey = env.LINEAR_TEAM_KEY;
  if (env.ATC_CLAIM_TTL_MIN) config.claimTtlMs = Number(env.ATC_CLAIM_TTL_MIN) * 60_000;
  if (env.ATC_HANDOFF_GRACE_MIN) config.handoffGraceMs = Number(env.ATC_HANDOFF_GRACE_MIN) * 60_000;
  if (env.ATC_PROJECTS_DIR) config.projectsDir = env.ATC_PROJECTS_DIR;
  if (env.LINEAR_TEAM_KEY) resetTicketPattern();
  if ("LINEAR_API_KEY" in env || env.LINEAR_TEAM_KEY) resetLinear();
}

// 이 화면(localhost)에서 온 JSON 요청만 받는다. 다른 사이트가 브라우저를 통해 설정을 바꾸지 못하게.
function fromThisApp(c: Context): boolean {
  if (!c.req.header("content-type")?.startsWith("application/json")) return false;
  const origin = c.req.header("origin");
  if (!origin) return false;
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function mountSettings(app: Hono) {
  app.get("/api/settings", (c) => c.json(readServerSettings()));
  app.put("/api/settings", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "JSON 객체가 아님" }, 400);
    const { env, errors } = validatePatch(body as Record<string, unknown>);
    if (Object.keys(errors).length) return c.json({ errors }, 400);
    writeEnvFile(env);
    applyToConfig(env);
    console.log(`[atc] settings updated: ${Object.keys(env).join(", ")}`);
    return c.json(readServerSettings());
  });
}

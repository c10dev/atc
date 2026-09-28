import { chmodSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { Hono } from "hono";
import { AUTOLAND_MODES, type AutolandMode, loadAutoland, loadAutolandState } from "./autoland.ts";
import { setAutolandMode } from "./autoland-run.ts";
import { config } from "./config.ts";
import { EXTERNAL_REVIEW_SECURITY, type ExternalReviewSecurity, loadDispatchConfig, saveExternalReviewSecurity, saveFuelHold } from "./dispatch.ts";
import { engineName, judgeStatus } from "./judges/run.ts";
import { JUDGE_MODES, type JudgeMode, loadJudges, setJudgeMode } from "./judges/store.ts";
import { parseTeamKeys, TEAM_KEY } from "./linear-keys.ts";
import { loadMcc, MCC_MODES, type MccMode } from "./mcc.ts";
import { setMccMode } from "./mcc-run.ts";
import { fromThisApp } from "./origin.ts";
import { resetTicketPattern } from "./sources/git.ts";
import { resetLinear } from "./sources/linear.ts";

// 설정 창(LINEAR, AGENTS 탭)이 읽고 고치는 서버 설정.
// 읽을 때 비밀 값은 내보내지 않는다(API 키는 있는지만). 고치면 .env.local에 쓰고 실행 중인 서버에도 바로 반영한다.
export interface ServerSettings {
  linear: {
    apiKeySet: boolean;
    teamKey: string; // 주 팀
    teamKeys: string[]; // 읽는 팀 전부(주 팀이 맨 앞)
  };
  agents: {
    claude: { sessionsDir: string; present: boolean; claimHook: boolean };
    codex: { sessionsDir: string; present: boolean };
    claimTtlMin: number;
    handoffGraceMin: number;
    projectsDir: string;
  };
  // 외부 착륙 리뷰(ATC-30): 보안 규칙에만 걸린 PR을 DeepSeek REVIEW에 보낼까(dispatch.json externalReview.security)
  review: { security: ExternalReviewSecurity };
  // FUEL REMAINING(ATC-55): dispatch.json fuel. hold는 DISPATCH HOLD 스위치(D3, 기본 꺼짐), 임계값은 쓴 몫 %
  fuel: { hold: boolean; infoPct: number; holdPct: number };
  // AUTOLAND(ATC-34): autoland.json의 스위치와 맡은 AIRPORT, 걸린 GROUND STOP
  autoland: { mode: AutolandMode; airports: string[]; applicationCheck: string; groundStops: { airport: string; sha: string; failing: string[]; at: string }[] };
  // MCC(docs/mcc.md): mcc.json의 스위치와 맡은 AIRPORT
  mcc: { mode: MccMode; airport: string };
  // 판정 계열(ATC-36): judges.json의 스위치, 엔진, 키가 있는지(값은 내보내지 않음), 마지막 실행
  judges: { jev: { mode: JudgeMode; engine: "stub" | "jev"; apiKeySet: boolean; lastRunAt: string | null; lastError: string | null; judged: number } };
}

// 고칠 수 있는 항목. apiKey는 null이면 지운다.
export interface SettingsPatch {
  apiKey?: string | null;
  teamKey?: string;
  teamKeys?: string; // 쉼표로 구분한 팀 key. 비우면 주 팀만
  claimTtlMin?: number;
  handoffGraceMin?: number;
  projectsDir?: string;
  reviewSecurity?: ExternalReviewSecurity; // dispatch.json에 쓴다(.env.local이 아님)
  fuelHold?: "off" | "on"; // dispatch.json fuel.hold에 쓴다(ATC-55). SUPERVISOR만: 이 화면 Origin이 있어야 받는다
  autolandMode?: AutolandMode; // autoland.json에 쓴다(ATC-34). SUPERVISOR만: 이 화면 Origin이 있어야 받는다
  mccMode?: MccMode; // mcc.json에 쓴다(docs/mcc.md). SUPERVISOR만: 이 화면 Origin이 있어야 받는다
  judgesJev?: JudgeMode; // judges.json에 쓴다(ATC-36). SUPERVISOR만: 이 화면 Origin이 있어야 받는다. 데이터 반출을 켜는 스위치
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
      teamKeys: config.linearTeamKeys,
    },
    agents: {
      claude: { sessionsDir: claudeSessions, present: existsSync(claudeSessions), claimHook: claimHookInstalled() },
      codex: { sessionsDir: codexSessions, present: existsSync(codexSessions) },
      claimTtlMin: Math.round(config.claimTtlMs / 60_000),
      handoffGraceMin: Math.round(config.handoffGraceMs / 60_000),
      projectsDir: config.projectsDir,
    },
    review: { security: loadDispatchConfig().externalReview.security },
    fuel: loadDispatchConfig().fuel,
    autoland: (() => {
      const a = loadAutoland();
      return { mode: a.mode, airports: a.airports, applicationCheck: a.applicationCheck, groundStops: loadAutolandState().groundStops.map(({ airport, sha, failing, at }) => ({ airport, sha, failing, at })) };
    })(),
    mcc: (() => {
      const m = loadMcc();
      return { mode: m.mode, airport: m.airport };
    })(),
    judges: { jev: { mode: loadJudges().jev, engine: engineName(), apiKeySet: Boolean(config.typesafeApiKey), ...judgeStatus.jev } },
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
      case "teamKeys": {
        const list = (typeof raw === "string" ? raw : "").split(/[\s,]+/).map((k) => k.trim().toUpperCase()).filter(Boolean);
        if (typeof raw !== "string" || list.some((k) => !TEAM_KEY.test(k))) errors.teamKeys = "쉼표로 구분한 팀 key(예: VOC, ATC)";
        else env.LINEAR_TEAM_KEYS = list.length ? [...new Set(list)].join(",") : null;
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
  const keysChanged = Boolean(env.LINEAR_TEAM_KEY) || "LINEAR_TEAM_KEYS" in env;
  if (keysChanged) config.linearTeamKeys = parseTeamKeys(config.linearTeamKey, "LINEAR_TEAM_KEYS" in env ? (env.LINEAR_TEAM_KEYS ?? "") : config.linearTeamKeys.slice(1).join(","));
  if (env.ATC_CLAIM_TTL_MIN) config.claimTtlMs = Number(env.ATC_CLAIM_TTL_MIN) * 60_000;
  if (env.ATC_HANDOFF_GRACE_MIN) config.handoffGraceMs = Number(env.ATC_HANDOFF_GRACE_MIN) * 60_000;
  if (env.ATC_PROJECTS_DIR) config.projectsDir = env.ATC_PROJECTS_DIR;
  if (keysChanged) resetTicketPattern();
  if ("LINEAR_API_KEY" in env || keysChanged) resetLinear();
}

export function mountSettings(app: Hono) {
  app.get("/api/settings", (c) => c.json(readServerSettings()));
  app.put("/api/settings", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "JSON 객체가 아님" }, 400);
    // reviewSecurity는 .env가 아니라 dispatch.json에 쓴다(ATC-30)
    // autolandMode는 autoland.json에 쓴다(ATC-34)
    // judgesJev는 judges.json에 쓴다(ATC-36)
    // mccMode는 mcc.json에 쓴다(docs/mcc.md)
    // fuelHold는 dispatch.json fuel.hold에 쓴다(ATC-55)
    const { reviewSecurity, autolandMode, judgesJev, mccMode, fuelHold, ...rest } = body as Record<string, unknown>;
    if (fuelHold !== undefined && fuelHold !== "off" && fuelHold !== "on") return c.json({ errors: { fuelHold: `off 또는 on` } }, 400);
    if (reviewSecurity !== undefined && !EXTERNAL_REVIEW_SECURITY.includes(reviewSecurity as ExternalReviewSecurity))
      return c.json({ errors: { reviewSecurity: `exclude 또는 deepseek` } }, 400);
    if (autolandMode !== undefined && !AUTOLAND_MODES.includes(autolandMode as AutolandMode)) return c.json({ errors: { autolandMode: `off, update, merge 중 하나` } }, 400);
    if (judgesJev !== undefined && !JUDGE_MODES.includes(judgesJev as JudgeMode)) return c.json({ errors: { judgesJev: `off, replay, shadow 중 하나` } }, 400);
    if (mccMode !== undefined && !MCC_MODES.includes(mccMode as MccMode)) return c.json({ errors: { mccMode: `shadow, land, land+rts 중 하나` } }, 400);
    const { env, errors } = validatePatch(rest);
    if (Object.keys(errors).length) return c.json({ errors }, 400);
    if (Object.keys(env).length) {
      writeEnvFile(env);
      applyToConfig(env);
    }
    if (reviewSecurity !== undefined) saveExternalReviewSecurity(reviewSecurity as ExternalReviewSecurity);
    if (fuelHold !== undefined) saveFuelHold(fuelHold === "on");
    if (autolandMode !== undefined) setAutolandMode(autolandMode as AutolandMode);
    if (judgesJev !== undefined) setJudgeMode("jev", judgesJev as JudgeMode);
    if (mccMode !== undefined) setMccMode(mccMode as MccMode);
    console.log(
      `[atc] settings updated: ${[...Object.keys(env), ...(reviewSecurity !== undefined ? [`externalReview.security=${reviewSecurity}`] : []), ...(fuelHold !== undefined ? [`fuel.hold=${fuelHold}`] : []), ...(autolandMode !== undefined ? [`autoland.mode=${autolandMode}`] : []), ...(judgesJev !== undefined ? [`judges.jev=${judgesJev}`] : []), ...(mccMode !== undefined ? [`mcc.mode=${mccMode}`] : [])].join(", ")}`,
    );
    return c.json(readServerSettings());
  });
}

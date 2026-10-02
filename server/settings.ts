import { chmodSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { Hono } from "hono";
import { type AutolandMode, type CheckWarning, getCheckWarnings, loadAutoland, loadAutolandState, type ReviewedSecurity } from "./autoland.ts";
import { config } from "./config.ts";
import { accountFolders, observedLabelsOn } from "./accounts.ts";
import { type AutoMode, type ExternalReviewSecurity, loadDispatchConfig } from "./dispatch.ts";
import { engineName, judgeStatus } from "./judges/run.ts";
import { type JudgeMode, loadJudges } from "./judges/store.ts";
import { parseTeamKeys, TEAM_KEY } from "./linear-keys.ts";
import { loadMcc, type MccMode } from "./mcc.ts";
import { loadReposition } from "./fleet-plan-run.ts";
import type { RepositionMode } from "./reposition.ts";
import { loadRecycle, type RecycleMode } from "./control-recycle.ts";
import { TTS_ENGINES, VOICE_NAME } from "./tts.ts";
import { type DutyConfig, loadDutyConfig } from "./duty-config.ts";
import { effectiveDutyFolder } from "./duty-account.ts";
import { fromThisApp } from "./origin.ts";
import type { AutoSwitch } from "./autonomy-auto.ts";
import { loadAutoSwitch } from "./autonomy-auto-run.ts";
import type { SwitchView } from "./switch-def.ts";
import { type SwitchRegistry, switchRegistry } from "./switch-registry.ts";
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
  // 외부 착륙 리뷰(ATC-30): 보안 규칙에만 걸린 PR을 REVIEW 세션(Claude Sonnet)에 보낼까(dispatch.json externalReview.security)
  review: { security: ExternalReviewSecurity };
  // FUEL REMAINING(ATC-55): dispatch.json fuel. hold는 DISPATCH HOLD 스위치(D3, 기본 꺼짐), 임계값은 쓴 몫 %
  fuel: { hold: boolean; infoPct: number; holdPct: number };
  // 일치 기반 자동 승인(ATC-334): dispatch.json의 autoApprove(ASSIGN·SCHEDULE 초안)와 autoApproveLaunch(launch 카드). 기본 off. 상한은 dispatch.json에서만 바꾼다
  dispatchAuto: { auto: "off" | "on"; approve: AutoMode; launch: AutoMode; approveMax: number; launchMax: number; backoffMin: number };
  // SCHEDULE·FLEET PLAN 자동 적용(ATC-370): schedule.json·fleet-plan.json의 auto(기본 on). 사람 판정 없이 서버가 적용한다. 끄는 것은 SUPERVISOR만
  autonomyAuto: { schedule: AutoSwitch; fleetPlan: AutoSwitch };
  // AUTOLAND(ATC-34): autoland.json의 스위치와 맡은 AIRPORT, 걸린 GROUND STOP
  autoland: { mode: AutolandMode; reviewedSecurity: ReviewedSecurity; airports: string[]; applicationCheck: string; groundStops: { airport: string; sha: string; failing: string[]; at: string }[]; applicationCheckWarnings: CheckWarning[] };
  // MCC(docs/mcc.md): mcc.json의 스위치와 맡은 AIRPORT
  mcc: { mode: MccMode; airport: string };
  // FLEET PLAN REPOSITION(ATC-179): fleet-plan.json. 기본 shadow. auto는 ⚠(하루 dailyMax 상한, flapping이면 approval로 돌아옴)
  fleetPlan: { reposition: RepositionMode; repositionDailyMax: number };
  // CONTROL RECYCLE(ATC-166): control-recycle.json. 기본 off. caps는 세션 이름 → CAP 토큰(null이면 재시작 안 함)
  controlRecycle: { mode: RecycleMode; caps: Record<string, number | null>; auto: Record<string, boolean>; cooldownHours: number };
  // 판정 계열(ATC-36): judges.json의 스위치, 엔진, 키가 있는지(값은 내보내지 않음), 마지막 실행
  // 음성 콜아웃(ATC-140): 고른 엔진과 목소리(.env.local). 설치된 목소리 목록은 GET /api/voice/status
  voice: { engine: string; voice: string };
  // DUTY(ATC-220): duty.json. 기본 꺼짐. 켜면 SUPERVISOR가 첫 글을 보낼 때 이 서버가 `claude -p`를 띄운다(ACCOUNT의 FUEL을 쓴다)
  duty: Pick<DutyConfig, "enabled" | "account" | "idleMin" | "charter"> & { accountWarning: string | null }; // accountWarning: 등록부에 없는 ACCOUNT라 ~/.claude로 돈다(ATC-242)
  judges: { jev: { mode: JudgeMode; engine: "stub" | "jev"; apiKeySet: boolean; lastRunAt: string | null; lastError: string | null; judged: number } };
  // 선언된 스위치 전부(ATC-393, server/switches/): 지금 값, 값 목록, ⚠ 모드, 값마다 경고, 설정 창의 줄. 정책 한 줄·⚠ 목록·설정 찾기·설정 창이 이것을 읽는다
  switches: SwitchView[];
}

// 고칠 수 있는 항목. apiKey는 null이면 지운다.
export interface SettingsPatch {
  apiKey?: string | null;
  teamKey?: string;
  teamKeys?: string; // 쉼표로 구분한 팀 key. 비우면 주 팀만
  claimTtlMin?: number;
  handoffGraceMin?: number;
  projectsDir?: string;
  ttsEngine?: string; // none·piper·espeak·kokoro·stub. .env.local의 ATC_TTS_ENGINE(ATC-140)
  ttsVoice?: string; // 고른 목소리 이름. 비우면 첫 번째. ATC_TTS_VOICE
  // SUPERVISOR 스위치(dispatch.json·autoland.json·mcc.json …)는 server/switches/의 선언이 이름·값·저장을 정한다(ATC-393). 이 목록에는 적지 않는다
  [declaredSwitch: string]: unknown; // server/switches/에 선언한 스위치의 key와 값(PUT /api/settings는 같은 본문으로 받는다)
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

export function readServerSettings(registry: SwitchRegistry = switchRegistry): ServerSettings {
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
    dispatchAuto: (({ autoDispatch, autoApprove, autoApproveLaunch, autoApproveMax, autoLaunchMax, autoLaunchBackoffMin }) => ({ auto: autoDispatch, approve: autoApprove, launch: autoApproveLaunch, approveMax: autoApproveMax, launchMax: autoLaunchMax, backoffMin: autoLaunchBackoffMin }))(loadDispatchConfig()),
    autonomyAuto: { schedule: loadAutoSwitch("schedule"), fleetPlan: loadAutoSwitch("fleetPlan") },
    autoland: (() => {
      const a = loadAutoland();
      return { mode: a.mode, reviewedSecurity: a.reviewedSecurity, airports: a.airports, applicationCheck: a.applicationCheck, groundStops: loadAutolandState().groundStops.map(({ airport, sha, failing, at }) => ({ airport, sha, failing, at })), applicationCheckWarnings: [...getCheckWarnings()] };
    })(),
    mcc: (() => {
      const m = loadMcc();
      return { mode: m.mode, airport: m.airport };
    })(),
    controlRecycle: loadRecycle(),
    fleetPlan: { reposition: loadReposition().mode, repositionDailyMax: loadReposition().dailyMax },
    voice: { engine: config.ttsEngine, voice: config.ttsVoice },
    duty: (({ enabled, account, idleMin, charter }) => ({ enabled, account, idleMin, charter, accountWarning: effectiveDutyFolder(account, accountFolders(), config.claudeDir).warning }))(loadDutyConfig()),
    judges: { jev: { mode: loadJudges().jev, engine: engineName(), apiKeySet: Boolean(config.typesafeApiKey), ...judgeStatus.jev } },
    switches: registry.views(),
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
      case "ttsEngine":
        if (typeof raw === "string" && (TTS_ENGINES as readonly string[]).includes(raw)) env.ATC_TTS_ENGINE = raw;
        else errors.ttsEngine = `${TTS_ENGINES.join(", ")} 중 하나`;
        break;
      case "ttsVoice":
        if (raw === null || raw === "") env.ATC_TTS_VOICE = null;
        else if (typeof raw === "string" && VOICE_NAME.test(raw)) env.ATC_TTS_VOICE = raw;
        else errors.ttsVoice = "목소리 이름(영문·숫자·-_.)";
        break;
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
  if (env.ATC_TTS_ENGINE) config.ttsEngine = env.ATC_TTS_ENGINE;
  if ("ATC_TTS_VOICE" in env) config.ttsVoice = env.ATC_TTS_VOICE ?? "";
  if (keysChanged) resetTicketPattern();
  if ("LINEAR_API_KEY" in env || keysChanged) resetLinear();
}

export function mountSettings(app: Hono, registry: SwitchRegistry = switchRegistry) {
  app.get("/api/settings", (c) => c.json(readServerSettings(registry)));
  app.put("/api/settings", async (c) => {
    if (!fromThisApp(c)) return c.json({ error: "이 화면에서 보낸 요청만 받습니다" }, 403);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "JSON 객체가 아님" }, 400);
    // 스위치는 server/switches/의 선언이 검사하고 저장한다(ATC-393). 나머지(.env.local 설정)는 아래 validatePatch
    const checked = registry.validate(body as Record<string, unknown>);
    if ("errors" in checked) return c.json({ errors: checked.errors }, 400);
    const { env, errors } = validatePatch(registry.rest(body as Record<string, unknown>));
    if (Object.keys(errors).length) return c.json({ errors }, 400);
    if (Object.keys(env).length) {
      writeEnvFile(env);
      applyToConfig(env);
    }
    const lines = await registry.apply(checked.ok);
    console.log(`[atc] settings updated: ${[...Object.keys(env), ...lines].join(", ")}`);
    return c.json(readServerSettings(registry));
  });
}

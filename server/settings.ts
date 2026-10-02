import { chmodSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { Hono } from "hono";
import { AUTOLAND_MODES, type AutolandMode, type CheckWarning, getCheckWarnings, loadAutoland, loadAutolandState, REVIEWED_SECURITY, type ReviewedSecurity } from "./autoland.ts";
import { setAutolandMode, setReviewedSecurity } from "./autoland-run.ts";
import { config } from "./config.ts";
import { accountFolders, observedLabelsOn } from "./accounts.ts";
import { AUTO_MODES, type AutoMode, EXTERNAL_REVIEW_SECURITY, type ExternalReviewSecurity, loadDispatchConfig, saveAutoApprove, saveAutoDispatch, saveExternalReviewSecurity, saveFuelHold, saveStaleStop } from "./dispatch.ts";
import { record } from "./recorder.ts";
import { engineName, judgeStatus } from "./judges/run.ts";
import { JUDGE_MODES, type JudgeMode, loadJudges, setJudgeMode } from "./judges/store.ts";
import { parseTeamKeys, TEAM_KEY } from "./linear-keys.ts";
import { loadMcc, MCC_MODES, type MccMode } from "./mcc.ts";
import { loadReposition, setRepositionMode } from "./fleet-plan-run.ts";
import { REPOSITION_MODES, type RepositionMode } from "./reposition.ts";
import { loadRecycle, RECYCLE_MODES, type RecycleMode, recycleCapOk } from "./control-recycle.ts";
import { setRecycleAuto, setRecycleCaps, setRecycleMode } from "./control-recycle-run.ts";
import { TTS_ENGINES, VOICE_NAME } from "./tts.ts";
import { setMccMode } from "./mcc-run.ts";
import { AUTO_REVERT_MODES, type AutoRevertMode, loadAutoRevert, readAutoRevertLines, type RevertDay, revertDaysOf } from "./auto-revert.ts";
import { setAutoRevertMode, stoppedAirports } from "./auto-revert-run.ts";
import { type DutyConfig, loadDutyConfig } from "./duty-config.ts";
import { dutyAccountPatchOf, effectiveDutyFolder } from "./duty-account.ts";
import { setDutyConfig } from "./duty-run.ts";
import { fromThisApp } from "./origin.ts";
import { AUTO_SWITCHES, type AutoSwitch } from "./autonomy-auto.ts";
import { loadAutoSwitch, saveAutoSwitch } from "./autonomy-auto-run.ts";
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
  staleStop?: "on" | "off"; // STALE STOP(ATC-369): dispatch.json staleStop
  dispatchAuto: { mode: "shadow" | "approval"; auto: "off" | "on"; approve: AutoMode; launch: AutoMode; approveMax: number; launchMax: number; backoffMin: number };
  // SCHEDULE·FLEET PLAN 자동 적용(ATC-370): schedule.json·fleet-plan.json의 auto(기본 on). 사람 판정 없이 서버가 적용한다. 끄는 것은 SUPERVISOR만
  autonomyAuto: { schedule: AutoSwitch; fleetPlan: AutoSwitch };
  // AUTOLAND(ATC-34): autoland.json의 스위치와 맡은 AIRPORT, 걸린 GROUND STOP
  autoland: { mode: AutolandMode; reviewedSecurity: ReviewedSecurity; airports: string[]; applicationCheck: string; groundStops: { airport: string; sha: string; failing: string[]; at: string }[]; applicationCheckWarnings: CheckWarning[] };
  // MCC(docs/mcc.md): mcc.json의 스위치와 맡은 AIRPORT
  mcc: { mode: MccMode; airport: string };
  // 자동 되돌림(ATC-351): auto-revert.json의 스위치와 breaker가 멈춘 AIRPORT. 기본 on(ATC-394)
  autoRevert: { mode: AutoRevertMode; stopped: { airport: string; at: string; detail: string }[]; days: RevertDay[] }; // days: 최근 7일의 날짜별 revert·flake·misfire 수(ATC-394)
  // FLEET PLAN REPOSITION(ATC-179): fleet-plan.json. 기본 shadow. auto는 ⚠(하루 dailyMax 상한, flapping이면 approval로 돌아옴)
  fleetPlan: { reposition: RepositionMode; repositionDailyMax: number };
  // CONTROL RECYCLE(ATC-166): control-recycle.json. 기본 off. caps는 세션 이름 → CAP 토큰(null이면 재시작 안 함)
  controlRecycle: { mode: RecycleMode; caps: Record<string, number | null>; auto: Record<string, boolean>; cooldownHours: number };
  // 판정 계열(ATC-36): judges.json의 스위치, 엔진, 키가 있는지(값은 내보내지 않음), 마지막 실행
  // 음성 콜아웃(ATC-140): 고른 엔진과 목소리(.env.local). 설치된 목소리 목록은 GET /api/voice/status
  voice: { engine: string; voice: string };
  // DUTY(ATC-220): duty.json. 기본 꺼짐. 켜면 SUPERVISOR가 첫 글을 보낼 때 이 서버가 `claude -p`를 띄운다(ACCOUNT의 FUEL을 쓴다)
  duty: Pick<DutyConfig, "enabled" | "account" | "idleMin" | "charter" | "review"> & { accountWarning: string | null }; // accountWarning: 등록부에 없는 ACCOUNT라 ~/.claude로 돈다(ATC-242)
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
  ttsEngine?: string; // none·piper·espeak·kokoro·stub. .env.local의 ATC_TTS_ENGINE(ATC-140)
  ttsVoice?: string; // 고른 목소리 이름. 비우면 첫 번째. ATC_TTS_VOICE
  reviewSecurity?: ExternalReviewSecurity; // dispatch.json에 쓴다(.env.local이 아님)
  fuelHold?: "off" | "on"; // dispatch.json fuel.hold에 쓴다(ATC-55). SUPERVISOR만: 이 화면 Origin이 있어야 받는다
  autoApprove?: AutoMode; // dispatch.json에 쓴다(ATC-334). SUPERVISOR만: 이 화면 Origin이 있어야 받는다(atcctl 명령은 없다, K3)
  autoApproveLaunch?: AutoMode; // 위와 같다. launch 카드를 서버가 승인하고 LAUNCH한다
  staleStop?: "on" | "off"; // dispatch.json에 쓴다(ATC-369). 끝난 FLIGHT의 PENDING·HUNG AIRCRAFT를 30분 뒤 서버가 멈춘다. SUPERVISOR만: 이 화면 Origin이 있어야 받는다(atcctl 명령은 없다, K3)
  autoDispatch?: "off" | "on"; // dispatch.json에 쓴다(ATC-367, K3). 켜면 서버가 필터·상한을 통과한 ASSIGN·launch를 CROSSCHECK·사람 없이 승인한다. SUPERVISOR만(이 화면 Origin), atcctl 명령 없음
  scheduleAuto?: AutoSwitch; // schedule.json의 auto(ATC-370). SUPERVISOR만: 이 화면 Origin이 있어야 받는다(atcctl 명령은 없다, K3)
  fleetPlanAuto?: AutoSwitch; // fleet-plan.json의 auto(ATC-370). 위와 같다
  autolandMode?: AutolandMode; // autoland.json에 쓴다(ATC-34). SUPERVISOR만: 이 화면 Origin이 있어야 받는다
  autoRevert?: AutoRevertMode; // auto-revert.json에 쓴다(ATC-351). SUPERVISOR만: 이 화면 Origin이 있어야 받는다(atcctl 명령은 없다, K3)
  autolandReviewedSecurity?: ReviewedSecurity; // autoland.json의 reviewedSecurity(ATC-328). SUPERVISOR만: 이 화면 Origin이 있어야 받는다
  mccMode?: MccMode; // mcc.json에 쓴다(docs/mcc.md). SUPERVISOR만: 이 화면 Origin이 있어야 받는다
  controlRecycleMode?: RecycleMode; // control-recycle.json에 쓴다(ATC-166). SUPERVISOR만: 이 화면 Origin이 있어야 받는다
  controlRecycleCaps?: Record<string, number | null>; // 세션 이름 → CAP 토큰. SUPERVISOR만
  controlRecycleAuto?: Record<string, boolean>; // 세션 이름 → 자동 재시작 대상인가(OCC 기본 false, 측정·알림만). SUPERVISOR만
  fleetPlanReposition?: RepositionMode; // fleet-plan.json에 쓴다(ATC-179). SUPERVISOR만: 이 화면 Origin이 있어야 받는다
  dutyCharter?: "off" | "shadow" | "on"; // duty.json의 charter(ATC-233): DUTY가 만든 CHARTER REQUEST를 OCC가 읽는 정도. SUPERVISOR만(이 화면 Origin)
  dutyAccount?: string; // duty.json의 account(ATC-242): 등록부의 라벨만. 바뀌면 다음 글부터 새 대화. SUPERVISOR만
  dutyReview?: "off" | "on"; // duty.json의 review(ATC-396): 서버가 SUPERVISOR의 글 없이 DUTY 점검 턴을 시작하는 스위치. 기본 on. SUPERVISOR만(이 화면 Origin)
  dutyEnabled?: "off" | "on"; // duty.json에 쓴다(ATC-220). SUPERVISOR만: 이 화면 Origin이 있어야 받는다. 끄면 실행 중인 프로세스가 끝난다
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
    staleStop: loadDispatchConfig().staleStop,
    dispatchAuto: (({ mode, autoDispatch, autoApprove, autoApproveLaunch, autoApproveMax, autoLaunchMax, autoLaunchBackoffMin }) => ({ mode, auto: autoDispatch, approve: autoApprove, launch: autoApproveLaunch, approveMax: autoApproveMax, launchMax: autoLaunchMax, backoffMin: autoLaunchBackoffMin }))(loadDispatchConfig()),
    autonomyAuto: { schedule: loadAutoSwitch("schedule"), fleetPlan: loadAutoSwitch("fleetPlan") },
    autoland: (() => {
      const a = loadAutoland();
      return { mode: a.mode, reviewedSecurity: a.reviewedSecurity, airports: a.airports, applicationCheck: a.applicationCheck, groundStops: loadAutolandState().groundStops.map(({ airport, sha, failing, at }) => ({ airport, sha, failing, at })), applicationCheckWarnings: [...getCheckWarnings()] };
    })(),
    mcc: (() => {
      const m = loadMcc();
      return { mode: m.mode, airport: m.airport };
    })(),
    autoRevert: { mode: loadAutoRevert().mode, stopped: stoppedAirports().map((l) => ({ airport: l.airport ?? "?", at: l.at, detail: l.detail ?? "" })), days: revertDaysOf(readAutoRevertLines(), 7, Date.now()) },
    controlRecycle: loadRecycle(),
    fleetPlan: { reposition: loadReposition().mode, repositionDailyMax: loadReposition().dailyMax },
    voice: { engine: config.ttsEngine, voice: config.ttsVoice },
    duty: (({ enabled, account, idleMin, charter, review }) => ({ enabled, account, idleMin, charter, review, accountWarning: effectiveDutyFolder(account, accountFolders(), config.claudeDir).warning }))(loadDutyConfig()),
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
    const { reviewSecurity, autolandMode, autolandReviewedSecurity, autoRevert, judgesJev, mccMode, fuelHold, autoApprove, autoApproveLaunch, autoDispatch, staleStop, scheduleAuto, fleetPlanAuto, controlRecycleMode, controlRecycleCaps, controlRecycleAuto, fleetPlanReposition, dutyEnabled, dutyCharter, dutyReview, dutyAccount, ...rest } = body as Record<string, unknown>;
    if (fuelHold !== undefined && fuelHold !== "off" && fuelHold !== "on") return c.json({ errors: { fuelHold: `off 또는 on` } }, 400);
    if (autoApprove !== undefined && !AUTO_MODES.includes(autoApprove as AutoMode)) return c.json({ errors: { autoApprove: `off, shadow, on 중 하나` } }, 400);
    if (autoApproveLaunch !== undefined && !AUTO_MODES.includes(autoApproveLaunch as AutoMode)) return c.json({ errors: { autoApproveLaunch: `off, shadow, on 중 하나` } }, 400);
    if (autoDispatch !== undefined && autoDispatch !== "off" && autoDispatch !== "on") return c.json({ errors: { autoDispatch: `off 또는 on` } }, 400);
    if (staleStop !== undefined && staleStop !== "off" && staleStop !== "on") return c.json({ errors: { staleStop: `off 또는 on` } }, 400);
    if (scheduleAuto !== undefined && !AUTO_SWITCHES.includes(scheduleAuto as AutoSwitch)) return c.json({ errors: { scheduleAuto: `off 또는 on` } }, 400);
    if (fleetPlanAuto !== undefined && !AUTO_SWITCHES.includes(fleetPlanAuto as AutoSwitch)) return c.json({ errors: { fleetPlanAuto: `off 또는 on` } }, 400);
    if (reviewSecurity !== undefined && !EXTERNAL_REVIEW_SECURITY.includes(reviewSecurity as ExternalReviewSecurity))
      return c.json({ errors: { reviewSecurity: `exclude 또는 deepseek` } }, 400);
    if (autolandMode !== undefined && !AUTOLAND_MODES.includes(autolandMode as AutolandMode)) return c.json({ errors: { autolandMode: `off, update, merge 중 하나` } }, 400);
    if (autoRevert !== undefined && !AUTO_REVERT_MODES.includes(autoRevert as AutoRevertMode)) return c.json({ errors: { autoRevert: `off 또는 on` } }, 400);
    if (autolandReviewedSecurity !== undefined && !REVIEWED_SECURITY.includes(autolandReviewedSecurity as ReviewedSecurity)) return c.json({ errors: { autolandReviewedSecurity: `off 또는 delegate` } }, 400);
    if (judgesJev !== undefined && !JUDGE_MODES.includes(judgesJev as JudgeMode)) return c.json({ errors: { judgesJev: `off, replay, shadow 중 하나` } }, 400);
    if (mccMode !== undefined && !MCC_MODES.includes(mccMode as MccMode)) return c.json({ errors: { mccMode: `shadow, land, land+rts, rts 중 하나` } }, 400);
    if (controlRecycleMode !== undefined && !RECYCLE_MODES.includes(controlRecycleMode as RecycleMode)) return c.json({ errors: { controlRecycleMode: `off, shadow, on 중 하나` } }, 400);
    if (controlRecycleCaps !== undefined) {
      const known = Object.keys(loadRecycle().caps);
      const caps = controlRecycleCaps as Record<string, unknown>;
      const bad = !caps || typeof caps !== "object" || Array.isArray(caps) || Object.entries(caps).some(([k, v]) => !known.includes(k) || !(v === null || recycleCapOk(v)));
      if (bad) return c.json({ errors: { controlRecycleCaps: `세션 이름(${known.join(", ")}) → 50000–900000 토큰 또는 null` } }, 400);
    }
    if (controlRecycleAuto !== undefined) {
      const known = Object.keys(loadRecycle().auto);
      const a = controlRecycleAuto as Record<string, unknown>;
      if (!a || typeof a !== "object" || Array.isArray(a) || Object.entries(a).some(([k, v]) => !known.includes(k) || typeof v !== "boolean"))
        return c.json({ errors: { controlRecycleAuto: `세션 이름(${known.join(", ")}) → true 또는 false` } }, 400);
    }
    if (fleetPlanReposition !== undefined && !REPOSITION_MODES.includes(fleetPlanReposition as RepositionMode)) return c.json({ errors: { fleetPlanReposition: `off, shadow, approval, auto 중 하나` } }, 400);
    if (dutyEnabled !== undefined && dutyEnabled !== "off" && dutyEnabled !== "on") return c.json({ errors: { dutyEnabled: `off 또는 on` } }, 400);
    if (dutyReview !== undefined && dutyReview !== "off" && dutyReview !== "on") return c.json({ errors: { dutyReview: `off 또는 on` } }, 400);
    const dutyAcct = dutyAccount === undefined ? null : dutyAccountPatchOf(dutyAccount, observedLabelsOn(accountFolders()) ? accountFolders().map((f) => f.label) : []);
    if (dutyAcct && !dutyAcct.ok) return c.json({ errors: { dutyAccount: dutyAcct.error } }, 400);
    if (dutyCharter !== undefined && dutyCharter !== "off" && dutyCharter !== "shadow" && dutyCharter !== "on") return c.json({ errors: { dutyCharter: `off, shadow, on 중 하나` } }, 400);
    const { env, errors } = validatePatch(rest);
    if (Object.keys(errors).length) return c.json({ errors }, 400);
    if (Object.keys(env).length) {
      writeEnvFile(env);
      applyToConfig(env);
    }
    if (reviewSecurity !== undefined) saveExternalReviewSecurity(reviewSecurity as ExternalReviewSecurity);
    if (fuelHold !== undefined) saveFuelHold(fuelHold === "on");
    if (autoApprove !== undefined) saveAutoApprove("autoApprove", autoApprove as AutoMode);
    if (autoApproveLaunch !== undefined) saveAutoApprove("autoApproveLaunch", autoApproveLaunch as AutoMode);
    if (autoDispatch !== undefined) saveAutoDispatch(autoDispatch);
    if (staleStop !== undefined) {
      const from = loadDispatchConfig().staleStop;
      saveStaleStop(staleStop);
      if (from !== staleStop) record({ t: new Date().toISOString(), kind: "policy", op: "stale-stop-mode", by: "SUPERVISOR", from, to: staleStop });
    }
    if (scheduleAuto !== undefined) saveAutoSwitch("schedule", scheduleAuto as AutoSwitch);
    if (fleetPlanAuto !== undefined) saveAutoSwitch("fleetPlan", fleetPlanAuto as AutoSwitch);
    if (autolandMode !== undefined) setAutolandMode(autolandMode as AutolandMode);
    if (autoRevert !== undefined) setAutoRevertMode(autoRevert as AutoRevertMode);
    if (autolandReviewedSecurity !== undefined) setReviewedSecurity(autolandReviewedSecurity as ReviewedSecurity);
    if (judgesJev !== undefined) setJudgeMode("jev", judgesJev as JudgeMode);
    if (mccMode !== undefined) setMccMode(mccMode as MccMode);
    if (fleetPlanReposition !== undefined) setRepositionMode(fleetPlanReposition as RepositionMode);
    if (controlRecycleCaps !== undefined) setRecycleCaps(controlRecycleCaps as Record<string, number | null>);
    if (controlRecycleAuto !== undefined) setRecycleAuto(controlRecycleAuto as Record<string, boolean>);
    if (controlRecycleMode !== undefined) setRecycleMode(controlRecycleMode as RecycleMode);
    if (dutyEnabled !== undefined) await setDutyConfig({ enabled: dutyEnabled === "on" });
    if (dutyCharter !== undefined) await setDutyConfig({ charter: dutyCharter });
    if (dutyReview !== undefined) await setDutyConfig({ review: dutyReview === "on" });
    if (dutyAcct?.ok) await setDutyConfig({ account: dutyAcct.label });
    console.log(
      `[atc] settings updated: ${[...Object.keys(env), ...(reviewSecurity !== undefined ? [`externalReview.security=${reviewSecurity}`] : []), ...(fuelHold !== undefined ? [`fuel.hold=${fuelHold}`] : []), ...(autoApprove !== undefined ? [`autoApprove=${autoApprove}`] : []), ...(autoApproveLaunch !== undefined ? [`autoApproveLaunch=${autoApproveLaunch}`] : []), ...(staleStop !== undefined ? [`staleStop=${staleStop}`] : []), ...(autoDispatch !== undefined ? [`autoDispatch=${autoDispatch}`] : []), ...(scheduleAuto !== undefined ? [`schedule.auto=${scheduleAuto}`] : []), ...(fleetPlanAuto !== undefined ? [`fleet-plan.auto=${fleetPlanAuto}`] : []), ...(autolandMode !== undefined ? [`autoland.mode=${autolandMode}`] : []), ...(autoRevert !== undefined ? [`autoRevert=${autoRevert}`] : []), ...(autolandReviewedSecurity !== undefined ? [`autoland.reviewedSecurity=${autolandReviewedSecurity}`] : []), ...(judgesJev !== undefined ? [`judges.jev=${judgesJev}`] : []), ...(mccMode !== undefined ? [`mcc.mode=${mccMode}`] : []), ...(dutyEnabled !== undefined ? [`duty.enabled=${dutyEnabled}`] : []), ...(dutyCharter !== undefined ? [`duty.charter=${dutyCharter}`] : []), ...(dutyReview !== undefined ? [`duty.review=${dutyReview}`] : []), ...(dutyAcct?.ok ? [`duty.account=${dutyAcct.label}`] : [])].join(", ")}`,
    );
    return c.json(readServerSettings());
  });
}

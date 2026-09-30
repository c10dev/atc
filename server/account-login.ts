import { type ChildProcess, execFile, spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { authStatusOf, forgetAuthStatus } from "./account-health.ts";
import { AccountsError, accountFolders } from "./accounts.ts";
import { loadRegistry } from "./airports.ts";
import { cleanEnv } from "./clean-env.ts";
import { config } from "./config.ts";

// 웹 LOGIN(ATC-187, docs/accounts.md): 등록된 폴더에서 `claude auth login --claudeai`를 돌리고, 화면이 보여 준 URL로 SUPERVISOR가 로그인해
// 받은 코드를 그 프로세스의 stdin에 넘긴다. 로그인되면 그 폴더의 .claude.json에 온보딩 칸 셋만 합쳐 넣는다(SUPERVISOR 결정 A, 2026-09-30).
// 코드는 저장·기록하지 않는다(PKCE라 그 프로세스 밖에서는 쓸모도 없다). 프로세스 출력은 화면에 보내지 않는다(계정 이름이 나올 수 있다).
// `.credentials.json`은 열지 않는다. `.claude.json`은 읽어서 세 칸만 바꿔 쓰고, 그 안의 어떤 값도 돌려주거나 저장하지 않는다.

export type LoginState = "starting" | "waiting-code" | "verifying" | "done" | "failed";
export interface LoginView {
  label: string;
  state: LoginState;
  url: string | null; // 로그인 URL(Claude·Anthropic 호스트일 때만)
  startedAt: string;
  error: string | null; // 고정 문구만
  onboarding: "marked" | "kept" | "failed" | null; // 로그인 뒤 .claude.json 온보딩 칸
}

const OK_HOSTS = ["claude.com", "claude.ai", "anthropic.com"];
const hostOk = (h: string) => OK_HOSTS.some((o) => h === o || h.endsWith(`.${o}`));

// 순수: 프로세스 출력 → 로그인 URL. https, Claude·Anthropic 호스트, /oauth/authorize 경로인 첫 것만
export function loginUrlOf(output: string): string | null {
  for (const m of output.matchAll(/https:\/\/[^\s"'<>`]+/g)) {
    try {
      const u = new URL(m[0]);
      if (u.protocol === "https:" && hostOk(u.hostname) && u.pathname.includes("/oauth/authorize")) return u.toString();
    } catch {}
  }
  return null;
}

// 순수: 붙여 넣은 코드 검사. 앞뒤 공백을 떼고, 코드 페이지가 주는 글자(영숫자·-·_·.·~·#)만, 8–2048자
export function codeOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim();
  return /^[A-Za-z0-9._~#-]{8,2048}$/.test(c) ? c : null;
}

// 순수: `claude --version` 출력 → "2.1.285"
export function versionOf(text: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(text)?.[1] ?? null;
}

// 순수: .claude.json 객체 → 온보딩 칸 셋을 합친 새 객체. 다른 칸은 그대로 둔다
export function onboardedOf(obj: Record<string, unknown>, version: string | null, trusted: readonly string[]): Record<string, unknown> {
  const projects = obj.projects && typeof obj.projects === "object" && !Array.isArray(obj.projects) ? (obj.projects as Record<string, unknown>) : {};
  const nextProjects: Record<string, unknown> = { ...projects };
  for (const p of trusted) {
    const cur = projects[p] && typeof projects[p] === "object" && !Array.isArray(projects[p]) ? (projects[p] as Record<string, unknown>) : {};
    nextProjects[p] = { ...cur, hasTrustDialogAccepted: true };
  }
  return { ...obj, hasCompletedOnboarding: true, ...(version ? { lastOnboardingVersion: version } : {}), projects: nextProjects };
}

// 순수: 이 폴더에서 LOGIN을 시작해도 되는가. 안 되면 사유
export function loginRefusal(folder: { dir: string; registered: boolean } | undefined, loggedIn: boolean | null, claudeDir = config.claudeDir): string | null {
  if (!folder || !folder.registered) return "등록된 ACCOUNT가 아님 — 먼저 ADD ACCOUNT나 등록 칸으로 등록한다";
  if (folder.dir === claudeDir) return "~/.claude는 여기서 로그인하지 않는다(지금 도는 세션들의 로그인이다)";
  if (loggedIn === true) return "이미 로그인됨";
  return null;
}

// ── 입출력 ──

const LOGIN_MS = 10 * 60_000; // 로그인을 기다리는 최대 시간
const EXIT_MS = 60_000; // 코드를 넘긴 뒤 프로세스가 끝나기를 기다리는 시간
const URL_WAIT_MS = 15_000; // 시작 뒤 URL이 나오기를 기다리는 시간
const OUT_CAP = 64 * 1024;

interface Job {
  view: LoginView;
  dir: string;
  child: ChildProcess;
  out: string; // 프로세스 출력(URL을 찾는 데만 쓴다. 화면·로그에 내보내지 않는다)
  exited: Promise<number | null>;
  timer: ReturnType<typeof setTimeout>;
}
const jobs = new Map<string, Job>(); // 라벨 → 진행 중이거나 막 끝난 LOGIN
const live = (j: Job | undefined) => !!j && (j.view.state === "starting" || j.view.state === "waiting-code" || j.view.state === "verifying");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fail = (j: Job, error: string) => {
  if (j.view.state === "done" || j.view.state === "failed") return;
  j.view = { ...j.view, state: "failed", error };
  clearTimeout(j.timer);
  if (j.child.exitCode === null) j.child.kill();
};

export const loginView = (label: string): LoginView | null => jobs.get(label)?.view ?? null;

export async function startLogin(label: string, now = new Date()): Promise<LoginView> {
  const running = jobs.get(label);
  if (live(running)) return running!.view; // 같은 폴더에 둘을 띄우지 않는다
  const folder = accountFolders().find((f) => f.label === label);
  const refusal = loginRefusal(folder, folder ? (await authStatusOf(folder.dir)).loggedIn : null);
  if (refusal) throw new AccountsError(refusal);
  const dir = folder!.dir;
  if (!existsSync(dir)) throw new AccountsError(`폴더가 없음: ${dir}`);

  const child = spawn(config.claudeBin, ["auth", "login", "--claudeai"], { env: cleanEnv(dir), stdio: ["pipe", "pipe", "pipe"] });
  const job: Job = {
    view: { label, state: "starting", url: null, startedAt: now.toISOString(), error: null, onboarding: null },
    dir,
    child,
    out: "",
    exited: new Promise((resolve) => child.once("close", (code) => resolve(code))),
    timer: setTimeout(() => fail(job, "10분이 지나 로그인을 멈춤 — 다시 LOGIN"), LOGIN_MS),
  };
  jobs.set(label, job);
  const onData = (b: Buffer) => {
    if (job.out.length < OUT_CAP) job.out += b.toString("utf8");
    if (!job.view.url) {
      const url = loginUrlOf(job.out);
      if (url && job.view.state === "starting") job.view = { ...job.view, state: "waiting-code", url };
    }
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  child.stdin?.on("error", () => {}); // 끝난 프로세스에 쓰다 난 EPIPE는 아래 결과로 알린다
  child.once("error", () => fail(job, "claude를 실행하지 못함"));
  void job.exited.then(() => {
    clearTimeout(job.timer);
    if (job.view.state === "starting" || job.view.state === "waiting-code") fail(job, "로그인 프로세스가 코드 없이 끝남 — 다시 LOGIN");
  });
  for (let waited = 0; waited < URL_WAIT_MS && job.view.state === "starting"; waited += 100) await sleep(100);
  if (job.view.state === "starting") fail(job, "로그인 URL이 나오지 않음");
  console.log(`[atc] account login started: ${label} (${job.view.state})`);
  return job.view;
}

export async function submitCode(label: string, raw: unknown): Promise<LoginView> {
  const job = jobs.get(label);
  if (!job || job.view.state !== "waiting-code") throw new AccountsError("코드를 기다리는 LOGIN이 없음 — 먼저 LOGIN");
  const code = codeOf(raw);
  if (!code) throw new AccountsError("코드 모양이 아님 — 코드 페이지의 글자를 그대로 붙여 넣는다");
  job.view = { ...job.view, state: "verifying" };
  job.child.stdin?.write(`${code}\n`); // 코드는 여기서만 쓰고 어디에도 남기지 않는다
  let t: ReturnType<typeof setTimeout> | undefined;
  const exited = await Promise.race([job.exited.then(() => true), new Promise<boolean>((r) => (t = setTimeout(() => r(false), EXIT_MS)))]);
  clearTimeout(t);
  if (!exited) job.child.kill();
  clearTimeout(job.timer);
  forgetAuthStatus();
  const auth = await authStatusOf(job.dir);
  if (auth.loggedIn !== true) {
    job.view = { ...job.view, state: "failed", error: "로그인되지 않음 — 코드가 틀렸거나 만료됐다. 다시 LOGIN" };
    console.log(`[atc] account login failed: ${label}`);
    return job.view;
  }
  const onboarding = await markOnboarded(job.dir);
  job.view = { ...job.view, state: "done", error: null, onboarding };
  console.log(`[atc] account login done: ${label} (onboarding ${onboarding})`);
  return job.view;
}

export function cancelLogin(label: string): boolean {
  const job = jobs.get(label);
  if (!job) return false;
  fail(job, "취소함");
  jobs.delete(label);
  return true;
}

const claudeVersion = (): Promise<string | null> =>
  new Promise((resolve) => execFile(config.claudeBin, ["--version"], { env: cleanEnv(), timeout: 10_000 }, (_e, stdout) => resolve(versionOf(String(stdout ?? "")))));

// 로그인된 폴더의 .claude.json에 온보딩 칸 셋(hasCompletedOnboarding, lastOnboardingVersion, 열린 AIRPORT 경로의 신뢰)만 합친다.
// 백업을 남기고 원자적으로 바꿔 쓴다. symlink이거나 JSON 객체가 아니면 건드리지 않는다
export async function markOnboarded(dir: string, now = new Date(), version?: string | null): Promise<"marked" | "kept" | "failed"> {
  const file = join(dir, ".claude.json");
  try {
    if (lstatSync(file).isSymbolicLink()) return "kept";
  } catch {} // 없으면 새로 만든다
  let obj: Record<string, unknown> = {};
  try {
    const d = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!d || typeof d !== "object" || Array.isArray(d)) return "failed";
    obj = d as Record<string, unknown>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") return "failed";
  }
  const trusted = loadRegistry()
    .entries.filter((a) => !a.closed && typeof a.path === "string" && a.path.startsWith("/"))
    .map((a) => a.path);
  const next = onboardedOf(obj, version === undefined ? await claudeVersion() : version, trusted);
  try {
    if (existsSync(file)) {
      const backup = `${file}.atc-bak-${now.toISOString().replace(/[:.]/g, "-")}`;
      copyFileSync(file, backup);
      chmodSync(backup, 0o600);
    }
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, file);
    return "marked";
  } catch {
    return "failed";
  }
}

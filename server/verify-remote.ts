// VERIFY GATE의 원격 실행(ATC-518): 고정된 검증 명령만 LAN 데스크톱에서 돌린다. 이 파일은 순수 계산만 둔다
// (명령 목록, 보낼 파일의 제외 목록, 어디서 돌릴지의 결정, 실패의 분류, 원격에서 돌릴 셸 글). 입출력은 verify-remote-run.ts.
// 데스크톱의 주소·사용자는 이 저장소 어디에도 없다: 저장소는 문 폴더의 `remote.json`이라는 이름만 안다(공개 저장소). config.ts는 가져오지 않는다.

import { createHash } from "node:crypto";

export const REMOTE_CONFIG_FILE = "remote.json"; // 문 폴더(~/.local/state/atc-gate/) 안. 주소·사용자·포트·열쇠 파일을 담는다 — 저장소에는 없다
export const REMOTE_LOST_EXIT = 76; // 원격에서 명령이 시작된 뒤 연결이 끊겨 결과를 모른다(시험 실패가 아니다). 75는 문의 기다림 한도
export const PROBE_SEC_DEFAULT = 3;
export const MAX_FILE_BYTES = 20_000_000; // 이보다 큰 파일은 보내지 않는다(소스가 아니다)

// 데스크톱에서 돌 수 있는 것은 이 목록의 정확히 같은 명령뿐이다. 낱말 하나라도 다르면 데스크톱으로 가지 않는다(여기서는 접두어 비교도 하지 않는다)
export const REMOTE_COMMANDS: readonly (readonly string[])[] = [
  ["npm", "test"],
  ["npx", "tsc", "--noEmit", "-p", "."],
  ["npx", "vite", "build"],
];

export const isRemoteCommand = (argv: readonly string[], list: readonly (readonly string[])[] = REMOTE_COMMANDS): boolean => list.some((c) => c.length === argv.length && c.every((w, i) => w === argv[i]));

export type LocalReason = "desktop-absent" | "transport-error" | "not-listed" | "switch-off";
export const LOCAL_REASONS: readonly LocalReason[] = ["desktop-absent", "transport-error", "not-listed", "switch-off"];

// ── 데스크톱 한 대의 접속 정보(문 폴더의 remote.json) ──
export interface RemoteTarget {
  host: string;
  user: string;
  port: number;
  identityFile: string | null;
}

// 인자로 들어가는 값이라 모양을 엄격히 본다: `-`로 시작하는 값이 ssh 옵션이 되지 않게(옵션 주입), 공백·따옴표·셸 글자는 모두 거절
const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$/;
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const KEYFILE_RE = /^(?:~\/|\/)[A-Za-z0-9._\/-]{1,200}$/;

export function parseRemoteTarget(raw: unknown): RemoteTarget | null {
  const f = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!f) return null;
  const { host, user } = f;
  if (typeof host !== "string" || !HOST_RE.test(host)) return null;
  if (typeof user !== "string" || !USER_RE.test(user)) return null;
  const port = f.port === undefined ? 22 : f.port;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  const key = f.identityFile;
  if (key !== undefined && key !== null && (typeof key !== "string" || !KEYFILE_RE.test(key) || key.includes(".."))) return null;
  return { host, user, port, identityFile: typeof key === "string" ? key : null };
}

// ssh에 줄 공통 인자. 비대화형(BatchMode)이고 호스트 열쇠는 이미 아는 것만(StrictHostKeyChecking=yes): 처음 보는 기계에는 붙지 않는다
export function sshArgs(t: RemoteTarget, connectTimeoutSec: number): string[] {
  const a = [
    "-T",
    "-o", "BatchMode=yes",
    "-o", `ConnectTimeout=${Math.max(1, Math.round(connectTimeoutSec))}`,
    "-o", "StrictHostKeyChecking=yes",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    "-p", String(t.port),
    "-l", t.user,
  ];
  if (t.identityFile) a.push("-i", t.identityFile);
  a.push("--", t.host);
  return a;
}

// ── 보낼 파일: 추적 + 추적하지 않는 소스(.gitignore 밖)에서 비밀이 될 수 있는 것을 뺀다 ──
// 왜 목록인가: `git ls-files -co --exclude-standard`는 .gitignore만 따른다. 실수로 추적·미추적 상태가 된 .env나 열쇠가 따라가지 않게 한 번 더 거른다.
const EXCLUDED_SEGMENTS = new Set([".git", "node_modules", ".ssh", ".aws", ".gnupg", ".local", ".config", ".claude-acct-1", ".claude-acct-2"]);
const EXCLUDED_BASENAME = [/^\.env(\..*)?$/, /^\.npmrc$/, /^\.netrc$/, /^\.pgpass$/, /^id_(rsa|dsa|ecdsa|ed25519)(\..*)?$/, /^.*\.(pem|key|p12|pfx|keystore)$/, /^credentials(\..*)?$/i, /^.*\.sqlite3?$/];
// 예외: 견본은 비밀이 아니다
const ALLOWED_BASENAME = [/^\.env\.example$/, /^\.env\.sample$/];

export function isExcluded(path: string): boolean {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return true;
  if (parts.includes("..") || path.startsWith("/")) return true;
  const base = parts[parts.length - 1];
  if (parts.slice(0, -1).some((p) => EXCLUDED_SEGMENTS.has(p)) || EXCLUDED_SEGMENTS.has(base)) return true;
  // 다른 STAND들과 로컬 설정: .claude/worktrees/, .claude/settings.local.json
  if (parts[0] === ".claude" && (parts[1] === "worktrees" || /^settings\.local\./.test(parts[1] ?? ""))) return true;
  if (ALLOWED_BASENAME.some((r) => r.test(base))) return false;
  return EXCLUDED_BASENAME.some((r) => r.test(base));
}

export function filterFiles(paths: readonly string[]): { kept: string[]; excluded: string[] } {
  const kept: string[] = [];
  const excluded: string[] = [];
  for (const p of paths) (isExcluded(p) ? excluded : kept).push(p);
  return { kept, excluded };
}

// `git ls-files -z` 출력을 경로 목록으로
export const splitZ = (out: string): string[] => out.split("\0").filter((s) => s !== "");

// 의존 설치 캐시의 열쇠: package-lock.json 내용. 데스크톱은 같은 lock이면 `npm ci`를 한 번만 한다
export const lockHash = (lockText: string): string => createHash("sha256").update(lockText).digest("hex").slice(0, 16);

// ── 어디서 돌릴지 ──
export type Route = { where: "desktop" } | { where: "local"; reason: LocalReason };

// 순서가 뜻이다: 스위치가 꺼졌으면 무엇이든 로컬(이유 switch-off), 목록에 없으면 로컬(not-listed), 접속 정보가 없으면 데스크톱이 없는 것으로 본다
// commands: 이 저장소에서 데스크톱으로 가도 되는 명령(ATC-526). atc 자신은 REMOTE_COMMANDS, 다른 저장소는 repos.json의 목록(없으면 빈 목록 = 늘 로컬)
export function routeOf(p: { remote: "on" | "off"; argv: readonly string[]; atRepoRoot: boolean; target: RemoteTarget | null; commands?: readonly (readonly string[])[] }): Route {
  if (p.remote === "off") return { where: "local", reason: "switch-off" };
  if (!isRemoteCommand(p.argv, p.commands ?? REMOTE_COMMANDS) || !p.atRepoRoot) return { where: "local", reason: "not-listed" }; // 저장소 맨 위가 아니면 npm이 다른 곳에서 돈다
  if (!p.target) return { where: "local", reason: "desktop-absent" };
  return { where: "desktop" };
}

// ── 실패의 분류 ──
// ssh는 원격 명령의 종료 코드를 그대로 돌려주지만, ssh 자신의 실패도 255다. 원격 셸이 시작 표(.atc-started)와 종료 표(.atc-exit)를 남기므로 255일 때 그것을 본다.
export interface RunEvidence {
  sshExit: number | null; // null: ssh가 신호로 끝났다
  status: { started: boolean; exit: number | null } | null; // 원격 표를 읽은 결과. 읽지 못했으면 null
}
export type RunVerdict = { kind: "ran"; exit: number } | { kind: "transport-before-start" } | { kind: "transport-lost" };

export function classifyRun(e: RunEvidence): RunVerdict {
  if (e.sshExit !== null && e.sshExit !== 255) return { kind: "ran", exit: e.sshExit };
  if (e.status && e.status.exit !== null) return { kind: "ran", exit: e.status.exit }; // 명령이 끝났고 그 코드가 255이거나 끝난 뒤 연결이 끊겼다
  if (e.status && !e.status.started) return { kind: "transport-before-start" };
  return { kind: "transport-lost" }; // 시작했거나 시작 여부를 모른다: 다시 돌리지 않는다(부작용이 겹칠 수 있다)
}

// 원격 표 읽기(`<시작 0|1> <종료 코드 또는 빈칸>`)
export function parseStatus(out: string): { started: boolean; exit: number | null } | null {
  const m = /^([01])(?: (\d{1,3}))?\s*$/.exec(out.trim());
  if (!m) return null;
  return { started: m[1] === "1", exit: m[2] === undefined ? null : Number(m[2]) };
}

// ── 원격에서 도는 셸 글(순수, 시험한다) ──
export const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const ID_RE = /^[a-z0-9-]{6,64}$/;
const HASH_RE = /^[0-9a-f]{16}$/;

export const newRunId = (now: number, pid: number, rand: string): string => `${now.toString(36)}-${pid}-${rand}`.toLowerCase().replace(/[^a-z0-9-]/g, "");
export const validRunId = (id: string): boolean => ID_RE.test(id);

const NVM = `[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; command -v node >/dev/null 2>&1 || exit 96`;
const BASE = `base="$HOME/atc-verify"`;

// 원격 셸을 부르는 한 줄: 로그인 셸에 스크립트를 통째로 넘긴다
export const remoteShell = (script: string): string => `bash -lc ${shq(script)}`;

// 1) 폴더 만들고 tar 풀기(tar는 stdin으로 온다)
export function extractScript(id: string): string {
  if (!validRunId(id)) throw new Error("bad run id");
  return `set -e; ${BASE}; mkdir -p "$base/runs/${id}" && cd "$base/runs/${id}" && tar -x`;
}

// 2) 준비: 빈 git 저장소(일부 시험이 git ls-files를 쓴다. 자격 증명·원격 없음), 의존은 lock 해시별 캐시에서 하드링크로
export function prepareScript(id: string, hash: string): string {
  if (!validRunId(id) || !HASH_RE.test(hash)) throw new Error("bad run id or hash");
  return [
    "set -e",
    NVM,
    BASE,
    `run="$base/runs/${id}"; deps="$base/deps/${hash}"; tmp="$base/deps/${hash}.tmp-${id}"`,
    `cd "$run"`,
    `git init -q . && git add -A`,
    `if [ ! -d "$deps/node_modules" ]; then mkdir -p "$tmp" && cp package.json package-lock.json "$tmp/" && (cd "$tmp" && npm ci --no-audit --no-fund >/dev/null 2>&1) && { mv "$tmp" "$deps" 2>/dev/null || rm -rf "$tmp"; }; fi`,
    `[ -d "$deps/node_modules" ] || exit 97`,
    `cp -al "$deps/node_modules" "$run/node_modules"`,
    // 오래된 실행 폴더와 의존 캐시 정리(이 폴더 안에서만)
    `find "$base/runs" -mindepth 1 -maxdepth 1 -mmin +1440 -exec rm -rf {} + 2>/dev/null || true`,
    `ls -1t "$base/deps" 2>/dev/null | grep -E '^[0-9a-f]{16}$' | tail -n +4 | while read d; do rm -rf "$base/deps/$d"; done || true`,
  ].join("; ");
}

// 3) 실행: 시작 표를 남기고, 명령은 ATC_GITHUB=off로, 끝나면 종료 표를 남기고 같은 코드로 끝낸다. 명령 낱말은 목록의 것뿐이라 따옴표로 감싼다
export function runScript(id: string, argv: readonly string[], commands: readonly (readonly string[])[] = REMOTE_COMMANDS): string {
  if (!validRunId(id)) throw new Error("bad run id");
  if (!isRemoteCommand(argv, commands)) throw new Error("command not on the remote list");
  return [NVM, BASE, `cd "$base/runs/${id}"`, `: > .atc-started`, `ATC_GITHUB=off ${argv.map(shq).join(" ")}`, `c=$?`, `echo "$c" > .atc-exit`, `exit "$c"`].join("; ");
}

// 4) 표 읽기
export function statusScript(id: string): string {
  if (!validRunId(id)) throw new Error("bad run id");
  return [BASE, `d="$base/runs/${id}"`, `s=0; [ -e "$d/.atc-started" ] && s=1`, `e=""; [ -e "$d/.atc-exit" ] && e=$(cat "$d/.atc-exit")`, `echo "$s $e"`].join("; ");
}

// 5) 치우기(이 실행의 폴더 하나)
export function cleanupScript(id: string): string {
  if (!validRunId(id)) throw new Error("bad run id");
  return `${BASE}; rm -rf "$base/runs/${id}"`;
}

// ── 짜 맞추기: 순서와 결정은 전송 수단(Transport)과 무관하다. 시험은 가짜 Transport로 돈다 ──
export interface RemoteTransport {
  probe(timeoutMs: number): Promise<boolean>; // 짧은 시간 안에 닿나
  sync(id: string, hash: string): Promise<{ ok: boolean; error?: string }>; // 보내고 준비한다
  run(id: string, argv: readonly string[]): Promise<{ sshExit: number | null }>; // 출력은 호출자의 stdout·stderr로 그대로 간다
  status(id: string): Promise<{ started: boolean; exit: number | null } | null>;
  cleanup(id: string): Promise<void>;
}

export type RemoteResult =
  | { where: "desktop"; exit: number; syncMs: number; ranMs: number }
  | { where: "desktop"; lost: true; exit: number; syncMs: number; ranMs: number } // 시작한 뒤 연결을 잃었다
  | { where: "local"; reason: "desktop-absent" | "transport-error"; syncMs: number; error?: string };

export async function runOnDesktop(p: { argv: readonly string[]; id: string; hash: string; transport: RemoteTransport; probeMs: number; now?: () => number }): Promise<RemoteResult> {
  const now = p.now ?? Date.now;
  const t = p.transport;
  if (!(await t.probe(p.probeMs))) return { where: "local", reason: "desktop-absent", syncMs: 0 };
  const s0 = now();
  const synced = await t.sync(p.id, p.hash).catch((e) => ({ ok: false, error: String((e as Error).message ?? e) }));
  const syncMs = now() - s0;
  if (!synced.ok) {
    await t.cleanup(p.id).catch(() => {});
    return { where: "local", reason: "transport-error", syncMs, error: synced.error };
  }
  const r0 = now();
  const ran = await t.run(p.id, p.argv).catch(() => ({ sshExit: 255 as number | null }));
  const ranMs = now() - r0;
  const verdict = classifyRun({ sshExit: ran.sshExit, status: ran.sshExit === 255 || ran.sshExit === null ? await t.status(p.id).catch(() => null) : null });
  if (verdict.kind === "ran") {
    await t.cleanup(p.id).catch(() => {});
    return { where: "desktop", exit: verdict.exit, syncMs, ranMs };
  }
  if (verdict.kind === "transport-before-start") {
    await t.cleanup(p.id).catch(() => {});
    return { where: "local", reason: "transport-error", syncMs };
  }
  return { where: "desktop", lost: true, exit: REMOTE_LOST_EXIT, syncMs, ranMs };
}

export const lostMessage = (): string =>
  `[atc verify-gate] lost the connection to the desktop after the command started; its result is unknown (exit ${REMOTE_LOST_EXIT}). This is not a test failure. The command was not re-run; run it again, or turn remote execution off in Settings.`;

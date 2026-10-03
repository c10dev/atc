// 다른 AIRPORT 저장소가 두 문(VERIFY GATE, BROWSER GATE)을 쓸 때의 순수 계산(ATC-526): 저장소 키, 저장소별 설정(repos.json), 허용 목록 비교, 저장소별 세기.
// 저장소는 파일 이름(repos.json)만 안다: 다른 저장소의 명령·데이터·DB 정보는 이 저장소 어디에도 없다(공개 저장소). 설정은 문 폴더(~/.local/state/atc-gate/, ATC_GATE_DIR)에 있다.
// config.ts는 가져오지 않는다(환경을 import 때 읽는다).

import { createHash } from "node:crypto";
import { basename, dirname } from "node:path";

export const REPOS_FILE = "repos.json"; // 문 폴더 안. 저장소 맨 위 폴더 이름을 열쇠로 하는 설정
export const UNKNOWN_REPO = "unknown"; // 기록에 repo가 없는 줄(이 기능 이전)이나 폴더 이름을 못 구한 실행
const MAX_COMMANDS = 20;
const MAX_WORDS = 20;
const MAX_WORD_LEN = 200;

// 저장소 키 = 저장소 맨 위 폴더 이름(전체 경로가 아니다). 워크트리·STAND도 본 저장소의 이름으로 센다:
// git의 공통 디렉터리(`.git`)가 있는 폴더의 이름을 쓰고, git이 아니면 작업 폴더 이름을 쓴다
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export function repoKeyOf(gitCommonDir: string | null, cwd: string): string {
  const fromGit = gitCommonDir && basename(gitCommonDir) === ".git" ? basename(dirname(gitCommonDir)) : gitCommonDir ? basename(gitCommonDir).replace(/\.git$/, "") : null;
  const name = fromGit || basename(cwd);
  return NAME_RE.test(name) ? name : UNKNOWN_REPO;
}

export interface RepoEntry {
  remoteCommands: string[][]; // 데스크톱에서 돌려도 되는 명령(낱말 하나까지 같아야 한다). 비밀이 필요 없는 것만 적는다
  browserExecutable: string | null; // 이 저장소의 Playwright가 감쌀 진짜 Chrome(절대 경로). 없으면 문 설정대로
}
export const emptyRepoEntry = (): RepoEntry => ({ remoteCommands: [], browserExecutable: null });

const parseCommands = (raw: unknown): string[][] => {
  if (!Array.isArray(raw)) return [];
  const out: string[][] = [];
  for (const c of raw.slice(0, MAX_COMMANDS)) {
    if (!Array.isArray(c) || c.length === 0 || c.length > MAX_WORDS) continue;
    if (!c.every((w) => typeof w === "string" && w !== "" && w.length <= MAX_WORD_LEN && !/[\0\n\r]/.test(w))) continue;
    out.push(c as string[]);
  }
  return out;
};

// repos.json: `{ "<폴더 이름>": { "remoteCommands": [["…"]], "browserExecutable": "/abs/chrome" } }`. 틀린 칸은 버린다(목록은 비는 쪽이 안전하다)
export function parseRepos(raw: unknown): Record<string, RepoEntry> {
  const f = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, RepoEntry> = {};
  for (const [name, v] of Object.entries(f)) {
    if (!NAME_RE.test(name) || !v || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    const exe = e.browserExecutable;
    out[name] = { remoteCommands: parseCommands(e.remoteCommands), browserExecutable: typeof exe === "string" && /^\/[^\0\n\r]{1,400}$/.test(exe) && !exe.split("/").includes("..") ? exe : null };
  }
  return out;
}

export const repoEntryOf = (repos: Record<string, RepoEntry>, key: string): RepoEntry => (Object.hasOwn(repos, key) ? repos[key] : emptyRepoEntry());

export const sameCommand = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((w, i) => w === b[i]);
export const commandAllowed = (list: readonly (readonly string[])[], argv: readonly string[]): boolean => list.some((c) => sameCommand(c, argv));

// 데스크톱 허용 목록: atc 자신은 문에 박힌 목록, 다른 저장소는 repos.json의 목록뿐이다(없거나 비면 하나도 없다 = 늘 로컬)
export function remoteListFor(isOwn: boolean, entry: RepoEntry, builtIn: readonly (readonly string[])[]): readonly (readonly string[])[] {
  return isOwn ? builtIn : entry.remoteCommands;
}

// 의존 설치 캐시의 열쇠: 저장소 키 + lock 내용(16자리 16진수). 저장소마다 캐시가 따로라 서로의 의존이 섞이지 않는다.
// atc 자신은 옛 열쇠(lock 내용만)를 그대로 써서 이미 만든 캐시를 쓴다
export function depsKey(repoKey: string, isOwn: boolean, lockText: string): string {
  const h = createHash("sha256");
  if (!isOwn) h.update(`${repoKey}\0`);
  return h.update(lockText).digest("hex").slice(0, 16);
}

// ── 저장소별 세기: 전체와 최근 7일의 실행 수 ──
export interface RepoCount {
  repo: string;
  total: number;
  last7d: number;
}
export function repoCounts(runs: readonly { t: string; repo?: string }[], nowMs: number): RepoCount[] {
  const since = nowMs - 7 * 86_400_000;
  const m = new Map<string, RepoCount>();
  for (const r of runs) {
    const repo = r.repo && NAME_RE.test(r.repo) ? r.repo : UNKNOWN_REPO;
    const c = m.get(repo) ?? { repo, total: 0, last7d: 0 };
    c.total += 1;
    if (Date.parse(r.t) >= since) c.last7d += 1;
    m.set(repo, c);
  }
  return [...m.values()].sort((a, b) => b.total - a.total || a.repo.localeCompare(b.repo));
}

// VERIFY GATE 원격 실행의 입출력(ATC-518): ssh·tar를 부르는 Transport와 접속 정보 읽기. 결정과 셸 글은 verify-remote.ts(순수).
// 비밀은 보내지 않는다: 파일 목록은 `git ls-files -co --exclude-standard`에서 제외 목록(isExcluded)을 한 번 더 거른 것뿐이고, .git은 아예 보내지 않는다(데스크톱에서 빈 저장소를 새로 만든다).
// 데스크톱에서 돌려받는 것은 명령의 출력(stdout·stderr)과 종료 코드뿐이고 호출자의 STAND에는 아무것도 쓰지 않는다.

import { execFileSync, spawn } from "node:child_process";
import { lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type RepoEntry, REPOS_FILE, parseRepos, repoKeyOf } from "./gate-repo.ts";
import {
  ABSENT_MARK_FILE,
  cleanupScript,
  extractScript,
  filterFiles,
  MAX_FILE_BYTES,
  parseAbsentMark,
  parseRemoteTarget,
  parseStatus,
  prepareScript,
  REMOTE_CONFIG_FILE,
  type RemoteTarget,
  type RemoteTransport,
  REMOTE_COMMANDS,
  remoteShell,
  runScript,
  skipProbe,
  splitZ,
  sshArgs,
  statusScript,
} from "./verify-remote.ts";

export function readRemoteTarget(gateDir: string): RemoteTarget | null {
  try {
    return parseRemoteTarget(JSON.parse(readFileSync(join(gateDir, REMOTE_CONFIG_FILE), "utf8")));
  } catch {
    return null;
  }
}

// 저장소별 설정(문 폴더의 repos.json, ATC-526). 없거나 틀리면 빈 설정 = 다른 저장소는 늘 로컬 줄에서
export function readRepos(gateDir: string): Record<string, RepoEntry> {
  try {
    return parseRepos(JSON.parse(readFileSync(join(gateDir, REPOS_FILE), "utf8")));
  } catch {
    return {};
  }
}

const commonDirOf = (cwd: string): string | null => {
  try {
    return execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
};

// 부른 곳이 어느 저장소인가: key는 맨 위 폴더 이름, isOwn은 이 문이 들어 있는 저장소(atc)인지(워크트리도 같은 공통 .git이라 own)
export function repoContext(cwd: string): { key: string; isOwn: boolean } {
  const common = commonDirOf(cwd);
  const own = commonDirOf(dirname(fileURLToPath(import.meta.url)));
  return { key: repoKeyOf(common, cwd), isOwn: common !== null && own !== null && common === own };
}

// 데스크톱이 없다고 본 시각의 기억(ATC-524). 읽다 틀리면 null이라 probe한다(fail-open). 주소는 담지 않고 시각만 담는다
export function readAbsentMark(gateDir: string): number | null {
  try {
    return parseAbsentMark(readFileSync(join(gateDir, ABSENT_MARK_FILE), "utf8"));
  } catch {
    return null;
  }
}
export function writeAbsentMark(gateDir: string, nowMs: number): void {
  try {
    const tmp = join(gateDir, `${ABSENT_MARK_FILE}.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify({ at: nowMs }));
    renameSync(tmp, join(gateDir, ABSENT_MARK_FILE));
  } catch {
    // 못 쓰면 기억만 없다: 다음 실행이 probe한다
  }
}
export function clearAbsentMark(gateDir: string): void {
  try {
    unlinkSync(join(gateDir, ABSENT_MARK_FILE));
  } catch {
    // 없으면 됐다
  }
}

// runOnDesktop에 넘길 기억 손잡이(ATC-524): window 안이면 probe를 건너뛰고, 닿으면 지우고, 없으면 적는다. absentMs가 0이면 읽지도 쓰지도 않는다
export function absentMemory(gateDir: string, absentMs: number, now: () => number = Date.now): { skipProbe: boolean; onProbe: (present: boolean) => void } {
  if (absentMs <= 0) return { skipProbe: false, onProbe: () => {} };
  return {
    skipProbe: skipProbe(readAbsentMark(gateDir), now(), absentMs),
    onProbe: (present) => (present ? clearAbsentMark(gateDir) : writeAbsentMark(gateDir, now())),
  };
}

// 지금 작업 폴더가 저장소 맨 위인가(npm test는 그곳에서 돈다)
export function atRepoRoot(cwd: string): boolean {
  try {
    return execFileSync("git", ["rev-parse", "--show-prefix"], { cwd, encoding: "utf8" }).trim() === "";
  } catch {
    return false;
  }
}

// 보낼 파일(상대 경로): 추적 + 미추적 소스에서 제외 목록과 너무 큰 것, 없어진 것을 뺀다
export function filesToSend(cwd: string): string[] {
  const listed = splitZ(execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd, encoding: "utf8", maxBuffer: 64_000_000 }));
  return filterFiles(listed).kept.filter((p) => {
    try {
      const st = lstatSync(join(cwd, p));
      return (st.isFile() || st.isSymbolicLink()) && st.size <= MAX_FILE_BYTES;
    } catch {
      return false; // 지워진 추적 파일
    }
  });
}

const collect = (c: ReturnType<typeof spawn>, limit = 4000): Promise<{ code: number | null; out: string }> =>
  new Promise((resolve) => {
    let out = "";
    c.stdout?.on("data", (b: Buffer) => (out = (out + b.toString()).slice(-limit)));
    c.stderr?.on("data", (b: Buffer) => (out = (out + b.toString()).slice(-limit)));
    c.on("error", () => resolve({ code: 255, out }));
    c.on("close", (code) => resolve({ code, out }));
  });

export interface SshTransportOptions {
  target: RemoteTarget;
  cwd: string; // 저장소 맨 위
  connectTimeoutSec: number;
  commands?: readonly (readonly string[])[]; // 이 저장소의 허용 목록(ATC-526). 없으면 atc의 세 명령
  onChild?: (c: ReturnType<typeof spawn> | null) => void; // 신호가 오면 부른 쪽이 ssh를 죽일 수 있게
}

export function sshTransport(o: SshTransportOptions): RemoteTransport {
  const base = sshArgs(o.target, o.connectTimeoutSec);
  const ssh = (script: string, stdio: ("pipe" | "inherit" | "ignore")[]) => spawn("ssh", [...base, remoteShell(script)], { stdio });
  return {
    async probe(timeoutMs) {
      const c = spawn("ssh", [...sshArgs(o.target, Math.max(1, Math.ceil(timeoutMs / 1000))), "true"], { stdio: ["ignore", "ignore", "ignore"] });
      // ConnectTimeout 말고도 하드 타이머: 연결은 됐는데 응답이 없는 경우에도 오래 매달리지 않는다
      const timer = setTimeout(() => c.kill("SIGKILL"), timeoutMs + 1000);
      const { code } = await collect(c);
      clearTimeout(timer);
      return code === 0;
    },
    async sync(id, hash) {
      const files = filesToSend(o.cwd);
      const tar = spawn("tar", ["-c", "--no-recursion", "--null", "-T", "-"], { cwd: o.cwd, stdio: ["pipe", "pipe", "pipe"] });
      const up = ssh(extractScript(id), ["pipe", "ignore", "pipe"]);
      tar.stdin?.on("error", () => {});
      up.stdin?.on("error", () => {});
      tar.stdout?.pipe(up.stdin!);
      tar.stdin?.end(files.join("\0") + "\0");
      const [t, u] = await Promise.all([collect(tar), collect(up)]);
      if (t.code !== 0 || u.code !== 0) return { ok: false, error: `upload failed (tar ${t.code}, ssh ${u.code}): ${(u.out || t.out).slice(-300)}` };
      const prep = ssh(prepareScript(id, hash), ["ignore", "pipe", "pipe"]);
      const p = await collect(prep, 800);
      return p.code === 0 ? { ok: true } : { ok: false, error: `prepare failed (exit ${p.code}): ${p.out.slice(-300)}` };
    },
    run(id, argv) {
      return new Promise((resolve) => {
        const c = ssh(runScript(id, argv, o.commands ?? REMOTE_COMMANDS), ["ignore", "inherit", "inherit"]); // 출력은 부른 쪽의 stdout·stderr로 그대로
        o.onChild?.(c);
        c.on("error", () => resolve({ sshExit: 255 }));
        c.on("close", (code) => {
          o.onChild?.(null);
          resolve({ sshExit: code });
        });
      });
    },
    async status(id) {
      const r = await collect(ssh(statusScript(id), ["ignore", "pipe", "pipe"]), 200);
      return r.code === 0 ? parseStatus(r.out) : null;
    },
    async cleanup(id) {
      await collect(ssh(cleanupScript(id), ["ignore", "pipe", "pipe"]), 200);
    },
  };
}

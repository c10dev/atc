// VERIFY GATE 원격 실행의 입출력(ATC-518): ssh·tar를 부르는 Transport와 접속 정보 읽기. 결정과 셸 글은 verify-remote.ts(순수).
// 비밀은 보내지 않는다: 파일 목록은 `git ls-files -co --exclude-standard`에서 제외 목록(isExcluded)을 한 번 더 거른 것뿐이고, .git은 아예 보내지 않는다(데스크톱에서 빈 저장소를 새로 만든다).
// 데스크톱에서 돌려받는 것은 명령의 출력(stdout·stderr)과 종료 코드뿐이고 호출자의 STAND에는 아무것도 쓰지 않는다.

import { execFileSync, spawn } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cleanupScript,
  extractScript,
  filterFiles,
  MAX_FILE_BYTES,
  parseRemoteTarget,
  parseStatus,
  prepareScript,
  REMOTE_CONFIG_FILE,
  type RemoteTarget,
  type RemoteTransport,
  remoteShell,
  runScript,
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
        const c = ssh(runScript(id, argv), ["ignore", "inherit", "inherit"]); // 출력은 부른 쪽의 stdout·stderr로 그대로
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

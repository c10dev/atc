#!/usr/bin/env node
// ATC-452: Claude Code cloud 세션(CLAUDE_CODE_REMOTE=true)이 시작할 때 Node 24와 npm ci를 첫 턴 전에 갖춘다.
// 로컬(CLAUDE_CODE_REMOTE 없음)에서는 아무것도 하지 않고 exit 0. 어떤 실패도 세션을 막지 않는다(항상 exit 0).
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const NODE_VERSION = "24.19.0";
const ARCH = { x64: "x64", arm64: "arm64" };

export const nodeUrl = (version = NODE_VERSION, arch = process.arch) =>
  `https://nodejs.org/dist/v${version}/node-v${version}-linux-${ARCH[arch] ?? "x64"}.tar.xz`;

// 지금 PATH의 node major. 못 읽으면 0
const majorOf = (exec, env) => {
  const r = exec("node", ["-v"], { env });
  const m = /^v(\d+)\./.exec(String(r.stdout ?? "").trim());
  return r.status === 0 && m ? Number(m[1]) : 0;
};

const realExec = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts });

// 다운로드와 npm ci는 주입할 수 있다(시험이 막아 둔다). 돌려주는 값은 한 일의 목록
export const setup = ({
  env = process.env,
  cwd = env.CLAUDE_PROJECT_DIR || process.cwd(),
  home = homedir(),
  exec = realExec,
  download = (url, dir) => {
    mkdirSync(dir, { recursive: true });
    const r = exec("sh", ["-c", `curl -fsSL "${url}" | tar -xJ -C "${dir}" --strip-components=1`]);
    if (r.status !== 0) throw new Error(`node download failed: ${url}`);
  },
  npmCi = (dir, penv) => {
    const r = exec("npm", ["ci", "--no-audit", "--no-fund"], { cwd: dir, env: penv });
    if (r.status !== 0) throw new Error("npm ci failed");
  },
} = {}) => {
  const done = [];
  if (env.CLAUDE_CODE_REMOTE !== "true") return done;
  const penv = { ...env };
  if (majorOf(exec, penv) < 24) {
    const dir = join(home, ".cache", "atc-node", `v${NODE_VERSION}`);
    const bin = join(dir, "bin");
    if (!existsSync(join(bin, "node"))) {
      download(nodeUrl(), dir);
      done.push("node");
    }
    penv.PATH = `${bin}:${penv.PATH ?? ""}`;
    // 이후 Bash 호출도 이 node를 쓰도록 세션 환경 파일에 남긴다
    if (env.CLAUDE_ENV_FILE) appendFileSync(env.CLAUDE_ENV_FILE, `export PATH="${bin}:$PATH"\n`);
    done.push("path");
  }
  if (!existsSync(join(cwd, "node_modules"))) {
    npmCi(cwd, penv);
    done.push("npm-ci");
  }
  return done;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const done = setup();
    if (done.length) console.error(`atc cloud-setup: ${done.join(", ")}`);
  } catch (e) {
    console.error(`atc cloud-setup: ${e instanceof Error ? e.message : e}`);
  }
  process.exit(0);
}

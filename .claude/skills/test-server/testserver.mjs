#!/usr/bin/env node
// 시험 서버 수명주기(ATC-357): start → 확인 → stop을 한 곳에서 한다. 운영 7700과 운영 상태 폴더는 건드릴 수 없다.
//   node testserver.mjs start [--port N]   → JSON {url,port,dir,pid} 한 줄
//   node testserver.mjs stop <dir>         → 저장한 PID로만 끄고 임시 폴더·포트 잠금을 치운다
//   node testserver.mjs run [--port N] -- <명령…>  → 띄우고 명령을 돌리고(ATC_TEST_URL 제공) 무슨 일이 있어도 치운다
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export const PROD_PORT = 7700;
export const PORT_MIN = 7702;
export const PORT_MAX = 7799;
export const DIR_PREFIX = "atc-ts-";

export const prodStateDir = (home = homedir()) => join(home, ".local/state/atc");

// 순수: 이 포트와 상태 폴더로 시험 서버를 띄워도 되나. 안 되면 사유 문자열, 되면 null.
export function refusal({ port, stateDir, home = homedir() }) {
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    return port === PROD_PORT ? `port ${PROD_PORT} is production; refused` : `port ${port} is outside ${PORT_MIN}-${PORT_MAX}; refused`;
  }
  if (stateDir !== undefined) {
    const real = resolve(stateDir);
    const prod = prodStateDir(home);
    if (real === prod || real.startsWith(prod + sep) || prod.startsWith(real + sep)) return `state folder ${stateDir} is or contains the production state folder; refused`;
    if (!real.startsWith(resolve(tmpdir()) + sep) || !real.split(sep).pop().startsWith(DIR_PREFIX)) return `state folder must be a ${DIR_PREFIX}* folder under ${tmpdir()}; refused`;
  }
  return null;
}

// 순수: /proc/<pid>/environ 문자열(NUL 구분)이 이 시험 서버의 것인가. 엉뚱한 PID를 죽이지 않으려는 확인.
export function environMatches(environ, { port, dir }) {
  const kv = new Set(environ.split("\0"));
  return kv.has(`ATC_PORT=${port}`) && kv.has(`ATC_STATE_DIR=${dir}`);
}

// 순수: 서버 자식의 환경. .env.local 값(dotenv)은 여기에만 들어간다
export function serverEnv(base, dotenv, { dir, port }) {
  return { ...base, ...dotenv, ATC_GITHUB: "off", ATC_STATE_DIR: dir, ATC_PORT: String(port), XDG_CACHE_HOME: join(dir, "cache") };
}

// 순수: 확인 명령의 환경. 서버 비밀(.env.local)은 넣지 않는다
export function checkEnv(base, { url, port }) {
  return { ...base, ATC_TEST_URL: url, ATC_TEST_PORT: String(port) };
}

// process.env를 건드리지 않고 .env.local을 읽는다. 값은 출력하지 않는다
function readDotenv() {
  try {
    return parseEnv(readFileSync(join(homedir(), "projects/atc/.env.local"), "utf8"));
  } catch {
    return {};
  }
}

const lockRoot = () => join(tmpdir(), "atc-ts-ports");
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function canBind(port) {
  return new Promise((ok) => {
    const s = createServer();
    s.once("error", () => ok(false));
    s.listen(port, "127.0.0.1", () => s.close(() => ok(true)));
  });
}

// 포트 잠금: mkdir은 원자적이라 두 FLIGHT가 같은 포트를 동시에 잡지 못한다. 잠근 쪽이 죽었으면 낡은 잠금은 걷는다.
async function claimPort(wanted) {
  mkdirSync(lockRoot(), { recursive: true });
  const candidates = wanted ? [wanted] : Array.from({ length: PORT_MAX - PORT_MIN + 1 }, (_, i) => PORT_MIN + i);
  for (const port of candidates) {
    const lock = join(lockRoot(), String(port));
    try {
      mkdirSync(lock);
    } catch {
      let owner = 0;
      try {
        owner = Number(readFileSync(join(lock, "owner"), "utf8"));
      } catch {}
      if (owner && alive(owner)) continue;
      rmSync(lock, { recursive: true, force: true });
      try {
        mkdirSync(lock);
      } catch {
        continue;
      }
    }
    writeFileSync(join(lock, "owner"), String(process.pid));
    if (await canBind(port)) return port;
    rmSync(lock, { recursive: true, force: true });
  }
  throw new Error(wanted ? `port ${wanted} is busy` : "no free test port");
}

const releasePort = (port) => rmSync(join(lockRoot(), String(port)), { recursive: true, force: true });

async function waitUp(url, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(`${url}/api/version`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`test server did not come up at ${url}`);
}

const openLog = (dir) => openSync(join(dir, "server.log"), "a");

export async function start({ port: wanted } = {}) {
  if (wanted !== undefined) {
    const why = refusal({ port: wanted });
    if (why) throw Object.assign(new Error(why), { refused: true });
  }
  const port = await claimPort(wanted);
  let dir;
  try {
    dir = mkdtempSync(join(tmpdir(), DIR_PREFIX));
  } catch (e) {
    releasePort(port); // 폴더를 못 만들면 잠금만 치운다
    throw e;
  }
  try {
    const why = refusal({ port, stateDir: dir });
    if (why) throw Object.assign(new Error(why), { refused: true });
    for (const f of ["airports.json", "fleet.json"]) {
      const src = join(prodStateDir(), f);
      if (existsSync(src)) cpSync(src, join(dir, f)); // 읽기만. 필요한 등록부만 복사한다
    }
    const root = realpathSync(resolve(fileURLToPath(new URL("../../..", import.meta.url))));
    const child = spawn("node", ["server/index.ts"], {
      cwd: root,
      detached: true,
      stdio: ["ignore", openLog(dir), openLog(dir)],
      env: serverEnv(process.env, readDotenv(), { dir, port }),
    });
    child.unref();
    writeFileSync(join(lockRoot(), String(port), "owner"), String(child.pid)); // CLI가 끝나도 서버가 살아 있는 동안 잠금이 유지된다
    writeFileSync(join(dir, "server.pid"), String(child.pid));
    writeFileSync(join(dir, "meta.json"), JSON.stringify({ port, pid: child.pid, owner: process.pid }));
    const url = `http://127.0.0.1:${port}`;
    await waitUp(url);
    return { url, port, dir, pid: child.pid };
  } catch (e) {
    try {
      await stop(dir, { port });
    } catch {} // 정리 오류가 원래 오류를 가리지 않게 한다
    throw e;
  }
}

export async function stop(dir, { port } = {}) {
  const real = resolve(dir);
  const why = refusal({ port: port ?? PORT_MIN, stateDir: real });
  if (why) throw Object.assign(new Error(why), { refused: true });
  let meta = {};
  try {
    meta = JSON.parse(readFileSync(join(real, "meta.json"), "utf8"));
  } catch {}
  let pid = 0;
  try {
    pid = Number(readFileSync(join(real, "server.pid"), "utf8"));
  } catch {}
  const p = meta.port ?? port;
  if (pid && alive(pid)) {
    let env = "";
    try {
      env = readFileSync(`/proc/${pid}/environ`, "latin1");
    } catch {}
    if (!environMatches(env, { port: p, dir: real })) throw new Error(`pid ${pid} is not the test server for ${real}; left alone`);
    process.kill(pid, "SIGTERM"); // PID만. 이름·패턴으로 죽이지 않는다
    for (let i = 0; i < 50 && alive(pid); i++) await new Promise((r) => setTimeout(r, 100));
    if (alive(pid)) process.kill(pid, "SIGKILL");
  }
  if (p) releasePort(p);
  rmSync(real, { recursive: true, force: true });
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  const flag = (n) => {
    const i = rest.indexOf(n);
    return i >= 0 ? Number(rest[i + 1]) : undefined;
  };
  try {
    if (cmd === "start") {
      console.log(JSON.stringify(await start({ port: flag("--port") })));
    } else if (cmd === "stop") {
      if (!rest[0]) throw new Error("usage: stop <dir>");
      await stop(rest[0]);
      console.log(`stopped and removed ${rest[0]}`);
    } else if (cmd === "run") {
      const at = rest.indexOf("--");
      if (at < 0 || at === rest.length - 1) throw new Error("usage: run [--port N] -- <command…>");
      const s = await start({ port: flag("--port") });
      let code = 1;
      try {
        code = await new Promise((ok) => {
          const c = spawn(rest[at + 1], rest.slice(at + 2), { stdio: "inherit", env: checkEnv(process.env, s) });
          c.on("exit", (n) => ok(n ?? 1));
          c.on("error", () => ok(127));
        });
      } finally {
        await stop(s.dir, { port: s.port });
        console.error(`cleaned up ${s.dir} (port ${s.port}, pid ${s.pid})`);
      }
      process.exitCode = code;
    } else {
      throw new Error("usage: start [--port N] | stop <dir> | run [--port N] -- <command…>");
    }
  } catch (e) {
    console.error(`testserver: ${e.message}`);
    process.exitCode = e.refused ? 2 : 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) await main(process.argv.slice(2));

// PermissionRequest hook: AIRCRAFT 세션은 사람에게 도구 승인을 묻지 않는다(ATC-369). 프롬프트가 뜰 호출은 이 hook이 정한다.
// - 허용: AIRCRAFT의 STAND(`<repo>/.claude/worktrees/<이름>` 또는 `…/projects/worktrees/<이름>`) 안의 알려진 안전한 동작
// - 거절: 그 밖의 전부. Claude 설정 폴더(~/.claude*)·`.git`·STAND 밖 쓰기·운영 7700 쓰기·다른 팀 세션 메시지 …
// - 거절은 모두 `<state>/policy-denials.jsonl`에 한 줄: 시각·AIRCRAFT·세션·도구·분류(class). 명령·경로의 본문은 남기지 않는다
// atc 서버가 `claude --bg --settings`로 모든 AIRCRAFT LAUNCH에 싣는다(server/policy-hook.ts). 관제 세션과 기존 guard·hook은 건드리지 않는다.
// fail-closed: 입력을 못 읽거나 해석이 깨지면 거절한다. 이 hook이 모든 호출을 거절·허용하는 보안 경계는 아니다 —
// STAND 안에서 node·npm이 도는 것은 지금까지와 같은 신뢰이고, 여기서 정하는 것은 "사람을 기다리지 않고 알려진 것만 하고 나머지는 거절"이다.
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { simpleCommands } from "./shell.mjs";

const HOME = homedir();
export const DENIAL_FILE = "policy-denials.jsonl";

// ── 경로 ──
const STAND_RE = [/^(.*?\/\.claude\/worktrees\/[^/]+)(?:\/|$)/, /^(\/home\/[^/]+\/projects\/worktrees\/[^/]+)(?:\/|$)/];
export function standOf(cwd) {
  if (typeof cwd !== "string") return null;
  for (const re of STAND_RE) {
    const m = cwd.match(re);
    if (m) return m[1];
  }
  return null;
}

const expandHome = (p) => p.replace(/^~(?=\/|$)/, HOME).replace(/^\$\{?HOME\}?(?=\/|$)/, HOME);
const within = (p, root) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

// 있는 가장 가까운 윗길을 realpath로 풀어 심볼릭 링크로 STAND를 빠져나가지 못하게 한다
function real(p) {
  let head = p;
  const tail = [];
  while (head !== "/" && !existsSync(head)) {
    tail.unshift(basename(head));
    head = dirname(head);
  }
  let base = head;
  try {
    base = realpathSync(head);
  } catch {}
  return tail.length ? join(base, ...tail) : base;
}

const JOB_TMP_RE = /^\/home\/[^/]+\/\.claude[^/]*\/jobs\/[0-9a-f]+\/tmp(?:\/|$)/;
const CONFIG_RE = /^\/home\/[^/]+\/\.claude[^/]*(?:\/|$)/;
const CONFIG_READ_OK = /^\/home\/[^/]+\/\.claude[^/]*\/(?:skills|plugins)\//;
const SECRET_RE = /(?:^|\/)(?:\.env[^/]*|\.ssh|\.aws|\.gnupg|\.netrc|id_[a-z0-9]+)(?:\/|$)/;
const LOCAL_READ_RE = /^\/home\/[^/]+\/projects\//;

// 경로 하나를 쓰기용으로 분류한다. {ok, cls}
export function writeClass(raw, cwd, stand) {
  if (typeof raw !== "string" || !raw || /[`$]/.test(raw.replace(/^\$\{?HOME\}?/, ""))) return { ok: false, cls: "unresolved-path" };
  const p = real(resolve(typeof cwd === "string" ? cwd : "/", expandHome(raw)));
  if (p === "/dev/null") return { ok: true, cls: "dev-null" };
  if (JOB_TMP_RE.test(p)) return { ok: true, cls: "job-tmp" };
  if (CONFIG_RE.test(p)) return { ok: false, cls: "claude-config" };
  if (stand && within(p, real(stand))) {
    const rel = p.slice(real(stand).length);
    if (/(?:^|\/)\.git(?:\/|$)/.test(rel)) return { ok: false, cls: "git-dir" };
    return { ok: true, cls: "stand" };
  }
  return { ok: false, cls: stand ? "outside-stand" : "no-stand" };
}

// 읽기용: 프로젝트 폴더·STAND·job tmp·Claude 설정의 skills·plugins·playwright 스크린샷. 비밀·Claude 설정의 나머지는 거절
export function readClass(raw, cwd, stand) {
  if (typeof raw !== "string" || !raw || /[`$]/.test(raw.replace(/^\$\{?HOME\}?/, ""))) return { ok: false, cls: "unresolved-path" };
  const p = real(resolve(typeof cwd === "string" ? cwd : "/", expandHome(raw)));
  if (JOB_TMP_RE.test(p)) return { ok: true, cls: "job-tmp" };
  if (CONFIG_READ_OK.test(p)) return { ok: true, cls: "skills" };
  if (CONFIG_RE.test(p)) return { ok: false, cls: "claude-config" };
  if (SECRET_RE.test(p)) return { ok: false, cls: "secret" };
  if ((stand && within(p, real(stand))) || LOCAL_READ_RE.test(p) || within(p, "/tmp/playwright-mcp") || p.startsWith("/usr/") || p.startsWith("/etc/os-release") || p === "/dev/null") return { ok: true, cls: "read" };
  return { ok: false, cls: "outside-read" };
}

// ── Bash ──
const WRAPPERS = new Set(["env", "command", "nohup", "exec", "time", "builtin", "nice", "timeout", "if", "then", "else", "elif", "do", "while", "until", "!", "{", "}"]);
const BAD_ENV = new Set(["PATH", "LD_PRELOAD", "LD_LIBRARY_PATH", "NODE_OPTIONS", "BASH_ENV", "ENV", "SHELLOPTS", "PS4"]);
const READERS = new Set(["ls", "cat", "head", "tail", "wc", "grep", "rg", "egrep", "fgrep", "sort", "uniq", "cut", "tr", "diff", "cmp", "stat", "file", "du", "df", "date", "echo", "printf", "pwd", "true", "false", "test", "[", "[[", "which", "type", "basename", "dirname", "realpath", "readlink", "jq", "awk", "sleep", "seq", "ps", "nproc", "uname", "whoami", "id", "hostname", "column", "comm", "nl", "tac", "rev", "md5sum", "sha256sum", "xxd", "od", "less", "more", "sed", "find", "tsc", "vite", "python3", "node", "set", "unset", "export", "wait", "read", "local", "return", "exit", "cd", ":", "git", "npm", "npx", "curl", "gh", "cp", "mv", "rm", "mkdir", "touch", "tee", "chmod", "ln", "kill", "source", "."]);
const PATH_READERS = new Set(["cat", "head", "tail", "less", "more", "ls", "wc", "stat", "file", "du", "diff", "cmp", "sort", "uniq", "find", "nl", "tac", "rev", "xxd", "od", "md5sum", "sha256sum", "realpath", "readlink"]);
const NPM_OK = new Set(["test", "run", "ci", "install", "i", "ls", "view", "outdated", "exec", "pack", "prune", "rebuild", "start"]);
const NPX_OK = new Set(["tsc", "vite", "playwright", "tsx", "prettier", "eslint"]);
const GIT_OK = new Set(["status", "diff", "log", "show", "add", "commit", "push", "fetch", "pull", "merge", "rebase", "checkout", "switch", "branch", "restore", "rev-parse", "rev-list", "ls-files", "ls-tree", "cherry-pick", "apply", "remote", "blame", "show-ref", "merge-base", "diff-tree", "grep", "mv", "rm", "reset", "describe", "shortlog", "name-rev", "for-each-ref", "cat-file", "config", "tag", "notes", "stash", "worktree", "symbolic-ref", "update-index", "count-objects", "whatchanged", "range-diff", "check-ignore", "format-patch", "am", "revert", "version", "help", "ls-remote", "diff-index", "diff-files", "hash-object", "mktemp"]);
const GH_OK = new Set(["pr create", "pr view", "pr list", "pr checks", "pr diff", "pr status", "pr comment", "pr ready", "pr checkout", "run list", "run view", "issue view", "issue list", "repo view", "auth status"]);
const LOCAL_URL = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::(\d+))?(?:[/?#]|$)/i;

const deny = (cls) => ({ ok: false, cls });
const allow = (cls = "ok") => ({ ok: true, cls });

function subsOf(word) {
  const out = [];
  if (word.includes("`")) return null; // 백틱은 중첩을 못 믿는다
  for (let i = word.indexOf("$("); i >= 0; i = word.indexOf("$(", i + 2)) {
    let depth = 0;
    let j = i + 1;
    for (; j < word.length; j++) {
      if (word[j] === "(") depth++;
      else if (word[j] === ")" && --depth === 0) break;
    }
    out.push(word.slice(i + 2, j));
  }
  return out;
}

// 쓰기 대상이 될 수 있는 인자(옵션·`-` 제외)
const operands = (args) => args.filter((a) => !a.startsWith("-") || a === "-");

function gitVerdict(args, ctx) {
  let i = 0;
  let cwd = ctx.cwd;
  while (i < args.length && args[i].startsWith("-")) {
    const a = args[i];
    if (a === "-C") {
      const w = writeClass(args[i + 1], cwd, ctx.stand);
      if (!w.ok) return deny(`git-C:${w.cls}`);
      cwd = resolve(cwd, expandHome(args[i + 1]));
      i += 2;
    } else if (a === "-c") i += 2;
    else if (/^--(git-dir|work-tree|exec-path)/.test(a)) return deny("git-dir-override");
    else i++;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (!sub) return allow();
  if (!GIT_OK.has(sub)) return deny(`git:${sub}`);
  if (sub === "clean") return deny("git:clean");
  if (sub === "stash" && !["list", "show", "apply", "drop"].includes(rest[0] ?? "")) return deny("git:stash");
  if (sub === "worktree" && !["list", "prune"].includes(rest[0] ?? "")) return deny("git:worktree");
  if (sub === "config" && !rest.some((a) => ["--get", "--get-all", "--list", "-l", "--get-regexp"].includes(a))) return deny("git:config-write");
  if (sub === "reset" && rest.includes("--hard") && !ctx.stand) return deny("git:reset-hard");
  if (sub === "push") {
    if (rest.some((a) => a === "--force" || a === "-f" || a === "--delete" || a === "-d" || a === "--mirror" || /^\+/.test(a) || (/^-[a-z]*f/.test(a) && !a.startsWith("--")))) return deny("git:force-push");
    if (rest.some((a) => /(^|:)(refs\/heads\/)?(main|master)$/.test(a))) return deny("git:push-main");
  }
  return allow("git");
}

function ghVerdict(args) {
  const sub = `${args[0] ?? ""} ${args[1] ?? ""}`.trim();
  if (GH_OK.has(sub)) return allow("gh");
  if (args[0] === "api") {
    const rest = args.slice(1);
    const x = rest.findIndex((a) => a === "-X" || a === "--method");
    const method = x >= 0 ? (rest[x + 1] ?? "").toUpperCase() : "GET";
    const endpoint = rest.find((a) => !a.startsWith("-") && a !== rest[x + 1]) ?? "";
    const hasBody = rest.some((a) => /^(-f|-F|--field|--raw-field|--input)$/.test(a));
    if (method === "GET" && !hasBody) return allow("gh-api-get");
    if (method === "PATCH" && /^repos\/[^/]+\/[^/]+\/pulls\/\d+$/.test(endpoint.replace(/^\//, ""))) return allow("gh-api-pr-edit"); // gh pr edit 대신(PR 본문)
    return deny("gh-api-write");
  }
  return deny(`gh:${sub || "?"}`);
}

function curlVerdict(args, ctx) {
  const urls = args.filter((a) => /^[a-z]+:\/\//i.test(a) || /^(localhost|127\.0\.0\.1)/.test(a));
  if (!urls.length) return deny("curl:no-url");
  for (const u of urls) {
    const full = /^[a-z]+:\/\//i.test(u) ? u : `http://${u}`;
    const m = full.match(LOCAL_URL);
    if (!m) return deny("curl:non-local");
    const writes = args.some((a, k) => /^(-X|--request)$/.test(a) && !/^GET$/i.test(args[k + 1] ?? "")) || args.some((a) => /^(-d|--data|--data-raw|--data-binary|--data-urlencode|-F|--form|-T|--upload-file|--json)/.test(a));
    if (writes && (m[1] ?? "80") === "7700") return deny("curl:prod-write"); // 운영 상태는 손대지 않는다
  }
  for (let k = 0; k < args.length; k++) {
    if (/^(-o|--output|--output-dir)$/.test(args[k])) {
      const w = writeClass(args[k + 1], ctx.cwd, ctx.stand);
      if (!w.ok) return deny(`curl-out:${w.cls}`);
    }
  }
  return allow("curl");
}

// 명령 한 줄(simpleCommands 하나) → {ok, cls}
function commandVerdict(words, ctx) {
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    const env = w.match(/^([A-Za-z_]\w*)=/);
    if (env) {
      if (BAD_ENV.has(env[1])) return deny("env:" + env[1]);
      i++;
    } else if (WRAPPERS.has(basename(w))) {
      i++;
      while (i < words.length && /^-/.test(words[i])) i++; // env -i, timeout -k …
      if (basename(w) === "timeout" && /^\d/.test(words[i] ?? "")) i++;
    } else break;
  }
  const core = words.slice(i);
  if (!core.length || (core.length === 1 && /^\d+$/.test(core[0]))) return allow(); // `2>&1`의 꼬리 "1"
  // 리다이렉션: `> file`, `>>file`, `2>file`. 쓰기 대상은 STAND 안이어야 한다
  const args = [];
  for (let k = 1; k < core.length; k++) {
    const w = core[k];
    const m = w.match(/^(\d*)(>>?|&>>?)(.*)$/);
    if (m) {
      let target = m[3];
      if (!target && /^\d*>$/.test(w) && k === core.length - 1) continue; // `2>&1`은 simpleCommands가 &에서 끊어 "2>"와 "1"로 나뉜다
      if (!target) target = core[++k];
      if (target && /^&\d+$/.test(target)) continue;
      const c = writeClass(target, ctx.cwd, ctx.stand);
      if (!c.ok) return deny(`redirect:${c.cls}`);
    } else if (/^\d*<</.test(w) || /^<\S*/.test(w)) continue; // heredoc·입력 리다이렉션은 읽기
    else if (/^\d*>&\d*$/.test(w) || /^\d>$/.test(w)) continue;
    else args.push(w);
  }
  const cmd = core[0];
  // 인자의 명령 치환은 안쪽 명령도 같은 규칙으로 본다(따옴표 안의 $(…)도)
  for (const w of [cmd, ...args]) {
    const subs = subsOf(w);
    if (subs === null) return deny("backtick-substitution");
    for (const s of subs) {
      const v = bashVerdict(s, ctx, ctx.depth + 1);
      if (!v.ok) return v;
    }
  }
  const name = basename(cmd);
  if (cmd.includes("/")) {
    const sysBin = /^\/(usr\/)?(local\/)?s?bin\//.test(cmd);
    const p = writeClass(cmd, ctx.cwd, ctx.stand);
    const nodeBin = /^\/home\/[^/]+\/\.nvm\//.test(cmd) || /\/node_modules\/\.bin\//.test(cmd);
    if (!sysBin && !nodeBin && !p.ok) return deny("exec-path");
    if (!sysBin && !nodeBin && !READERS.has(name)) return allow("stand-exec");
  }
  if (name === "bash" || name === "sh" || name === "zsh" || name === "eval" || name === "xargs" || name === "sudo" || name === "ssh" || name === "scp" || name === "systemctl" || name === "docker") return deny(`command:${name}`);
  if (!READERS.has(name)) return deny(`command:${name}`);
  // 읽기 인자: 읽기 명령은 비밀과 Claude 설정을 읽지 못하게(grep·rg의 패턴은 경로처럼 보여 뺀다)
  if (PATH_READERS.has(name)) {
    for (const a of operands(args)) {
      if (!/^(\/|~|\$\{?HOME|\.\.\/)/.test(a)) continue;
      const r = readClass(a, ctx.cwd, ctx.stand);
      if (!r.ok && !writeClass(a, ctx.cwd, ctx.stand).ok) return deny(`read:${r.cls}`);
    }
  }
  switch (name) {
    case "cd": {
      const t = operands(args).find((a) => a !== "-");
      if (t === undefined) return allow();
      const r = readClass(t, ctx.cwd, ctx.stand);
      if (!r.ok && !writeClass(t, ctx.cwd, ctx.stand).ok) return deny(`cd:${r.cls}`);
      ctx.cwd = resolve(ctx.cwd, expandHome(t));
      return allow("cd");
    }
    case "git":
      return gitVerdict(args, ctx);
    case "gh":
      return ghVerdict(args);
    case "curl":
      return curlVerdict(args, ctx);
    case "npm": {
      const sub = operands(args)[0];
      if (!sub || !NPM_OK.has(sub) || args.some((a) => a === "-g" || a === "--global")) return deny(`npm:${sub ?? "?"}`);
      return allow("npm");
    }
    case "npx": {
      const sub = operands(args)[0];
      return sub && NPX_OK.has(sub) ? allow("npx") : deny(`npx:${sub ?? "?"}`);
    }
    case "find":
      return args.some((a) => /^-(exec|execdir|ok|okdir|delete|fprint|fprintf|fls)$/.test(a)) ? deny("find:exec") : allow("find");
    case "sed": {
      const inplace = args.some((a) => /^-[a-zA-Z]*i/.test(a) || a === "--in-place" || a.startsWith("--in-place="));
      if (!inplace) return allow("sed");
      // 파일 인자: 첫 번째 비옵션은 스크립트
      const files = operands(args).slice(1);
      for (const f of files) {
        const c = writeClass(f, ctx.cwd, ctx.stand);
        if (!c.ok) return deny(`sed-i:${c.cls}`);
      }
      return allow("sed-i");
    }
    case "cp": {
      const ops = operands(args);
      const dest = ops[ops.length - 1];
      const c = writeClass(dest, ctx.cwd, ctx.stand);
      if (!c.ok) return deny(`cp:${c.cls}`);
      return allow("cp");
    }
    case "mv":
    case "rm":
    case "mkdir":
    case "touch":
    case "tee":
    case "chmod":
    case "ln": {
      const ops = operands(args).filter((a, k) => !(name === "chmod" && k === 0 && /^[+\-=augo0-7rwxXst,]+$/.test(a)));
      for (const p of ops) {
        const c = writeClass(p, ctx.cwd, ctx.stand);
        if (!c.ok) return deny(`${name}:${c.cls}`);
        if (name === "rm" && ctx.stand && real(resolve(ctx.cwd, expandHome(p))) === real(ctx.stand)) return deny("rm:stand-root");
      }
      return allow(name);
    }
    case "source":
    case ".": {
      const f = operands(args)[0] ?? "";
      return /^\/home\/[^/]+\/projects\/atc\/\.env\.local$/.test(f) ? allow("source-env") : deny("source");
    }
    case "kill":
      return allow("kill"); // 이름·패턴 kill은 hooks/kill-guard.mjs가 따로 막는다
    default:
      return allow(name);
  }
}

// 명령 문자열 전체. 하나라도 거절이면 거절
export function bashVerdict(command, ctx, depth = 0) {
  if (typeof command !== "string") return deny("no-command");
  if (depth > 3) return deny("nested-substitution");
  ctx.depth = depth;
  for (const words of simpleCommands(command)) {
    const v = commandVerdict(words, ctx);
    ctx.depth = depth;
    if (!v.ok) return v;
  }
  return allow("bash");
}

// ── 도구 ──
const FILE_WRITE = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const FILE_READ = new Set(["Read", "Glob", "Grep", "LS"]);
const FREE_TOOLS = new Set(["EnterWorktree", "ExitWorktree", "Skill", "Agent", "Task", "TaskCreate", "TaskUpdate", "TaskGet", "TaskList", "TaskStop", "TodoWrite", "ToolSearch", "WebSearch", "ScheduleWakeup", "Monitor", "ExitPlanMode", "EnterPlanMode", "ReportFindings", "SendFeedback", "AskUserQuestion"]);
const PLAYWRIGHT = /^mcp__(?:plugin_[a-z0-9-]+_)?playwright__/i;

// → {behavior: "allow"|"deny", cls}
export function decide(input) {
  const tool = input?.tool_name;
  const ti = input?.tool_input ?? {};
  const cwd = typeof input?.cwd === "string" ? input.cwd : "/";
  const stand = standOf(cwd);
  if (typeof tool !== "string") return { behavior: "deny", cls: "no-tool" };
  const v = (r) => ({ behavior: r.ok ? "allow" : "deny", cls: r.cls });
  if (FREE_TOOLS.has(tool)) return { behavior: "allow", cls: "free" };
  if (FILE_WRITE.has(tool)) return v(writeClass(ti.file_path ?? ti.notebook_path, cwd, stand));
  if (FILE_READ.has(tool)) {
    const p = ti.file_path ?? ti.path ?? cwd;
    return v(readClass(p, cwd, stand));
  }
  if (tool === "Bash") return v(bashVerdict(ti.command, { cwd, stand, depth: 0 }));
  if (tool === "SendMessage") return /^TEAM_/i.test(String(ti.to ?? "")) ? { behavior: "deny", cls: "message-other-team" } : { behavior: "allow", cls: "sendmessage" };
  if (PLAYWRIGHT.test(tool)) {
    if (/browser_navigate$/.test(tool) && !LOCAL_URL.test(String(ti.url ?? ""))) return { behavior: "deny", cls: "browser-non-local" };
    return { behavior: "allow", cls: "playwright" };
  }
  if (tool.startsWith("mcp__")) return { behavior: "deny", cls: "mcp" };
  if (tool === "WebFetch") return { behavior: "deny", cls: "web-fetch" };
  return { behavior: "deny", cls: `tool:${tool.slice(0, 40)}` };
}

export const DENY_MESSAGE = (cls) =>
  `ATC POLICY: denied (${cls}). No AIRCRAFT asks a person for a permission (ATC-369): this hook allows known-safe actions inside your STAND and denies the rest. ` +
  `Work only inside your STAND worktree (EnterWorktree name=<key>-<name>), use $CLAUDE_JOB_DIR/tmp for temporary files, never write to the Claude config dir or the production state. ` +
  `If you truly need this, report BLOCKED to the session that assigned the FLIGHT — do not retry the same call.`;

function record(dir, line) {
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, DENIAL_FILE), JSON.stringify(line) + "\n");
  } catch {}
}

function argOf(name) {
  const k = process.argv.indexOf(name);
  return k >= 0 ? (process.argv[k + 1] ?? null) : null;
}

function main() {
  const stateDir = argOf("--state");
  const aircraft = argOf("--aircraft");
  let input = null;
  let out;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
    out = decide(input);
  } catch (e) {
    out = { behavior: "deny", cls: "hook-error" };
  }
  if (out.behavior === "deny" && stateDir) {
    record(stateDir, { t: new Date().toISOString(), aircraft: aircraft ?? null, session: typeof input?.session_id === "string" ? input.session_id.slice(0, 36) : null, tool: typeof input?.tool_name === "string" ? input.tool_name.slice(0, 40) : null, cls: out.cls });
  }
  const decision = out.behavior === "allow" ? { behavior: "allow" } : { behavior: "deny", message: DENY_MESSAGE(out.cls) };
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision } }) + "\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

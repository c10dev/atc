// PermissionRequest hook: AIRCRAFT 세션은 사람에게 도구 승인을 묻지 않는다(ATC-369). 프롬프트가 뜰 호출은 이 hook이 정한다.
// - 허용: AIRCRAFT의 STAND(`<repo>/.claude/worktrees/<이름>` 또는 `…/projects/worktrees/<이름>`) 안의 알려진 안전한 동작
// - 거절: 그 밖의 전부. Claude 설정 폴더(~/.claude*)·`.git`·STAND 밖 쓰기·운영 7700 쓰기·다른 팀 세션 메시지 …
// - 거절은 모두 `<state>/policy-denials.jsonl`에 한 줄: 시각·AIRCRAFT·세션·도구·분류(class). 명령·경로의 본문은 남기지 않는다
// atc 서버가 `claude --bg --settings`로 모든 AIRCRAFT LAUNCH에 싣는다(server/policy-hook.ts). 관제 세션과 기존 guard·hook은 건드리지 않는다.
// fail-closed: 입력을 못 읽거나 해석이 깨지면 거절한다. 이 hook이 모든 호출을 거절·허용하는 보안 경계는 아니다 —
// STAND 안의 스크립트 파일을 node·npm이 도는 것은 지금까지와 같은 신뢰이고(인라인 코드 node -e·python3 -c와 awk는 거절), 여기서 정하는 것은 "사람을 기다리지 않고 알려진 것만 하고 나머지는 거절"이다.
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
const READERS = new Set(["ls", "cat", "head", "tail", "wc", "grep", "rg", "egrep", "fgrep", "sort", "uniq", "cut", "tr", "diff", "cmp", "stat", "file", "du", "df", "date", "echo", "printf", "pwd", "true", "false", "test", "[", "[[", "which", "type", "basename", "dirname", "realpath", "readlink", "jq", "sleep", "seq", "ps", "nproc", "uname", "whoami", "id", "hostname", "column", "comm", "nl", "tac", "rev", "md5sum", "sha256sum", "xxd", "od", "sed", "find", "tsc", "vite", "python3", "python", "node", "set", "unset", "export", "wait", "read", "local", "return", "exit", "cd", ":", "git", "npm", "npx", "curl", "gh", "cp", "mv", "rm", "mkdir", "touch", "tee", "chmod", "ln", "kill", "source", "."]);
const PATH_READERS = new Set(["cat", "head", "tail", "ls", "wc", "stat", "file", "du", "diff", "cmp", "sort", "uniq", "find", "nl", "tac", "rev", "xxd", "od", "md5sum", "sha256sum", "realpath", "readlink"]);
const NPM_OK = new Set(["test", "run", "ci", "install", "i", "ls", "view", "outdated", "exec", "pack", "prune", "rebuild", "start"]);
const NPX_OK = new Set(["tsc", "vite", "playwright", "tsx", "prettier", "eslint"]);
const GIT_OK = new Set(["status", "diff", "log", "show", "add", "commit", "push", "fetch", "pull", "merge", "rebase", "checkout", "switch", "branch", "restore", "rev-parse", "rev-list", "ls-files", "ls-tree", "cherry-pick", "apply", "remote", "blame", "show-ref", "merge-base", "diff-tree", "grep", "mv", "rm", "reset", "describe", "shortlog", "name-rev", "for-each-ref", "cat-file", "config", "tag", "notes", "stash", "worktree", "symbolic-ref", "update-index", "count-objects", "whatchanged", "range-diff", "check-ignore", "format-patch", "am", "revert", "version", "help", "ls-remote", "diff-index", "diff-files", "hash-object", "mktemp"]);
// 읽기만 하는 git 동사: STAND 밖(운영 폴더 포함)에서도 허용한다. 나머지는 상태를 바꾸므로 cwd가 AIRCRAFT의 STAND 안일 때만(ATC-369 검토, CLAUDE.md: 운영 폴더에서 브랜치를 바꾸지 않는다)
const GIT_READ = new Set(["status", "diff", "log", "show", "rev-parse", "rev-list", "ls-files", "ls-tree", "blame", "show-ref", "merge-base", "diff-tree", "grep", "describe", "shortlog", "name-rev", "for-each-ref", "cat-file"]);
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

// 읽기 명령이 파일로 여는 인자(옵션 제외). grep·rg·sed·jq의 첫 비옵션은 패턴·스크립트·필터라 뺀다(-e·--regexp·--expression이 있으면 그 값이 패턴)
const PATTERN_FIRST = new Set(["grep", "rg", "egrep", "fgrep", "sed", "jq"]);
const FILE_READERS = new Set([...PATH_READERS, "grep", "rg", "egrep", "fgrep", "sed", "jq", "cut", "comm", "column", "basename", "dirname", "node", "python3", "python"]);
function fileOperandsOf(name, args) {
  if (!FILE_READERS.has(name)) return [];
  if (name === "find") {
    const out = [];
    for (const a of args) {
      if (a.startsWith("-") || a === "(" || a === "!") break;
      out.push(a);
    }
    return out;
  }
  const out = [];
  let explicit = false;
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (/^(-e|--regexp|--expression)$/.test(a)) {
      explicit = true;
      k++; // 값은 패턴
    } else if (/^--(regexp|expression)=/.test(a)) explicit = true;
    else if (a.startsWith("-") && a !== "-") continue;
    else out.push(a);
  }
  if (PATTERN_FIRST.has(name) && !explicit) out.shift();
  return out;
}

// sed 스크립트의 w·W·e·E·r·R(파일 쓰기·읽기, 명령 실행)과 `s///w`·`s///e` 플래그는 STAND 규칙을 지킬 수 없다(ATC-369 검토): 쓰지 않는 스크립트만 허용한다.
// s///·y///의 본문과 /정규식/ 주소를 걷어 내고 남은 글에 그 글자가 있으면 거절한다. -f(스크립트 파일)는 내용을 모르니 거절
export function sedScriptUnsafe(script) {
  let t = String(script);
  t = t.replace(/s(.)(?:\\.|(?!\1)[^\n])*\1(?:\\.|(?!\1)[^\n])*\1([A-Za-z0-9]*)/g, (_m, _d, flags) => (/[weWE]/.test(flags) ? " W " : " s ")); // 플래그에 w·e가 있으면 남겨서 걸리게
  t = t.replace(/y(.)(?:\\.|(?!\1)[^\n])*\1(?:\\.|(?!\1)[^\n])*\1/g, " y ");
  t = t.replace(/\\(.)(?:\\.|(?!\1)[^\n])*\1/g, " "); // \cREGEXc 주소
  t = t.replace(/\/(?:\\.|[^/\\\n])*\//g, " "); // /REGEX/ 주소
  return /[wWeErR]/.test(t);
}

// jq의 파일 읽기: --rawfile·--slurpfile·--argfile·-f·-L, 필터의 import·include·$ENV·env·input_filename
export function jqUnsafe(args) {
  if (args.some((a) => /^(--rawfile|--slurpfile|--argfile|--from-file|-L|--library-path|-f)(=|$)/.test(a) || /^-[A-Za-z]*f$/.test(a))) return true;
  const filter = operands(args)[0] ?? "";
  return /\b(import|include|input_filename|env|getpath\(\$__prog)\b|\$ENV|\$__loc__/.test(filter);
}

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
    } else if (a === "-c" || /^-c./.test(a)) return deny("git-c"); // core.sshCommand·alias.x=!… 가 명령을 돌린다
    else if (/^--(git-dir|work-tree|exec-path)/.test(a)) return deny("git-dir-override");
    else i++;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (!sub) return allow();
  if (!GIT_OK.has(sub)) return deny(`git:${sub}`);
  // 상태를 바꾸는 동사(add commit push fetch pull merge rebase checkout switch branch restore reset cherry-pick apply remote config tag …)는 대상 cwd가 STAND 안일 때만.
  // `cd <운영 폴더> && git switch x`도 cd가 ctx.cwd를 옮기므로 여기서 걸린다
  if (!GIT_READ.has(sub)) {
    const here = real(resolve(cwd));
    if (!ctx.stand || !within(here, real(ctx.stand))) return deny(`git:${sub}:outside-stand`);
  }
  if (sub === "clean") return deny("git:clean");
  // stash는 모든 워크트리가 함께 쓴다: apply·drop은 다른 세션의 항목을 건드릴 수 있어 읽기(list·show)만(CLAUDE.md의 stash 규칙)
  if (sub === "stash" && !["list", "show"].includes(rest[0] ?? "")) return deny("git:stash");
  if (sub === "worktree" && !["list", "prune"].includes(rest[0] ?? "")) return deny("git:worktree");
  if (sub === "config" && !rest.some((a) => ["--get", "--get-all", "--list", "-l", "--get-regexp"].includes(a))) return deny("git:config-write");
  if (sub === "reset" && rest.includes("--hard") && !ctx.stand) return deny("git:reset-hard");
  if (sub === "push") {
    if (rest.some((a) => a === "--force" || a === "-f" || a === "--delete" || a === "-d" || a === "--mirror" || /^\+/.test(a) || (/^-[a-z]*f/.test(a) && !a.startsWith("--")))) return deny("git:force-push");
    if (rest.some((a) => /(^|:)(refs\/heads\/)?(main|master)$/.test(a))) return deny("git:push-main");
    if (rest.some((a) => /^:./.test(a))) return deny("git:push-delete"); // `:branch`는 원격 브랜치를 지운다
  }
  return allow("git");
}

// HTTP 메서드를 모든 철자로 읽는다(ATC-369 검토): `-X POST`, `-XPOST`, `-sXPOST`(묶음), `--method POST`, `--method=POST`, `--request=POST`.
// 돌려주는 값: 적힌 메서드(대문자) 목록. 없으면 빈 목록(기본 GET).
function methodsOf(args) {
  const out = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    let m;
    if (/^(--method|--request)$/.test(a)) out.push(String(args[++k] ?? "").toUpperCase());
    else if ((m = a.match(/^--(?:method|request)=(.*)$/))) out.push(m[1].toUpperCase());
    else if (/^-[A-Za-z]*X$/.test(a)) out.push(String(args[++k] ?? "").toUpperCase()); // -X POST, -sX POST
    else if ((m = a.match(/^-[A-Za-z]*X(.+)$/))) out.push(m[1].toUpperCase()); // -XPOST, -sXPOST
  }
  return out;
}
const KNOWN_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

function ghVerdict(args, ctx) {
  const sub = `${args[0] ?? ""} ${args[1] ?? ""}`.trim();
  // `gh pr checkout`은 작업 폴더의 브랜치를 바꾼다: git switch처럼 STAND 안에서만(ATC-369 검토, CLAUDE.md: 운영 폴더에서 브랜치를 바꾸지 않는다)
  if (sub === "pr checkout" && !(ctx.stand && within(real(resolve(ctx.cwd)), real(ctx.stand)))) return deny("gh:pr-checkout:outside-stand");
  if (GH_OK.has(sub)) return allow("gh");
  if (args[0] === "api") {
    const rest = args.slice(1);
    const methods = methodsOf(rest);
    if (methods.some((m) => !KNOWN_METHODS.has(m))) return deny("gh-api-method"); // 모르는 철자는 거절(fail-closed)
    const method = methods.find((m) => m !== "GET") ?? "GET"; // 쓰기 메서드가 하나라도 있으면 그것
    // 값을 가진 옵션의 값은 엔드포인트가 아니다
    const valueOf = new Set(rest.flatMap((a, k) => (/^(-X|--method|--request|-f|-F|--field|--raw-field|-H|--header|--input|-q|--jq|-t|--template|--hostname|--cache)$/.test(a) || /^-[A-Za-z]*X$/.test(a) ? [k + 1] : [])));
    const endpoint = rest.find((a, k) => !a.startsWith("-") && !valueOf.has(k)) ?? "";
    const hasBody = rest.some((a) => /^(-f|-F|--field|--raw-field|--input)$/.test(a));
    if (method === "GET" && !hasBody) return allow("gh-api-get");
    // PR 본문만 바꾼다(gh pr edit 대신): 필드는 body 하나. state·base·title 같은 다른 필드와 --input은 거절(ATC-369 검토)
    const fields = rest.flatMap((a, k) => (/^(-f|-F|--field|--raw-field)$/.test(a) ? [rest[k + 1] ?? ""] : /^--(field|raw-field)=/.test(a) ? [a.replace(/^--[a-z-]+=/, "")] : []));
    if (method === "PATCH" && /^repos\/[^/]+\/[^/]+\/pulls\/\d+$/.test(endpoint.replace(/^\//, "")) && fields.length > 0 && fields.every((f) => /^body=/.test(f)) && !rest.includes("--input")) return allow("gh-api-pr-edit");
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
    // 메서드는 `-X POST`·`-XPOST`·`--request=POST` 모두 읽고, GET·HEAD가 아니거나 모르는 철자는 쓰기로 본다
    const methods = methodsOf(args);
    const writes = methods.some((m) => m !== "GET" && m !== "HEAD") || args.some((a) => /^(-d|--data|--data-raw|--data-binary|--data-urlencode|-F|--form|-T|--upload-file|--json)/.test(a));
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
  // 인라인 코드: node -e·python3 -c처럼 명령줄이나 stdin으로 받은 코드는 무엇이든 쓰고 읽을 수 있어 STAND 규칙을 지킬 수 없다. 스크립트 파일(STAND 안)만 돌린다
  if (name === "node" || name === "python3" || name === "python") {
    const inline = name === "node" ? /^(-e|--eval|-p|--print|--input-type|-pe|-ep|-r|--require)(=|$)/ : /^(-c|-)$/;
    if (words.some((w) => /^\d*<</.test(w) || w === "<<<")) return deny(`${name}:stdin-code`);
    if (args.some((a) => inline.test(a) || (name !== "node" && /^-[a-zA-Z]*c/.test(a)))) return deny(`${name}:inline-code`);
    if (!operands(args).length) return deny(`${name}:no-script`);
  }
  // 읽기 인자: 읽기 명령은 비밀과 Claude 설정을 읽지 못하게. 파일 인자는 cwd 기준으로 풀어 모두 분류한다(`docs/../../.claude/x`, `jq . ~/.claude/x`, `grep x file`도)
  for (const a of fileOperandsOf(name, args)) {
    const r = readClass(a, ctx.cwd, ctx.stand);
    if (!r.ok && !writeClass(a, ctx.cwd, ctx.stand).ok) return deny(`read:${r.cls}`);
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
      return ghVerdict(args, ctx);
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
    case "jq":
      return jqUnsafe(args) ? deny("jq:file-read") : allow("jq");
    case "sed": {
      // 스크립트: -e·--expression 값, 없으면 첫 비옵션. -f·--file은 거절
      if (args.some((a) => /^(-f|--file)(=|$)/.test(a) || /^-[A-Za-z]*f$/.test(a))) return deny("sed:script-file");
      const scripts = args.flatMap((a, k) => (/^(-e|--expression)$/.test(a) ? [args[k + 1] ?? ""] : /^--expression=/.test(a) ? [a.replace(/^--expression=/, "")] : /^-[A-Za-z]*e$/.test(a) ? [args[k + 1] ?? ""] : []));
      if (!scripts.length && operands(args)[0] !== undefined) scripts.push(operands(args)[0]);
      if (scripts.some(sedScriptUnsafe)) return deny("sed:script-io");
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
      // 원본도 분류한다: 비밀(.env*·키)과 Claude 설정은 STAND 안으로 복사해도 읽을 수 있게 되므로 못 읽는 것은 못 복사한다(ATC-369 검토)
      const t = args.findIndex((a) => a === "-t" || a === "--target-directory" || /^--target-directory=/.test(a));
      const ops = operands(args);
      let dest;
      let sources;
      if (t >= 0) {
        dest = /^--target-directory=/.test(args[t]) ? args[t].replace(/^[^=]+=/, "") : args[t + 1];
        sources = ops.filter((a) => a !== dest);
      } else {
        dest = ops[ops.length - 1];
        sources = ops.slice(0, -1);
      }
      const c = writeClass(dest, ctx.cwd, ctx.stand);
      if (!c.ok) return deny(`cp:${c.cls}`);
      for (const src of sources) {
        const r = readClass(src, ctx.cwd, ctx.stand);
        if (!r.ok && !writeClass(src, ctx.cwd, ctx.stand).ok) return deny(`cp-src:${r.cls}`);
      }
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
      // 일부러 허용(ATC-369 검토): `source <atc>/.env.local`은 test-server 처방(.env.local을 자식 프로세스 환경에만 싣는다)이라 허용한다. 읽기(cat 등)는 비밀이라 거절하므로 둘이 달라 보이지만 뜻은 같다: 값을 출력하지 않고 환경에만 싣는 것만 열어 둔다
      const f = operands(args)[0] ?? "";
      // 그 STAND가 속한 저장소의 .env.local(`<저장소>/.claude/worktrees/<이름>`의 저장소)이나 atc의 기본 자리. 저장소 경로가 옮겨져도 STAND에서 구한다
      const repo = ctx.stand ? (ctx.stand.match(/^(.*)\/\.claude\/worktrees\/[^/]+$/)?.[1] ?? null) : null;
      return (repo && f === `${repo}/.env.local`) || /^\/home\/[^/]+\/projects\/atc\/\.env\.local$/.test(f) ? allow("source-env") : deny("source");
    }
    case "kill":
      // 일부러 허용(ATC-369 검토): `kill <pid>`는 test-server가 저장한 PID를 끄는 길이라 늘 허용한다. 이름·패턴 kill과 systemctl atc는 hooks/kill-guard.mjs가 막는다.
      // 알려진 틈: 운영 7700의 PID를 직접 적은 kill은 이 hook도 kill-guard도 막지 않는다(자동 분류기는 사람에게 물었을 호출). 이것을 막으려면 PID 소유를 알아야 해서 여기서는 하지 않는다
      return allow("kill");
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
const FREE_TOOLS = new Set(["EnterWorktree", "ExitWorktree", "Skill", "Agent", "Task", "TaskCreate", "TaskUpdate", "TaskGet", "TaskList", "TaskStop", "TodoWrite", "ToolSearch", "WebSearch", "ScheduleWakeup", "Monitor", "ExitPlanMode", "EnterPlanMode", "ReportFindings", "SendFeedback"]);
const SEND_OK = new Set(["OCC", "TOWER", "ENGINEERING"]);
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
  // 보고와 교신 답은 일을 맡긴 세션(OCC·ENGINEERING)과 CLEARANCE를 보낸 TOWER에게만(CLAUDE.md "교신"). 다른 팀·DUTY·MCC 등에는 보내지 않는다
  if (tool === "SendMessage") return SEND_OK.has(String(ti.to ?? "").trim().toUpperCase()) ? { behavior: "allow", cls: "sendmessage" } : { behavior: "deny", cls: "message-other" };
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

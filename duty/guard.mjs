#!/usr/bin/env node
// DUTY 세션의 PreToolUse hook(모든 도구, matcher `.*`). DUTY는 L1이다(docs/duty.md 3.5, D7a): atc를 읽고 초안을 남기며, 자기 STAND(.claude/worktrees/duty-*)에서만 문서를 쓰고 커밋·푸시·PR을 만든다.
// 허용하는 도구는 Bash·Read·Glob·Grep·Edit·Write뿐이고, 그 밖의 도구 이름은 어떻게 나타나든 막는다. 막으면 exit 2. 알 수 없는 모양·오류도 모두 막는다(fail-closed).
//
// Bash: `node <repo>/controller/atcctl.mjs duty …`와 읽기 전용 atcctl 명령, jq, 읽기 전용 gh pr, git log|show|diff|status,
//   DUTY STAND 안의 git add·commit·push·fetch·merge(형식 고정), `gh pr create --base main --head claude/duty-*`만.
//   파이프·;·&& 뒤의 명령도 하나하나 이 목록에 맞아야 하고, 리다이렉션·명령 치환·변수 확장은 통째로 막는다.
// Edit·Write: 자기 STAND(duty-*)의 `.md` 문서만, 심볼릭 링크를 푼 경로로 본다. no-self-authority: 자기 권한을 정하는 파일(duty/, *guard*, .claude/, .github/,
//   package*.json, deploy/, hooks/, 루트 CLAUDE.md), .env*, .git*, node_modules는 STAND 안이어도 쓰지 않는다.
// Read·Glob·Grep: 저장소 안에서만. `.env*`, `.credentials.json`, `.git`, `~/.claude*`, `~/.local/state/atc`, `~/.ssh`와 그 안은 읽지 않는다
//   (atc 상태는 atcctl로 읽는다). Grep은 `.env*` 파일이 든 폴더를 통째로 훑지 않는다.
// controller/guard.mjs와 같은 방식이지만 따로 둔다: 관제 세션의 guard는 이 파일을 위해 바뀌지 않는다.
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { simpleCommands } from "../hooks/shell.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, "..");
export const ATCCTL = join(REPO, "controller", "atcctl.mjs");

export const ALLOWED_TOOLS = new Set(["Bash", "Read", "Glob", "Grep", "Edit", "Write"]);

// 읽기 전용 atcctl 명령(앞 두 낱말, 뒤에 더 붙일 수 있는지는 EXACT). TOWER·OCC가 읽는 데 쓰는 것만
const READ_ATCCTL = new Set(["dispatch brief", "dispatch flight", "schedule brief", "crosscheck brief", "landing queue", "manual check"]);
// 인자 없이만 읽기인 것(`following ack`·`network …`의 쓰기 꼴을 막는다)
const READ_ATCCTL_BARE = new Set(["network", "following"]);
const DUTY_SUBS = new Set(["brief", "flight", "pr", "idea", "card", "note", "charter", "stand", "stand-done", "linear"]);

// 따옴표 밖의 > < 는 파일 리다이렉션(또는 heredoc·프로세스 치환)이라 허용하지 않는다.
function hasRedirect(command) {
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === "\\" && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === "\\") i++;
    else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === ">" || ch === "<") return true;
  }
  return false;
}

// 작은따옴표 밖의 명령 치환·변수 확장($(…), `…`, ${…}, $VAR)은 쉘이 실행 전에 풀어 버린다: 통째로 막는다.
function hasExpansion(command) {
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      continue;
    }
    if (ch === "\\") {
      i++;
      continue;
    }
    if (quote === '"' && ch === '"') quote = null;
    else if (!quote && (ch === "'" || ch === '"')) quote = ch;
    else if (ch === "`") return true;
    else if (ch === "$" && /[A-Za-z_{(0-9@*#?!$-]/.test(command[i + 1] ?? "")) return true;
  }
  return false;
}

// jq는 앞 명령의 출력만 다듬는다: 파일 인자, -f·--rawfile·-L 같은 옵션, 필터 안의 env·$ENV·import·include를 막는다(controller/guard.mjs와 같은 규칙)
const JQ_SHORT = new Set("rcesnRjaSCM");
const JQ_LONG = new Set([
  "--raw-output", "--raw-output0", "--compact-output", "--exit-status", "--slurp", "--null-input", "--raw-input",
  "--join-output", "--ascii-output", "--sort-keys", "--color-output", "--monochrome-output", "--tab", "--seq",
  "--stream", "--stream-errors", "--unbuffered",
]);
const JQ_VALUES = { "--indent": 1, "--arg": 2, "--argjson": 2 };
const JQ_FILTER_BANNED = /(^|[^\w$])(env|import|include|modulemeta|get_search_list)\b|\$ENV\b|\$__prog/;
export function checkJq(words) {
  const positional = [];
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (w === "--") {
      positional.push(...words.slice(i + 1));
      break;
    }
    if (w in JQ_VALUES) {
      if (i + JQ_VALUES[w] >= words.length) return `jq ${w} 뒤에 값이 모자람`;
      i += JQ_VALUES[w];
    } else if (w.startsWith("--")) {
      if (!JQ_LONG.has(w)) return `jq 옵션 ${w}는 쓸 수 없음`;
    } else if (w.startsWith("-") && w.length > 1) {
      const bad = [...w.slice(1)].find((ch) => !JQ_SHORT.has(ch));
      if (bad) return `jq 옵션 -${bad}는 쓸 수 없음`;
    } else positional.push(w);
  }
  if (positional.length > 1) return "jq에 파일을 주지 않는다 — 앞 명령의 출력(| jq '<필터>')만 읽는다";
  if (positional.length && JQ_FILTER_BANNED.test(positional[0])) return "jq 필터에서 env·$ENV·import·include는 쓸 수 없음";
  return null;
}

// gh pr view|list|checks|diff. --web·--watch와 gh api는 막는다. --jq 필터는 jq와 같은 검사
const GH_READ = new Set(["view", "list", "checks", "diff"]);
function checkGh(words) {
  if (words[1] === "pr" && words[2] === "create") return checkGhCreate(words);
  if (words[1] !== "pr" || !GH_READ.has(words[2])) return `gh는 pr view|list|checks|diff와 pr create(--base main --head claude/duty-*)만 쓴다: ${words.slice(0, 3).join(" ")}`;
  for (let i = 3; i < words.length; i++) {
    const w = words[i];
    if (w === "--") break;
    if (w === "--web" || w === "-w" || w === "--watch") return `gh 옵션 ${w}는 쓸 수 없음`;
    let filter = null;
    if (w === "-q" || w === "--jq") filter = words[i + 1] ?? "";
    else if (w.startsWith("--jq=")) filter = w.slice(5);
    else if (/^-q./.test(w)) filter = w.slice(2);
    else if (/^-[^-]*q/.test(w)) return `gh 옵션 ${w}: -q는 따로 쓴다`;
    else if (/^-[^-]*[wW]/.test(w) && !w.startsWith("--")) return `gh 옵션 ${w}는 쓸 수 없음`;
    if (filter !== null && JQ_FILTER_BANNED.test(filter)) return "gh --jq 필터에서 env·$ENV·import·include는 쓸 수 없음";
  }
  return null;
}

// ── DUTY STAND(D7a): .claude/worktrees/duty-<이름> ──
// 저장소는 이 파일이 있는 곳의 위(REPO)다. 이름 모양은 server/duty-stand.ts와 같다
const STAND_DIR = /^duty-[a-z0-9]+(-[a-z0-9]+)*$/;
const DUTY_BRANCH = /^claude\/duty-[a-z0-9]+(-[a-z0-9]+)*$/;

// 심볼릭 링크를 푼 절대 경로가 어느 DUTY STAND 안인가: { root, rel(STAND 안의 조각들) } 또는 null
export function standOf(abs) {
  const base = real(join(REPO, ".claude", "worktrees")).abs;
  if (!base || !abs.startsWith(base + sep)) return null;
  const parts = abs.slice(base.length + 1).split(sep);
  if (!STAND_DIR.test(parts[0])) return null;
  return { root: join(base, parts[0]), rel: parts.slice(1) };
}
const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
// git -C <dir>, 또는 cwd가 DUTY STAND 안의 있는 폴더인가. 문제면 사유, 괜찮으면 null
function standDir(dir, cwd) {
  // `..`는 심볼릭 링크 뒤에서 어디로 갈지 resolve()(글자만 정리)와 OS가 다르게 본다: 어느 쪽 경로에도 쓰지 않는다
  if (`${dir}/${cwd}`.split("/").includes("..")) return `경로에 ..은 쓸 수 없음: ${dir}`;
  const r = real(isAbsolute(dir) ? resolve(dir) : resolve(cwd, dir));
  if (r.reason) return r.reason;
  if (!standOf(r.abs)) return `DUTY STAND(${join(REPO, ".claude", "worktrees", "duty-*")}) 안이 아님: ${dir}`;
  return isDir(r.abs) ? null : `폴더가 없음: ${dir}`;
}

// ── Edit·Write: 자기 STAND의 문서만 ──
// 절대 경로(심볼릭 링크를 푼 것)로 본다. STAND 안이어도 자기 권한을 정하는 것은 쓰지 않는다(no-self-authority)
const SELF_AUTHORITY_TOP = new Set(["duty", "hooks", "deploy"]); // STAND 맨 위 폴더
const SELF_AUTHORITY_ANY = new Set([".claude", ".github", "node_modules"]); // 어느 깊이든(node_modules는 운영 폴더와 하드링크다)
export function writeForbidden(abs) {
  const st = standOf(abs);
  if (!st) return "DUTY는 자기 STAND(.claude/worktrees/duty-*) 안에만 씁니다";
  const { rel } = st;
  if (!rel.length) return "STAND 폴더 자체는 쓰지 않는다";
  const name = rel[rel.length - 1];
  for (const p of rel) {
    if (/^\.env/i.test(p)) return ".env 파일은 쓰지 않는다";
    if (/^\.git/i.test(p)) return ".git* 는 쓰지 않는다";
    if (SELF_AUTHORITY_ANY.has(p)) return `${p}/ 는 쓰지 않는다(자기 권한·CI·의존성)`;
  }
  if (SELF_AUTHORITY_TOP.has(rel[0])) return `${rel[0]}/ 는 쓰지 않는다(no-self-authority)`;
  if (/guard/i.test(name)) return "guard 파일은 쓰지 않는다(no-self-authority)";
  if (/^package(-lock)?\.json$/i.test(name)) return "package*.json은 쓰지 않는다";
  if (rel.length === 1 && /^CLAUDE(\.en)?\.md$/i.test(name)) return "루트 CLAUDE.md는 쓰지 않는다(no-self-authority)";
  if (!/\.md$/i.test(name)) return "DUTY는 문서(.md)만 씁니다 — 코드는 작업 세션의 몫(L2 아님)";
  return null;
}

// Edit·Write 하나의 문제. 괜찮으면 null
export function checkWrite(tool, input, cwd = HERE) {
  const p = input && typeof input === "object" ? input.file_path : undefined;
  if (typeof p !== "string" || !p.trim()) return `${tool}에 file_path가 없음`;
  if (p.includes("\u0000")) return "경로에 NUL이 있음";
  // `..`는 쓰지 않는다: resolve()는 글자만 정리하지만 OS는 심볼릭 링크를 먼저 따라가서, `docs/링크/../x.md`가 다른 곳을 가리킬 수 있다
  if (`${p}/${cwd}`.split("/").includes("..")) return "경로에 ..은 쓸 수 없음 — 절대 경로를 정리해서 준다";
  const expanded = p === "~" ? homedir() : p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
  const r = real(isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded));
  if (r.reason) return r.reason;
  return writeForbidden(r.abs);
}

// ── git ──
// 읽기: log|show|diff|status. 파일을 쓰거나 저장소 밖 파일을 읽는 옵션을 막는다. 앞에 전역 옵션은 `-C <STAND>` 하나만
const GIT_READ = new Set(["log", "show", "diff", "status"]);
const GIT_BANNED = /^(--output(=.*)?|--no-index|--ext-diff|--textconv|--exec-path(=.*)?|--upload-pack(=.*)?|--open-files-in-pager(=.*)?|-O.*|--git-dir(=.*)?|--work-tree(=.*)?|-c|--config-env(=.*)?)$/;
// 쓰기: STAND 안에서만(`-C <STAND>` 또는 cwd가 STAND 안). 형식이 고정이다
const GIT_ADD_OPTS = new Set(["-A", "--all", "-u", "--update"]);
const GIT_COMMIT_OPTS = new Set(["-a", "--all", "-q", "--quiet"]);

function checkAddArgs(args) {
  let paths = false;
  for (const w of args) {
    if (!paths && w === "--") paths = true;
    else if (!paths && w.startsWith("-")) {
      if (!GIT_ADD_OPTS.has(w)) return `git add 옵션 ${w}는 쓸 수 없음(-A --all -u --update만)`;
    } else if (isAbsolute(w) || w.startsWith(":") || w.startsWith("~") || w.split("/").includes("..") || w.includes("\u0000")) return `git add 경로는 STAND 안의 상대 경로만: ${w}`;
  }
  return null;
}
function checkCommitArgs(args) {
  for (let k = 0; k < args.length; k++) {
    const w = args[k];
    if (w === "-m" || w === "--message") {
      if (k + 1 >= args.length) return "git commit -m 뒤에 문구가 필요함";
      k++;
    } else if (!/^--message=/.test(w) && !GIT_COMMIT_OPTS.has(w)) return `git commit 옵션 ${w}는 쓸 수 없음(-m --message -a --all -q만. --amend·-n·--no-verify 없음)`;
  }
  return null;
}
function checkPushArgs(args) {
  let k = 0;
  if (args[k] === "-u" || args[k] === "--set-upstream") k++;
  if (args[k] !== "origin" || args.length !== k + 2 || !DUTY_BRANCH.test(args[k + 1])) return "git push는 `push [-u] origin claude/duty-<이름>` 하나만(--force·다른 refspec·태그 없음)";
  return null;
}
function checkFetchArgs(args) {
  const rest = args.filter((w) => w !== "-q" && w !== "--quiet");
  if (rest[0] !== "origin" || rest.length > 2 || (rest.length === 2 && rest[1] !== "main")) return "git fetch는 `fetch [-q] origin [main]`만";
  return null;
}
function checkMergeArgs(args) {
  if (args.length === 1 && args[0] === "--abort") return null;
  const rest = args.filter((w) => w !== "--no-edit" && w !== "-q" && w !== "--quiet");
  if (rest.length !== 1 || rest[0] !== "origin/main") return "git merge는 `merge [--no-edit] origin/main`(또는 --abort)만";
  return null;
}
const GIT_WRITE = { add: checkAddArgs, commit: checkCommitArgs, push: checkPushArgs, fetch: checkFetchArgs, merge: checkMergeArgs };

function checkGit(words, cwd) {
  let i = 1;
  let inStand = false;
  if (words[1] === "-C") {
    if (!words[2]) return "git -C 뒤에 STAND 경로가 필요함";
    const why = standDir(words[2], cwd);
    if (why) return why;
    inStand = true;
    i = 3;
  } else inStand = standDir(".", cwd) === null;
  const sub = words[i] ?? "";
  const args = words.slice(i + 1);
  if (Object.hasOwn(GIT_WRITE, sub)) return inStand ? GIT_WRITE[sub](args) : `git ${sub}는 DUTY STAND 안에서만: git -C <STAND> ${sub} …`;
  if (!GIT_READ.has(sub)) return `git은 log|show|diff|status와 STAND 안의 add|commit|push|fetch|merge만: ${words.slice(0, 4).join(" ")}`;
  for (const w of args) {
    if (w === "--") break;
    if (GIT_BANNED.test(w)) return `git 옵션 ${w}는 쓸 수 없음`;
  }
  return null;
}

// gh pr create: --base main --head claude/duty-<이름> --title <글> [--body <글>]만. Draft·--web·--fill·--repo·파일 옵션은 없다(Draft PR은 MCC가 착륙시키지 못한다)
const GH_CREATE_VALUE = new Map([["--base", "base"], ["-B", "base"], ["--head", "head"], ["-H", "head"], ["--title", "title"], ["-t", "title"], ["--body", "body"], ["-b", "body"]]);
function checkGhCreate(words) {
  const got = {};
  for (let k = 3; k < words.length; k++) {
    let w = words[k];
    let value;
    const eq = /^(--[a-z-]+)=([\s\S]*)$/.exec(w);
    if (eq) [, w, value] = eq;
    const key = GH_CREATE_VALUE.get(w);
    if (!key) return `gh pr create 옵션 ${w}는 쓸 수 없음(--base --head --title --body만. --draft·--web·--fill·--repo 없음)`;
    if (value === undefined) {
      if (k + 1 >= words.length) return `gh pr create ${w} 뒤에 값이 필요함`;
      value = words[++k];
    }
    if (key in got) return `gh pr create ${w}가 두 번`;
    got[key] = value;
  }
  if (got.base !== "main") return "gh pr create는 --base main만";
  if (!DUTY_BRANCH.test(got.head ?? "")) return "gh pr create는 --head claude/duty-<이름>만";
  if (!got.title?.trim()) return "gh pr create에는 --title이 필요함";
  return null;
}

// atcctl: duty 명령과 읽기 전용 명령만
function checkAtcctl(words) {
  const two = words.slice(2, 4).join(" ");
  if (words[2] === "duty") return DUTY_SUBS.has(words[3] ?? "") ? null : `atcctl duty ${words[3] ?? "(없음)"}는 없다: ${[...DUTY_SUBS].join("|")}`;
  if (READ_ATCCTL.has(two)) return null;
  if (READ_ATCCTL_BARE.has(words[2]) && words.length === 3) return null;
  return `DUTY가 쓸 수 없는 atc 명령: ${two || "(없음)"}. duty 명령과 읽기 전용 명령(${[...READ_ATCCTL].join(", ")}, network, following)만`;
}

// Bash 명령의 문제. 괜찮으면 null
export function checkBash(command, cwd = HERE) {
  if (typeof command !== "string" || !command.trim()) return "빈 명령";
  if (hasRedirect(command)) return "리다이렉션(>, <, heredoc)은 쓸 수 없음";
  if (hasExpansion(command)) return "명령 치환·변수 확장($(…), `…`, ${…}, $VAR)은 쓸 수 없음 — 문구는 작은따옴표로 감싼다";
  const cmds = simpleCommands(command);
  if (!cmds.length) return "명령이 없음";
  for (const [index, words] of cmds.entries()) {
    const cmd = words[0];
    let bad = null;
    if (cmd === "jq") {
      bad = index === 0 ? "jq는 명령 맨 앞에 쓰지 않는다 — `node … atcctl.mjs … | jq '<필터>'`처럼 뒤에 붙인다" : checkJq(words);
    } else if (cmd === "gh") bad = checkGh(words);
    else if (cmd === "git") bad = checkGit(words, cwd);
    else if (cmd === "node" && words[1] && resolve(cwd, words[1]) === ATCCTL) bad = checkAtcctl(words);
    else bad = `허용되지 않은 명령: ${words.slice(0, 3).join(" ")}`;
    if (bad) return bad;
  }
  return null;
}

// ── 읽기 도구(Read·Glob·Grep) ──
function forbiddenRoots() {
  const home = homedir();
  const roots = [join(home, ".ssh"), join(home, ".local", "state", "atc"), "/proc"];
  if (process.env.ATC_STATE_DIR) roots.push(resolve(process.env.ATC_STATE_DIR));
  return roots;
}
const under = (p, root) => p === root || p.startsWith(root + sep);

// 이 경로(절대, 심볼릭 링크를 푼 것)를 읽어도 되나. 문제면 사유
export function forbiddenPath(abs) {
  const home = homedir();
  const parts = abs.split(sep);
  for (const p of parts) {
    if (/^\.env/i.test(p)) return ".env 파일은 읽지 않는다";
    if (p === ".credentials.json") return ".credentials.json은 읽지 않는다";
    if (p === ".git") return ".git 안은 읽지 않는다(git log|show|diff를 쓴다)";
  }
  const rel = abs.startsWith(home + sep) ? abs.slice(home.length + 1).split(sep)[0] : null;
  if (rel !== null && /^\.claude/.test(rel)) return "~/.claude* 설정 폴더는 읽지 않는다";
  for (const r of forbiddenRoots()) if (under(abs, r)) return `${r} 안은 읽지 않는다(atc 상태는 atcctl로 읽는다)`;
  return null;
}

// 존재하면 심볼릭 링크를 풀고, 없으면 있는 가장 가까운 윗길을 풀어 이어 붙인다. { abs } 또는 { reason }.
// 못 푸는 마디는 lstat으로 본다: 진짜로 없는 마디(ENOENT)만 이름으로 이어 붙이고, 풀 수 없는 심볼릭 링크(가리키는 곳이 없음·고리)와
// 그 밖의 lstat 오류는 모두 막는다(fail-closed) — 저장소 안의 끊어진 링크가 저장소 밖 비밀 경로를 가리켜도 이름만 보고 지나가지 않게.
function real(p) {
  let cur = p;
  const tail = [];
  for (;;) {
    try {
      return { abs: join(realpathSync(cur), ...[...tail].reverse()) };
    } catch {
      let st;
      try {
        st = lstatSync(cur);
      } catch (e) {
        if (e?.code !== "ENOENT") return { reason: `경로를 확인하지 못함(${e?.code ?? "오류"}): ${cur}` };
        const up = dirname(cur);
        if (up === cur) return { reason: `경로를 풀지 못함: ${p}` };
        tail.push(basename(cur));
        cur = up;
        continue;
      }
      return { reason: st.isSymbolicLink() ? `풀 수 없는 심볼릭 링크(가리키는 곳이 없거나 고리)는 읽지 않는다: ${cur}` : `경로를 풀지 못함: ${cur}` };
    }
  }
}

const GLOB_CHARS = /[*?[\]{}]/;
// 저장소 안의 절대 경로로 바꾼다. 안이 아니거나 문제면 { reason }
function resolveRead(input, cwd) {
  if (typeof input !== "string" || !input.trim()) return { reason: "경로가 없음" };
  if (input.includes("\u0000")) return { reason: "경로에 NUL이 있음" };
  const expanded = input === "~" ? homedir() : input.startsWith("~/") ? join(homedir(), input.slice(2)) : input;
  const r = real(isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded));
  if (r.reason) return { reason: r.reason };
  const abs = r.abs;
  if (!under(abs, REPO)) return { reason: `저장소(${REPO}) 밖은 읽지 않는다` };
  const why = forbiddenPath(abs);
  return why ? { reason: why } : { abs };
}

// 폴더 안에 .env* 파일이 있나(있으면 Grep이 내용을 훑는다). 너무 크면 있다고 본다
const SCAN_MAX = 20_000;
export function containsEnvFile(dir) {
  let seen = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (++seen > SCAN_MAX) return true;
      if (/^\.env/i.test(e.name)) return true;
      if (e.isDirectory() && e.name !== "node_modules" && e.name !== ".git") stack.push(join(d, e.name));
    }
  }
  return false;
}

// 도구별 검사. 문제면 사유, 괜찮으면 null
export function checkRead(tool, input, cwd = HERE) {
  const i = input && typeof input === "object" ? input : {};
  if (tool === "Read") {
    const r = resolveRead(i.file_path, cwd);
    return r.reason ?? null;
  }
  // Glob·Grep: 찾는 폴더(path, 없으면 cwd)와 패턴(Glob pattern, Grep glob)이 모두 저장소 안이어야 한다
  const pathArg = i.path === undefined || i.path === null || i.path === "" ? cwd : i.path;
  const root = resolveRead(pathArg, cwd);
  if (root.reason) return root.reason;
  const pat = tool === "Glob" ? i.pattern : i.glob;
  if (tool === "Glob" && (typeof pat !== "string" || !pat)) return "Glob에는 pattern이 필요함";
  if (pat !== undefined && pat !== null && pat !== "") {
    if (typeof pat !== "string") return "패턴은 글이어야 함";
    if (pat.split("/").includes("..")) return "패턴에 ..은 쓸 수 없음";
    if (pat.startsWith("~") || isAbsolute(pat)) {
      const fixed = pat.split("/").reduce((acc, seg) => (acc.stop || GLOB_CHARS.test(seg) ? { ...acc, stop: true } : { ...acc, parts: [...acc.parts, seg] }), { parts: [], stop: false }).parts.join("/") || "/";
      const p = resolveRead(fixed, cwd);
      if (p.reason) return p.reason;
    }
  }
  if (tool === "Grep" && containsEnvFile(root.abs)) return `${root.abs} 안에 .env 파일이 있어 내용을 훑을 수 없다 — 더 좁은 폴더나 파일 하나를 준다`;
  return null;
}

// hook 입력 하나의 문제. 괜찮으면 null
export function check(input) {
  const tool = input?.tool_name;
  if (typeof tool !== "string" || !ALLOWED_TOOLS.has(tool)) return `DUTY(L1)가 쓸 수 없는 도구: ${typeof tool === "string" ? tool : "(이름 없음)"}. Bash·Read·Glob·Grep·Edit·Write만`;
  const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : HERE;
  if (tool === "Bash") return checkBash(input.tool_input?.command, cwd);
  if (tool === "Edit" || tool === "Write") return checkWrite(tool, input.tool_input, cwd);
  return checkRead(tool, input.tool_input, cwd);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let reason;
  try {
    reason = check(JSON.parse(readFileSync(0, "utf8")));
  } catch (e) {
    reason = `guard가 입력을 읽지 못함(${e?.message ?? e})`;
  }
  if (reason) {
    console.error(`DUTY는 L1입니다 — 자기 STAND에 문서를 쓰고 PR을 엽니다. ${reason}. 코드·머지·배포·세션 조종은 SUPERVISOR나 작업 세션의 몫입니다.`);
    process.exit(2);
  }
}

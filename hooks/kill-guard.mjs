// PreToolUse(Bash) hook: 팀 세션이 이름·패턴으로 프로세스를 죽여 운영 서비스(7700)를 끄지 못하게 막는다(ATC-134).
// 2026-09-29 07:12 사고: 팀이 시험 서버를 `pkill -f "node server/index.ts"`로 끄다 운영 7700도 함께 죽였다.
// 막는 것: pkill·killall(패턴에 server/index, atc, node), `kill $(pgrep …)`·`pgrep … | xargs kill`, fuser -k,
// `systemctl [--user] stop|restart|kill|… atc`. `kill <pid>`와 `kill "$(cat <tmp>/server.pid)"`, atc-rts는 막지 않는다.
// fail-closed: 입력을 못 읽거나 해석이 깨지면 막는다(exit 2). 설정의 `… || exit 2`와 겹쳐서 지킨다.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { simpleCommands } from "./shell.mjs";

const PATTERN_KILLERS = new Set(["pkill", "killall"]);
const WRAPPERS = new Set(["sudo", "env", "command", "nohup", "exec", "time", "builtin", "nice", "setsid", "doas"]);
const UNIT_ACTIONS = new Set(["stop", "restart", "try-restart", "reload-or-restart", "try-reload-or-restart", "kill", "disable", "mask", "isolate"]);
const DANGEROUS_PATTERN = /server\/index|atc|node/i;
const ATC_UNIT = /^atc(\.service)?$/;

// 명령 앞의 VAR=x, sudo·env 같은 껍데기를 벗겨 진짜 명령 단어부터 돌려준다
function coreOf(words) {
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || WRAPPERS.has(w.split("/").pop())) i++;
    else if (i > 0 && /^-/.test(w) && WRAPPERS.has(words[0].split("/").pop())) i++; // sudo -u x 같은 옵션
    else break;
  }
  return words.slice(i);
}

// 막을 사유(문자열) 또는 null. 순수 함수.
export function blockReason(command) {
  if (typeof command !== "string") return "명령을 읽지 못함";
  // 명령 치환으로 PID를 패턴 검색하는 꼴: `kill $(pgrep -f …)`, `kill \`pidof …\``, `pgrep … | xargs kill`
  if (/\bkill\b[^\n;&|]*(\$\(|`)\s*(pgrep|pidof|ps)\b/.test(command) || /\b(pgrep|pidof|lsof|ps)\b[^\n]*\|\s*(sudo\s+)?xargs\s+(-\S+\s+)*(sudo\s+)?kill\b/.test(command)) {
    return "패턴으로 찾은 PID를 kill하는 명령";
  }
  for (const raw of simpleCommands(command)) {
    const words = coreOf(raw);
    if (!words.length) continue;
    const name = words[0].split("/").pop();
    const args = words.slice(1);
    if (PATTERN_KILLERS.has(name)) {
      const hit = args.filter((a) => !/^-[A-Za-z0-9]+$/.test(a)).find((a) => DANGEROUS_PATTERN.test(a));
      if (hit !== undefined) return `${name}의 패턴 "${hit}"`;
    }
    if (name === "fuser" && args.some((a) => /^-\w*k/.test(a))) return "fuser -k (포트나 파일을 쓰는 프로세스를 이름 없이 죽임)";
    if (name === "systemctl") {
      const rest = args.filter((a) => !a.startsWith("-"));
      const [action, ...units] = rest;
      if (UNIT_ACTIONS.has(action) && units.some((u) => ATC_UNIT.test(u))) return `systemctl ${action} atc (운영 서비스)`;
    }
  }
  return null;
}

export const BLOCK_MESSAGE = (why) =>
  `KILL GUARD: 막힘 — ${why}. 이름·패턴으로 프로세스를 죽이거나 운영 서비스(atc, 7700)를 멈추면 안 된다(2026-09-29 사고, ATC-134). ` +
  `시험 서버는 띄울 때 PID를 저장하고(\`… & echo $! > <tmp>/server.pid\`) \`kill "$(cat <tmp>/server.pid)"\`로만 끈다. 내가 띄우지 않은 프로세스는 건드리지 않는다. ` +
  `운영 서비스는 RETURN TO SERVICE(atc-rts)로만 배포하고, 멈추거나 재시작해야 하면 SUPERVISOR에게 알린다.`;

function main() {
  let command;
  try {
    command = JSON.parse(readFileSync(0, "utf8"))?.tool_input?.command;
  } catch {
    console.error(BLOCK_MESSAGE("hook 입력을 읽지 못함"));
    process.exit(2);
  }
  let why;
  try {
    why = blockReason(command);
  } catch (e) {
    why = `해석 오류(${e?.message ?? e})`;
  }
  if (why) {
    console.error(BLOCK_MESSAGE(why));
    process.exit(2);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

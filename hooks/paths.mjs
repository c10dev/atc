// 도구 호출 하나가 "작업하러 들어간" 경로들. hook(claim.mjs)과 서버의 대화 기록 추정이 같은 규칙을 쓴다.
// - Edit·Write·MultiEdit·NotebookEdit: 대상 파일
// - Bash: 명령 위치의 cd·git -C 대상(shell.mjs). 인자 문자열·heredoc·출력은 보지 않는다.
// - 그때의 세션 cwd
import { homedir } from "node:os";
import { resolve } from "node:path";
import { workTargets } from "./shell.mjs";

const MAX_PATHS = 12;
// settings.json의 PostToolUse matcher와 같게 둔다. Read·Grep 등 읽기 도구는 점유가 아니다.
const WORK_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash"]);

function expandHome(arg) {
  return arg.replace(/^~(?=\/|$)/, homedir()).replace(/^\$\{?HOME\}?(?=\/|$)/, homedir());
}

export function toolPaths(toolName, toolInput, cwd) {
  if (!WORK_TOOLS.has(toolName)) return [];
  const input = toolInput || {};
  const base = typeof cwd === "string" ? cwd : "/";
  const out = [];
  for (const k of ["file_path", "notebook_path"]) if (typeof input[k] === "string") out.push(input[k]);
  if (toolName === "Bash" && typeof input.command === "string") {
    for (const arg of workTargets(input.command)) out.push(resolve(base, expandHome(arg)));
  }
  if (typeof cwd === "string") out.push(cwd);
  return out.filter((p) => p.startsWith("/home/")).slice(0, MAX_PATHS);
}

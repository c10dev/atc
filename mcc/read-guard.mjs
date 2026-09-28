#!/usr/bin/env node
// MCC 세션의 PreToolUse hook (Read·Glob·Grep). INSPECTION은 diff 주변 코드를 읽어야 하므로 atc 저장소 전체를 읽는다(docs/mcc.md 8장).
// 막는 것: 저장소 밖(~/.local/state/atc, ~/.claude, 다른 저장소), 비밀 파일(.env*), 저장소 맨 위의 Grep(.env.local까지 뒤지지 않게).
// 이 세션이 저장한 도구 출력은 읽는다. 막으면 exit 2.
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");

// 있는 경로는 실제 경로로(심볼릭 링크로 빠져나가지 않게), 없는 경로는 가장 가까운 있는 조상을 기준으로 푼다
function real(p) {
  let cur = resolve(p);
  const rest = [];
  for (;;) {
    try {
      return join(realpathSync(cur), ...rest.reverse());
    } catch {
      const up = dirname(cur);
      if (up === cur) return resolve(p);
      rest.push(cur.slice(up.length + (up.endsWith("/") ? 0 : 1)));
      cur = up;
    }
  }
}
const inside = (root, p) => {
  const r = relative(root, p);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};

// 읽기 허용 뿌리: atc 저장소, 이 세션의 도구 출력 폴더(<transcript 폴더>/<session_id>/)
export function rootsOf({ transcriptPath, sessionId } = {}) {
  const roots = [real(REPO)];
  if (typeof transcriptPath === "string" && transcriptPath && typeof sessionId === "string" && /^[\w-]+$/.test(sessionId)) {
    roots.push(real(join(dirname(transcriptPath), sessionId)));
  }
  return roots;
}

const SECRET = /(^|\/)\.env/;

// 막을 이유, 통과면 null
export function checkRead(toolName, input, { cwd = HERE, roots = rootsOf() } = {}) {
  if (!["Read", "Glob", "Grep"].includes(toolName)) return null;
  const raw = toolName === "Read" ? input?.file_path : (input?.path ?? cwd);
  if (typeof raw !== "string" || !raw) return "읽을 경로가 없음";
  const target = real(isAbsolute(raw) ? raw : join(cwd, raw));
  if (!roots.some((r) => inside(r, target))) return `atc 저장소 밖은 읽지 않는다: ${raw}`;
  if (SECRET.test(target.split(sep).join("/"))) return `비밀 파일(.env*)은 읽지 않는다: ${raw}`;
  if (toolName === "Glob" && (typeof input?.pattern !== "string" || isAbsolute(input.pattern) || input.pattern.split("/").includes(".."))) return "Glob 패턴에 절대 경로나 ..를 쓰지 않는다";
  if (toolName === "Grep") {
    if (target === roots[0]) return "저장소 맨 위에서 Grep하지 않는다 — server/·web/src/처럼 폴더를 지정한다";
    if (typeof input?.glob === "string" && SECRET.test(input.glob)) return "비밀 파일(.env*)은 뒤지지 않는다";
  }
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {}
  const reason =
    typeof input.tool_name !== "string"
      ? "hook 입력을 읽지 못함"
      : checkRead(input.tool_name, input.tool_input, {
          cwd: input.cwd || HERE,
          roots: rootsOf({ transcriptPath: input.transcript_path, sessionId: input.session_id }),
        });
  if (reason) {
    console.error(`MCC 읽기 차단 — ${reason}. 읽을 수 있는 곳은 atc 저장소(.env* 제외)와 이 세션의 도구 출력뿐입니다.`);
    process.exit(2);
  }
}

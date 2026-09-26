#!/usr/bin/env node
// CROSSCHECK 세션의 PreToolUse hook (Read·Glob·Grep). 읽을 수 있는 곳은 셋뿐이다:
// 이 폴더(crosscheck/, CLAUDE.md·/tick), atc의 docs/(fleet.md 분류 기준 등), 이 세션이 저장한 도구 출력
// (긴 출력은 ~/.claude/projects/…/<session>/tool-results/에 저장되고 Read로 다시 읽는다).
// atc 소스, ~/.local/state/atc, 다른 저장소는 막는다. 대화형(Desktop)에서 권한 창으로 넘어가지 않게 막으면 exit 2.
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

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

// 읽기 허용 뿌리: crosscheck/, ../docs/, 이 세션의 도구 출력 폴더(<transcript 폴더>/<session_id>/)
export function rootsOf({ dir = HERE, transcriptPath, sessionId } = {}) {
  const roots = [real(dir), real(join(dir, "..", "docs"))];
  if (typeof transcriptPath === "string" && transcriptPath && typeof sessionId === "string" && /^[\w-]+$/.test(sessionId)) {
    roots.push(real(join(dirname(transcriptPath), sessionId)));
  }
  return roots;
}

// 막을 이유, 통과면 null
export function checkRead(toolName, input, { cwd = HERE, roots = rootsOf() } = {}) {
  if (!["Read", "Glob", "Grep"].includes(toolName)) return null;
  const raw = toolName === "Read" ? input?.file_path : (input?.path ?? cwd);
  if (typeof raw !== "string" || !raw) return "읽을 경로가 없음";
  const target = real(isAbsolute(raw) ? raw : join(cwd, raw));
  if (!roots.some((r) => inside(r, target))) return `docs/와 이 폴더 밖은 읽지 않는다: ${raw}`;
  // Glob 패턴이 뿌리 밖으로 나가지 않게(../server/*.ts, /home/…)
  if (toolName === "Glob" && (typeof input?.pattern !== "string" || isAbsolute(input.pattern) || input.pattern.split("/").includes(".."))) return "Glob 패턴에 절대 경로나 ..를 쓰지 않는다";
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
    console.error(`CROSSCHECK 읽기 차단 — ${reason}. 읽을 수 있는 곳은 crosscheck/, docs/, 이 세션의 도구 출력뿐입니다.`);
    process.exit(2);
  }
}

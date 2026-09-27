#!/usr/bin/env node
// 착륙 리뷰 세션(REVIEW)의 PreToolUse hook (Read·Glob·Grep). CROSSCHECK의 read-guard와 같은 규칙을 이 폴더 기준으로 쓴다:
// 읽을 수 있는 곳은 review/(CLAUDE.md·/tick), atc의 docs/, 이 세션이 저장한 도구 출력뿐이다. 막으면 exit 2.
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkRead, rootsOf as crosscheckRoots } from "../crosscheck/read-guard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// 읽기 허용 뿌리: review/, ../docs/, 이 세션의 도구 출력 폴더
export const rootsOf = ({ transcriptPath, sessionId } = {}) => crosscheckRoots({ dir: HERE, transcriptPath, sessionId });
export { checkRead };

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
    console.error(`착륙 리뷰(REVIEW) 읽기 차단 — ${reason.replace("이 폴더", "review/")}. 읽을 수 있는 곳은 review/, docs/, 이 세션의 도구 출력뿐입니다.`);
    process.exit(2);
  }
}

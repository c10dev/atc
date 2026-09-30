// DUTY 프로세스의 명령줄(ATC-219, docs/duty.md 3). 순수 함수 하나: D2(server/duty-run.ts)가 이것을 import해 그대로 띄운다.
// 설정은 `--settings <절대 경로>`로 준다: `-p`는 신뢰하지 않은 폴더의 .claude/settings.json 속 permissions.allow를 무시한다(D0). 그래서 duty/settings.json은 .claude/ 밖에 있다.
// `--tools`로 도구 목록을 정확히 고정하고(허용 목록 밖은 처음부터 없다), 거부 목록과 guard는 두 번째 자물쇠다.
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DUTY_DIR = HERE;
export const DUTY_TOOLS = "Bash,Read,Glob,Grep";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// cfg: { claudeBin?, sessionId?, resume?, dir? }. resume면 sessionId는 이어 갈 대화 id(필수), 아니면 새 대화 id(없으면 새로 만든다)
// 반환: { command, args, cwd, sessionId }. 환경(cleanEnv(<ACCOUNT 폴더>))은 부르는 쪽이 정한다
export function dutyArgvOf(cfg = {}) {
  const dir = resolve(cfg.dir ?? DUTY_DIR);
  const resume = Boolean(cfg.resume);
  const sessionId = cfg.sessionId ?? (resume ? null : randomUUID());
  if (typeof sessionId !== "string" || !UUID.test(sessionId)) throw new Error(resume ? "resume에는 이어 갈 대화의 sessionId(UUID)가 필요함" : `sessionId는 UUID여야 함: ${sessionId}`);
  const args = [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--include-hook-events",
    "--replay-user-messages",
    "--strict-mcp-config",
    "--tools", DUTY_TOOLS,
    "--settings", join(dir, "settings.json"),
    resume ? "--resume" : "--session-id", sessionId,
  ];
  return { command: cfg.claudeBin ?? "claude", args, cwd: dir, sessionId };
}

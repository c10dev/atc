import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";

// 시험이 운영 상태 폴더를 쓰지 못하게 하는 막음(ATC-564). config.stateDir를 읽을 때마다 이 검사를 지난다.
// 파일을 읽거나 만들지 않는다: 경로 문자열과 프로세스 표시(환경·실행 인자)만 본다. 운영 서버(node --test가 아님)에서는 아무것도 하지 않는다.

// node --test가 돌리는 프로세스인가. 파일마다 따로 도는 자식은 NODE_TEST_CONTEXT, --test-isolation=none은 실행 인자의 --test
export const underNodeTest = (env: NodeJS.ProcessEnv = process.env, execArgv: readonly string[] = process.execArgv): boolean =>
  !!env.NODE_TEST_CONTEXT || execArgv.includes("--test");

// 진짜 사용자의 홈(passwd). 시험이 HOME을 임시 폴더로 바꿔도 따라가지 않는다(mcc-run.ts rtsGuard와 같은 방식)
export function realHome(): string {
  try {
    return userInfo().homedir;
  } catch {
    return homedir();
  }
}

// dir가 운영 상태 폴더(~/.local/state/atc)나 그 아래인가. 문자열로만 비교한다(심볼릭 링크는 따라가지 않는다)
export function isRealStateDir(dir: string, home: string = realHome()): boolean {
  const real = resolve(join(home, ".local/state/atc"));
  const d = resolve(dir);
  return d === real || d.startsWith(real + "/");
}

export const STATE_GUARD_ERROR = "ATC-564: a test reached the production state folder";

// 시험 중에 운영 상태 폴더를 가리키면 오류 문구, 아니면 null. 던지기와 종료 코드는 config.ts가 한다
export function stateDirBlock(dir: string, test: boolean = underNodeTest(), home: string = realHome()): string | null {
  if (!test || !isRealStateDir(dir, home)) return null;
  return `${STATE_GUARD_ERROR} (${dir}). Import "./test-hermetic.ts" first in the test file, or set ATC_STATE_DIR or config.stateDir to a temporary folder before using it`;
}

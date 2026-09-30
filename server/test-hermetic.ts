import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 시험이 진짜 ~/.claude*, ~/.codex, ~/.local/state/atc를 읽지 않게 한다(ATC-190). 시험 파일의 **첫 import**로 부른다:
//   import "./test-hermetic.ts";
// config.ts는 처음 import될 때 HOME과 ATC_STATE_DIR를 읽으므로, 그보다 먼저 임시 폴더로 바꿔 둔다(ES 모듈은 import 순서대로 평가된다).
// 이미 ATC_STATE_DIR를 정한 시험(그 파일이 제 임시 폴더를 쓰는 경우)은 그대로 둔다. 임시 폴더는 시험 프로세스가 끝나면 OS가 치운다(tmpdir).
// 이 파일은 시험 전용이다: 운영 코드는 가져오지 않는다.

const root = mkdtempSync(join(tmpdir(), "atc-hermetic-"));
process.env.HOME = join(root, "home"); // homedir()가 이걸 따른다: ~/.claude, ~/.codex, ~/.local/bin/claude … 모두 없는 폴더
process.env.ATC_STATE_DIR ||= join(root, "state");
delete process.env.ATC_AIRPORTS_FILE; // 등록부 파일이 진짜 상태 폴더를 가리키지 않게
process.env.XDG_CACHE_HOME = join(root, "cache");

export const hermeticRoot = root;

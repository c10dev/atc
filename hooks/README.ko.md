# hooks — 점유 hook

[English](README.md) · **한국어**

각 세션이 어느 git 워크트리에서 일하는지 기록하는 Claude Code `PostToolUse` hook이다. atc는 이 기록을 **점유(Claim)**, 곧 세션(AIRCRAFT)과 워크트리(STAND)의 연결로 읽는다. Node 말고 의존성은 없다.

## 무엇을 기록하나

Edit·Write·MultiEdit·NotebookEdit·Bash 호출이 끝날 때마다 `claim.mjs`가 그 호출이 작업한 경로를 본다.

- Edit·Write·MultiEdit·NotebookEdit의 대상 파일
- Bash 명령의 **명령 위치**에 있는 `cd <dir>`·`git -C <dir>` 대상
- 그때의 세션 cwd

경로마다 위로 올라가며 `.git`이 있는 가장 가까운 디렉터리를 찾는다. `.git`이 **파일**이면 linked worktree이므로 점유를 남긴다. `.git`이 디렉터리(본 체크아웃)면 기록하지 않는다. 홈 폴더에서 멈추고, `/home/` 아래 경로만 본다.

경로를 언급만 하는 명령(`ls`, `cat`, `grep` …), `echo`·`printf`·`jq`의 인자 문자열, heredoc 본문, here-string, 주석은 점유를 만들지 않는다. 그래서 워크트리를 읽기만 한 리뷰어는 점유자로 잡히지 않는다.

## 점유 파일

```
~/.local/state/atc/claims/<sessionId>/<URL 인코딩한 워크트리 경로>.json
```

```json
{"sessionId":"…","workspace":"/home/…/worktrees/vocado-voc-191-…","since":"2026-09-26T07:12:03.000Z","tool":"Edit","agentId":null,"agentType":null}
```

- 파일은 처음 한 번 만든다(`since` = 처음 건드린 시각). 그 뒤로는 **mtime**만 갱신하고, atc는 이를 마지막 접촉 시각으로 읽는다. 생성은 배타적 쓰기라 동시 호출에도 안전하다.
- `since`는 두 경우에 새로 시작한다.
  - TTL이 지난 뒤 다시 건드릴 때
  - 이 세션이 마지막으로 건드린 뒤 다른 세션이 같은 워크트리를 잡았고, 지금 되찾을 때(A → B → A). 새로 시작하지 않으면 HANDOFF·충돌 판정이 틀린다.
- 서브에이전트 호출은 리더의 `session_id`로 기록되고 `agentId`·`agentType`이 채워진다.
- hook은 오류를 삼키고 항상 exit 0이라, 실패해도 세션을 방해하지 않는다.

| 환경 변수 | 기본값 | 뜻 |
|---|---|---|
| `ATC_STATE_DIR` | `~/.local/state/atc` | 점유를 쓰는 곳 |
| `ATC_CLAIM_TTL_MIN` | `180` | 마지막 접촉 뒤 점유가 끝난 것으로 보는 시간(분) |

## 설치

`~/.claude/settings.json`에 넣는다(절대 경로로, `async`라 세션을 기다리게 하지 않는다).

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit|NotebookEdit|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "\"/path/to/node\" \"/path/to/atc/hooks/claim.mjs\"",
            "timeout": 5,
            "async": true
          }
        ]
      }
    ]
  }
}
```

matcher는 `paths.mjs`의 `WORK_TOOLS`와 같게 둔다. 읽기 도구(Read, Grep …)는 일부러 점유로 치지 않는다.

끄려면 이 항목을 지우면 된다. `claims/` 폴더는 언제 지워도 된다.

## 파일

| 파일 | 역할 |
|---|---|
| `claim.mjs` | hook 본체. stdin으로 도구 호출을 받아 linked worktree를 찾고 점유 파일을 만들거나 갱신한다 |
| `paths.mjs` | `toolPaths(toolName, toolInput, cwd)` — 도구 호출 하나가 작업한 경로들. atc 서버도 같은 규칙으로 대화 기록을 읽어 ESTIMATED TRACK을 만든다(`server/sources/claude.ts`) |
| `paths.d.mts` | TypeScript 서버용 `paths.mjs` 타입 선언 |
| `shell.mjs` | `workTargets(command)` — 명령 위치의 `cd`·`git -C` 대상을 돌려주는 작은 셸 토크나이저(완전한 파서가 아님). 따옴표, `;` `&` `\|` `(` `)` `` ` `` `$(`, heredoc, `VAR=…`와 `if`·`then`·`time` 같은 앞 단어를 처리하고 `bash -c "…"` 안을 두 단계까지 본다. `git` 전역 옵션만 보므로 `git commit -C <commit>`은 경로가 아니다 |
| `shell.test.mjs` | 잡아야 하는 것과 건너뛰어야 하는 것 사례(`npm test`) |

atc가 점유로 HANDOFF와 충돌을 판정하는 방법은 저장소 [README](../README.ko.md#handoff와-충돌)에 있다.

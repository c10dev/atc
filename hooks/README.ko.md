# hooks — 점유 hook과 rules-drift hook

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

## rules-drift hook

`rules-drift.mjs`(ATC-42)는 세션이 시작된 뒤 규칙 파일이 바뀌면 돌고 있는 세션에 알린다. "CLAUDE.md 다시 읽어 주세요"를 누가 퍼뜨리지 않아도 된다. 세션의 다음 턴에 `hookSpecificOutput.additionalContext`로 unified diff를 넣는다.

| 모드 | hook 이벤트 | 하는 일 |
|---|---|---|
| `start` | `SessionStart` | 세션의 기준을 적는다: 감시 파일마다 해시와, 나중에 diff를 만들 내용. `startup`·`clear`·`compact`는 지금 파일에서 시작한다. `resume`은 기준을 그대로 둬서, 세션이 닫혀 있던 동안 바뀐 것도 다음 턴에 알린다 |
| `check` | `UserPromptSubmit`, `PostToolUse` | 해시를 비교한다. 파일이 바뀌었으면 바뀐 파일, unified diff, "이 세션이 시작된 뒤 규칙 파일이 바뀌었다" 한 줄을 출력하고, 새 해시를 확인한 것으로 적는다. `PostToolUse`에서는 30초에 한 번까지만 본다 |

- **감시 파일**은 명령줄로 정한다: `--root <저장소>`(기본 `$CLAUDE_PROJECT_DIR`, 없으면 hook의 `cwd`), `--files`(기본 `CLAUDE.md,AGENTS.md`, 저장소 안 경로만), 필요하면 `--ref <git ref>`. `--ref`를 주면 그 ref에 있는 파일은 ref에서, 없는 파일은 작업 트리에서 읽는다.
  - `--ref origin/main`을 주면 git이 추적하는 규칙 파일은 `origin/main`을 따른다. `origin/main`은 어느 세션이든 fetch하면 움직이므로, `--root`의 체크아웃이 뒤처져 있어도 된다. ref에 없는 규칙 파일(git이 추적하지 않는 파일)은 `--root`의 체크아웃에서 읽는다.
- **diff 상한**: 파일을 합쳐 150줄. 넘거나 이전 내용을 모르면, 그 파일을 Read로 다시 읽으라고 경로와 함께 적는다.
- **읽는 것**: 감시 파일뿐이다. 대화 기록(`transcript_path`)은 읽지 않고 네트워크도 쓰지 않는다. 한 번에 약 30ms.
- **fail open**: 오류(잘못된 stdin, 상태 폴더가 없거나 쓸 수 없음, 깨진 상태 파일)가 나면 아무것도 출력하지 않고 exit 0이다. 상태 파일이 깨지면 그 세션은 지금 파일에서 다시 시작한다. 감시 파일이 없는 것도 한 상태로 보고, 파일이 생기면 diff로 알린다.
- **상태**: `~/.local/state/atc/rules-ack/<sessionId>.json`(`root`, `ref`, `files`, 확인한 해시 `acked`, `startedAt`, `checkedAt`, `changedAt`)과 `rules-ack/blobs/<sha256>`(diff용 내용). `start`마다 7일 동안 확인이 없던 세션 기록과, 어느 기록도 가리키지 않는 내용을 지운다.
- **FLEET**: AIRCRAFT 카드마다 살아 있는 세션들의 상태가 보인다. "RULES current", 또는 "RULES 미확인 since <시각>"과 파일(시각은 마지막 변경: ref의 마지막 커밋이나 파일 mtime)이다. atc가 기록과 지금 파일을 직접 비교하므로, 쉬고 있는 세션도 뒤처졌으면 그렇게 보인다. 기록이 없는 AIRCRAFT에는 아무것도 보이지 않는다.

### 설치(vocado)

SUPERVISOR가 아래 항목을 vocado `.claude/settings.json`에 합친다(기계 경로를 저장소에 넣고 싶지 않으면 `.claude/settings.local.json`). context가 그 턴에 들어가도록 동기 hook으로 두고, `timeout`으로 시간을 묶는다.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"/home/c10/.nvm/versions/node/v24.19.0/bin/node\" \"/home/c10/projects/atc/hooks/rules-drift.mjs\" start --root /home/c10/projects/vocado_nextjs --ref origin/main",
            "timeout": 5
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"/home/c10/.nvm/versions/node/v24.19.0/bin/node\" \"/home/c10/projects/atc/hooks/rules-drift.mjs\" check --root /home/c10/projects/vocado_nextjs --ref origin/main",
            "timeout": 5
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "\"/home/c10/.nvm/versions/node/v24.19.0/bin/node\" \"/home/c10/projects/atc/hooks/rules-drift.mjs\" check --root /home/c10/projects/vocado_nextjs --ref origin/main",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

끄려면 항목을 지운다. `rules-ack/` 폴더는 언제 지워도 된다. 그러면 세션들이 지금 파일에서 다시 시작한다.

## health hook

`health.mjs`(ATC-47)는 세션이 멈추거나 무언가를 기다리는 순간을 남겨, atc가 FLEET에 그 까닭을 바로 보이게 한다(ATC-45의 pull 분류기는 대화 기록에 남은 것만 본다). 이벤트마다 한 줄을 `health/<sessionId>.jsonl`에 덧붙인다.

| hook 이벤트 | 남기는 것 |
|---|---|
| `StopFailure` | `{t, event, code, error}`와 `line`(오류 첫 줄, ≤200자). `code`는 서버의 `classifyError`로 뽑는다 |
| `Notification` `permission_prompt` / `elicitation_dialog` | `{t, event, code: "PENDING"}` — 세션 파일이 `busy`여도 승인을 기다리는 중임을 알린다 |
| `Notification` `idle_prompt` | `{t, event}`. 혼자서는 코드가 아니다 |
| `Stop`, `PostToolUse` | `{t, event}` — push 코드를 지운다 |

- 코드, 시각, 오류 첫 줄만 둔다. 메시지 본문은 남기지 않는다. hook 입력의 나머지 필드는 보지 않는다.
- 서버는 세션마다 파일의 마지막 줄을 읽어, 대화 기록의 마지막 사실보다 새로우면 그것을 쓴다. 그래서 승인 대기는 30분 `HUNG`을 기다리지 않고 `PENDING`으로 바로 보인다. `Stop`이나 다음 `PostToolUse`가 오면 다시 풀린다.
- hook은 아무것도 출력하지 않고 항상 exit 0이다. 쓰기 오류는 삼킨다. stdin을 읽어 한 줄 쓰고 끝나며 네트워크를 쓰지 않는다.
- 옵션: `ATC_STATE_DIR`(기본 `~/.local/state/atc`). `health/` 폴더는 언제 지워도 되고, 그러면 대화 기록만으로 판정한다.

### 설치(SUPERVISOR)

SUPERVISOR가 `~/.claude/settings.json`에 아래 항목을 넣는다(절대 경로, `async`라 세션을 기다리게 하지 않는다). `PostToolUse` 항목은 `matcher: "*"`를 따로 둬야 한다 — 지우기는 점유 도구뿐 아니라 모든 도구 호출에서 필요하다.

```json
{
  "hooks": {
    "StopFailure": [
      { "hooks": [{ "type": "command", "command": "\"/path/to/node\" \"/path/to/atc/hooks/health.mjs\"", "timeout": 5, "async": true }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "\"/path/to/node\" \"/path/to/atc/hooks/health.mjs\"", "timeout": 5, "async": true }] }
    ],
    "Notification": [
      { "matcher": "permission_prompt|idle_prompt|elicitation_dialog", "hooks": [{ "type": "command", "command": "\"/path/to/node\" \"/path/to/atc/hooks/health.mjs\"", "timeout": 5, "async": true }] }
    ],
    "PostToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "\"/path/to/node\" \"/path/to/atc/hooks/health.mjs\"", "timeout": 5, "async": true }] }
    ]
  }
}
```

끄려면 항목을 지운다.

## 파일

| 파일 | 역할 |
|---|---|
| `claim.mjs` | hook 본체. stdin으로 도구 호출을 받아 linked worktree를 찾고 점유 파일을 만들거나 갱신한다 |
| `paths.mjs` | `toolPaths(toolName, toolInput, cwd)` — 도구 호출 하나가 작업한 경로들. atc 서버도 같은 규칙으로 대화 기록을 읽어 ESTIMATED TRACK을 만든다(`server/sources/claude.ts`) |
| `paths.d.mts` | TypeScript 서버용 `paths.mjs` 타입 선언 |
| `shell.mjs` | `workTargets(command)` — 명령 위치의 `cd`·`git -C` 대상을 돌려주는 작은 셸 토크나이저(완전한 파서가 아님). 따옴표, `;` `&` `\|` `(` `)` `` ` `` `$(`, heredoc, `VAR=…`와 `if`·`then`·`time` 같은 앞 단어를 처리하고 `bash -c "…"` 안을 두 단계까지 본다. `git` 전역 옵션만 보므로 `git commit -C <commit>`은 경로가 아니다 |
| `shell.test.mjs` | 잡아야 하는 것과 건너뛰어야 하는 것 사례(`npm test`) |
| `rules-drift.mjs` | rules-drift hook(`start`, `check`)과 서버가 FLEET에 다시 쓰는 순수 함수(`statusOf`, `readRecords`, `readSource`) |
| `rules-drift.d.mts` | `rules-drift.mjs`의 타입 선언 |
| `rules-drift.test.mjs` | 변경 없음, diff 한 번 뒤 확인됨, 새 세션과 resume, fail open, diff 상한, `--ref`, 정리(`npm test`) |
| `health.mjs` | health hook. stdin으로 이벤트를 받아 `health/<sessionId>.jsonl`에 한 줄을 덧붙인다 |
| `health.d.mts` | `health.mjs`의 타입 선언 |
| `health.test.mjs` | 이벤트마다 줄 모양, 본문 없음, 지우기, fail open(`npm test`) |

atc가 점유로 HANDOFF와 충돌을 판정하는 방법은 저장소 [README](../README.ko.md#handoff와-충돌)에 있다.

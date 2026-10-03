# hooks — 점유·rules-drift·health hook, FUEL statusline

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

### atc에 걸린 것

atc 자신의 `.claude/settings.json`(ATC-295)이 atc 체크아웃이나 그 STAND(워크트리)에서 연 모든 세션에 이 hook을 건다. 그래서 돌고 있는 AIRCRAFT가 규칙 파일이 바뀔 때 diff를 받는다:

| 이벤트 | 모드 |
|---|---|
| `SessionStart` | `start` |
| `UserPromptSubmit`, `PostToolUse`(matcher `*`) | `check` |

- **파일:** `--files CLAUDE.md,AGENTS.md,docs/design-language.md,.claude/skills/atc-task/SKILL.md`와 `--ref origin/main`. STAND가 무엇을 체크아웃했든 파일은 `origin/main`을 따른다. atc에는 지금 `AGENTS.md`가 없다(없는 파일도 한 상태라, 생기면 diff로 보인다). `.claude/skills/atc-task/SKILL.md`는 **감시한다**: 팀 세션의 작업 절차라서, 바뀌면 `CLAUDE.md`가 바뀔 때처럼 돌고 있는 AIRCRAFT에 닿아야 한다.
- **명령:** `kill-guard` 항목과 같은 `$CLAUDE_PROJECT_DIR` / main 체크아웃 폴백(`f="$CLAUDE_PROJECT_DIR/hooks/rules-drift.mjs"; [ -f "$f" ] || f=/home/c10/projects/atc/hooks/rules-drift.mjs`). `--root`는 주지 않으므로 hook은 `$CLAUDE_PROJECT_DIR`(STAND), 없으면 hook의 `cwd`를 쓴다.
- **절대 막지 않는다:** 오류가 나면 hook은 아무것도 출력하지 않고 exit 0이며(Fail open 참조), 명령도 `; exit 0`으로 끝난다. node나 hook 파일이 없어도 프롬프트나 도구 호출을 막지 못한다. fail-closed(`|| exit 2`)인 `kill-guard`와 반대다. `hooks/rules-drift-settings.test.mjs`가 둘 다 확인한다.
- **긴 파일:** `docs/design-language.md`는 길다. 크게 고치면 150줄 상한에 닿아 세션에게 파일을 다시 Read하라고 알린다. 의도한 대체 동작이다.
- 머지 뒤 새로 LAUNCH한 atc AIRCRAFT는 FLEET 카드에 "RULES current"로 보인다. 머지 전에 시작한 세션은 새 항목의 기준이 첫 턴까지 없다(첫 `check`가 조용히 기준을 적는다).

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
| `Stop`, `PostToolUse`, `UserPromptSubmit` | `{t, event}` — push 코드를 지운다. `UserPromptSubmit`(ATC-86)은 지시가 들어온 순간이고, atc는 대화 기록이 따라오기 전에 cut `LIMIT`·`RESUME`을 풀 때 쓴다. `Stop`은 cut을 풀지 않는다(잘린 턴 자신의 끝이다) |
| `Notification` `quota_auto_resume_fired` / `_stale` / `_disabled` | `{t, event}`(ATC-86) — CLI 세션에서만. `fired`가 `RESUME`을 푼다 |

- 코드, 시각, 오류 첫 줄만 둔다. 메시지 본문은 남기지 않는다. hook 입력의 나머지 필드는 보지 않는다(`prompt`와 `last_assistant_message`도 남기지 않는다).
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
      { "matcher": "permission_prompt|idle_prompt|elicitation_dialog|quota_auto_resume_fired|quota_auto_resume_stale|quota_auto_resume_disabled", "hooks": [{ "type": "command", "command": "\"/path/to/node\" \"/path/to/atc/hooks/health.mjs\"", "timeout": 5, "async": true }] }
    ],
    "PostToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "\"/path/to/node\" \"/path/to/atc/hooks/health.mjs\"", "timeout": 5, "async": true }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "\"/path/to/node\" \"/path/to/atc/hooks/health.mjs\"", "timeout": 5, "async": true }] }
    ]
  }
}
```

ATC-86이 `UserPromptSubmit`을 더하고 `Notification` matcher를 넓혔다. ATC-86 전에 설치한 것도 계속 돌지만 빠른 해제는 없다.

끄려면 항목을 지운다.

## FUEL statusline

`fuel-statusline.mjs`(ATC-55, [docs/fuel.md](../docs/fuel.md) 6절)는 hook이 아니라 Claude Code **statusLine** 명령이다. Claude Code가 상태 줄을 다시 그릴 때마다 실행하고 stdin으로 JSON을 준다. Claude Code 2.1.283부터 그 JSON에 `session_id`와, 요금제(claude.ai) 로그인이면 `rate_limits`가 있다.

| 필드 | 뜻 |
|---|---|
| `rate_limits.five_hour` / `seven_day` | `{used_percentage, resets_at}`: 그 창에서 쓴 몫(0–100)과 reset(epoch 초). reset이 아직 오지 않은 창만 들어 있다 |
| `rate_limits.spend_limit` | 같은 모양, gateway 로그인만 |
| `context_window.context_window_size` | 세션의 지금 모델의 맥락 창 크기, 토큰(200000이나 1000000) |
| `model.id` | 모델 id, `[1m]` 포함(`claude-sonnet-5-5[1m]`) |
| (`rate_limits` 없음) | API 키, Bedrock, Vertex: 요금제 한도가 없다. 창 크기와 모델은 그래도 적는다 |

- `fuel/<sessionId>.jsonl`에 `{t, sessionId, rate_limits?, context_window_size?, model?}`를 덧붙인다(ATC-85). **숫자와 모델 id만** 두고, 줄에 담는 값이 앞 줄과 달라졌을 때만 쓴다(`rate_limits`가 없는 줄도 남긴다). 옛 줄(`rate_limits`만)은 전처럼 읽는다. 입력의 나머지(모델, 비용, 경로, workspace)는 보지 않는다.
- 상태 줄에 짧은 글 `FUEL 5h 82% · 7d 40%`를 출력한다. `--quiet`면 출력하지 않는다. 항상 exit 0이고 오류는 삼킨다. 네트워크를 쓰지 않는다.
- 서버는 파일마다 마지막 줄을 읽어 session → AIRCRAFT → ACCOUNT로 잇고([docs/fleet.ko.md](../docs/fleet.ko.md) 8.8), ACCOUNT마다 가장 새 값을 쓴다.
- 옵션: `ATC_STATE_DIR`(기본 `~/.local/state/atc`). `fuel/` 폴더는 언제 지워도 된다.

### 설치(SUPERVISOR)

SUPERVISOR가 `~/.claude/settings.json`에 아래를 넣는다(절대 경로). `statusLine`은 명령 하나라서, 이미 쓰는 상태 줄이 있으면 이것으로 바뀐다.

```json
{
  "statusLine": {
    "type": "command",
    "command": "\"/path/to/node\" \"/path/to/atc/hooks/fuel-statusline.mjs\""
  }
}
```

쓰던 상태 줄을 지키려면 작은 스크립트에서 둘을 같이 돌리고 내 것을 출력한다: `input=$(cat); printf '%s' "$input" | node /path/to/atc/hooks/fuel-statusline.mjs --quiet; printf '%s' "$input" | your-statusline`.

열려 있는 세션에 줄이 보이지 않으면 그 세션을 다시 시작한다. 다른 컴퓨터의 세션과 CREW 서브에이전트는 보고하지 않는다. ACCOUNT마다 살아 있는 CAPTAIN 세션 하나면 충분하다. 끄려면 `statusLine`을 지운다.

## 파일

| 파일 | 역할 |
|---|---|
| `claim.mjs` | hook 본체. stdin으로 도구 호출을 받아 linked worktree를 찾고 점유 파일을 만들거나 갱신한다 |
| `paths.mjs` | `toolPaths(toolName, toolInput, cwd)` — 도구 호출 하나가 작업한 경로들. atc 서버도 같은 규칙으로 대화 기록을 읽어 ESTIMATED TRACK을 만든다(`server/sources/claude.ts`) |
| `paths.d.mts` | TypeScript 서버용 `paths.mjs` 타입 선언 |
| `shell.mjs` | `workTargets(command)` — 명령 위치의 `cd`·`git -C` 대상을 돌려주는 작은 셸 토크나이저(완전한 파서가 아님). 따옴표, `;` `&` `\|` `(` `)` `` ` `` `$(`, heredoc, `VAR=…`와 `if`·`then`·`time` 같은 앞 단어를 처리하고 `bash -c "…"` 안을 두 단계까지 본다. `git` 전역 옵션만 보므로 `git commit -C <commit>`은 경로가 아니다 |
| `shell.test.mjs` | 잡아야 하는 것과 건너뛰어야 하는 것 사례(`npm test`) |
| `rules-drift.mjs` | rules-drift hook(`start`, `check`)과 서버가 FLEET에 다시 쓰는 순수 함수(`statusOf`, `readRecords`, `readSource`) |
| `cloud-setup.mjs` | Claude Code cloud 세션용 SessionStart hook(ATC-452): `CLAUDE_CODE_REMOTE=true`이면 필요할 때 Node 24를 내려받고 `npm ci`를 돌린다. 그 밖에서는 아무것도 하지 않는다. 늘 exit 0 |
| `rules-drift.d.mts` | `rules-drift.mjs`의 타입 선언 |
| `rules-drift.test.mjs` | 변경 없음, diff 한 번 뒤 확인됨, 새 세션과 resume, fail open, diff 상한, `--ref`, 정리(`npm test`) |
| `health.mjs` | health hook. stdin으로 이벤트를 받아 `health/<sessionId>.jsonl`에 한 줄을 덧붙인다 |
| `health.d.mts` | `health.mjs`의 타입 선언 |
| `health.test.mjs` | 이벤트마다 줄 모양, 본문 없음, 지우기, fail open(`npm test`) |
| `fuel-statusline.mjs` | FUEL statusline 명령. 숫자만 남긴 `rate_limits`와 창 크기, 모델 id를 `fuel/<sessionId>.jsonl`에 덧붙이고, 서버가 다시 쓰는 `parseRecord`·`lastRecord`·`lastRecordWith`를 둔다 |
| `fuel-statusline.d.mts` | `fuel-statusline.mjs`의 타입 선언 |
| `fuel-statusline.test.mjs` | 기록 모양, 숫자와 모델 id만, 바뀔 때만 쓰기(`rate_limits` 없이도), 출력 줄, fail open(`npm test`) |

atc가 점유로 HANDOFF와 충돌을 판정하는 방법은 저장소 [README](../README.ko.md#handoff와-충돌)에 있다.

## KILL GUARD (ATC-134)

`kill-guard.mjs`는 저장소 자체의 `.claude/settings.json`에 건 `PreToolUse(Bash)` hook이라, 이 저장소나 그 워크트리에서 연 세션은 모두 받는다. 2026-09-29 07:12에 한 팀의 `pkill -f "node server/index.ts"`가 시험 서버와 함께 운영 7700까지 껐다.

이런 명령은 exit 2로 막고(사유는 stderr):

- 패턴에 `server/index`·`atc`·`node`가 든 `pkill`/`killall`
- `kill $(pgrep …)`, `kill \`pidof …\``, `pgrep|ps|lsof … | xargs kill`
- `fuser -k`
- `systemctl [--user] stop|restart|try-restart|kill|disable|mask|isolate atc`(`atc.service`도)

`kill <pid>`, `kill "$(cat <임시 폴더>/server.pid)"`, `systemctl … atc-rts`, 읽기만 하는 `systemctl status`는 막지 않는다. 낱말만 들어 있는 명령(`echo 'pkill …'`, `grep`)도 통과한다. hook 입력을 읽거나 해석하지 못하면 막는다. 설정 항목은 `… || exit 2`이고, 프로젝트 폴더에 hook이 없으면(관제 폴더) main 체크아웃의 것(`/home/c10/projects/atc/hooks/kill-guard.mjs`)으로 돌아, hook이 없을 때는 통과하지 않고 막는다.

이 저장소에서 연 세션만 덮는다. 다른 저장소(vocado)의 세션에는 그 저장소 설정에 같은 hook이 있어야 한다.

## Policy hook (`policy.mjs`)

`policy.mjs`는 atc가 모든 AIRCRAFT LAUNCH에 `claude --bg --settings`로 더하는 `PermissionRequest` hook이다(ATC-369. `.claude/settings.json`에는 없어서 관제 세션과 직접 여는 세션은 받지 않는다). 권한 프롬프트가 뜰 호출마다 허용이나 거절로 답한다: AIRCRAFT의 STAND 안은 허용, 나머지(Claude 설정 폴더, STAND 밖 쓰기, 운영 상태, Playwright가 아닌 MCP 도구 …)는 거절. 거절은 한 줄(시각, REGISTRATION, 세션, 도구, class. 명령·경로 본문 없음)씩 `<상태 폴더>/policy-denials.jsonl`에 남는다. fail-closed. 인자: `--state <폴더> --aircraft <REGISTRATION>`. 규칙과 화면은 [docs/fleet.ko.md](../docs/fleet.ko.md) "AIRCRAFT policy hook과 STALE STOP as built (ATC-369)"에 있다. `policy.test.mjs`가 허용·거절 경우를 확인한다.

일부러 한 선택(ATC-369 검토): `kill <pid>`는 test-server가 저장한 PID로 서버를 끄는 길이라 늘 허용한다. 이름·패턴 kill과 `systemctl … atc`는 `kill-guard.mjs`가 막는다. 그래서 운영 7700의 PID를 직접 적은 `kill`은 두 hook 모두 못 막는다(hook은 PID가 누구 것인지 모른다). `source <atc>/.env.local`은 허용하고 그 파일의 `cat`은 거절한다: source는 값을 자식의 환경에만 싣고 출력하지 않는(test-server 처방) 것이고 읽기는 비밀이라 거절한다. hook은 모든 AIRCRAFT에 걸린다(vocado 팀도). 목록에 없는 명령·MCP 도구(`pnpm`, `psql`, `supabase`, `docker`, Playwright 말고는 모든 MCP, Linear도 포함)는 전에는 사람에게 물었을 호출이 이제 거절되므로, atc 밖 AIRCRAFT를 처음 LAUNCH한 뒤 거절 class를 본다.

두 번째 검토 뒤에 막은 것: `node -e`·`--eval`·`-p`·`-r`, `python3 -c`·`-`, stdin 코드(heredoc)와 `awk`·`less`·`more`는 거절한다. `node`·`python3`는 스크립트 파일만 돌리고 그 경로도 다른 인자처럼 분류한다. 읽기 명령(`cat`, `head`, `tail`, `ls`, `wc`, `stat`, `file`, `du`, `diff`, `sort`, `find`, `grep`, `rg`, `sed`, `jq`, `cut` ...)의 파일 인자는 모두 cwd 기준으로 풀어 분류하므로 `cat docs/../../.claude/x`, `jq . ~/.claude/x`도 거절된다(`grep`·`rg`·`sed`·`jq`의 첫 인자는 패턴·스크립트·필터). 인라인 git 설정(`git -c ...`)은 명령을 돌릴 수 있어 거절한다. `SendMessage`는 `OCC`·`TOWER`·`ENGINEERING`에게만 허용한다. 그대로 믿는 것: STAND 안의 스크립트와 `npm` 스크립트는 전처럼 돈다.

git(세 번째 검토): 읽기만 하는 동사(`status`, `diff`, `log`, `show`, `rev-parse`, `rev-list`, `ls-files`, `blame`, `grep` ...)는 어디서나 허용한다. 나머지 동사(`add`, `commit`, `push`, `fetch`, `pull`, `merge`, `rebase`, `checkout`, `switch`, `branch`, `restore`, `reset` ...)는 `cd`나 `git -C`를 거친 작업 폴더가 AIRCRAFT의 STAND 안일 때만 허용한다. 그래서 `cd /home/c10/projects/atc && git switch x`는 거절된다(`git:<동사>:outside-stand`). `git stash`는 list·show만(stash는 모든 워크트리가 함께 쓴다). `:`로 시작하는 push refspec(원격 브랜치 삭제)은 `--delete`처럼 거절한다. MCP: Playwright 말고는 모든 `mcp__` 도구를 거절한다. Linear MCP도 거절이다.

네 번째 검토: `gh pr checkout`은 작업 폴더의 브랜치를 바꾸므로 `git switch`처럼 STAND 안에서만 허용한다. `cp`는 목적지뿐 아니라 원본도 분류해서, 비밀(`.env*`, ssh 키)과 Claude 설정 폴더는 STAND 안으로 복사해 읽을 수 없다. PR에 하는 `gh api -X PATCH`는 `body` 필드만 바꿀 수 있다. `AskUserQuestion`은 사람을 기다리므로 거절한다. `source <저장소>/.env.local`은 그 STAND가 속한 저장소(STAND 경로로 구한다)와 atc의 기본 자리에서만 허용한다.

다섯 번째 검토: `gh api`와 `curl`의 HTTP 메서드는 모든 철자(`-X POST`, `-XPOST`, `-sXPOST`, `--method POST`, `--method=POST`, `--request=POST`)로 읽는다. GET·HEAD가 아닌 메서드는 쓰기이고, 모르는 철자는 `gh api`에서는 거절(`gh-api-method`), `curl`에서는 쓰기로 본다. 그래서 `curl -XPOST localhost:7700/...`과 `gh api -XDELETE ...`는 거절된다.

여섯 번째 검토: 파일을 쓰거나 읽거나 명령을 돌릴 수 있는 `sed` 스크립트(`w`, `W`, `e`, `E`, `r`, `R`, `s///`의 `w`·`e` 플래그)와 `sed -f`는 거절한다(`sed:script-io`, `sed:script-file`). `jq`의 `--rawfile`, `--slurpfile`, `--argfile`, `-f`, `-L`과 `import`·`include`·`env`·`$ENV`·`input_filename`을 쓰는 필터도 거절한다(`jq:file-read`).

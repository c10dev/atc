# Cloud FLIGHT: ATC FLIGHT 하나를 Claude Code cloud 세션에서 돌리기

**한국어** · [English](cloud.md)

SUPERVISOR가 ATC FLIGHT 하나를 Claude Code cloud 세션([claude.ai/code](https://claude.ai/code))에 보내는 방법과, 그 세션이 할 수 있는 일·없는 일이다. 함대 규모의 cloud 운용에 atc가 더 갖춰야 할 것은 [cloud-aircraft.md](cloud-aircraft.md)에 있고, 이 문서는 사용법이다(ATC-452).

## 1. cloud FLIGHT가 할 수 있는 일, 없는 일

| | cloud 세션 |
|---|---|
| 코드, `npm test`, `npx tsc --noEmit -p .`, `npx vite build`, `git push`, `gh pr create` | CI처럼 된다. Node 24와 `npm ci`는 SessionStart hook `hooks/cloud-setup.mjs`가 첫 턴 전에 한다 |
| 규칙 | 저장소의 `CLAUDE.md`, `.claude/settings.json` hook, skill(`atc-task`)이 따라온다. `~/.claude`(메모리, 사용자 MCP)는 안 따라온다 |
| STAND | 세션 자신의 clone. `EnterWorktree`·`cp -al node_modules` 없음. 브랜치는 `claude/atc-<n>-<짧은 이름>` |
| 명세 | 프롬프트 글(FLIGHT PLAN을 붙인다). `localhost:7700`은 닿지 않는다. claude.ai에서 Linear 커넥터를 켜 두었으면 읽을 수 있다 |
| 보고 | `SendMessage`가 없다. 최종 보고(`atc-task` 8절, 같은 고정 머리)를 세션의 마지막 글과 PR 코멘트에 쓴다 |
| 화면 확인 | Playwright MCP도 7702 시험 서버도 없다. 화면 FLIGHT(`web/`)는 로컬에서 한다 |
| atc에 보이는 것 | PR을 통해서만(LANDING, MCC INSPECTION, 등급은 로컬 PR과 같다). FLEET 줄, FUEL, DISPATCH 단계(READBACK, DEPARTED)는 없다. PR 브랜치에 `atc-<n>`이 있어 PR이 FLIGHT와 이어진다 |

실행 중인 화면이 필요 없는 문서·서버·테스트 작업이나 `auto`·`flagged` 작업에 쓴다. `user` 등급은 여전히 SUPERVISOR가 머지한다.

## 2. SUPERVISOR 일회성 준비

1. **[c10dev/atc](https://github.com/c10dev/atc) GitHub 접근.** 저장소에 Claude GitHub App을 설치하거나, 로컬 Claude Code에서 `/web-setup`으로 `gh` 로그인을 동기화한다.
2. **환경 설정**(claude.ai → Claude Code → 이 저장소의 환경):
   - *네트워크 접근*: 기본 "Trusted" 수준은 npm 레지스트리에 닿는다. hook은 Node도 `nodejs.org`에서 받는다. 막혀 있으면 "Custom"을 고르고 정확히 이 도메인을 허용한다:

     ```
     nodejs.org
     registry.npmjs.org
     github.com
     ```
   - *Setup script*: 필요 없다. SessionStart hook이 하므로 비워 둔다.
   - *환경 변수*: 필요 없다. 저장소가 공개라 `.env.local` 값을 넣지 않는다.
3. 한 번 확인한다: 저장소에서 cloud 세션을 열고 `node -v && ls node_modules | head -3`를 시킨다. `v24.x`와 패키지 이름이 나와야 한다.

## 3. FLIGHT 보내기

- 터미널: `claude --cloud "<프롬프트>"`. Desktop: 환경으로 **Cloud**를 고른다.
- 프롬프트는 FLIGHT PLAN 글이다: Linear 이슈 본문(목표, Done when, 제약)과 한 줄 `Use the atc-task skill. Branch claude/atc-<n>-<short name>. End with the section 8 report as a PR comment.` 세션이 명세를 읽을 다른 길이 없다.
- 다른 FLIGHT처럼 Draft 아닌 PR에 `Fixes ATC-<n>`을 쓴다. 브랜치 이름에 키가 있어 atc가 PR을 FLIGHT와 잇고, CI(`check`)와 MCC INSPECTION이 돈다. `auto`·`flagged` PR은 MCC가 착륙시키고 `user` PR은 SUPERVISOR를 기다린다.
- atc에서 cloud 세션을 RECALL하거나 메시지를 보낼 수 없다. 멈추려면 claude.ai에서 멈춘다. 후속(`GO AROUND`, `FIX`)은 PR HOLDER가 로컬 AIRCRAFT에 맡긴다.

## 4. 세션 시작 때 도는 것

`hooks/cloud-setup.mjs`(`.claude/settings.json` SessionStart에 등록):

- `CLAUDE_CODE_REMOTE`가 `true`가 아니면(모든 로컬 세션) 셸 줄이 node를 띄우기 전에 exit 0. 아무것도 돌지 않는다.
- `CLAUDE_CODE_REMOTE=true`: `node -v`가 24보다 낮으면 Node 24.19.0을 nodejs.org에서 `~/.cache/atc-node/v24.19.0`에 받고 `CLAUDE_ENV_FILE`로 뒤따르는 Bash 호출의 `PATH` 앞에 붙인다. `node_modules`가 없으면 `npm ci`.
- 실패는 stderr에 찍고 hook은 그래도 exit 0이라 내려받기가 깨져도 세션을 막지 않는다. 명령이 실패하면 `node -v`를 본다.
- `hooks/cloud-setup.test.mjs`가 임시 폴더에서 양쪽을 시험한다(내려받기와 `npm ci`는 막아 둠).

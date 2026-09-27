# atc 작업 규칙

**한국어** · [English](CLAUDE.en.md)

atc 코드를 고치는 세션(팀 세션, 사용자와 직접 작업하는 세션)이 지키는 규칙이다. 설계와 용어는 `README.ko.md`와 `docs/`에 있다.

**관제 세션은 제외.** `controller/`(TOWER), `occ/`(OCC), `crosscheck/`(CROSSCHECK) 폴더에서 연 세션은 그 폴더의 `CLAUDE.md`를 따른다. 이 파일도 함께 읽히지만, 관제 세션은 코드를 고치지 않으므로 아래 작업 규칙은 적용되지 않는다. 둘이 다르면 폴더의 `CLAUDE.md`가 우선이다.

## 작업 위치

- `/home/c10/projects/atc`(main 체크아웃)는 **운영 서비스 폴더**다. systemd 서비스가 여기서 빌드하고 돈다. 여기서 코드를 고치거나 브랜치를 바꾸지 않는다.
- 작업은 `origin/main` 기준 워크트리에서 한다: `git -C /home/c10/projects/atc worktree add /home/c10/projects/worktrees/atc-<작업> -b claude/<작업> origin/main`. node_modules는 `cp -al /home/c10/projects/atc/node_modules <워크트리>/node_modules`.
- git stash는 모든 워크트리가 함께 쓴다. 맨 `git stash`·`git stash pop`을 쓰지 않는다. 치워 둘 것은 임시 커밋으로.
- 운영 상태 `~/.local/state/atc/`(제안·CLEARANCE·FLEET·FLIGHT RECORDER)는 손대지 않는다. 시험은 임시 상태 폴더로 한다(아래).

## 검증

- `npm test`, `npx tsc --noEmit -p .`, `npx vite build`가 모두 통과해야 한다.
- 순수 함수는 `node:test`로 테스트한다(`server/*.test.ts`, `controller/*.test.mjs`, `occ/*.test.mjs`, `hooks/*.test.mjs`).
- 끝까지 확인할 때는 시험 서버를 7702에 띄운다: `(set -a; . /home/c10/projects/atc/.env.local; set +a; ATC_STATE_DIR=<임시 폴더> ATC_PORT=7702 node server/index.ts)`. 임시 폴더에는 필요한 등록부(`airports.json`, `fleet.json`)만 복사한다. `.env.local`(Linear API 키)은 복사하거나 출력하지 않는다. 끝나면 서버를 끄고 임시 폴더를 지운다.
- 화면은 Playwright로 연다. 시험 중에 실제 팀 세션에 메시지를 보내지 않는다.

## 운영

- 운영 서비스(7700)를 재시작하지 않는다. 배포(main fast-forward와 재시작)는 머지한 쪽, 곧 structure 세션이나 사용자가 한다.
- 관제 세션의 guard(`controller/guard.mjs`, `occ/send-guard.mjs`, `occ/mcp-guard.mjs`)는 fail-closed(`… || exit 2`)를 유지한다. 막는 조건을 약하게 바꾸려면 사용자에게 먼저 묻는다.

## git과 PR

- 커밋·푸시·PR은 작업 지시가 요구할 때 한다. 커밋 메시지와 PR 제목·본문은 영어로 쓴다.
- 커밋 메시지에 attribution 줄(Co-Authored-By 등)을 넣지 않는다. PR 본문 끝은 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- 팀 세션은 머지하지 않는다. 머지는 LANDING CLEARANCE 등급(`deploy/landing-tier.mjs`, 바뀐 파일 경로로 정함)을 따른다.
  - `auto`(서버·화면·문서·테스트)와 `flagged`(관제 세션 매뉴얼·CLI): CI(`check`)가 통과하고 structure 세션이 검토(테스트·타입·빌드·충돌)한 뒤 structure가 머지하고 배포한 다음 사용자에게 알린다. `flagged`는 보고에 바뀐 관제 규칙을 따로 적는다. GitHub auto-merge는 쓰지 않는다.
  - `user`(guard, `.claude/` 설정, 루트 `CLAUDE.md`, `.github/`, `package*.json`, `hooks/`, `deploy/`)는 사용자가 머지한다. 운영 상태 형식을 바꾸거나 되돌리기 어려운 PR, 검토에서 의심이 남는 PR도 structure가 `user`로 올린다.

## 코드

- Node 24가 TypeScript를 그대로 돌린다(`node server/index.ts`). `erasableSyntaxOnly`라 enum, 생성자 매개변수 속성, namespace를 쓰지 않는다.
- 서버는 Hono, 화면은 Vite + React 19. 계산은 순수 함수로 두고 입출력과 나눈다.
- 기록은 추가만 하는 JSONL(`proposals.jsonl`, `clearances.jsonl`, `schedule.jsonl`, `flight-recorder/`)이고, 설정·등록부는 원자적으로 바꿔 쓰는 JSON이다.
- 화면 색·글꼴은 `web/src/styles.css`의 `:root` 토큰만 쓴다(테마를 따라간다).
- 코드 주석은 주변처럼 한국어로 짧게 쓴다.

## 용어와 문서

- 항공 용어는 영어로 쓴다. 화면, 문서, 메시지 모두(AIRCRAFT, STAND, FLIGHT, READBACK, HOLD, CLEARANCE, HANDOFF …). "복창"처럼 한국어로 옮기지 않는다. 설명 문장은 한국어.
- 팀 세션 이름 `TEAM_X`는 REGISTRATION이다. atc의 말로 팀은 CAPTAIN이 이끄는 CREW가 모는 AIRCRAFT다(`docs/fleet.md`).
- `README`, `CHANGELOG`, `docs/dispatch`, `docs/naming`, `docs/occ`, `docs/fleet`, `docs/atfm`, 각 폴더 README는 영어판(`*.md`)과 한국어판(`*.ko.md`)을 함께 고친다. 관제 세션 폴더는 한국어 `CLAUDE.md`·`SKILL.md`가 원본이고 `*.en.md`가 번역이다.
- 바뀐 동작은 `CHANGELOG`의 `[Unreleased]`에 적는다.
- 사용자가 쓰는 방법이 바뀌면(탭, 흐름, 명령, 용어) `docs/guide/`의 사용 안내(DOCS 탭, 한국어)도 같이 고친다. 새 쪽을 만들면 `web/src/views/Docs.tsx`의 `DOC_NAV`에 넣는다.

## 계획과 아이디어

- 아직 하기로 정하지 않은 아이디어는 GitHub Issue에 `idea` 라벨로 둔다. 저장소 문서에 적지 않는다.
- 하기로 정한 것은 `docs/<주제>.md` 설계 초안으로 쓴다(Status 줄, Current facts, Principles, Implementation order, Risks, Decisions). 새 설계 문서는 영어로 먼저 쓴다. 채택되면 이슈에 문서를 링크한다.
- 단계로 올라간 것은 `docs/guide/stages.md`에, 남은 일은 그 설계 문서의 "Not built yet"에, 끝난 것은 `CHANGELOG`에 적는다.
- atc 작업은 Linear `atc` 팀(ATC)에 둔다. atc는 `LINEAR_TEAM_KEYS`의 팀을 모두 읽지만, DISPATCH와 SCHEDULE 후보는 설정한 팀(`dispatch.json`의 `candidateTeams`, 비면 주 팀)만 된다. 분류 라벨(`type`·`wake`·`rating:*`·`Risk`·`tail:*`)은 워크스페이스 라벨이라 두 팀이 같이 쓴다. 아이디어는 계속 GitHub `idea` 이슈에 둔다.

## 교신

- 다른 팀 세션에 메시지를 보내지 않는다. 결과와 막힌 점은 일을 맡긴 세션(또는 사용자)에게만 보고한다.

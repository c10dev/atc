# atc 작업 규칙

**한국어** · [English](CLAUDE.en.md)

atc 코드를 고치는 세션(팀 세션, ENGINEERING, 사용자와 직접 작업하는 세션)이 매 턴 지키는 규칙만 둔다. 절차와 점검표는 `.claude/skills/atc-task/SKILL.md`, 가끔만 필요한 규칙은 `docs/rules.ko.md`, 설계와 용어는 `docs/`에 있다. 한 규칙은 한 곳에만 둔다.

**관제 세션은 제외.** `controller/`(TOWER), `occ/`, `crosscheck/`, `mcc/`, `duty/`(DUTY) 폴더에서 연 세션은 그 폴더의 `CLAUDE.md`를 따르고(둘이 다르면 폴더 것이 우선), 코드를 고치지 않으므로 아래 작업 규칙은 적용되지 않는다. DUTY는 "git과 PR"과 `docs/rules.ko.md`의 문서·계획 규칙을 지킨다.

## 작업 위치

- `/home/c10/projects/atc`(main 체크아웃)는 **운영 서비스 폴더**다. 여기서 코드를 고치거나 브랜치를 바꾸지 않고, `git clean`·`git stash`와 `.claude/worktrees/`를 지울 수 있는 명령(재귀 삭제)도 쓰지 않는다.
- 작업은 `origin/main` 기준 STAND(워크트리)에서 한다. 백그라운드 AIRCRAFT는 `EnterWorktree name=atc-<n>-<짧은 이름>`으로 만들고(다음 FLIGHT는 `ExitWorktree action=keep` 뒤 새 `name`), `.claude/worktrees/` 밖 경로로 `path=` 진입하지 않는다(승인을 물어 세션이 멈춘다). 명령과 순서는 `atc-task` 2절.
- git stash는 모든 워크트리가 함께 쓴다. 맨 `git stash`·`git stash pop`을 쓰지 않는다. 치워 둘 것은 임시 커밋으로.
- 운영 상태 `~/.local/state/atc/`는 손대지 않는다. 시험은 임시 상태 폴더로 한다.

## 검증

- `npm test`, `npx tsc --noEmit -p .`, `npx vite build`가 모두 통과해야 한다. 세 명령은 `node server/verify-gate-cli.ts -- <명령>`(VERIFY GATE, `docs/verify-gate.md`)으로 돌리고, 게이트가 없다고 보고될 때만 맨 명령을 쓴다. `ssh`·`scp`는 직접 쓰지 않는다. 게이트의 전송 실패(종료 코드 75·76, 로컬 대체 실행)는 시험 실패가 아니다. 어디서 돌았든 얻은 종료 코드와 출력을 그대로 보고한다. 순수 함수는 `node:test`로 테스트한다.
- 서버를 직접 확인할 때는 Skill `test-server`를 쓴다(7702-7799, 임시 상태 폴더, `ATC_GITHUB=off`). 직접 띄우면 PID를 파일에 저장하고 `kill "$(cat <pid 파일>)"`로만 끈다. `pkill`·`killall`·`kill $(pgrep …)`처럼 이름·패턴으로 죽이지 않고, 내가 띄우지 않은 프로세스와 운영 7700은 건드리지 않는다(`hooks/kill-guard.mjs`가 막는다).
- 시험 중에 실제 팀 세션에 메시지를 보내지 않는다. `.env.local`은 복사하거나 출력하지 않는다.
- atc는 공개 저장소다. PR·이슈·브랜치에 스크린샷을 올리지 않는다(흐림 처리·이미지 전용 브랜치도 안 된다). 확인한 화면은 PR 본문에 글로 적는다.

## 운영

- 운영 서비스(7700)를 재시작하지 않는다. 배포는 RETURN TO SERVICE(`atc-rts` 유닛, 보통 MCC가 시작)로 한다(`docs/mcc.md`).
- 관제 세션의 guard(`controller/guard.mjs`, `occ/send-guard.mjs`, `occ/mcp-guard.mjs`)는 fail-closed(`… || exit 2`)를 유지한다. 막는 조건을 약하게 바꾸려면 사용자에게 먼저 묻는다.

## git과 PR

- 커밋·푸시·PR은 작업 지시가 요구할 때 한다. 커밋 메시지와 PR 제목·본문은 영어이고, 커밋 메시지에 attribution 줄(Co-Authored-By 등)을 넣지 않는다. PR 본문 끝은 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- PR은 Draft로 올리지 않는다(MCC는 Draft를 착륙시키지 않는다). 끝나지 않은 일은 보고만 한다.
- 팀 세션, DUTY, ENGINEERING은 머지하지 않는다. 머지는 LANDING CLEARANCE 등급(`deploy/landing-tier.mjs`, 바뀐 파일 경로로 정함)을 따른다.
  - `auto`(읽기만 하는 서버·화면·문서·테스트)와 `flagged`(관제 세션 매뉴얼·CLI, 외부 부작용이 있는 서버 코드): CI(`check`)와 MCC INSPECTION `pass`면 MCC가 착륙시키고, 사용자가 먼저 머지해도 된다. `flagged`는 PR 본문과 보고에 바뀐 관제 규칙과 외부 부작용 파일을 따로 적는다. GitHub auto-merge는 쓰지 않는다.
  - `user`(guard, `.claude/`, 루트 `CLAUDE.md`, `.github/`, `package*.json`, `hooks/`, `deploy/`, `rulebook/`)는 사용자가 머지한다. 단 K 승인 PR은 MCC(`docs/mcc.md`). 운영 상태 형식을 바꾸거나 되돌리기 어려운 PR, 검토에서 의심이 남는 PR도 `user`로 올린다(본문의 등급에 적고, MCC INSPECTION은 ESCALATE한다).
  - `user`이거나 ESCALATE된 PR은 본문에 "Behavior change" 절(BEFORE/AFTER 글자 그림, 형식은 `atc-task` 7절)을 둔다. MCC INSPECTION이 없거나 diff와 어긋난 그림을 P1로 지적한다.

## 코드

- Node 24가 TypeScript를 그대로 돌린다. `erasableSyntaxOnly`라 enum, 생성자 매개변수 속성, namespace를 쓰지 않는다. 서버는 Hono, 화면은 Vite + React 19. 계산은 순수 함수로 두고 입출력과 나눈다.
- 기록은 추가만 하는 JSONL, 설정·등록부는 원자적으로 바꿔 쓰는 JSON이다.
- 화면 색·글꼴은 `web/src/styles.css`의 `:root` 토큰만 쓴다. 화면을 바꾸는 PR은 `docs/design-language.md`(원칙, 3.5 Craft, 5절 점검표)를 따르고 해당 줄에 PR 본문에서 답한다.
- 코드 주석은 주변처럼 한국어로 짧게 쓴다.

## 용어와 문서

- 항공 용어는 영어로 쓴다(AIRCRAFT, STAND, FLIGHT, READBACK, HOLD, CLEARANCE, HANDOFF …). "복창"처럼 옮기지 않는다. 설명 문장은 SUPERVISOR가 읽는 글(화면, 문서, 보고, 사용자와의 대화)에서만 한국어이고, 일본어·중국어는 쓰지 않는다(ATC-150). 세션끼리 주고받는 글은 영어다(아래 "교신").
- `TEAM_X`는 REGISTRATION이다. 팀은 CAPTAIN이 이끄는 CREW가 모는 AIRCRAFT다(`docs/fleet.md`).
- 문서는 영어판과 한국어판을 함께 고치고, 바뀐 동작은 `changelog.d/ATC-n.md`·`.ko.md` 조각으로 남기며, 사용 방법이 바뀌면 `docs/guide/`도 고친다. 점검표는 `atc-task` 4절, 규칙 전체는 `docs/rules.ko.md` "문서".

## 계획·DUTY·Linear

- 아이디어는 GitHub Issue(`idea` 라벨), 하기로 정한 것은 `docs/<주제>.md` 설계 초안이다. 설계 문서의 상태 표시는 팀 PR이 고치지 않는다(`docs/rules.ko.md` "계획").
- 설계와 작업 지시서(Linear)는 **DUTY**(`duty/CLAUDE.md`)가 맡는다. ENGINEERING 세션은 break-glass로 같은 규칙을 따르고, 머지·배포와 팀 세션 교신은 하지 않는다(`docs/rules.ko.md` "DUTY").
- 팀 세션은 Linear에 쓰지 않는다(`Fixes ATC-n`이 머지 때 이슈를 닫는다). 부분만 끝내는 PR은 제목에 `ATC-n`을 넣지 않는다.

## 교신

- 세션끼리 주고받는 글(FLIGHT PLAN, READBACK·UNABLE·STANDBY·ROGER, CLEARANCE, CREW BRIEFING·CHANGE, 보고)은 영어, SUPERVISOR가 읽는 글은 한국어다(ATC-126). `[DISPATCH D-xxxx]`·`[OCC CC-xxxx]`·`[ATC C-xxxx]` 머리와 `READBACK …`·`UNABLE …`·`STANDBY …`·`ROGER …`는 guard가 읽으므로 그대로 쓴다.
- 다른 팀 세션에 메시지를 보내지 않는다. 결과와 막힌 점은 일을 맡긴 세션(OCC, ENGINEERING, 사용자)에게만 보고한다.
- atc OCC(운항관제 세션)에서 `[DISPATCH D-xxxx]`로 시작하는 FLIGHT PLAN을 받으면 리더가 그 메시지에 끝줄이 주는 답 한 줄 `READBACK D-xxxx @xxxxxx`로 답하고(`@xxxxxx`는 FLIGHT PLAN에 적힌 work-order 해시, 빠지면 거절된다. 해시가 없는 옛 FLIGHT PLAN은 `READBACK D-xxxx`), 맡지 못하면 `UNABLE D-xxxx — 사유`, 시간이 필요하면 `STANDBY D-xxxx`로 답한다. `[DISPATCH D-xxxx] RECALL`을 받으면 작업을 멈추고 `READBACK D-xxxx RECALL`로 답한다. `[OCC CC-xxxx]`로 시작하는 CREW CHANGE를 받으면 `READBACK CC-xxxx`로 답하고 그대로 팀원을 바꾼다(못 하면 `UNABLE CC-xxxx — 사유`). `[ATC C-xxxx]` CLEARANCE는 끝줄이 청하는 답으로 답한다(지시는 `READBACK`·`UNABLE`·`STANDBY`, 알림은 `ROGER C-xxxx`). STAND(worktree) 없이 하는 SURVEY·CHECK FLIGHT를 마치면 OCC에 결과 링크나 한 줄로 알린다.
- 직접 맡기는 지시(`BRIEF: DIRECT`)는 `READBACK ATC-n`으로 답한다. `GO AROUND`와 `FIX` CLEARANCE는 알림이 아니라 행동 지시다:
  - `GO AROUND`(ATC-128): `READBACK C-xxxx` → `origin/main`을 병합해(rebase 없이) 충돌을 풀고 충돌 조각을 대화에 보인다 → 검증 → 맨 `git push`(force 금지) → PR 본문에 푼 내용. 두 PR이 같은 동작을 다르게 바꿔 한쪽을 골라야 하면 풀지 말고 `UNABLE C-xxxx — 사유`.
  - `FIX`(ATC-270, 현재 head에 리뷰 지적): `READBACK C-xxxx` → 같은 브랜치에서 고치거나 안 고칠 것은 PR 본문에 이유(PILOT'S DISCRETION) → 검증 → push → 맡긴 세션에 보고. 못 고치면 `UNABLE C-xxxx — 사유`.
- 끝낸 일의 최종 보고는 고정 머리(`[TEAM_X → OCC] ARRIVED ATC-n · PR #n`와 `TIER`·`TESTS`·`DISCRETION`·`BLOCKED` 줄)로 시작한다. 형식은 `atc-task` 8절.

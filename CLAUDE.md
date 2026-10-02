# atc 작업 규칙

**한국어** · [English](CLAUDE.en.md)

atc 코드를 고치는 세션(팀 세션, ENGINEERING 세션, 사용자와 직접 작업하는 세션)이 지키는 규칙이다. 설계와 용어는 `README.ko.md`와 `docs/`에 있다.

**관제 세션은 제외.** `controller/`(TOWER), `occ/`(OCC), `crosscheck/`(CROSSCHECK), `mcc/`(MCC), `duty/`(DUTY, L1) 폴더에서 연 세션은 그 폴더의 `CLAUDE.md`를 따른다. 이 파일도 함께 읽히지만, 관제 세션은 코드를 고치지 않으므로 아래 작업 규칙은 적용되지 않는다. 둘이 다르면 폴더의 `CLAUDE.md`가 우선이다. DUTY는 문서와 Linear 이슈를 쓰므로 "git과 PR", "용어와 문서", "계획과 아이디어", "DUTY" 절의 규칙을 그대로 지킨다(작업 위치와 검증 절의 워크트리·시험 서버는 DUTY의 STAND와 서버가 대신한다: `duty/CLAUDE.md`).

## 작업 위치

- `/home/c10/projects/atc`(main 체크아웃)는 **운영 서비스 폴더**다. systemd 서비스가 여기서 빌드하고 돈다. 여기서 코드를 고치거나 브랜치를 바꾸지 않는다. 이 폴더 안의 `.claude/worktrees/`에 워크트리가 들어 있으므로, 여기서 `git clean`과 `git stash`를 쓰지 않고 워크트리를 지울 수 있는 명령(재귀 삭제, 폴더 통째 정리)도 돌리지 않는다.
- 작업은 `origin/main` 기준 워크트리에서 한다. 자리는 두 곳 모두 된다:
  - `/home/c10/projects/worktrees/atc-<작업>`(브랜치 `claude/<작업>`): `git -C /home/c10/projects/atc worktree add /home/c10/projects/worktrees/atc-<작업> -b claude/<작업> origin/main`.
  - `/home/c10/projects/atc/.claude/worktrees/<이름>`(브랜치 `worktree-<이름>`): Claude Code의 워크트리 도구(`EnterWorktree name=<이름>`)가 만든다.
  - 브랜치 접두어 `claude/`와 `worktree-`는 atc가 똑같이 읽는다. 이름에 key(`atc-<n>`)를 넣는다.
- 워크트리 도구를 쓰는 세션(백그라운드 AIRCRAFT)은 STAND를 `EnterWorktree name=atc-<n>-<짧은 이름>`으로 새로 만들고, 다음 FLIGHT는 `ExitWorktree action=keep` 뒤 새 `name`으로 옮긴다. `EnterWorktree path=`로 `.claude/worktrees/` 밖의 워크트리(예: `/home/c10/projects/worktrees/…`)에 들어가면 permission root 이동으로 승인을 물어 백그라운드 세션이 멈춘다. `.claude/worktrees/` 안의 기존 워크트리는 `path=`로 들어가도 묻지 않는다.
- node_modules는 어느 자리든 `cp -al /home/c10/projects/atc/node_modules <워크트리>/node_modules`.
- 끝난 워크트리는 `git worktree remove <경로>`(또는 도구의 `ExitWorktree action=remove`)로 치운다.
- git stash는 모든 워크트리가 함께 쓴다. 맨 `git stash`·`git stash pop`을 쓰지 않는다. 치워 둘 것은 임시 커밋으로.
- 운영 상태 `~/.local/state/atc/`(제안·CLEARANCE·FLEET·FLIGHT RECORDER)는 손대지 않는다. 시험은 임시 상태 폴더로 한다(아래).

## 검증

- `npm test`, `npx tsc --noEmit -p .`, `npx vite build`가 모두 통과해야 한다.
- 순수 함수는 `node:test`로 테스트한다(`server/*.test.ts`, `controller/*.test.mjs`, `occ/*.test.mjs`, `hooks/*.test.mjs`).
- 끝까지 확인할 때는 시험 서버를 7702에 띄운다: `(set -a; . /home/c10/projects/atc/.env.local; set +a; ATC_GITHUB=off ATC_STATE_DIR=<임시 폴더> ATC_PORT=7702 exec node server/index.ts) & echo $! > <임시 폴더>/server.pid`. `ATC_GITHUB=off`는 서버가 GitHub(`gh`)를 부르지 않게 한다(시험 서버가 SUPERVISOR의 토큰으로 GitHub를 폴링하지 않게). 확인이 실제 PR 자료를 필요로 할 때만 이 값을 빼고, 그때는 짧게만 돌린다. 임시 폴더에는 필요한 등록부(`airports.json`, `fleet.json`)만 복사한다. `.env.local`(Linear API 키)은 복사하거나 출력하지 않는다. 끝나면 서버를 끄고 임시 폴더를 지운다. 시험 서버는 띄울 때 PID를 저장하고(위 명령의 `& echo $! > <임시 폴더>/server.pid`. 서브셸의 `exec`가 PID를 node의 것으로 만든다) `kill "$(cat <임시 폴더>/server.pid)"`로만 끈다. `pkill`·`killall`이나 `kill $(pgrep …)`처럼 이름·패턴으로 죽이지 않고, 내가 띄우지 않은 프로세스는 건드리지 않는다(2026-09-29 사고: `pkill -f "node server/index.ts"`가 운영 7700까지 껐다. `hooks/kill-guard.mjs`가 이런 명령과 `systemctl --user stop|restart|kill atc`를 막는다). 직접 만든 실행 스크립트도 PID 파일을 반드시 쓴다.
- 화면은 Playwright로 연다. 시험 중에 실제 팀 세션에 메시지를 보내지 않는다.
- atc는 공개 저장소다. PR, 이슈, 브랜치에 스크린샷을 올리지 않는다(흐림 처리를 해도, 이미지만 담은 브랜치로도). 확인한 화면은 PR 본문에 글로 적는다.

## 운영

- 운영 서비스(7700)를 재시작하지 않는다. 배포(main fast-forward와 재시작)는 RETURN TO SERVICE(`atc-rts` 유닛)로 한다. MCC가 `land+rts` 모드인 지금(2026-09-29부터)은 MCC가 착륙 뒤 RTS를 시작한다(5분에 한 번까지 묶어서). 사용자는 화면의 UPDATE 바에서 먼저 시작해도 된다. ROLLBACK이 나면 사용자가 설정 창에서 MCC 모드를 다시 고를 때까지 RTS가 멈춘다(`docs/mcc.md` 5.1, 6).
- 관제 세션의 guard(`controller/guard.mjs`, `occ/send-guard.mjs`, `occ/mcp-guard.mjs`)는 fail-closed(`… || exit 2`)를 유지한다. 막는 조건을 약하게 바꾸려면 사용자에게 먼저 묻는다.

## git과 PR

- 커밋·푸시·PR은 작업 지시가 요구할 때 한다. 커밋 메시지와 PR 제목·본문은 영어로 쓴다.
- 커밋 메시지에 attribution 줄(Co-Authored-By 등)을 넣지 않는다. PR 본문 끝은 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- PR은 Draft로 올리지 않는다. MCC는 Draft를 착륙시키지 않아서(`docs/mcc.md` L2) 누가 Ready로 바꿀 때까지 멈춘다. 아직 끝나지 않은 일이면 PR을 올리지 말고 보고한다.
- 팀 세션, DUTY, ENGINEERING 세션은 머지하지 않는다. 머지는 LANDING CLEARANCE 등급(`deploy/landing-tier.mjs`, 바뀐 파일 경로로 정함)을 따른다.
  - `auto`(읽기만 하는 서버·화면·문서·테스트)와 `flagged`(관제 세션 매뉴얼·CLI, 외부 부작용이 있는 서버 코드): CI(`check`)가 통과하고 MCC INSPECTION이 `pass`면 MCC가 착륙시킨다(2026-09-29부터, 지금은 `land+rts` 모드, `docs/mcc.md` 5.1). 사용자가 먼저 머지해도 된다. `flagged`는 PR 본문과 보고에 바뀐 관제 규칙과 외부 부작용 파일을 따로 적는다. GitHub auto-merge는 쓰지 않는다.
  - `user`(guard, `.claude/` 설정, 루트 `CLAUDE.md`, `.github/`, `package*.json`, `hooks/`, `deploy/`)는 사용자가 머지한다. 운영 상태 형식을 바꾸거나 되돌리기 어려운 PR, 검토에서 의심이 남는 PR도 `user`로 올린다(PR을 올린 세션이 본문의 등급에 적고, MCC INSPECTION은 ESCALATE한다).
  - **user 등급이거나 ESCALATE된 PR(SUPERVISOR가 승인하는 PR)은 본문에 "Behavior change" 절을 둔다**(ATC-360). SUPERVISOR가 diff를 읽지 않고 atc의 동작이 무엇이 바뀌는지 보게 하려는 것이다. 절 안에 글자 그림 하나를 ``` 코드 블록으로 쓴다: `BEFORE`와 `AFTER` 두 줄(또는 mermaid `flowchart`)에 트리거 → 단계 → 결과를 화살표로 잇고, 바뀐 곳에 `*`를 붙인다. 이미지는 올리지 않는다(공개 저장소). PR 서랍은 코드 블록을 그대로 보인다. 동작이 바뀌지 않으면 그림 대신 한 줄 `Behavior change: none`. 그림은 diff와 같아야 한다 — MCC INSPECTION이 그림이 없는 것과 diff와 어긋난 그림을 P1로 지적한다.

## 코드

- Node 24가 TypeScript를 그대로 돌린다(`node server/index.ts`). `erasableSyntaxOnly`라 enum, 생성자 매개변수 속성, namespace를 쓰지 않는다.
- 서버는 Hono, 화면은 Vite + React 19. 계산은 순수 함수로 두고 입출력과 나눈다.
- 기록은 추가만 하는 JSONL(`proposals.jsonl`, `clearances.jsonl`, `schedule.jsonl`, `flight-recorder/`)이고, 설정·등록부는 원자적으로 바꿔 쓰는 JSON이다.
- 화면 색·글꼴은 `web/src/styles.css`의 `:root` 토큰만 쓴다(테마를 따라간다).
- 화면을 바꾸는 PR은 `docs/design-language.md`(원칙과 3.5 Craft)를 따르고, 5절 점검표 가운데 해당하는 줄에 PR 본문에서 한 줄씩 답한다.
- 코드 주석은 주변처럼 한국어로 짧게 쓴다.

## 용어와 문서

- 항공 용어는 영어로 쓴다. 화면, 문서, 메시지 모두(AIRCRAFT, STAND, FLIGHT, READBACK, HOLD, CLEARANCE, HANDOFF …). "복창"처럼 한국어로 옮기지 않는다. 설명 문장은 SUPERVISOR가 읽는 글(화면, 문서, 보고, 사용자와의 대화)에서만 한국어다. 세션끼리 주고받는 글은 영어다(아래 "교신").
- 팀 세션 이름 `TEAM_X`는 REGISTRATION이다. atc의 말로 팀은 CAPTAIN이 이끄는 CREW가 모는 AIRCRAFT다(`docs/fleet.md`).
- `README`, `CHANGELOG`, `docs/dispatch`, `docs/naming`, `docs/occ`, `docs/fleet`, `docs/atfm`, 각 폴더 README는 영어판(`*.md`)과 한국어판(`*.ko.md`)을 함께 고친다. 관제 세션 폴더는 한국어 `CLAUDE.md`·`SKILL.md`가 원본이고 `*.en.md`가 번역이다.
- 바뀐 동작은 `CHANGELOG`의 `[Unreleased]`에 들어간다. PR은 `CHANGELOG.md`·`CHANGELOG.ko.md`를 고치지 않고 조각 한 쌍(`changelog.d/ATC-n.md`·`ATC-n.ko.md`, `### Added`처럼 절 제목 아래 항목)을 더한다. 조각은 ENGINEERING이나 사용자가 `node server/changelog-fold.ts`로 접는다(`changelog.d/README.ko.md`).
- 사용자가 쓰는 방법이 바뀌면(탭, 흐름, 명령, 용어) `docs/guide/`의 사용 안내(DOCS 탭, 한국어)도 같이 고친다. 새 쪽을 만들면 `web/src/views/Docs.tsx`의 `DOC_NAV`에 넣는다.

## 계획과 아이디어

- 아직 하기로 정하지 않은 아이디어는 GitHub Issue에 `idea` 라벨로 둔다. 저장소 문서에 적지 않는다.
- 하기로 정한 것은 `docs/<주제>.md` 설계 초안으로 쓴다(Status 줄, Current facts, Principles, Implementation order, Risks, Decisions). 새 설계 문서는 영어로 먼저 쓴다. 채택되면 이슈에 문서를 링크한다.
- 단계로 올라간 것은 `docs/guide/stages.md`에, 남은 일은 그 설계 문서의 "Not built yet"에, 끝난 것은 `CHANGELOG`(조각)에 적는다.
- 설계 문서의 상태 표시는 DUTY(또는 ENGINEERING)가 머지 뒤 Linear를 보고 고친다: "Implementation order" 표의 ✅, `Status:` 줄, "Not built yet"에서 옮기기, `docs/guide/stages.md`의 단계. 팀 PR은 이것들을 고치지 않고, 만든 것을 그 기능을 설명하는 절 바로 뒤의 자기 절(`### F7 as built (ATC-57)`처럼 번호 없이)에만 적는다.
- atc 작업은 Linear `atc` 팀(ATC)에 둔다. atc는 `LINEAR_TEAM_KEYS`의 팀을 모두 읽지만, DISPATCH와 SCHEDULE 후보는 설정한 팀(`dispatch.json`의 `candidateTeams`, 비면 주 팀)만 된다. 분류 라벨(`type`·`wake`·`rating:*`·`Risk`·`tail:*`)은 워크스페이스 라벨이라 두 팀이 같이 쓴다. 아이디어는 계속 GitHub `idea` 이슈에 둔다.

## DUTY (설계와 작업 지시서, 옛 ENGINEERING)

- 설계와 작업 지시는 **DUTY**(`duty/`, L1, `docs/duty.md` 3.4·3.5)가 맡는다(항공사의 Technical Services가 하던 일). DUTY는 상설 관제 세션이라 SUPERVISOR가 atc 화면에서 말을 건다.
- 하는 일: 설계 문서(`docs/<주제>.md`)를 자기 STAND(`.claude/worktrees/duty-*`, 브랜치 `claude/duty-*`, 서버가 `atcctl duty stand`로 만든다)에서 쓰고 PR로 올린다. Linear 이슈(작업 지시서, EO)를 ATC 팀에 만들고 고치고 댓글을 단다(서버가 자기 키로 쓴다. DUTY에는 MCP가 없다). 큰 이슈(wake `J`)를 하위 이슈로 나눈다. 규칙의 자세한 것은 `duty/CLAUDE.md`다.
- 힘의 한계는 guard가 정한다(`duty/guard.mjs`, fail-closed): 자기 STAND 안의 `.md` 문서만 쓰고, git은 `-C <STAND>`의 정해진 형식(`add`·`commit`·`push -u origin claude/duty-*`·`fetch`·`merge origin/main`)만, `gh pr create --base main --head claude/duty-*`(Draft 없이)만 된다. 자기 권한을 정하는 파일(`duty/`, guard, `.claude/`, `.github/`, `package*.json`, `deploy/`, `hooks/`, 루트 `CLAUDE.md`, `.env*`)은 쓰지 못한다. 코드·시험 서버(L2), 머지·배포(L3), 팀 세션 메시지(L4)는 없다. Linear는 ATC 팀, 상태는 Backlog·Todo까지, 이슈를 지우거나 닫지 않는다. 켜는 것은 `duty.json`의 `l1`이고 기본은 꺼짐이다.
- DUTY의 PR도 같은 규칙이다: 영어, Draft 없음, 설계 PR의 제목·브랜치에 ATC key를 넣지 않고 `Fixes`는 PR이 이슈를 끝낼 때만, Linear 본문의 GitHub 참조는 전체 URL, 작업 지시서에는 우선순위를 정한다. 머지는 등급이 정한다(문서만이면 `auto`라 MCC가 착륙시킨다. `duty/` 같은 파일은 어차피 쓰지 못한다).
- **ENGINEERING 세션**(Claude 데스크톱 등에서 이 저장소를 열어 같은 일을 하는 작업 세션)은 break-glass로 남는다. 같은 규칙을 따르고, 머지·배포와 팀 세션 교신은 하지 않는다. 팀에 일을 보내는 것은 DISPATCH·OCC와 사용자 몫이다. 직접 배정할 문구는 `GET /api/dispatch/flight/<FLIGHT>/brief?to=TEAM_X`가 준다.
- Linear 이슈를 만들고 상태를 바꾸는 것은 DUTY(Backlog·Todo까지)와 사용자, break-glass의 ENGINEERING이다. 팀 세션은 Linear에 쓰지 않는다(`Fixes ATC-n`이 머지 때 이슈를 닫는다).

## 교신

- 세션끼리 주고받는 글은 영어로 쓴다(ATC-126): FLIGHT PLAN, READBACK·UNABLE·STANDBY·ROGER, CLEARANCE, CREW BRIEFING, CREW CHANGE, 팀·관제 세션에 보내는 보고와 메시지. SUPERVISOR가 읽는 글(사용자와의 대화, 화면, 관제 세션이 SUPERVISOR에게 남기는 로그)은 한국어다. `[DISPATCH D-xxxx]`·`[OCC CC-xxxx]`·`[ATC C-xxxx]` 머리와 `READBACK …`·`UNABLE …`·`STANDBY …`·`ROGER …`는 guard가 읽으므로 그대로 쓴다.
- SUPERVISOR가 읽는 글(이 세션의 턴 글, 질문, 요약)은 한국어로 쓰고 일본어·중국어는 쓰지 않는다(ATC-150). 세션끼리 주고받는 글은 그대로 영어다.
- 다른 팀 세션에 메시지를 보내지 않는다. 결과와 막힌 점은 일을 맡긴 세션(보통 ENGINEERING, 또는 사용자)에게만 보고한다.
- atc OCC(운항관제 세션)에서 `[DISPATCH D-xxxx]`로 시작하는 FLIGHT PLAN을 받으면 리더가 그 메시지에 `READBACK D-xxxx`로 답하고, 맡지 못하면 `UNABLE D-xxxx — 사유`, 시간이 필요하면 `STANDBY D-xxxx`로 답한다. `[DISPATCH D-xxxx] RECALL`을 받으면 작업을 멈추고 `READBACK D-xxxx RECALL`로 답한다. `[OCC CC-xxxx]`로 시작하는 CREW CHANGE를 받으면 `READBACK CC-xxxx`로 답하고 그대로 팀원을 바꾼다(못 하면 `UNABLE CC-xxxx — 사유`). `[ATC C-xxxx]` CLEARANCE는 끝줄이 청하는 답으로 답한다(지시는 `READBACK`·`UNABLE`·`STANDBY`, 알림은 `ROGER C-xxxx`). STAND(worktree) 없이 하는 SURVEY·CHECK FLIGHT를 마치면 OCC에 결과 링크나 한 줄로 알린다.
- TOWER의 `GO AROUND`(ATC-128)는 참고(INFO)가 아니라 행동 지시다. `READBACK C-xxxx`로 답하고, `origin/main`을 병합하거나 그 위로 rebase해 충돌을 풀고, 충돌 조각을 대화에 보이고, 검증(`npm test`·`tsc`·`vite build`)을 모두 돌린 뒤 `--force-with-lease`로만 push하고(맨 `--force`는 쓰지 않는다), PR 본문에 무엇을 어떻게 풀었는지 적는다. 두 PR이 같은 동작을 다르게 바꿔 한쪽을 골라야 하면 풀지 말고 `UNABLE C-xxxx — 사유`로 답한다.
- TOWER의 `FIX`(ATC-270)도 행동 지시다. PR의 현재 head에 리뷰 지적(MCC INSPECTION, REVIEW, Codex)이 있다는 알림이다. `READBACK C-xxxx`로 답하고, 같은 브랜치에서 지적을 고치거나 안 고칠 것은 PR 본문에 이유를 적고(PILOT'S DISCRETION), 검증을 돌려 push하고, 맡긴 세션에 보고한다. 못 고치면 `UNABLE C-xxxx — 사유`. `INFO`처럼 ROGER만 하고 기다리지 않는다. 지적은 새 head에서 다시 검사된다.
- ENGINEERING이나 사용자가 직접 맡기는 지시(`BRIEF: DIRECT`)는 `READBACK ATC-n`으로 그 세션에 답한다(`.claude/skills/atc-task/SKILL.md`). 끝낸 일의 최종 보고는 늘 일을 맡긴 세션에 보낸다 — FLIGHT PLAN으로 받았으면 OCC, 직접 지시로 받았으면 ENGINEERING이나 사용자다. 그 보고는 고정 머리로 시작한다(ATC-124, `atc-task` skill 8절): `[TEAM_X → OCC] ARRIVED ATC-n · PR #n`, 이어서 고정 줄 `TIER auto|flagged|user`, `TESTS <통과>/<전체> · tsc ✓ · build ✓`(코드·테스트가 바뀌지 않은 PR은 `TESTS n/a`), `DISCRETION <수> — …`(없으면 `none`), `BLOCKED none | …`, 그다음 자유 요약. PR이 없는 SURVEY·CHECK FLIGHT는 `PR #n` 대신 `RESULT <링크>`를 쓴다. 받은 세션(OCC, 또는 ENGINEERING)이 `atcctl dispatch report`로 고정 칸만 기록한다.

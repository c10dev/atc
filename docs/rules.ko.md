# 작업 규칙: 필요할 때만 읽는 것

**한국어** · 매 턴 읽는 규칙은 루트 `CLAUDE.md`, 절차와 점검표는 `.claude/skills/atc-task/SKILL.md`에 있다. 이 문서는 루트 `CLAUDE.md`에서 덜어 낸 규칙을 그대로 옮겨 둔 것이다(ATC-361). 문서를 쓰거나 계획을 세우거나 DUTY·ENGINEERING 일을 할 때 읽는다. 규칙 파일 크기 상한은 `deploy/rules-budget.json`이고 `deploy/rules-budget.test.mjs`가 CI에서 지킨다. 한 규칙은 한 곳에만 둔다: 여기에 있는 것은 `CLAUDE.md`나 `atc-task`에 다시 쓰지 않는다.

## 문서

- `README`, `CHANGELOG`, `docs/dispatch`, `docs/naming`, `docs/occ`, `docs/fleet`, `docs/atfm`, 각 폴더 README는 영어판(`*.md`)과 한국어판(`*.ko.md`)을 함께 고친다. 관제 세션 폴더는 한국어 `CLAUDE.md`·`SKILL.md`가 원본이고 `*.en.md`가 번역이다.
- 바뀐 동작은 `CHANGELOG`의 `[Unreleased]`에 들어간다. PR은 `CHANGELOG.md`·`CHANGELOG.ko.md`를 고치지 않고 조각 한 쌍(`changelog.d/ATC-n.md`·`ATC-n.ko.md`, `### Added`처럼 절 제목 아래 항목)을 더한다. 조각은 ENGINEERING이나 사용자가 `node server/changelog-fold.ts`로 접는다(`changelog.d/README.ko.md`).
- 사용자가 쓰는 방법이 바뀌면(탭, 흐름, 명령, 용어) `docs/guide/`의 사용 안내(DOCS 탭, 한국어)도 같이 고친다. 새 쪽을 만들면 `web/src/views/Docs.tsx`의 `DOC_NAV`에 넣는다.
- 팀 세션 이름 `TEAM_X`는 REGISTRATION이다. atc의 말로 팀은 CAPTAIN이 이끄는 CREW가 모는 AIRCRAFT다(`docs/fleet.md`).

## 계획

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
- Linear 이슈를 만들고 상태를 바꾸는 것은 DUTY(Backlog·Todo까지)와 사용자, break-glass의 ENGINEERING이다.

## STAND 이름과 브랜치

- 브랜치 접두어 `claude/`와 `worktree-`는 atc가 똑같이 읽는다. 이름에 key(`atc-<n>`)를 넣는다. 옛 방식 STAND는 `/home/c10/projects/worktrees/atc-<작업>`(브랜치 `claude/<작업>`), 워크트리 도구는 `/home/c10/projects/atc/.claude/worktrees/<이름>`(브랜치 `worktree-<이름>`)이다.

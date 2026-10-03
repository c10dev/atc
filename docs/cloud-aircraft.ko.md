# Cloud AIRCRAFT: Claude Code 클라우드 세션에서 FLIGHT 돌리기

**한국어** · [English](cloud-aircraft.md)

관제 세션(TOWER, OCC, MCC, DUTY)은 이 호스트에 두고, Claude Code 클라우드 세션([claude.ai/code](https://claude.ai/code), `claude --cloud`, 데스크톱 "Cloud")에서 도는 AIRCRAFT를 atc가 어떻게 띄우고, 보고, 듣고, 착륙시킬지 정한다.

> 상태(2026-10-03): 설계 초안. 구현된 것은 없다. 기존 작업 지시서 둘 위에 얹으며 둘은 바꾸지 않는다: ATC-451(저장소 hook이 어느 호스트에서나 node를 찾고 kill-guard는 fail-closed 유지)과 ATC-452(클라우드 세션 시작 때 Node 24와 `npm ci`, `atc-task`의 클라우드 소절, 사용법 문서 `docs/cloud.md`). SUPERVISOR용 사용법(GitHub 연결, 환경 설정, FLIGHT 보내는 법)은 ATC-452의 `docs/cloud.md`다. 이 문서는 atc 자신이 해야 할 일만 다룬다.

관련: [fleet.ko.md](fleet.ko.md)(AIRCRAFT, LAUNCH), [accounts.md](accounts.md)(ACCOUNT 폴더), [dispatch.ko.md](dispatch.ko.md)(FLIGHT PLAN, READBACK, ARRIVED 보고), [radio.md](radio.md), [fuel.md](fuel.md).

## 1. 지금 사실

2026-10-03 `origin/main`을 읽은 것이다.

- **LAUNCH는 로컬뿐이다.** `launchAircraft`(`server/session-control.ts`)는 ACCOUNT를 고르고(`launchAccountOf`: 요청, preferred, fallback, AIRCRAFT의 home), 로그인·FUEL hold면 거절하고, 그 ACCOUNT의 `CLAUDE_CONFIG_DIR`로 `systemd-run --user --scope` 안에서 `claude --bg …`를 돌린다. 성공은 출력에서 `jobIdOf`가 `backgrounded · <id> · <name>`을 찾았다는 뜻이다. 그 뒤 `agentRowsOf`가 ACCOUNT 폴더마다 `claude agents --json`으로 세션을 읽는다.
- **FLEET·health·FUEL이 읽는 것.** `server/sources/claude.ts`는 `<config dir>/projects/<cwd>/<session>.jsonl`, `sessions/`, `jobs/<id>/state.json`, 로컬 git worktree(`readWorkspaces`)를 읽는다. FUEL REMAINING은 로컬 세션의 statusline `rate_limits` 기록을 ACCOUNT별로 읽고(`docs/fuel.md` 6.1), FLIGHT별 비용은 transcript에서 온다. 클라우드 세션은 여기에 아무것도 남기지 않는다.
- **atc는 팀 메시지를 읽지 않는다.** 교신은 중계다. OCC가 `SendMessage`로 FLIGHT PLAN을 보내고, CAPTAIN이 같은 대화에서 답하면, OCC가 그 답을 `atcctl dispatch readback D-xxxx`, `unable`, `standby`, `dispatch report`로 atc에 옮겨 적는다(`controller/atcctl.mjs`, `server/arrival-report.ts` 머리 주석: "atc는 팀 메시지를 읽지 않는다"). 클라우드 세션은 메시지를 돌려보낼 수 없어서 OCC에 아무것도 닿지 않는다.
- **저장되는 ARRIVED 보고.** 고정 칸만(`parseReport`): `flight`, `pr` 또는 `result`, `tier`, `tests`, `discretion`, `blocked`. 자유 요약은 저장하지 않는다. `dispatch report`를 부를 수 있는 쪽이면 누가 기록해도 되고, 사실을 어디서 읽었는지는 상관없다.
- **PR → FLIGHT.** `ticketKeyFromBranch`(`server/sources/git.ts`, `server/linear-keys.ts`)는 `(^|[/_-])atc-?<n>($|[/_-])`를 대소문자 없이 찾으므로 `claude/atc-452-cloud-hooks`는 ATC-452다. `buildPulls`(`server/landing.ts`)는 브랜치, 그다음 PR 제목 끝의 `(ATC-n)`을 쓰고 `Fixes`는 쓰지 않는다. `Fixes`는 다른 곳에 이미 머지된 PR에만 쓴다(`sources/github.ts` `fixesKeyOf`). 브랜치와 제목에 key가 없는 PR은 FLIGHT가 없다: "PRs WITHOUT A FLIGHT"에 보이고 PR HOLDER가 DUTY로 보낸다(`server/pr-holder.ts` `holderOf`).
- **STAND가 없어도 LANDING은 깨지지 않는다.** `buildPulls`는 브랜치로 STAND를 찾고(`workspaces.find`), `standPath`와 LOS 경보에만 쓴다. 없으면 `standPath`는 null이고 `Boolean(stand && losStands.has(…))`는 false다. CLEARED, MCC INSPECTION, MCC 착륙은 STAND가 아니라 PR을 읽는다.
- **STAND가 없으면 DISPATCH 생애는 깨진다.** `syncOps`는 FLIGHT PLAN을 `accepted`에서 `departed`로 옮길 때 그 FLIGHT의 STAND를 볼 때(`standOf`)나 STAND 없는 티켓(SURVEY·CHECK)일 때만 옮긴다. 아니면 24시간 뒤 "READBACK 뒤 24시간 동안 STAND가 생기지 않음"으로 만료된다(`server/proposals.ts` 808줄 부근). FOLLOWING은 제안이 있는 FLIGHT(`accepted`, `departed`, `recalling` …)만 따라가므로, 제안이 없는 FLIGHT는 따라가지 않고 지연 검사도 일어나지 않는다.
- **PR HOLDER는 "이 PR을 쥔 세션이 없음"을 이미 다룬다.** 착륙 대기열의 PR에 GO AROUND나 FIX가 남아 있고 STAND를 쥔 세션이 없으면, 그 FLIGHT를 마지막으로 난 AIRCRAFT → TYPE RATING이 맞는 놀고 있는 AIRCRAFT → SUPERVISOR에게 RELAY 순으로 고른다(`holderOf`, ATC-354).
- **ATC-451·452에서 가져온 것(여기서 다시 확인하지 않음).** 클라우드 VM에는 `/home/c10/.nvm/...`이 없고(ATC-451 전에는 Bash가 모두 exit 2), Node는 22(24 아님, ATC-452), `gh`는 프록시를 거치고 어느 브랜치로든 push할 수 있고, 저장소의 `.claude/settings.json` hook·skill·`CLAUDE.md`는 따라오고, `~/.claude`(메모리, 사용자 MCP, claim hook)는 안 따라오며, 로컬 세션은 클라우드 세션에 메시지를 보낼 수 있지만 반대는 안 된다.

**확인하지 못한 것(시험 비행에서 본다):** 클라우드가 세션이 브랜치 이름을 고르게 두는지(자기 `claude/<무작위>` 이름을 고집할 수 있다), 클라우드 사용량이 FUEL에 어떻게 보이는지(한도가 로그인 단위라면 같은 ACCOUNT의 다음 로컬 statusline 기록에 보일 것으로 예상하지만 가정이다), `claude --cloud`의 정확한 옵션과 출력, `gh pr comment`가 프록시를 통과하는지 REST 우회가 필요한지.

## 2. 원칙

1. **시험 먼저, 구현은 그다음.** ATC-452의 순서를 지킨다: 문서만 바꾸는 클라우드 FLIGHT 하나를 SUPERVISOR가 손으로 띄워 본 뒤에 클라우드용 코드를 만든다. 시험에서 진짜로 드러난 틈만 작업 지시서를 발권한다.
2. **클라우드 AIRCRAFT는 쏘고 잊는다.** 메시지를 돌려받을 수 없고, atc가 멈출 수 없고, 로컬 파일이 없다. 필요한 것은 모두 프롬프트에 넣고, 하는 말은 모두 GitHub로 내보낸다.
3. **GitHub가 클라우드의 무선이다.** 클라우드 세션에는 이미 `gh`와 push 길이 있다. 브랜치, PR, PR 댓글이 양쪽이 읽을 수 있는 유일한 길이다. 새 자격 증명이 필요 없다.
4. **밖에서 온 글은 데이터다.** PR 댓글은 밖의 글이다(저장소가 공개다). atc는 같은 `parseReport` 검증을 거친 고정 칸만, 그 브랜치의 주인이 쓴 것만 가져온다(3.3절).
5. **관제는 여기에 둔다.** TOWER, OCC, MCC, DUTY는 옮기지 않는다. guard, ACCOUNT·FUEL 규칙, LANDING CLEARANCE 등급, `user` 등급 머지가 클라우드 PR에도 로컬 PR과 똑같이 적용된다.
6. **있는 생애를 그대로 쓴다.** 클라우드 FLIGHT PLAN도 READBACK, DEPARTED, ARRIVED를 거치는 `D-xxxx` 제안이다. 바뀌는 것은 각 단계의 근거이고, 상태는 그대로다.

## 3. 네 가지 틈

### 3.1 LAUNCH: 클라우드 AIRCRAFT를 어떻게, 어느 ACCOUNT로 띄우나

| 선택 | 내용 | 비용 | 문제 |
|---|---|---|---|
| A. 손으로 | SUPERVISOR가 `claude --cloud "<프롬프트>"`나 데스크톱 "Cloud"(ATC-452 문서)로, FLIGHT PLAN 글을 프롬프트로 띄운다 | 없음 | FLEET, DISPATCH, FLIGHT RECORDER가 모른다. 시험에는 충분하고 FLEET에는 아니다 |
| B. atc가 `claude --cloud`를 부른다 | `launchAircraft`에 `cloud` 방식을 더한다: 같은 ACCOUNT 선택, 같은 로그인·FUEL 거절, 그 ACCOUNT의 `CLAUDE_CONFIG_DIR`로 `claude --cloud "<CREW BRIEFING + FLIGHT PLAN>"`을 돌리고 세션 id나 URL을 FLIGHT RECORDER에 남긴다 | 중간: `--bg` job id가 없어 `jobIdOf`와 `agentRowsOf`가 맞지 않고 결과 형식이 새로 필요하다 | `claude --cloud`의 옵션과 출력이 확인되지 않았다. 클라우드 세션은 STOP·RESTART·RELAY를 할 수 없다 |
| C. DISPATCH가 알아서 클라우드를 고른다 | 로컬 AIRCRAFT가 바쁘면 planner가 클라우드를 고른다 | 높음 | SUPERVISOR가 쓰겠다고 하지 않은 곳에서 요금제 한도를 쓴다. B와 비용 결정이 먼저 필요하다 |

**어느 ACCOUNT.** 클라우드 세션은 그것을 띄운 claude.ai 로그인(`claude --cloud`를 부른 `CLAUDE_CONFIG_DIR` 폴더, 또는 데스크톱 로그인)에 속하고 그 계정의 요금제 한도를 쓸 것으로 예상한다(시험에서 확인, 1절). 그래서 클라우드 AIRCRAFT의 ACCOUNT는 띄운 폴더이고, B는 `launchAccountOf`와 `launchAccountRefusal`을 그대로 쓴다: FUEL hold인 ACCOUNT의 클라우드 LAUNCH는 로컬과 똑같이 거절된다. 시험 비행에서는 SUPERVISOR가 여유가 가장 큰 ACCOUNT(지금은 주간 14%인 `acct-2`)를 고르고 적어 둔다.

**정체성.** REGISTRATION 모델을 유지한다: 클라우드 AIRCRAFT는 `launch: "cloud"`인 FLEET 항목(AIRPORT의 REGISTRATION, TYPE RATING 포함)이고, 그 AIRCRAFT에 가는 FLIGHT PLAN마다 **새** 클라우드 세션을 띄운다. 제안, RATING, 동시 상한, ACCOUNT 계산이 모두 REGISTRATION을 key로 하므로 하나도 바뀌지 않는다. 세션은 일회용이다: RESTART, CREW CHANGE, REFRESH는 없다.

**권고.** 시험: A. 시험이 잘 끝난 뒤: B, 다른 조종 장치처럼 기본 꺼진 스위치와 오발 카운터 뒤에. C는 제안하지 않는다. **시험 비행을 막지 않는다.**

### 3.2 FLEET, FUEL, 상태

클라우드 세션이 지금 atc에 남기는 것: `projects/`, `sessions/`, `jobs/`, 로컬 worktree에 아무것도 없다. 그래서 FLEET 줄, STALLED·LIMIT health, FLIGHT별 비용, CLAIM·DEPARTURE LOG 줄이 없다. 밖에 남기는 것: 원격 브랜치 `claude/atc-<n>-…`, PR, (쓰면) PR 댓글.

| 선택 | 내용 | 문제 |
|---|---|---|
| A. 아무것도 안 한다 | 클라우드 FLIGHT는 PR로만 보인다(LANDING, 제안이 있으면 FOLLOWING) | PR 전에는 "하늘에 있음" 신호가 없다. PR을 안 여는 클라우드 FLIGHT는 조용하다 |
| B. GitHub에서 읽는다 | snapshot의 GitHub 원천이 claude 접두어와 FLIGHT key가 있는 원격 브랜치도 센다. 로컬 worktree 없는 원격 브랜치는 **원격 STAND**로 본다: `departed`(첫 push 시각), WAKE 기대 시간 뒤 `no-pr`, FLEET에 "CLOUD · 브랜치 · 마지막 push" 한 줄 | 브랜치 목록을 새로 읽는다(AIRPORT마다 `gh api` 호출 하나, GitHub 한도). 브랜치 시각은 시작 시각이 아니라 push 시각이다 |
| C. 클라우드 세션 목록 | Claude에서 클라우드 세션 목록(상태, id)을 받는다 | CLI·API가 있는지 모른다. SUPERVISOR의 로그인이 필요할 것이다. 기대지 않는다 |

**FUEL.** 한도가 로그인 단위라면 ACCOUNT 단위 FUEL REMAINING에는 클라우드 사용량이 들어간다(가정). 클라우드 FLIGHT의 FLIGHT별 비용은 모른 채로 두고 "n/a (cloud)"로 보이며, FLIGHT 비용 기준선과 leak 탐지에는 넣지 않는다(확인 안 함: `fuel-leaks.ts`는 FLIGHT를 모르는 세션을 기준선에만 넣는데, transcript가 전혀 없는 FLIGHT에도 그대로 맞을 수 있다. C2가 시험으로 못 박는다). 추정하지 않는다.

**권고.** 시험: A. 시험 뒤: B. 3.3절과 DISPATCH 생애가 클라우드 FLIGHT의 "departed" 사실을 필요로 하는데, 원격 브랜치가 그 유일한 사실이다. C는 Claude가 안정된 인터페이스를 내놓을 때만. **시험 비행을 막지 않는다.**

### 3.3 교신: READBACK, UNABLE, STANDBY, ARRIVED

클라우드 세션이 쓸 수 있는 곳은 GitHub(push, PR, PR 댓글, 이슈 댓글)와 자기 대화뿐이다. 길은 이렇다.

| 선택 | 내용 | 판단 |
|---|---|---|
| A. SUPERVISOR가 옮긴다 | SUPERVISOR가 클라우드 대화를 읽고 `atcctl dispatch report …`를 돌린다 | 코드 없음. 시험에는 충분하다. 규모가 안 되고 취지에 어긋난다 |
| B. 고정 보고 칸을 담은 PR 댓글 | 끝에 세션이 최종 보고 머리와 줄(`atc-task` 8절: `[TEAM_X → OCC] ARRIVED ATC-n · PR #n`, `TIER`, `TESTS`, `DISCRETION`, `BLOCKED`)을 PR 댓글로 올린다. 호스트의 읽는 쪽(서버의 GitHub tick, 또는 OCC)이 고정 줄을 `parseReport`로 읽어 `dispatch report`로 기록한다 | **권고.** 지금 OCC가 옮겨 적는 것과 같은 자료다. 댓글은 밖의 글이므로 검증된 고정 칸만 남기고, PR 작성자의 댓글만, 헤드 브랜치가 이 저장소 안인 PR(fork 아님)만 받는다 |
| C. 브랜치의 상태 파일 | 작업과 함께 `.atc/flight-ATC-n.json`을 push | 기본으로는 기각: 파일이 PR diff에 들어가 LANDING CLEARANCE 등급이 읽는 바뀐 파일 목록이 달라지고, 뒤의 push로 고쳐질 수 있다. PR로 열지 않는 곁가지 브랜치에서만 가능 |
| D. Linear 댓글 | 세션이 이슈에 쓴다 | 기각: 팀 세션은 Linear에 쓰지 않는다(루트 `CLAUDE.md`). 커넥터를 켜지 않으면 클라우드에는 Linear 접근도 없다 |

**READBACK, UNABLE, STANDBY.** 클라우드 FLIGHT에서는 LAUNCH가 곧 전달이므로 READBACK을 기다리지 않는다: 클라우드 LAUNCH를 STAND 없는 FLIGHT의 READBACK처럼 다룬다(그 경우를 위해 `departedVia: "readback"`이 이미 있다). 제안은 `sent`, 그리고 LAUNCH 때 `accepted`와 `departed`가 되고, 로컬 STAND 없이도 `departed`다. 원격 브랜치(3.2 B)가 일이 시작됐다는 뒤의 근거다. UNABLE의 길은 `BLOCKED`를 채운 ARRIVED식 PR 댓글뿐이거나 PR이 아예 없는 것이고, 뒤의 경우는 WAKE 기대 시간 뒤 `no-pr`로 잡힌다. 그래서 UNABLE이 로컬보다 느리다(분이 아니라 시간 단위). 쏘고 잊는 방식의 값이다. STANDBY는 쓰지 않는다.

**들어오는 길.** 클라우드 PR의 GO AROUND나 FIX는 새 길이 필요 없다. STAND가 쥐고 있지 않으면 PR HOLDER가 이미 로컬 AIRCRAFT를 고른다. 클라우드에서 만든 브랜치를 로컬 AIRCRAFT가 이어 갈 수 있는지(자기 STAND로 가져와 `origin/main`을 병합하고 push)는 시험된 적이 없다: 클라우드 PR이 한 번 머지된 뒤 두 번째 시험 비행으로 한다. 클라우드 세션에 메시지를 넣는 것(`claude -p … --cloud <id>`)은 필요하지 않아 제안하지 않는다.

**권고.** 시험: A에 프롬프트 한 줄만 더한다(작업 지시서 아님): "최종 보고 칸을 PR 댓글로도 올려라". 그러면 B의 글이 실제로 생기고, `gh pr comment`가 되는지도 시험에서 본다. B의 읽는 쪽은 시험 뒤에 만든다. **시험 비행을 막지 않는다.**

### 3.4 PR → FLIGHT, 그리고 없는 STAND

위(1절)에서 확인한 것을 시험용 점검표로 옮기면:

- **연결은 브랜치 이름이 한다.** LANDING에서는 그 밖에 없다. ATC-452가 이미 브랜치를 `claude/atc-<n>-<짧은 이름>`으로 정한다. 클라우드가 key 없는 브랜치 이름을 강제하면 그 PR은 FLIGHT가 없어 "PRs WITHOUT A FLIGHT"에 보이고 DUTY로 간다. 제목 끝 `(ATC-n)`도 연결하지만, 루트 `CLAUDE.md`는 이슈를 끝내는 PR이 아니면 제목에 key를 쓰지 못하게 한다. 그래서 key는 브랜치에 두고, 제목 key는 이슈를 끝내는 PR(문서만 바꾸는 시험 이슈가 그렇다)에만 쓴다.
- **`Fixes ATC-n`은 머지 때 Linear 이슈를 닫는다.** atc에서 PR을 FLIGHT에 연결하지는 않는다. 이미 머지된 PR에만 쓰이는 두 번째 방어선이다.
- **STAND 없음:** LANDING, CLEARED, MCC INSPECTION, 머지는 된다. LOS 경보는 이 PR의 STAND를 짚을 수 없다(부딪힐 worktree가 없다). `standPath`는 null이고 어디서도 오류로 읽지 않는다. 다만 `D-xxxx` 제안이 STAND로는 `departed`에 닿지 않는데, 3.3절이 클라우드 LAUNCH를 DEPARTED로 다루어 푼다.
- **제안이 없는 클라우드 FLIGHT**(시험 비행)는 FOLLOWING에 아예 없다. LANDING에 PR만 있다. 시험 비행에는 그게 맞다.

**권고.** 코드는 없다. 이것을 건드리는 첫 작업 지시서(3.2 B)의 시험이 `ticketKeyFromBranch("claude/atc-452-x")`, `buildPulls`의 없는 STAND, 원격 STAND가 있는 제안 생애를 못 박는다. **시험 비행을 막지 않지만**, 시험은 클라우드가 실제로 만든 브랜치 이름을 적어 와야 한다.

## 4. 첫 시험을 막는 것

| 틈 | 시험을 막나 | 이유 |
|---|---|---|
| ATC-451, ATC-452 | **막는다** | 없으면 Bash가 모두 exit 2이고 Node 24도 없다(기존 작업 지시서) |
| 3.1 LAUNCH | 아니다 | SUPERVISOR가 손으로 띄운다 |
| 3.2 FLEET, FUEL | 아니다 | PR은 LANDING에 보인다. FLEET 줄이 없는 것이 시험이 보려는 것이다 |
| 3.3 교신 | 아니다 | 프롬프트 한 줄로 보고가 PR 댓글이 되고, SUPERVISOR가 손으로 기록할 수 있다 |
| 3.4 PR → FLIGHT | 아니다, 하지만 관찰 | 브랜치 이름만 중요하고, 시험이 클라우드가 만든 이름을 보여 준다 |

**ATC-452가 들어간 뒤 할 시험 비행:** Backlog(Todo 아님: DISPATCH가 로컬 AIRCRAFT에게도 주지 않도록)에 둔 문서만 바꾸는 이슈, FLIGHT PLAN 없이, SUPERVISOR가 FUEL 부담이 가장 적은 ACCOUNT에서 `claude --cloud`로 띄운다. 적어 올 것: 만들어진 브랜치 이름, `Fixes`와 제목 key가 살아남는지, 전후 FUEL, `gh pr comment`가 되는지, PR이 CLEARED와 MCC INSPECTION에 닿는지, FLEET과 FOLLOWING이 무엇을 보였는지.

## 5. 구현 순서

아무것도 발권하지 않았다. 모두 Backlog에 ATC-452로 막아 올린다. 시험 뒤 어느 것이 진짜인지는 SUPERVISOR가 정한다. 아래 순서는 시험 뒤에 이어질 순서이지 약속이 아니다.

| 단계 | 내용 | 필요 | 등급 | WAKE |
|---|---|---|---|---|
| C1 (ATC-484) | 클라우드 보고 읽기: 헤드가 저장소 안인 브랜치의 PR 작성자 댓글에서 최종 보고 칸을 `parseReport`로 읽어 `dispatch report`로 기록. 기본 꺼짐, 오발 카운터, 고정 칸만 | 시험, ATC-452 | `flagged` | M |
| C2 (ATC-485) | 원격 STAND: FLIGHT key가 있는 원격 브랜치를 세어 로컬 worktree 없는 브랜치에 `departed`, `no-pr`, FLEET 줄을 준다. 3.4절의 없는 STAND 경우를 못 박는 시험 | 시험, ATC-452 | `auto` | M |
| C3 (ATC-486) | LAUNCH CLOUD: `launchAircraft`의 `cloud` 방식(ACCOUNT, 로그인·FUEL 거절 재사용), FLIGHT PLAN을 프롬프트로, 세션 id를 FLIGHT RECORDER에, LAUNCH 때 DEPARTED. 스위치 뒤, 기본 꺼짐 | 시험, ATC-452, C2 | `flagged` | H |
| 그 뒤 | 두 번째 시험: GO AROUND·FIX 뒤 로컬 AIRCRAFT가 클라우드 브랜치를 이어 간다 | 머지된 클라우드 PR | — | — |

## 6. 위험

| 위험 | 대응 |
|---|---|
| 클라우드가 자기 브랜치 이름을 강제한다 | 시험이 적어 온다. 못 바꾸면 PR 제목 key로 잇고 `buildPulls`를 `Fixes` 줄까지 넓힌다: `server/landing.ts`를 고치는 코드 변경이고 "PR 제목 key가 이슈를 닫는다" 규칙도 다시 봐야 한다 |
| 공개 저장소의 PR 댓글은 밖의 글이다 | 고정 칸만 `parseReport`로, PR 작성자만, 저장소 안 브랜치만. 댓글은 지시가 되지 않는다(C1) |
| 중복 일: Todo 이슈를 DISPATCH가 로컬 AIRCRAFT에 주는데 클라우드 세션도 한다 | 시험은 Backlog 이슈로 한다. C3 뒤에는 제안 자체가 유일한 주인이다 |
| 클라우드 사용이 FLIGHT에 귀속되지 못한 채 ACCOUNT 한도를 쓴다 | ACCOUNT FUEL에는 보인다(가정). FLIGHT별 비용은 "n/a (cloud)" |
| atc가 클라우드 세션을 멈출 수 없다 | SUPERVISOR가 claude.ai 화면에서 멈춘다. C3에는 STOP이 없고 카드가 그렇게 말한다 |
| 클라우드의 hook과 guard | ATC-451이 kill-guard를 fail-closed로 둔다. 돌지 못하는 guard는 모두 막는다 |
| `claude --cloud`는 연구 프리뷰라 바뀔 수 있다 | C3는 시험을 기다리고, 정확한 명령줄은 한 함수에만 둔다 |

## 7. 결정

| # | 질문 | 결정 |
|---|---|---|
| D1 | 클라우드 AIRCRAFT의 정체성 | `launch: "cloud"`인 FLEET REGISTRATION. FLIGHT PLAN마다 새 세션(제안) |
| D2 | 클라우드 ARRIVED 보고가 가는 곳 | 최종 보고 칸을 담은 PR 댓글을 호스트가 읽는다(제안) |
| D3 | 클라우드 FLIGHT의 READBACK·DEPARTED 근거 | 클라우드 LAUNCH가 READBACK이자 DEPARTED, 원격 브랜치가 뒤의 근거(제안) |
| D4 | 첫 시험의 ACCOUNT | 여유가 가장 큰 쪽을 SUPERVISOR가 고른다 |
| D5 | atc가 클라우드 세션을 직접 띄우나 | 시험 뒤에 정한다(그때까지 C3는 Backlog) |

## 아직 만들지 않은 것

3–5절 전부.

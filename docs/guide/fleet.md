# 팀 운영 (FLEET)

FLEET 탭에서 팀(AIRCRAFT)을 꾸리고, 쉬게 하고, 퇴역시킨다. 팀 정보는 `~/.local/state/atc/fleet.json`에 저장되고 DISPATCH planner가 쓴다.

## 운항 상태 목록

FLEET PLAN 아래 **AIRCRAFT** 블록은 기본이 목록이다. AIRCRAFT 한 대가 한 줄이라, 지금 누가 무엇을 운항 중인지 한 화면에 보인다(10대면 1440×900 한 화면).

| 열 | 뜻 |
|---|---|
| AIRCRAFT | callsign과 REGISTRATION(`HOTEL TEAM_H`) |
| AIRPORT | 기지 AIRPORT |
| STATUS | AIRBORNE(작업 중) · HOLDING(대기 중인데 STAND를 쥠) · PARKED(대기, 쥔 STAND 없음) · AOG · NORDO(세션이 죽었는데 점유가 남음) · RESTARTING(`/clear` 뒤 첫 메시지를 기다리는 중, 30분까지) · NOT IN SERVICE(세션 없음) |
| FLYING | 지금 쥔 STAND의 FLIGHT 번호와 제목 한 줄. 여러 개면 `+2`처럼 나머지 수. 세션이 멈췄거나 무언가를 기다리면 앞에 health 표시가 붙는다(아래) |
| 경과 | 지금 쥔 STAND를 처음 잡은 뒤 흐른 시간(`3h05m`) |
| 마지막 활동 | 세션이 마지막으로 움직인 때(`12분 전`) |
| FOB | 그 AIRCRAFT 자기 연료: 살아 있는 세션의 맥락 창에 **남은** 몫과 크기(`FOB 50% · 504k/1M`). 남은 몫 60 % 이하부터 노랗게, 30 % 이하부터 빨갛게 보인다. 세션이 없거나 최근 7일 기록이 없으면 `—` |
| 이번 주 | 이번 주(월요일부터) ARRIVED 수와 정시율(기대 block time이 있는 FLIGHT만, 없으면 `—`) |

- **FOB**(FUEL ON BOARD)는 그 AIRCRAFT가 실제로 지고 있는 연료, 곧 맥락 창의 남은 몫이다. 계정 사용 한도(아래 FUEL)와 다르다. 사용 한도는 같은 ACCOUNT의 모든 AIRCRAFT가 같이 쓰니 줄에는 싣지 않는다. 크기는 마지막 CAPTAIN 요청이 읽고 쓴 토큰이다(CREW는 세지 않음). 창은 세션이 스스로 말하면 그것이다(CLI 세션은 statusline이 알려 주고, 데스크톱 세션은 마지막 `/model` 출력에서 읽는다). 말이 없으면 대화 기록에 `[1m]`이 적히지 않아서, 200k를 넘는 요청을 한 번 보면 1M으로 짐작한다. 카드에는 `FOB 50% · 504k / 1M`과 그 시각이 보이고, 마우스를 올리면 창을 어떻게 정했는지 나온다(세션이 알림, `/model` 출력, 설정, 짐작). 짐작이 틀리면 `~/.local/state/atc/fleet-plan.json`에 `"contextWindows": {"claude-opus-5-5": 1000000}`처럼 적는다.
- 순서는 AIRBORNE → HOLDING → PARKED → RESTARTING, 그다음 NORDO · AOG · NOT IN SERVICE. 같은 상태 안에서는 AIRPORT 순서다.
- 팀 세션에서 `/clear`를 하면 세션이 끝나고 같은 이름의 새 세션이 다음 지시와 함께 뜬다. 그 사이 30분(`dispatch.json`의 `restartGraceMin`)까지는 줄이 RESTARTING으로 `세션 없음 — /clear 뒤 첫 메시지 대기`라고 보이고, 승인해 둔 DISPATCH 제안은 닫히지 않고 기다린다. 새 세션이 뜨면 그 제안이 그대로 나간다. 30분이 지나도 안 뜨면 예전처럼 NOT IN SERVICE가 되고 제안은 "세션 없음"으로 닫힌다. OCC가 그 사이 FLIGHT PLAN을 보내려 하면 atc가 막는다.
- 줄을 누르면(키보드 Enter·Space도) 그 AIRCRAFT의 카드가 아래에 펼쳐진다. 카드는 행의 전체 폭을 쓰고, 위에서 아래로 **머리 → 경보 띠 → NOW → 접힌 칸들**이다. 머리 한 줄에 이름·REGISTRATION·base·STATUS(작은 점과 말. 점만 색이 있다: 일하는 중 초록, NEEDS YOU 파랑, AOG 노랑, NORDO 빨강, 나머지 회색)·출처 태그(`BG`·`DESKTOP`)와, 멈췄는데 목록에 남은 job이 있으면 `STALE n` 칩이 있고, 오른쪽에 LAUNCH(또는 STOP) · CREW BRIEFING · RELAY… 버튼과 `⋯` 메뉴가 있다. **고치기 · ATTACH 복사 · AOG · 퇴역은 `⋯` 메뉴에 있다**(키보드로 열고 ↑↓로 고르고 Esc로 닫는다. 눈에 보이는 버튼은 다섯 이하). 경보 띠는 켜진 것만 한 줄씩 보인다: NEEDS YOU(제안된 답 포함), AOG, ACCOUNT HOLD, REPORT 판정, 세션 이름 문제, 세션 없음·RESTARTING, RULES 미확인, LANGUAGE, 백그라운드가 아닌 세션의 손 절차. 하나도 없으면 띠가 없다. 평소 상태의 카드는 색이 없다(태그와 `SEC` 칩도 같은 회색 테두리): 색은 상태 점과 경보에만 나온다. AOG와 CAUTION(노랑)·WARNING(빨강) 경보가 있는 카드는 왼쪽 안쪽에 그 색의 막대가 생기고, NEEDS YOU가 있으면 경보 띠에 파란 막대가 생긴다. 그 아래 **NOW**가 카드의 초점 하나다: 지금 나는 FLIGHT(키와 제목 한 줄), 상태(일하는 중·마지막 도구·시각), FOB 막대, 팀이 쥔 HOLDING FLIGHT, 일하는 job의 설명(비면 없다). 나머지는 한 줄 요약으로 접힌 칸이고, 누르면 그 자리에서 펼쳐진다(위의 것과 옆 카드는 움직이지 않는다): **CREW**(`4 · claude-opus-5-5 외 3`, 펼치면 CREW 표) · **TYPE RATING**(칩, ROUTE가 있으면 펼침) · **ACCOUNT**(`acct-1 · 57% · resets 11:00Z`) · **FUEL**(`$4.77/FLT · cache 99/97% · 경고 3`) · **PERFORMANCE**(`이번 주 7 · 정시 100%`, 메모) · **LOGBOOK**(최근 14 FLIGHT를 오래된 것부터 작은 막대로: 정시 회색, 지연 노랑, PR 없음 테두리만, UNEXPECTED·되돌림 빨강. 막대마다 읽을 수 있는 라벨이 있고, 펼치면 표가 있다). 어느 칸을 열었는지는 이 브라우저에 기억한다. 라벨은 한 줄로 맞춘 칸에 있고 숫자는 오른쪽 맞춤이다. 목표(TARGETS)는 따로 줄을 두지 않고 각 값 옆에 `목표 …`로 붙는다(펼친 칸 안). 목록 행 아래의 카드는 행이 이미 보이는 FLYING·활동·FOB를 되풀이하지 않는다("카드" 보기에는 NOW에 그대로 있다). 값이 없는 칸(TYPE RATING·ROUTE·TARGETS가 비었을 때)은 그리지 않는다(고치기에서는 그대로 고친다). 다시 누르면 접힌다.
- 오른쪽 위 **목록 / 카드**로 예전처럼 모든 카드를 펼친 보기로 바꿀 수 있다. 고른 보기는 이 브라우저에 기억한다(기억하지 못하면 목록).
- 좁은 화면에서는 한 줄이 두 줄로 접힌다: 위는 AIRCRAFT · AIRPORT · STATUS, 아래는 FLYING · 경과 · 마지막 활동 · 이번 주 health 표시가 있는 줄은 FLYING이 한 줄을 다 쓰고, 경과부터는 셋째 줄로 내려간다.

## ACTIVITY: 지금 무엇을 하는지

살아 있는 Claude AIRCRAFT마다 `Bash · Run the test suite · 12s` 같은 한 줄이 STRIPS 스트립의 callsign 아래, FLEET 줄의 FLYING 칸 둘째 줄, 카드의 FLYING 아래에 붙는다. 마지막으로 부른 도구와 짧은 라벨(Bash 설명, 파일 이름, MCP 서버와 도구, 서브에이전트 설명, skill 이름, 메시지 받는 쪽), 그리고 그게 언제 시작됐는지다. 점 색은 도구가 도는 중(`tool`)과 모델 응답을 기다리는 중(`model · …`, 도구 없이 생각 중이면 `thinking · …`)을 가르고, 턴이 끝난 세션은 `idle · …`로 흐리게 보인다. 스냅샷마다 바뀐다. 명령, 파일 내용, 메시지와 도구 결과는 싣지 않는다.

## NEEDS YOU: 백그라운드 세션이 사람을 기다릴 때

창이 없는 백그라운드 세션(관제 세션과 `claude --bg`로 띄운 팀)은 사람의 답이 필요하면 `blocked`가 되어 아무도 모르게 기다린다. atc가 Claude Code가 적어 둔 job 상태를 읽어 `NEEDS YOU · <필요한 것>` 표시를 FLEET 줄과 카드, STRIPS, FLEET 탭의 CONTROL SESSIONS 구역에 붙인다. 마우스를 올리면 세션이 적은 한 줄 설명이 나온다. 3분 넘게 `blocked`이면 ALERTS에도 `BLOCKED`로 올라간다.

- 답하는 법: 터미널에서 `claude attach <job id>`로 그 세션에 붙어 답하거나, 그 세션에 메시지를 보낸다. 세션이 기본이 아닌 ACCOUNT 폴더(`~/.claude`가 아닌 폴더)에 있으면 `claude attach`는 그 폴더의 job을 못 찾는다. 이 줄의 툴팁, BLOCKED 경보, 카드의 `ATTACH 복사`는 그때 `CLAUDE_CONFIG_DIR=~/.claude-acct-1 claude attach <job id>`처럼 폴더가 붙은 명령을 보여 주므로 그대로 붙여 넣는다. 카드에 세션이 제안한 답(`제안된 답`)이 보이면 `복사`로 가져다 쓸 수 있다.
- atc는 답을 보내지 않는다. 표시하고 알릴 뿐이고, 답할지는 사람이 정한다.
- `approve Entering worktree`로 멈추면 `STAND outside .claude/worktrees — attach and approve; see CREW BRIEFING`이 같이 보인다. 팀이 `.claude/worktrees/` 밖으로 워크트리를 열려 한 것이다. `claude attach`로 붙어 승인하면 이어 간다. atc가 띄운 팀의 CREW BRIEFING에는 STAND를 `EnterWorktree name=…`으로 열라는 규칙이 들어 있어 보통은 멈추지 않는다.
- 답을 받으면 세션이 `working`이 되어 표시와 경보가 저절로 사라진다. 이때는 흐린 글씨로 세션이 하는 일이 보인다.

## 세션이 멈췄을 때: AIRCRAFT health

세션이 사용 한도나 API 오류로 멈추거나, 승인을 기다리거나, 지시에 대답하지 않으면 atc가 까닭을 읽고 코드를 붙인다. 멈춘 순간을 세션이 직접 알려 주므로(hook), 승인 대기 같은 것은 30분을 기다리지 않고 바로 보인다. FLYING 칸 앞에 `HOLD · LIMIT until 07:40Z`, `PENDING approval 12m`, `CONTEXT — RESTART` 같은 표시가 보이고, 마우스를 올리면 오류 한 줄과 다음 할 일이 나온다. 노란 표시는 사람이 볼 일(ALERT), 파란 표시는 참고(INFO)다.

| 코드 | 뜻 | 할 일 |
|---|---|---|
| `LIMIT` | 계정 사용 한도. reset 시각까지 HOLD(DISPATCH가 일을 주지 않음). ACCOUNT 라벨이 있으면 같은 ACCOUNT의 다른 AIRCRAFT도 HOLD(아래) | 기다린다. reset 뒤 `UNANSWERED`로 바뀌면 지시를 다시 보낸다. reset 시각을 모르면 5시간 뒤 저절로 풀린다 |
| `LIMIT (cut)` | 오류 없이 턴이 한도로 잘림. `HOLD · LIMIT (cut 18:10Z)`. 기다리는 동안 그 FLIGHT는 줄에 그대로 남는다 | 기다린다. reset 뒤에도 새 지시가 없으면 `RESUME`으로 바뀐다(reset을 모르면 5시간 뒤). 한도 안내 뒤 세션이 스스로 마무리하고 쉬면 cut이 아니라 코드가 붙지 않는다 |
| `RESUME` | 한도는 풀렸는데 새 지시가 없어 멈춰 있음. `RESUME 필요` | 그 세션에서 "계속"을 보낸다. atc는 스스로 보내지 않는다 |
| `STALLED` | In Progress FLIGHT를 쥔 채(STAND나 `tail:` 라벨) PR 없이 60분 넘게 쉬는 중 | 세션을 들여다본다. 막힌 것이 없으면 "계속", 살릴 수 없으면 다시 띄운다 |
| `THROTTLE` | 서버가 잠시 붐빔 | 몇 분 뒤 다시 보낸다 |
| `NETWORK` | 이 컴퓨터에서 API에 연결이 안 됨(모든 세션이 같이 걸림) | 네트워크·프록시·`ANTHROPIC_BASE_URL`/`NO_PROXY`를 보고 다시 보낸다 |
| `MODEL` | 고른 모델이나 경로가 없음 | 모델을 고쳐 다시 띄운다. 그대로 재시도하지 않는다 |
| `CONTEXT` | 대화가 너무 길어 이어갈 수 없음 | 새 CREW BRIEFING으로 다시 띄우고, STAND와 PR을 넘겨받게 한다 |
| `PROVIDER` | ocx·OpenAI 호환 경로의 오류 | 기본 경로로 다시 띄운다 |
| `PENDING` | 도구 승인을 기다림(멈춘 순간 세션이 알려 줌) | 그 세션에서 승인하거나 거절한다 |
| `UNANSWERED` | 지시에 10분 넘게 대답이 없음 | 지시를 다시 보낸다. atc는 스스로 보내지 않는다 |
| `HUNG` | 작업 중인데 30분 넘게 기록이 없음 | 세션을 들여다본다. 계속되면 다시 띄운다 |
| `DENIED` | 10분 안에 거부·hook 막힘이 3번 넘음 | permission 규칙으로 허용하거나 다시 브리핑한다 |
| `UNKNOWN` | 그 밖의 오류 | 오류 한 줄을 보고 판단한다 |

- 코드는 세션이 다시 정상으로 대답하면 저절로 풀린다. `LIMIT (cut)`·`RESUME`·`STALLED`는 세션이 새 지시를 받거나 도구를 다시 쓰기 시작하면 풀린다.
- 멈춘 세션(`LIMIT (cut)`·`RESUME`·`STALLED`)은 STAND 점유 시간(3시간)이 지나도 FLEET 줄에 FLIGHT가 남고, 그 옆에 마지막 커밋, origin에 올라갔는지, PR이 보인다(`59a9fdc 7h ago · pushed · no PR`). 이때 줄의 STATUS는 HOLDING이다.
- ALERT는 화면 위 ALERTS에도 올라간다. `NETWORK`는 세션이 여럿이어도 하나, `LIMIT`은 같은 ACCOUNT끼리(라벨이 없으면 reset 시각이 같은 것끼리) 하나로 묶인다.
- OCC는 그 AIRCRAFT가 쥔 FLIGHT의 FLIGHT FOLLOWING 문제로, TOWER는 브리핑으로 받아 SUPERVISOR에게 보고한다. 둘 다 팀에 다시 보내지는 않는다.
- 사람이 결정할 코드는 FLEET PLAN이 제안으로 올린다: `MODEL`과 주간 `LIMIT`은 AOG, `CONTEXT`와 60분 넘은 `HUNG`은 RESTART(아래 "FLEET PLAN"). 코드가 풀리면 제안도 닫힌다.
- 한도가 **거의 찼는지**는 FUEL로 본다(아래 "FUEL: 한도를 얼마나 썼나"). 급하면 그 AIRCRAFT를 AOG로 둔다.

### ACCOUNT: 사용 한도를 같이 쓰는 AIRCRAFT

사용 한도는 세션이 아니라 계정에 걸린다. 여러 팀 세션이 한 계정으로 돌면, 한 팀이 한도에 걸릴 때 나머지도 곧 같은 벽에 부딪힌다. 카드의 **고치기**에서 AIRCRAFT마다 **ACCOUNT** 라벨을 적어 두면 atc가 그 묶음을 안다.

- 라벨은 직접 정한 짧은 이름이다: 소문자·숫자·`-`, 24자까지(예: `main`, `pro-2`). email이나 계정 정보는 적지 않는다. atc는 계정을 알아내려고 로그인 정보나 계정 설정을 읽지 않는다.
- 비워 둔 AIRCRAFT는 기본 계정 `default`로 센다. 어느 AIRCRAFT에도 라벨이 없으면 atc는 계정을 모르는 것으로 보고 전처럼 동작한다.
- 한 AIRCRAFT가 `LIMIT`에 걸리면, 같은 ACCOUNT의 다른 AIRCRAFT도 reset까지 DISPATCH·SCHEDULE NEW에서 빠진다. FLEET 줄에는 점선 표시 `HOLD · LIMIT (account pro-2) until 07:40Z`가 붙고, DISPATCH 탭 AIRCRAFT 목록의 사유에도 같은 글이 나온다. 이 AIRCRAFT들은 멈춘 것이 아니므로 health 코드나 경보가 따로 생기지 않는다. 그 ACCOUNT의 `LIMIT` 경보 하나에 함께 적힌다.
- reset이 지나면 저절로 풀린다. 할 일은 없다. 한도에 걸린 AIRCRAFT가 대답하지 못한 지시가 있으면 `UNANSWERED`로 바뀌니 그때 다시 보낸다.
- 라벨을 직접 단 AIRCRAFT는 FLEET 줄의 REGISTRATION 옆에 작은 칩으로 보이고, 카드에는 ACCOUNT 줄이 있다.

### ACCOUNT 폴더: 계정이 둘 이상일 때

계정마다 Claude Code 설정 폴더가 하나 있다(예: `acct-1` = `~/.claude-acct-1`, `acct-2` = `~/.claude`). 설정 창 **ACCOUNTS** 분류에서 라벨과 폴더를 적으면 atc가 그 폴더의 세션·job·FUEL을 모두 읽는다. `~/.claude`는 적지 않아도 읽고, 적지 않으면 라벨이 `default`다. 폴더는 홈 아래의 `.claude…` 이름이어야 하고, email·토큰은 적지도 저장하지도 않는다. 저장은 이 화면에서만 된다(SUPERVISOR).

- **ADD ACCOUNT로 새 계정 폴더 준비.** ACCOUNTS 블록의 **ADD ACCOUNT**에 라벨(예: `acct-1`)을 적고 **만들고 등록**을 누르면 `~/.claude-acct-1` 폴더를 만들고, `~/.claude/settings.json`(statusline·hook·권한·env)을 복사하고, 등록한다. `~/.claude`가 아직 등록되지 않았으면 그 라벨(FLEET 프로필이 쓰는 것, 예: `acct-2`)도 함께 적는다. env는 키 이름만 보이고, 체크를 풀면 그 키는 옮기지 않는다(프록시는 이 계정도 같은 길로 나갈 때만). 폴더에 자기 hook·env·권한이 있는 settings.json이 있으면 두고 등록만 한다. 로그인은 그 폴더 줄의 **LOGIN**으로 한다(아래). 폴더 줄에 LOGGED IN과 STATUSLINE·HOOK ✓가 뜨면 된 것이다.
- **LOGIN: 화면에서 로그인.** NOT LOGGED IN인 등록 폴더 줄에 **LOGIN** 버튼이 있다. 누르면 atc가 그 폴더로 `claude auth login`을 띄우고 로그인 링크를 보인다. 링크를 열어 그 계정으로 로그인하고, 페이지에 나온 코드를 칸에 붙여 넣고 **확인**을 누른다(10분 안). 로그인되면 atc가 그 폴더의 첫 실행 화면과 AIRPORT 폴더 신뢰도 표시해 두므로 터미널에서 할 일이 없다. 코드는 atc가 그 프로세스에만 넘기고 남기지 않는다. `~/.claude`와 이미 로그인된 폴더에는 버튼이 없다. 터미널로 로그인했다면(`CLAUDE_CONFIG_DIR=… claude auth login --claudeai`) 그 폴더로 `claude`를 한 번 열어 첫 화면을 끝낸다.
- **MEMORY: 계정 폴더끼리 memory 공유.** Claude Code의 memory는 폴더마다 따로라서, 새 계정 폴더의 세션은 `~/.claude` 세션이 쌓은 규칙과 교훈을 모른다. 폴더 줄의 `MEMORY shared ✓`·`MEMORY separate`·`MEMORY conflict`가 상태이고, **SHARE MEMORY**를 누르면 atc 체크아웃과 열린 AIRPORT의 memory 폴더를 `~/.claude` 것으로 잇는다(ADD ACCOUNT도 새 폴더에 같은 일을 한다). 빈 폴더만 바꾼다. 이미 파일이 든 폴더는 건드리지 않고 충돌로 두며 파일 이름만 보인다. 직접 합친 뒤 그 폴더를 치우고 다시 누른다. 내용은 atc가 열지 않는다.
- **세션의 ACCOUNT는 찾은 곳으로 정한다.** 세션 파일이 `~/.claude-acct-1`에 있으면 그 세션은 `acct-1`이다. FUEL도 그 ACCOUNT의 한도로 센다.
- **home과 다를 때.** AIRCRAFT 프로필의 ACCOUNT는 home으로 남는다. 세션이 다른 폴더에서 돌면 FLEET 줄과 카드에 `acct-1 (home acct-2)`로 보인다. 오류가 아니다.
- **폴더마다 건강 표시.** 로그인했는지(`LOGGED IN`·방식만), settings에 atc statusline과 `claim`·`health` hook이 있는지 보인다. 빠진 것은 경고로만 나온다(`FUEL blind on acct-1`). 막지는 않는다.
- **LAUNCH·STOP도 ACCOUNT별로.** LAUNCH의 ▾ 옵션에 **ACCOUNT** 고르개가 있다(기본은 그 AIRCRAFT의 home ACCOUNT). 로그인이 안 됐거나 FUEL이 hold 수준이거나 그 ACCOUNT의 세션 상한에 닿은 ACCOUNT는 사유와 함께 흐리게 보이고 고를 수 없다. STOP은 그 세션이 있는 폴더로 한다. 세션 상한은 기계 전체(`ATC_MAX_LAUNCHED`)에 더해 ACCOUNT마다 `상한` 칸에 정할 수 있다(비우면 없음).
- **ACCOUNT CHANGE: 다른 ACCOUNT로 옮기기.** AIRCRAFT의 ACCOUNT가 한도에 닿으면(FUEL이 hold 수준이거나 reset이 한 시간 넘게 남은 LIMIT) FLEET PLAN이 `ACCOUNT CHANGE`를 제안한다. 사용이 가장 낮은 다른 ACCOUNT(로그인됐고 80 % 아래)로 옮기자는 것이다. **FLIGHT 사이에만** 나오고, 진행 중인 FLIGHT는 옮기지 않는다(한도로 잘린 FLIGHT는 같은 ACCOUNT에서 RESUME). 동의(승인)하면 옛 ACCOUNT에서 멈추고 새 ACCOUNT에서 CREW BRIEFING으로 다시 띄운다. 반대하거나 그대로 두면 아무 일도 없다. 저절로 옮기는 일은 없다. 옮긴 뒤 카드에는 `flying on acct-1 (home acct-2)`가 보이고, home ACCOUNT는 그대로다. home이 다시 여유가 생기면 돌아가는 것도 같은 제안이다. 새 세션은 캐시가 식은 채 시작하므로 FUEL의 LEAK에 `ACCOUNT CHANGE`로 따로 보인다.
- **LAUNCH ACCOUNT: 다음에 띄울 세션이 쓸 ACCOUNT를 한 번에 고르기.** 설정 창 ACCOUNTS 블록의 **LAUNCH ACCOUNT** 드롭다운 둘(AIRCRAFT, 관제 세션)에서 ACCOUNT를 고르면, 이름을 대지 않은 **다음 LAUNCH**가 각 AIRCRAFT의 home 대신 그 ACCOUNT를 쓴다(예: `acct-2`가 무거운 동안 `acct-3`로). 각 AIRCRAFT의 home(카드의 ACCOUNT)은 그대로고, **각 home (프로필)**을 고르면 전과 같다. 로그인이 안 됐거나 FUEL이 hold 수준이거나 세션 상한에 닿은 ACCOUNT는 사유와 함께 흐리게 나와 고를 수 없고, 고른 ACCOUNT가 나중에 그렇게 되면 LAUNCH가 사유와 함께 거절된다(다른 ACCOUNT로 돌리지 않는다). **돌고 있는 세션은 저절로 옮기지 않는다**: 옮기는 것은 ACCOUNT CHANGE(AIRCRAFT마다 당신이 승인)이거나, 드롭다운 아래 **APPLY NOW**(또는 FLEET 머리의 같은 버튼)다. APPLY NOW는 확인 창에 옮길 세션을 "지금 옮김 / FLIGHT 뒤에 옮김 / 안전한 순간을 기다림 / 옮기지 않음"으로 나눠 보이고, 확인하면 세션마다 하나씩 STOP → LAUNCH한다. 쉬는 AIRCRAFT(FLIGHT·점유·PR 없음)와 안전한 순간의 관제 세션만 옮기고, 바쁜 것은 기다렸다가 따라간다(설정을 바꾸거나 24시간이 지나면 끝). 옮긴 세션은 **캐시 없이** 시작하므로 FUEL을 더 쓴다. 데스크톱·터미널 세션(ENGINEERING 등)과 DUTY는 옮기지 않는다. LAUNCH 옵션에서 ACCOUNT를 직접 고르거나 ACCOUNT CHANGE를 승인하거나 한도 뒤 RESUME을 하면 그 이름이 설정보다 먼저다. DISPATCH에서 세션이 없는 AIRCRAFT의 카드를 승인해 띄울 때(RESUME 말고)는 이 설정을 따르고, 설정이 없을 때만 그 AIRCRAFT가 마지막으로 떴던 ACCOUNT를 쓴다. LAUNCH의 ▾ 옵션은 이 ACCOUNT를 미리 고르고(`(LAUNCH ACCOUNT)`), 설정이 켜져 있는 동안 FLEET 머리에 `LAUNCH ACCOUNT acct-3`가 작게 보이고, 다음 LAUNCH가 home과 다른 ACCOUNT를 쓰게 되는 AIRCRAFT는 행과 카드에 `next LAUNCH acct-3 (home acct-2)`도 보인다(home과 같거나 설정을 비웠으면 home만). 세션이 없는 AIRCRAFT의 DISPATCH launch 카드(`absent · LAUNCH on approve`)에도 `next LAUNCH acct-3`가 붙어, 승인하면 어느 ACCOUNT로 뜨는지 보인다. 설정 창 LAUNCH ACCOUNT 블록에는 "home은 바뀌지 않고 FLEET에 `next LAUNCH`가 보인다"는 안내와 FLEET 링크가 있다. AIRCRAFT용이 켜져 있으면 FLEET PLAN의 ACCOUNT CHANGE는 프로필 home 대신 이 ACCOUNT를 기준으로 제안하고, 새 AIRCRAFT(ENTRY)도 여기서 난다. **OCC와 AIRCRAFT는 같은 ACCOUNT에 있어야 한다**: 메시지(SendMessage)는 같은 ACCOUNT의 세션에만 닿으므로, AIRCRAFT용과 관제 세션용 LAUNCH ACCOUNT를 다르게 고르면(예: AIRCRAFT `acct-1`, 관제 `acct-3`) OCC가 그 AIRCRAFT에 FLIGHT PLAN을 보내지 못한다. 그래서 설정 창, FLEET 머리, DISPATCH 카드(`ACCOUNT 불일치`)가 미리 경고하고(OCC와 다른 ACCOUNT에서 돌고 있는 AIRCRAFT 이름도 보인다), 그런 AIRCRAFT에 대한 `dispatch release`는 사유와 함께 거절된다. 설정은 갈라져도 저장되고, 둘을 같은 ACCOUNT로 맞추거나 ACCOUNT CHANGE·APPLY NOW로 한쪽을 옮기면 풀린다.
- **LAUNCH MODEL: AIRCRAFT를 어떤 모델로 띄울지 고르기.** 설정 창 ACCOUNTS 블록의 LAUNCH ACCOUNT 아래 **LAUNCH MODEL**에서 고른다: **기본**(예: `claude-opus-5-5`), **AIRPORT마다**(예: ATCC는 `sonnet`), 그리고 FLEET 카드 **고치기**의 LAUNCH MODEL 칸으로 **AIRCRAFT마다**. 비워 두면 **폴더 기본**이라 전처럼 `--model`을 붙이지 않고 ACCOUNT 폴더와 프로젝트 settings가 정한다(처음 값). 우선순위는 LAUNCH 옵션의 모델 칸에 적은 모델 > AIRCRAFT > AIRPORT > 기본이고, 아무것도 없을 때만 그 AIRCRAFT의 마지막 LAUNCH 모델을 쓴다. FLEET 행·카드와 DISPATCH launch 카드에 `next LAUNCH model claude-opus-5-5 (기본)`처럼 다음 LAUNCH가 쓸 모델이 보이고, LAUNCH 옵션의 모델 칸에도 미리 보인다. FLEET LAUNCH, DISPATCH launch 카드 승인, FLEET PLAN 승인, RESUME, APPLY NOW 모두 같은 설정을 쓴다. **돌고 있는 세션은 모델을 바꾸지 않는다**: 다음 LAUNCH(STOP 뒤 LAUNCH)부터 새 모델이다. 관제 세션과 crew 서브에이전트의 모델은 이 설정이 아니다. Opus는 Sonnet보다 토큰당 비용이 크니 한도는 FUEL의 ACCOUNT별 보기에서 지켜본다(저절로 바꾸지 않는다). 바꿀 때마다 FLIGHT RECORDER에 한 줄(`launch-model`)이 남고, LAUNCH 줄에는 실제로 넘긴 `model`과 출처 `modelFrom`이 있다.
- **REPOSITION: 다른 AIRPORT로 옮기기.** FLIGHT가 기다리는데 소속 AIRCRAFT가 없는 AIRPORT가 있고, 다른 AIRPORT에서 FLIGHT 사이(세션이 쉬고 STAND·PR·FLIGHT가 없음)인 AIRCRAFT가 있으면 FLEET PLAN이 그 AIRCRAFT를 옮기자고 한다(`ATCC → DSGN`). 승인하면 옛 세션을 멈추고, base를 새 AIRPORT로 바꾸고, 그 AIRPORT 저장소에서 CREW BRIEFING으로 다시 띄운다(새 세션은 캐시 없이 시작하고 그 저장소의 규칙을 읽는다). 목표 저장소와 ACCOUNT는 멈추기 전에 확인하므로 거절되면 옛 세션은 그대로 돈다. 떠난 뒤에도 원래 AIRPORT가 자기 FLIGHT 수만큼 AIRCRAFT를 가질 때만 제안한다. 스위치는 설정 창 AUTOMATION → OPERATIONS의 **REPOSITION**(`off`·`shadow` 기본·`approval`·`auto`): `shadow`는 기록만 하고, `auto`(⚠)는 승인 없이 하루 4건까지 스스로 옮기고 옮길 때마다 알린다. 옮긴 AIRCRAFT의 카드에는 base 옆에 마지막 옮김이 보인다.
- **새 AIRCRAFT(ENTRY)도.** FLEET PLAN의 ENTRY 제안은 새 AIRCRAFT가 날 ACCOUNT를 함께 적는다(로그인됐고 hold 아래에서 사용이 가장 낮은 ACCOUNT). 등록한 ACCOUNT가 모두 안 되면 제안하지 않고 이유를 AIRPORT 줄에 적는다.

### FUEL: 한도를 얼마나 썼나

`LIMIT`은 이미 막힌 뒤에 뜬다. FUEL은 막히기 전에 ACCOUNT가 한도를 얼마나 썼는지 보여 준다.

- **켜기(한 번, SUPERVISOR)**: `~/.claude/settings.json`에 atc의 statusline 명령을 넣는다([hooks/README.ko.md](../../hooks/README.ko.md#fuel-statusline)). 그러면 Claude Code 아래 상태 줄에 `FUEL 5h 82% · 7d 40%`가 보이고, 같은 숫자가 atc에 남는다. 계정 정보는 남기지 않고 숫자만 남긴다.
- **FUEL 블록과 카드**: `사용 82% · resets 21:00Z`(카드에서는 얇은 회색 막대와 `82%`, `resets 21:00Z`). 가장 많이 쓴 창(5시간·주간)에서 **쓴** 몫과 그 창이 풀리는 시각이다. 남은 몫이 아니다. 80 % 아래는 회색, 80 %부터 노랑, 95 %부터 빨강(카드의 막대도 같다). 마우스를 올리면 창마다의 값과, 어느 AIRCRAFT가 언제 적은 값인지 나온다.
- **FLEET 줄**에는 이 숫자를 싣지 않는다(위 FOB가 줄의 연료다). 95 %(hold 수준)를 넘은 ACCOUNT의 AIRCRAFT에만 FLYING 칸에 `HOLD · FUEL (account pro-2) until 21:00Z` 표시가 붙는다. 배정이 막힌다는 표시다.
- 같은 ACCOUNT의 AIRCRAFT는 같은 값을 보인다(가장 새로 적힌 값). ACCOUNT 라벨이 없으면 AIRCRAFT마다 자기 세션의 값만 보인다.
- **관제 세션도 센다**: TOWER, OCC, CROSSCHECK, MCC, ENGINEERING도 같은 계정의 한도를 쓴다. FLEET 탭 CONTROL SESSIONS 구역에서 세션마다 **ACCOUNT**를 적어 둔다(AIRCRAFT와 같은 라벨 형식). 적지 않으면 라벨이 하나라도 있을 때 `default`로 센다. 관제 세션이 한도를 많이 써도 붙들리는 것은 같은 ACCOUNT의 AIRCRAFT뿐이고, 관제 세션은 멈추지 않는다.
- FLEET 탭의 **CONTROL** 그룹(AIRCRAFT 목록 아래 같은 표에 이어지는 둘째 그룹, 주소 `#fleet/control`)은 관제 세션(TOWER·OCC·MCC·CROSSCHECK·REVIEW·ENGINEERING)을 AIRCRAFT와 같은 줄로 보인다: STATUS(`BUSY`·`IDLE`·`NEEDS YOU`·`NOT RUNNING`), FLYING(job이 적은 한 줄이나 NEEDS YOU), 경과(loop 주기), 마지막 활동, FOB, FUEL 14일. 모든 세션이 같은 사실(띄운 방식 `claude --bg`, permission mode, ACCOUNT, 모델)은 그룹 머리에 한 번만 적히고, 다른 세션 줄에만 칩이 붙는다. 줄을 누르면(키보드로도) LAUNCH·STOP, 폴더와 첫 메시지, `STALE n`, ACCOUNT 편집이 펼쳐지고, NEEDS YOU인 줄은 펼친 채 시작한다. FLEET가 보이는 동안 1분에 한 번 다시 읽고, LAUNCH·STOP 뒤에는 곧장 읽는다. 백그라운드 세션 daemon이 atc 서비스 안에서 돌면 맨 위에 경고가 붙는다. 설정 창 AGENTS 탭에는 이리로 가는 안내 한 줄만 있다.
- CONTROL 그룹 아래 **OTHER BACKGROUND SESSIONS** 그룹은 AIRCRAFT도 관제 세션도 아닌 백그라운드 세션(예: `ENGINEERING-NIGHT`)을 보인다. 이 세션들도 백그라운드 세션 상한(`ATC_MAX_LAUNCHED`)의 자리를 쥐고, 세션마다 이름·폴더·상태·논 시간·job 한 줄과 **STOP**이 있다. 비어 있으면 그룹이 없다. STOP은 누를 때만 하고 atc가 스스로 멈추지 않는다. 상한 때문에 LAUNCH가 막히면 거절 글이 `AIRCRAFT 6 · 그 밖 1 (ENGINEERING-NIGHT, 6h idle)`처럼 누가 자리를 쥐었는지 적고, 그 밖의 세션이 120분 넘게 놀고 있으면 ADVISORY 알림 하나가 뜬다.
- FLEET의 ACCOUNT 보기는 이 **FUEL** 블록 하나다(FLEET PLAN에는 같은 줄이 없다). hold 수준이 되면 그 옆에 `LAUNCH·ENTRY 제안 안 함`이 붙는다.
- FLEET 탭의 **FUEL** 블록(AIRCRAFT 목록 아래)은 ACCOUNT마다 한 줄로 쓴 몫, AIRCRAFT, 그리고 따로 관제 세션을 보인다. 누가 그 계정을 쓰고 있는지 여기서 본다.
- 80 %를 넘으면 TOWER가 SUPERVISOR에게 한 번 알리고(창마다 한 번), OCC는 그 AIRCRAFT가 쥔 FLIGHT의 FLIGHT FOLLOWING에 적는다. 팀에는 보내지 않는다.
- **DISPATCH HOLD 스위치**: 설정 창 AUTOMATION → OPERATIONS의 FUEL 블록. 기본은 off라 FUEL은 보여 주기만 한다. on으로 바꾸면 95 % 넘게 쓴 ACCOUNT의 AIRCRAFT를 DISPATCH가 reset까지 `HOLD · FUEL (account pro-2) until 21:00Z`로 건너뛴다. SCHEDULE NEW는 그대로다.
- 값은 상태 줄이 다시 그려질 때만 갱신된다. CREW 서브에이전트와 다른 컴퓨터의 세션은 보고하지 않는다. ACCOUNT마다 살아 있는 CAPTAIN 세션 하나면 된다.

### FUEL: FLIGHT마다 얼마나 태웠나

위 FUEL REMAINING이 "한도를 얼마나 썼나"라면, 이것은 "끝낸 FLIGHT가 얼마나 들었나"다. LOGBOOK 줄에 적힌 토큰에 지금 가격표로 값을 매긴다. 보여 주기만 하고 DISPATCH 점수·배정에는 쓰지 않는다.

- **FLEET 줄의 FUEL 14일 칸**: `$6.10/FLT · CACHE 93%`. 최근 14일 ARRIVED FLIGHT의 FLIGHT당 FUEL COST(달러, 목록가 기준)와 CACHE HIT. 마우스를 올리면 NET, CREW 몫, 큰 LEAK, 값 없는 모델이 나온다. 좁은 화면에서는 줄 맨 아래 한 줄이 된다.
- **카드의 FUEL 블록**(최근 14일): 두 줄이다. 라벨·값 줄 `NET/FLT $x`(LEAK을 뺀 값)와 `CACHE HIT CAPTAIN · CREW`이고, 목표가 있으면 값 옆에 흐린 `목표 ≤ $8.00`·`목표 95%`가 붙는다. TRIP FUEL을 넘은 FLIGHT, LEAK, CREW 경고(HEAVY PREFIX, COLD CREW …)가 있을 때만 셋째 줄이 붙는다. FUEL COST, 건수(ARRIVED·fuel·값), 값 없는 모델, CREW 몫은 마우스를 올리면 나온다.
- **최근 FLIGHT**: 각 FLIGHT 아래 줄에 `NET $2.76 LEAK $0.39 TRIP ✓`. `TRIP ✓`은 비슷한 FLIGHT들의 범위(TRIP FUEL p90) 안, `UNEXPECTED`는 넘었다는 뜻이다. 값이 없는 모델뿐이면 토큰(`4.6M tok`)만 보인다.
- **없는 값은 0이 아니라 `—`**: FUEL 기록이 생기기 전 FLIGHT(`FUEL —`), 가격표에 없는 모델(DeepSeek 등), 비교할 FLIGHT가 모자란 TRIP FUEL은 비워 둔다.
- **TARGETS**: 고치기에서 `FLIGHT당 NET $ … 이하`와 `CACHE HIT … %`를 정할 수 있다. 못 미치면 FUEL 블록의 그 값이 노란색이 되고, 목표는 값 옆에 흐린 글씨로 보인다. 다른 TARGETS처럼 표시만 한다.

## 팀 프로필

| 항목 | 뜻 | planner가 쓰는 법 |
|---|---|---|
| CREW COMPLEMENT | 기본 팀원 구성과 모델 | 그 구성이 할 수 없는 종류의 일은 주지 않음(예: flash-helper만 있으면 BUILD 없음) |
| TYPE RATING | 맡을 수 있는 일: SEC · UI · DATA · DOCS | 필요한 자격을 모두 가진 팀에만 제안 |
| ROUTE | 주 담당 Linear 프로젝트 | 담당이면 점수 +1 |
| TARGETS | 주간 FLIGHT 수, 정시성, FLIGHT당 NET FUEL, CACHE HIT | 표시만(점수에 안 씀). 실적은 LOGBOOK으로 센다(아래) |
| ACCOUNT | 사용 한도를 같이 쓰는 계정의 라벨(`main`, `pro-2` …). 비우면 `default` | 같은 ACCOUNT의 한 AIRCRAFT가 `LIMIT`에 걸리면 reset까지 나머지도 제안하지 않음(위) |

정하지 않은 항목은 vocado 팀원 규칙에서 온 기본값을 따른다. SEC는 보안 작업을 맡을 팀원이 있어야 줄 수 있다.

## LOGBOOK과 실적

LOGBOOK은 AIRCRAFT가 끝낸(ARRIVED) FLIGHT의 기록이다. atc가 10분마다 GitHub에서 머지된 PR을 읽어 `~/.local/state/atc/logbook.jsonl`에 한 줄씩 적는다. 사람이 적을 것은 없다.

- **누구 몫인가**: 그 PR의 STAND(워크트리)를 점유했던 `TEAM_X` 세션. 여러 팀이 거쳤으면 마지막까지 만진 팀. 알 수 없으면 비워 두고(카드에 안 보임) 기록은 남긴다.
- **block time(팀 소요 시간)**: 그 STAND를 처음 점유한 시각부터 PR을 연 시각까지. 밤도 포함한 벽시계 시간이다. 점유가 PR보다 늦게 잡혔으면 착수 시각을 모르므로 `—`로 두고 정시율에서 뺀다.
- **착륙 대기**: PR을 연 시각부터 머지까지(리뷰·머지를 기다린 시간). 팀 속도와 섞이지 않게 따로 보여 주고 정시율에는 넣지 않는다.
- **되돌림**: `Revert "…"` PR이 머지되면 원래 FLIGHT에 REVERTED가 붙는다.

카드의 TARGETS 아래에 실적이 나온다.

| 줄 | 뜻 |
|---|---|
| 이번 주 `3` 목표 5 | 이번 주(월요일 0시부터) ARRIVED 수, 목표는 옆에. 목표보다 적으면 노란색 |
| 정시 `67%` 목표 80% | 최근 14일 FLIGHT 중 팀 소요 시간이 기대치 안인 비율. 목표보다 낮으면 노란색 |
| 되돌림 · LOS | 0보다 클 때만 줄로 나오고 빨간색이다 |
| (마우스를 올리면) | 최근 14일 ARRIVED 수, 되돌림, LOS, 착륙 대기 중앙값 |
| LOGBOOK | 접힌 줄에는 최근 14 FLIGHT의 띠. 펼치면 작은 표, 최근 FLIGHT 5건(더 있으면 `더 보기`): FLIGHT(AD HOC), PR 번호, 소요(모르면 `—`, 늦으면 노란색이고 마우스를 올리면 DELAYED, `+`착륙 대기), NET, 날짜. 숫자 칸은 오른쪽 맞춤. REVERTED·LOS는 빨간색. ON TIME 글자는 없다(툴팁에만). FLIGHT를 누르면 PR이 열린다 |

기대 block time은 `wake` 라벨이 있으면 L 60분 · M 4시간 · H 2일이다. 라벨이 없거나 J거나 AD HOC이면 같은 FLIGHT TYPE·WAKE로 끝난 다른 FLIGHT(3건 이상)의 중앙값과 비교하고, 모자라면 정시율에서 뺀다. 실적은 보여 주기만 하고 배정 점수에는 쓰지 않는다.

## 관측 CREW와 drift

카드의 CREW 표는 선언한 CREW COMPLEMENT 한 줄 한 줄에 최근 14일 동안 실제로 본 팀원(모델 ×횟수 · 마지막 시각)을 붙여 보여 준다. 선언에 없는 팀원은 `선언에 없음`(노랑) 줄로, 기간 안에 안 보인 선언은 `14일 안 씀` 꼬리표로 보인다. `CREW` 제목에 마우스를 올리면 "세션 메타데이터만 읽는다"는 안내가 나온다. 그 등록번호 이름의 세션(지금 살아 있는 세션과 이름이 같았던 지난 세션)이 부른 서브에이전트를 agent type·모델별로 묶어, 부른 횟수와 마지막 시각을 적는다.

atc는 세션 메타데이터만 읽는다: 서브에이전트의 agent type, 부를 때 준 모델, 파일 시각, 세션 이름. 대화 기록, 지시문, 작업 설명은 읽지 않는다.

관측한 팀원은 선언한 POSITION에 이렇게 맞춘다.

| 관측 | POSITION |
|---|---|
| `ui-builder`, `ui-qa`, `flash-helper`처럼 선언한 POSITION이나 agent와 이름이 같은 타입 | 그 POSITION |
| `general-purpose`·`claude` + Opus 모델 | `backend`(agent에 opus가 든 팀원) |
| `general-purpose`·`claude` + 모델 지정 없음 | `backend`로 본다. CAPTAIN의 모델(Opus)을 물려받기 때문이다. 실제 모델은 보이지 않아 모델 칸은 비어 있다 |
| `Explore`, `Plan`, `claude-code-guide` 같은 내장 타입, 그 밖의 타입 | 맞추지 않음. 선언에 agent로 적으면 맞춘다 |

CREW 표의 두 표시:

- **선언에 없음 (Explore 줄)** — 불렀지만 선언에 없는 타입. 모델을 줬으면 `general-purpose (sonnet)`처럼 붙는다. 자주 쓰면 COMPLEMENT에 넣을지 정한다.
- **14일 안 씀 (flash-helper 줄의 꼬리표)** — 선언했지만 기간 안에 부르지 않은 POSITION. 잘못이 아니라 "안 보였다"는 뜻이다. Codex 리뷰(`security` 구성의 reviewer)처럼 서브에이전트로 부르지 않는 POSITION은 늘 여기에 뜬다.

이름이 같은 세션이 없으면 관측은 나오지 않는다. agent team처럼 팀원이 따로 세션으로 도는 경우 그 팀원은 보이지 않는다(CAPTAIN이 Agent로 부른 팀원은 보인다).

## CREW CHANGE

운항 중인 AIRCRAFT(퇴역하지 않았고 그 이름의 세션이 살아 있음)의 CREW COMPLEMENT를 바꿔 저장하면, atc가 CAPTAIN에게 줄 **CREW CHANGE** 지시문을 만든다. 카드에 **CREW CHANGE 대기**로 나온다.

- 내리고(−) 타는(+) 팀원과 모델, 그리고 TYPE RATING 영향이 보인다. 예: 유일한 구현 팀원을 내리면 "BUILD·MAINT·TEST를 더는 날 수 없음", 판정할 팀원이 없으면 "CHECK를 더는 날 수 없음".
- 지시문은 `[ATC FLEET] CREW CHANGE · HOTEL (TEAM_H) · CC-0001`로 시작하고, 팀원을 멈추거나 그 모델로 만드는 법을 적은 뒤 `"TEAM_H CREW CHANGE CC-0001 COMPLETE"` 한 줄로 답하라고 끝난다.
- **직접 전달(2a·2b 모두)**: **복사**를 눌러 그 팀의 CAPTAIN 세션에 붙여 넣고 **전달함**을 누른다. 대기 카드가 사라지고 기록에 전달 시각이 남는다.
- **OCC가 보냄(2b, DISPATCH가 approval 모드일 때만)**: 카드의 **승인**을 누르면 OCC가 다음 바퀴에 `[OCC CC-0001] CREW CHANGE · HOTEL (TEAM_H)`로 시작하는 문구를 CAPTAIN에게 보낸다([교신 규칙](radio.md)). 승인은 SUPERVISOR만 한다. shadow 모드에서는 승인 버튼이 없다(서버도 409로 거절).
  - 카드 머리: **CREW CHANGE 대기**(pending) → **CREW CHANGE 승인됨 — OCC 발부 대기**(approved) → **CREW CHANGE SENT — READBACK 대기**(sent, 보낸 본문 그대로 보임) → CAPTAIN이 `READBACK CC-0001`로 답하면 카드가 사라진다(acknowledged).
  - 보낸 뒤 10분 넘게 READBACK이 없으면 카드에 늦음 경고가 뜬다. OCC가 같은 문구를 한 번 더 보내고, 그래도 없으면 SUPERVISOR에게 보고한다.
  - 승인한 뒤에도 보내기 전이면 **전달함**으로 직접 닫을 수 있다(shadow로 되돌렸을 때도). 보낸(sent) 건은 전달함으로 닫지 않는다 — READBACK을 기다린다.
- 보내기 전(승인 대기·승인됨)에 또 바꾸면 처음 구성 기준으로 합친 새 지시문(`CC-0002`)이 앞의 것을 대신한다. 승인됐던 것이면 새 지시문을 다시 승인한다. 원래 구성으로 되돌리면 대기 건만 닫힌다.
- 이미 보낸(sent) 건은 대신하지 않는다. 새 지시문은 그 다음 변경으로 따로 생기고, 승인해 두어도 앞 건의 READBACK이 온 뒤에 나간다(카드에 기다리는 CC 번호가 보인다).
- 아직 운항 전인 AIRCRAFT는 CREW CHANGE 없이 CREW BRIEFING에 새 구성이 들어간다.
- CAPTAIN이 SUPERVISOR가 읽는 글에 일본어를 쓰면 카드에 `LANGUAGE`가 뜨고 FLIGHT FOLLOWING에도 참고로 나온다(ATC-150). 새 CREW BRIEFING에는 "SUPERVISOR가 읽는 글은 한국어" 줄이 들어 있으니 그 세션에 다시 보내면 된다. atc가 대신 보내지는 않는다.

기록은 `~/.local/state/atc/crew-changes.jsonl`에 추가만 한다. 2b를 켜기 전에 DISPATCH 탭 "2b 켜기 점검표"의 **CREW CHANGE 발부**와 배정 대상 AIRPORT마다 있는 **READBACK 규칙**(`[OCC CC-xxxx]` → `READBACK CC-xxxx`까지)을 확인한다.

## 새 팀 들이기

1. **ENTRY INTO SERVICE**를 누른다. 다음 빈 등록번호(`TEAM_G` …)와 AIRPORT가 채워진다.
2. **CONFIGURATION**(팀 구성 템플릿)을 고른다.

   | 템플릿 | 팀원 | 자격 |
   |---|---|---|
   | 일반 | 기본값(Opus, ui-builder, ui-qa, flash-helper) | UI · DATA · DOCS |
   | 보안·DB | Opus + Codex 리뷰 | SEC · DATA · DOCS |
   | UI | Opus + ui-builder + ui-qa | UI · DOCS |
   | 리서치·문서 | Opus + flash-helper | DATA · DOCS |

3. 카드의 **LAUNCH**를 누른다. atc가 그 AIRPORT 저장소에서 등록번호 이름의 백그라운드 세션을 띄우고 CREW BRIEFING을 첫 지시로 넣는다(아래 "세션 띄우고 멈추기").
   - 손으로 열고 싶으면 **CREW BRIEFING**을 복사해, 그 저장소에서 새 세션을 열고 이름을 등록번호로 붙인 뒤 붙여 넣는다.
4. 세션이 뜨면 atc가 이름으로 알아보고 NOT IN SERVICE → IN SERVICE가 된다.

Linear에 `tail:TEAM_G` 라벨이 없으면 먼저 만든다.

## 세션 띄우고 멈추기: LAUNCH · STOP

atc가 AIRCRAFT 세션을 직접 띄우고 멈춘다(2026-09-28부터). Claude Code 백그라운드 세션(`claude --bg`)이다.

- **LAUNCH**: 세션이 없는 카드의 머리에 보인다. **한 번 누르면 기본값으로 바로 띄운다**(확인 창도, 두 번째 상자도 없다). 기본값은 permission mode `auto`(목록의 첫 값), 모델은 LAUNCH MODEL(없으면 `--model` 없이 폴더 기본), ACCOUNT는 LAUNCH ACCOUNT(없으면 그 AIRCRAFT의 home)이고, 버튼 옆의 흐린 글(`acct-1 · opus · auto`)이 지금 무엇으로 뜰지 미리 보인다. 눌러 둔 동안은 `띄우는 중…`으로 막힌다. 세션은 base AIRPORT 저장소에서 뜨고, 이름은 등록번호, 첫 지시는 CREW BRIEFING이다. 곧 카드에 `BG`와 permission mode가 붙는다(id는 툴팁). **옵션**은 LAUNCH에 붙은 작은 **▾**(`LAUNCH 옵션`)에서 카드 안, 머리 바로 아래에 열린다: permission mode, 모델, ACCOUNT(거절된 ACCOUNT는 사유와 함께 흐리게 보이고 고를 수 없다)와 **이 옵션으로 LAUNCH**. 열려 있는 동안 머리의 LAUNCH는 ▾ 하나로 바뀌어 LAUNCH 동작은 늘 하나만 보이고, Esc나 ▾를 다시 누르면 닫히며 초점이 ▾로 돌아간다. **막히면** 서버가 준 사유(상한, 이미 떠 있음, 로그인 안 됨 …)가 카드의 경보 띠에 한 줄로 남는다(닫을 수 있다). 기본 ACCOUNT가 거절돼 있으면 LAUNCH가 꺼지고 버튼 옆 글에 사유가 보인다. 상한 `백그라운드 세션 n/max`는 버튼의 툴팁에 있다.
- **CREW BRIEFING**도 그 카드 바로 아래에 열린다. ENTRY INTO SERVICE로 들인 직후의 CREW BRIEFING만 맨 위, 그 양식 자리에 보인다.
- **STOP**: atc가 띄운 백그라운드 세션에만 보인다. 멈춰도 대화는 남는다. 터미널에서 `claude attach <id>`(기본이 아닌 ACCOUNT 폴더면 `CLAUDE_CONFIG_DIR=… claude attach <id>`, `BG 칩` 참고)로 들여다보거나 `claude --resume`으로 다시 연다.
- **퇴역**: 백그라운드 세션을 모는 AIRCRAFT를 퇴역시키면 세션도 멈출지 묻는다.
- **세션 출처**: 목록 줄과 카드에 `BG`(atc가 띄운 백그라운드), `DESKTOP`(Claude 앱), `TERM`(터미널), `?`(모름)과 permission mode가 보인다. 마우스를 올리면 자세한 설명이 나온다.
- **BG 칩**: 백그라운드 세션이면 목록 줄의 `BG` 칩에 마우스를 올리면 `BG <jobId> — claude attach <jobId>`가 보이고, 카드의 `ATTACH 복사`가 그 `claude attach <jobId>`를 클립보드에 복사한다. 세션이 기본이 아닌 ACCOUNT 폴더에 있으면 둘 다 `CLAUDE_CONFIG_DIR=~/.claude-acct-1 claude attach <jobId>`처럼 그 폴더가 앞에 붙는다(atc가 세션을 읽은 폴더). 터미널에 붙여 넣으면 그 세션이 열린다. 세션이 멈췄거나(STALE 포함) 백그라운드가 아니면 칩도 버튼도 없다.
- 데스크톱·터미널에서 직접 연 세션은 atc가 멈추거나 다시 띄우지 않는다. 카드에 그 출처의 손 절차가 한 줄 보인다(데스크톱: Claude 앱에서 닫기, 터미널: `/exit`). FLEET PLAN의 RESTART·REFRESH도 같은 절차를 사유에 적는다.
- **ACCOUNT**: BG 세션은 이 호스트의 CLI 로그인을, DESKTOP 세션은 Claude 앱의 계정을 따른다(카드의 ACCOUNT 아래 한 줄). atc는 계정 정보를 읽지 않는다.
- **2b 전달 경고**: DISPATCH 카드와 IN FLIGHT 줄의 AIRCRAFT 옆에 `MODE default ≠ OCC auto` 같은 노란 표시가 뜨면, 그 세션의 permission mode가 OCC와 다르다는 뜻이다. FLIGHT PLAN 메시지가 그 세션에서 사용자 승인 대기로 잡혀 NO READBACK이 될 수 있다. 데스크톱 세션이면 앱에서 메시지를 승인하거나 모드를 맞춘다. 막지는 않는다.
- 막히는 경우: 이미 같은 이름의 세션이 있음, 백그라운드 세션이 상한(기본 6, `ATC_MAX_LAUNCHED`)에 닿음, RETIRED, base AIRPORT 없음, 그 저장소를 Claude Code가 신뢰하지 않음(그 저장소에서 `claude`를 한 번 열어 trust를 수락한다).
- 띄운 세션은 사용량 한도를 쓴다. atc의 비밀(`.env.local`)은 세션에 넘기지 않는다. `bypassPermissions`는 고를 수 없다.
- 관제 세션(TOWER·OCC·CROSSCHECK·REVIEW)은 세션을 띄우거나 멈출 수 없다. 이 화면에서 보낸 요청만 받는다.
- LAUNCH·STOP은 모두 FLIGHT RECORDER에 남는다. DISPATCH 카드 승인으로 띄운 것은 그 제안 번호(D-xxxx)도 남는다.
- **백그라운드 세션은 60분쯤 쉬면 끝난다**: Claude Code가 마지막 턴 뒤 60분쯤 쉰 백그라운드 세션을 거둔다(`~/.claude/daemon.log`의 `bg retire …: idle 60m`). 대화는 남는다. 관제 세션은 `/loop`가 몇 분마다 돌아 끝나지 않는다. 끝난 AIRCRAFT는 NOT IN SERVICE로 보이지만 DISPATCH 후보로 남아, 그 카드를 승인하면 atc가 다시 띄운다(판정하기의 "LAUNCH 카드와 RESUME 카드"). atc는 세션을 붙잡아 두려고 메시지를 보내지 않는다.

## RELAY: AIRCRAFT에게 글 보내기

카드(와 PR 서랍)의 **RELAY…**는 SUPERVISOR가 AIRCRAFT에게 짧은 글을 보내는 길입니다. 글은 **영어**로 쓰고(세션끼리 주고받는 글은 영어입니다), 종류는 `INFO`(알림, ROGER로 답함)나 `INSTRUCTION`(지시, READBACK이나 UNABLE로 답함)입니다. **보내기…**를 누르면 받는 AIRCRAFT·종류·글을 한 번 더 보여 주고, **보내기 확인**을 눌러야 나갑니다. 글은 TOWER가 CLEARANCE로 **고치지 않고** 그대로 보냅니다(다음 tick에). PR 서랍의 RELAY…는 그 PR의 현재 head에 리뷰 지적이 있으면 FIX 글이 채워진 채로 열립니다. 카드의 RELAY…에서 **이슈 댓글 넣기**는 그 FLIGHT에 SUPERVISOR가 단 Linear 댓글을 글로 채웁니다(FLIGHT PLAN을 보낸 뒤 단 댓글을 전할 때). 닿지 못하면 DUTY 서랍의 QUEUE에 손으로 전하는 카드가 뜹니다([DUTY 채팅](duty.md)).

STAND를 쥔 세션이 없는 PR에 GO AROUND나 FIX가 필요하면 TOWER가 보낼 곳이 없습니다. 이때는 QUEUE에 `RELAY` 줄이 하나 뜹니다(PR과 head마다 하나). 줄에는 TOWER의 글과 그 FLIGHT를 난 AIRCRAFT(제안, 다른 REGISTRATION으로 고칠 수 있음)가 있고, **RELAY…** → **보내기…** → **보내기 확인**으로 한 번 확인하면 TOWER가 그 글을 고치지 않고 `GO AROUND`나 `FIX` CLEARANCE로 그 PR의 STAND에 묶어 보냅니다. PR 서랍의 **RELAY…** 줄도 같은 글을 채워 줍니다. head가 바뀌거나 PR이 닫히거나 쥔 세션이 생기면 줄은 사라집니다.

## FLEET PLAN: atc의 제안

카드 위의 FLEET PLAN 블록은 atc가 팀을 언제 띄우고, 멈추고, 쉬게 하고, 퇴역시키자고 하는지 보여 준다. 지금은 **그림자**다. atc는 제안만 하고, SUPERVISOR는 **동의**·**반대**로 판정만 한다. 실제로 띄우거나 멈추는 것은 여전히 카드의 버튼으로 한다.

| 제안 | 언제 | 하려는 일 |
|---|---|---|
| LAUNCH | 받을 AIRCRAFT가 없는 FLIGHT가 120분 이어짐 | 그 FLIGHT를 날 수 있는, 세션이 없는 등록 AIRCRAFT를 띄운다 |
| ENTRY | LAUNCH와 같은데 맞는 등록 AIRCRAFT가 없음 | 새 등록번호와 CONFIGURATION으로 들이고 띄운다 |
| STOP | 백그라운드 세션이 12시간 STAND·FLIGHT·활동 없이 쉼 | 멈춘다(대화는 남는다). 수요가 있는 AIRPORT에는 PARKED 1대를 남긴다 |
| RESTART | 백그라운드 세션이 3일 넘었고 PARKED. 또는 health가 `CONTEXT`(대화가 넘침)이거나 60분 넘은 `HUNG` | 새 CREW BRIEFING으로 다시 띄운다. 쥐고 있던 STAND·PR은 새 세션이 넘겨받는다. 데스크톱·터미널 세션은 승인으로 실행되지 않으니 손으로 닫고 다시 연다 |
| REFRESH | FLIGHT를 마치고 쉬는 AIRCRAFT(PARKED, 또는 ARRIVED한 FLIGHT의 STAND만 쥠)의 대화가 300k 토큰이나 창의 40 %를 넘음. 열린 PR이나 이번 계획의 FLIGHT가 있거나, 2시간 안에 띄웠으면 내지 않는다 | 대화를 새로 시작한다. 사유에 크기와 아낌(다음 cold wake에 다시 쓰지 않아도 되는 캐시 비용, 턴마다의 읽기 비용)이 보인다. 백그라운드 세션은 RESTART처럼 다시 띄운다. 데스크톱·터미널 세션은 atc가 건드리지 않는다: 그 세션에서 `/clear`하고 **CREW BRIEFING 복사**로 받은 글을 붙여 넣는다 |
| AOG | NORDO이거나 최근 24시간 LOS. 또는 health가 `MODEL`(모델·경로 문제)이거나 주간 `LIMIT` | 24시간 기한으로 배정을 멈춘다. 주간 `LIMIT`만이면 reset 날까지 |
| RETIRE | 30일 동안 ARRIVED 없음 | 퇴역(자동으로는 하지 않는다) |
| RETURN | FLEET PLAN이 건 AOG의 해제 예정일이 지남 | AOG를 푼다 |

- **수요**는 DISPATCH와 같은 제외 규칙을 통과한 FLIGHT다. ATC 팀 FLIGHT도 센다. AIRPORT마다 "배정 · 받을 곳 없음 · PARKED" 한 줄이 보인다. LAUNCH를 막는 것(GROUND STOP, 착륙 대기가 block time보다 긴 활주로, 백그라운드 세션 상한)이 있으면 그 줄에 적힌다.
- **FUEL**: ACCOUNT마다 한 줄이다(2026-09-29부터 FLEET PLAN이 아니라 AIRCRAFT 목록 아래 FUEL ACCOUNT 블록에 있다. FLEET PLAN의 같은 줄은 옛 서버일 때만 보인다). 가장 많이 쓴 창과 reset, 그 ACCOUNT의 AIRCRAFT와 관제 세션이다. 95 %(hold 수준)를 넘은 ACCOUNT의 AIRCRAFT는 LAUNCH하지 않고(`LAUNCH·ENTRY 제안 안 함`), 수요 줄에 `FUEL 사용 100% (account acct-1) until 21:48Z — TEAM_Q`처럼 이유가 적힌다. 맞는 다른 AIRCRAFT가 있으면 그것을 제안하고, 맞는 AIRCRAFT가 모두 막혔으면 ENTRY도 내지 않는다(새 세션은 이 기기에 로그인된 계정으로 열리는데 atc는 그 계정을 모른다). 맞는 등록 AIRCRAFT가 아예 없어 내는 ENTRY는 새 AIRCRAFT를 `default` ACCOUNT로 세고, `default`가 hold면 내지 않는다. 80 %(info)부터는 제안은 하되 사유에 FUEL 줄(`fuel`)이 붙는다. 열린 LAUNCH·ENTRY의 ACCOUNT가 hold가 되면 그 제안은 FUEL 사유로 닫힌다. 이것은 DISPATCH HOLD 스위치와 상관없다. 스위치는 DISPATCH만 정한다.
- 조건이 두 주기(10분) 이어져야 제안이 되고, LAUNCH·ENTRY는 120분 이어져야 된다. 그 전에는 "지켜보는 중"에 보인다. 조건이 풀리면 제안은 저절로 닫힌다(조건 풀림).
- **반대**를 누르면 이유를 적을 수 있다(선택). 판정한 제안은 24시간 다시 나오지 않는다. 띄우거나 멈춘 지 2시간 안에는 반대 제안(LAUNCH ↔ STOP)을 내지 않는다.
- FLEET PLAN은 판정이 5건 이상이고 동의가 80% 이상이면 게이트를 통과한다(DISPATCH·SCHEDULE은 그대로 20건, 80%). 그러면 블록 오른쪽의 **승인 운용 켜기**가 눌린다.

### 승인 운용

승인 운용을 켜면 동의 자리에 **승인(실행)**이 나온다. 누르면 무엇을 실행하는지 보여 주는 작은 양식이 열리고, 한 번 더 누르면 카드의 버튼과 같은 코드로 곧바로 실행한다. 제안마다 하나씩 승인한다.

| 제안 | 승인하면 | 양식에서 고르는 것 |
|---|---|---|
| LAUNCH | 세션을 띄운다 | permission mode(기본 `auto`), 모델 |
| ENTRY | 새 AIRCRAFT를 들이고 띄운다 | permission mode, 모델 |
| STOP | 백그라운드 세션을 멈춘다 | — |
| RESTART | 멈추고 새 CREW BRIEFING으로 다시 띄운다 | permission mode·모델(비우면 마지막 LAUNCH와 같게) |
| REFRESH | 백그라운드 세션: RESTART와 같다. 데스크톱·터미널 세션: 실행하지 않는다. `/clear`하고 CREW BRIEFING을 붙여 넣은 뒤 **했음**을 누른다 | RESTART와 같다 |
| AOG | AOG로 둔다(사유 `FLEET PLAN F-xxxx`) | 해제 예정일 |
| RETIRE | 퇴역시킨다 | 백그라운드 세션도 멈출지(기본 멈춤) |
| RETURN | AOG를 푼다 | — |

- 승인할 때 다시 확인한다. 최근 계산(10분 안)이 같은 제안을 더는 내지 않으면 "조건이 바뀜"으로 막히고, 버튼이 꺼진다. 다음 주기를 기다린다.
- 이미 떠 있음, 백그라운드 상한, RETIRED 같은 LAUNCH·STOP의 거절 조건도 그대로 적용된다.
- ENTRY·RESTART는 두 단계다. 둘째 단계가 실패하면 첫째 단계는 된 채로 남는다. "최근"에 어느 단계가 실패했는지 보이니, 카드의 버튼으로 마무리한다.
- 실행이 끝난 제안은 24시간 다시 나오지 않는다. 실패한 제안은 조건이 이어지면 다음 주기에 다시 나온다.
- 승인과 승인 운용 켜기는 이 화면에서만 된다. **그림자로 돌리기**는 언제나 된다.
- 실행한 일은 FLIGHT RECORDER에 `FLEET PLAN F-xxxx`로 남는다.
- 판정은 이 화면에서만 된다. 관제 세션은 판정할 수 없다.

## CHECKRIDE: TYPE RATING 근거와 추천

FLEET 탭 카드 아래의 CHECKRIDE는 팀마다, TYPE RATING(SEC · UI · DATA · DOCS)마다 LOGBOOK에서 근거를 모아 보여 준다. 추천만 하고, rating은 SUPERVISOR가 버튼을 누를 때만 바뀐다.

**근거가 되는 FLIGHT**: 그 팀이 몰아 ARRIVED한 FLIGHT 중 그 rating이 필요했던 것. rating은 이 순서로 정한다.

1. Linear 라벨(`rating:SEC` 등, Risk 그룹은 SEC) — 근거에 "라벨"
2. SUPERVISOR가 받아들인(agree·approve) SCHEDULE CLASSIFY 초안의 rating — 근거에 "SCHEDULE S-0003"
3. 둘 다 없으면 근거로 세지 않는다. AD HOC도 세지 않는다.

**추천**(처음 제안값, 운용하며 조정):

| 표시 | 뜻 | 버튼 |
|---|---|---|
| 부여 추천 | 가지지 않은 rating인데 최근 30일 그 rating FLIGHT 3건 이상, 되돌림 0, Codex 지적 라운드 평균 3 미만 | 부여 |
| 재검토 추천 | 가진 rating인데 최근 14일 그 rating FLIGHT에서 되돌림이 났거나, 2건 이상의 지적 라운드 평균이 3 이상 | 회수 |
| 추천 안 함 | 근거는 충분하지만 SEC를 맡을 CREW가 없음(flash-helper만). 이유가 보인다 | — |
| 근거 쌓는 중 | 근거가 아직 모자람(예: 근거 1/3) | — |
| 보유 | 가진 rating, 문제 없음 | — |

근거 N건을 펼치면 FLIGHT, PR, 출처, Codex 지적 라운드, REVERTED가 보인다. **부여**·**회수**는 확인 창을 거쳐 팀 프로필의 TYPE RATING을 바꾸고(고치기 화면과 같은 규칙), 누가 무엇을 근거로 했는지 FLIGHT RECORDER에 남는다. 자동으로 부여하거나 회수하지 않는다.

## 쉬게 하기와 퇴역

- **AOG**: 사유와 해제 예정일을 남기고 잠시 배정을 멈춘다. DISPATCH에 "AOG — 사유"로 보인다.
- **RETIREMENT**: 목록과 계획에서 뺀다. RETIRED 목록에 남고 복귀할 수 있다. 살아 있는 세션을 닫지는 않는다.

## 이름

`TEAM_X`는 REGISTRATION으로 그대로 둔다. vocado 규칙, `tail:` 라벨, planner가 모두 이 이름에 걸려 있다. atc의 말로 팀은 CAPTAIN이 이끄는 CREW가 모는 AIRCRAFT다.

세션 이름은 `TEAM_G`로 짓는다. `Team G`, `TEAM-G`, `team_g`처럼 적어도 atc는 같은 AIRCRAFT(`TEAM_G`)로 읽고 FLEET 항목, `tail:` 라벨, ACCOUNT에 이어 준다. 대신 FLEET 카드에 "세션 이름 Team G → TEAM_G로 바꾸면 좋다"가 보이고, 목록의 REGISTRATION 옆에 `이름` 표시가 붙는다. DISPATCH의 FLIGHT PLAN은 실제 세션 이름(`Team G`)으로 보내므로 그대로 받지만, 이름을 바꿔 두면 헷갈릴 일이 없다.

같은 REGISTRATION으로 읽히는 세션이 둘 이상 떠 있으면(예: `TEAM_H`와 `team-h`, 또는 계정을 바꿔 같은 이름을 다시 띄움) FLEET는 둘을 합치지 않고 "세션 2개가 TEAM_H로 읽힘"으로 알린다. 하나만 남기거나 이름을 바꾼다.

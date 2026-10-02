# 일 맡기기

일의 크기에 따라 두 길이 있다.

| 상황 | 방법 | 화면 |
|---|---|---|
| 작은 수정 (5줄 이하, 문서, 의존성) | 팀 세션에 직접 맡긴다. 티켓 없이 PR 본문의 "Explicit user task"에 요청을 적는다 | STRIPS에 **AD HOC** |
| 티켓이 필요한 일 (기능, 컴포넌트, 화면 수정 …) | OCC 세션에 말한다(**CHARTER REQUEST**) | HOME의 QUEUE(S2일 때)나 RELEASE에 **AD HOC FLIGHT** 초안 |

## CHARTER DESK: OCC에 요청하기

OCC 세션이 요청 창구(CHARTER DESK)다. 운항표(Linear)에 없는 일을 받아 티켓 초안으로 만든다.

```
CHARTER REQUEST ─▶ AD HOC FLIGHT 초안 ─▶ FILED ─▶ ASSIGN ─▶ ENROUTE ─▶ ARRIVED
 (OCC에 말하기)     (HOME QUEUE 판정)    (Linear Todo)  (DISPATCH)  (팀 작업)   (머지)
```

1. OCC 세션에 무엇을 원하는지 말한다. 예: "홈 화면에 추천 곡 카드 컴포넌트 만들어 줘. Song Experience 쪽."
2. OCC가 SCHEDULE `NEW` 초안을 쓴다. 제목, 프로젝트, DIRECT 형식 본문(목표·완료 기준과 이 작업만의 제약. 보안 작업이면 Hard constraints 줄. 늘 지키는 규칙은 되풀이하지 않는다), type·wake·rating, 맞는 팀이 분명하면 `tail:`, 그리고 비슷한 티켓 목록.
3. HOME의 QUEUE에서 판정한다(S2일 때)([판정하기](reviewing.md)).
4. **지금은 S1(그림자 운용)이라 Linear에 실제로 만들지 않는다.** 필요하면 카드의 제목·본문·라벨로 Linear에 직접 만든다. S2부터는 승인한 초안을 OCC가 Linear에 쓴다.

OCC는 사용자가 요청했을 때만 새 티켓 초안을 쓴다. 스스로 티켓을 지어내지 않는다.

일이 끝난 뒤 Linear 정리도 OCC가 돕는다: PR이 머지됐는데(LOGBOOK에 ARRIVED) 이슈가 열려 있으면 `CLOSE` 초안을 쓴다. 이슈 상태는 사용자가 Linear에서 직접 Done으로 바꾼다([판정하기](reviewing.md)). 팀 PR 본문에 `Fixes VOC-n`을 쓰게 하면(일부만이면 `Part of VOC-n`) CLOSE 후보가 정확해진다.

## 발권(RELEASE): DISPATCH가 배정할 FLIGHT 정하기

Todo에 있는 FLIGHT도 **발권**해야 DISPATCH가 배정한다. 발권이 없는 Todo FLIGHT는 제안일 뿐이다. 발권은 **RELEASE 탭**(`#release`) 한 곳에서 한다. DISPATCH 탭은 없어졌다(HOME이 이어받았다).

RELEASE 탭은 위에서부터 셋이다.

- **후보**: atc가 Backlog에 올린 **제안**(DUTY REVIEW와 SCHEDULE NEW가 만든 이슈), 막는 이슈가 모두 끝난 Backlog 이슈(READY), 아직 이슈가 아닌 SCHEDULE NEW 초안. 줄마다 우선순위와, 이슈 본문 `## K effects` 절에 선언한 **K 효과**가 클릭 전에 보인다(선언이 없으면 `선언 없음`). READY 줄의 **발권**은 이슈를 Todo로 옮기고 그 자리에서 발권을 기록해, DISPATCH가 바로 배정할 수 있게 한다(Linear에 쓴다). 우선순위가 없는 이슈는 **우선순위 먼저**가 FLIGHT 서랍을 연다. DISPATCH는 우선순위 없는 이슈를 배정하지 않는다. **제안** 줄에는 누가 언제 제안했는지, 우선순위, 선언한 K 효과가 보입니다. **발권**을 누르면 이슈를 Todo로 옮기고 발권을 기록하며, **버림…**은 Canceled로 옮기고 적은 사유를 이슈에 댓글로 남겨 목록이 차지 않게 합니다. 우선순위가 없는 제안은 Todo로 옮기지 않고(DISPATCH가 건너뜁니다) 그렇게 말합니다. 열린 이슈가 막고 있는 제안은 목록에 없다가 풀리면 나타납니다. 기다리는 제안은 HOME의 QUEUE(`BACKLOG`)에도 뜨고 누수 카운터가 셉니다. SCHEDULE NEW 초안은 아직 이슈가 아니어서 여기서 발권할 수 없다. **SCHEDULE에서 승인**하면 Backlog 이슈가 생기고 그 뒤 여기 READY로 온다.
- **Todo, 발권 전**: 이미 Todo에 있는데 발권이 없는 이슈.
- **최근 발권**: 최근 15건과 지난 7일 채널별 수(화면, DUTY 채팅, attested).

- 한 건은 줄 끝의 **발권** 버튼, 이미 Todo에 있는 것들은 **모두 발권…**을 눌러 한 번에 확인한다. 이 화면의 클릭만 화면 발권이 된다. agent는 만들 수 없다.
- 첫 일괄 확인부터 발권한 FLIGHT만 배정한다(그 전에는 지금처럼 배정한다). 발권한 뒤 이슈의 목표·완료 기준·K 효과가 바뀌면 다시 발권해야 한다.
- DUTY 채팅에 `RELEASE ATC-n`(또는 `발권 ATC-n`) 한 줄을 쓰면 DUTY 채팅 발권으로 기록된다. 다른 세션에 말로 발권했다면 그 세션이 `attested`로 증언하고, RELEASE 탭이 세션마다 그 수를 보여 준다. 증언은 서버가 확인할 수 없으니 가끔 확인한다.

## 팀에 직접 맡길 때

- 누구에게 맡길지는 FLEET 탭에서 고른다: 필요한 TYPE RATING을 갖고, 가능하면 ROUTE(담당 프로젝트)가 맞고, PARKED인 팀.
- 티켓이 있는 일이면 CAPTAIN이 Linear를 In Progress로 바꾼다(Linear에는 CAPTAIN만 쓴다).
- 사람이 직접 준 배정이 DISPATCH 제안보다 우선한다. 팀이 STAND를 잡으면 같은 FLIGHT의 제안은 물러난다.

## atc 화면의 불편 보고하기

atc 자신의 화면(FLEET 탭 등)에서 막힌 점은 고칠지 정하기 전에 먼저 보고로 남긴다. 항공의 UCR(Unsatisfactory Condition Report)처럼, 불편을 알리는 일과 바꾸기로 정하는 일을 나눈다.

```
UI report ─▶ 판정 ─▶ Linear ATC ─▶ 팀 작업 ─▶ 써 보고 닫기
(GitHub 이슈)  (라벨·묶기)  (할 것만)     (PR·배포)    (결과를 이슈에)
```

1. **보고**: GitHub에서 New issue → **UI report** 양식. 보고 하나에 불편 하나, 탭·하려던 일·막힌 점을 사실대로 적는다. 제안은 알면 적고, 없어도 보고한다. `idea` 라벨이 붙는다.
2. **판정**: 쌓인 보고를 한 번에 본다. 영역 라벨(FLEET 탭이면 `fleet`)을 붙이고, 같은 불편은 하나로 묶어 나머지를 닫는다. 안 할 것은 이유를 적고 닫는다.
3. **Linear ATC 티켓**: 할 것만 올린다. 본문에 보고 이슈(`chaehy5665/atc#N`)를 링크한다. ATC 팀도 DISPATCH 후보(`dispatch.json`의 `candidateTeams`)라서, 우선순위를 정하면 DISPATCH가 ATCC 팀에 ASSIGN을 제안한다. 급하거나 맡길 팀이 정해져 있으면 위 "팀에 직접 맡길 때"처럼 직접 맡긴다. 화면 일이면 ATCC의 UI 구성 팀. 배치가 크게 바뀌면 `docs/` 설계 초안을 먼저 쓴다.
4. **닫기**: 팀 PR은 `Fixes ATC-n`과 `Refs #N`을 쓴다(`Fixes #N`이 아니다). 배포만으로 닫지 않는다. 고친 화면을 며칠 써 보고, 불편이 풀렸는지 보고 이슈에 적은 뒤 닫는다. 남았으면 새 보고로 이어 간다.

## 특정 팀에 묶어 두기: TAIL ASSIGNMENT

티켓에 Linear 라벨 `tail:TEAM_X`를 붙이면 DISPATCH가 그 팀에만 제안한다. 그 팀이 바쁘면 다른 팀에 주지 않고 기다린다. 새 팀이면 라벨을 먼저 만들어야 한다.

라벨은 손으로 붙여도 되고, OCC에 맡겨도 된다.

- OCC 세션에 "VOC-196은 TEAM_E가 맡는다"처럼 말하면 OCC가 SCHEDULE `TAIL` 초안을 쓴다. HOME의 QUEUE에서 판정한다(S2일 때).
- DISPATCH 밖에서 팀에 직접 맡긴 FLIGHT(STAND를 잡았거나, DEPARTURE LOG에 있거나, READBACK을 받음)에 `tail:`이 없으면 OCC가 SCHEDULE 후보(TAIL)에서 보고 초안을 쓸 수 있다.
- 승인하면(S2) OCC가 `tail:`을 그 팀으로 바꾼다. 다른 `tail:`은 떼고 나머지 라벨은 그대로 둔다. 상태·담당은 바꾸지 않는다.
- `tail:TEAM_X` 라벨이 Linear에 없으면 초안이 거절된다. ENGINEERING이나 사용자가 라벨을 만든다.

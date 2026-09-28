# 일 맡기기

일의 크기에 따라 두 길이 있다.

| 상황 | 방법 | 화면 |
|---|---|---|
| 작은 수정 (5줄 이하, 문서, 의존성) | 팀 세션에 직접 맡긴다. 티켓 없이 PR 본문의 "Explicit user task"에 요청을 적는다 | STRIPS에 **AD HOC** |
| 티켓이 필요한 일 (기능, 컴포넌트, 화면 수정 …) | OCC 세션에 말한다(**CHARTER REQUEST**) | SCHEDULE 탭에 **AD HOC FLIGHT** 초안 |

## CHARTER DESK: OCC에 요청하기

OCC 세션이 요청 창구(CHARTER DESK)다. 운항표(Linear)에 없는 일을 받아 티켓 초안으로 만든다.

```
CHARTER REQUEST ─▶ AD HOC FLIGHT 초안 ─▶ FILED ─▶ ASSIGN ─▶ ENROUTE ─▶ ARRIVED
 (OCC에 말하기)     (SCHEDULE 탭 판정)    (Linear Todo)  (DISPATCH)  (팀 작업)   (머지)
```

1. OCC 세션에 무엇을 원하는지 말한다. 예: "홈 화면에 추천 곡 카드 컴포넌트 만들어 줘. Song Experience 쪽."
2. OCC가 SCHEDULE `NEW` 초안을 쓴다. 제목, 프로젝트, DIRECT 형식 본문(목표·완료 기준과 이 작업만의 제약. 보안 작업이면 Hard constraints 줄. 늘 지키는 규칙은 되풀이하지 않는다), type·wake·rating, 맞는 팀이 분명하면 `tail:`, 그리고 비슷한 티켓 목록.
3. SCHEDULE 탭에서 판정한다([판정하기](reviewing.md)).
4. **지금은 S1(그림자 운용)이라 Linear에 실제로 만들지 않는다.** 필요하면 카드의 제목·본문·라벨로 Linear에 직접 만든다. S2부터는 승인한 초안을 OCC가 Linear에 쓴다.

OCC는 사용자가 요청했을 때만 새 티켓 초안을 쓴다. 스스로 티켓을 지어내지 않는다.

일이 끝난 뒤 Linear 정리도 OCC가 돕는다: PR이 머지됐는데(LOGBOOK에 ARRIVED) 이슈가 열려 있으면 `CLOSE` 초안을 쓴다. 이슈 상태는 사용자가 Linear에서 직접 Done으로 바꾼다([판정하기](reviewing.md)). 팀 PR 본문에 `Fixes VOC-n`을 쓰게 하면(일부만이면 `Part of VOC-n`) CLOSE 후보가 정확해진다.

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

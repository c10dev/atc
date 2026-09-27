# 팀 운영 (FLEET)

FLEET 탭에서 팀(AIRCRAFT)을 꾸리고, 쉬게 하고, 퇴역시킨다. 팀 정보는 `~/.local/state/atc/fleet.json`에 저장되고 DISPATCH planner가 쓴다.

## 팀 프로필

| 항목 | 뜻 | planner가 쓰는 법 |
|---|---|---|
| CREW COMPLEMENT | 기본 팀원 구성과 모델 | 그 구성이 할 수 없는 종류의 일은 주지 않음(예: flash-helper만 있으면 BUILD 없음) |
| TYPE RATING | 맡을 수 있는 일: SEC · UI · DATA · DOCS | 필요한 자격을 모두 가진 팀에만 제안 |
| ROUTE | 주 담당 Linear 프로젝트 | 담당이면 점수 +1 |
| TARGETS | 주간 FLIGHT 수, 정시성 | 표시만(점수에 안 씀). 실적은 LOGBOOK으로 센다(아래) |

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
| 이번 주 3/3 | 이번 주(월요일 0시부터) ARRIVED 수 / 목표. 목표보다 적으면 노란색 |
| 정시 67% (목표 80%) | 최근 14일 FLIGHT 중 팀 소요 시간이 기대치 안인 비율. 목표보다 낮으면 노란색 |
| 14일 ARRIVED · 되돌림 · LOS | 최근 14일 합계. 되돌림과 LOS가 있으면 빨간색 |
| 착륙 대기 중앙값 5h | 최근 14일 FLIGHT의 착륙 대기 중앙값 |
| 최근 FLIGHT | 5건: FLIGHT(AD HOC), PR 번호, 팀 소요 시간(모르면 `—`), `+`착륙 대기, ON TIME / DELAYED, REVERTED, LOS, 날짜. FLIGHT를 누르면 PR이 열린다 |

기대 block time은 `wake` 라벨이 있으면 L 60분 · M 4시간 · H 2일이다. 라벨이 없거나 J거나 AD HOC이면 같은 FLIGHT TYPE·WAKE로 끝난 다른 FLIGHT(3건 이상)의 중앙값과 비교하고, 모자라면 정시율에서 뺀다. 실적은 보여 주기만 하고 배정 점수에는 쓰지 않는다.

## 새 팀 들이기

1. **ENTRY INTO SERVICE**를 누른다. 다음 빈 등록번호(`TEAM_G` …)와 AIRPORT가 채워진다.
2. **CONFIGURATION**(팀 구성 템플릿)을 고른다.

   | 템플릿 | 팀원 | 자격 |
   |---|---|---|
   | 일반 | 기본값(Opus, ui-builder, ui-qa, flash-helper) | UI · DATA · DOCS |
   | 보안·DB | Opus + Codex 리뷰 | SEC · DATA · DOCS |
   | UI | Opus + ui-builder + ui-qa | UI · DOCS |
   | 리서치·문서 | Opus + flash-helper | DATA · DOCS |

3. **CREW BRIEFING**을 복사한다.
4. 그 AIRPORT의 저장소에서 새 세션을 열고, 이름을 등록번호로 붙이고, 브리핑을 붙여 넣는다.
5. 세션이 뜨면 atc가 이름으로 알아보고 NOT IN SERVICE → IN SERVICE가 된다.

atc는 세션을 직접 띄우지 않는다. Linear에 `tail:TEAM_G` 라벨이 없으면 먼저 만든다.

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

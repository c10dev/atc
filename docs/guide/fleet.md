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

## 관측 CREW와 drift

카드의 OBSERVED CREW는 선언한 CREW COMPLEMENT 옆에 최근 14일 동안 실제로 본 팀원을 보여 준다. 그 등록번호 이름의 세션(지금 살아 있는 세션과 이름이 같았던 지난 세션)이 부른 서브에이전트를 agent type·모델별로 묶어, 부른 횟수와 마지막 시각을 적는다.

atc는 세션 메타데이터만 읽는다: 서브에이전트의 agent type, 부를 때 준 모델, 파일 시각, 세션 이름. 대화 기록, 지시문, 작업 설명은 읽지 않는다.

관측한 팀원은 선언한 POSITION에 이렇게 맞춘다.

| 관측 | POSITION |
|---|---|
| `ui-builder`, `ui-qa`, `flash-helper`처럼 선언한 POSITION이나 agent와 이름이 같은 타입 | 그 POSITION |
| `general-purpose`·`claude` + Opus 모델 | `backend`(agent에 opus가 든 팀원) |
| `general-purpose`·`claude` + 모델 지정 없음 | `backend`로 본다. CAPTAIN의 모델(Opus)을 물려받기 때문이다. 실제 모델은 보이지 않아 모델 칸은 비어 있다 |
| `Explore`, `Plan`, `claude-code-guide` 같은 내장 타입, 그 밖의 타입 | 맞추지 않음. 선언에 agent로 적으면 맞춘다 |

drift 두 줄의 뜻:

- **선언에 없음: Explore** — 불렀지만 선언에 없는 타입. 모델을 줬으면 `general-purpose (sonnet)`처럼 붙는다. 자주 쓰면 COMPLEMENT에 넣을지 정한다.
- **최근 14일 안 씀: flash-helper** — 선언했지만 기간 안에 부르지 않은 POSITION. 잘못이 아니라 "안 보였다"는 뜻이다. Codex 리뷰(`security` 구성의 reviewer)처럼 서브에이전트로 부르지 않는 POSITION은 늘 여기에 뜬다.

이름이 같은 세션이 없으면 관측 CREW는 나오지 않는다. agent team처럼 팀원이 따로 세션으로 도는 경우 그 팀원은 보이지 않는다(CAPTAIN이 Agent로 부른 팀원은 보인다).

## CREW CHANGE

운항 중인 AIRCRAFT(퇴역하지 않았고 그 이름의 세션이 살아 있음)의 CREW COMPLEMENT를 바꿔 저장하면, atc가 CAPTAIN에게 줄 **CREW CHANGE** 지시문을 만든다. 카드에 **CREW CHANGE 대기**로 나온다.

- 내리고(−) 타는(+) 팀원과 모델, 그리고 TYPE RATING 영향이 보인다. 예: 유일한 구현 팀원을 내리면 "BUILD·MAINT·TEST를 더는 날 수 없음", 판정할 팀원이 없으면 "CHECK를 더는 날 수 없음".
- 지시문은 `[ATC FLEET] CREW CHANGE · HOTEL (TEAM_H) · CC-0001`로 시작하고, 팀원을 멈추거나 그 모델로 만드는 법을 적은 뒤 `"TEAM_H CREW CHANGE CC-0001 COMPLETE"` 한 줄로 답하라고 끝난다.
- **atc는 보내지 않는다.** **복사**를 눌러 그 팀의 CAPTAIN 세션에 붙여 넣고 **전달함**을 누른다. 대기 카드가 사라지고 기록에 전달 시각이 남는다.
- 전달하기 전에 또 바꾸면 처음 구성 기준으로 합친 새 지시문(`CC-0002`)이 앞의 것을 대신한다. 원래 구성으로 되돌리면 대기 건만 닫힌다.
- 아직 운항 전인 AIRCRAFT는 CREW CHANGE 없이 CREW BRIEFING에 새 구성이 들어간다.

기록은 `~/.local/state/atc/crew-changes.jsonl`에 추가만 한다.

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

## 쉬게 하기와 퇴역

- **AOG**: 사유와 해제 예정일을 남기고 잠시 배정을 멈춘다. DISPATCH에 "AOG — 사유"로 보인다.
- **RETIREMENT**: 목록과 계획에서 뺀다. RETIRED 목록에 남고 복귀할 수 있다. 살아 있는 세션을 닫지는 않는다.

## 이름

`TEAM_X`는 REGISTRATION으로 그대로 둔다. vocado 규칙, `tail:` 라벨, planner가 모두 이 이름에 걸려 있다. atc의 말로 팀은 CAPTAIN이 이끄는 CREW가 모는 AIRCRAFT다.

# 팀 운영 (FLEET)

FLEET 탭에서 팀(AIRCRAFT)을 꾸리고, 쉬게 하고, 퇴역시킨다. 팀 정보는 `~/.local/state/atc/fleet.json`에 저장되고 DISPATCH planner가 쓴다.

## 팀 프로필

| 항목 | 뜻 | planner가 쓰는 법 |
|---|---|---|
| CREW COMPLEMENT | 기본 팀원 구성과 모델 | 그 구성이 할 수 없는 종류의 일은 주지 않음(예: flash-helper만 있으면 BUILD 없음) |
| TYPE RATING | 맡을 수 있는 일: SEC · UI · DATA · DOCS | 필요한 자격을 모두 가진 팀에만 제안 |
| ROUTE | 주 담당 Linear 프로젝트 | 담당이면 점수 +1 |
| TARGETS | 주간 FLIGHT 수, 정시성 | 표시만(점수에 안 씀) |

정하지 않은 항목은 vocado 팀원 규칙에서 온 기본값을 따른다. SEC는 보안 작업을 맡을 팀원이 있어야 줄 수 있다.

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

# skill과 규정집

atc 세션이 일하는 방법은 세 가지 파일에 나뉘어 있습니다: 매번 따르는 규칙(`CLAUDE.md`), 그때그때 여는 **skill**, 그리고 skill 가운데 비정상 상황만 모은 **규정집**(`rulebook/`)입니다. 이 쪽은 지금 무엇이 있고, 누가 언제 쓰고, 어디서 쓰였는지 보고, 무엇을 SUPERVISOR가 정하는지를 적습니다. 자세한 표와 근거는 영어 참고 문서 [docs/skills.md](https://github.com/chaehy5665/atc/blob/main/docs/skills.md)에 있습니다. 이 쪽은 `origin/main`의 `eb810e6`(2026-10-01) 기준입니다.

## 말뜻

- **skill**: 한 가지 일의 절차를 적은 폴더(`SKILL.md`)입니다. 세션이 필요할 때 Skill 도구로 열고, 열기 전에는 맥락을 차지하지 않습니다.
- **sub-agent**: 새 맥락에서 따로 일하고 결과만 돌려주는 도우미입니다(예: 코드 위치 찾기).
- **체크리스트(규정집)**: "이런 일이 생기면 이 순서대로" 하는 한 화면짜리 skill입니다. 항공의 QRH(비정상 상황 체크리스트)에서 따왔고 이름은 `qrh-02-stalled`처럼 `<종류>-<번호>-<이름>`입니다. 번호는 바꾸지도 다시 쓰지도 않습니다. 새 규칙을 만드는 것이 아니라 매뉴얼에 이미 있는 규칙을 순서로 옮긴 것입니다.

## 지금 있는 것

| 이름 | 한 줄 설명 | 언제 쓰나 |
|---|---|---|
| `atc-task` | ATC 이슈 하나를 구현해 PR로 올리고 보고하는 순서와 점검표 | 팀 세션이 "ATC-n 진행"처럼 이슈를 맡았을 때. 아래 셋을 부르는 길잡이이기도 합니다 |
| `diagnosing-bugs` | 버그·실패하는 테스트·회귀를 재현하고 가설을 세워 고치는 방법(외부 skill을 가져옴, MIT) | `atc-task`가 버그 FLIGHT에서 코드를 바꾸기 전에 부릅니다 |
| `ui-review` | 화면을 바꾼 PR을 디자인 언어(`docs/design-language.md` 5절)와 가져온 규칙(MIT)으로 검토해 결과 블록을 만듭니다 | `atc-task`가 `web/`이나 ANNUNCIATOR 화면을 바꾼 FLIGHT의 PR 전에 부릅니다 |
| `codebase-locator`, `codebase-analyzer` | 코드가 어디 있는지 찾아 경로만 돌려주거나 `file:line`으로 설명하는 sub-agent(외부, Apache-2.0) | `atc-task`가 코드를 넓게 읽기 전에 맡깁니다 |
| 관제 세션의 `/tick` | TOWER·OCC·CROSSCHECK·MCC·REVIEW가 한 바퀴마다 따르는 절차(OCC는 절차 파일 다섯 개가 더 있음) | `/loop`가 3~10분마다 부릅니다(TOWER 3분, MCC 5분, OCC·CROSSCHECK·REVIEW 10분) |
| `inspector` | MCC INSPECTION을 새 맥락에서 하는 읽기 전용 sub-agent | MCC `/tick`이 PR마다 부릅니다 |
| 규정집 `qrh-01-lost-comms`, `qrh-02-stalled`, `qrh-03-undelivered`, `qrh-05-arrival-missing` | 팀 CAPTAIN이 OCC·TOWER에 닿지 않을 때 / AIRCRAFT가 STALLED일 때 / FLIGHT PLAN 전달이 안 되거나 늦을 때 / 도착 보고가 없을 때의 순서 | **아직 어떤 세션에도 로드되지 않습니다.** 파일만 저장소에 있습니다. `qrh-04-go-around`는 번호만 예약했고 파일이 없습니다 |

## 아직 없는 것

- **규정집 로드**: LAUNCH가 `--plugin-dir`로 규정집을 세션에 붙이는 일은 아직 없습니다. 그때까지 위 체크리스트는 세션이 열지 않습니다.
- **서버가 체크리스트 이름을 알려 주기**: 지금은 서버가 "이 상황이면 이 체크리스트를 불렀을 것"이라고 기록만 합니다(shadow). 세션이 받는 글은 바뀌지 않았습니다.
- 일반 체크리스트(`cl-*`, `sop-*`), 누락 기능(`mel-*`), 쓰임을 보는 화면, OCC 매뉴얼 정리와 TOWER 밖의 composite tick은 이후 단계입니다. 목록과 이슈 링크는 [docs/skills.md](https://github.com/chaehy5665/atc/blob/main/docs/skills.md) 9절에 있습니다.

## 쓰였는지 보는 곳

보는 화면은 아직 없고, 서버 주소로만 봅니다(읽기만 합니다).

| 주소 | 보여 주는 것 |
|---|---|
| `GET /api/skills/usage?days=N` | 하루마다 어떤 skill·sub-agent가 몇 번, 어느 세션에서 불렸는지(`skills`, `agents`, `bySession`). `qrh`에는 "이름을 불렀을 때 실제로 연 비율"(`openedRate`)이 들어 있습니다. 이름과 시각만 읽고 대화 내용은 읽지 않습니다 |
| `GET /api/qrh/named?since=` | 서버가 체크리스트를 부를 조건을 처음 본 기록(shadow) |

규정집이 로드되기 전에는 `openedRate`가 비어 있는 것이 정상입니다. `diagnosing-bugs`와 `codebase-*`의 시범 사용량은 `skills`와 `agents`의 이름으로 봅니다. 쓰인 횟수만 알려 줄 뿐 도움이 됐는지는 말해 주지 않습니다. 관제 세션의 `/tick`이 이 수에 잡히는지는 아직 확인하지 못했습니다.

## 바뀌면 어떻게 알려지나

- `CLAUDE.md`, `docs/design-language.md`, `atc-task`가 바뀌면 실행 중인 atc 세션이 다음 차례에 바뀐 부분을 받습니다(`rules-drift` hook). FLEET 카드의 "RULES current / RULES 미확인"이 그 상태입니다. 다른 skill과 규정집은 아직 이 감시 대상이 아닙니다.
- 관제 세션은 `/tick` 처음에 `manual check`로 자기 매뉴얼이 바뀌었는지 보고, 바뀌었으면 다시 읽습니다.
- 가져온 skill의 출처·커밋·라이선스는 저장소의 `THIRD_PARTY_NOTICES.md`에 있습니다.

## SUPERVISOR가 정하는 것

- **머지**: 루트 `.claude/`(skill·agent)와 `rulebook/`의 변경은 `user` 등급이라 SUPERVISOR가 머지합니다. 관제 세션 폴더의 매뉴얼은 `flagged`라 MCC가 착륙시킬 수 있지만 가드는 `user`입니다.
- **언어(D1)**: 규정집 본문은 지금 영어로 쓰여 있고 요약은 한국어 안내에 둡니다(세션끼리는 영어로 말하기 때문입니다). 조사 문서가 SUPERVISOR 결정 D1로 올려 둔 것이라 최종 언어는 SUPERVISOR가 정합니다.
- **켜기**: 규정집을 세션에 붙일지(LAUNCH `--plugin-dir`), 서버가 체크리스트 이름을 글에 넣을지는 shadow의 이름→열기 비율을 본 뒤 SUPERVISOR가 정합니다.
- **가져온 규칙과 디자인 언어가 부딪칠 때**: `ui-review`는 부딪치는 규칙을 적용하지 않고 `CONFLICT`로 남깁니다. 어느 쪽을 따를지는 SUPERVISOR가 정합니다.

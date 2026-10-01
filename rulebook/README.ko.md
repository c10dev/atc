# rulebook: Claude Code plugin으로 만든 atc의 대응 매뉴얼

[English](README.md) · **한국어**

비정상 상황의 체크리스트를 skill로 담은 plugin(`atc-rulebook`)이다. 세션이 문단 하나를 기억하는 대신 그 상황의 절차를 연다. 설계와 근거는 [docs/research/skill-rulebook.ko.md](../docs/research/skill-rulebook.ko.md)([ATC-281](https://linear.app/vocado/issue/ATC-281)) 5.1~5.4절이다.

**아직 어느 세션도 불러오지 않는다.** 지금은 아무것도 이것을 띄우지 않는다. 나중 변경이 LAUNCH에 `--plugin-dir`을 더하며, 그 전까지 이 파일들은 저장소에만 있다. skill은 `atc-rulebook:<id>`로 부른다.

## 세 층

| 층 | 담는 것 | 어디 |
|---|---|---|
| 한계 | 절대 일어나면 안 되고 코드로 검사할 수 있는 것 | guard와 hook(`*guard*.mjs`, `hooks/`). 여기 아님 |
| Memory item | 매 턴 적용되거나 되돌릴 수 없는 한 줄 규칙, 많아야 약 10개 | `CLAUDE.md` 맨 위. 여기 아님 |
| 절차 | 트리거 조건이 있는 모든 것 | 이 폴더의 skill |

## skill

배치는 `skills/<id>/SKILL.md`. ID 규칙은 `<종류>-<번호>-<slug>`이고 종류는 `sop`(비행마다), `cl`(정상 체크리스트), `qrh`(비정상·비상), `mel`(능력 없음)이다. **번호는 바꾸거나 다시 쓰지 않는다.** skill을 지워도 마찬가지다(`qrh-04`는 GO AROUND용으로 비워 둔다).

| ID | 대상 | 주인(나온 매뉴얼) | SUPERVISOR용 한 줄 요약 |
|---|---|---|---|
| `qrh-01-lost-comms` | OCC·TOWER에 닿지 못하는 AIRCRAFT | CREW BRIEFING, [ATC-258](../docs/research/lost-comms-and-contingency.ko.md) F4 | 팀이 관제와 연락이 끊기면 작업을 안전하게 두고, 임시 커밋 뒤 받은 FLIGHT를 계획대로 이어 가며, 끊긴 시각을 PR에 적는다 |
| `qrh-02-stalled` | health `STALLED`·`RESUME`을 본 OCC·TOWER | `occ/` 매뉴얼(`following.md`), `controller/` 매뉴얼, [docs/fleet.ko.md](../docs/fleet.ko.md) 8.8 | 팀에 보내지 않고, RESUME은 SUPERVISOR에게 알리고 STALLED는 LOG에 적는다. "계속"은 SUPERVISOR가 그 세션에서 보낸다 |
| `qrh-03-undelivered` | 보내기가 실패했거나 FLIGHT PLAN·RECALL이 overdue인 OCC | `occ/` 매뉴얼(`flight-plan.md`, `crew-change.md`) | 실패하면 "보냈다"고 쓰지 않고 `undelivered`로 돌리며 같은 tick에 다시 보내지 않는다. overdue는 한 번만 다시 보내고 그래도 없으면 SUPERVISOR에게 |
| `qrh-05-arrival-missing` | ARRIVED 보고를 읽거나, 머지됐는데 보고가 없는 FLIGHT를 본 OCC | `occ/` 매뉴얼(`/tick` 1·2단계) | 보고는 읽는 즉시 고정 줄만 기록하고, 30분 지나도 없으면 LOG에 적고 SUPERVISOR에게 한 번 알린다. 팀에 묻지 않는다 |

모든 skill의 형식은 한 화면이다: frontmatter의 `name`과 좁은 `description`("Use when …"), ID·`rev <날짜>.<n>`·`owner`가 있는 제목 줄, `Condition`, 번호 있는 `Steps`, `Stop and report if`(Expected / Found / Why it matters), `End state`, `Report line`.

## skill이 열리는 방법

서버가 이미 보내는 글에 체크리스트 이름(`Checklist: qrh-03-undelivered`)을 넣고, 세션이 바로 그 skill을 연다. `description`은 서버가 보지 못하는 상황을 위한 fallback일 뿐이다. skill이 많으면 Claude Code가 설명부터 빼므로 거기에 기대지 않는다(조사 4.2절).

## 개정과 주인

- 모든 skill은 제목 줄에 개정 문자열 `rev <날짜>.<n>`이 있다. 단계가 바뀌면 고친다.
- skill은 매뉴얼이나 `CLAUDE.md`에 이미 있는 규칙을 옮긴 것이고 새 규칙을 더하지 않는다. 새 규칙은 매뉴얼에서 먼저 정한다.
- **이 폴더의 모든 변경은 `user` 등급**(`deploy/landing-tier.mjs`)이다. guard처럼 SUPERVISOR가 머지한다.
- 본문은 영어(D1)다: 세션끼리 영어로 말한다. SUPERVISOR용 한국어 요약은 위 표에 있다.

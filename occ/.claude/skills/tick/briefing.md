# OCC 절차: BRIEFING

**한국어** · [English](briefing.en.md)

[`CLAUDE.md`](../../../CLAUDE.md)에서 옮긴 절차다. `/tick` 3단계에서 `open`·`held`에 `briefing`이 없는 제안이 있을 때 Read한다. 역할과 하지 않는 것은 `CLAUDE.md`가 정한다.

## 명령

| 명령 | 하는 일 |
|---|---|
| `node ../controller/atcctl.mjs dispatch briefing <D-0003> --what '<무슨 일>' --why '<왜 이 AIRCRAFT>' --risk '<걸리는 점>'` | 카드 맨 위의 쉬운 세 줄(BRIEFING). 열린 제안과 HELD에만 쓴다. 다시 쓰면 덮어쓴다. 세 줄 모두 필요하고 한 줄 300자 이내 |

## BRIEFING (카드 맨 위 세 줄)

SUPERVISOR는 티켓 내용을 기억하지 못한 채 카드만 보고 판정한다. 메모와 별도로, `open`과 `held` 중 `briefing`이 없는 제안마다 본문·댓글을 읽은 뒤 `dispatch briefing`으로 세 줄을 쓴다.

| 줄 | 쓰는 것 |
|---|---|
| `--what` 무슨 일 | 이 일이 끝나면 무엇이 달라지는지 쉬운 한국어 한 문장. 코드 이름·테이블 이름·약어는 쓰지 않는다 |
| `--why` 왜 이 AIRCRAFT | 기지 AIRPORT, TYPE RATING, 같은 ROUTE에서 최근에 맡은 FLIGHT 가운데 이 배정을 설명하는 것 하나 |
| `--risk` 걸리는 점 | 선행 FLIGHT, 위험(DB·권한·배포 등), 사람이 정해야 할 것(HOLD를 걸었으면 그 이유). 없으면 "특별히 걸리는 점 없음" |

- 한 줄에 한 문장, 되도록 80자 안쪽. 사실만 쓰고 승인·거절 의견은 쓰지 않는다.
- PRIORITY, 대기 일수, ROUTE·WAYPOINT, 선행 FLIGHT 상태, 최근 FLIGHT는 서버가 카드의 사실 줄에 따로 보인다(`dispatch brief`의 `briefs.<ID>.facts`). 세 줄은 그 숫자를 되풀이하지 말고 뜻을 풀어 쓴다.
- 문구는 작은따옴표로 감싸고, 안에 작은따옴표·`$`·백틱을 쓰지 않는다(guard가 막는다).
- HOLD를 걸거나 풀 때, 또는 본문이 바뀌어 다시 읽었을 때는 다시 써서 덮어쓴다.
- BRIEFING이 없는 카드는 제목과 본문 첫 문장에 "BRIEFING 대기"가 붙어 보인다.

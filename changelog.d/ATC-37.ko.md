### 추가
- HUMAN CHECK 대기열: 사람이 꼭 봐야 하는 PR만(ATC-37, [docs/occ.ko.md](docs/occ.ko.md) 9.8). atc가 PR 본문의 `## UI change` 블록을 읽는다. class가 `CHOICE`·`ACCOUNT`·`DEVICE`이고 `Human check`가 현재 head에 `done`이 아닌 PR이 STRIPS 맨 위에 모인다.
  - 줄마다 PR, FLIGHT, 팀, class, 증거(Evidence pack이 가리키는 PR 댓글의 썸네일, 이 head의 RUN-UP 보고서가 있으면 그것)와, ACCOUNT·DEVICE면 Preview 링크와 사람이 할 1~3 단계.
  - PASS·FAIL은 SUPERVISOR만(AUTOLAND 스위치와 같은 Origin 규칙). PR을 다시 읽어 head가 바뀌었으면 거절하고, `Human check:` 줄 하나를 `done|failed <date> <sha> <note>`로 바꾼 뒤 PR 댓글 하나를 단다. GitHub에 쓰는 것은 이 둘뿐이다. 결과는 head에 묶이고 main 병합만 한 head는 잇는다(ATC-31). 시도마다 `human-checks.jsonl`에 추가한다.
  - RUN-UP 보고서 파일은 그 보고서 폴더 안에서만 sandbox로 보낸다. Vercel 공유 토큰은 만들지도 두지도 않는다.

### 변경
- AUTOLAND `merge`가 옛 Human Preview 게이트를 더 읽지 않는다(ATC-37). class PR은 HUMAN CHECK가 head에 `done`일 때까지 머지하지 않는다. `## UI change` 블록이 없거나 class를 채우지 않은 PR도 머지하지 않는다. class `none` PR은 막지 않는다. LANDING SEQUENCE 줄에 `HUMAN CHECK <class>: <상태>`가 보인다.

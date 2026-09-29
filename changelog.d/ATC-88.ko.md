### 추가
- DISPATCH 판정 계열(Jev): 판정 계열이 열린 ASSIGN 제안에도 Ready·Prerequisite(Noul)와 Same area(Score) mark를 남긴다. 그림자 전용(ATC-88, [docs/fleet.ko.md](docs/fleet.ko.md) 6.1).
  - 스위치, 1분 3건 한도(CLASSIFY와 번갈아), 백오프, 엔진을 같이 쓴다. 점수·상태·HOLD는 바꾸지 않고 `proposals.jsonl`은 건드리지 않는다.
  - FLIGHT는 ATC-36 허용 목록으로 보낸다. Same area에만 AIRCRAFT의 마지막 3 LOGBOOK FLIGHT 제목이 더 나가고, 모두 atc FLIGHT일 때만이다.
  - `judges.jsonl`에 `target: "dispatch"` 줄. `JEV` 칩은 RECENT의 닫힌 제안에만 보이고, 점검 패널은 답마다 SUPERVISOR의 거절, `waiting-on-prior` 칩·OCC HOLD, 승인과 맞은 비율을 센다.

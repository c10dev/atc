### 추가
- DISPATCH가 곧 배정할 FLIGHT와 같은 AIRPORT에서 이미 날고 있는 FLIGHT의 파일 겹침을 본다(ATC-71, [docs/dispatch.ko.md](docs/dispatch.ko.md) 5.3.1).
  - 날고 있는 파일: STAND의 merge-base부터 `git diff`와 커밋하지 않은 경로(읽기 전용), 열린 PR의 파일 목록(head별 캐시). 예측 파일: FLIGHT 본문과 연결된 FLIGHT 본문의 백틱 경로·glob, 출처와 함께. 모델 호출 없음.
  - 새 요소 `파일 겹침`(WAKE 가중, 파일·FLIGHT·팀을 적음)과 `이어서 하면 충돌 없음`(겹치는 FLIGHT를 이미 날고 있는 팀이 그 파일을 만지는 유일한 팀).
  - `dispatch.json`의 `overlap.hold`(기본 `false`)를 켜면 무겁게 겹치는 FLIGHT는 잡은 FLIGHT가 머지될 때까지 HOLD_DEPARTURE. 꺼져 있으면 DISPATCH 탭에 HOLD할 것을 `shadow —`로 보인다.
  - 열린 PR이 `DIRTY`가 되면 ATFM이 `dirty` 기록을 남기고 그때 파일을 나누던 PR을 적는다. ATFM 데이터 줄 `DIRTY(겹침 예측 가능)`은 7일 `seen/dirty`.

### 추가
- MCC 모드 `rts`(ATC-84, [docs/mcc.md](docs/mcc.md) "Mode `rts` and the server's own RTS as built"): SUPERVISOR가 atc PR을 손으로 머지하고, atc 서버가 RETURN TO SERVICE를 할 때(main CI 통과, 5분 간격, ROLLBACK으로 멈추지 않음)가 되면 MCC 세션의 `/tick`을 기다리지 않고 스스로 시작한다.
  - `land+rts`는 MCC의 착륙을 그대로 두고 같은 서버 트리거를 쓴다. `rts`에서 MCC는 `would-land`만 남긴다. 설정 창의 MCC 줄에서 고른다.
  - 판정은 순수 함수(`autoRtsOf`)다. `package*.json`이나 유닛 파일을 바꾼 범위, 마지막 RTS가 거절·실패한 같은 `main`은 SUPERVISOR 몫으로 남는다(UPDATE 바). 시험 서버(임시 상태 폴더, 7700이 아닌 포트)는 유닛을 시작하지 않는다.
  - 세션의 `mcc rts`도 그대로 되고, 서버가 이미 시작했으면 그렇다고 답한다. UPDATE 바는 이 모드들에서 `자동 배포 켜짐`을 보이고, 5분 간격을 기다리는 중이면 다음 시각을 함께 보인다.

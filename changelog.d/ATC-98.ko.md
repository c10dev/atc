### 추가
- FLEET이 백그라운드 AIRCRAFT에 돌고 있는 job을 표시하고 `claude attach <jobId>`를 복사한다(ATC-98, [docs/fleet.ko.md](docs/fleet.ko.md) 8.5.2).
  - 스냅샷의 `Session`이 세션 파일에서 `kind`(`background`·`interactive`)와 `jobId`를 읽고, `AircraftView`와 FLEET 목록 줄이 AIRCRAFT의 살아 있는 세션에서 `background: { jobId }`를 싣는다. 스냅샷만으로 셈하므로 `claude agents`를 더 부르지 않는다. 죽은 세션과 STALE job에는 칩이 없다.
  - `BG` 칩 툴팁은 `BG <jobId> — claude attach <jobId>`이고, 카드의 `ATTACH 복사` 버튼이 그 명령을 복사한다.

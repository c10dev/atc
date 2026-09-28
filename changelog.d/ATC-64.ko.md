### 변경
- 나란히 가는 PR끼리 머지 충돌이 줄어든다(ATC-64, [changelog.d/README.ko.md](changelog.d/README.ko.md)). 2026-09-28의 충돌은 대부분 `CHANGELOG.md`·`CHANGELOG.ko.md`와 설계 문서의 상태 표(`docs/fuel.md` 8절)에서 났다.
  - CHANGELOG 조각: PR은 이제 `CHANGELOG.md`·`CHANGELOG.ko.md`를 고치지 않는다. `changelog.d/ATC-n.md`와 `ATC-n.ko.md`에 `### Added`, `### 변경` 같은 절 제목 아래 항목을 둔다. `node server/changelog-fold.ts`가 모든 짝을 두 파일의 `[Unreleased]`에서 이름이 같은 첫 절 맨 위에 넣고(없는 절은 Keep a Changelog 순서로 만든다) 지운다. 다시 돌려도 같고, 기존 줄과 릴리스된 버전은 그대로 두며, 짝이 없거나 형식이 틀린 조각이 있으면 아무것도 바꾸지 않는다(`--check`는 보기만 한다). `npm test`가 PR마다 저장소의 조각을 본다.
  - DOCS 탭에 변경 기록 쪽이 생겼다: `CHANGELOG.ko.md`에 아직 접지 않은 한국어 조각을 `[Unreleased]` 아래에 함께, 그렇다고 적어 보인다.
  - 설계 문서의 상태 표시(Implementation order 표의 ✅, `Status:` 줄, "Not built yet"에서 옮기기, `docs/guide/stages.md`의 단계)는 ENGINEERING이 머지 뒤 Linear를 보고 고친다. 팀 PR은 만든 것을 그 기능을 설명하는 절 바로 뒤에 번호 없는 자기 절(`### F7 as built (ATC-57)`)로만 적는다.
  - 바뀐 규칙: 루트 `CLAUDE.md`(ko/en), `atc-task` skill 점검표, MCC 매뉴얼(ko/en), `docs/mcc.md` 4.1, MCC INSPECTION 안내(`server/mcc-run.ts`). CHANGELOG를 직접 고치거나 상태 표시를 고치면 P2 지적이다.

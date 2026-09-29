### Changed
- TOWER(`controller/`)와 OCC(`occ/`)가 `claude-sonnet-5-5`로 돈다. 각 폴더의 `.claude/settings.json`에 모델을 고정했다. 전에는 그곳에 `model`이 없어 사용자 기본값(`sonnet`, 곧 `claude-sonnet-5`)을 따랐다. Sonnet 5.5는 목록 가격이 같다. 세션을 다시 시작할 때 적용된다(설정 창 AGENTS → CONTROL에서 STOP 뒤 LAUNCH).

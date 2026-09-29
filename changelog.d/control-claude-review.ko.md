### Changed
- CROSSCHECK는 Claude Opus(`claude-opus-5-5`), REVIEW는 Claude Sonnet(`claude-sonnet-5-5`)으로 돌고, 다른 관제 세션처럼 `claude --bg`로 연다. atc는 `ocx`(opencodex) 경로를 더 쓰지 않는다. CROSSCHECK·REVIEW를 tmux의 `ocx claude`로 띄우던 LAUNCH를 없앴다([docs/occ.ko.md](docs/occ.ko.md) 9.9와 "CROSSCHECK를 Claude Opus로", [docs/fleet.ko.md](docs/fleet.ko.md) 8.5.1).
- guard와 서버는 CROSSCHECK mark를 Claude Opus 기록에서만, 착륙 리뷰를 Claude Sonnet에서만 받는다. ATFM A7·S3은 열린 건에 이미 달린 Muse·Terra의 agree도 계속 인정한다. main 병합만 한 head에 리뷰를 이어받을 때는 Sonnet 기록과 옛 DeepSeek 기록을 모두 인정한다.
- 스트립과 TOWER `review`의 리뷰어 이름은 `claude-`를 뗀다(`REVIEW: SONNET (Codex 한도)`). 이어받은 리뷰는 `by: "review"`로 보인다. 저장되는 이름 `externalReview.security: "deepseek"`과 AUTOLAND `via: "deepseek"`은 그대로 두어 상태 파일은 바뀌지 않는다.

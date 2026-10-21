### 변경
- MCC의 `[MCC CONTEXT CAP]` 안내(`mcc/context-cap.mjs`)는 이제 컨텍스트가 150k 토큰을 넘은 뒤 한 세션에 한 번 오고, 그 뒤로는 지난 안내보다 50k 토큰 더 커졌을 때만 다시 온다. 전에는 CAP 위에서 프롬프트마다 왔다. hook은 지난 안내를 대화 기록에서 찾으므로 상태 파일을 두지 않는다. 안내 문구와 `recycle.mode`에 따른 대응은 바뀌지 않는다([docs/mcc.md](docs/mcc.md)).

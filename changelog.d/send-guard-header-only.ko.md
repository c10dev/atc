### 변경
- OCC가 머리만 보내고 `occ/send-guard.mjs`가 저장된 문구로 바꿔 넣을 때, OCC의 대화 기록에 붙이는 알림은 이제 바꾼 머리와 저장된 문구의 첫 줄(work-order 해시가 있으면 그것까지)만 싣는다. 전에는 나간 문구 전체를 되풀이했는데, 그 문구는 이미 `atcctl` 출력의 `---` 아래에 있었다. AIRCRAFT가 받는 글과 guard가 막는 조건은 바뀌지 않는다([docs/occ.ko.md](docs/occ.ko.md) 8.3).

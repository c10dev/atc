### 추가
- STRIPS와 FLEET이 살아 있는 Claude AIRCRAFT가 지금 하는 일을 `Bash · Run the test suite · 12s` 같은 ACTIVITY 한 줄로 보인다(ATC-97, [docs/fleet.ko.md](docs/fleet.ko.md) "ACTIVITY as built").
  - `server/activity.ts`(순수 함수)가 마지막 `tool_use`와 그 `tool_result`가 왔는지를 읽어 `{tool, label, at, phase}`를 준다. `phase`는 `tool`·`model`·`idle`. 라벨은 Bash `description`, 파일 이름, MCP 도구는 `<server> <tool>`, Agent·Task `description`, skill 이름, SendMessage 받는 쪽이고, 제어 문자를 빼고 60자로 자른다. 명령, 파일 내용, 프롬프트, 도구 결과, assistant 글은 넣지 않는다.
  - AIRCRAFT health와 같은 64KB 대화 기록 끝·같은 캐시에서 셈한다(`healthOfSession`이 이제 `{ health, activity }`를 돌려준다). 두 번 읽지 않는다. 스냅샷 `Session`에 살아 있는 Claude 세션만 `activity`가 붙고, FLEET 줄은 스냅샷에서 가져온다. FLIGHT RECORDER 줄은 바뀌지 않는다.
  - 줄은 STRIPS 스트립의 callsign 아래, FLEET 목록 FLYING 칸의 둘째 줄, FLEET 카드의 FLYING 아래에 있고, `idle`은 흐리게 보인다.
